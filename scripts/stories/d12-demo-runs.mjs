#!/usr/bin/env node
/**
 * d12-demo-runs.mjs — the two demo-pipeline control + positive runs
 * (bead `forge-1rk5.3`). Drives a REAL `control` (behaviour-preserving
 * refactor) or `positive` (real behaviour change) initiative, hand-authored
 * (no architect spawn) against the `node-cli-with-tests` fixture ground,
 * through a real `forge-develop` cycle, up to `ready-for-review` — never past
 * it: this driver never approves, never merges, so a `positive` run's PR
 * stays open for a human to judge.
 *
 * `forge studio` starts and supervises a forever-mode `forge serve`
 * (D-12): whenever serve is live it claims every eligible manifest in
 * `_queue/pending/` on its own. This driver never spawns `forge serve`
 * itself and never calls `POST /api/develop/start` — `writeHandoffArtifacts`
 * writes the manifest ALREADY on `forge-develop` (`d12-demo-runs-core.mjs`'s
 * `planRun`), and only after `bootStudioStep` has confirmed a live
 * supervised serve (`assertServeRunning`) and the hard-clause preflight +
 * declared-gate baseline checks have both passed — so the one moment this
 * manifest becomes claimable is also the one moment it is both CORRECT (the
 * flow its worktree + hand-off `WI-1.md` are actually shaped for — never
 * `forge-architect`, so no claim can ever spawn a real, no-operator
 * architect session) and READY (the claim the scheduler would run against it
 * would not be refused). `waitForDevelopOutcome` then watches the SAME two
 * observables the product itself exposes — the queue directory the manifest
 * sits in and its own `_logs/<cycleId>/events.jsonl`
 * (`scripts/lib/serve-wait.mjs`) — rather than a spawned child process's
 * stdout, since nothing here spawns one.
 *
 * `--dry-run` writes this SAME claimable manifest (there is no other shape
 * to write — `writeManifest`'s containment guard only accepts the real
 * `_queue/pending/` under this process's own `forgeRoot`), so its studio
 * boots on the dry bridge (`FORGE_DRY_BRIDGE=1`), which supervises no serve:
 * nothing claims the manifest, and `runTeardown`'s `removeQueueManifest`
 * sweeps it.
 *
 * WHY THE WORKTREE IS REUSED, NOT RE-CREATED. `decideWorktreeStrategy`
 * (`packages/flows/worktree.ts`) reuses a preserved worktree whenever it is
 * present AND carries hand-off work items — exactly the state this driver
 * manufactures directly (bead `forge-mfv5.1.7`'s "AC-derived checkpoints"
 * needs the WI's own typed acceptance criteria, and those live only in
 * `.forge/work-items/WI-1.md`).
 *
 * EFFECTS: provisions a fixture ground under `projects/`, mints a REAL
 * private GitHub remote, boots a real `forge studio` (whose supervised serve
 * claims and runs a real agent against the manifest this driver writes), and
 * — unless `--keep-remote` — deletes that remote on the way out. `--plan-only`
 * is the only mode safe to run while developing this file; every other mode
 * is the lane's own job, run against a real ground with real spend.
 *
 * Usage:
 *   node scripts/stories/d12-demo-runs.mjs <control|positive> --plan-only
 *   node scripts/stories/d12-demo-runs.mjs <control|positive> --dry-run --report <path>
 *   node scripts/stories/d12-demo-runs.mjs <control|positive> --report <path> [--keep-remote]
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';

import {
  SUPPORTED_KINDS,
  planRun,
  renderPlanOnly,
  judgeRun,
  hardClauseFailures,
} from './d12-demo-runs-core.mjs';
import { runPreflight } from '../../packages/projects/preflight.ts';
import { provisionFixtureGround, teardownFixtureGround } from './fixture-ground.mjs';
import { sweepStoryRemotesFromManifest } from './sweep-remotes.mjs';
import { removeInitiativeWorktree, deleteLocalBranch, removeQueueManifest, manifestQueueState } from './d12-demo-runs-teardown.mjs';
import { installGroundDeps, runDeclaredGateAtHead } from './d12-demo-runs-ground.mjs';
import { spawnStudioReady } from '../lib/boot-studio.mjs';
import { assertServeRunning, waitForManifestOutcome } from '../lib/serve-wait.mjs';

import { add as addWorktree, decideWorktreeStrategy } from '../../packages/flows/worktree.ts';
import { parseManifest, writeManifest, readManifestCycleId } from '../../packages/flows/manifest.ts';
import { readWorkItemsFromDir, writeWorkItem } from '../../packages/flows/work-item.ts';
import { getPaths, worktreeDemoJsonPath } from '@forge/flows';
import { ghRunnerFor, assertGhOwner, recordMintedRemote } from '@forge/kernel';

const STUDIO_TIMEOUT_MS = 150_000;
/** How long this driver waits for its ONE hand-authored initiative to reach
 *  `ready-for-review` or `failed` once forge studio's supervised serve has
 *  claimed it — one develop cycle's dev-loop → integrate → adversarial-review
 *  band, run for real, to a human-reviewable PR. Mirrors the per-stage
 *  budgets `scripts/verify-cycle.mjs` already uses for the same kind of wait
 *  (its architect stage alone gets 25 minutes); generous, since what this
 *  bounds is a real agent run, not a fixed process's exit. */
const DEVELOP_OUTCOME_DEADLINE_MS = 45 * 60_000;

function log(msg) {
  process.stdout.write(`[d12-demo-runs] ${msg}\n`);
}

/**
 * The spawn env for Studio: this run's own cost
 * ceiling threaded via `FORGE_COST_CEILING_USD` — the SAME env var
 * `scripts/verify-cycle.mjs` passes `--cost-ceiling` through as (it takes
 * precedence over the manifest's own `cost_ceiling_usd`, which this driver
 * therefore never sets) — with a headroom proxy stripped if one is somehow
 * still configured (that script's own `forgeSpawnEnv`; neither is exported,
 * so this is an independent, faithful copy, not an edit to that file).
 */
function buildSpawnEnv(plan) {
  const env = { ...process.env, FORGE_COST_CEILING_USD: String(plan.costCeilingUsd) };
  const base = env.ANTHROPIC_BASE_URL ?? '';
  const headers = env.ANTHROPIC_CUSTOM_HEADERS ?? '';
  const isHeadroom = /headroom/i.test(headers) || /\/\/(127\.0\.0\.1|localhost):8787\b/.test(base);
  if (isHeadroom) {
    delete env.ANTHROPIC_BASE_URL;
    delete env.ANTHROPIC_CUSTOM_HEADERS;
    log('headroom proxy detected on ANTHROPIC_BASE_URL — stripped it so forge streams direct');
  }
  return env;
}

// ---------------------------------------------------------------------------
// Effectful steps — each named, each reporting what it did
// ---------------------------------------------------------------------------

/** Provision `projects/<project>` from the fixture seed. */
function provisionGround(plan) {
  log(`provisioning fixture ground projects/${plan.project} from ${plan.fixture}…`);
  const result = provisionFixtureGround(plan.forgeRoot, {
    storyId: plan.storyId,
    project: plan.project,
    fixture: plan.fixture,
  });
  log(`ground provisioned: commit ${result.commit.slice(0, 8)}, digest ${result.digest.slice(0, 12)}…`);
  return result;
}

/**
 * Mint a REAL private GitHub remote for the just-provisioned ground and
 * record it the way `sweepStoryRemotesFromManifest` expects
 * (`_logs/minted-remotes.json`) — the same two calls
 * `packages/projects/project-create.ts`'s (unexported) `mintRemote` makes:
 * `gh repo create … --private --source <dir> --remote origin --push`, then
 * `recordMintedRemote`. `mintRemote` itself is not exported, so this mirrors
 * its shape rather than importing it.
 */
function mintPrivateRemote(plan) {
  log(`minting private remote ${plan.remoteName}…`);
  assertGhOwner(plan.account);
  const runGh = ghRunnerFor(plan.account);
  runGh(
    ['repo', 'create', plan.remoteName, '--private', '--source', plan.projectRepoPath, '--remote', 'origin', '--push'],
    plan.projectRepoPath,
  );
  recordMintedRemote(plan.forgeRoot, plan.remoteName);
  log(`remote minted + recorded: ${plan.remoteName}`);
}

/**
 * Just the `git worktree add` — split from `writeHandoffArtifacts` (below) so
 * `main()` can mark `state.worktreeCreated = true` the instant the worktree
 * DIRECTORY exists, before either the manifest or `WI-1.md` write is
 * attempted. Neither of those is atomic the way `provisionFixtureGround` is
 * (a write failure there leaves nothing behind); here, a worktree that exists
 * with no manifest/WI yet is still real residue teardown must find and
 * remove, not a state this driver can only reach after everything succeeds.
 */
function createInitiativeWorktree(plan) {
  log(`creating worktree ${plan.worktreePath} on branch ${plan.branch}…`);
  return addWorktree({
    projectRepoPath: plan.projectRepoPath,
    branch: plan.branch,
    worktreesRoot: join(plan.forgeRoot, '_worktrees'),
    initiativeId: plan.initiativeId,
  });
}

/**
 * Write the manifest (to `_queue/pending/`) and `WI-1.md` (into the
 * worktree's own `.forge/work-items/`) — the exact hand-off shape
 * `decideWorktreeStrategy` reads as `reuse` (a preserved worktree + preserved
 * hand-off work items).
 */
function writeHandoffArtifacts(plan, handle) {
  const manifestPath = writeManifest(plan.manifest, { queueRoot: join(plan.forgeRoot, '_queue') });
  const wiPath = writeWorkItem(plan.workItem, plan.worktreePath);
  log(`manifest written: ${manifestPath}`);
  log(`work item written: ${wiPath}`);

  const strategy = decideWorktreeStrategy({
    resumeMarkerPresent: false,
    worktreePresent: existsSync(handle.path),
    handoffWorkItemsPresent: existsSync(wiPath),
  });
  if (strategy !== 'reuse') {
    throw new Error(`writeHandoffArtifacts: decideWorktreeStrategy says "${strategy}", expected "reuse" — the develop run would discard WI-1.md`);
  }
  log('decideWorktreeStrategy: reuse (confirmed)');
  return { manifestPath, wiPath, strategy };
}

/** Boot a fresh `forge studio` (never reuses a live one — see the module
 *  header on why nothing here can race a real operator session; a healthy
 *  bridge on 4123 would make this hang until `spawnStudioReady`'s own
 *  timeout, which is the right failure mode: never attach to someone else's
 *  live cycle). Its supervised serve is what will claim the manifest this
 *  driver writes — nothing here spawns `forge serve` itself. */
async function bootStudioStep(plan, { dry = false } = {}) {
  log(dry ? 'booting forge studio on the dry bridge (it supervises no serve)…' : 'booting forge studio…');
  const env = dry ? { ...buildSpawnEnv(plan), FORGE_DRY_BRIDGE: '1' } : buildSpawnEnv(plan);
  const studio = await spawnStudioReady({ fullEnv: env, timeoutMs: STUDIO_TIMEOUT_MS, log: (s) => log(`[studio] ${s}`) });
  log(`studio ready: ui=${studio.uiUrl} bridge=${studio.bridgeUrl}`);
  return studio;
}

/** The manifest's own path, wherever it currently sits in `_queue/` — it
 *  moves pending → in-flight → ready-for-review/failed as serve works it.
 *  `null` once it is in none of them (never happens for this driver, which
 *  stops waiting at ready-for-review/failed, well short of any merge/done
 *  move). */
function currentManifestPath(plan) {
  const state = manifestQueueState(plan.forgeRoot, plan.initiativeId);
  if (state === 'absent') return null;
  const paths = getPaths(join(plan.forgeRoot, '_queue'));
  return join(paths[state], `${plan.initiativeId}.md`);
}

/** The manifest's own persisted `cycle_id`, re-read on every poll: serve
 *  mints it fresh, inside the product, only once it actually claims this
 *  manifest (`packages/flows/cycle.ts`'s `newCycleId`) — there is no way for
 *  this driver to know it in advance. */
function currentCycleId(plan) {
  const path = currentManifestPath(plan);
  return path ? readManifestCycleId(path) : null;
}

/** `QUEUE_STATES`/`manifestQueueState`'s camelCase key names, rendered as
 *  the queue directory's own hyphenated name — the vocabulary this driver's
 *  report + exit-code check already use. */
const QUEUE_STATE_LABELS = { readyForReview: 'ready-for-review', merged: 'merged', done: 'done', failed: 'failed' };

/**
 * Wait for the hand-authored initiative to reach `ready-for-review`
 * (success) or `failed`, or `DEVELOP_OUTCOME_DEADLINE_MS` to pass —
 * `forge studio`'s supervised serve claims and runs it; nothing here spawns
 * `forge serve`. Classification reads the SAME two observables the product
 * itself exposes (`scripts/lib/serve-wait.mjs`'s `waitForManifestOutcome`:
 * the queue directory + the cycle's own `events.jsonl`), so a cycle that
 * failed mid-run or printed a decisive event-log error is named, not
 * silently waited past.
 */
async function waitForDevelopOutcome(plan, evidence) {
  evidence.mark('before waiting for develop outcome');
  const deadlineMs = Date.now() + DEVELOP_OUTCOME_DEADLINE_MS;
  let lastCycleId = null;
  const result = await waitForManifestOutcome(plan.forgeRoot, {
    initiativeId: plan.initiativeId,
    cycleId: () => {
      lastCycleId = currentCycleId(plan);
      return lastCycleId;
    },
    deadlineMs,
  });
  const state = result.outcome === 'timeout' ? 'timed-out' : (QUEUE_STATE_LABELS[result.state] ?? result.state);
  log(`develop outcome: ${state}${result.errors.length ? ` — ${result.errors.join('; ')}` : ''}`);
  evidence.mark(`after waiting for develop outcome (${state})`);
  return { state, cycleId: lastCycleId, errors: result.errors };
}

/** Every `.webm` under the worktree's demo dir, with its size — passed
 *  through to `judgeRun` verbatim (it stays pure; this is the one place that
 *  actually touches the filesystem for them). Best-effort: an unreadable demo
 *  dir yields `[]`, never a thrown error (the run's own verdict already covers
 *  whether the demo exists at all). */
function collectWebmSizes(demoDir) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.webm')) {
        try { out.push({ path: full, bytes: statSync(full).size }); } catch { /* vanished */ }
      }
    }
  };
  walk(demoDir);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Read `demo.json` + the PR body (`gh pr view --json body`) from the
 *  worktree the develop run left in place at `ready-for-review`. */
function readArtifacts(plan) {
  const demoJsonPath = worktreeDemoJsonPath(plan.worktreePath, plan.initiativeId);
  let demoJson = null;
  try {
    demoJson = JSON.parse(readFileSync(demoJsonPath, 'utf8'));
  } catch (err) {
    log(`could not read/parse ${demoJsonPath}: ${err.message}`);
  }

  let prBody = '';
  try {
    const raw = execFileSync('gh', ['pr', 'view', plan.branch, '--json', 'body', '-q', '.body'], {
      cwd: plan.worktreePath,
      encoding: 'utf8',
    });
    prBody = raw.replace(/\n$/, '');
  } catch (err) {
    log(`gh pr view --json body failed: ${err.message}`);
  }

  const webmSizes = collectWebmSizes(dirname(demoJsonPath));
  return { demoJsonPath, demoJson, prBody, webmSizes };
}

/**
 * The run's evidence beside its report: each serve pass's raw output, the manifest's `_queue` state at every step
 * (which process moved it is read from these marks against the serve logs), and the bridge daemon's own serve.log
 * tail — Studio's bridge can run a scheduler daemon in this same tree that would claim the manifest first.
 */
function makeEvidence(plan, reportPath) {
  const dir = `${reportPath.replace(/\.json$/, '')}-evidence`;
  mkdirSync(dir, { recursive: true });
  const trail = [];
  const save = (name, text) => {
    try {
      writeFileSync(join(dir, name), text);
    } catch (err) {
      process.stderr.write(`[d12-demo-runs] could not save evidence ${name}: ${err?.message ?? err}\n`);
    }
  };
  return {
    dir,
    trail,
    save,
    mark(at) {
      const state = manifestQueueState(plan.forgeRoot, plan.initiativeId);
      trail.push({ at, state, t: new Date().toISOString() });
      log(`queue: ${plan.initiativeId} is ${state} (${at})`);
    },
    bridgeDaemon() {
      const daemonDir = join(plan.forgeRoot, '_logs', 'daemon');
      let tail = '(no _logs/daemon/serve.log)';
      try {
        tail = readFileSync(join(daemonDir, 'serve.log'), 'utf8').split('\n').slice(-200).join('\n');
      } catch (err) {
        if (err?.code !== 'ENOENT') tail = `(unreadable: ${err?.code ?? err?.message})`;
      }
      let pid = '(no forge.pid)';
      try {
        const p = Number(readFileSync(join(daemonDir, 'forge.pid'), 'utf8').trim());
        pid = `${p} ${existsSync(`/proc/${p}`) ? 'alive' : 'gone'}`;
      } catch (err) {
        if (err?.code !== 'ENOENT') pid = `(unreadable: ${err?.code ?? err?.message})`;
      }
      save('bridge-serve.log.tail', `daemon pid: ${pid}\n${tail}\n`);
    },
  };
}

/** What a dry run actually proves, each read back from what it wrote — never assumed from having written it. */
function verifyDryRun(plan, written) {
  const check = (fn) => {
    try {
      const detail = fn();
      return { ok: true, detail };
    } catch (err) {
      return { ok: false, detail: err?.message ?? String(err) };
    }
  };
  return {
    baselineGreen: check(() => {
      const r = runDeclaredGateAtHead(plan.projectRepoPath, plan.worktreePath);
      if (!r.ok) throw new Error(r.detail);
      return r.detail;
    }),
    hardClauses: check(() => {
      const failing = hardClauseFailures(runPreflight(plan.projectRepoPath, { forgeRoot: plan.forgeRoot }));
      if (failing.length > 0) throw new Error(`HARD preflight clause(s) fail — the develop claim would be refused: ${failing.join('; ')}`);
      return 'every HARD clause passes';
    }),
    manifestParses: check(() => {
      const m = parseManifest(readFileSync(written.manifestPath, 'utf8'));
      if (m?.initiative_id !== plan.initiativeId) throw new Error(`parsed initiative_id ${m?.initiative_id} ≠ ${plan.initiativeId}`);
      return written.manifestPath;
    }),
    workItemParses: check(() => {
      const { items, parseErrors } = readWorkItemsFromDir(join(plan.worktreePath, '.forge', 'work-items'));
      if (Object.keys(parseErrors).length > 0) throw new Error(JSON.stringify(parseErrors));
      if (items.length !== 1) throw new Error(`${items.length} work items parsed, expected 1`);
      return written.wiPath;
    }),
    remotePrivate: check(() => {
      const out = ghRunnerFor(plan.account)(['repo', 'view', plan.remoteName, '--json', 'visibility'], plan.projectRepoPath);
      const visibility = JSON.parse(String(out)).visibility;
      if (visibility !== 'PRIVATE') throw new Error(`${plan.remoteName} visibility ${visibility}`);
      return `${plan.remoteName} PRIVATE`;
    }),
  };
}

function writeEvidenceReport(reportPath, data) {
  mkdirSync(resolve(reportPath, '..'), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(data, null, 2)}\n`);
  log(`evidence report written: ${reportPath}`);
}

// ---------------------------------------------------------------------------
// Teardown — every step named, a failure reported, never swallowed
// ---------------------------------------------------------------------------

async function runTeardown(plan, state, { keepRemote }) {
  const lines = [];
  const step = async (name, fn) => {
    try {
      await fn();
      lines.push({ step: name, ok: true });
    } catch (err) {
      lines.push({ step: name, ok: false, error: err?.message ?? String(err) });
    }
  };

  if (state.studio) {
    await step('stop studio', () => state.studio.stop());
  }
  // ORDER MATTERS from here: the worktree must go before the branch (git
  // refuses to delete a branch checked out in a worktree) and before
  // `teardownFixtureGround` (which removes `projects/<project>` — the very
  // repo `git worktree remove`/`git branch -D` need to still exist to run
  // against). `_logs/<cycleId>` is deliberately never touched — it is this
  // run's evidence, named in the JSON report instead.
  if (state.worktreeCreated) {
    await step('remove initiative worktree', () => {
      removeInitiativeWorktree(plan.projectRepoPath, plan.worktreePath);
    });
    await step('delete local branch', () => {
      deleteLocalBranch(plan.projectRepoPath, plan.branch);
    });
    await step('remove queue manifest', () => {
      const r = removeQueueManifest(plan.forgeRoot, plan.initiativeId);
      if (!r.removed && r.reason !== 'already absent') {
        // Genuinely unexpected (never "not found" — this run wrote exactly
        // one, and nothing else should have raced it away) — report it by
        // name rather than reading a silent no-op as success.
        throw new Error(r.reason ?? 'removeQueueManifest: not removed');
      }
    });
  }
  if (state.groundProvisioned) {
    await step('teardown fixture ground', () => {
      const r = teardownFixtureGround(plan.forgeRoot, { storyId: plan.storyId, project: plan.project });
      if (r.removed === false && r.error !== undefined) throw new Error(r.error);
    });
  }
  if (state.remoteMinted && !keepRemote) {
    await step('sweep minted remote', () => {
      const r = sweepStoryRemotesFromManifest({ storyId: plan.storyId, root: plan.forgeRoot });
      if (r.refusals.length > 0 || r.failed.length > 0) {
        throw new Error([...r.refusals, ...r.failed.map((f) => `${f.nameWithOwner}: ${f.error}`)].join(' | '));
      }
    });
  } else if (state.remoteMinted && keepRemote) {
    lines.push({ step: 'sweep minted remote', ok: true, skipped: 'kept for human judgment (--keep-remote)' });
  }

  for (const l of lines) {
    if (l.ok) log(`teardown: ${l.step}${l.skipped ? ` — ${l.skipped}` : ' — ok'}`);
    else process.stderr.write(`[d12-demo-runs] teardown: ${l.step} FAILED — ${l.error} (remove it by hand; nothing else sweeps this run)\n`);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage() {
  return [
    'usage: node scripts/stories/d12-demo-runs.mjs <control|positive> [flags]',
    '',
    '  --plan-only     pure; prints the plan + rendered files; touches nothing',
    '  --dry-run       provisions + mints + boots Studio, verifies, tears down',
    '                  (always sweeps the minted remote, regardless of --keep-remote)',
    '  --report <path> REQUIRED for a live or --dry-run invocation; where the',
    '                  JSON evidence report is written',
    '  --keep-remote   live runs only: do not sweep the minted remote on teardown',
    '                  (the positive run keeps its PR up for human judgment)',
  ].join('\n');
}

function parseArgv(argv) {
  const kind = argv[0];
  const flags = argv.slice(1);
  const reportIdx = flags.indexOf('--report');
  const reportPath = reportIdx >= 0 ? flags[reportIdx + 1] : undefined;
  if (reportIdx >= 0 && (reportPath === undefined || reportPath.startsWith('--'))) {
    throw new Error('--report requires a path');
  }
  const known = new Set(['--dry-run', '--plan-only', '--keep-remote']);
  const rest = reportIdx >= 0 ? [...flags.slice(0, reportIdx), ...flags.slice(reportIdx + 2)] : flags;
  const unknown = rest.filter((f) => !known.has(f));
  if (unknown.length > 0) throw new Error(`unknown flag(s): ${unknown.join(', ')}`);
  return {
    kind,
    dryRun: rest.includes('--dry-run'),
    planOnly: rest.includes('--plan-only'),
    keepRemote: rest.includes('--keep-remote'),
    reportPath: reportPath === undefined ? null : resolve(reportPath),
  };
}

async function main(argv) {
  let opts;
  try {
    opts = parseArgv(argv);
  } catch (err) {
    console.error(`d12-demo-runs: ${err.message}\n\n${usage()}`);
    process.exitCode = 2;
    return;
  }
  if (!SUPPORTED_KINDS.includes(opts.kind)) {
    console.error(`d12-demo-runs: kind must be one of ${SUPPORTED_KINDS.join('|')}\n\n${usage()}`);
    process.exitCode = 2;
    return;
  }

  const plan = planRun(opts.kind);

  if (opts.planOnly) {
    process.stdout.write(`${renderPlanOnly(plan)}\n`);
    return;
  }
  if (!opts.reportPath) {
    console.error(`d12-demo-runs: --report <path> is required for a live or --dry-run invocation\n\n${usage()}`);
    process.exitCode = 2;
    return;
  }

  const state = { groundProvisioned: false, remoteMinted: false, worktreeCreated: false, studio: null, cycleId: null };
  let exitCode = 0;
  // One report, written in `finally` AFTER teardown, so it always exists and always carries teardown's own result.
  const evidence = makeEvidence(plan, opts.reportPath);
  let report = { kind: plan.kind, mode: opts.dryRun ? 'dry-run' : 'live', initiativeId: plan.initiativeId, remoteName: plan.remoteName };
  try {
    provisionGround(plan);
    state.groundProvisioned = true;
    log(`ground deps: ${installGroundDeps(plan.projectRepoPath)}`); // the operator's install step (row 132)

    mintPrivateRemote(plan);
    state.remoteMinted = true;

    const handle = createInitiativeWorktree(plan);
    state.worktreeCreated = true; // the worktree dir exists now — teardown must own it even if the next line throws

    // A dry run writes the same claimable manifest, so its studio runs on the
    // dry bridge and supervises no serve: nothing can claim it. A live run
    // confirms its studio's supervised serve is up before waiting on it — a
    // wait against a serve that will never claim would otherwise hang
    // silently until its own deadline.
    state.studio = await bootStudioStep(plan, { dry: opts.dryRun });
    await assertServeRunning(state.studio.bridgeUrl, { expect: opts.dryRun ? 'unsupervised' : 'running' });

    if (opts.dryRun) {
      const written = writeHandoffArtifacts(plan, handle);
      const strategy = decideWorktreeStrategy({
        resumeMarkerPresent: false,
        worktreePresent: existsSync(plan.worktreePath),
        handoffWorkItemsPresent: existsSync(join(plan.worktreePath, '.forge', 'work-items', 'WI-1.md')),
      });
      const verified = { worktreeStrategy: strategy, ...verifyDryRun(plan, written) };
      report = { ...report, verified };
      const failedChecks = Object.entries(verified).filter(([k, v]) => (k === 'worktreeStrategy' ? v !== 'reuse' : v?.ok !== true));
      if (failedChecks.length > 0) exitCode = 1;
      return;
    }

    // Never let the manifest become claimable at all when the scheduler
    // would refuse the claim (row 128) or the develop loop would refuse a
    // red baseline (row 132) — named BEFORE `writeHandoffArtifacts` below,
    // which is the one moment this manifest becomes claimable.
    const failing = hardClauseFailures(runPreflight(plan.projectRepoPath, { forgeRoot: plan.forgeRoot }));
    if (failing.length > 0) throw new Error(`HARD preflight clause(s) fail, so the develop claim would be refused: ${failing.join('; ')}`);
    const baseline = runDeclaredGateAtHead(plan.projectRepoPath, plan.worktreePath);
    if (!baseline.ok) throw new Error(`the declared quality gate is red at HEAD, so the develop loop would refuse it: ${baseline.detail}`);
    log(`baseline: ${baseline.detail}`);

    // The manifest is born already on forge-develop (`planRun`'s own
    // `flow_id`) — studio's supervised serve claims it the instant this
    // write lands in `_queue/pending/`. No repoint, no second request.
    writeHandoffArtifacts(plan, handle);
    const outcome = await waitForDevelopOutcome(plan, evidence);
    state.cycleId = outcome.cycleId;

    const artifacts = readArtifacts(plan);
    const verdict = judgeRun(plan, {
      demoJson: artifacts.demoJson,
      prBody: artifacts.prBody,
      webmSizes: artifacts.webmSizes,
    });
    log(`verdict: ${verdict.pass ? 'PASS' : 'FAIL'}`);
    for (const r of verdict.reasons) log(`  ${r.pass ? 'PASS' : 'FAIL'} — ${r.name}: ${r.detail}`);

    report = {
      ...report,
      developOutcome: outcome.state,
      developOutcomeErrors: outcome.errors,
      demoJsonPath: artifacts.demoJsonPath,
      // Evidence teardown never touches — named here, not swept.
      logsPath: state.cycleId ? join(plan.forgeRoot, '_logs', state.cycleId) : null,
      prBody: artifacts.prBody,
      verdict,
    };
    if (outcome.state !== 'ready-for-review' || !verdict.pass) exitCode = 1;
  } catch (err) {
    process.stderr.write(`[d12-demo-runs] REFUSING/FAILED: ${err?.stack ?? err?.message ?? err}\n`);
    report = { ...report, error: err?.message ?? String(err) };
    exitCode = 1;
  } finally {
    evidence.mark('before teardown');
    evidence.bridgeDaemon();
    const teardown = await runTeardown(plan, state, { keepRemote: opts.keepRemote });
    if (teardown.some((l) => !l.ok)) exitCode = 1;
    writeEvidenceReport(opts.reportPath, { ...report, evidenceDir: evidence.dir, queueTrail: evidence.trail, teardown });
  }
  process.exitCode = exitCode;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2));
}

export { main, parseArgv, buildSpawnEnv };
