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
 *   forge community refresh [--dry-run]     deterministic community-registry refresh (needs GH_TOKEN)
 */

import { existsSync, readdirSync, statSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { serve } from '@forge/flows/scheduler.ts';
import { loadBrainIndex, regenerateBrainIndex } from '@forge/knowledge/brain-index.ts';
import { runBrainLint, type Scope as BrainLintScope } from '@forge/knowledge/brain-lint.ts';
import { runStudioLint } from '../../cli/studio-lint.ts';
import { runPreflight, formatPreflightReport, buildVerdictEvent } from '@forge/projects/preflight.ts';
import { runContractComplianceLoop, formatComplianceReport } from '@forge/projects/contract-compliance-loop.ts';
import { composeAgentsMd } from '@forge/agents/agents-md-compose.ts';
import { authorConstraintBlocks } from '@forge/projects/constraint-author.ts';
import { scaffoldGreenfieldProject, listProjectStarters, type ScaffoldResult } from '@forge/projects/project-create.ts';
import { assertEnv, defaultConfigPath, loadConfig, resolveProjectsDir, runInit,
  ensureLayout, resolveGuardedPath, type InitReport } from '@forge/kernel';
import { worktreeDemoDir } from '@forge/flows/demo-paths.ts';
import { cmdAgent, cmdAgentRun } from '@forge/agents/agent-run.ts';
import { bandAgentDeps } from './band-agent-deps.ts';
import { cmdProjectMigrate } from '@forge/projects/project-migrate.ts';
import { cmdProjectReset } from '@forge/projects/reset.ts';
import { cmdCommunity } from '@forge/library/community-refresh-cmd.ts';

const args = process.argv.slice(2);
const cmd = args[0];

// F-33: resolve all queue/log paths relative to the forge install root, NOT
// the user's CWD. Without this, `forge status` / `forge review` from inside
// `projects/<name>/` would look for `_queue/` under the project repo and
// silently miss the real one. The forge root is the parent of `orchestrator/`
// where this file sits.
const FORGE_ROOT = resolve(import.meta.dirname, '..', '..');
// Capture the caller's CWD BEFORE chdir to FORGE_ROOT. `forge demo render` (run by
// the developer-unifier agent from its worktree) resolves a relative demo dir against
// this, not the forge install root.
const INVOCATION_CWD = process.cwd();
process.chdir(FORGE_ROOT);

// R2-01-F3a: `forge agent run <agent-id> <session-id> [--project <name>]` —
// the generic path over the 4 interactive runners (architect / instructions /
// demo-builder / project-brain) — and the `cmdAgent`/`cmdAgentRun` skeleton
// live in `packages/agents/agent-run.ts`; the 4 thin `cmd<X>Run` delegations
// below import them from there. `cmdAgentRun` resolves an agent-id from TWO
// tables: the un-ported `AGENT_RUNNERS` there, and `SESSION_KIND_RUNNERS`
// (`packages/sessions/kinds/registry.ts`) for each PORTED kind (ruling 60).

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
    //   agent        — `agent run <agent-id> <sid> [--project <name>]`, R2-01-F3a's generic path over
    //                  the 4 verb-specific cases above (they now delegate through it)
    //   brain        — `brain lint`/`brain index` brain-integrity gate (mirrors studio lint)
    //   demo      — `demo render`, run by the develop flow's successor band every cycle
    // `preflight` is NOT in this hidden list: it is an operator command and IS
    // advertised in `forge --help` (the operator runs it against a managed project).
    case 'serve':
      return await cmdServe(args.slice(1));
    case 'architect':
      return await cmdArchitect(args.slice(1));
    case 'instructions':
      return await cmdInstructions(args.slice(1));

    case 'constraints':
      return cmdConstraints(args.slice(1));

    case 'create':
      return cmdCreate(args.slice(1));
    case 'demo-builder':
      return await cmdDemoBuilder(args.slice(1));
    case 'agent':
      return await cmdAgent(args.slice(1), FORGE_ROOT, { band: bandAgentDeps });
    case 'brain':
      return await cmdBrain(args.slice(1));
    case 'demo':
      return await cmdDemo(args.slice(1));
    case 'project-brain':
      return await cmdProjectBrain(args.slice(1));
    case 'preflight':
      if (args[1] === 'fix') return await cmdPreflightFix(args.slice(2));
      if (args[1] === 'converge') return cmdPreflightConverge(args.slice(2));
      return cmdPreflight(args.slice(1));
    case 'community':
      // W8-B5 (exit row E1): `forge community refresh` — the deterministic
      // community-registry refresh. Two-level noun/verb like `project` below;
      // the sub-verb parse, the usage text and the exit code all live in
      // cmdCommunity, which shares its whole implementation with the bridge
      // route POST /api/studio/community/refresh. Hidden from help (the
      // Studio surface is the operator's entry point — DEC-6).
      process.exit(await cmdCommunity(args.slice(1), FORGE_ROOT));
      break;
    case 'project':
      // Both hidden from help — one-shot repairs Studio's error text points the operator
      // at: `migrate` is W7-B6's flat-keys→testProcess fix, `reset` is S3's contract rebuild.
      if (args[1] === 'migrate') process.exit(cmdProjectMigrate(args.slice(2)));
      if (args[1] === 'reset') process.exit(cmdProjectReset(args.slice(2)));
      console.error('forge project: subcommands: migrate <project-id>, reset <project-id> [--dry-run|--apply]');
      process.exit(2);
      break;
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
  forge studio [--bridge-only] [--no-open] [--dev] [--bridge-port <n>] [--ui-port <n>] [--ready-file <path>]
                                          Bring up the forge operator UI — the SOLE operator surface (DEC-6).
                                          Run a cycle, review/approve, recover a stuck initiative, inspect cost +
                                          events + artifacts: all in the browser. Foreground (Ctrl-C quits).
                                          Defaults: bridge=4123, ui=4124 (fixed ports — re-runs take over any
                                          previous forge process so a pinned browser tab auto-reconnects).
                                          Serves a production build by default (\`next build\` once, then
                                          \`next start\`); pass --dev to keep the \`next dev\` dev-server path.
  forge studio lint                       Validate studio definitions (agents/flows/catalog/kb); exit non-zero on errors
  forge preflight <project-name | path>    Check a managed project against the forge<->project contract; exit non-zero on an unmet hard clause

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
 * Runs ONE agent-tier brain-fix turn (the detached child the bridge spawns
 * for KbDrainPanel's "needs-you" per-finding walkthrough, W6-B13 —
 * apps/studio/components/studio/knowledge/KbDrainPanel.tsx; retired the old
 * LintResolutionPanel's "Fix with agent" button). Streams to
 * _logs/_brainfix-<runId>/.
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
  const { runBrainFixTurn } = await import('@forge/sessions/brain-fix-runner.ts');
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
  // W8-F1 — say WHY, not just that it did not clear. This command reads
  // `r.cleared` and used to print nothing else, so an edit the gate refused
  // (or a disposal it could not carry out) was invisible on the one path an
  // operator drives by hand. `editAudit` is populated on every turn now;
  // a field produced and read by nobody is the shape this lane exists to close.
  for (const u of r.editAudit.unsound) console.log(`  ${u.relPath}: ${u.message}`);
  for (const e of r.editAudit.errors) console.error(`  ${e}`);
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

  const { runWatch, isValidPort } = await import('./forge-watch.ts');
  const parsePortFlag = (raw: string | undefined, flag: string): number => {
    if (!isValidPort(raw)) {
      console.error(`forge studio: ${flag} requires a valid port number (1-65535)`);
      process.exit(2);
    }
    return Number(raw);
  };
  const opts: {
    bridgeOnly?: boolean; bridgePort?: number; uiPort?: number;
    noOpen?: boolean; readyFile?: string; dev?: boolean;
    noTakeover?: boolean; forceTakeover?: boolean;
  } = {};
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--bridge-only') opts.bridgeOnly = true;
    else if (a === '--no-open') opts.noOpen = true;
    else if (a === '--dev') opts.dev = true;
    else if (a === '--attach' || a === '--no-takeover') opts.noTakeover = true;
    else if (a === '--force-takeover') opts.forceTakeover = true;
    else if (a === '--bridge-port') opts.bridgePort = parsePortFlag(rest[++i], '--bridge-port');
    else if (a === '--ui-port') opts.uiPort = parsePortFlag(rest[++i], '--ui-port');
    else if (a === '--ready-file') opts.readyFile = rest[++i];
    else if (a === '--help' || a === '-h') {
      console.log(`forge studio [--bridge-only] [--no-open] [--dev] [--attach|--no-takeover] [--force-takeover] [--bridge-port <n>] [--ui-port <n>] [--ready-file <path>]
  Bring up the forge operator UI at http://localhost:4124 (foreground; Ctrl-C quits).
  Awaits a health probe on the bridge then the UI before opening the browser,
  then emits a deterministic 'forge-studio-ready {json}' line on stdout.
  By default a second \`forge studio\` ATTACHES read-only to a healthy running
  bridge (the agent's session stays alive); only a free/stale/foreign port is
  taken over so a pinned browser tab auto-reconnects via WebSocket backoff.
    --bridge-only    Run only the WebSocket bridge (no Next.js server).
    --no-open        Skip launching the browser.
    --dev            Serve via \`next dev\` instead of a production build (default:
                     \`next build\` — skipped when the existing build is already
                     fresh — then \`next start\`). Use for iterating on forge-ui code.
    --attach         Attach read-only to a running bridge; never take it over
    --no-takeover    (alias of --attach) — error if none is healthy.
    --force-takeover Replace a running bridge even if it is healthy (escape hatch).
    --bridge-port    HTTP/WS port for the bridge (default: 4123).
    --ui-port        Port for the UI server (default: 4124).
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
// R2-01-F3a: delegates into the shared cmdAgentRun skeleton (see the registry
// above) — behavior (error text, exit codes, printed summary) is unchanged.
async function cmdArchitectRun(rest: string[]): Promise<void> {
  return cmdAgentRun(['architect', ...rest], FORGE_ROOT);
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

async function cmdProjectBrain(rest: string[]): Promise<void> {
  const sub = rest[0];
  if (sub === 'run') return await cmdProjectBrainRun(rest.slice(1));
  console.error('forge project-brain: subcommands: run <session-id> --project <name>');
  process.exit(2);
}

// R2-01-F3a: delegates into the shared cmdAgentRun skeleton (see the registry
// above) — behavior (the combined-arg-check quirk, error text, exit codes,
// printed summary) is unchanged.
async function cmdProjectBrainRun(rest: string[]): Promise<void> {
  return cmdAgentRun(['project-brain', ...rest], FORGE_ROOT);
}

/**
 * `forge create` (R4-03) — decision core, extracted from `cmdCreate` below
 * (forge-qb5) so it can be driven hermetically: parse flags → build a typed
 * manifest → scaffold a greenfield project from its framework template + seed
 * the central brain, then preflight — all returned as data. Pure-ish (its
 * only side effects are the ones `forge create` exists to have — writing the
 * scaffolded project + brain stub via `scaffoldGreenfieldProject`): it never
 * calls `process.exit` and never writes to stdout/stderr for control flow, so
 * a test can assert on the returned result instead of process exit codes.
 * `forgeRoot` is an injected parameter (defaulting to the module's
 * `FORGE_ROOT`), so a test can point it at a throwaway temp directory instead
 * of the real install root. ADR 042 boundary 3: a pure function with an
 * explicit error contract may be exported for direct tests even though its
 * only production caller (`cmdCreate`) lives in this same module.
 */
export type CreateResult =
  | { ok: true; kind: 'list'; appTypes: string[] }
  | { ok: true; kind: 'scaffolded'; exitCode: 0 | 1; out: ScaffoldResult }
  | { ok: false; kind: 'invalid-args'; exitCode: 2; appTypes: string[] }
  | { ok: false; kind: 'error'; exitCode: 1; message: string };

export function runCreate(rest: string[], opts: { forgeRoot?: string } = {}): CreateResult {
  const forgeRoot = opts.forgeRoot ?? FORGE_ROOT;
  if (rest[0] === 'list' || rest.includes('--list')) {
    return { ok: true, kind: 'list', appTypes: listProjectStarters(forgeRoot) };
  }
  const flag = (name: string): string | undefined => {
    const i = rest.indexOf(`--${name}`);
    const v = i >= 0 ? rest[i + 1] : undefined;
    return v !== undefined && !v.startsWith('--') ? v : undefined;
  };
  const name = flag('name');
  const appType = flag('app-type');
  const northStar = flag('north-star');
  if (!name || !appType || !northStar) {
    return { ok: false, kind: 'invalid-args', exitCode: 2, appTypes: listProjectStarters(forgeRoot) };
  }
  try {
    const out = scaffoldGreenfieldProject({
      manifest: {
        name,
        appType,
        language: flag('language') ?? 'typescript',
        northStar,
        ...(flag('architecture') ? { architecture: flag('architecture') as string } : {}),
      },
      forgeRoot,
    });
    return { ok: true, kind: 'scaffolded', exitCode: out.hardGreen ? 0 : 1, out };
  } catch (err) {
    return { ok: false, kind: 'error', exitCode: 1, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * `forge create --name <name> --app-type <type> [--language ts] --north-star
 * <text> [--architecture <notes>]` (R4-03) — the creation interview as CLI
 * flags → a typed manifest → scaffold a greenfield project from its framework
 * template + seed the central brain, then preflight. Exits 0 iff contract-green
 * (ready for the first architect run). Thin CLI edge over `runCreate`: maps
 * its result onto the exact same console output + exit codes this command
 * always produced (forge-qb5 — behaviour-preserving extraction).
 */
function cmdCreate(rest: string[]): void {
  const result = runCreate(rest, { forgeRoot: FORGE_ROOT });
  switch (result.kind) {
    case 'list':
      console.log(`available app types: ${result.appTypes.join(', ') || '(none)'}`);
      return;
    case 'invalid-args':
      console.error('forge create: requires --name <name> --app-type <type> --north-star <text> [--language ts] [--architecture <notes>]');
      console.error(`  app types: ${result.appTypes.join(', ') || '(none)'}  (or: forge create list)`);
      process.exit(result.exitCode);
      return;
    case 'scaffolded': {
      const out = result.out;
      console.log(`create: scaffolded "${out.id}" (${out.appType}) at ${out.projectDir} — ${out.filesWritten.length} file(s)`);
      if (out.hardGreen) {
        console.log('create: contract-green — ready for the first architect run.');
      } else {
        console.log(`create: NOT contract-green — failing hard clauses: ${out.failingClauses.map((c) => c.clause).join(', ')}`);
      }
      process.exit(result.exitCode);
      return;
    }
    case 'error':
      console.error(`forge create: ${result.message}`);
      process.exit(result.exitCode);
      return;
  }
}

async function cmdInstructions(rest: string[]): Promise<void> {
  const sub = rest[0];
  if (sub === 'run') return await cmdInstructionsRun(rest.slice(1));
  if (sub === 'compose') return cmdInstructionsCompose(rest.slice(1));
  console.error('forge instructions: subcommands: run <session-id> --project <name> | compose --project <name>');
  console.error('  forge instructions run <session-id> --project <name>');
  console.error('  forge instructions compose --project <name>   (R4-02-F4: unattended AGENTS.md from seeds)');
  process.exit(2);
}

/** `forge instructions compose --project <name>` (R4-02-F4) — deterministically
 *  author AGENTS.md from the matched instruction seeds + the declared gate. */
function cmdInstructionsCompose(rest: string[]): void {
  const i = rest.indexOf('--project');
  const project = i >= 0 ? rest[i + 1] : rest.find((a) => !a.startsWith('--'));
  if (!project) { console.error('forge instructions compose: requires --project <name>'); process.exit(2); return; }
  const projectDir = resolvePreflightProjectDir(project);
  const out = composeAgentsMd({ projectDir, forgeRoot: FORGE_ROOT });
  const gateNote = out.gateCmd
    ? ` — gate "${out.gateCmd}" covered: ${out.gateCovered}`
    : ' — no gate declared yet (declare it first for C8 coverage)';
  console.log(
    out.wrote
      ? `instructions compose: wrote ${out.path} — ${out.seedIds.length} seed(s): ${out.seedIds.join(', ') || '(none)'}${gateNote}`
      : `instructions compose: ${out.path} already exists — left untouched${gateNote}${out.gateCmd && !out.gateCovered ? ' (edit it by hand to name the gate)' : ''}`,
  );
  // A declared-but-uncovered gate is a real C8 miss the caller must address.
  if (out.gateCmd && !out.gateCovered) process.exit(1);
}

/** `forge constraints author --project <name>` (R4-02-F5) — author the project's
 *  locked-core constraints as live forge:constraint blocks in central profile.md. */
function cmdConstraints(rest: string[]): void {
  const sub = rest[0];
  if (sub !== 'author') {
    console.error('forge constraints: subcommands: author --project <name>');
    process.exit(2);
    return;
  }
  const flags = rest.slice(1);
  const i = flags.indexOf('--project');
  const project = i >= 0 ? flags[i + 1] : flags.find((a) => !a.startsWith('--'));
  if (!project) { console.error('forge constraints author: requires --project <name>'); process.exit(2); return; }
  try {
    const out = authorConstraintBlocks({ projectDir: resolvePreflightProjectDir(project), forgeRoot: FORGE_ROOT, project });
    console.log(
      out.authored.length > 0
        ? `constraints author: wrote ${out.authored.length} block(s) [${out.authored.join(', ')}] from ${out.source} → ${out.profilePath}`
        : `constraints author: no constraints source (CONSTRAINTS.md / Locked-core section) — profile left untagged (compiles under the ADR-037 default)`,
    );
  } catch (err) {
    console.error(`forge constraints author: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

// R2-01-F3a: delegates into the shared cmdAgentRun skeleton (see the registry
// above) — behavior (error text, exit codes, printed summary) is unchanged.
async function cmdInstructionsRun(rest: string[]): Promise<void> {
  return cmdAgentRun(['instructions', ...rest], FORGE_ROOT);
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

// R2-01-F3a: delegates into the shared cmdAgentRun skeleton (see the registry
// above) — behavior (error text, exit codes, printed summary) is unchanged.
async function cmdDemoBuilderRun(rest: string[]): Promise<void> {
  return cmdAgentRun(['demo-builder', ...rest], FORGE_ROOT);
}

// ── demo + preflight. `demo render` is an agent/dev tool, hidden from operator
// help (S9/DEC-6): the develop flow's successor band runs it every cycle to derive
// DEMO.md from demo.json. `preflight` is an OPERATOR command and is advertised in
// help — DEC-6 retires cycle management from the CLI, not the contract check, and
// the operator runs `forge preflight <project>` directly. The forge-onboard-project
// skill runs it too. Neither is operator cycle-management, so both stay dispatchable.
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
    const demoDir = dirFlag ?? worktreeDemoDir(INVOCATION_CWD, initiativeId);
    const worktreeRoot = dirFlag ? resolve(dirFlag, '..', '..') : INVOCATION_CWD;
    const { renderDemoBundle } = await import('@forge/factory/demo-model.ts');
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
    // CONTAINMENT (SEC-07): an escaping `--project` must be refused BEFORE it is
    // resolved into a repo path (a folded `resolve('projects', projectArg)` gives
    // the guard nothing to vet — see cli/studio-path-guard.ts's CONTRACT). The
    // untrusted value rides as a guarded SEGMENT under the config-derived
    // projects root; an unsafe value is a usage error → exit 2 (consistent with
    // the missing-initiativeId exit 2 above).
    let projectRepoPath: string;
    if (projectArg) {
      const projectsRoot = resolveProjectsDir(resolve(FORGE_ROOT), loadConfig(defaultConfigPath(FORGE_ROOT)));
      const g = resolveGuardedPath(projectsRoot, [projectArg]);
      if (!g.ok) {
        console.error(`forge demo capture: --project "${projectArg}" is not a valid project name — ${g.reason}`);
        process.exit(2);
      }
      projectRepoPath = g.realPath;
    } else {
      projectRepoPath = INVOCATION_CWD;
    }
    const dirFlag = flagValue(rest, '--dir');
    const demoDir = dirFlag ?? worktreeDemoDir(projectRepoPath, initiativeId);
    const jsonPath = join(demoDir, 'demo.json');
    if (!existsSync(jsonPath)) {
      console.error(`forge demo capture: ${jsonPath} not found — author demo.json first. Skipping (best-effort).`);
      return;
    }
    const baseRef = flagValue(rest, '--base') ?? 'main';
    const changedRef = flagValue(rest, '--changed') ?? 'HEAD';
    try {
      const { captureCheckpoints } = await import('@forge/factory/demo.ts');
      const { collectCapturedMedia, mergeCapturedMedia, renderDemoBundle, stampCaptureNonce } = await import('@forge/factory/demo-model.ts');
      const { CAPTURE_NONCE_ENV } = await import('@forge/flows/phases/orchestrated-capture.ts');
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
      // N2 (plan item 2.6): bind the artifacts to THIS orchestrated run. The
      // orchestrator injected a per-run nonce into our environment; stamping
      // it into demo.json AFTER a successful capture+merge is the proof the
      // composed unifier gate verifies. Reached only when capture succeeded —
      // the inner-failure path (catch below) must never stamp.
      const runNonce = process.env[CAPTURE_NONCE_ENV];
      const stamped = runNonce ? stampCaptureNonce(merged, runNonce) : merged;
      writeFileSync(jsonPath, JSON.stringify(stamped, null, 2));
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
/** Resolve a managed-project name or explicit path to an existing project dir, or exit(2). */
function resolvePreflightProjectDir(target: string | undefined): string {
  if (!target) {
    console.error('forge preflight: missing <project>');
    console.error('Usage: forge preflight <project-name | path>');
    process.exit(2);
  }
  const asPath = resolve(target);
  const asManaged = resolve('projects', target);
  const projectDir = existsSync(asPath) && statSync(asPath).isDirectory() ? asPath : asManaged;
  if (!existsSync(projectDir)) {
    console.error(`forge preflight: project directory not found: ${projectDir}`);
    console.error('Pass a directory under projects/ or an absolute path.');
    process.exit(2);
  }
  return projectDir;
}

/**
 * `forge preflight fix --project <p> --clause <c> [--instruction <i>] [--detail <d>] [--run-id <id>]`
 * Runs ONE agent-tier preflight-fix turn (the detached child the bridge spawns
 * for the contract-resolution UI's USER-tier "apply decision"). Streams to
 * _logs/_preflight-fix-<runId>/.
 */
async function cmdPreflightFix(rest: string[]): Promise<void> {
  const flag = (name: string): string | undefined => {
    const i = rest.indexOf(`--${name}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const project = flag('project');
  const clause = flag('clause');
  if (!project || !clause) {
    console.error('forge preflight fix: requires --project --clause [--instruction --detail --run-id]');
    process.exit(2);
    return;
  }
  const projectDir = resolvePreflightProjectDir(project);
  const runId = flag('run-id') ?? `manual-${clause}`;
  const { runPreflightFixTurn } = await import('@forge/sessions/preflight-fix-runner.ts');
  const r = await runPreflightFixTurn({
    runId,
    projectDir,
    clause: clause as Parameters<typeof runPreflightFixTurn>[0]['clause'],
    instruction: flag('instruction') ?? '',
    detail: flag('detail'),
    forgeRoot: FORGE_ROOT,
  });
  console.log(`preflight-fix [${runId}]: ${r.cleared ? 'CLEARED' : 'NOT cleared'} — ${clause}`);
}

/**
 * `forge preflight converge --project <name> [--accept <clause>=<rationale>]…
 *  [--max-iterations N]` (R4-02-F2) — run the deterministic contract-compliance
 *  loop: auto-fix the AUTO-tier clauses + re-check until hard-green (or a
 *  bounded terminal state). The onboarding agent invokes this after declaring
 *  the test command. Writes the authoritative report to
 *  `<project>/.forge/contract-compliance-report.json`; exits 0 iff hard-green.
 */
function cmdPreflightConverge(rest: string[]): void {
  // A valued flag's argument is never mistaken for another flag: return the
  // next token only when it isn't itself a `--flag`.
  const flag = (name: string): string | undefined => {
    const i = rest.indexOf(`--${name}`);
    const v = i >= 0 ? rest[i + 1] : undefined;
    return v !== undefined && !v.startsWith('--') ? v : undefined;
  };
  // A positional project is accepted ONLY as the first token (so it can never
  // be a preceding flag's value, e.g. `--max-iterations 3 foo` → not '3').
  const project = flag('project') ?? (rest[0] && !rest[0].startsWith('--') ? rest[0] : undefined);
  // Validate ALL flags BEFORE touching the filesystem (project resolution),
  // so a malformed invocation errors cleanly regardless of whether the project
  // exists.
  // `--accept C8=rationale` may repeat. The rationale must be non-empty — the
  // loop only counts an advisory as accepted WITH a rationale, so `--accept C8=`
  // would otherwise pass the boundary yet silently not waive the clause.
  const acceptAdvisory: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--accept') {
      const kv = rest[i + 1] ?? '';
      const eq = kv.indexOf('=');
      if (eq <= 0 || kv.slice(eq + 1).trim() === '') {
        console.error(`forge preflight converge: --accept expects <clause>=<non-empty rationale>, got ${JSON.stringify(kv)}`);
        process.exit(2);
        return;
      }
      acceptAdvisory[kv.slice(0, eq)] = kv.slice(eq + 1);
    }
  }
  const maxRaw = flag('max-iterations');
  let maxIterations: number | undefined;
  if (maxRaw !== undefined) {
    // Number() (not parseInt) so a typo like "3x" → NaN is rejected, not
    // silently truncated to 3.
    const n = Number(maxRaw);
    if (!Number.isInteger(n) || n < 1) {
      console.error(`forge preflight converge: --max-iterations expects a positive integer, got ${JSON.stringify(maxRaw)}`);
      process.exit(2);
      return;
    }
    maxIterations = n;
  }
  if (!project) {
    console.error('forge preflight converge: requires --project <name> [--accept <clause>=<rationale>] [--max-iterations N]');
    process.exit(2);
    return;
  }
  const projectDir = resolvePreflightProjectDir(project);
  const report = runContractComplianceLoop({
    projectDir,
    forgeRoot: FORGE_ROOT,
    ...(maxIterations !== undefined ? { maxIterations } : {}),
    acceptAdvisory: acceptAdvisory as Parameters<typeof runContractComplianceLoop>[0]['acceptAdvisory'],
  });
  console.log(formatComplianceReport(report));
  const artifactDir = join(projectDir, '.forge');
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(join(artifactDir, 'contract-compliance-report.json'), JSON.stringify(report, null, 2) + '\n');
  // Hard-green ⇒ 0 so the onboarding agent (and any gate) can branch on it.
  process.exit(report.finalHardGreen ? 0 : 1);
}

function cmdPreflight(rest: string[]): void {
  const projectDir = resolvePreflightProjectDir(rest[0]);
  const report = runPreflight(projectDir, { forgeRoot: FORGE_ROOT });
  console.log(formatPreflightReport(report));
  // CON-5: write the verdict event as JSONL so callers can audit preflight outcomes.
  const verdictLogDir = join(FORGE_ROOT, '_logs', 'preflight');
  mkdirSync(verdictLogDir, { recursive: true });
  appendFileSync(join(verdictLogDir, 'verdicts.jsonl'), JSON.stringify(buildVerdictEvent(report)) + '\n');
  // Hard-clause failure ⇒ forge declines (non-zero so callers can gate).
  process.exit(report.ok ? 0 : 1);
}

