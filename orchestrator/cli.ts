#!/usr/bin/env node
/**
 * forge CLI (S9/DEC-6 — the CLI is retired as the OPERATOR surface; `forge studio`
 * is the sole operator interaction point). Surviving subcommands:
 *
 * Operator (in `forge --help`):
 *   forge init                              scaffold a runnable install + env check
 *   forge studio                            bring up the operator UI (the surface)
 *   forge studio lint                       validate studio definitions (CI/merge gate)
 *
 * Internal / dev (dispatchable, hidden from help):
 *   forge serve [--once]                    the scheduler daemon (spawned by the bridge + harnesses)
 *   forge architect run <sid>               advance one architect turn (spawned by the bridge per operator action)
 *   forge brain index|lint                  brain-integrity gate (mirrors studio lint)
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { serve } from './scheduler.ts';
import { loadBrainIndex, regenerateBrainIndex } from '../cli/brain-index.ts';
import { runBrainLint, type Scope as BrainLintScope } from '../cli/brain-lint.ts';
import { runStudioLint } from '../cli/studio-lint.ts';
import { assertEnv } from './config.ts';
import { runInit, ensureLayout, type InitReport } from './init.ts';
import { runArchitectTurn } from './architect-runner.ts';

const args = process.argv.slice(2);
const cmd = args[0];

// F-33: resolve all queue/log paths relative to the forge install root, NOT
// the user's CWD. Without this, `forge status` / `forge review` from inside
// `projects/<name>/` would look for `_queue/` under the project repo and
// silently miss the real one. The forge root is the parent of `orchestrator/`
// where this file sits.
const FORGE_ROOT = resolve(import.meta.dirname, '..');
process.chdir(FORGE_ROOT);

(async () => {
  // F-10: surface env-setup issues for the SDK-talking verb (warn-only; some
  // setups — e.g. Claude Code — provide auth via a credentials file). Non-SDK
  // verbs (brain index, --help) skip the warning to keep their output clean.
  const sdkVerbs = new Set(['serve']);
  if (cmd && sdkVerbs.has(cmd)) assertEnv('warn');

  switch (cmd) {
    case 'init':
      return cmdInit();
    case 'studio':
      return await cmdStudio(args.slice(1));
    // S9/DEC-6: the operator cycle-management + recovery verbs (cycle, enqueue,
    // metrics, preflight, review --inspect/--abandon, report, log, demo, requeue)
    // were RETIRED from the CLI — the UI/bridge is the sole operator surface. Their
    // replacements are the bridge recovery routes (GET /api/recovery/:id, POST
    // /api/recovery/:id/{abandon,requeue}, POST /api/initiatives) + the run-detail
    // UI (cost/events/artifacts). They now fall through to the unknown-command path.
    //
    // The following stay dispatchable but HIDDEN from `forge --help` — they are
    // INTERNAL spawn targets or dev/CI gates, not operator commands:
    //   serve     — the scheduler daemon (spawnServeDetached + the harnesses spawn it)
    //   architect — `architect run <sid>`, spawned by the bridge per operator turn
    //   brain     — `brain lint`/`brain index` brain-integrity gate (mirrors studio lint)
    case 'serve':
      return await cmdServe(args.slice(1));
    case 'architect':
      return await cmdArchitect(args.slice(1));
    case 'brain':
      return cmdBrain(args.slice(1));
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
  forge studio [--bridge-only] [--no-open] [--bridge-port <n>] [--ui-port <n>] [--ready-file <path>]
                                          Bring up the forge operator UI — the SOLE operator surface (DEC-6).
                                          Run a cycle, review/approve, recover a stuck initiative, inspect cost +
                                          events + artifacts: all in the browser. Foreground (Ctrl-C quits).
                                          Defaults: bridge=4123, ui=4124 (fixed ports — re-runs take over any
                                          previous forge process so a pinned browser tab auto-reconnects).
  forge studio lint                       Validate studio definitions (agents/flows/catalog/kb); exit non-zero on errors

S9/DEC-6: the CLI is retired as the operator surface. Cycle management, review, and
recovery (cycle / enqueue / metrics / preflight / review / report / log / demo / requeue)
now live in the UI + the bridge API (POST /api/runs, /api/verdict, /api/recovery/:id,
/api/initiatives). Run \`forge studio\` and drive everything from the browser.

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
    noTakeover?: boolean; forceTakeover?: boolean;
  } = {};
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--bridge-only') opts.bridgeOnly = true;
    else if (a === '--no-open') opts.noOpen = true;
    else if (a === '--attach' || a === '--no-takeover') opts.noTakeover = true;
    else if (a === '--force-takeover') opts.forceTakeover = true;
    else if (a === '--bridge-port') opts.bridgePort = parsePortFlag(rest[++i], '--bridge-port');
    else if (a === '--ui-port') opts.uiPort = parsePortFlag(rest[++i], '--ui-port');
    else if (a === '--ready-file') opts.readyFile = rest[++i];
    else if (a === '--help' || a === '-h') {
      console.log(`forge studio [--bridge-only] [--no-open] [--attach|--no-takeover] [--force-takeover] [--bridge-port <n>] [--ui-port <n>] [--ready-file <path>]
  Bring up the forge operator UI at http://localhost:4124 (foreground; Ctrl-C quits).
  Awaits a health probe on the bridge then the UI before opening the browser,
  then emits a deterministic 'forge-studio-ready {json}' line on stdout.
  By default a second \`forge studio\` ATTACHES read-only to a healthy running
  bridge (the agent's session stays alive); only a free/stale/foreign port is
  taken over so a pinned browser tab auto-reconnects via WebSocket backoff.
    --bridge-only    Run only the WebSocket bridge (no Next.js dev server).
    --no-open        Skip launching the browser.
    --attach         Attach read-only to a running bridge; never take it over
    --no-takeover    (alias of --attach) — error if none is healthy.
    --force-takeover Replace a running bridge even if it is healthy (escape hatch).
    --bridge-port    HTTP/WS port for the bridge (default: 4123).
    --ui-port        Port for the Next.js dev server (default: 4124).
    --ready-file     Atomically write the ready-info JSON to this path on readiness.`);
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
