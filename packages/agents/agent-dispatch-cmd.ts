/**
 * agent-dispatch-cmd.ts — `forge agent dispatch <slug>`: its argument parsing,
 * its containment checks, and the command itself.
 *
 * Split out of `agent-run.ts` (M4-agents, exit row 5), which was 886 lines
 * against the 800-line cap. The split is along a real seam rather than a line
 * count: everything here serves the DISPATCH verb — one-shot, non-interactive,
 * any roster agent by slug — while what stays behind serves `forge agent run`,
 * the interactive turn path over the session kinds.
 *
 * WHY THE FORK STAYED PUT. `agent-run.ts` keeps `AGENT_RUNNERS` and the
 * `AGENT_RUNNERS[id] ?? SESSION_KIND_RUNNERS[id]` resolution even though the
 * table is now EMPTY, because it is load-bearing in a way its size hides:
 * `packages/sessions/studio/session-kinds.test.ts` imports it and asserts it
 * gains no `kb-cleanup` key, which is the tripwire keeping ADR-043 §3's
 * dispatch fork from re-opening the per-runner cap park, and `knownAgentIds`
 * derives the operator's usage line from the UNION of both tables so a ported
 * kind cannot go invisible (COMMON §15.77). Neither is this lane's to collapse.
 */

import { existsSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { guardedReadFile, resolveGuardedPath } from '@forge/kernel';
import { guardedWriteSessionStatus } from '@forge/sessions/interactive-session.ts';
import { dispatchAgentRun } from './agent-dispatch.ts';
import { isSafeRunId } from './run-agent.ts';
import { installDispatchSignalGuard, recordDispatchTerminal } from './dispatch-terminal.ts';
import { isStandaloneBandAgent, dispatchStandaloneBand, type BandAgentDeps } from './band-agent-run.ts';
import { skillsDir } from './skill-path.ts';
import { defaultConfigPath, loadConfig, resolveProjectsDir } from '@forge/kernel';

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
export function writeSessionTerminalPhase(
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
  if (!runId || !isSafeRunId(runId)) {
    throw new Error(`--run-id <id> is required and must be a safe run id — letters, digits, dot, underscore, hyphen, no path separators or "..": ${JSON.stringify(runId)}`);
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

export type AgentDispatchDeps = {
  dispatch?: typeof dispatchAgentRun;
  band?: BandAgentDeps;
  /**
   * Ports a ported session kind needs that this package may not import
   * (M4 ruling 79/81): architect reads and writes initiative manifests, whose
   * FUNCTIONS live in `packages/flows` — rank 5, above both agents and
   * sessions. `apps/forge` is the one place that may import them, so it binds
   * them here and they ride down to the kind untouched. Deliberately OPAQUE:
   * this package never inspects or constructs the value, so it needs no import
   * of the shape, and a kind that receives nothing REFUSES rather than
   * defaulting (the no-fallback rule).
   */
  sessionKind?: Record<string, unknown>;
};

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
 * `deps.band` — the band pipelines + queue/manifest readers, bound at
 * `apps/forge/cli.ts` (all three live above this package's rank). Absent, the
 * two band slugs are REFUSED, never downgraded to the bare spawn.
 */

export async function cmdAgentDispatch(rest: string[], forgeRoot: string, deps?: AgentDispatchDeps): Promise<void> {
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

  // forge-8vfn.5.38 — a SIGTERM ran neither the success path below nor its
  // catch, so a run cut short ended with no terminus. See ./dispatch-terminal.ts.
  const writePhase = sessionDir
    ? (o: 'failed', d: string) => writeSessionTerminalPhase(forgeRoot, sessionDir, o, trustedProjectsRoot, d)
    : undefined;
  const uninstallSignalGuard = installDispatchSignalGuard({ runId, slug, forgeRoot, ...(writePhase ? { writePhase } : {}) });

  try {
    // R4-10-F3 isolation surface: the two band-guard node agents (demo-agent /
    // adversarial-review) run standalone through their FLOW pipeline (parity),
    // against an existing initiative's worktree — NOT the bare `runAgent` spawn
    // the generic dispatch uses (which would skip the pipeline bands entirely).
    // Its policy (usage, the missing-binding refusal, the summary line) lives
    // with the band module — see `dispatchStandaloneBand`.
    if (isStandaloneBandAgent(slug)) {
      const band = await dispatchStandaloneBand({ slug, initiativeId: inputs.initiative, runId, forgeRoot }, deps?.band);
      if (!band.ok) { console.error(`forge agent dispatch: ${band.usage}`); process.exit(2); return; }
      console.log(band.summary);
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
    // The terminal failure marker (the bridge reports `failed` rather than a
    // perpetual `running`). Moved to ./dispatch-terminal.ts with the signal
    // path's terminus — and it no longer swallows its own write failure.
    recordDispatchTerminal({ runId, slug, forgeRoot, outcome: 'failed', detail: msg });
    // D7 — the run ended in failure: write the terminal phase before exiting.
    // bead forge-poc (ON-7): the error text rides along too, for the same
    // reason the sibling agent-dispatch.failed log event above already
    // carries it — a terminal status.json that only says "failed" forces the
    // operator back to stderr.log for the one thing they actually need.
    if (sessionDir) writeSessionTerminalPhase(forgeRoot, sessionDir, 'failed', trustedProjectsRoot, msg);
    process.exit(1);
  } finally {
    uninstallSignalGuard();
  }
}
