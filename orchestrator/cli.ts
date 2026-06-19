#!/usr/bin/env node
/**
 * forge CLI. Subcommands:
 *   forge serve [--once]                    run the scheduler
 *   forge cycle <initiative-id>             run one initiative end-to-end (foreground)
 *   forge enqueue <project> <spec>          drop a manifest into _queue/pending/
 *   forge enqueue --from-manifest <path>    validate + drop a pre-formed manifest
 *   forge enqueue --fixture                 drop a smoke-test fixture
 *   forge metrics [<cycle-id>]              print per-cycle aggregates (or all)
 *   forge preflight <project>               check the C1–C6 forge↔project contract
 *   forge brain index [--scope <project>]   emit the brain navigation indexes (cache-friendly prefix)
 *   forge brain lint  [--scope <s>]         structural integrity checks on brain/
 *   forge studio lint                       validate studio definitions (agents/flows/catalog/kb); exit non-zero on errors
 */

import { writeFileSync, appendFileSync, mkdirSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { basename, join, resolve } from 'node:path';
import { runCycle } from './cycle.ts';
import { serve } from './scheduler.ts';
import { findLatestLogDir } from '../cli/visualise.ts';
import { summariseCycle, summariseAll } from '../cli/metrics.ts';
import { getPaths } from './queue.ts';
import { parseManifest, validateManifest, writeManifest } from './manifest.ts';
import { loadBrainIndex, regenerateBrainIndex } from '../cli/brain-index.ts';
import { runBrainLint, type Scope as BrainLintScope } from '../cli/brain-lint.ts';
import { runStudioLint } from '../cli/studio-lint.ts';
import { runPreflight, formatPreflightReport, buildVerdictEvent } from '../cli/preflight.ts';
import { assertEnv } from './config.ts';
import { runInit, ensureLayout, type InitReport } from './init.ts';
import { writeCycleReport } from './cycle-report.ts';
import { resolveInitiativeId } from './initiative-id.ts';
import { projectDemoRelDir, readArtifactRoot } from './brain-paths.ts';
import {
  runArchitectTurn,
} from './architect-runner.ts';

const args = process.argv.slice(2);
const cmd = args[0];

// F-33: resolve all queue/log paths relative to the forge install root, NOT
// the user's CWD. Without this, `forge status` / `forge review` from inside
// `projects/<name>/` would look for `_queue/` under the project repo and
// silently miss the real one. The forge root is the parent of `orchestrator/`
// where this file sits.
const FORGE_ROOT = resolve(import.meta.dirname, '..');
// Capture the caller's working directory BEFORE we chdir to FORGE_ROOT. The
// demo subcommands resolve relative demo dirs against this (the agent invokes
// `forge demo render <id>` from its worktree, not from FORGE_ROOT). Without it,
// a relative `demo/<id>` would resolve under the forge install root.
const INVOCATION_CWD = process.cwd();
process.chdir(FORGE_ROOT);

(async () => {
  // F-10: surface env-setup issues at every CLI invocation (warn-only;
  // some setups — e.g., Claude Code — provide auth via credentials file).
  // Verbs that don't talk to the SDK (status, metrics, brain index, --help)
  // skip the warning to keep their output clean.
  const sdkVerbs = new Set(['serve', 'cycle']);
  if (cmd && sdkVerbs.has(cmd)) assertEnv('warn');

  switch (cmd) {
    case 'init':
      return cmdInit();
    case 'serve':
      return await cmdServe(args.slice(1));
    case 'cycle':
      return await cmdCycle(args.slice(1));
    case 'enqueue':
      return cmdEnqueue(args.slice(1));
    case 'metrics':
      return cmdMetrics(args.slice(1));
    case 'preflight':
      return cmdPreflight(args.slice(1));
    case 'review':
      return await cmdReview(args.slice(1));
    case 'report':
      return cmdReport(args.slice(1));
    case 'log':
      return cmdLog(args.slice(1));
    case 'demo':
      return await cmdDemo(args.slice(1));
    case 'brain':
      return cmdBrain(args.slice(1));
    case 'studio':
      return await cmdStudio(args.slice(1));
    // M7-5 (ADR-031): `architect` is INTERNAL — hidden from `forge --help` but
    // kept dispatchable because the UI bridge spawns `architect run <sid>` per
    // operator turn (spawnArchitectTurn in cli/ui-bridge.ts). Do NOT delete.
    case 'architect':
      return await cmdArchitect(args.slice(1));
    case 'requeue':
      return cmdRequeue(args.slice(1));
    case '--help':
    case '-h':
    case undefined:
      return cmdHelp();
    default:
      console.error(`unknown command: ${cmd}`);
      cmdHelp();
      process.exit(1);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

function cmdHelp(): void {
  console.log(
    `forge — autonomous multi-agent orchestrator

Usage:
  forge init                              Scaffold a runnable install (forge.config.json + _queue/ layout) and check the environment
  forge serve [--once]                    Run the scheduler in the foreground (or 'forge studio' to manage it from the UI)
  forge cycle <initiative-id>             Run one initiative end-to-end (foreground)
  forge enqueue <project> <spec>          Drop an initiative manifest into _queue/pending/
  forge enqueue --from-manifest <path>    Validate + drop a pre-formed manifest
  forge enqueue --fixture                 Drop a smoke-test fixture into _queue/pending/
  forge log <initiative> [--events|--tail N]
                                          Print the latest _logs/<timestamp>_<id>/ dir for an
                                          initiative. --events prints the events.jsonl path;
                                          --tail [N=20] prints the last N event lines.
  forge metrics [<cycle-id>]              Per-cycle aggregates (or all cycles)
  forge preflight <project>               Check the C1–C6 forge↔project contract (declines, naming the failing clause)
  forge review <init-id-or-handle> [--inspect | --abandon]
                                          Recovery for a stuck cycle in ready-for-review/. The verdict surface
                                          itself is the forge UI review screen (approve / send-back).
                                          --inspect shows the worktree/branch/PR state; --abandon moves it to
                                          failed/ and cleans up. Accepts INIT-…, handle proj#N, alias, or substring.
  forge report <cycle-id> [--regenerate]  Print (or regenerate) the human-facing cycle report
  forge demo render <initiative-id> [--dir <demoDir>]
                                          Render DEMO.md/DEMO.html from demo.json (unifier-authored)
  forge demo capture <initiative-id> [--project <name>] [--dir <demoDir>] [--base <ref>] [--changed <ref>]
                                          Capture before/after screenshots and back-fill demo.json
  forge brain index [--scope <project>]   Emit the brain navigation indexes as a single blob (cache-friendly prefix for prompts)
  forge brain index --write               Regenerate brain/INDEX.md from filesystem (counts + sub-wiki listing)
  forge brain lint [--scope <s>] [--fix]  Structural integrity checks on brain/ (8 checks, scopes: full|forge-only|project-only|single-file|cycle-touched-themes|cleanup-dry-run)
  forge studio lint                       Validate studio definitions (agents/flows/catalog/kb); exit non-zero on errors
  forge studio [--bridge-only] [--no-open] [--bridge-port <n>] [--ui-port <n>] [--ready-file <path>]
                                          Bring up the forge operator UI (foreground; Ctrl-C quits).
                                          Defaults: bridge=4123, ui=4124 (fixed ports — re-runs take over
                                          any previous forge process so a pinned browser tab auto-reconnects).
                                          Health-probes the bridge then the UI before opening the browser, then
                                          emits a deterministic 'forge-studio-ready {json}' line (or --ready-file).
  forge requeue <init-or-handle> [--reset-retries]
                                          Recover a stuck initiative: move manifest back to pending/,
                                          remove stranded verdict files + worktree, append a marker to
                                          previous_failure_modes. --reset-retries zeros retry_count.

For phase-implementation guidance see docs/phases/. For decisions see docs/decisions/.`,
  );
}

function cmdInit(): void {
  console.log('forge init: scaffolding a runnable forge install…\n');
  const report: InitReport = runInit(FORGE_ROOT);

  if (report.created.length > 0) {
    console.log('Created:');
    for (const p of report.created) console.log(`  + ${p}`);
  } else {
    console.log('Layout + config already present — nothing to create.');
  }

  if (report.envIssues.length > 0) {
    console.log('\nEnvironment:');
    for (const i of report.envIssues) console.log(`  ! ${i}`);
  }

  console.log('\nNext steps:');
  for (const h of report.hints) console.log(`  → ${h}`);
}

async function cmdServe(rest: string[]): Promise<void> {
  const once = rest.includes('--once');
  console.log(once ? 'forge serve --once: claiming one initiative…' : 'forge serve: starting…');
  await serve({ mode: once ? 'once' : 'forever' });
  if (once) {
    // Once-mode is the showcase / debug entry point — surface the most
    // recent cycle's report path as a breadcrumb. The forever-mode
    // operator's monitor (or `forge metrics`) is the right place for
    // ongoing visibility, so we only print this for `--once`.
    printLatestReportHint();
    // Everything serve() does for `--once` is already awaited + flushed by
    // the time we reach here, but the Claude Agent SDK / child phases leave
    // open handles (sockets, stdio pipes) that keep the Node event loop
    // alive — so the process hangs after `cycle pr-open` instead of exiting.
    // Force a clean exit. ONLY for once-mode: forever-mode runs until SIGINT
    // and must NOT force-exit (it has work still to drain).
    process.exit(0);
  }
}

// M7-5 (ADR-031): `forge start` / `stop` / `pause` / `resume` / `status` were
// removed — the Studio UI bridge is the operator API now. The daemon-spawn
// logic moved to `spawnServeDetached` in orchestrator/daemon.ts (called by the
// bridge's POST /api/scheduler/start); pause/resume/stop/status are bridge
// routes that call the shared daemon helpers directly.

function printLatestReportHint(): void {
  const logsRoot = resolve('_logs');
  if (!existsSync(logsRoot)) return;
  let newest: { cycleId: string; mtimeMs: number } | null = null;
  let entries: string[] = [];
  try {
    entries = readdirSync(logsRoot);
  } catch {
    return;
  }
  for (const name of entries) {
    const reportPath = join(logsRoot, name, 'report.md');
    if (!existsSync(reportPath)) continue;
    try {
      const st = statSync(reportPath);
      if (!newest || st.mtimeMs > newest.mtimeMs) {
        newest = { cycleId: name, mtimeMs: st.mtimeMs };
      }
    } catch {
      /* skip */
    }
  }
  if (!newest) return;
  const reportPath = resolve(logsRoot, newest.cycleId, 'report.md');
  console.log('');
  console.log(`📄 Cycle report: ${reportPath}`);
  console.log(`   View: forge report ${newest.cycleId}`);
}

async function cmdCycle(rest: string[]): Promise<void> {
  const initiativeId = rest[0];
  const dryRun = rest.includes('--dry-run');
  if (!initiativeId) {
    console.error('forge cycle: missing <initiative-id>');
    process.exit(2);
  }
  // For dry runs, we can synthesise paths; for real runs the manifest must
  // exist in _queue/in-flight/.
  const paths = getPaths();
  const manifestPath = join(paths.inFlight, `${initiativeId}.md`);
  const projectRepoPath = resolve('projects', initiativeId);
  const worktreePath = resolve('_worktrees', initiativeId);
  const result = await runCycle({
    initiativeId,
    manifestPath,
    projectRepoPath,
    worktreePath,
    dryRun,
  });
  console.log(JSON.stringify(result, null, 2));
  // Same breadcrumb as `forge serve --once`: surface the report path so
  // the operator doesn't have to know the cycle-id naming convention.
  printLatestReportHint();
}

function cmdEnqueue(rest: string[]): void {
  const paths = getPaths();
  if (!existsSync(paths.pending)) mkdirSync(paths.pending, { recursive: true });

  if (rest[0] === '--from-manifest') {
    const src = rest[1];
    if (!src) {
      console.error('forge enqueue --from-manifest: missing <path>');
      process.exit(2);
    }
    if (!existsSync(src)) {
      console.error(`forge enqueue --from-manifest: file not found: ${src}`);
      process.exit(2);
    }
    const manifest = parseManifest(readFileSync(src, 'utf8'));
    const errors = validateManifest(manifest);
    if (errors.length > 0) {
      console.error(`forge enqueue --from-manifest: invalid manifest:\n  - ${errors.join('\n  - ')}`);
      process.exit(2);
    }
    const out = writeManifest(manifest);
    console.log(`enqueued: ${out}`);
    return;
  }

  if (rest[0] === '--fixture') {
    // Bootstrap a tiny throwaway git repo at projects/fixture/ so the scheduler
    // can `git worktree add` against it and complete the (no-op) cycle, ending
    // up in _queue/ready-for-review/ instead of failing on missing-repo.
    const fixtureRepo = resolve('projects', 'fixture');
    if (!existsSync(fixtureRepo)) {
      mkdirSync(fixtureRepo, { recursive: true });
      execSync(
        `git -C "${fixtureRepo}" init -q -b main && \
         git -C "${fixtureRepo}" -c user.email=fixture@forge -c user.name=fixture commit -q --allow-empty -m "fixture: initial"`,
        { stdio: 'pipe' },
      );
    }
    const id = `INIT-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-fixture`;
    const manifest = `---
initiative_id: ${id}
project: fixture
project_repo_path: ${fixtureRepo}
created_at: ${new Date().toISOString()}
iteration_budget: 5
cost_budget_usd: 1.00
phase: pending
---

# Fixture initiative

Given the scheduler runs, when this fixture initiative is processed, then no real work is performed.
`;
    const out = join(paths.pending, `${id}.md`);
    writeFileSync(out, manifest);
    console.log(`enqueued: ${out}`);
    return;
  }

  const project = rest[0];
  const specPath = rest[1];
  if (!project || !specPath) {
    console.error('forge enqueue: usage: enqueue <project> <spec-path> | enqueue --fixture');
    process.exit(2);
  }
  const id = `INIT-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${project}`;
  const body = readFileSync(specPath, 'utf8');
  const manifest = `---
initiative_id: ${id}
project: ${project}
created_at: ${new Date().toISOString()}
iteration_budget: 50
cost_budget_usd: 25.00
phase: pending
---

${body}`;
  const out = join(paths.pending, `${id}.md`);
  writeFileSync(out, manifest);
  console.log(`enqueued: ${out}`);
}

/**
 * S1.1 helper: take any operator-typed `<id>` (canonical | handle | name |
 * unique substring) and produce the canonical id. On ambiguity print all
 * matches + exit 2 per plan 07b. On `not-found` for a non-canonical input,
 * exit 2 with a friendly message. Canonical inputs are accepted even if the
 * registry doesn't know them yet (so existing manifests pre-backfill work).
 */
function resolveOrExit(input: string, verb: string): string {
  const r = resolveInitiativeId(input);
  if (r.kind === 'ok') return r.canonical;
  if (r.kind === 'ambiguous') {
    console.error(`forge ${verb}: "${input}" matched multiple initiatives:`);
    for (const m of r.matches) console.error(`  ${m}`);
    console.error('Specify a more specific handle, name, or full canonical id.');
    process.exit(2);
  }
  console.error(`forge ${verb}: no initiative resolved from "${input}".`);
  console.error('Tried: canonical exact, handle (proj#N), name alias, unique substring.');
  console.error('Run `forge status` to list active IDs.');
  process.exit(2);
}

async function cmdReview(rest: string[]): Promise<void> {
  const rawId = rest[0];
  if (!rawId) {
    console.error('forge review: missing <initiative-id-or-handle>');
    console.error('Usage: forge review <initiative-id-or-handle> [--inspect | --abandon]');
    process.exit(2);
  }
  const initiativeId = resolveOrExit(rawId, 'review');
  // F-31 recovery sub-commands. The APPROVE path was removed in M7-5
  // (ADR-031): approval is the Studio UI review screen's job (bridge POST
  // /api/verdict, whose approve is a strict superset of the old CLI merge).
  // What stays here is read-only/recovery — the operator needs to
  // (a) see what was committed without reading events.jsonl (--inspect),
  // (b) abandon a stuck initiative cleanly — move to failed/, drop worktree (--abandon).
  if (rest.includes('--inspect')) return cmdReviewInspect(initiativeId);
  if (rest.includes('--abandon')) return cmdReviewAbandon(initiativeId);

  // Default: the file-verdict transport has been removed. Direct the operator
  // to the UI review screen, which is the sole verdict surface.
  console.error(`forge review: the file-verdict transport is no longer supported.`);
  console.error(`Use the forge UI review screen to submit a verdict (approve / send-back):`);
  console.error(`  http://localhost:4124/review/${initiativeId}`);
  console.error('');
  console.error('Recovery commands for stuck initiatives:');
  console.error(`  forge review ${initiativeId} --inspect    show worktree state, branch, PR draft`);
  console.error(`  forge review ${initiativeId} --abandon    move to failed/ and clean up worktree`);
  return;
}

/**
 * F-31: show what's actually in the preserved worktree for a stuck cycle.
 * Reads the manifest's worktree_path annotation, lists branch + commits +
 * diff stat + PR draft existence. Read-only — no state changes.
 */
function cmdReviewInspect(initiativeId: string): void {
  const queuePaths = getPaths();
  const located = locateInitiative(initiativeId, queuePaths);
  if (!located) {
    console.error(`forge review --inspect: no manifest found for ${initiativeId} in any queue dir`);
    process.exit(2);
  }
  console.log(`Initiative: ${initiativeId}`);
  console.log(`Manifest:   ${located.path} (${located.state})`);
  const m = parseManifest(readFileSync(located.path, 'utf8'));
  const wt = (m as { worktree_path?: string }).worktree_path;
  if (!wt) {
    console.log('Worktree:   (none — manifest has no worktree_path annotation)');
    return;
  }
  console.log(`Worktree:   ${wt}`);
  if (!existsSync(wt)) {
    console.log('             (path does not exist — branch was cleaned up)');
    return;
  }
  const branch = `forge/${initiativeId}`;
  console.log(`Branch:     ${branch}`);
  console.log('');
  try {
    const commits = execSync(
      `git -C "${wt}" log --no-color --format='%h %s' -n 20 main..HEAD 2>/dev/null`,
      { encoding: 'utf8' },
    );
    console.log('Commits (main..HEAD):');
    console.log(commits || '  (none)');
  } catch {
    console.log('Commits: (could not read git log)');
  }
  try {
    const stat = execSync(`git -C "${wt}" diff --stat main...HEAD 2>/dev/null`, { encoding: 'utf8' });
    console.log('Diff stat (main...HEAD):');
    console.log(stat || '  (none)');
  } catch {
    /* ignore */
  }
  const prPath = join(wt, '.forge', 'pr-description.md');
  if (existsSync(prPath)) {
    const pr = readFileSync(prPath, 'utf8');
    console.log(`PR draft:   ${prPath} (${pr.length} chars)`);
    console.log('--- PR description (first 60 lines) ---');
    console.log(pr.split('\n').slice(0, 60).join('\n'));
  } else {
    console.log('PR draft:   (none)');
  }
}

// M7-5 (ADR-031): `forge review --approve` (cmdReviewApprove) +
// invokeReflectorPostApprove were removed. Approval — merge the PR + finalize
// + reflect — now lives behind the Studio UI review screen's bridge POST
// /api/verdict (applyReviewVerdict in cli/bridge-studio-runs.ts), whose
// approve path is a strict superset of the deleted CLI merge (ADR-021/023).
// The no-auto-approve invariant (ADR-023) is unchanged: approval still
// requires an explicit operator UI click (or the verify-cycle harness's
// deliberate POST /api/verdict approve).

/**
 * F-31: move a stuck initiative to failed/ and clean up worktree + branch.
 * Used when the human decides the work is unrecoverable; clears state so the
 * scheduler can move on (and downstream initiatives that depend on this one
 * stay blocked, which is correct).
 */
function cmdReviewAbandon(initiativeId: string): void {
  const queuePaths = getPaths();
  const located = locateInitiative(initiativeId, queuePaths);
  if (!located) {
    console.error(`forge review --abandon: no manifest found for ${initiativeId}`);
    process.exit(2);
  }
  const m = parseManifest(readFileSync(located.path, 'utf8'));
  const wt = (m as { worktree_path?: string }).worktree_path;
  const projectRepoPath = m.project_repo_path;
  const branch = `forge/${initiativeId}`;
  if (projectRepoPath && existsSync(projectRepoPath)) {
    if (wt && existsSync(wt)) {
      try {
        execSync(`git -C "${projectRepoPath}" worktree remove --force "${wt}"`, { stdio: 'pipe' });
      } catch { /* ignore */ }
    }
    try {
      execSync(`git -C "${projectRepoPath}" branch -D "${branch}"`, { stdio: 'pipe' });
    } catch { /* ignore — branch never created or already deleted */ }
    // 2026-05-23 dogfood pushback: an abandon that doesn't clean the
    // REMOTE branch leaves stale origin refs that block the next cycle's
    // push (non-fast-forward). Delete the remote branch too. Best-effort
    // — projects without origin / branches never pushed silently skip.
    try {
      execSync(`git -C "${projectRepoPath}" push origin --delete "${branch}"`, { stdio: 'pipe' });
    } catch { /* ignore — no remote / never pushed / already deleted */ }
  }
  const failedTarget = join(queuePaths.failed, basename(located.path));
  execSync(`mv "${located.path}" "${failedTarget}"`);
  // Best-effort: drop any legacy file-verdict prompt + response (pre-removal residue).
  const queueRootForAbandon = getPaths().root;
  const inFlightForAbandon = resolve(queueRootForAbandon, 'in-flight');
  for (const suffix of ['.verdict-prompt.md', '.verdict-response.md']) {
    const p = resolve(inFlightForAbandon, `${initiativeId}${suffix}`);
    if (existsSync(p)) {
      try { execSync(`rm "${p}"`); } catch { /* ignore */ }
    }
  }
  console.log(`Abandoned ${initiativeId}. Manifest at ${failedTarget}; worktree + branch cleaned up.`);
}

/**
 * Helper: find a manifest by initiative_id across pending/in-flight/
 * ready-for-review/done/failed. Returns the path + queue state.
 */
function locateInitiative(
  initiativeId: string,
  paths: ReturnType<typeof getPaths>,
): { path: string; state: 'pending' | 'in-flight' | 'ready-for-review' | 'done' | 'failed' } | null {
  const states: Array<{ dir: string; state: 'pending' | 'in-flight' | 'ready-for-review' | 'done' | 'failed' }> = [
    { dir: paths.pending, state: 'pending' },
    { dir: paths.inFlight, state: 'in-flight' },
    { dir: paths.readyForReview, state: 'ready-for-review' },
    { dir: paths.done, state: 'done' },
    { dir: paths.failed, state: 'failed' },
  ];
  for (const { dir, state } of states) {
    const candidate = join(dir, `${initiativeId}.md`);
    if (existsSync(candidate)) return { path: candidate, state };
  }
  return null;
}

function cmdReport(rest: string[]): void {
  const cycleId = rest[0];
  if (!cycleId) {
    console.error('forge report: missing <cycle-id>');
    console.error('Usage: forge report <cycle-id> [--regenerate]');
    console.error('Run `forge metrics` to list cycle IDs.');
    process.exit(2);
  }
  const reportPath = join('_logs', cycleId, 'report.md');
  const regenerate = rest.includes('--regenerate') || !existsSync(reportPath);
  if (regenerate) {
    try {
      writeCycleReport({ cycleId });
    } catch (err) {
      console.error(`forge report: failed to generate: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  }
  if (!existsSync(reportPath)) {
    console.error(`forge report: no report at ${reportPath}`);
    process.exit(1);
  }
  process.stdout.write(readFileSync(reportPath, 'utf8'));
}

/**
 * 2026-05-25: print the latest `_logs/<timestamp>_<initiativeId>/`
 * directory for a given initiative. Defensive against the stale-log
 * trap — when a cycle has been retried, `_logs/` has multiple matching
 * dirs and grepping by initiative name picks an arbitrary one. This
 * always resolves to the freshest by mtime.
 *
 * Usage:
 *   forge log <initiative-id-or-handle>     prints the latest log dir
 *   forge log <id> --events                  prints `<dir>/events.jsonl`
 *   forge log <id> --tail [N]                tails the last N lines of events.jsonl (default 20)
 */
function cmdLog(rest: string[]): void {
  const rawId = rest[0];
  if (!rawId) {
    console.error('forge log: missing <initiative-id-or-handle>');
    console.error('Usage: forge log <initiative-id-or-handle> [--events | --tail [N]]');
    process.exit(2);
  }
  const initiativeId = resolveOrExit(rawId, 'log');
  const dir = findLatestLogDir(initiativeId);
  if (!dir) {
    console.error(`forge log: no cycle log found for ${initiativeId} under _logs/`);
    process.exit(1);
  }
  const eventsPath = join(dir, 'events.jsonl');
  if (rest.includes('--events')) {
    console.log(eventsPath);
    return;
  }
  const tailIdx = rest.indexOf('--tail');
  if (tailIdx >= 0) {
    const nRaw = rest[tailIdx + 1];
    const n = nRaw && /^\d+$/.test(nRaw) ? Number(nRaw) : 20;
    if (!existsSync(eventsPath)) {
      console.error(`forge log: events.jsonl missing at ${eventsPath}`);
      process.exit(1);
    }
    const lines = readFileSync(eventsPath, 'utf8').split('\n').filter((l) => l.length > 0);
    for (const line of lines.slice(-n)) console.log(line);
    return;
  }
  console.log(dir);
}

function flagValue(rest: string[], flag: string): string | undefined {
  const i = rest.indexOf(flag);
  if (i < 0) return undefined;
  const v = rest[i + 1];
  // A flag immediately followed by another --flag (or nothing) means the
  // value was omitted — treat as absent rather than silently consuming the
  // next flag's name as the value.
  if (v === undefined || v.startsWith('--')) {
    console.error(`forge demo: ${flag} expects a value`);
    process.exit(2);
  }
  return v;
}

async function cmdDemo(rest: string[]): Promise<void> {
  // ADR 021: `forge demo render <init>` derives DEMO.md + DEMO.html from the
  // unifier-authored `demo/<init>/demo.json`. Run from the worktree root (or
  // pass --dir). The unifier authors demo.json once and runs this to emit the
  // committed derived artifacts.
  if (rest[0] === 'render') {
    const initiativeId = rest[1];
    if (!initiativeId) {
      console.error('forge demo render: usage: demo render <initiative-id> [--dir <demoDir>]');
      process.exit(2);
    }
    // Resolve the demo dir against the caller's worktree (INVOCATION_CWD), honouring
    // the project's artifactRoot (legacy `demo/<id>` or `<artifactRoot>/history/<id>/demo`).
    // An explicit --dir overrides; otherwise the worktree root is INVOCATION_CWD.
    const dirFlag = flagValue(rest, '--dir');
    const artifactRoot = readArtifactRoot(INVOCATION_CWD);
    const demoDir = dirFlag ?? resolve(INVOCATION_CWD, projectDemoRelDir(initiativeId, artifactRoot));
    const worktreeRoot = dirFlag ? resolve(dirFlag, '..', '..') : INVOCATION_CWD;
    const { renderDemoBundle } = await import('../cli/demo-model.ts');
    // worktree root lets the bundle back-fill any live evidence the acceptance
    // test persisted under <worktree>/.forge/live-evidence/.
    const res = renderDemoBundle(demoDir, new Date().toISOString(), worktreeRoot);
    if (!res.ok) {
      console.error(`forge demo render: invalid demo.json in ${demoDir}:`);
      for (const e of res.errors) console.error(`  - ${e}`);
      process.exit(1);
    }
    for (const p of res.wrote) console.log(`wrote ${p}`);
    return;
  }

  // ADR 021: `forge demo capture <init>` is the media-capture skill's engine —
  // it runs the two-worktree + Playwright before/after capture and back-fills
  // the captured images into the unifier's demo.json, then re-renders the
  // bundle. Best-effort: any failure leaves demo.json notes-only and exits 0
  // (capture must never fail a cycle).
  if (rest[0] === 'capture') {
    const initiativeId = rest[1];
    if (!initiativeId) {
      console.error('forge demo capture: usage: demo capture <initiative-id> [--project <name>] [--dir <demoDir>] [--base <ref>] [--changed <ref>]');
      process.exit(2);
    }
    const projectArg = flagValue(rest, '--project');
    const projectRepoPath = projectArg ? resolve('projects', projectArg) : INVOCATION_CWD;
    const dirFlag = flagValue(rest, '--dir');
    const artifactRoot = readArtifactRoot(projectRepoPath);
    const demoDir = dirFlag ?? resolve(projectRepoPath, projectDemoRelDir(initiativeId, artifactRoot));
    const jsonPath = join(demoDir, 'demo.json');
    if (!existsSync(jsonPath)) {
      console.error(`forge demo capture: ${jsonPath} not found — author demo.json first. Skipping (best-effort).`);
      return;
    }
    const baseRef = flagValue(rest, '--base') ?? 'main';
    const changedRef = flagValue(rest, '--changed') ?? 'HEAD';
    try {
      const { captureCheckpoints } = await import('../cli/demo.ts');
      const { collectCapturedMedia, mergeCapturedMedia, renderDemoBundle } = await import('../cli/demo-model.ts');
      const bundleDir = join(demoDir, '.capture');
      const demoJson = JSON.parse(readFileSync(jsonPath, 'utf8'));
      const labels = (demoJson?.checkpoints ?? []).map((c: { label?: string }) => c.label).filter(Boolean) as string[];
      await captureCheckpoints({ projectRepoPath, project: projectArg ?? '(local)', baseRef, changedRef, bundleDir, initiativeId, checkpointLabels: labels, build: true });
      const captured = collectCapturedMedia(bundleDir);
      const merged = mergeCapturedMedia(JSON.parse(readFileSync(jsonPath, 'utf8')), captured);
      writeFileSync(jsonPath, JSON.stringify(merged, null, 2));
      const r = renderDemoBundle(demoDir, new Date().toISOString(), projectRepoPath);
      console.log(`forge demo capture: merged ${captured.length} captured checkpoint(s); ${r.ok ? 'rendered DEMO.md/DEMO.html' : 'render failed: ' + r.errors.join('; ')}`);
    } catch (err) {
      console.error(`forge demo capture: best-effort capture failed (${err instanceof Error ? err.message : String(err)}); demo.json left notes-only.`);
    }
    return; // never a hard failure
  }

  console.error('forge demo: usage: demo render <initiative-id> [--dir <demoDir>]');
  console.error('       or: demo capture <initiative-id> [--project <name>] [--dir <demoDir>] [--base <ref>] [--changed <ref>]');
  process.exit(2);
}

/**
 * US-4.1 / ADR-017: check the C1–C6 forge↔project contract. The argument
 * is a project name (resolved under `projects/<name>/`) or an explicit
 * path. Prints a per-clause PASS/FAIL/WARN report and exits non-zero iff a
 * HARD clause (C1/C2/C4) fails — so an unattended caller can gate on it.
 */
function cmdPreflight(rest: string[]): void {
  const target = rest[0];
  if (!target) {
    console.error('forge preflight: missing <project>');
    console.error('Usage: forge preflight <project-name | path>');
    process.exit(2);
  }
  // Accept either an explicit path or a managed-project name.
  const asPath = resolve(target);
  const asManaged = resolve('projects', target);
  const projectDir = existsSync(asPath) && statSync(asPath).isDirectory()
    ? asPath
    : asManaged;
  if (!existsSync(projectDir)) {
    console.error(`forge preflight: project directory not found: ${projectDir}`);
    console.error('Pass a directory under projects/ or an absolute path.');
    process.exit(2);
  }
  const report = runPreflight(projectDir, { forgeRoot: FORGE_ROOT });
  console.log(formatPreflightReport(report));
  // CON-5: write the verdict event as JSONL so callers can audit preflight outcomes.
  const verdictLogDir = join(FORGE_ROOT, '_logs', 'preflight');
  mkdirSync(verdictLogDir, { recursive: true });
  appendFileSync(join(verdictLogDir, 'verdicts.jsonl'), JSON.stringify(buildVerdictEvent(report)) + '\n');
  // Hard-clause failure ⇒ forge declines (non-zero so callers can gate).
  process.exit(report.ok ? 0 : 1);
}

function cmdMetrics(rest: string[]): void {
  if (rest[0]) {
    console.log(JSON.stringify(summariseCycle(rest[0]), null, 2));
  } else {
    console.log(JSON.stringify(summariseAll(), null, 2));
  }
}

function cmdBrain(rest: string[]): void {
  const sub = rest[0];
  if (sub === 'index') return cmdBrainIndex(rest.slice(1));
  if (sub === 'lint') return cmdBrainLint(rest.slice(1));
  console.error('forge brain: subcommands: index | lint');
  process.exit(2);
}

function cmdBrainIndex(rest: string[]): void {
  const write = rest.includes('--write');
  if (write) {
    const result = regenerateBrainIndex({ cwd: FORGE_ROOT, write: true });
    console.log(
      `brain-index: ${result.changed ? 'updated' : 'unchanged'} ${result.path}\n` +
        `  ${result.stats.cyclesThemeCount} cycles themes, ` +
        `${result.stats.forgeDevThemeCount} forge-dev themes, ` +
        `${result.stats.projectThemeCount} project themes, ` +
        `${result.stats.rawCount} raw sources, ` +
        `${result.stats.projects.length} sub-wikis`,
    );
    return;
  }
  // Default: legacy prompt-prefix loader behaviour (`--scope <project>`).
  const scopeIdx = rest.indexOf('--scope');
  const scope = scopeIdx >= 0 ? rest[scopeIdx + 1] ?? null : null;
  process.stdout.write(loadBrainIndex({ scope }) + '\n');
}

function cmdBrainLint(rest: string[]): void {
  // Parse flags. Mirror the standalone brain-lint.ts CLI but wire through the
  // forge CLI so the operator types `forge brain lint ...`.
  let scope: BrainLintScope = 'full';
  let project: string | undefined;
  let file: string | undefined;
  let cycle: string | undefined;
  let fix = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--scope') {
      const v = rest[++i];
      const allowed: BrainLintScope[] = [
        'full',
        'forge-only',
        'project-only',
        'single-file',
        'cycle-touched-themes',
        'cleanup-dry-run',
      ];
      if (!allowed.includes(v as BrainLintScope)) {
        console.error(`forge brain lint: unknown --scope: ${v}`);
        process.exit(2);
      }
      scope = v as BrainLintScope;
    } else if (a === '--project') {
      project = rest[++i];
    } else if (a === '--file') {
      file = rest[++i];
    } else if (a === '--cycle') {
      cycle = rest[++i];
    } else if (a === '--fix') {
      fix = true;
    }
  }
  const result = runBrainLint({ cwd: FORGE_ROOT, scope, project, file, cycle, fix });

  const errors = result.findings.filter((f) => f.category === 'error');
  const flags = result.findings.filter((f) => f.category === 'flag');
  const fixes = result.findings.filter((f) => f.category === 'auto-fix');
  for (const [label, group] of [
    ['ERRORS', errors],
    ['FLAGS', flags],
    ['AUTO-FIXES', fixes],
  ] as const) {
    if (group.length === 0) continue;
    console.log(`## ${label} (${group.length})`);
    for (const f of group) {
      const relPath = f.file.startsWith(FORGE_ROOT)
        ? f.file.slice(FORGE_ROOT.length + 1)
        : f.file;
      console.log(`- [${f.check ?? 'check'}] ${relPath}: ${f.message}`);
    }
    console.log('');
  }
  console.log(
    `Summary: ${errors.length} error(s), ${flags.length} flag(s), ${fixes.length} auto-fix(es).`,
  );
  process.exit(result.exitCode);
}

// ---------------------------------------------------------------------------
// forge studio lint
//
// Validates all Forge Studio definitions (agents, flows, catalog, projects, kb).
// Mirrors brain-lint output style: errors then flags, then summary line,
// exit 1 on errors, exit 2 on usage error.
// ---------------------------------------------------------------------------

// `forge studio` is a dual-mode dispatcher (M7-6, ADR-031):
//   - `forge studio lint`           → validate studio definitions (preserved)
//   - `forge studio [launcher flags]` → launch the operator UI (NEW canonical)
// The bare form (no subcommand) and any leading `--flag` mean "launch"; only
// the explicit `lint` subcommand routes to the validator.
async function cmdStudio(rest: string[]): Promise<void> {
  const sub = rest[0];
  if (sub === 'lint') return cmdStudioLint();
  if (!sub || sub.startsWith('-')) return await cmdStudioLauncher(rest);
  console.error('forge studio: subcommands: lint | [launcher flags]');
  console.error('  forge studio                 Launch the operator UI (bridge + Next.js dev)');
  console.error('  forge studio lint            Validate studio definitions');
  process.exit(2);
}

/** Parse the shared launcher flags and bring up the operator UI. Used by the
 *  canonical `forge studio` and the deprecated `forge watch` alias. */
async function cmdStudioLauncher(rest: string[], logLabel = '[forge studio]'): Promise<void> {
  // Preflight (J1): surface a missing API key (the SDK-verbs warning didn't
  // cover `studio`) and ensure the queue/log layout exists so the bridge's
  // architect-start has somewhere to write — idempotent, never throws.
  assertEnv('warn');
  try {
    ensureLayout(FORGE_ROOT);
  } catch (err) {
    console.warn(`${logLabel} preflight layout check skipped: ${(err as Error).message}`);
  }

  const { runWatch, isValidPort } = await import('../cli/forge-watch.ts');
  const parsePortFlag = (raw: string | undefined, flag: string): number => {
    if (!isValidPort(raw)) {
      console.error(`forge studio: ${flag} requires a valid port number (1-65535)`);
      process.exit(2);
    }
    return Number(raw);
  };
  const opts: {
    bridgeOnly?: boolean; bridgePort?: number; uiPort?: number;
    noOpen?: boolean; readyFile?: string;
  } = {};
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--bridge-only') opts.bridgeOnly = true;
    else if (a === '--no-open') opts.noOpen = true;
    else if (a === '--bridge-port') opts.bridgePort = parsePortFlag(rest[++i], '--bridge-port');
    else if (a === '--ui-port') opts.uiPort = parsePortFlag(rest[++i], '--ui-port');
    else if (a === '--ready-file') opts.readyFile = rest[++i];
    else if (a === '--help' || a === '-h') {
      console.log(`forge studio [--bridge-only] [--no-open] [--bridge-port <n>] [--ui-port <n>] [--ready-file <path>]
  Bring up the forge operator UI at http://localhost:4124 (foreground; Ctrl-C quits).
  Awaits a health probe on the bridge then the UI before opening the browser,
  then emits a deterministic 'forge-studio-ready {json}' line on stdout.
  Re-runs take over any prior forge process on the fixed ports so a pinned
  browser tab auto-reconnects via WebSocket backoff.
    --bridge-only  Run only the WebSocket bridge (no Next.js dev server).
    --no-open      Skip launching the browser.
    --bridge-port  HTTP/WS port for the bridge (default: 4123).
    --ui-port      Port for the Next.js dev server (default: 4124).
    --ready-file   Atomically write the ready-info JSON to this path on readiness.`);
      return;
    } else {
      console.error(`forge studio: unknown option ${a}`);
      process.exit(2);
    }
  }
  await runWatch({ forgeRoot: FORGE_ROOT, logLabel, ...opts });
}

function cmdStudioLint(): void {
  const result = runStudioLint(FORGE_ROOT);

  const errors = result.findings.filter((f) => f.level === 'error');
  const flags = result.findings.filter((f) => f.level === 'flag');

  for (const [label, group] of [
    ['ERRORS', errors],
    ['FLAGS', flags],
  ] as const) {
    if (group.length === 0) continue;
    console.log(`## ${label} (${group.length})`);
    for (const f of group) {
      console.log(`- [${f.check}] ${f.object}: ${f.message}`);
    }
    console.log('');
  }

  console.log(`Summary: ${result.errorCount} error(s), ${result.flagCount} flag(s).`);
  if (result.errorCount > 0) process.exit(1);
}

// ---------------------------------------------------------------------------
// forge architect run <session-id>
//
// ADR 020/023: the architect runs in the forge UI. The bridge spawns
// `forge architect run` per operator turn (interview → draft → finalize);
// the runner's finalize promotes manifests to the queue. The legacy
// out-of-cycle `forge architect commit` CLI + `/forge-architect` slash were
// retired (UI is the sole operator surface).
// ---------------------------------------------------------------------------

async function cmdArchitect(rest: string[]): Promise<void> {
  const sub = rest[0];
  if (sub === 'run') return await cmdArchitectRun(rest.slice(1));
  console.error('forge architect: subcommands: run <session-id>');
  console.error('  forge architect run <session-id> [--project <name>]');
  console.error('  (the architect runs in the forge UI — see ADR 020/023; the bridge spawns this per turn)');
  process.exit(2);
}

function cmdRequeue(rest: string[]): void {
  const initInput = rest.find((a) => !a.startsWith('--'));
  const resetRetries = rest.includes('--reset-retries');
  // ADR 019 (amended by ADR 026): --resume-from=unifier (or --resume-from
  // <mode>) resumes the next cycle against the PRESERVED worktree instead of a
  // full re-run. The `developer` mode was retired with ADR 026.
  const resumeIdx = rest.findIndex((a) => a === '--resume-from' || a.startsWith('--resume-from='));
  let resumeFromUnifier = false;
  if (resumeIdx !== -1) {
    const arg = rest[resumeIdx];
    const value = arg.includes('=') ? arg.split('=')[1] : rest[resumeIdx + 1];
    if (value === 'unifier') resumeFromUnifier = true;
    else {
      console.error(`forge requeue: --resume-from only supports 'unifier' (got '${value ?? ''}')`);
      process.exit(2);
    }
  }
  if (rest.includes('--help') || rest.includes('-h') || !initInput) {
    console.log(`forge requeue <init-id-or-handle> [--reset-retries] [--resume-from=unifier]
  Recover a stuck initiative back to the pending queue. Idempotent.
  Moves manifest from any queue dir → _queue/pending/, deletes stranded
  verdict files, removes the worktree, and (optionally) resets
  retry_count to 0. Appends a 'requeued-from-<dir>-<date>' marker to
  previous_failure_modes for the forensic trail.
    --reset-retries          Set retry_count to 0 (default: preserve prior count).
    --resume-from=unifier    Resume from the unifier sub-phase (ADR 019): skip
                             PM + per-WI dev-loop and PRESERVE the worktree so
                             the salvaged WI commits drive the resumed unifier.`);
    if (!initInput) process.exit(2);
    return;
  }
  void import('../cli/forge-requeue.ts').then(({ runRequeue }) => {
    try {
      const r = runRequeue(initInput, { forgeRoot: FORGE_ROOT, resetRetries, resumeFromUnifier });
      const resumeNote = resumeFromUnifier ? ' (resume-from=unifier)' : '';
      console.log(`requeued ${r.initiativeId}${resumeNote}`);
      console.log(`  from: ${r.fromQueueDir}/ → pending/`);
      console.log(`  worktree removed: ${r.worktreeRemoved}`);
      console.log(`  branch deleted (fresh-from-main on re-run): ${r.branchDeleted}`);
      console.log(`  verdict files removed: ${r.verdictsRemoved.length}`);
      console.log(`  retry_count: ${r.retryCountBefore} → ${r.retryCountAfter}`);
      console.log(`  previous_failure_modes: ${r.previousFailureModesAfter.join(', ')}`);
    } catch (err) {
      console.error(`forge requeue: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });
}

// ADR 020: the architect runs in the forge UI as an operator-driven,
// file-checkpointed runner. `forge architect run <sid>` advances ONE turn — it's
// what the UI bridge spawns on each operator action (start / answer / verdict).
// M7-5 (ADR-031): INTERNAL command — hidden from `forge --help`, never invoked
// by hand, but kept dispatchable for the bridge's spawnArchitectTurn. Do NOT
// delete the function or its dispatch case.
async function cmdArchitectRun(rest: string[]): Promise<void> {
  const sessionId = rest[0];
  if (!sessionId) {
    console.error('forge architect run: missing <session-id>');
    console.error('Usage: forge architect run <session-id> [--project <name>]');
    process.exit(2);
  }
  const projectIdx = rest.indexOf('--project');
  const projectArg = projectIdx >= 0 ? rest[projectIdx + 1] : undefined;

  let projectRoot: string;
  if (projectArg) {
    projectRoot = resolve('projects', projectArg);
  } else {
    const found = findSessionProject(sessionId);
    if (!found) {
      console.error(
        `forge architect run: no project found containing _architect/${sessionId}/. ` +
          `Pass --project <name> to disambiguate.`,
      );
      process.exit(2);
    }
    projectRoot = found;
  }

  if (!existsSync(projectRoot)) {
    console.error(`forge architect run: project root not found: ${projectRoot}`);
    process.exit(2);
  }

  const result = await runArchitectTurn({ sessionId, projectRoot });
  console.log(`architect turn complete — phase=${result.phase}`);
  if (result.questions?.length) {
    console.log(`  ${result.questions.length} question(s) awaiting the operator`);
  }
  if (result.planPath) console.log(`  PLAN: ${result.planPath}`);
  if (result.promotedManifestPaths?.length) {
    console.log(`  promoted ${result.promotedManifestPaths.length} manifest(s) to _queue/pending/:`);
    for (const p of result.promotedManifestPaths) console.log(`    ${p}`);
  }
}

/**
 * Scan `projects/*` for `_architect/<sessionId>/PLAN.md` and return the
 * first match's project root. Used when the operator omits `--project`.
 */
function findSessionProject(sessionId: string): string | null {
  const projectsDir = resolve('projects');
  if (!existsSync(projectsDir)) return null;
  let entries: string[];
  try {
    entries = readdirSync(projectsDir);
  } catch {
    return null;
  }
  for (const name of entries) {
    const candidate = join(projectsDir, name);
    try {
      const stat = statSync(candidate);
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }
    // Match on the session dir (status.json appears from the first turn;
    // PLAN.md only appears once drafting completes).
    const sessionDir = join(candidate, '_architect', sessionId);
    if (existsSync(join(sessionDir, 'status.json')) || existsSync(join(sessionDir, 'PLAN.md'))) {
      return candidate;
    }
  }
  return null;
}
