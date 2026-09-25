/**
 * bridge-agent-dispatch — the detached-runner spawn machinery (architect /
 * instructions / demo-builder / project-brain / authoring / kb-cleanup turns,
 * plus the generic `forge agent dispatch` spawn) and the one architect route
 * that stayed host-side (ADR 020).
 *
 * forge-4zk: carved out of `apps/forge/ui-bridge.ts` (feature move, no
 * behaviour change).
 *
 *   POST /api/plan-verdict → delegates to `applyPlanVerdict` (`@forge/flows`)
 *
 * `spawnAgentTurn`, `spawnAgentDispatch`, `buildAgentDispatchArgs`,
 * `SPAWN_AGENT_SPECS`, `SAFE_INPUT_KEY_RE` and `newRunStamp` are exported:
 * `startBridge` (still in ui-bridge.ts) imports them back to wire into
 * `makeRouteTable`'s deps, which the carved session/agents routes inject.
 * The five `/api/architect/*` arms carved to `@forge/sessions`
 * (`bridge-studio-architect.ts`); `/api/plan-verdict` did NOT, and the reason
 * is a dependency measurement rather than an ownership opinion: `ctx.mergePr`,
 * `ctx.finalizeAfterMerge` and `ctx.queueRoot` appear in this whole function
 * only inside this arm, and the handler it delegates to is flows' own
 * (`applyPlanVerdict`), which also serves `/api/runs/:id/gates/plan`.
 *
 * Mirrors the architect spawn: an operator-driven, file-checkpointed runner
 * authoring a managed project's AGENTS.md (Stage A, instructions), DEMO.html
 * (Stage B, demo-builder — writes into the PROJECT REPO under .forge/demo/,
 * not the session dir, so its file route serves from `project_repo_path`)
 * and the project-brain turn (R1-3b) all spawn one CLI turn per operator
 * action via the shared `spawnAgentTurn(forgeRoot, <kind>, project,
 * sessionId)` below.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, basename, dirname } from 'node:path';

import { sendJson, allowedOrigin, sanitizeError } from '@forge/kernel';
import { isDryBridge, guardedWriteFile } from '@forge/kernel';
import { isSafeRunId } from '@forge/agents/run-agent.ts';
// M4 agents carve: the slug refusal `spawnAgentDispatch` applies is the SAME
// one the carved `POST /api/agents/:slug/run` route applies, so the package
// owns the single definition and the host imports it. Two copies of a
// defense-in-depth guard drift; one does not.
import { SAFE_AGENT_SLUG_RE } from '@forge/agents/bridge-agents-slug.ts';
import { sessionLogDirName } from '@forge/sessions/bridge-studio-lifecycle.ts';
import type { SpawnTurnOutcome } from '@forge/sessions/bridge-studio-session-helpers.ts';
import { applyPlanVerdict, type StudioPostContext } from '@forge/flows/bridge-studio-runs.ts';
import { peekInstalledFactory } from './factory-wiring.ts';
import { readJson } from './bridge-http.ts';

/** The context the one remaining architect route needs from the host. */
export type ArchitectContext = {
  forgeRoot: string;
  logsRoot: string;
  queueRoot: string;
  projectsRoot: string;
  mergePr: (worktreePath: string) => boolean;
  finalizeAfterMerge: (deps: { queueRoot: string; logsRoot: string }) => Promise<unknown>;
  broadcastArchitectChanged: () => void;
};

/** Run-input keys are freer (camelCase like `northStar`) but still flag-safe. */
export const SAFE_INPUT_KEY_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;

/** Timestamp stamp + short random suffix for a generated run id
 *  (YYYY-MM-DDTHH-mm-ss-SSS-xxxx): the ms precision plus 4 base36 chars so two
 *  dispatches of the same slug in the same millisecond (a programmatic driver,
 *  e.g. R4-02 fanout) don't collide onto one `_logs/<runId>/` dir. */
export function newRunStamp(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '');
  return `${ts}-${Math.random().toString(36).slice(2, 6)}`;
}

/** The 5 detached-runner turn families the bridge spawns — each `argvPrefix`
 *  is prepended to `<sid> --project <project>` to build the full argv passed
 *  to `orchestrator/cli.ts`, and `logPrefix` names the `_logs/_<logPrefix>-
 *  <sid>/` capture dir. `demo-builder` is the one legacy case where verb and
 *  log prefix diverge (verb `demo-builder`, log prefix `demo`) — preserved
 *  exactly from the pre-collapse per-agent functions.
 *
 *  R4-21 phase 2, WI-2 (D5's sibling concern): `authoring` is the first row
 *  that does NOT go through a bespoke `<verb> run <sid> --project <p>` CLI
 *  command — it rides the GENERIC `forge agent run <agent-id> <sid> --project
 *  <p>` dispatch fork (ADR-043 §3, `packages/agents/agent-run.ts`'s `cmdAgentRun`), so its
 *  argvPrefix is `['agent', 'run', 'authoring']` rather than `['<verb>',
 *  'run']`. The 4 legacy rows carry an EXPLICIT argv prefix instead of the
 *  former `{verb}` + implicit `'run'` shape specifically so this one row can
 *  differ in SHAPE (3 tokens, not 2) while the legacy rows stay
 *  byte-equivalent to their pre-existing argv — `['architect','run']`,
 *  `['instructions','run']`, `['demo-builder','run']`,
 *  `['project-brain','run']` are the SAME tokens the old `{verb}+'run'`
 *  construction produced, just spelled as a literal array.
 *
 *  W6-B2 review fix (MEDIUM 1) — exported (with SPAWN_AGENT_SPECS below) so
 *  packages/sessions/tests/contract/session-tail-kind-parity.test.ts can import the real table directly
 *  and assert, for every studio/session-kinds.yaml descriptor with a
 *  corresponding entry here, that `logPrefix === descriptor.id` — the
 *  coincidence ensureSessionTail's `_${kind}-${sessionId}` derivation
 *  (ui-bridge.ts, near ensureTailFor) relies on. Without this ratchet, a
 *  future rename of either side drifts silently: ensureSessionTail just
 *  no-ops (ensureTailFor's existsSync guard swallows the miss), so a
 *  session's WS tail would quietly stop activating with no error anywhere. */
export type SpawnableAgentId = 'architect' | 'instructions' | 'demo-builder' | 'project-brain' | 'authoring' | 'kb-cleanup';

export const SPAWN_AGENT_SPECS: Record<SpawnableAgentId, { argvPrefix: readonly string[]; logPrefix: string }> = {
  architect: { argvPrefix: ['architect', 'run'], logPrefix: 'architect' },
  instructions: { argvPrefix: ['instructions', 'run'], logPrefix: 'instructions' },
  'demo-builder': { argvPrefix: ['demo-builder', 'run'], logPrefix: 'demo' },
  'project-brain': { argvPrefix: ['project-brain', 'run'], logPrefix: 'project-brain' },
  authoring: { argvPrefix: ['agent', 'run', 'authoring'], logPrefix: 'authoring' },
  // R4-19-F2 — the kb-cleanup session, riding the SAME generic
  // runInteractiveTurn spine as authoring (ADR-043 §3): `forge agent run
  // kb-cleanup <sid> --project <p>`.
  'kb-cleanup': { argvPrefix: ['agent', 'run', 'kb-cleanup'], logPrefix: 'kb-cleanup' },
};

/** Spawn one `<agentId>`-runner turn as a detached child (the scheduler-daemon
 *  spawn pattern). Best-effort + fire-and-forget — the runner checkpoints to
 *  the session dir and the relevant `broadcast*Changed` signal drives the UI
 *  re-fetch. `FORGE_ARCHITECT_NO_SPAWN=1` disables the spawn for harness /
 *  curl runs that pre-seed session state (mirrors `FORGE_BRIDGE_DEBUG`).
 *
 *  The runner's stderr (uncaught exceptions, SDK errors) is captured to
 *  `_logs/_<logPrefix>-<sid>/stderr.log` so stalls are diagnosable via the
 *  existing GET /api/<family>/file/<project>/<sid>/stderr.log endpoints.
 *
 *  R2-01-F3b: collapses the 4 near-byte-identical `spawn<X>Turn` helpers
 *  (architect/instructions/demo-builder/project-brain) that differed only in
 *  the CLI verb and the log-dir prefix — same guard, same detached-spawn
 *  shape, same argv per agent as before the collapse.
 *
 *  R2-01 final-review fix (e): guard `sessionId` against path traversal
 *  before it's used to build the `_logs/_<logPrefix>-<sessionId>/` dir name
 *  below — defense-in-depth on a pre-existing, F3b-renamed function (route
 *  handlers already 404 an unknown sessionId before spawning, plus the
 *  bridge's same-origin + `x-forge-csrf` guard, so this isn't closing an
 *  exploitable hole today). Reuses `isSafeRunId` — `orchestrator/run-agent.ts`'s
 *  `SAFE_RUN_ID_RE` + `..` check — as the SSOT rather than re-deriving it. */
// Exported (W6-B4) so packages/sessions/bridge-studio-sessions-affordances.ts's
// generic session-affordance write endpoint can DELEGATE to this SAME spawn
// helper instead of reimplementing it, injected via its AffordanceRouteContext
// (mirrors SessionsRouteContext's ensureSessionTail injection, in
// packages/sessions/bridge-studio-sessions.ts) — the sessions route modules
// never import FROM this file (see its own header for the reasoning), so this
// stays exported and passed by reference at the wiring call site, never
// imported directly.
//
// Both paths above were `cli/bridge-studio-{affordances,sessions}.ts` until the
// sessions carve moved them and ruling 87 deleted the affordances host file
// outright. The comment kept naming files that no longer existed; repointed
// with the M4-flows host carve.
export function spawnAgentTurn(forgeRoot: string, agentId: SpawnableAgentId, project: string, sessionId: string): SpawnTurnOutcome {
  // W7-C2 T1 review (A7) — this helper no longer swallows. Its outcome is
  // REPORTED to the caller (`SpawnTurnOutcome`, in
  // packages/sessions/bridge-studio-sessions-affordances.ts) so a route can
  // refuse to claim `{ok:true, phase:
  // 'analyzing'}` for a turn that never started; a session left in a working
  // phase with no log dir can never be derived as `stalled`
  // (packages/sessions/bridge-studio-lifecycle.ts), so a swallowed failure showed the
  // operator `working` forever with `needsYou:false`. A DELIBERATE no-spawn
  // (FORGE_ARCHITECT_NO_SPAWN / the dry bridge) is `ok` with
  // `spawned:false` — not a failure. Callers that genuinely have nothing to
  // do with the outcome ignore the return value exactly as before.
  if (process.env.FORGE_ARCHITECT_NO_SPAWN === '1' || isDryBridge()) return { ok: true, spawned: false };
  if (!isSafeRunId(sessionId)) {
    console.error(`spawnAgentTurn: unsafe sessionId (path-traversal risk), refusing to spawn: ${JSON.stringify(sessionId)}`);
    return { ok: false, error: 'unsafe sessionId (path-traversal risk) — refusing to spawn' };
  }
  const { argvPrefix, logPrefix } = SPAWN_AGENT_SPECS[agentId];
  try {
    const logDir = join(forgeRoot, '_logs', `_${logPrefix}-${sessionId}`);
    mkdirSync(logDir, { recursive: true });
    const stderrFd = openSync(join(logDir, 'stderr.log'), 'a');
    const proc = spawn(
      process.execPath,
      ['--experimental-strip-types', 'apps/forge/cli.ts', ...argvPrefix, sessionId, '--project', project],
      { cwd: forgeRoot, detached: true, stdio: ['ignore', 'ignore', stderrFd] },
    );
    closeSync(stderrFd);
    proc.unref();
    // W7-A2 — track the turn's pid so the generic cancel route
    // (packages/sessions/bridge-studio-session-cancel.ts → killTrackedTurn) can SIGTERM a
    // live turn, and the lifecycle derivation can tell "re-run in flight"
    // from "crashed" (isTurnAlive additionally proves ownership via the
    // sessionId in the process's own argv above). Same logDir, same guard
    // posture as stderr.log; best-effort like the rest of this helper.
    if (typeof proc.pid === 'number') {
      guardedWriteFile(join(forgeRoot, '_logs'), [`_${logPrefix}-${sessionId}`, 'turn.pid'], `${proc.pid}\n`);
    }
    return { ok: true, spawned: true };
  } catch (err) {
    // W7-C2 T1 review (A7) — surfaced, never swallowed: logged here for the
    // bridge operator AND returned so the route can answer honestly.
    console.error(`spawnAgentTurn: failed to start the ${agentId} turn for session ${sessionId}:`, err);
    return { ok: false, error: sanitizeError(err) };
  }
}

/**
 * Pure argv builder for `forge agent dispatch <slug> --run-id <runId> [...]`
 * (R6-04 WI-2 extraction, mirrors `parseAgentDispatchArgs`'s pure argv PARSER
 * on the other side of the CLI boundary, packages/agents/agent-run.ts). Extracted from
 * `spawnAgentDispatch` so the argv-building itself becomes independently
 * testable (no spawn, no mock) — this function has no side effects and
 * performs no safety checks of its own (`spawnAgentDispatch` still owns the
 * `isSafeRunId`/`SAFE_AGENT_SLUG_RE` refusal, unchanged, before ever calling
 * this). Returns EXACTLY the array `cmdAgentDispatch`'s `rest` parameter
 * expects (`[slug, '--run-id', runId, ...optional flags]`) — NOT the full
 * node-invocation array; `spawnAgentDispatch` still prepends the
 * process-invocation boilerplate (`--experimental-strip-types`,
 * `orchestrator/cli.ts`, `agent`, `dispatch`) around this helper's output.
 *
 * Input keys are filtered through `SAFE_INPUT_KEY_RE` here (defense-in-depth,
 * unchanged from before this extraction) so no arg injects a flag. Input
 * VALUES are arbitrary — safe as a single `k=v` arg since `spawn()` runs no
 * shell.
 */
export function buildAgentDispatchArgs(
  slug: string,
  runId: string,
  project?: string,
  inputs?: Record<string, string>,
  /** R4-17, D6/D7 — when given, threaded through as `forge agent dispatch`'s
   *  `--session-dir <abs>` so the dispatch process can write the terminal
   *  phase into that session's status.json when the run ends (D7). Omitted
   *  by the generic `POST /api/agents/:slug/run` route (D6: byte-identical
   *  behaviour without it) — only `POST /api/studio/onboarding/start` passes
   *  it today. `sessionDir` is always OUR OWN already-created, already-
   *  realpath-verified directory (never request-derived text folded in
   *  here), so no extra validation is needed at this spawn-arg boundary; the
   *  process on the receiving end (`cmdAgentDispatch`, packages/agents/agent-run.ts)
   *  guards its own write through it regardless.
   */
  sessionDir?: string,
  /** R6-04 (WI-2) — the operator's per-kickoff cost ceiling, already
   *  validated (finite, > 0, <= MAX_KICKOFF_COST_CEILING_USD) by the route
   *  before this is ever called. */
  costCeilingUsd?: number,
  /** Bead forge-c6h — the bridge's own SNAPSHOT `ctx.projectsRoot` (resolved
   *  once at `startBridge`), threaded through as `forge agent dispatch`'s
   *  `--projects-root <abs>` so the spawned subprocess's
   *  `writeSessionTerminalPhase` (packages/agents/agent-run.ts) can honour THIS exact
   *  root verbatim instead of re-deriving its own from `forge.config.json`/
   *  env at write time — the re-derivation was the defect (see that
   *  function's docstring). `cmdAgentDispatch` re-validates this value
   *  itself (absolute/exists/contained-in-forgeRoot) before trusting it, so
   *  no extra validation is needed at this spawn-arg boundary. */
  projectsRoot?: string,
): string[] {
  const args = [slug, '--run-id', runId];
  if (project) args.push('--project', project);
  for (const [k, v] of Object.entries(inputs ?? {})) {
    if (!SAFE_INPUT_KEY_RE.test(k)) continue;
    args.push('--input', `${k}=${v}`);
  }
  if (sessionDir) args.push('--session-dir', sessionDir);
  if (costCeilingUsd !== undefined) args.push('--cost-ceiling-usd', String(costCeilingUsd));
  if (projectsRoot) args.push('--projects-root', projectsRoot);
  return args;
}

/**
 * Spawn `forge agent dispatch <slug> --run-id <runId> [--project <p>] [--input
 * k=v …]` detached — the generic sibling of `spawnAgentTurn` (R2-01-F3
 * dispatch half). Dry-bridge / no-spawn guarded; best-effort (a spawn error
 * never bubbles into the request). slug/runId/project are pre-validated by the
 * route; input keys are re-checked in `buildAgentDispatchArgs` (defense-in-
 * depth) so no arg injects a flag.
 */
export function spawnAgentDispatch(
  forgeRoot: string,
  slug: string,
  runId: string,
  project?: string,
  inputs?: Record<string, string>,
  sessionDir?: string,
  costCeilingUsd?: number,
  /** Bead forge-c6h — see `buildAgentDispatchArgs`'s matching parameter. */
  projectsRoot?: string,
): void {
  // Argv construction is pure (no I/O, no side effects) — safe to build
  // above the spawn-suppression early-return below, so it stays observable
  // as ordinary function composition rather than something only a real spawn
  // attempt could exercise.
  const dispatchArgs = buildAgentDispatchArgs(slug, runId, project, inputs, sessionDir, costCeilingUsd, projectsRoot);
  if (process.env.FORGE_ARCHITECT_NO_SPAWN === '1' || isDryBridge()) return;
  if (!isSafeRunId(runId) || !SAFE_AGENT_SLUG_RE.test(slug)) {
    console.error(`spawnAgentDispatch: unsafe slug/runId, refusing to spawn: ${JSON.stringify({ slug, runId })}`);
    return;
  }
  const args = ['--experimental-strip-types', 'apps/forge/cli.ts', 'agent', 'dispatch', ...dispatchArgs];
  try {
    const logDir = join(forgeRoot, '_logs', runId);
    mkdirSync(logDir, { recursive: true });
    const stderrFd = openSync(join(logDir, 'stderr.log'), 'a');
    const proc = spawn(process.execPath, args, { cwd: forgeRoot, detached: true, stdio: ['ignore', 'ignore', stderrFd] });
    closeSync(stderrFd);
    proc.unref();
    // W7-B5 (agents-30): EVERY dispatch records its child pid at
    // `_logs/<runId>/turn.pid` so the cancel route (`POST /api/agents/runs/
    // :runId/cancel`) can reach it. Ownership proof at kill time is the
    // runId in the child's own argv (`--run-id <runId>` — a whole element),
    // via the same `isTurnAlive` the session cancel uses. Guarded write,
    // best-effort like stderr.log.
    if (typeof proc.pid === 'number') {
      guardedWriteFile(join(forgeRoot, '_logs'), [runId, 'turn.pid'], `${proc.pid}\n`);
    }
    // W7-FIX-A2 (W7A2-01) — a session-bound dispatch (`--session-dir
    // <projectsRoot>/<project>/_<kind>/<sid>`, today only onboarding) records
    // its pid where the generic cancel route looks: `_logs/_<kind>-<sid>/
    // turn.pid` (`sessionLogDirName`, packages/sessions/bridge-studio-lifecycle.ts — the
    // SAME template `spawnAgentTurn` uses). Before this, onboarding was the
    // one kind `killTrackedTurn` could never find, so cancel returned
    // `killed:false` and left the agent running. `isTurnAlive` proves
    // ownership through the `--session-dir` value's basename (the sid) in
    // the child's own argv. kind/sid are derived from the ALREADY-validated
    // sessionDir the route built (never request text); the guarded write
    // refuses anything that does not resolve under `_logs`. Best-effort like
    // stderr.log — never bubbles into the request.
    if (sessionDir !== undefined && typeof proc.pid === 'number') {
      const sid = basename(sessionDir);
      const kind = basename(dirname(sessionDir)).replace(/^_/, '');
      if (kind.length > 0 && isSafeRunId(sid)) {
        guardedWriteFile(join(forgeRoot, '_logs'), [sessionLogDirName(kind, sid), 'turn.pid'], `${proc.pid}\n`);
      }
    }
  } catch { /* best-effort */ }
}

/**
 * `POST /api/plan-verdict` — all that remains of the architect host handler.
 *
 * The five `/api/architect/*` arms carved to `@forge/sessions`
 * (`bridge-studio-architect.ts`); this one did NOT, and the reason is a
 * dependency measurement rather than an ownership opinion: `ctx.mergePr`,
 * `ctx.finalizeAfterMerge` and `ctx.queueRoot` appear in this whole function
 * only inside this arm, and the handler it delegates to is flows'
 * (`applyPlanVerdict`), which also serves `/api/runs/:id/gates/plan`.
 */
export async function handleArchitect(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ArchitectContext,
  url: string,
  method: string,
): Promise<boolean> {
  const origin = allowedOrigin(req);
  // POST /api/plan-verdict — delegates to applyPlanVerdict in bridge-studio.ts.
  if (method === 'POST' && url === '/api/plan-verdict') {
    try {
      const body = (await readJson(req)) as Record<string, unknown>;
      const planCtx: StudioPostContext = {
        readBody: async () => body,
        forgeRoot: ctx.forgeRoot,
        logsRoot: ctx.logsRoot,
        queueRoot: ctx.queueRoot,
        projectsRoot: ctx.projectsRoot,
        mergePr: ctx.mergePr,
        finalizeAfterMerge: ctx.finalizeAfterMerge,
        broadcastArchitectChanged: ctx.broadcastArchitectChanged, singleWiAllowedFor: (c: string) => peekInstalledFactory()?.singleWiAllowed(c) ?? null,
        spawnArchitectTurnFn: (forgeRoot, project, sessionId) => spawnAgentTurn(forgeRoot, 'architect', project, sessionId),
      };
      await applyPlanVerdict(req, res, planCtx, {
        project: typeof body['project'] === 'string' ? body['project'] : '',
        sessionId: typeof body['sessionId'] === 'string' ? body['sessionId'] : '',
        kind: (body['kind'] as 'approve' | 'revise' | 'reject') ?? 'reject',
        rationale: typeof body['rationale'] === 'string' ? body['rationale'] : undefined,
        entryRoute: '/api/plan-verdict',
      });
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  return false;
}

// ---- Instructions-creator routes (Stage A) --------------------------------
//
// Mirrors the architect routes: an operator-driven, file-checkpointed runner
// that authors a managed project's AGENTS.md (interview → draft → verdict →
// finalize). The bridge spawns one CLI turn per operator action via the
// shared `spawnAgentTurn(forgeRoot, 'instructions', project, sessionId)`.

// ---- Demo-builder routes (Stage B) ----------------------------------------
//
// Mirrors the instructions routes: an operator-driven, file-checkpointed runner
// that authors a managed project's DEMO.html (generate → review → lock). Unlike
// instructions (whose output lives in the session dir), the demo-builder agent
// writes DEMO.html into the PROJECT REPO under .forge/demo/ — so the file route
// serves from `project_repo_path`, not the session dir. The bridge spawns one
// CLI turn per operator action, via the shared
// `spawnAgentTurn(forgeRoot, 'demo-builder', project, sessionId)` — note the
// log-dir prefix stays `_demo-<sid>` (not `_demo-builder-<sid>`), matching
// the pre-collapse `spawnDemoBuilderTurn` exactly.

// R1-3b — the project-brain turn spawns via
// `spawnAgentTurn(forgeRoot, 'project-brain', project, sessionId)`.
