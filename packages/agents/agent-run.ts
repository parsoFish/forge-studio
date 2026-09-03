/**
 * `forge agent run <agent-id> <session-id> [--project <name>]` — the generic
 * path over the 4 interactive agent runners (architect / instructions /
 * demo-builder / project-brain).
 *
 * Extracted from `apps/forge/cli.ts` (R2-01 final-review cleanup — cli.ts
 * had grown past the 800-line cap after R2-01-F3a added this machinery).
 * `cli/` is where subcommand handlers live (architect-plan.ts, brain-lint.ts,
 * bridge-recovery.ts, …); this file is the same kind of extraction.
 *
 * `AGENT_RUNNERS` captures exactly what varies per agent-id
 * (project-required-or-not, forgeRoot-needed-or-not, how its run-turn
 * function is loaded, its phase-specific console summary); `cmdAgentRun` is
 * the ONE parse/resolve/guard/call/print skeleton every legacy `cmd<X>Run` in
 * `apps/forge/cli.ts` delegates into, so the legacy `<verb> run <sid>
 * [--project]` commands keep behaving byte-identically (same error text,
 * same exit codes, same printed summaries) while the boilerplate lives in
 * exactly one place.
 *
 * `forgeRoot` is threaded in from the caller (apps/forge/cli.ts's
 * already-resolved `FORGE_ROOT`) rather than recomputed here — one SSOT,
 * mirroring how `cmdStudioLauncher` threads `forgeRoot` into `runWatch`.
 */

import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { guardedReadFile, resolveGuardedPath } from '@forge/kernel';
import { guardedWriteSessionStatus } from '@forge/sessions/interactive-session.ts';
import { runArchitectTurn } from '@forge/sessions/architect-runner.ts';
import { runInstructionsTurn } from '@forge/sessions/instructions-runner.ts';
import { runDemoBuilderTurn } from '@forge/sessions/demo-builder-runner.ts';
import type { runProjectBrainTurn } from '../../orchestrator/project-brain-builder-runner.ts';
import { dispatchAgentRun } from './agent-dispatch.ts';
import { isSafeRunId } from './run-agent.ts';
import { isStandaloneBandAgent, runBandAgentStandalone } from '../../orchestrator/band-agent-run.ts';
import { skillsDir } from './skill-path.ts';
import { defaultConfigPath, loadConfig, resolveProjectsDir } from '@forge/kernel';
import { createLogger } from '@forge/kernel';
import { runInteractiveTurn } from '@forge/sessions/interactive-runner.ts';
import { loadSessionKinds, type SessionKindDescriptor } from '@forge/sessions/studio/session-kinds.ts';

type AgentTurnInput = { sessionId: string; projectRoot: string; forgeRoot?: string };
type AgentTurnFn = (input: AgentTurnInput) => Promise<unknown>;

export interface AgentRunnerEntry {
  /** The verb string used in error/usage text, e.g. "architect run". */
  verb: string;
  /** `--project <name>` is required (errors if absent) vs optional — only
   *  architect falls back to `findSessionProject` auto-discovery when absent. */
  requiresProject: boolean;
  /** Whether the turn function's input needs `forgeRoot` threaded through. */
  needsForgeRoot?: boolean;
  /** project-brain's pre-existing quirk: ONE combined "missing arg(s)" check
   *  that prints just the Usage line, instead of the other 3's two-line
   *  "missing <session-id>" / "--project is required" sequential checks. */
  combinedArgCheck?: boolean;
  /** Resolve the runner's `run<X>Turn` function. project-brain performs a
   *  dynamic import here (preserving the pre-existing lazy-load); the other
   *  three just hand back their static top-of-file import. The cast through
   *  `unknown` is deliberate: each runner has its own, more specific
   *  input/result type (see the map doc) and the registry needs one common
   *  shape to store them uniformly — `cmdAgentRun` is the single place that
   *  builds the correctly-shaped call args per entry, so the underlying call
   *  stays exactly as typed/behaved as before this refactor. */
  loadRunTurn: () => Promise<AgentTurnFn>;
  /** Print the phase-specific console summary (moved out of each legacy
   *  `cmd<X>Run` body verbatim). */
  printResult: (result: unknown) => void;
  /** bead forge-poc — the ONE on-disk containment segment this runner's own
   *  session dir lives under (`<projectRoot>/<kindDir>/<sessionId>/status.json`),
   *  mirroring `TurnSpec.kindDir` for the new-road turnSpec kinds
   *  (`runTurnSpecAgent` below). Read STRAIGHT off each runner's own
   *  `*_KIND_DIR` constant — `packages/sessions/architect-runner.ts` ('_architect'),
   *  `packages/sessions/instructions-runner.ts` ('_instructions'),
   *  `orchestrator/project-brain-builder-runner.ts` ('_project-brain') — with
   *  ONE deliberate trap: demo-builder's is `_demo`, NOT `_demo-builder` (see
   *  `packages/sessions/demo-builder-runner.ts`'s `DEMO_KIND_DIR` and
   *  `studio/session-kinds.yaml`'s own "id is demo — NOT demo-builder" comment
   *  on the "demo" descriptor — the AGENT_RUNNERS *key* `demo-builder` and the
   *  on-disk dir are intentionally different strings). Used ONLY by
   *  `cmdAgentRun`'s new failed-turn catch (below) to locate the session's
   *  `status.json` for `writeSessionTerminalPhase` — never by the runner
   *  itself, which resolves its own kind dir independently. */
  kindDir: string;
}

export const AGENT_RUNNERS: Record<string, AgentRunnerEntry> = {
  architect: {
    verb: 'architect run',
    requiresProject: false,
    kindDir: '_architect',
    loadRunTurn: async () => runArchitectTurn as unknown as AgentTurnFn,
    printResult: (raw) => {
      const result = raw as Awaited<ReturnType<typeof runArchitectTurn>>;
      console.log(`architect turn complete — phase=${result.phase}`);
      if (result.questions?.length) {
        console.log(`  ${result.questions.length} question(s) awaiting the operator`);
      }
      if (result.planPath) console.log(`  PLAN: ${result.planPath}`);
      if (result.promotedManifestPaths?.length) {
        console.log(`  promoted ${result.promotedManifestPaths.length} manifest(s) to _queue/pending/:`);
        for (const p of result.promotedManifestPaths) console.log(`    ${p}`);
      }
    },
  },
  instructions: {
    verb: 'instructions run',
    requiresProject: true,
    // R3-05-F3 — the runner reads the studio/instruction-seeds/ library under
    // forgeRoot to compose AGENTS.md from vetted blocks.
    needsForgeRoot: true,
    kindDir: '_instructions',
    loadRunTurn: async () => runInstructionsTurn as unknown as AgentTurnFn,
    printResult: (raw) => {
      const result = raw as Awaited<ReturnType<typeof runInstructionsTurn>>;
      console.log(`instructions turn complete — phase=${result.phase}`);
      if (result.questions?.length) {
        console.log(`  ${result.questions.length} question(s) awaiting the operator`);
      }
      if (result.draftPath) console.log(`  DRAFT: ${result.draftPath}`);
      if (result.agentsPath) console.log(`  AGENTS.md: ${result.agentsPath}`);
    },
  },
  'demo-builder': {
    verb: 'demo-builder run',
    requiresProject: true,
    needsForgeRoot: true,
    // NOTE the trap: the on-disk kind dir is '_demo', not '_demo-builder' —
    // see the AgentRunnerEntry.kindDir doc above.
    kindDir: '_demo',
    loadRunTurn: async () => runDemoBuilderTurn as unknown as AgentTurnFn,
    printResult: (raw) => {
      const result = raw as Awaited<ReturnType<typeof runDemoBuilderTurn>>;
      console.log(`demo-builder turn complete — phase=${result.phase}`);
      if (result.demoPath) console.log(`  DEMO: ${result.demoPath}`);
      if (result.lockPath) console.log(`  LOCK: ${result.lockPath}`);
    },
  },
  'project-brain': {
    verb: 'project-brain run',
    requiresProject: true,
    needsForgeRoot: true,
    combinedArgCheck: true,
    kindDir: '_project-brain',
    loadRunTurn: async () => {
      const { runProjectBrainTurn: run } = await import('../../orchestrator/project-brain-builder-runner.ts');
      return run as unknown as AgentTurnFn;
    },
    printResult: (raw) => {
      const result = raw as Awaited<ReturnType<typeof runProjectBrainTurn>>;
      console.log(`project-brain turn complete — phase=${result.phase} (${result.themes?.length ?? 0} theme(s))`);
    },
  },
};

// R2-01-F3a: `AGENT_RUNNERS` (declared above) is the registry `cmdAgentRun`
// looks up.
export async function cmdAgent(rest: string[], forgeRoot: string): Promise<void> {
  const sub = rest[0];
  if (sub === 'run') return await cmdAgentRun(rest.slice(1), forgeRoot);
  if (sub === 'dispatch') return await cmdAgentDispatch(rest.slice(1), forgeRoot);
  console.error('forge agent: subcommands: run <agent-id> <session-id> | dispatch <slug>');
  console.error('  forge agent run <agent-id> <session-id> [--project <name>]');
  console.error('  forge agent dispatch <slug> --run-id <id> [--project <name>] [--input k=v ...]');
  console.error(`  run <agent-id> is one of: ${Object.keys(AGENT_RUNNERS).join(', ')}`);
  process.exit(2);
}

/**
 * R4-17, D7 — writes the TERMINAL phase (`complete`/`failed`) into
 * `<sessionDir>/status.json` when a dispatch run driven with `--session-dir`
 * ends; `phase: 'running'` was already written by the process that STARTED
 * the run (`POST /api/studio/onboarding/start`) — this is the process that
 * OBSERVES the run ending, so it is the one that writes the terminal phase
 * (D7's "phase is written by the process that observes the run" rule).
 *
 * D6: this is purely ADDITIVE — a dispatch invoked WITHOUT `--session-dir`
 * never calls this at all, so behaviour without the flag stays byte-
 * identical to before R4-17 (pinned by `packages/agents/agent-run-dispatch.test.ts`'s
 * AT-D7-3).
 *
 * `sessionDir` is a CLI flag from our OWN spawning code
 * (`spawnAgentDispatch`, cli/ui-bridge.ts), not raw HTTP request text, but
 * the write path is still guarded rather than trusted blindly — twice over:
 * `sessionDir` itself must realpath-resolve to somewhere INSIDE `forgeRoot`
 * (round-1 BLOCKER consequence-path fix — this sink previously had no
 * containment reference at all and unconditionally wrote wherever it was
 * pointed, so the guard depended entirely on the route that started the run
 * having validated the dir first; "one sink, many entry points" — see
 * `cli/ui-bridge-onboarding-start.test.ts` AT-9), and separately, if its
 * `status.json` turns out to be a symlink escaping that resolved directory
 * the write is refused (never followed).
 *
 * The containment root is `projectsRoot`, matching EXACTLY the boundary the
 * write ROUTE above enforces: `POST /api/studio/onboarding/start` is the only
 * real sender of `--session-dir` and it always creates `sessionDir` under
 * `<projectsRoot>/<project>/_onboarding/<sessionId>`, so a `projectsRoot`
 * guard is provably a no-op for every legitimate caller (measured, not
 * assumed). An earlier revision of this function used the WIDER `forgeRoot`
 * purely because the AT-D7 fixtures then built their session dirs under
 * `<forgeRoot>/_logs/…`; T2 ruled that the rule stands and the FIXTURE was
 * the incomplete thing (the R2-10 gate precedent, where a fail-closed
 * registry check broke a synthetic `tmpRoot()` and the fixture was fixed,
 * not the rule). `forgeRoot` would have accepted a `status.json` write
 * anywhere in the forge tree — `brain/`, `skills/`, `studio/`, `docs/`,
 * `.git/` — which no caller needs. AT-D7-4 pins the narrowing with a
 * `sessionDir` inside `forgeRoot` but outside `projectsRoot`, asserting on
 * the FILESYSTEM (the planted `status.json` keeps its pre-run phase), because
 * an exit code cannot distinguish "refused" from "wrote it and carried on".
 *
 * Both checks use the same realpath + `startsWith(root + sep)` boundary
 * shape used throughout this initiative (`resolveContainedProjectDir`,
 * `packages/projects/contract-stages.ts`; `resolveSafeSessionDir`, `cli/bridge-studio-
 * sessions.ts`) — not reused verbatim, because both of those build their
 * candidate path by joining validated components onto a root, whereas
 * `sessionDir` here arrives as a single, already-composed absolute path (the
 * CLI flag itself), with no components to reassemble. Best-effort: any
 * failure here is swallowed — it must never mask the dispatch's own
 * outcome/exit code.
 *
 * Bead forge-c6h / R4-17 round-4: the `resolveProjectsDir(...)` RE-DERIVATION
 * above is exactly the defect. The bridge creates `sessionDir` under its OWN
 * snapshot `ctx.projectsRoot` (resolved once at `startBridge`), then spawns
 * this dispatch as a detached subprocess with no shared memory — so this
 * function re-deriving the projects root from `forge.config.json`/env AT
 * WRITE TIME can silently disagree with the root the bridge actually used,
 * if the config changed (or a differently-configured process invokes this
 * CLI) in between. The fix is `trustedProjectsRoot`: when the CALLER (
 * `cmdAgentDispatch`, via its own `--projects-root` flag — see that
 * function's docstring for the accept/reject contract enforced BEFORE this
 * is ever called) hands in an already-validated root, it is honoured
 * VERBATIM here — no config read, no re-derivation, no room for the two to
 * drift apart. Omitting `--projects-root` leaves this byte-identical to
 * before (self-resolving via `resolveProjectsDir`), so every caller that
 * predates the flag (and every caller that simply doesn't pass it) is
 * unaffected.
 */
function writeSessionTerminalPhase(
  forgeRoot: string,
  sessionDir: string,
  phase: 'complete' | 'failed',
  /** Bead forge-c6h — an already argv-validated (absolute, existing
   *  directory, contained within `forgeRoot`) projects root, forwarded from
   *  `cmdAgentDispatch`'s own `--projects-root` flag. When present, this
   *  becomes the containment root VERBATIM (still realpath-resolved here, to
   *  stay symmetric with `realSessionDir`'s own realpath resolution below —
   *  nothing else about the guard changes). When absent, behaviour is
   *  byte-identical to before this parameter existed. */
  trustedProjectsRoot?: string,
  /** bead forge-poc (ON-7) — the real caught error's `.message` (or its
   *  `String(err)` fallback). Carried into the written status as `error`
   *  ALONGSIDE `phase` — the operator's whole complaint about a silently-
   *  wedged session is that its terminal state carries no trace of what
   *  actually happened; the word "failed" alone repeats that mistake in a
   *  new place. Absent ⇒ no `error` key is written (byte-identical to
   *  before this parameter existed) — every pre-existing call site that
   *  omits it keeps writing the bare `{ ...existing, phase }` shape it
   *  always has. */
  errorMessage?: string,
): void {
  try {
    if (!existsSync(sessionDir) || !statSync(sessionDir).isDirectory()) return;
    const realSessionDir = realpathSync(sessionDir);

    let realProjectsRoot: string;
    try {
      if (trustedProjectsRoot !== undefined) {
        // Bead forge-c6h — honoured verbatim; no config re-derivation.
        realProjectsRoot = realpathSync(trustedProjectsRoot);
      } else {
        // R4-17 round-3 BLOCKER (pin 5, item 2): forge-root-anchored config
        // path, not loadConfig()'s cwd-relative default — see
        // defaultConfigPath's docstring (packages/kernel/config.ts).
        realProjectsRoot = realpathSync(resolveProjectsDir(resolve(forgeRoot), loadConfig(defaultConfigPath(forgeRoot))));
      }
    } catch {
      return; // no resolvable projects root at all — refuse rather than guess
    }
    if (realSessionDir !== realProjectsRoot && !realSessionDir.startsWith(realProjectsRoot + sep)) {
      return; // sessionDir escapes projectsRoot — refuse the write
    }

    // SEC-04 (bd forge-ebj): route the WHOLE status.json path through the
    // guarded primitives instead of the former bespoke realpath-only leaf check
    // — that check resolved symlinks but was structurally blind to a HARDLINKED
    // `status.json` (a genuine, non-symlink directory entry sharing an inode
    // with an out-of-dir file; `realpathSync` returns it unchanged, so the
    // startsWith check passed and the write mutated the shared inode). `guarded*`
    // adds the `nlink === 1` leaf check that closes it. `realProjectsRoot` is the
    // TRUSTED root; the already-contained, realpath-resolved session directory
    // rides as its OWN `segments[]` elements (relative to that root), leaf
    // included — never folded into the root.
    const relFromRoot = relative(realProjectsRoot, realSessionDir);
    const dirSegments = relFromRoot === '' ? [] : relFromRoot.split(sep);

    let existing: Record<string, unknown> = {};
    const rawExisting = guardedReadFile(realProjectsRoot, [...dirSegments, 'status.json']);
    if (rawExisting !== null) {
      try {
        const parsed: unknown = JSON.parse(rawExisting);
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          existing = parsed as Record<string, unknown>;
        }
      } catch {
        // Unreadable/malformed status.json — write a fresh one rather than
        // failing the dispatch outcome over a status-sidecar defect.
      }
    }
    // W7-FIX-A2 (W7A2-01): the write rides the ONE status-write seam
    // (`guardedWriteSessionStatus`, packages/sessions/interactive-session.ts) —
    // the same guarded leaf semantics as before (a symlinked/hardlinked leaf
    // returns null and writes NOTHING) PLUS the sticky-cancel rule: if the
    // operator cancelled this session while the dispatch ran, `existing.phase`
    // is the reserved terminal `cancelled` and this late `complete`/`failed`
    // is refused — the session is never resurrected. Best-effort, never masks
    // the dispatch outcome/exit code.
    guardedWriteSessionStatus(realProjectsRoot, dirSegments, {
      ...existing,
      phase,
      ...(errorMessage !== undefined ? { error: errorMessage } : {}),
    });
  } catch {
    /* best-effort — never masks the dispatch outcome/exit code */
  }
}

/** Parsed shape of `forge agent dispatch <slug> --run-id <id> [...]`'s argv
 *  (the `rest` array `cmdAgentDispatch` receives, slug-first — mirrors what
 *  `buildAgentDispatchArgs`, cli/ui-bridge.ts, emits). `inputs` is always a
 *  (possibly empty) object; `project`/`sessionDir`/`costCeilingUsd` are
 *  ABSENT (not present-as-`undefined`) when their flag was not given. */
export type ParsedAgentDispatchArgs = {
  slug: string;
  runId: string;
  project?: string;
  inputs: Record<string, string>;
  sessionDir?: string;
  costCeilingUsd?: number;
  /** Bead forge-c6h — `--projects-root <abs>`, ABSENT (not present-as-
   *  `undefined`) when the flag was not given. Validated as I/O (existence,
   *  absoluteness, containment within `forgeRoot`) in `cmdAgentDispatch`, not
   *  here — mirrors `costCeilingUsd`'s and `project`'s own split (this
   *  parser stays pure; `cmdAgentDispatch` owns anything that touches disk). */
  projectsRoot?: string;
};

/**
 * Pure argv parser for `forge agent dispatch` (R6-04 WI-2 extraction, mirrors
 * `buildAgentDispatchArgs`'s pure argv BUILDER on the other side of the CLI
 * boundary). THROWS a plain `Error` synchronously for a missing slug, a
 * missing `--run-id`, a malformed `--input` (no `=`), or a `--cost-ceiling-usd`
 * value that does not parse to a finite number — `cmdAgentDispatch` below
 * catches these and re-renders them into the exact `forge agent dispatch: …`
 * console text + exit(2) it always has, so this extraction is a pure
 * refactor of where the parsing LIVES, not a change to what an operator sees.
 *
 * Deliberately does NOT validate `costCeilingUsd`'s business bounds (`<= 0`,
 * above `MAX_KICKOFF_COST_CEILING_USD`) — those are independently owned and
 * already enforced at the bridge-route layer before this process is ever
 * spawned; this parser's only job is "is this string a valid finite number
 * at all". Does NOT check project existence either — that stays I/O,
 * `cmdAgentDispatch`'s job, not this pure function's.
 */
export function parseAgentDispatchArgs(rest: string[]): ParsedAgentDispatchArgs {
  const slug = rest[0];
  if (!slug || slug.startsWith('--')) {
    throw new Error('missing <slug>');
  }
  const flags = rest.slice(1);
  const flagValue = (name: string): string | undefined => {
    const i = flags.indexOf(name);
    return i >= 0 ? flags[i + 1] : undefined;
  };
  const runId = flagValue('--run-id');
  if (!runId) {
    throw new Error('--run-id <id> is required');
  }
  const project = flagValue('--project');
  // R4-17, D6/D7 — optional; see `writeSessionTerminalPhase`'s header for
  // the round-1 BLOCKER fix: it now refuses a `--session-dir` outside
  // `forgeRoot` (a `cmdAgentDispatch` parameter — no extra resolution needed
  // here).
  const sessionDir = flagValue('--session-dir');

  // Bead forge-c6h — optional; I/O validation (absolute? exists? contained
  // in forgeRoot?) happens in `cmdAgentDispatch`, not here — see
  // `ParsedAgentDispatchArgs.projectsRoot`'s own doc.
  const projectsRoot = flagValue('--projects-root');

  // `--input k=v` may repeat; each is surfaced as prompt DATA (never instructions).
  const inputs: Record<string, string> = {};
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === '--input') {
      const kv = flags[i + 1] ?? '';
      const eq = kv.indexOf('=');
      if (eq <= 0) {
        throw new Error(`--input expects k=v, got ${JSON.stringify(kv)}`);
      }
      inputs[kv.slice(0, eq)] = kv.slice(eq + 1);
    }
  }

  const costCeilingRaw = flagValue('--cost-ceiling-usd');
  let costCeilingUsd: number | undefined;
  if (costCeilingRaw !== undefined) {
    const parsedCeiling = Number(costCeilingRaw);
    if (!Number.isFinite(parsedCeiling)) {
      throw new Error(`--cost-ceiling-usd expects a finite number, got ${JSON.stringify(costCeilingRaw)}`);
    }
    costCeilingUsd = parsedCeiling;
  }

  return {
    slug,
    runId,
    ...(project !== undefined ? { project } : {}),
    inputs,
    ...(sessionDir !== undefined ? { sessionDir } : {}),
    ...(costCeilingUsd !== undefined ? { costCeilingUsd } : {}),
    ...(projectsRoot !== undefined ? { projectsRoot } : {}),
  };
}

/** Bead forge-c6h — the accept/reject contract for `--projects-root <abs>`,
 *  the trusted-root argv flag that lets `writeSessionTerminalPhase` skip its
 *  own config re-derivation (see that function's docstring for the defect
 *  this closes). Because the flag is itself argv/operator input, it gets its
 *  OWN validation rather than being trusted the moment it parses:
 *    1. must be an ABSOLUTE path — a relative one is rejected outright (no
 *       "resolve against cwd/forgeRoot" guessing);
 *    2. must EXIST and be a DIRECTORY;
 *    3. must be CONTAINED within `forgeRoot` (the same realpath +
 *       `startsWith(root + sep)` boundary shape `writeSessionTerminalPhase`
 *       already uses for `sessionDir` vs `projectsRoot`) — an argv-supplied
 *       root pointing outside the forge tree is refused. This is the check
 *       that stops the flag itself from becoming a containment bypass: an
 *       operator (or a compromised spawner) could otherwise point
 *       `writeSessionTerminalPhase` at an arbitrary directory and have it
 *       treated as fully trusted.
 *  On ANY rejection the caller must fail the dispatch loudly (non-zero exit
 *  + a clear stderr line) — never fall back to the derived root; a silent
 *  fallback would reintroduce the exact re-derivation-drift bug this flag
 *  closes.
 */
function checkProjectsRootFlag(forgeRoot: string, rawProjectsRoot: string): { ok: true; realRoot: string } | { ok: false; reason: string } {
  if (!isAbsolute(rawProjectsRoot)) {
    return { ok: false, reason: 'must be an absolute path' };
  }
  if (!existsSync(rawProjectsRoot) || !statSync(rawProjectsRoot).isDirectory()) {
    return { ok: false, reason: 'must exist and be a directory' };
  }
  let realRoot: string;
  let realForgeRoot: string;
  try {
    realRoot = realpathSync(rawProjectsRoot);
    realForgeRoot = realpathSync(resolve(forgeRoot));
  } catch {
    return { ok: false, reason: 'failed to resolve (realpath)' };
  }
  if (realRoot !== realForgeRoot && !realRoot.startsWith(realForgeRoot + sep)) {
    return { ok: false, reason: `must be contained within forgeRoot (${forgeRoot})` };
  }
  return { ok: true, realRoot };
}

/**
 * `forge agent dispatch <slug> --run-id <id> [--project <name>] [--input k=v]
 * [--session-dir <abs>] [--cost-ceiling-usd <usd>]` — the generic
 * standalone-run path for a NON-interactive roster agent (R2-01-F3 dispatch
 * half). Unlike `forge agent run` (the four bespoke interactive
 * turn-runners in `AGENT_RUNNERS`), this resolves ANY studio agent def by
 * slug and runs it once through the F1 `runAgent` primitive via
 * `dispatchAgentRun`. This is the CLI the bridge's `POST /api/agents/:slug/run`
 * spawns detached (mirroring `spawnAgentTurn`), so the run's events/cost land
 * under `_logs/<run-id>/` for the monitor.
 *
 * `--session-dir <abs>` (R4-17, D7, optional) — when given, the terminal
 * phase (`complete`/`failed`) is written into that dir's `status.json` when
 * this dispatch ends. See `writeSessionTerminalPhase` above.
 *
 * `--cost-ceiling-usd <usd>` (R6-04, WI-2, optional) — the operator's
 * per-kickoff cost ceiling, threaded to `dispatchAgentRun`'s
 * `kickoffCeilingUsd` (which itself wins over the agent's own declared
 * budget — see `packages/agents/run-agent.ts`).
 *
 * `--projects-root <abs>` (bead forge-c6h, optional) — validated via
 * `checkProjectsRootFlag` (absolute, exists, contained in `forgeRoot`)
 * immediately after parsing, BEFORE any project resolution or dispatch
 * attempt; a rejection exits 2 and never runs the dispatch at all (no
 * partial writes, no fallback to the derived root). When accepted, the
 * validated root is threaded to every `writeSessionTerminalPhase` call
 * below as `trustedProjectsRoot`, replacing that function's own config
 * re-derivation for THIS invocation. Omitted ⇒ byte-identical to before.
 *
 * `deps.dispatch` (R6-04, WI-2, round 4, optional) — test-injection only,
 * mirrors `RunContext.queryFn`/`ctx.probeConnection`'s existing seam
 * (`packages/agents/run-agent.ts`). Defaults to the real `dispatchAgentRun`;
 * every production call site omits it, so behaviour is unchanged.
 */
export async function cmdAgentDispatch(
  rest: string[],
  forgeRoot: string,
  deps?: { dispatch?: typeof dispatchAgentRun },
): Promise<void> {
  let parsed: ParsedAgentDispatchArgs;
  try {
    parsed = parseAgentDispatchArgs(rest);
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`forge agent dispatch: ${msg}`);
    if (msg === 'missing <slug>') {
      console.error('Usage: forge agent dispatch <slug> --run-id <id> [--project <name>] [--input k=v ...]');
    }
    process.exit(2);
    return;
  }
  const { slug, runId, project: projectArg, inputs, sessionDir, costCeilingUsd, projectsRoot: projectsRootArg } = parsed;

  // Bead forge-c6h — validate `--projects-root` at the boundary BEFORE any
  // project resolution or dispatch attempt: a rejection must fail the whole
  // dispatch loudly (exit 2, no partial work), never silently fall back to
  // `writeSessionTerminalPhase`'s own derived root (see that function's
  // header for exactly the drift a silent fallback would reintroduce).
  let trustedProjectsRoot: string | undefined;
  if (projectsRootArg !== undefined) {
    const check = checkProjectsRootFlag(forgeRoot, projectsRootArg);
    if (!check.ok) {
      console.error(`forge agent dispatch: --projects-root "${projectsRootArg}" is invalid — ${check.reason}`);
      process.exit(2);
      return;
    }
    trustedProjectsRoot = check.realRoot;
  }

  // CONTAINMENT (SEC-07): the untrusted `--project` value must ride as a guarded
  // SEGMENT under the config-derived projects root, never folded into the root
  // (`resolve('projects', projectArg)` gives `resolveGuardedPath` nothing to
  // vet — see packages/kernel/path-guard.ts's CONTRACT). Mirrors the already-guarded
  // `cmdAgentRun` road in this same file. `project.repoPath` becomes the spawned
  // agent's working directory (`packages/agents/agent-dispatch.ts`), so an escaping
  // value here is an out-of-root spawn cwd.
  let project: { name: string; repoPath: string } | undefined;
  if (projectArg) {
    const projectsRoot = resolveProjectsDir(resolve(forgeRoot), loadConfig(defaultConfigPath(forgeRoot)));
    const projectGuard = resolveGuardedPath(projectsRoot, [projectArg]);
    if (!projectGuard.ok) {
      console.error(`forge agent dispatch: --project "${projectArg}" is not a valid project name — ${projectGuard.reason}`);
      process.exit(2);
      return;
    }
    const repoPath = projectGuard.realPath;
    if (!existsSync(repoPath)) {
      console.error(`forge agent dispatch: project root not found: ${repoPath}`);
      process.exit(2);
      return;
    }
    project = { name: projectArg, repoPath };
  }

  const dispatch = deps?.dispatch ?? dispatchAgentRun;

  try {
    // R4-10-F3 isolation surface: the two band-guard node agents (demo-agent /
    // adversarial-review) run standalone through their FLOW pipeline (parity),
    // against an existing initiative's worktree — NOT the bare `runAgent` spawn
    // the generic dispatch uses (which would skip the pipeline bands entirely).
    if (isStandaloneBandAgent(slug)) {
      const initiativeId = inputs.initiative;
      if (!initiativeId) {
        console.error(`forge agent dispatch: standalone "${slug}" needs --input initiative=<id> (the post-develop initiative to run against)`);
        process.exit(2);
        return;
      }
      const out = await runBandAgentStandalone({ slug, initiativeId, runId, forgeRoot, queryFn: undefined });
      console.log(`agent dispatch complete — ${out.slug} (standalone ${out.kind} pipeline) run ${out.runId} on ${out.initiativeId} → ${out.result.status}`);
      if (sessionDir) writeSessionTerminalPhase(forgeRoot, sessionDir, 'complete', trustedProjectsRoot);
      return;
    }

    const out = await dispatch({
      slug,
      skillsDir: skillsDir(forgeRoot),
      runId,
      project,
      inputs: Object.keys(inputs).length > 0 ? inputs : undefined,
      ...(costCeilingUsd !== undefined ? { kickoffCeilingUsd: costCeilingUsd } : {}),
    });
    const { result } = out;
    if (result.suppressed) {
      console.log(`agent dispatch: ${out.slug} run ${out.runId} — spawn suppressed (dry-bridge / no-spawn seam)`);
    } else {
      console.log(`agent dispatch complete — ${out.slug} run ${out.runId} — cost $${result.costUsd.toFixed(4)}`);
    }
    // D7 — the run ended (successfully, whether or not spawn was suppressed
    // under the dry-bridge seam): write the terminal phase now.
    if (sessionDir) writeSessionTerminalPhase(forgeRoot, sessionDir, 'complete', trustedProjectsRoot);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`forge agent dispatch: ${msg}`);
    // Emit a terminal failure marker to the run log so the bridge's status
    // endpoint reports `failed` instead of a perpetual `running` (the RunPanel
    // polls it). Best-effort — never masks the original error / exit code.
    try {
      createLogger(runId, join(forgeRoot, '_logs')).emit({
        initiative_id: runId,
        phase: 'orchestrator',
        skill: slug,
        event_type: 'log',
        input_refs: [],
        output_refs: [],
        message: 'agent-dispatch.failed',
        metadata: { error: msg, agent_slug: slug },
      });
    } catch { /* best-effort */ }
    // D7 — the run ended in failure: write the terminal phase before exiting.
    // bead forge-poc (ON-7): the error text rides along too, for the same
    // reason the sibling agent-dispatch.failed log event above already
    // carries it — a terminal status.json that only says "failed" forces the
    // operator back to stderr.log for the one thing they actually need.
    if (sessionDir) writeSessionTerminalPhase(forgeRoot, sessionDir, 'failed', trustedProjectsRoot, msg);
    process.exit(1);
  }
}

/**
 * ADR-043 §3 (R4-22 WI-5) — dispatch-fork lookup for `cmdAgentRun`. Resolves
 * `agentId`'s session-kind descriptor from `studio/session-kinds.yaml`, if
 * any. `loadSessionKinds` throws on a missing file / unparseable YAML; none
 * of the 4 legacy `AGENT_RUNNERS` ids need this file at all, so a broken or
 * absent `studio/session-kinds.yaml` must never break them — the throw is
 * caught here and downgraded to "no descriptor found", falling through to
 * the existing `AGENT_RUNNERS` lookup below, untouched. This is deliberately
 * NOT a silent swallow (the codebase's "fail loud; no silent fallbacks"
 * rule): the failure is still printed to stderr, so an operator pointing at
 * a genuinely broken `studio/session-kinds.yaml` sees why a turnSpec id
 * disappeared instead of a bare "unknown agent-id" with no clue — while a
 * legacy id (found in `AGENT_RUNNERS` regardless of this file's health)
 * still runs to completion.
 */
function findSessionKindDescriptor(agentId: string, forgeRoot: string): SessionKindDescriptor | undefined {
  let descriptors: SessionKindDescriptor[];
  try {
    descriptors = loadSessionKinds(forgeRoot);
  } catch (err) {
    console.error(`forge agent run: studio/session-kinds.yaml failed to load — ${(err as Error).message}`);
    return undefined;
  }
  return descriptors.find((d) => d.id === agentId);
}

/**
 * ADR-043 §3 (R4-22 WI-5) — the "new road": a `turnSpec`-bearing session-kind
 * descriptor (by construction, one with NO `AGENT_RUNNERS` entry) drives the
 * generic `runInteractiveTurn` spine (`packages/sessions/interactive-runner.ts`,
 * R4-22 WI-3) instead of one of the 4 bespoke runners below. `args` is
 * `cmdAgentRun`'s `rest.slice(1)` — `args[0]` is the session-id, the
 * remainder is flags — mirroring the legacy skeleton's own `rest[1]` /
 * `rest.slice(2)` split one level up, reusing the same `--project` parsing
 * shape rather than a second parser that could drift from it.
 *
 * `--project <name>` is REQUIRED on this road (AT-6, this WI's own pinned
 * contract) — there is no `entry.verb`-driven `findSessionProject`
 * auto-discovery fallback (architect's legacy quirk); omitting it is a loud
 * usage error, mirroring the legacy `requiresProject` entries' two-line
 * shape as closely as possible without an `entry.verb` to draw the exact
 * prefix from.
 */
async function runTurnSpecAgent(
  agentId: string,
  descriptor: SessionKindDescriptor,
  args: string[],
  forgeRoot: string,
): Promise<void> {
  const sessionId = args[0];
  const flagRest = args.slice(1);
  const projectIdx = flagRest.indexOf('--project');
  const projectArg = projectIdx >= 0 ? flagRest[projectIdx + 1] : undefined;

  if (!sessionId) {
    console.error(`forge agent run ${agentId}: missing <session-id>`);
    console.error(`Usage: forge agent run ${agentId} <session-id> --project <name>`);
    process.exit(2);
    return;
  }

  if (!projectArg) {
    console.error(`forge agent run ${agentId}: --project <name> is required`);
    console.error(`Usage: forge agent run ${agentId} <session-id> --project <name>`);
    process.exit(2);
    return;
  }

  // CONTAINMENT (R4-22 WI-5 review finding 1). The legacy skeleton below does a
  // bare `resolve('projects', projectArg)`, which folds an unvalidated CLI value
  // into the ROOT: `--project /etc` discards `projects/` entirely and `--project ..`
  // walks out of it, and `resolveGuardedPath` performs NO identity check on its
  // `root` argument (see packages/kernel/path-guard.ts's CONTRACT section, which names
  // this "root-folding" shape a total containment bypass — the spine's SEC-04
  // preamble then guards [kindDir, sessionId] RELATIVE to an already-escaped root,
  // making the comparison tautological). That gap is INHERITED and left untouched on
  // the legacy road (ruling 44: the 4 legacy runners stay byte-for-byte identical),
  // but this is NEW code with no back-compat obligation, and ADR-043 makes this the
  // durable home every future interactive kind funnels through — so the untrusted
  // project name rides as its OWN guarded SEGMENT under the trusted projects root,
  // never folded into it. This closes `..`, `/abs`, `.`, separators and control
  // chars at the door rather than inheriting the legacy hole N times over.
  //
  // R4-21 phase 2, correction B: the ROOT itself is now resolveProjectsDir's
  // single source of truth (honouring FORGE_PROJECTS_DIR / forge.config.json's
  // projectsDir), not a hardcoded `resolve('projects')` — every bridge route
  // already resolves the projects root this way (e.g. cli/ui-bridge.ts's
  // POST /api/studio/authoring/start), and this CLI entry point is what
  // POST /api/studio/authoring/start's spawned turn actually runs, so the two
  // must agree or a session created under a non-default projectsDir is
  // unreachable by its own turn. The guarded-SEGMENT shape for `projectArg`
  // itself is UNCHANGED (AT-B3 regression pin).
  const projectsRoot = resolveProjectsDir(resolve(forgeRoot), loadConfig(defaultConfigPath(forgeRoot)));
  const projectGuard = resolveGuardedPath(projectsRoot, [projectArg]);
  if (!projectGuard.ok) {
    console.error(`forge agent run ${agentId}: --project "${projectArg}" is not a valid project name — ${projectGuard.reason}`);
    process.exit(2);
    return;
  }
  const projectRoot = projectGuard.realPath;
  if (!existsSync(projectRoot)) {
    console.error(`forge agent run ${agentId}: project root not found: ${projectRoot}`);
    process.exit(2);
    return;
  }

  // bead forge-poc — `descriptor.turnSpec` is guaranteed present here: the
  // ONLY caller (`cmdAgentRun`'s ADR-043 §3 fork below) invokes this function
  // exclusively when `descriptor?.turnSpec` is truthy. Asserted rather than
  // silently trusted, per this codebase's declared-data-fails-open rule —
  // if this invariant is ever violated it fails loud, naming the id, instead
  // of a confusing crash three lines later inside `join(undefined, ...)`.
  const turnSpec = descriptor.turnSpec;
  if (!turnSpec) {
    throw new Error(`runTurnSpecAgent: session kind "${agentId}" has no turnSpec (internal invariant violated — the caller must only reach here for a turnSpec-bearing descriptor)`);
  }
  // bead forge-poc (defect 1, "a runner throw wedges a session at its
  // pre-turn phase forever") — `runInteractiveTurn` (like each of the 4
  // legacy runners below) can throw synchronously (a declared-data-fails-open
  // guard, a cost-ceiling refusal, a containment refusal, …) with NOTHING
  // above this call catching it; the session's status.json then sits at
  // whatever phase it was in when the turn started, forever — the operator
  // UI polls status and shows silence, the only trace is stderr.log (R4-23
  // widened exactly this trigger set; ADR-043 2026-08-14 amendment §4).
  // The session dir mirrors `runInteractiveTurn`'s OWN SEC-04 containment
  // preamble (`[turnSpec.kindDir, sessionId]` under `projectRoot`) — same
  // two segments, same root, so the terminal write lands exactly where the
  // turn itself would have written its next status.
  const sessionDir = join(projectRoot, turnSpec.kindDir, sessionId);
  let result: Awaited<ReturnType<typeof runInteractiveTurn>>;
  try {
    result = await runInteractiveTurn(descriptor, { sessionId, projectRoot, forgeRoot });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // writeSessionTerminalPhase is best-effort (its own try/catch swallows
    // any failure) and honours the sticky-cancel rule via
    // guardedWriteSessionStatus — a session the operator cancelled while
    // this turn ran stays 'cancelled', never resurrected to 'failed'.
    writeSessionTerminalPhase(forgeRoot, sessionDir, 'failed', undefined, msg);
    throw err; // RETHROW — the exit code must still reflect the failure.
  }
  console.log(`${agentId} turn complete — phase=${result.phase}`);
  if (result.wrote.length) {
    console.log(`  wrote ${result.wrote.length} file(s):`);
    for (const p of result.wrote) console.log(`    ${p}`);
  }
}

/**
 * The shared parse/resolve/guard/call/print skeleton for ALL agent-id run
 * verbs — both the new `forge agent run <agent-id> <sid>` path and the 4
 * legacy `<verb> run <sid>` commands in `apps/forge/cli.ts`, which delegate
 * here as `cmdAgentRun(['<agent-id>', ...rest], forgeRoot)`.
 */
export async function cmdAgentRun(rest: string[], forgeRoot: string): Promise<void> {
  const agentId = rest[0];

  // ADR-043 §3 dispatch fork (R4-22 WI-5) — evaluated BEFORE the
  // unknown-agent-id bail-out below. A turnSpec-bearing session kind has NO
  // AGENT_RUNNERS entry, so checking `entry` first would reject every
  // new-style kind as "unknown agent-id" before this lookup is ever
  // consulted (see findSessionKindDescriptor's own doc for the
  // broken-yaml-must-not-break-legacy-runners decision). Routing key is
  // `descriptor?.turnSpec` presence ALONE — not whether an AGENT_RUNNERS
  // entry also exists for the same id (a descriptor sharing an id with a
  // real AGENT_RUNNERS entry, but carrying no turnSpec, still falls through
  // to the untouched legacy path below).
  if (agentId) {
    const descriptor = findSessionKindDescriptor(agentId, forgeRoot);
    if (descriptor?.turnSpec) {
      return await runTurnSpecAgent(agentId, descriptor, rest.slice(1), forgeRoot);
    }
  }

  const entry = agentId ? AGENT_RUNNERS[agentId] : undefined;
  if (!entry) {
    console.error(`forge agent run: unknown agent-id: ${agentId ?? '(missing)'}`);
    console.error('Usage: forge agent run <agent-id> <session-id> [--project <name>]');
    console.error(`  <agent-id> is one of: ${Object.keys(AGENT_RUNNERS).join(', ')}`);
    process.exit(2);
    return;
  }

  const sessionId = rest[1];
  const flagRest = rest.slice(2);
  const projectIdx = flagRest.indexOf('--project');
  const projectArg = projectIdx >= 0 ? flagRest[projectIdx + 1] : undefined;

  if (entry.combinedArgCheck) {
    if (!sessionId || (entry.requiresProject && !projectArg)) {
      console.error(
        `Usage: forge ${entry.verb} <session-id>${entry.requiresProject ? ' --project <name>' : ''}`,
      );
      process.exit(2);
      return;
    }
  } else {
    if (!sessionId) {
      console.error(`forge ${entry.verb}: missing <session-id>`);
      console.error(
        `Usage: forge ${entry.verb} <session-id>${entry.requiresProject ? ' --project <name>' : ' [--project <name>]'}`,
      );
      process.exit(2);
      return;
    }
    if (entry.requiresProject && !projectArg) {
      console.error(`forge ${entry.verb}: --project <name> is required`);
      console.error(`Usage: forge ${entry.verb} <session-id> --project <name>`);
      process.exit(2);
      return;
    }
  }

  let projectRoot: string;
  if (projectArg) {
    // Parity with the interactive road (runTurnSpecAgent): guard the untrusted
    // --project value as a SEGMENT under the config-derived projects root,
    // never folded into the root. See packages/kernel/path-guard.ts's CONTRACT.
    const projectsRoot = resolveProjectsDir(resolve(forgeRoot), loadConfig(defaultConfigPath(forgeRoot)));
    const projectGuard = resolveGuardedPath(projectsRoot, [projectArg]);
    if (!projectGuard.ok) {
      console.error(`forge ${entry.verb}: --project "${projectArg}" is not a valid project name — ${projectGuard.reason}`);
      process.exit(2);
      return;
    }
    projectRoot = projectGuard.realPath;
  } else {
    // Only reachable when !requiresProject (architect today) — required-project
    // entries already returned above when --project was absent.
    const found = findSessionProject(sessionId);
    if (!found) {
      console.error(
        `forge ${entry.verb}: no project found containing _architect/${sessionId}/. ` +
          `Pass --project <name> to disambiguate.`,
      );
      process.exit(2);
      return;
    }
    projectRoot = found;
  }

  if (!existsSync(projectRoot)) {
    console.error(`forge ${entry.verb}: project root not found: ${projectRoot}`);
    process.exit(2);
    return;
  }

  const runTurn = await entry.loadRunTurn();
  // bead forge-poc (defect 1) — same rationale as runTurnSpecAgent's own
  // catch above: a legacy runner throw (architect's cost-ceiling refusal,
  // any runner's "no status.json"/containment refusal, …) previously had
  // NOTHING between it and the top-level `apps/forge/cli.ts` catch-all,
  // which only logs to stderr — invisible to the detached, unref'd spawn
  // `cli/ui-bridge.ts`'s `spawnAgentTurn` uses. `entry.kindDir` is each
  // runner's own on-disk session-dir segment (see AgentRunnerEntry.kindDir's
  // doc for the demo-builder/`_demo` trap).
  const sessionDir = join(projectRoot, entry.kindDir, sessionId);
  let result: unknown;
  try {
    result = await runTurn({
      sessionId,
      projectRoot,
      ...(entry.needsForgeRoot ? { forgeRoot } : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    writeSessionTerminalPhase(forgeRoot, sessionDir, 'failed', undefined, msg);
    throw err; // RETHROW — the exit code must still reflect the failure.
  }
  entry.printResult(result);
}

/**
 * Scan `projects/*` for `_architect/<sessionId>/PLAN.md` and return the
 * first match's project root. Used when the operator omits `--project`.
 */
export function findSessionProject(sessionId: string): string | null {
  // Defense-in-depth (SEC-07 r35): the function is statically proven never to
  // return an out-of-root path (it only ever returns a real readdir-enumerated
  // `projects/*` entry), but a malformed session id (separator/`..`/empty) can
  // never name a legitimate architect session — refuse it early. `isSafeRunId`
  // (SAFE_RUN_ID_RE + explicit `..` check) still admits a legit
  // `<iso-with-dashes>-<name>` architect id.
  if (!isSafeRunId(sessionId)) return null;
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
