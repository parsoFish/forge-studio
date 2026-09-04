/**
 * The single generic interactive-turn runner (ADR-043 §2, R4-22 WI-3):
 * `runInteractiveTurn(descriptor, ctx)` is the ONE spine every future
 * `turnSpec`-bearing session kind runs through instead of a bespoke
 * `orchestrator/*-runner.ts` (architect-runner.ts / instructions-runner.ts /
 * demo-builder-runner.ts / kinds/project-brain.ts — all four stay
 * byte-for-byte untouched; ADR-043 §3's dispatch fork lives in
 * `packages/agents/agent-run.ts`, NOT here).
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
 * Modeled on `packages/sessions/kinds/project-brain.ts` and
 * `packages/sessions/instructions-runner.ts` (the closest analogues); reuses their
 * shared helpers in `packages/sessions/interactive-session.ts` rather than
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
 *      `orchestrator/flow-runner.ts:1285`, `apps/forge/ui-bridge.ts:1678` — promote
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

import { join, resolve } from 'node:path';

import { makeHeartbeatWriter, makeReasoningSink, makeThinkingSink } from './interactive-session.ts';
import { guardedReadSessionStatus } from './session-status-io.ts';
import { createLogger, resolveGuardedPath } from '@forge/kernel';
import { makeToolEventSink } from '@forge/agents/tool-event-emit.ts';
import type { SessionKindDescriptor } from './studio/session-kinds.ts';
import {
  InteractiveRunnerError,
  RUNNER_PHASE,
  RUNNER_SKILL,
  runAgentStyleStep,
  runFinalizeStep,
  type InteractiveTurnStatus,
  type RunInteractiveTurnCtx,
  type RunInteractiveTurnResult,
} from './interactive-agent-step.ts';
export { InteractiveRunnerError, type InteractiveTurnStatus, type RunInteractiveTurnCtx, type RunInteractiveTurnResult };


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
  //   - `apps/studio/app/sessions/[kind]/[sessionId]/page.tsx` builds
  //     `` `_${kind}-${sessionId}` `` and hands it to `useCycleEvents`;
  //   - `apps/forge/ui-bridge.ts`'s `spawnAgentTurn` writes THIS SAME TURN's
  //     `stderr.log` into `` `_logs/_${logPrefix}-${sessionId}` ``, where
  //     `SPAWN_AGENT_SPECS.authoring.logPrefix === 'authoring'`;
  //   - the four legacy `ensure*Tail` helpers use `_architect-` /
  //     `_instructions-` / `_demo-` / `_project-brain-`.
  // This previously read `_interactive-<id>-<sid>`, which agreed with NOTHING:
  // an `authoring` turn's events landed in `_interactive-authoring-<sid>` while
  // its own stderr landed in `_authoring-<sid>`, and both the UI and
  // `readSessionLogFacts` (`apps/forge/ui-bridge.ts`, the session list's `when`/`costUsd`)
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
  // (`packages/agents/agent-run.test.ts`) and by the co-location ratchet
  // (`packages/agents/agent-run-log-dir-colocation.test.ts`), which fails if this template
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
        queryFn: ctx.queryFn,
        logger,
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
