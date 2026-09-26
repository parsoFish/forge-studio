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
 * WHY THE MANIFEST NEVER RACES THE SCHEDULER. `POST /api/develop/start`
 * (`enqueueDevelopRun`) is a manifest-move ONLY — "none spawns in-request;
 * the scheduler daemon claims the manifest and runs the flow later"
 * (`apps/forge/bridge-run-triggers.ts`'s own header). And `forge studio`
 * boots NO persistent scheduler daemon of its own — that is a SEPARATE
 * detached process, started only by an explicit `POST /api/scheduler/start`
 * (`apps/forge/bridge-scheduler.ts`), which this driver never calls. So a
 * manifest sitting in `_queue/pending/` with `flow_id: forge-architect` is
 * inert from the moment Studio boots until THIS driver itself spawns
 * `forge serve --once` (`waitForDevelopOutcome`, below) — after the
 * hand-off has already repointed it to `forge-develop`. Nothing here ever
 * spawns a real architect session.
 *
 * WHY THE WORKTREE IS REUSED, NOT RE-CREATED. `decideWorktreeStrategy`
 * (`packages/flows/worktree.ts`) reuses a preserved worktree whenever it is
 * present AND carries hand-off work items — exactly the state this driver
 * manufactures directly (bead `forge-mfv5.1.7`'s "AC-derived checkpoints"
 * needs the WI's own typed acceptance criteria, and those live only in
 * `.forge/work-items/WI-1.md`).
 *
 * EFFECTS: provisions a fixture ground under `projects/`, mints a REAL
 * private GitHub remote, boots a real `forge studio`, drives a real
 * `forge serve --once` (which spawns a real agent), and — unless
 * `--keep-remote` — deletes that remote on the way out. `--plan-only` is the
 * only mode safe to run while developing this file; every other mode is the
 * lane's own job, run against a real ground with real spend.
 *
 * Usage:
 *   node scripts/stories/d12-demo-runs.mjs <control|positive> --plan-only
 *   node scripts/stories/d12-demo-runs.mjs <control|positive> --dry-run --report <path>
 *   node scripts/stories/d12-demo-runs.mjs <control|positive> --report <path> [--keep-remote]
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';

import {
  SUPPORTED_KINDS,
  planRun,
  renderPlanOnly,
  judgeRun,
} from './d12-demo-runs-core.mjs';
import { provisionFixtureGround, teardownFixtureGround } from './fixture-ground.mjs';
import { sweepStoryRemotesFromManifest } from './sweep-remotes.mjs';
import { removeInitiativeWorktree, deleteLocalBranch, removeQueueManifest } from './d12-demo-runs-teardown.mjs';
import { spawnStudioReady } from '../lib/boot-studio.mjs';
import { createStageTwo } from '../verify-cycle-stage2.mjs';
import { classifyServeStageOutcome } from '../verify-cycle-stage-outcome.mjs';

import { add as addWorktree, decideWorktreeStrategy } from '../../packages/flows/worktree.ts';
import { parseManifest, writeManifest } from '../../packages/flows/manifest.ts';
import { readWorkItemsFromDir, writeWorkItem } from '../../packages/flows/work-item.ts';
import { getPaths, worktreeDemoJsonPath } from '@forge/flows';
import { ghRunnerFor, assertGhOwner, recordMintedRemote } from '@forge/kernel';

const STUDIO_TIMEOUT_MS = 150_000;
/** One `forge serve --once` pass runs a whole develop cycle (dev-loop → demo
 *  → adversarial-review → verdict) to `ready-for-review`, synchronously, per
 *  `scripts/verify-cycle.mjs`'s own header. This is the per-pass child-process
 *  budget, not the overall outcome-wait budget (`MAX_SERVE_PASSES`, below). */
const SERVE_ONCE_TIMEOUT_MS = 45 * 60_000;
/** How many `serve --once` passes this driver will spend trying to reach
 *  `ready-for-review`/`failed` before giving up and reporting a timeout — a
 *  single independent initiative should need exactly one; a couple more are
 *  this driver's own defensive margin, mirroring `scripts/verify-cycle.mjs`'s
 *  `maxPasses = initiatives.length + 2` for its own (larger) batches. */
const MAX_SERVE_PASSES = 3;

function log(msg) {
  process.stdout.write(`[d12-demo-runs] ${msg}\n`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * The spawn env for both Studio and `serve --once`: this run's own cost
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

/** `scripts/verify-cycle.mjs`'s own `bridgePost` — a generic POST + CSRF
 *  header + best-effort JSON parse. Not exported there, so copied verbatim
 *  rather than edited in. */
async function bridgePost(bridgeUrl, path, payload) {
  try {
    const res = await fetch(`${bridgeUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
      body: JSON.stringify(payload),
    });
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON */ }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 0, body: { error: err.message } };
  }
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
 *  live cycle). */
async function bootStudioStep(plan) {
  log('booting forge studio…');
  const studio = await spawnStudioReady({ fullEnv: buildSpawnEnv(plan), timeoutMs: STUDIO_TIMEOUT_MS, log: (s) => log(`[studio] ${s}`) });
  log(`studio ready: ui=${studio.uiUrl} bridge=${studio.bridgeUrl}`);
  return studio;
}

/** `POST /api/develop/start` via the SAME `createStageTwo` helper
 *  `scripts/verify-cycle-stage2.mjs` composes with — repoints the manifest
 *  at `forge-develop` and makes it claimable. Spawns nothing itself. */
async function handoffToDevelop(plan, bridgeUrl) {
  log(`hand-off — POST /api/develop/start [${plan.initiativeId}]…`);
  const stageTwo = createStageTwo({
    forgeRoot: plan.forgeRoot,
    flow: { flowId: 'forge-develop', door: 'develop-start' },
    flowReflects: false,
    bridgePost,
    log,
    sleep,
  });
  const results = await stageTwo.handoff(bridgeUrl, [plan.initiativeId]);
  log(`hand-off enqueued: cycle_id ${results[0]?.cycleId ?? '?'}`);
  return results[0];
}

/** One `forge serve --once` pass — spawned exactly as
 *  `scripts/verify-cycle.mjs`'s own (unexported) `startServe` does, with this
 *  run's cost-ceiling env. */
function spawnServeOnce(plan) {
  return spawn(process.execPath, ['--experimental-strip-types', 'apps/forge/cli.ts', 'serve', '--once'], {
    cwd: plan.forgeRoot,
    env: buildSpawnEnv(plan),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Manifest resting in `ready-for-review` or `failed` — the two outcomes this
 *  driver ever waits for (it never approves, so `merged`/`done` never happen). */
function developOutcomeState(plan) {
  const paths = getPaths(join(plan.forgeRoot, '_queue'));
  const filename = `${plan.initiativeId}.md`;
  if (existsSync(join(paths.readyForReview, filename))) return 'ready-for-review';
  if (existsSync(join(paths.failed, filename))) return 'failed';
  return null;
}

/**
 * Drive `forge serve --once` passes until the initiative parks at
 * `ready-for-review` (success) or `failed`, or `MAX_SERVE_PASSES` is spent.
 * Each pass's stdout+stderr is classified by `classifyServeStageOutcome`
 * (`scripts/verify-cycle-stage-outcome.mjs`) — imported, not re-implemented —
 * so a pass that printed a phase failure or no outcome at all is named, not
 * silently retried into a false "it worked eventually".
 */
async function waitForDevelopOutcome(plan) {
  for (let pass = 1; pass <= MAX_SERVE_PASSES; pass++) {
    log(`spawning forge serve --once (pass ${pass}/${MAX_SERVE_PASSES})…`);
    const proc = spawnServeOnce(plan);
    const captured = [];
    const cap = (d) => { for (const l of String(d).split('\n')) if (l.trim()) captured.push(l); };
    proc.stdout.on('data', cap);
    proc.stderr.on('data', cap);
    const exit = await new Promise((res) => {
      const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* gone */ } }, SERVE_ONCE_TIMEOUT_MS);
      proc.on('exit', (code) => { clearTimeout(timer); res(code); });
    });
    const outcome = classifyServeStageOutcome(captured);
    log(`serve --once (pass ${pass}) exited ${exit} — ${outcome.ok ? 'ok' : `FAILED: ${outcome.errors.join('; ')}`}`);

    const state = developOutcomeState(plan);
    if (state !== null) return { state, passes: pass, lastOutcome: outcome };
    if (!outcome.ok && pass === MAX_SERVE_PASSES) {
      return { state: 'timed-out', passes: pass, lastOutcome: outcome };
    }
  }
  return { state: 'timed-out', passes: MAX_SERVE_PASSES, lastOutcome: null };
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
  let report = { kind: plan.kind, mode: opts.dryRun ? 'dry-run' : 'live', initiativeId: plan.initiativeId, remoteName: plan.remoteName };
  try {
    provisionGround(plan);
    state.groundProvisioned = true;

    mintPrivateRemote(plan);
    state.remoteMinted = true;

    const handle = createInitiativeWorktree(plan);
    state.worktreeCreated = true; // the worktree dir exists now — teardown must own it even if the next line throws
    const written = writeHandoffArtifacts(plan, handle);

    state.studio = await bootStudioStep(plan);

    if (opts.dryRun) {
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

    const handoff = await handoffToDevelop(plan, state.studio.bridgeUrl);
    state.cycleId = handoff?.cycleId ?? null;
    const outcome = await waitForDevelopOutcome(plan);
    log(`develop outcome: ${outcome.state} (${outcome.passes} pass(es))`);

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
      servePasses: outcome.passes,
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
    const teardown = await runTeardown(plan, state, { keepRemote: opts.keepRemote });
    if (teardown.some((l) => !l.ok)) exitCode = 1;
    writeEvidenceReport(opts.reportPath, { ...report, teardown });
  }
  process.exitCode = exitCode;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2));
}

export { main, parseArgv, buildSpawnEnv };
