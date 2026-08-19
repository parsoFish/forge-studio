/**
 * The single generic interactive-turn runner (ADR-043 §2, R4-22 WI-3):
 * `runInteractiveTurn(descriptor, ctx)` is the ONE spine every future
 * `turnSpec`-bearing session kind runs through instead of a bespoke
 * `orchestrator/*-runner.ts` (architect-runner.ts / instructions-runner.ts /
 * demo-builder-runner.ts / project-brain-builder-runner.ts — all four stay
 * byte-for-byte untouched; ADR-043 §3's dispatch fork lives in
 * `cli/agent-run.ts`, NOT here).
 *
 * Owns, ONCE, everything those four duplicate:
 *   - the SEC-04 containment preamble: `resolveGuardedPath(projectRoot,
 *     [turnSpec.kindDir, sessionId])` -> `guardedReadSessionStatus`;
 *   - the ADR-024 spec/model/prompt derivation:
 *     `deriveAgentSpec(skillPathRelative(agent))` -> `resolveSessionModel`
 *     (ADR-043 §3 amendment, wave-6: honors an optional operator-chosen
 *     `status.modelTier` within the SKILL-declared envelope; absent ⇒ the
 *     same `modelForSpec` default as before) -> the tool grant, `SKILL.md`
 *     as the runtime prompt;
 *   - the shared telemetry: `createLogger` / `makeToolEventSink` /
 *     `flushIteration(1)` / a heartbeat writer / a reasoning sink;
 *   - the phase-table dispatch loop: read `status.phase` -> find its row in
 *     `turnSpec.phases` -> run the row's `step` (`agent` via the `style`
 *     primitive — `runAgentTurn` for `style: agent`, `runStructuredTurn` for
 *     `style: structured`; `noop`; `finalize` via the named finalizer;
 *     `terminal`) -> advance to `next`.
 *
 * Modeled on `orchestrator/project-brain-builder-runner.ts` and
 * `orchestrator/instructions-runner.ts` (the closest analogues); reuses their
 * shared helpers in `orchestrator/interactive-session.ts` rather than
 * re-implementing them.
 *
 * ---------------------------------------------------------------------------
 * Two design calls this WI had to make that ADR-043 / the WI-3 brief leave
 * open (stated explicitly, per this initiative's own precedent) — REVISED
 * by the R4-22 WI-3 adversarial-review round's Finding 5 ruling (superseding
 * this file's own original design call #1, which used `skillsDir`):
 * ---------------------------------------------------------------------------
 *
 *   1. `FinalizerContext.libraryRoot` — Finding 5 (reviewer-proven): the
 *      original `skillsDir(forgeRoot)` wrote into `<forgeRoot>/skills`, the
 *      LIVE tree production agent discovery actually scans
 *      (`listAgentDefinitions`/`discoverRuntimeAgentIds` —
 *      `orchestrator/flow-runner.ts:1285`, `cli/ui-bridge.ts:1678` — promote
 *      ANY dir whose `SKILL.md` carries a `runtime:` key to a dispatchable
 *      agent, no slug gate). Ruling: the destination is now a dedicated,
 *      NON-scanned root, `<forgeRoot>/_interactive-library/<packageId>/...`
 *      — underscore-prefixed, matching the repo's `_queue`/`_logs`
 *      convention for non-registry dirs. Resolved through the SAME guard as
 *      before (`resolveGuardedPath(forgeRoot, [INTERACTIVE_LIBRARY_DIRNAME])`
 *      + a GUARD-TERMINAL `mkdirSync` of its own `.realPath` when absent —
 *      never inventing a new root to sidestep "does not exist"); `skillsDir`
 *      / `hooksDir` are no longer touched by this file at all, so a fresh
 *      `forgeRoot`'s `skills/` is never created as a side effect of a
 *      finalize that never needed it. PROVISIONAL: this destination is
 *      superseded once R4-21 wires the draft-gated `installSkillPackage`
 *      path onto a permanent library location.
 *   2. `FinalizerContext.packageId` — request-derived, so it MUST ride as its
 *      own guarded segment (never folded into `libraryRoot`; the finalizer's
 *      own `resolveGuardedPath(libraryRoot, [packageId, ...])` call is what
 *      actually enforces this). Finding 5(c) (reviewer-proven): the ORIGINAL
 *      `packageId: ctx.sessionId` ran through only `resolveGuardedPath`'s
 *      generic `isSafeSegment` — unlike every other writer into a package
 *      tree (which slug-validates via `SLUG_RE`/`assertSkillSlug`), so a raw
 *      session id landed as a directory name verbatim. Ruling: `packageId`
 *      MUST now be `SLUG_RE`-valid or the turn refuses loudly. Derivation:
 *      prefer the session's OWN declared identity — `status.package_id` when
 *      it is present as a string (the "declared package id" the session
 *      status itself carries) — falling back to `ctx.sessionId` (the
 *      already-SEC-04-checked request identity) only when `status` carries
 *      no such field; whichever value that resolves to is then validated
 *      against `SLUG_RE` and used UNMODIFIED — this file never sanitizes or
 *      invents a substitute slug. NOTE (stated honestly, not silently
 *      resolved): `SLUG_RE` requires a leading lowercase letter, so an
 *      ISO-timestamp-shaped session id (e.g. `2026-08-10T00-00-00`) is NOT a
 *      valid slug and a `committing` turn for such a session now refuses at
 *      the finalize step — this is the Finding-5(c) ruling applied
 *      faithfully, not an oversight; see this WI's report for the one
 *      pinned-suite fixture (AT-3, `interactive-runner.test.ts`) that shares
 *      exactly this fixture shape with Finding 5(c) and is affected by it.
 *
 * `result.artifacts` is deliberately always `{}` — ADR-043's signature
 * (`Record<string, unknown>`) states no key contract, and the pinned test
 * suite (`interactive-runner.test.ts`) explicitly leaves it unasserted
 * rather than guessing one.
 */

import { readFileSync, readdirSync, lstatSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { pinnedSdkQuery as sdkQuery } from './pinned-sdk-query.ts';

import {
  runAgentTurn,
  guardedReadSessionStatus,
  guardedWriteSessionStatus,
  cancelledPhaseWins,
  CANCELLED_PHASE,
  makeHeartbeatWriter,
  makeReasoningSink,
  makeThinkingSink,
  type QueryFn,
  type BashFenceMode,
} from './interactive-session.ts';
import { createLogger, type EventLogger, type Phase } from './logging.ts';
import { resolveGuardedPath } from '../cli/studio-path-guard.ts';
import { makeToolEventSink } from './tool-event-emit.ts';
import { resolveSessionModel, type ModelTier } from './phase-agent.ts';
import { deriveAgentSpec } from './studio/derive.ts';
import { skillPath, skillPathRelative, SLUG_RE } from './skill-path.ts';
import { resolveFinalizer, type FinalizerContext } from './interactive-finalizers.ts';
import { BASH_FENCE_MODES, bashFenceModeState, type SessionKindDescriptor, type TurnSpec, type TurnSpecPhase } from './studio/session-kinds.ts';

/**
 * Named error type for this module (mirrors `interactive-finalizers.ts`'s
 * own `InteractiveFinalizerError` convention — same shape, deliberately NOT
 * cross-imported, so this module's error identity stays local). Every throw
 * this file adds for the R4-22 WI-3 adversarial-review findings (ghost
 * `next`, a guard-rejected `writes:` entry, a non-slug `packageId`) uses
 * this class so a caller can distinguish "the runner refused this turn" from
 * an unrelated crash bubbling up through the same call.
 */
export class InteractiveRunnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InteractiveRunnerError';
    // Belt-and-suspenders under ES5-target transpilation — see
    // InteractiveFinalizerError's identical comment for why this matters.
    Object.setPrototypeOf(this, InteractiveRunnerError.prototype);
  }
}

/** Finding 5's dedicated, NON-scanned finalize-destination root — see the
 *  header note. Underscore-prefixed, matching `_queue`/`_logs`. PROVISIONAL:
 *  superseded once R4-21 wires the draft-gated `installSkillPackage` path. */
const INTERACTIVE_LIBRARY_DIRNAME = '_interactive-library';

/** No dedicated `interactive`/`session` Phase value exists in the closed
 *  `Phase` union (`orchestrator/logging.ts`) — adding one is out of this
 *  file's scope (logging.ts is not one of this WI's two files). `orchestrator`
 *  is the generic, non-committal bucket for cross-cutting spine plumbing. */
const RUNNER_PHASE: Phase = 'orchestrator';
const RUNNER_SKILL = 'interactive-runner';

// W6-B1: interactive sessions are operator-attended, low-volume turns (one
// turn per bridge action) — unlike the unattended dev-loop/PM/reflector phases
// `createToolEventSampler` also backs, there is no wedged-loop risk to guard
// against here, so `makeToolEventSink`'s sampler opts below pass tool-use
// events through effectively unsampled (rate 1) with a generous cap. The same
// literal opts are passed, per-runner (not a shared export — one line each,
// no new orchestrator surface), by the four legacy interactive runners +
// brain-fix-runner. The unattended flow phases (pm/dev/reflector bindings)
// are UNCHANGED and keep the sampler's defaults.

/** Generic over any `{ phase: string, … }` JSON — mirrors how
 *  `guardedReadSessionStatus<S>` is generic in interactive-session.ts. Every
 *  real session-kind status shape (InstructionsStatus, ProjectBrainStatus,
 *  a future turnSpec-driven status) satisfies this structurally. An optional
 *  `modelTier` (ADR-043 §3 amendment, wave-6) rides here structurally too —
 *  the bridge's kickoff route already validated it before it ever reached
 *  disk (see `resolveKickoffModelTier`, cli/ui-bridge.ts), so this module
 *  only needs to READ it back, never re-validate its shape. */
export type InteractiveTurnStatus = { phase: string } & Record<string, unknown>;

/** Pull `status.modelTier` back out as a (loosely-typed) requested tier for
 *  `resolveSessionModel`. Deliberately does NOT pre-filter an unrecognised
 *  string here — `resolveSessionModel` is the one place that validates it
 *  against the SKILL-declared envelope and throws naming the allowed set;
 *  duplicating that check here would just be a second, weaker copy of it.
 *  Only a non-string (or absent) value degrades to `undefined` — that is
 *  "no request was made," not "an invalid request," and `status.json` is
 *  never hand-authored, so a non-string `modelTier` can only mean corrupt
 *  session state, not a request this turn should refuse over. */
function readRequestedModelTier(status: InteractiveTurnStatus): ModelTier | undefined {
  const raw = status.modelTier;
  return typeof raw === 'string' ? (raw as ModelTier) : undefined;
}

export type RunInteractiveTurnCtx = {
  sessionId: string;
  projectRoot: string;
  /** Forge install root (finalizer library root, log root default). Defaults
   *  to `resolve('.')` — NOT threaded into skill/agent-spec resolution (see
   *  header note — those always resolve against the real forge install). */
  forgeRoot?: string;
  /** Inject a fake `query` for tests. Defaults to the SDK. */
  queryFn?: QueryFn;
  /** `_logs/` root; defaults to `<forgeRoot>/_logs`. */
  logsRoot?: string;
  /** Logger override (tests). */
  logger?: EventLogger;
};

export type RunInteractiveTurnResult = {
  phase: string;
  wrote: string[];
  artifacts: Record<string, unknown>;
};

export async function runInteractiveTurn(
  descriptor: SessionKindDescriptor,
  ctx: RunInteractiveTurnCtx,
): Promise<RunInteractiveTurnResult> {
  const turnSpec = descriptor.turnSpec;
  if (!turnSpec) {
    throw new Error(
      `runInteractiveTurn: session kind "${descriptor.id}" has no turnSpec — this runner only drives turnSpec-bearing descriptors (ADR-043 §1).`,
    );
  }

  // -------------------------------------------------------------------------
  // SEC-04 containment preamble — BEFORE any read/write. `kindDir` and
  // `sessionId` each ride as their OWN segment against the trusted
  // `projectRoot` root; never folded into it (the guard's own CONTRACT).
  // -------------------------------------------------------------------------
  const dirSegments = [turnSpec.kindDir, ctx.sessionId];
  const guarded = resolveGuardedPath(ctx.projectRoot, dirSegments);
  if (!guarded.ok) {
    throw new Error(
      `runInteractiveTurn: session dir failed containment for session kind "${descriptor.id}" / session "${ctx.sessionId}" (${guarded.reason}). Has the session been started?`,
    );
  }
  const sessionDir = guarded.realPath;

  // SEC-04 leaf: route the status.json READ through the guarded sibling
  // (leaf included) so a symlinked/hardlinked status.json inside the real,
  // contained session dir is refused too.
  const status = guardedReadSessionStatus<InteractiveTurnStatus>(ctx.projectRoot, dirSegments);
  if (!status) {
    throw new Error(
      `runInteractiveTurn: no status.json at ${sessionDir} for session kind "${descriptor.id}". Has the session been started?`,
    );
  }

  // -------------------------------------------------------------------------
  // Phase-table dispatch — an unhandled status.phase fails LOUD, naming it
  // (the declared-data-fails-open antipattern this campaign guards against).
  // -------------------------------------------------------------------------
  const phaseRow = turnSpec.phases.find((p) => p.phase === status.phase);
  if (!phaseRow) {
    const known = turnSpec.phases.map((p) => p.phase).join(', ') || '(none declared)';
    throw new Error(
      `runInteractiveTurn: session kind "${descriptor.id}" turnSpec.phases has no row for phase "${status.phase}" (session ${ctx.sessionId}). Known phases: ${known}.`,
    );
  }

  const forgeRoot = ctx.forgeRoot ?? resolve('.');
  const logsRoot = ctx.logsRoot ?? resolve(forgeRoot, '_logs');
  // The event-log DIRECTORY is `_<descriptor.id>-<sessionId>` — the convention
  // every consumer of an interactive session's live log already derives
  // independently, and which the spine must therefore match rather than invent:
  //   - `forge-ui/app/sessions/[kind]/[sessionId]/page.tsx` builds
  //     `` `_${kind}-${sessionId}` `` and hands it to `useCycleEvents`;
  //   - `cli/ui-bridge.ts`'s `spawnAgentTurn` writes THIS SAME TURN's
  //     `stderr.log` into `` `_logs/_${logPrefix}-${sessionId}` ``, where
  //     `SPAWN_AGENT_SPECS.authoring.logPrefix === 'authoring'`;
  //   - the four legacy `ensure*Tail` helpers use `_architect-` /
  //     `_instructions-` / `_demo-` / `_project-brain-`.
  // This previously read `_interactive-<id>-<sid>`, which agreed with NOTHING:
  // an `authoring` turn's events landed in `_interactive-authoring-<sid>` while
  // its own stderr landed in `_authoring-<sid>`, and both the UI and
  // `readSessionLogFacts` (`cli/ui-bridge.ts`, the session list's `when`/`costUsd`)
  // looked in the latter and found no events file at all — so a failed turn's two
  // halves sat in different directories and every authoring row reported an
  // honest-absent timestamp.
  //
  // PRECISION, because "the live panel is fixed" would overclaim (measured by the
  // WI's adversarial review): `use-cycle-events.ts` takes a one-shot REST snapshot
  // (`GET /api/events/<cycleId>`) that is independent of the tail machinery, so
  // after this change the panel DOES render real accumulated events on page load.
  // Live incremental push still never fires for `authoring`, because no
  // `ensureAuthoringTail` call site exists anywhere (only the four legacy kinds
  // have one) — tracked separately, deliberately not fixed here. `costUsd` also
  // stays `null`: this spine emits no `cost_usd` on any event, tracked separately.
  // Pinned by AT-a/AT-b
  // (`cli/agent-run.test.ts`) and by the co-location ratchet
  // (`cli/agent-run-log-dir-colocation.test.ts`), which fails if this template
  // and the bridge's `logDir` template ever resolve differently again.
  //
  // Consequence, deliberate: for a kind id that also names a legacy runner, this
  // directory is now INDISTINGUISHABLE from that runner's own — which is exactly
  // what a future R4-22-F4 migration needs (the log dir survives the migration),
  // and is why the tests' "which road did the fork take" discriminator moved off
  // the directory name and onto `RUNNER_SKILL` below, which no legacy runner emits.
  //
  // `initiativeId` is an event FIELD, not a directory, and no consumer derives it
  // — it keeps its `interactive-` marker so the spine's events stay identifiable
  // once the directory name no longer distinguishes them.
  const cycleId = `_${descriptor.id}-${ctx.sessionId}`;
  const initiativeId = `interactive-${descriptor.id}-${ctx.sessionId}`;
  const logger = ctx.logger ?? createLogger(cycleId, logsRoot);
  const queryFn: QueryFn = ctx.queryFn ?? (sdkQuery as unknown as QueryFn);

  const startEv = logger.emit({
    initiative_id: initiativeId,
    phase: RUNNER_PHASE,
    skill: RUNNER_SKILL,
    event_type: 'start',
    input_refs: [join(sessionDir, 'status.json')],
    output_refs: [],
    message: `interactive turn (kind=${descriptor.id}, phase=${status.phase}, step=${phaseRow.step})`,
    metadata: { session_id: ctx.sessionId, session_kind: descriptor.id, phase: status.phase, step: phaseRow.step },
  });

  const sink = makeToolEventSink(
    logger,
    {
      initiativeId,
      parentEventId: startEv.event_id,
      phase: RUNNER_PHASE,
      skill: RUNNER_SKILL,
    },
    { readOnlySampleRate: 1, cap: 200 },
  );
  const onHeartbeat = makeHeartbeatWriter(join(logsRoot, cycleId));
  const sinkCtx = { initiativeId, phase: RUNNER_PHASE, skill: RUNNER_SKILL, idMeta: { session_id: ctx.sessionId } };
  const onText = makeReasoningSink(logger, sinkCtx);
  const onThinking = makeThinkingSink(logger, sinkCtx);

  let result: RunInteractiveTurnResult;

  switch (phaseRow.step) {
    case 'noop':
    case 'terminal':
      // No `next` is ever declared on a noop/terminal row in practice
      // (ADR-043's worked example); even if one were, a noop/terminal step
      // performs no work to justify advancing on — the phase stays put.
      result = { phase: status.phase, wrote: [], artifacts: {} };
      break;

    case 'agent':
      result = await runAgentStyleStep({
        descriptor,
        turnSpec,
        phaseRow,
        ctx,
        sessionDir,
        dirSegments,
        status,
        queryFn,
        onToolUse: sink.onToolUse,
        onHeartbeat,
        onText,
        onThinking,
      });
      break;

    case 'finalize':
      result = await runFinalizeStep({
        descriptor,
        turnSpec,
        phaseRow,
        ctx,
        sessionDir,
        dirSegments,
        status,
        forgeRoot,
      });
      break;

    default:
      throw new Error(
        `runInteractiveTurn: session kind "${descriptor.id}" turnSpec phase "${phaseRow.phase}" declares unknown step "${phaseRow.step}" — expected one of agent|noop|finalize|terminal.`,
      );
  }

  sink.flushIteration(1);
  logger.emit({
    initiative_id: initiativeId,
    parent_event_id: startEv.event_id,
    phase: RUNNER_PHASE,
    skill: RUNNER_SKILL,
    event_type: 'end',
    input_refs: [],
    output_refs: result.wrote,
    message: `interactive turn end (kind=${descriptor.id}, phase=${result.phase})`,
    metadata: { session_id: ctx.sessionId, session_kind: descriptor.id, phase: result.phase },
  });
  return result;
}

/**
 * bead forge-eip (W6-CR-3) — derives `runAgentTurn`'s `writeRoots` from the
 * phase row's OWN declared `writes:` entries, never a hardcoded `staging`
 * literal (so kb-cleanup's `plan/` gets the identical fence authoring's/
 * community-refresh's `staging/` does — this is a spine fix, not a
 * per-kind one). Each declared dir name is resolved through the SAME
 * `resolveGuardedPath` containment guard every other write in this file
 * uses, GUARD-TERMINAL `mkdirSync`'d into existence if absent — mirrors
 * `runFinalizeStep`'s own `libraryRootGuard` pattern exactly — so
 * `runAgentTurn`'s fence always has a REAL, already-existing root to
 * realpath at turn start, never a not-yet-created path a symlink could
 * race into being ahead of the agent's very first write.
 *
 * A guard-rejected dir name throws rather than silently degrading to an
 * empty (fence-disabling) `writeRoots` list — `writes:` entries are
 * forge-authored data (studio/session-kinds.yaml), never request data, so
 * a rejection here can only mean a malformed session-kinds row, which
 * should fail loud at the first turn that reaches it, not silently ship a
 * kind with no fence.
 */
function resolveWriteRoots(sessionDir: string, writesDirs: readonly string[]): string[] {
  const roots: string[] = [];
  for (const dirName of writesDirs) {
    const guarded = resolveGuardedPath(sessionDir, [dirName]);
    if (!guarded.ok) {
      throw new InteractiveRunnerError(
        `runInteractiveTurn: declared writes entry "${dirName}" failed containment (${guarded.reason}) while provisioning the write-root fence.`,
      );
    }
    if (!guarded.exists) {
      mkdirSync(guarded.realPath, { recursive: true });
    }
    roots.push(guarded.realPath);
  }
  return roots;
}

/**
 * W7-FIX-A2 (W7A2-03, bead forge-w08) — the ONE authored Bash switch,
 * `turnSpec.bashFence` (studio/session-kinds.yaml), threaded to
 * `runAgentTurn`. Absent ⇒ `deny` (a fenced kind that did not opt in has no
 * ungated write-capable tool). A value outside BASH_FENCE_MODES is a studio
 * lint ERROR already; here it fails LOUD rather than being read as either
 * mode — declared data never fails open.
 */
function resolveBashFence(turnSpec: TurnSpec): BashFenceMode {
  const raw = turnSpec.bashFence;
  if (raw === undefined) return 'deny';
  const known = bashFenceModeState(raw);
  if (known === 'deny' || known === 'inspect') return known;
  throw new InteractiveRunnerError(
    `runInteractiveTurn: turnSpec.bashFence "${raw}" is not one of ${BASH_FENCE_MODES.map((m) => m.id).join(', ')} — refusing to start the turn (studio lint reports this).`,
  );
}

// ---------------------------------------------------------------------------
// step: agent — dispatches on turnSpec.style (runAgentTurn | runStructuredTurn)
// ---------------------------------------------------------------------------

async function runAgentStyleStep(args: {
  descriptor: SessionKindDescriptor;
  turnSpec: TurnSpec;
  phaseRow: TurnSpecPhase;
  ctx: RunInteractiveTurnCtx;
  sessionDir: string;
  dirSegments: string[];
  status: InteractiveTurnStatus;
  queryFn: QueryFn;
  onToolUse: Parameters<typeof runAgentTurn>[0]['onToolUse'];
  onHeartbeat: () => void;
  onText: (text: string) => void;
  onThinking: (text: string) => void;
}): Promise<RunInteractiveTurnResult> {
  const { descriptor, turnSpec, phaseRow, ctx, sessionDir, dirSegments, status, queryFn, onToolUse, onHeartbeat, onText, onThinking } = args;

  // ADR-024: spec/model/prompt derivation from the agent's OWN SKILL.md —
  // resolved against the real forge install (deriveAgentSpec's default root),
  // never `ctx.forgeRoot` — the agent/skill roster is part of the forge
  // install, not per-project/per-test data (see header note).
  const agentSpec = deriveAgentSpec(skillPathRelative(descriptor.agent));
  const model = resolveSessionModel(agentSpec, readRequestedModelTier(status));
  const skill = readSkillPrompt(descriptor.agent);
  const prompt = buildTurnPrompt(descriptor, phaseRow, status, skill);

  if (turnSpec.style === 'agent') {
    // bead forge-eip (W6-CR-3) — a REAL write-root fence, derived from THIS
    // phase row's own declared `writes:` (never hardcoded to `staging`, so
    // kb-cleanup's `plan/` gets the identical protection authoring's/
    // community-refresh's `staging/` does). Absent/empty `writes:` yields an
    // empty writeRoots, which `runAgentTurn` correctly reads as "no fence" —
    // matching this phase's pre-existing behaviour (an `agent` step with no
    // declared writes, e.g. a Q&A-only turn, never needed one).
    const writeRoots = resolveWriteRoots(sessionDir, phaseRow.writes ?? []);
    await runAgentTurn({
      queryFn,
      prompt,
      cwd: sessionDir,
      model,
      allowedTools: agentSpec.allowedTools,
      disallowedTools: agentSpec.disallowedTools,
      writeRoots,
      bashFence: resolveBashFence(turnSpec),
      onToolUse,
      onHeartbeat,
      onText,
      onThinking,
      label: `interactive-${descriptor.id}-${ctx.sessionId}`,
    });
  } else if (turnSpec.style === 'structured') {
    // No schema registry exists yet — SCHEMA_IDS ships empty (R4-22 WI-1's
    // own deliberately-green gap-pin, orchestrator/studio/session-kinds.ts).
    // Fail LOUD rather than fabricate a schema or silently fall back to the
    // agent primitive — the declared-data-fails-open shape this campaign
    // guards against.
    throw new Error(
      `runInteractiveTurn: session kind "${descriptor.id}" turnSpec.style is "structured", but no schema registry is wired yet (turnSpec.schema="${turnSpec.schema ?? '(none)'}"). No structured-style turnSpec consumer exists; wire a schema resolver before shipping one.`,
    );
  } else {
    throw new Error(
      `runInteractiveTurn: session kind "${descriptor.id}" turnSpec.style "${turnSpec.style}" is unrecognised — expected "agent" or "structured".`,
    );
  }

  const wrote = listWrittenFiles(sessionDir, phaseRow.writes ?? []);
  // P1 fix (declared-data-fails-open, live adversarial-review finding): a
  // phase row that DECLARES a non-empty `writes:` must have SOMETHING to
  // show for it — a declared `writes:` dir that never appeared and one that
  // exists but is empty are the SAME "the turn produced nothing" shape (see
  // listWrittenFiles's own carve-out comment for why both collapse to
  // `wrote: []` here). Refuse loudly, BEFORE assertNextPhaseKnown/persisting
  // `next`, rather than silently advancing the session to an operator-facing
  // empty package. A phase row that declares NO `writes:` at all is the true
  // surviving carve-out — this only fires when `writes:` IS declared.
  if ((phaseRow.writes?.length ?? 0) > 0 && wrote.length === 0) {
    throw new InteractiveRunnerError(
      `runInteractiveTurn: session kind "${descriptor.id}" phase "${phaseRow.phase}" declares writes: [${(phaseRow.writes ?? []).join(', ')}], but the turn produced no files there — refusing to advance the session with an empty package rather than persisting a ghost turn to status.json.`,
    );
  }
  // Finding 1 fix: validate `next` BEFORE persisting it — see
  // assertNextPhaseKnown's own doc comment.
  assertNextPhaseKnown(descriptor, turnSpec, phaseRow);
  const nextPhase = phaseRow.next ?? status.phase;
  if (phaseRow.next) {
    writeStatus(ctx.projectRoot, dirSegments, { ...status, phase: phaseRow.next });
  }
  return { phase: nextPhase, wrote, artifacts: {} };
}

// ---------------------------------------------------------------------------
// step: finalize — resolves the named finalizer against FINALIZERS (never a
// hardcoded switch) and runs it.
// ---------------------------------------------------------------------------

async function runFinalizeStep(args: {
  descriptor: SessionKindDescriptor;
  turnSpec: TurnSpec;
  phaseRow: TurnSpecPhase;
  ctx: RunInteractiveTurnCtx;
  sessionDir: string;
  dirSegments: string[];
  status: InteractiveTurnStatus;
  forgeRoot: string;
}): Promise<RunInteractiveTurnResult> {
  const { descriptor, turnSpec, phaseRow, ctx, sessionDir, dirSegments, status, forgeRoot } = args;

  const finalizerId = phaseRow.finalizer;
  if (!finalizerId) {
    throw new InteractiveRunnerError(
      `runInteractiveTurn: session kind "${descriptor.id}" turnSpec phase "${phaseRow.phase}" declares step "finalize" but no finalizer id.`,
    );
  }
  const finalizerFn = resolveFinalizer(finalizerId);
  if (!finalizerFn) {
    throw new InteractiveRunnerError(
      `runInteractiveTurn: session kind "${descriptor.id}" turnSpec phase "${phaseRow.phase}" names finalizer "${finalizerId}", which is not registered in FINALIZERS.`,
    );
  }

  // packageId — Finding 5(c): the "declared package id" the session status
  // itself carries (`status.package_id`, when present as a string) is
  // preferred over the raw request identity `ctx.sessionId`; either way the
  // resolved value MUST be `SLUG_RE`-valid or this refuses loudly — never
  // silently sanitized/invented (see header note design call #2).
  const statusPackageId = (status as Record<string, unknown>).package_id;
  const rawPackageId = typeof statusPackageId === 'string' ? statusPackageId : ctx.sessionId;
  if (!SLUG_RE.test(rawPackageId)) {
    throw new InteractiveRunnerError(
      `runInteractiveTurn: finalize packageId "${rawPackageId}" is not a valid slug (must match ${SLUG_RE.source}) — refusing rather than silently accepting it into an oddly-named library directory.`,
    );
  }

  // libraryRoot — Finding 5(a)/(b): a dedicated, NON-scanned root, never
  // `skillsDir`/`hooksDir` (see header note design call #1). May legitimately
  // not exist yet (a fresh forge install / a test fixture); ensure it via a
  // GUARD-TERMINAL mkdirSync rather than inventing a root.
  const libraryRootGuard = resolveGuardedPath(forgeRoot, [INTERACTIVE_LIBRARY_DIRNAME]);
  if (!libraryRootGuard.ok) {
    throw new InteractiveRunnerError(
      `runInteractiveTurn: finalizer library root failed containment (${libraryRootGuard.reason}).`,
    );
  }
  if (!libraryRootGuard.exists) {
    mkdirSync(libraryRootGuard.realPath, { recursive: true });
  }
  const libraryRoot = libraryRootGuard.realPath;

  const finalizerCtx: FinalizerContext = {
    sessionDir,
    forgeRoot,
    libraryRoot,
    packageId: rawPackageId,
  };

  const wrote = await finalizerFn(finalizerCtx);
  // Finding 1 fix: validate `next` BEFORE persisting it — see
  // assertNextPhaseKnown's own doc comment. The finalizer above already ran
  // to completion (a successful copy); this only gates what happens to
  // status.json AFTER that success.
  assertNextPhaseKnown(descriptor, turnSpec, phaseRow);
  const nextPhase = phaseRow.next ?? status.phase;
  if (phaseRow.next) {
    writeStatus(ctx.projectRoot, dirSegments, { ...status, phase: phaseRow.next });
  }
  return { phase: nextPhase, wrote, artifacts: {} };
}

// ---------------------------------------------------------------------------
// Finding 1 — shared `next` validation for both call sites above.
// ---------------------------------------------------------------------------

/**
 * `phaseRow.next` must name a real row in `turnSpec.phases` BEFORE it is
 * ever persisted to status.json. Reviewer-reproduced: writing it
 * unconditionally let a session succeed a turn, land a ghost phase on disk,
 * and only throw the FOLLOWING turn (a session-bricking typo discovered one
 * turn late, recoverable only by hand-editing status.json). A phase that
 * declares no `next` at all (a legitimate terminal/awaiting row) is a no-op
 * here — this only fires when `next` IS declared but names nothing real.
 */
function assertNextPhaseKnown(descriptor: SessionKindDescriptor, turnSpec: TurnSpec, phaseRow: TurnSpecPhase): void {
  if (!phaseRow.next) return;
  const known = turnSpec.phases.some((p) => p.phase === phaseRow.next);
  if (!known) {
    throw new InteractiveRunnerError(
      `runInteractiveTurn: session kind "${descriptor.id}" turnSpec phase "${phaseRow.phase}" declares next "${phaseRow.next}", which is not a phase present in turnSpec.phases — refusing to persist a ghost phase to status.json.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** SEC-04 leaf: guarded status.json write. Routes the WHOLE
 *  `<projectRoot>/<dirSegments...>/status.json` path (leaf included) through
 *  the containment guard and THROWS (fail closed) if the leaf escapes —
 *  never a silent skip.
 *
 *  W7-FIX-A2 (W7A2-01): the seam ALSO refuses when the on-disk phase is the
 *  reserved terminal `cancelled` and this write would move off it — the
 *  operator cancelled while the (possibly long) agent turn ran, and this
 *  runner's `{ ...status, phase: next }` is a STALE pre-turn object. The two
 *  refusals are told apart by re-reading the on-disk status: a sticky-cancel
 *  refusal throws a NAMED `InteractiveRunnerError` (so stderr.log records
 *  that a turn finished after the cancel and its advance was discarded —
 *  the lifecycle derivation still reads `terminal`, never `crashed`, because
 *  terminal wins), a containment refusal keeps its own message. */
function writeStatus(projectRoot: string, dirSegments: readonly string[], status: InteractiveTurnStatus): void {
  const p = guardedWriteSessionStatus(projectRoot, dirSegments, status);
  if (p === null) {
    const onDisk = guardedReadSessionStatus<{ phase?: unknown }>(projectRoot, dirSegments);
    if (onDisk !== null && cancelledPhaseWins(onDisk.phase, status.phase)) {
      throw new InteractiveRunnerError(
        `runInteractiveTurn: the session was cancelled (phase "${CANCELLED_PHASE}") while this turn ran — the turn's advance to "${status.phase}" is discarded and status.json stays cancelled (the terminal cancelled phase is sticky).`,
      );
    }
    throw new Error(
      'runInteractiveTurn: status.json write failed containment (symlinked/escaping leaf) — refusing to write.',
    );
  }
}

/** Recursively enumerate every FILE under `<sessionDir>/<dirName>` for each
 *  declared `writes` entry, routing every discovered segment — directories
 *  included, before ever descending into one — through `resolveGuardedPath`
 *  anchored at the already SEC-04-guarded `sessionDir` (mirrors
 *  `interactive-finalizers.ts`'s own `discoverStagingEntries` walk: the same
 *  guard, reused, never reimplemented).
 *
 *  Finding 2/3 fix: a guard-rejected entry — a symlink planted inside an
 *  otherwise-real `writes:` dir, or the declared `writes:` dir itself being
 *  a symlink pointing outside the session — used to be silently dropped
 *  (`if (p === null) continue`), collapsing `result.wrote` to a silent
 *  under-report indistinguishable from the LEGITIMATE "this phase hasn't
 *  populated `writes:` yet" case. Every guard rejection now throws a NAMED
 *  error identifying the offending entry, matching
 *  `discoverStagingEntries`'s own convention — EXCEPT at the top level,
 *  where a `writes:` dir that genuinely does not exist yet (`resolveGuardedPath`
 *  reports `exists:false`, not a rejection) is the deliberate carve-out that
 *  must survive this fix: still no entries, still no throw. A NESTED entry
 *  that vanishes between its parent's `readdirSync` and its own guard check
 *  is a genuine TOCTOU race, not that same legitimate case, so it throws
 *  too — mirroring `discoverStagingEntries`'s own "vanished mid-walk". */
function listWrittenFiles(sessionDir: string, writesDirs: readonly string[]): string[] {
  const out: string[] = [];

  function walk(segments: string[], isTopLevel: boolean): void {
    const guarded = resolveGuardedPath(sessionDir, segments);
    if (!guarded.ok) {
      throw new InteractiveRunnerError(
        `runInteractiveTurn: writes entry "${segments.join('/')}" failed containment (${guarded.reason}) — refusing rather than silently dropping it from result.wrote.`,
      );
    }
    if (!guarded.exists) {
      if (isTopLevel) return; // legitimate: this phase hasn't populated this writes: dir yet
      throw new InteractiveRunnerError(
        `runInteractiveTurn: writes entry "${segments.join('/')}" vanished between being listed and its containment check.`,
      );
    }

    let st;
    try {
      // Safe: `guarded.realPath` is already identity-verified by
      // resolveGuardedPath above — this lstat is a pure file-vs-dir type
      // check on the real entry, not following anything new.
      st = lstatSync(guarded.realPath);
    } catch (err) {
      throw new InteractiveRunnerError(
        `runInteractiveTurn: writes entry "${segments.join('/')}" vanished after its containment check: ${(err as NodeJS.ErrnoException).message}`,
      );
    }

    if (st.isDirectory()) {
      let names: string[];
      try {
        names = readdirSync(guarded.realPath).sort();
      } catch (err) {
        throw new InteractiveRunnerError(
          `runInteractiveTurn: failed to list writes entry "${segments.join('/')}": ${(err as NodeJS.ErrnoException).message}`,
        );
      }
      for (const name of names) walk([...segments, name], false);
    } else if (st.isFile()) {
      out.push(guarded.realPath);
    } else {
      // A FIFO, socket, device node, etc. — never silently drop it.
      throw new InteractiveRunnerError(
        `runInteractiveTurn: writes entry "${segments.join('/')}" is neither a regular file nor a directory — refusing.`,
      );
    }
  }

  for (const dirName of writesDirs) walk([dirName], true);
  return out.sort();
}

/** Read `skills/<agentId>/SKILL.md` from the real forge install (default
 *  root — see header note). Falls back to a generic prompt if unreadable,
 *  matching `project-brain-builder-runner.ts`'s own `loadSkillPrompt`. */
function readSkillPrompt(agentId: string): string {
  const path = skillPath(agentId);
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return `You are the forge "${agentId}" agent.`;
  }
}

/** A generic, kind-agnostic turn prompt: the skill (single source of the
 *  agent's intent, ADR-024), which phase/step this turn is, where to write,
 *  and the current session status as read-only context. */
function buildTurnPrompt(
  descriptor: SessionKindDescriptor,
  phaseRow: TurnSpecPhase,
  status: InteractiveTurnStatus,
  skill: string,
): string {
  const writes = phaseRow.writes ?? [];
  return [
    skill,
    '',
    `## Your task this turn: the "${phaseRow.phase}" step of the "${descriptor.id}" session`,
    '',
    writes.length > 0
      ? `Write your output into the following sub-director${writes.length > 1 ? 'ies' : 'y'} of your working directory: ${writes.join(', ')}`
      : 'Write your output where the skill above instructs.',
    '',
    'Session status (read-only context):',
    '```json',
    JSON.stringify(status, null, 2),
    '```',
  ].join('\n');
}

// W6-B1 review round 2: the local makeReasoningSink/makeThinkingSink duplicates
// were removed — this file now consumes the ONE shared pair exported from
// interactive-session.ts (imported above), which also owns the per-turn
// SINK_ROW_CAP backstop and the raw-text (not truncated-text) coalescing fix.

// Re-export so callers don't need a second import for the shared QueryFn type.
export type { QueryFn } from './interactive-session.ts';
