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

import { existsSync, readdirSync, statSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { serve } from './scheduler.ts';
import { loadBrainIndex, regenerateBrainIndex } from '../cli/brain-index.ts';
import { runBrainLint, type Scope as BrainLintScope } from '../cli/brain-lint.ts';
import { runStudioLint } from '../cli/studio-lint.ts';
import { runPreflight, formatPreflightReport, buildVerdictEvent } from '../cli/preflight.ts';
import { assertEnv } from './config.ts';
import { runInit, ensureLayout, type InitReport } from './init.ts';
import { runArchitectTurn } from './architect-runner.ts';
import { runInstructionsTurn } from './instructions-runner.ts';
import { runDemoBuilderTurn } from './demo-builder-runner.ts';
import { projectDemoRelDir, readArtifactRoot } from './brain-paths.ts';

const args = process.argv.slice(2);
const cmd = args[0];

// F-33: resolve all queue/log paths relative to the forge install root, NOT
// the user's CWD. Without this, `forge status` / `forge review` from inside
// `projects/<name>/` would look for `_queue/` under the project repo and
// silently miss the real one. The forge root is the parent of `orchestrator/`
// where this file sits.
const FORGE_ROOT = resolve(import.meta.dirname, '..');
// Capture the caller's CWD BEFORE chdir to FORGE_ROOT. `forge demo render` (run by
// the developer-unifier agent from its worktree) resolves a relative demo dir against
// this, not the forge install root.
const INVOCATION_CWD = process.cwd();
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
    // S9/DEC-6: the OPERATOR cycle-management + recovery verbs (cycle, enqueue,
    // metrics, review --inspect/--abandon, report, log, requeue) were RETIRED — the
    // UI/bridge is the sole operator surface. Their replacements are the bridge
    // recovery routes (GET /api/recovery/:id, POST /api/recovery/:id/{abandon,requeue},
    // POST /api/initiatives) + the run-detail UI. They fall through to unknown-command.
    //
    // The following stay dispatchable but HIDDEN from `forge --help` — they are
    // INTERNAL spawn targets or AGENT/dev tools, NOT operator commands:
    //   serve        — the scheduler daemon (spawnServeDetached + the harnesses spawn it)
    //   architect    — `architect run <sid>`, spawned by the bridge per operator turn
    //   instructions — `instructions run <sid> --project <name>`, spawned by the bridge per operator turn
    //   demo-builder — `demo-builder run <sid> --project <name>`, spawned by the bridge per operator turn
    //   brain        — `brain lint`/`brain index` brain-integrity gate (mirrors studio lint)
    //   demo      — `demo render`, run by the developer-unifier agent every cycle
    //   preflight — the C1–C9 contract check, run by the forge-onboard-project skill
    case 'serve':
      return await cmdServe(args.slice(1));
    case 'architect':
      return await cmdArchitect(args.slice(1));
    case 'instructions':
      return await cmdInstructions(args.slice(1));
    case 'demo-builder':
      return await cmdDemoBuilder(args.slice(1));
    case 'brain':
      return await cmdBrain(args.slice(1));
    case 'demo':
      return await cmdDemo(args.slice(1));
    case 'preflight':
      return cmdPreflight(args.slice(1));
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
recovery (cycle / enqueue / metrics / review / report / log / requeue) now live in the
UI + the bridge API (POST /api/runs, /api/verdict, /api/recovery/:id, /api/initiatives).
Run \`forge studio\` and drive everything from the browser.

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

function cmdBrain(rest: string[]): void | Promise<void> {
  const sub = rest[0];
  if (sub === 'index') return cmdBrainIndex(rest.slice(1));
  if (sub === 'lint') return cmdBrainLint(rest.slice(1));
  if (sub === 'fix') return cmdBrainFix(rest.slice(1));
  console.error('forge brain: subcommands: index | lint | fix');
  process.exit(2);
}

/**
 * `forge brain fix --kb <id> --file <abs> --check <c> --kind <k> [--hint <h>] [--message <m>] [--run-id <id>]`
 * Runs ONE agent-tier brain-fix turn (the detached child the bridge spawns for
 * the lint-resolution UI's "Fix with agent"). Streams to _logs/_brainfix-<runId>/.
 */
async function cmdBrainFix(rest: string[]): Promise<void> {
  const flag = (name: string): string | undefined => {
    const i = rest.indexOf(`--${name}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const kb = flag('kb');
  const file = flag('file');
  const check = flag('check');
  const kind = flag('kind');
  if (!kb || !file || !check || !kind) {
    console.error('forge brain fix: requires --kb --file --check --kind [--hint --message --run-id]');
    process.exit(2);
    return;
  }
  const runId = flag('run-id') ?? `manual-${kind}`;
  const { runBrainFixTurn } = await import('./brain-fix-runner.ts');
  const r = await runBrainFixTurn({
    runId,
    kbId: kb,
    file,
    check,
    kind,
    fixHint: flag('hint'),
    message: flag('message') ?? '',
    forgeRoot: FORGE_ROOT,
  });
  console.log(`brain-fix [${runId}]: ${r.cleared ? 'CLEARED' : 'NOT cleared'} — ${kind} ${file}`);
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

// ---------------------------------------------------------------------------
// forge instructions run <session-id> --project <name>
//
// Stage A (mirrors `forge architect run`): the instructions-creator runs in the
// forge UI as an operator-driven, file-checkpointed runner that authors a
// managed project's AGENTS.md. The bridge spawns `forge instructions run` per
// operator turn (interview → draft → finalize). INTERNAL command — hidden from
// `forge --help`, never invoked by hand, but kept dispatchable for the bridge's
// spawnInstructionsTurn. Do NOT delete the function or its dispatch case.
//
// Unlike architect, `--project <name>` is REQUIRED — instructions sessions are
// always scoped to a named managed project (no session auto-discovery).
// ---------------------------------------------------------------------------

async function cmdInstructions(rest: string[]): Promise<void> {
  const sub = rest[0];
  if (sub === 'run') return await cmdInstructionsRun(rest.slice(1));
  console.error('forge instructions: subcommands: run <session-id> --project <name>');
  console.error('  forge instructions run <session-id> --project <name>');
  console.error('  (the instructions-creator runs in the forge UI — the bridge spawns this per turn)');
  process.exit(2);
}

async function cmdInstructionsRun(rest: string[]): Promise<void> {
  const sessionId = rest[0];
  if (!sessionId) {
    console.error('forge instructions run: missing <session-id>');
    console.error('Usage: forge instructions run <session-id> --project <name>');
    process.exit(2);
  }
  const projectIdx = rest.indexOf('--project');
  const projectArg = projectIdx >= 0 ? rest[projectIdx + 1] : undefined;
  if (!projectArg) {
    console.error('forge instructions run: --project <name> is required');
    console.error('Usage: forge instructions run <session-id> --project <name>');
    process.exit(2);
  }

  const projectRoot = resolve('projects', projectArg);
  if (!existsSync(projectRoot)) {
    console.error(`forge instructions run: project root not found: ${projectRoot}`);
    process.exit(2);
  }

  const result = await runInstructionsTurn({ sessionId, projectRoot });
  console.log(`instructions turn complete — phase=${result.phase}`);
  if (result.questions?.length) {
    console.log(`  ${result.questions.length} question(s) awaiting the operator`);
  }
  if (result.draftPath) console.log(`  DRAFT: ${result.draftPath}`);
  if (result.agentsPath) console.log(`  AGENTS.md: ${result.agentsPath}`);
}

// ---------------------------------------------------------------------------
// forge demo-builder run <session-id> --project <name>
//
// Stage B (mirrors `forge instructions run`): the demo-builder runs in the forge
// UI as an operator-driven, file-checkpointed runner that authors a managed
// project's DEMO.html. The bridge spawns `forge demo-builder run` per operator
// turn (generate → review → lock). INTERNAL command — hidden from `forge --help`,
// never invoked by hand, but kept dispatchable for the bridge's
// spawnDemoBuilderTurn. Do NOT delete the function or its dispatch case.
//
// Like instructions, `--project <name>` is REQUIRED — demo-builder sessions are
// always scoped to a named managed project (no session auto-discovery).
// ---------------------------------------------------------------------------

async function cmdDemoBuilder(rest: string[]): Promise<void> {
  const sub = rest[0];
  if (sub === 'run') return await cmdDemoBuilderRun(rest.slice(1));
  console.error('forge demo-builder: subcommands: run <session-id> --project <name>');
  console.error('  forge demo-builder run <session-id> --project <name>');
  console.error('  (the demo-builder runs in the forge UI — the bridge spawns this per turn)');
  process.exit(2);
}

async function cmdDemoBuilderRun(rest: string[]): Promise<void> {
  const sessionId = rest[0];
  if (!sessionId) {
    console.error('forge demo-builder run: missing <session-id>');
    console.error('Usage: forge demo-builder run <session-id> --project <name>');
    process.exit(2);
  }
  const projectIdx = rest.indexOf('--project');
  const projectArg = projectIdx >= 0 ? rest[projectIdx + 1] : undefined;
  if (!projectArg) {
    console.error('forge demo-builder run: --project <name> is required');
    console.error('Usage: forge demo-builder run <session-id> --project <name>');
    process.exit(2);
  }

  const projectRoot = resolve('projects', projectArg);
  if (!existsSync(projectRoot)) {
    console.error(`forge demo-builder run: project root not found: ${projectRoot}`);
    process.exit(2);
  }

  const result = await runDemoBuilderTurn({ sessionId, projectRoot, forgeRoot: FORGE_ROOT });
  console.log(`demo-builder turn complete — phase=${result.phase}`);
  if (result.demoPath) console.log(`  DEMO: ${result.demoPath}`);
  if (result.lockPath) console.log(`  LOCK: ${result.lockPath}`);
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

// ── demo + preflight: agent/dev tools, hidden from operator help (S9/DEC-6).
// The developer-unifier agent runs `forge demo render` every cycle to derive
// DEMO.md from demo.json; the forge-onboard-project skill runs `forge preflight`.
// They are NOT operator cycle-management, so they stay dispatchable.
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
  // ADR 021 / F4: `forge demo render <init>` derives the single DEMO.md from the
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
    const res = renderDemoBundle(demoDir, worktreeRoot);
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
      const cps = (demoJson?.checkpoints ?? []) as Array<{ label?: string; command?: string }>;
      // A checkpoint with a `command` captures real CLI stdout (before/after); one
      // without is a browser screenshot checkpoint.
      const checkpointCommands = cps
        .filter((c) => c.label && typeof c.command === 'string' && c.command.trim())
        .map((c) => ({ label: c.label as string, command: c.command as string }));
      const labels = cps.filter((c) => c.label && !c.command).map((c) => c.label as string);
      await captureCheckpoints({ projectRepoPath, project: projectArg ?? '(local)', baseRef, changedRef, bundleDir, initiativeId, checkpointLabels: labels, checkpointCommands, build: true });
      const captured = collectCapturedMedia(bundleDir);
      const merged = mergeCapturedMedia(JSON.parse(readFileSync(jsonPath, 'utf8')), captured);
      writeFileSync(jsonPath, JSON.stringify(merged, null, 2));
      const r = renderDemoBundle(demoDir, projectRepoPath);
      console.log(`forge demo capture: merged ${captured.length} captured checkpoint(s); ${r.ok ? 'rendered DEMO.md' : 'render failed: ' + r.errors.join('; ')}`);
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

