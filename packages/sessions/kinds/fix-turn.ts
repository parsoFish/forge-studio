/**
 * The SESSION-LESS fix-turn driver — ports 5 and 6 of ruling 60.
 *
 * Drives `brain-fix` and `preflight-fix`: turns keyed by a `runId` alone, with
 * no `projectRoot`, no kind dir, no `status.json` and no phase, reached as
 * `apps/forge/cli.ts` subcommands rather than as `forge agent run` targets.
 * `kinds/kind-turn.ts` cannot drive them — its first act is
 * `resolveGuardedPath(projectRoot, [kindDir, sessionId])` and a status read
 * whose absence is a refusal — and bending it to make session state optional
 * is the ADR-043 machinery ruling 78 declined. Ruling 78 says a kind wanting
 * more gets its own entry point and its PR says so: this is that entry point,
 * `../design.md` says so at length, and bead `forge-8vfn.6.6` (M5) carries the
 * machinery itself.
 *
 * This module owns the TWELVE behaviours the two runners had copied line for
 * line — logsRoot/logger/cycleId defaulting, the heartbeat writer, the start
 * event, the tool sink with the interactive opts, the reasoning and thinking
 * sinks, the skill-prompt read, the `sdkHooksForAgent` wiring, the queryFn
 * default and AbortController, the `withIdleDeadline` stream loop, the crash
 * path, and the flush + `end` event. `../design.md` enumerates them.
 *
 * TWO THINGS THAT LOOK LIKE OVERSIGHTS AND ARE NOT — both with their reasons
 * in `../design.md`, both pinned by `packages/sessions/tests/regression/fix-turn-capture.test.ts`:
 *
 *   - it does NOT call the spine's `runAgentTurn`, which is the same shape.
 *     That function reads an EMPTY `writeRoots` as UNFENCED, whereas
 *     brain-fix's empty list is a deliberate deny-all. Arm 3 pins it.
 *   - the KIND supplies the options bag, not this file. The two bags are
 *     ordered differently and key order is pinned separately, so a shared
 *     builder could not keep either capture byte-identical.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Deep paths, not the door (bead forge-8vfn.5.31, same cycle as
// packages/sessions/kinds/architect-session.ts's own module doc).
import { pinnedSdkQuery as sdkQuery } from '@forge/agents/pinned-sdk-query.ts';
import { hooksSpreadForAgent } from './kind-turn.ts';
import { makeToolEventSink, extractLiveToolDetails } from '@forge/agents/tool-event-emit.ts';
import { withIdleDeadline } from '@forge/agents/stream-deadline.ts';
import { skillPath } from '@forge/agents/skill-path.ts';
import { createLogger, type EventLogger, type Phase } from '@forge/kernel';

import {
  REDACTED_THINKING_MARKER,
  isProgressMessage,
  makeReasoningSink,
  makeThinkingSink,
  unpricedReason,
} from '../interactive-session.ts';
import { makeHeartbeatTick, makeHeartbeatWriter, startHeartbeatTicker } from '../heartbeat.ts';
import { budgetedResultCostUsd, turnBudgetUsd } from '../turn-budget.ts';

/**
 * The query seam, declared HERE with `options` REQUIRED because that is what
 * both bespoke runners declared. The spine's own `QueryFn`
 * (`interactive-session.ts`) makes `options` optional, and adopting it would
 * change the type every existing test stub is checked against — a port must
 * not move its callers' goalposts. A loose async iterable so a stub need not
 * implement the full SDK type.
 */
export type QueryFn = (params: {
  prompt: string;
  options: Record<string, unknown>;
}) => AsyncIterable<unknown>;

/** Every fix turn is keyed by a run id and rooted at a forge root. */
export type FixTurnInput = {
  /** Unique id for this fix run — the `_logs` cycle-id suffix. */
  runId: string;
  /** Absolute path to the forge root. */
  forgeRoot: string;
  /** Root directory for event logs; defaults to `<forgeRoot>/_logs`. */
  logsRoot?: string;
  /** Injectable query function for tests; defaults to the real SDK. */
  queryFn?: QueryFn;
  /**
   * Row 199 (T1 ruling 1973gt) — the caller's own ceiling for THIS turn, in
   * the slot `turn-budget.ts` calls the declared ceiling. The KB drain passes
   * what is left of its run ceiling (`maxCostUsd − costUsd`); the CLI passes
   * nothing, and the bridge's `FORGE_COST_CEILING_USD` is the fallback.
   */
  costCeilingUsd?: number;
};

/** Every fix turn reports whether the thing it was asked to clear cleared. */
export type FixTurnResult = { runId: string; cleared: boolean };

/** What the kind hands over for the turn itself. */
export type FixTurnSpawn = {
  /** The whole assembled prompt — skill content plus the kind's payload. */
  prompt: string;
  /**
   * The SDK options bag, complete except for `abortController`, which the
   * driver appends last (it owns the controller the deadline aborts through).
   * The kind builds this so its key order and its fence decision are its own —
   * see the header.
   */
  options: Record<string, unknown>;
};

/**
 * One session-less fix-turn variant. Every field is a difference measured
 * between the two real implementations; none is speculative generality.
 */
export type FixTurnVariant<I extends FixTurnInput, R extends FixTurnResult, P = void> = {
  /** The `_logs` cycle-id PREFIX. `_brainfix` and `_preflight-fix` are not
   *  derivable from one another or from the skill name — brain-fix's dir has no
   *  hyphen and never has — so it is stated, not computed. */
  cycleIdPrefix: string;
  /** The event log's `phase` and `skill` columns for this kind's turns. */
  eventPhase: Phase;
  eventSkill: string;
  /** The skill whose SKILL.md supplies the prompt, via `skillPath`. */
  skillName: string;
  /** Used when the SKILL.md cannot be read — each runner's own literal. */
  fallbackPrompt: string;
  /** `input_refs` on the start, error and end events. */
  inputRefs: (input: I) => string[];
  /** The start event's message. */
  startMessage: (input: I) => string;
  /** The start event's `metadata`. */
  startMetadata: (input: I) => Record<string, unknown>;
  /**
   * Compose the turn. May perform the kind's pre-turn side effect (brain-fix's
   * brain-tree snapshot, preflight-fix's `ensureStudioBranch`) and return
   * whatever `finish` needs back as `pre`.
   */
  prepare: (args: { input: I; skillPrompt: string }) => { spawn: FixTurnSpawn; pre: P };
  /**
   * The verification gate and the result. Called on BOTH exits — `crashed`
   * says which — because brain-fix audits a crashed turn's writes (they are
   * still on disk) while preflight-fix does not commit or re-verify one.
   * `endMetadata` is ignored on the crash path, which emits no `end` event.
   */
  finish: (args: {
    input: I;
    pre: P;
    costUsd: number;
    crashed: boolean;
  }) => { result: R; endMetadata: Record<string, unknown> };
};

/**
 * Drive one turn of a session-less fix variant.
 *
 * Behaviourally identical, step for step, to the two bespoke runner bodies it
 * replaces — proven by `packages/sessions/tests/regression/fix-turn-capture.test.ts`, which pins
 * the exact `{prompt, options}` reaching `queryFn` (content AND key order), the
 * returned result and the full event log, across four arms including the
 * fail-closed fence and the crash path.
 */
export async function runFixTurn<I extends FixTurnInput, R extends FixTurnResult, P>(
  variant: FixTurnVariant<I, R, P>,
  input: I,
): Promise<R> {
  const logsRoot = input.logsRoot ?? resolve(input.forgeRoot, '_logs');
  const cycleId = `${variant.cycleIdPrefix}-${input.runId}`;
  const logger: EventLogger = createLogger(cycleId, logsRoot);
  const inputRefs = variant.inputRefs(input);

  // `makeHeartbeatWriter` mkdirs the dir, owns the `.heartbeat` path and
  // carries the same HEARTBEAT_THROTTLE_MS both runners hand-rolled — the
  // whole of behaviour 3 in one call. The extra mkdir is kept for the case
  // where the logger has not yet written anything into the cycle dir.
  const heartbeatDir = resolve(logsRoot, cycleId);
  mkdirSync(heartbeatDir, { recursive: true });
  const onHeartbeat = makeHeartbeatWriter(heartbeatDir);
  // forge-8vfn.8.1.9 — ticks only from a progress branch below, same as the spine.
  const tickHeartbeat = makeHeartbeatTick(onHeartbeat);

  const startEv = logger.emit({
    initiative_id: cycleId,
    phase: variant.eventPhase,
    skill: variant.eventSkill,
    event_type: 'start',
    input_refs: inputRefs,
    output_refs: [],
    message: variant.startMessage(input),
    metadata: variant.startMetadata(input),
  });

  // W6-B1: a fix turn is operator-triggered, low-volume and single — the same
  // {readOnlySampleRate:1, cap:200} "unsampled" opts every interactive runner
  // passes (the unattended dev-loop/PM/reflector phases keep the sampler's
  // defaults and are untouched by any port).
  const sink = makeToolEventSink(
    logger,
    {
      initiativeId: cycleId,
      parentEventId: startEv.event_id,
      phase: variant.eventPhase,
      skill: variant.eventSkill,
    },
    { readOnlySampleRate: 1, cap: 200 },
  );

  const sinkCtx = {
    initiativeId: cycleId,
    phase: variant.eventPhase,
    skill: variant.eventSkill,
    idMeta: { runId: input.runId },
  };
  const onText = makeReasoningSink(logger, sinkCtx);
  const onThinking = makeThinkingSink(logger, sinkCtx);

  // ADR 003 — the prompt is skill content, not re-baked TS. `skillPath` is
  // resolved OUTSIDE the try so a throw from it is not mistaken for an
  // unreadable file; only the read itself falls back.
  const skillFile = skillPath(variant.skillName, input.forgeRoot);
  let skillPrompt = variant.fallbackPrompt;
  try {
    skillPrompt = readFileSync(skillFile, 'utf8');
  } catch {
    /* fall through to the variant's own literal, as both runners did */
  }

  const { spawn, pre } = variant.prepare({ input, skillPrompt });

  // Behaviour 8, HERE rather than in each kind, for the reason
  // `kinds/kind-turn.ts` gives about its own `hooksForSkill`: this file imports
  // `pinnedSdkQuery` as a VALUE, so it is the spawn-capable module the hook
  // enumeration ratchet (`packages/agents/tests/contract/hook-dispatch-coverage.test.ts`)
  // sees. A kind that forgot the wiring would spawn hook-blind with nothing
  // red.
  //
  // Row 199 (bead forge-8vfn.8.5.39, T1 ruling 1973gt) — the cap, by the SAME
  // resolution every session turn uses since row 193b (`turn-budget.ts`):
  // the declared ceiling (`input.costCeilingUsd`) first, else the bridge's
  // `FORGE_COST_CEILING_USD` from this process's env, else none. REMAINING is
  // the ceiling itself — `spentUsd` is 0 — because a fix turn has no session to
  // have spent anything: it is ONE SDK call keyed by a fresh `runId`, and a
  // caller that HAS spent (the drain) subtracts that before it declares. Before
  // this the bag carried no `maxBudgetUsd` and nothing bounded the turn.
  const capUsd = turnBudgetUsd({
    declaredCeilingUsd: input.costCeilingUsd,
    env: process.env,
    spentUsd: () => 0,
    logger,
    identity: { initiativeId: cycleId, phase: variant.eventPhase, skill: variant.eventSkill, sessionId: input.runId },
  });
  /** The unpriced markers `spend.mjs` and `turn-budget.ts` read — ONLY when a
   *  cap existed: "unpriced" is honest only when no bound exists, and an
   *  unbounded turn keeps the row it always wrote. */
  const boundedUnpriced = (reason: string): Record<string, unknown> =>
    capUsd === undefined ? {} : { priced: false, unpriced_reason: reason, upper_bound_usd: capUsd };
  const abortController = new AbortController();
  const options: Record<string, unknown> = {
    ...spawn.options,
    ...hooksSpreadForAgent({ skill: variant.eventSkill, logger, initiativeId: cycleId }),
    ...(capUsd !== undefined ? { maxBudgetUsd: capUsd } : {}),
    abortController,
  };

  const queryImpl: QueryFn = input.queryFn ?? (sdkQuery as unknown as QueryFn);

  // `null` until a `result` prices the turn (row 199): a resultless turn under
  // a cap is unpriced-with-bound, not `cost_usd: 0`.
  let costUsd: number | null = null;
  let toolSeq = 0;

  // Row 164 (bead forge-8vfn.8.1.51, S10 run 43) — started before the SDK
  // call begins, stopped in the `finally` below once it ends: see
  // `startHeartbeatTicker`'s own doc comment (heartbeat.ts).
  const stopHeartbeatTicker = startHeartbeatTicker(onHeartbeat);

  try {
    for await (const msg of withIdleDeadline(queryImpl({ prompt: spawn.prompt, options }), {
      label: `${variant.eventSkill}-${input.runId}`,
      abortController,
      isProgress: isProgressMessage,
    })) {
      if (typeof msg !== 'object' || msg === null) continue;
      const m = msg as {
        type?: string;
        subtype?: string;
        total_cost_usd?: number;
        message?: {
          content?: Array<{ type?: string; name?: string; input?: unknown; text?: string; thinking?: string }>;
        };
      };

      if (m.type === 'assistant') {
        tickHeartbeat(); // forge-8vfn.8.1.9 — progress only; see isProgressMessage
        const details = extractLiveToolDetails(m.message, toolSeq);
        for (const d of details) sink.onToolUse(d);
        toolSeq += details.length;
        for (const block of m.message?.content ?? []) {
          if (block?.type === 'text' && typeof block.text === 'string') {
            const trimmed = block.text.trim();
            if (trimmed) onText(trimmed);
          }
          if (block?.type === 'thinking' && typeof block.thinking === 'string') {
            const trimmed = block.thinking.trim();
            if (trimmed) onThinking(trimmed);
          }
          if (block?.type === 'redacted_thinking') {
            onThinking(REDACTED_THINKING_MARKER);
          }
        }
        continue;
      }
      if (m.type !== 'result') continue;
      tickHeartbeat();
      // `error_max_budget_usd` is priced AT LEAST at the cap (#1067's rule).
      costUsd = budgetedResultCostUsd(m, capUsd);
      break;
    }
  } catch (err) {
    logger.emit({
      initiative_id: cycleId,
      parent_event_id: startEv.event_id,
      phase: variant.eventPhase,
      skill: variant.eventSkill,
      event_type: 'error',
      input_refs: inputRefs,
      output_refs: [],
      message: `${variant.eventSkill}.crashed`,
      metadata: { error: err instanceof Error ? err.message : String(err), ...boundedUnpriced(unpricedReason(err)) },
    });
    sink.flushIteration(1);
    // No `end` event on this path — both runners returned from the catch, and
    // a crashed turn must not appear to have completed. `finish` still runs:
    // a crashed turn's writes are on disk and brain-fix audits them.
    return variant.finish({ input, pre, costUsd: costUsd ?? 0, crashed: true }).result;
  } finally {
    // Row 164 — the call is no longer in flight, however it ended.
    stopHeartbeatTicker();
  }

  sink.flushIteration(1);
  const { result, endMetadata } = variant.finish({ input, pre, costUsd: costUsd ?? 0, crashed: false });
  // An unbounded resultless turn keeps its historical `cost_usd: 0`; a bounded
  // one OMITS it (ruling 849: never zeroed) and carries its bound instead.
  const unpricedBound = costUsd === null ? boundedUnpriced('no-result') : {};

  logger.emit({
    initiative_id: cycleId,
    parent_event_id: startEv.event_id,
    phase: variant.eventPhase,
    skill: variant.eventSkill,
    event_type: 'end',
    input_refs: inputRefs,
    output_refs: [],
    ...('upper_bound_usd' in unpricedBound ? {} : { cost_usd: costUsd ?? 0 }),
    message: `${variant.eventSkill}.end (cleared=${result.cleared})`,
    metadata: { ...endMetadata, ...unpricedBound },
  });

  return result;
}
