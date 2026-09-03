/**
 * The step-handler variant driver — ADR 043 as amended 2026-09-03 (M4 ruling
 * 60).
 *
 * ADR 043's original plan was that every bespoke runner would eventually
 * become DATA: a `turnSpec` phase table the generic `runInteractiveTurn`
 * walks. Measured against the code (M4 sessions PARK 2, recorded in the ADR's
 * 2026-09-03 amendment) that is not reachable inside M4 — `style: structured`
 * is a stub behind an empty `SCHEMA_IDS`, the dispatchable finalizer set is
 * `copyStagingToLibrary` alone, `runFinalizeStep` slug-gates a `packageId`
 * that instructions sessions never carry, and `FinalizerContext` cannot reach
 * `status`. Four instructions behaviours and five architect ones have no
 * phase-table form at all.
 *
 * Ruling 60 took the other half of the ADR's own architect carve-out instead:
 * a runner that cannot become data becomes a **registered step-handler
 * variant**. This module is the half the variants SHARE — the turn plumbing
 * every bespoke runner had copied — and it owns nothing about any kind's
 * identity:
 *
 *   1. the SEC-04 containment preamble on `[kindDir, sessionId]`
 *   2. the guarded `status.json` read and its two refusals
 *   3. `forgeRoot` / `logsRoot` defaulting
 *   4. `cycleId` / `initiativeId` derivation
 *   5. `createLogger` defaulting
 *   6. `queryFn` defaulting to the pinned SDK query
 *   7. the `start` event
 *   8. `makeToolEventSink` with the interactive `{readOnlySampleRate:1, cap:200}` opts
 *   9. `makeHeartbeatWriter`
 *  10. `makeThinkingSink`
 *  11. `sink.flushIteration(1)` and the `end` event
 *  12. the guarded status WRITE, including the sticky-`cancelled` refusal
 *  13. `sdkHooksForAgent` wiring, so no kind can spawn hook-blind
 *  14. `makeReasoningSink`
 *  15. reading `feedback.md` and CONSUMING IT ONCE
 *
 * What stays with the kind (`packages/sessions/kinds/<id>.ts`) is its
 * IDENTITY: which phases exist, which of them do work, which skill and agent
 * spec they compose, what each step writes, and what the turn returns. That is
 * the line ruling 60 drew — "a spine dissolves shared plumbing, not identity".
 *
 * This is deliberately NOT the ADR-043 machinery: no registries are opened, no
 * per-kind hooks are added to the generic builder, no `style:` is implemented.
 * That work is bead `forge-8vfn.6.6` (M5), which carries the five blockers as
 * its acceptance list.
 */
import { rmSync } from 'node:fs';
import { resolve, join } from 'node:path';

import { pinnedSdkQuery as sdkQuery } from '@forge/agents/pinned-sdk-query.ts';
import { sdkHooksForAgent } from '@forge/agents/studio/hook-dispatch.ts';
import { makeToolEventSink } from '@forge/agents/tool-event-emit.ts';
import { createLogger, guardedReadFile, resolveGuardedPath, type EventLogger, type Phase } from '@forge/kernel';

import {
  guardedReadSessionStatus,
  guardedWriteSessionStatus,
  makeHeartbeatWriter,
  makeReasoningSink,
  makeThinkingSink,
  runAgentTurn,
  statusWriteRefusalReason,
  type QueryFn,
} from '../interactive-session.ts';

/** The operator's revision notes, written beside status.json by a `revise` verdict. */
const FEEDBACK_FILENAME = 'feedback.md';

/** Every session status.json carries at least a phase; the rest is the kind's. */
export type KindTurnStatus = { phase: string };

/** Every kind's turn result reports the phase it left behind and what it wrote. */
export type KindTurnResult = { phase: string; wrote: string[] };

/**
 * The input shape shared by every ported runner. It is EXACTLY the union the
 * four bespoke `RunXTurnInput` types already had — the ports do not widen or
 * narrow the entry points, which is what lets the spawn-capture goldens stay
 * byte-identical across a port. A kind carrying its own extra field (the
 * instructions interview ceiling) extends this and passes the extended type as
 * the variant's `I`, so the field stays the KIND's rather than becoming a
 * shared knob every other kind must ignore.
 */
export type KindTurnInput = {
  sessionId: string;
  /** Managed-project dir under forge `projects/` (holds the session dir). */
  projectRoot: string;
  /** Forge root. Defaults to cwd, as every bespoke runner did. */
  forgeRoot?: string;
  queryFn?: QueryFn;
  logsRoot?: string;
  logger?: EventLogger;
  skillPromptPath?: string;
};

/**
 * The plumbing a step handler receives already built. A handler never
 * constructs a logger, a sink or a guard of its own — if it needs one that is
 * not here, the need belongs in this file, not in a kind module.
 */
export type KindTurnPlumbing = {
  /** The CONTAINED real path of the session dir (guard already applied). */
  sessionDir: string;
  /** `[kindDir, sessionId]` — the guarded segments, for further guarded writes. */
  dirSegments: readonly string[];
  forgeRoot: string;
  logsRoot: string;
  queryFn: QueryFn;
  logger: EventLogger;
  initiativeId: string;
  onToolUse: NonNullable<Parameters<typeof runAgentTurn>[0]['onToolUse']>;
  onHeartbeat: () => void;
  onThinking: (text: string) => void;
  /**
   * Extended-REASONING text sink. Built for every variant (construction is
   * inert — it only closes over the logger) and consumed by the kinds that had
   * one before their port; a kind that passes it nowhere behaves exactly as it
   * did, which is what lets one driver serve both shapes with no flag.
   */
  onText: (text: string) => void;
  /**
   * Run one step with the operator's `feedback.md`, CONSUMED ONCE.
   *
   * Every bespoke runner that reads `feedback.md` reads it and never clears
   * it, so round 1's revision notes keep riding rounds 2 and 3 and silently
   * steer turns the operator never aimed. The generic spine fixed exactly
   * this (W7-C2 T1 review, P0-2 / finding A5, `interactive-runner.ts`) and no
   * bespoke runner ever got the fix; ruling 60 said the ports collect it.
   *
   * A CLOSURE rather than a read/clear pair, deliberately: a kind cannot
   * forget the clear, because there is nothing separate to forget. The note
   * is deleted only after `run` RESOLVES — a turn that threw leaves it in
   * place for the retry, which is the spine's own rule. A failed delete is
   * REPORTED, never swallowed: the turn already ran, so it must not throw the
   * session away, but a note that survives its own consumption WILL re-steer
   * the next turn and the operator needs to be able to see why.
   */
  withOperatorFeedback: <T>(run: (feedback: string | null) => Promise<T>) => Promise<T>;
  /**
   * W8-B6, hardened here: the hook-dispatch options for one skill, ALREADY
   * bound to this turn's logger and initiative id, ready to spread into a
   * `runAgentTurn` options bag (`...plumbing.hooksForSkill(spec.skill)`).
   *
   * This lives on the plumbing, not in each kind, for a reason the hook
   * enumeration ratchet (`packages/agents/hook-dispatch-coverage.test.ts`)
   * makes concrete: this file imports `pinnedSdkQuery` as a VALUE and hands
   * it to every handler, so the driver is a spawn-capable file. Leaving the
   * wiring to each kind would mean the one module every future kind spawns
   * through carries none — and a kind that forgot the six-line IIFE would
   * spawn hook-blind with nothing red. Returns `{}` when the skill declares
   * no hooks, so the spread is a no-op and the options bag is byte-identical
   * to the per-kind form it replaces.
   */
  hooksForSkill: (skill: string) => Record<string, unknown>;
};

export type KindStepHandler<
  S extends KindTurnStatus,
  R extends KindTurnResult,
  I extends KindTurnInput = KindTurnInput,
> = (args: {
  input: I;
  status: S;
  plumbing: KindTurnPlumbing;
  /** Guarded status write for this session, with the kind's own refusal text. */
  writeStatus: (next: S) => void;
}) => Promise<R>;

/**
 * One registered step-handler variant. `steps` is keyed by the session's
 * on-disk `phase`, so a kind declares only the phases that DO something;
 * every other phase falls through to `otherwise`, which is where each bespoke
 * runner's trailing `else { return { phase: status.phase, wrote: [] } }`
 * went. That fall-through is load-bearing for containment: the SEC-04 tests
 * drive an unknown phase precisely so no spawning branch is reached.
 */
export type SessionKindVariant<
  S extends KindTurnStatus,
  R extends KindTurnResult,
  I extends KindTurnInput = KindTurnInput,
> = {
  /** The session-kind id — also the `_logs` cycle-id segment. */
  id: string;
  /** The ONE on-disk segment this kind's session dirs live under. */
  kindDir: string;
  /** Prefix for this variant's refusals, e.g. "project-brain runner". */
  label: string;
  /** Prefix for this variant's start/end event messages, e.g. "project-brain turn". */
  eventLabel: string;
  /** The event log's `phase` / `skill` columns for this kind's turns. */
  eventPhase: Phase;
  eventSkill: string;
  /** The `initiative_id` this kind's events carry. */
  initiativeId: (sessionId: string) => string;
  steps: Record<string, KindStepHandler<S, R, I>>;
  /** Phases with no handler — the bespoke runners' trailing `else`. */
  otherwise: (status: S) => R;
  /** Extra `metadata` keys on the start event, beyond session_id + phase. */
  startMetadata?: (status: S) => Record<string, unknown>;
  /** Extra `metadata` keys on the end event, beyond session_id + phase. */
  endMetadata?: (result: R) => Record<string, unknown>;
};

/**
 * Drive one turn of a registered variant. Behaviourally identical, step for
 * step, to the bespoke runner bodies this replaces — proven per port by the
 * spawn-capture golden (`interactive-runners-golden.test.ts`), which pins the
 * exact `{prompt, options}` reaching `queryFn`, the returned result, and the
 * `status.json` left behind.
 */
export async function runKindTurn<
  S extends KindTurnStatus,
  R extends KindTurnResult,
  I extends KindTurnInput = KindTurnInput,
>(
  variant: SessionKindVariant<S, R, I>,
  input: I,
): Promise<R> {
  // SEC-04 runner leg: contain the session dir before the first read.
  // `kindDir` and `sessionId` each ride as their OWN segment against the
  // trusted `projectRoot` root, never folded into it (the guard's CONTRACT),
  // so a traversal sessionId or a symlinked kind-dir resolves to a reject and
  // the turn REFUSES rather than read out-of-root content.
  const dirSegments = [variant.kindDir, input.sessionId];
  const guarded = resolveGuardedPath(input.projectRoot, dirSegments);
  if (!guarded.ok) {
    throw new Error(
      `${variant.label}: no status.json — session dir failed containment (${guarded.reason}). Has the session been started?`,
    );
  }
  const sessionDir = guarded.realPath;

  // SEC-04 leaf: route the status.json READ through the guarded sibling (leaf
  // included) so a symlinked status.json inside the real, contained session
  // dir is refused too. A rejected leaf collapses to null → the turn refuses.
  const status = guardedReadSessionStatus<S>(input.projectRoot, dirSegments);
  if (!status) {
    throw new Error(`${variant.label}: no status.json at ${sessionDir}. Has the session been started?`);
  }

  const forgeRoot = input.forgeRoot ?? resolve('.');
  const logsRoot = input.logsRoot ?? resolve(forgeRoot, '_logs');
  const cycleId = `_${variant.id}-${input.sessionId}`;
  const initiativeId = variant.initiativeId(input.sessionId);
  const logger = input.logger ?? createLogger(cycleId, logsRoot);
  const queryFn: QueryFn = input.queryFn ?? (sdkQuery as unknown as QueryFn);

  const startEv = logger.emit({
    initiative_id: initiativeId,
    phase: variant.eventPhase,
    skill: variant.eventSkill,
    event_type: 'start',
    input_refs: [join(sessionDir, 'status.json')],
    output_refs: [],
    message: `${variant.eventLabel} (phase=${status.phase})`,
    metadata: {
      session_id: input.sessionId,
      phase: status.phase,
      ...(variant.startMetadata?.(status) ?? {}),
    },
  });

  // W6-B1: interactive sessions are operator-attended, low-volume turns — the
  // same {readOnlySampleRate:1, cap:200} "unsampled" opts every interactive
  // runner passed (the unattended dev-loop/PM/reflector phases keep the
  // sampler's defaults and are not touched by any port).
  const sink = makeToolEventSink(
    logger,
    { initiativeId, parentEventId: startEv.event_id, phase: variant.eventPhase, skill: variant.eventSkill },
    { readOnlySampleRate: 1, cap: 200 },
  );
  const onHeartbeat = makeHeartbeatWriter(join(logsRoot, cycleId));
  const onThinking = makeThinkingSink(logger, {
    initiativeId,
    phase: variant.eventPhase,
    skill: variant.eventSkill,
    idMeta: { session_id: input.sessionId },
  });

  const onText = makeReasoningSink(logger, {
    initiativeId,
    phase: variant.eventPhase,
    skill: variant.eventSkill,
    idMeta: { session_id: input.sessionId },
  });

  const withOperatorFeedback = async <T,>(run: (feedback: string | null) => Promise<T>): Promise<T> => {
    const raw = guardedReadFile(input.projectRoot, [...dirSegments, FEEDBACK_FILENAME]);
    const feedback = raw === null ? null : (raw.trim() || null);
    const out = await run(feedback);
    if (feedback !== null) {
      const guarded = resolveGuardedPath(sessionDir, [FEEDBACK_FILENAME]);
      if (guarded.ok && guarded.exists) {
        try {
          rmSync(guarded.realPath);
        } catch (err) {
          console.error(
            `${variant.label}: failed to clear ${FEEDBACK_FILENAME} in ${sessionDir} after consuming it — the SAME operator feedback will be re-injected into the next turn's prompt:`,
            err,
          );
        }
      }
    }
    return out;
  };

  const hooksForSkill = (skill: string): Record<string, unknown> => {
    const hooks = sdkHooksForAgent({ skill, logger, initiativeId });
    return hooks !== undefined ? { hooks } : {};
  };

  const plumbing: KindTurnPlumbing = {
    sessionDir,
    dirSegments,
    forgeRoot,
    logsRoot,
    queryFn,
    logger,
    initiativeId,
    onToolUse: sink.onToolUse,
    onHeartbeat,
    onThinking,
    onText,
    withOperatorFeedback,
    hooksForSkill,
  };

  const writeStatus = (next: S): void => {
    writeKindStatus(variant, input.projectRoot, dirSegments, next);
  };

  const step = variant.steps[status.phase];
  const result = step
    ? await step({ input, status, plumbing, writeStatus })
    : variant.otherwise(status);

  sink.flushIteration(1);
  logger.emit({
    initiative_id: initiativeId,
    parent_event_id: startEv.event_id,
    phase: variant.eventPhase,
    skill: variant.eventSkill,
    event_type: 'end',
    input_refs: [],
    output_refs: result.wrote,
    message: `${variant.eventLabel} end (phase=${result.phase})`,
    metadata: {
      session_id: input.sessionId,
      phase: result.phase,
      ...(variant.endMetadata?.(result) ?? {}),
    },
  });
  return result;
}

/**
 * SEC-04 leaf: guarded status.json write, shared by every variant. Routes the
 * WHOLE `<projectRoot>/<kindDir>/<sid>/status.json` path (leaf included)
 * through the containment guard and THROWS — fail closed, the runner contract
 * — if the leaf escapes.
 *
 * W7-FIX-A2 (W7A2-01): the seam ALSO refuses a write that would move an
 * on-disk `cancelled` phase — a turn that finished after the operator
 * cancelled. That is named honestly (the advance is discarded by design;
 * lifecycle reads terminal, never crashed) instead of "containment".
 */
export function writeKindStatus<S extends KindTurnStatus>(
  variant: Pick<SessionKindVariant<S, KindTurnResult>, 'label'>,
  projectRoot: string,
  dirSegments: readonly string[],
  status: S,
): void {
  const written = guardedWriteSessionStatus(projectRoot, dirSegments, status as unknown as Record<string, unknown>);
  if (written === null) {
    if (statusWriteRefusalReason(projectRoot, dirSegments, status.phase) === 'cancelled') {
      throw new Error(
        `${variant.label}: the session was cancelled while this turn ran — the turn's advance to "${status.phase}" is discarded and status.json stays cancelled (the terminal cancelled phase is sticky).`,
      );
    }
    throw new Error(
      `${variant.label}: status.json write failed containment (symlinked/escaping leaf) — refusing to write.`,
    );
  }
}
