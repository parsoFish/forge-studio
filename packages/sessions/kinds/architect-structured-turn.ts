/**
 * The architect's shared structured-output query (mirrors council's parse
 * path) — split out of `architect-steps.ts` (file-size budget, 1.0.md §0).
 * Every architect stage that calls the LLM for a schema'd result (interview,
 * explore, draft, and the forced-emit retry) shares this ONE binding of the
 * architect's model + tool allow-list + hook wiring, so a future stage cannot
 * silently spawn hook-blind or ground-blind by hand-rolling its own call.
 */
import { runStructuredTurn, type QueryFn } from '../interactive-session.ts';
import { hooksSpreadForAgent } from './kind-turn.ts';
import { emitTurnCostRow, emitTurnEndedUnpricedRow } from '../turn-cost-rows.ts';
import { resolveSessionModel, type ModelTier } from '@forge/agents/phase-agent.ts';
import { classifyCrash, type ToolUseLiveDetail } from '@forge/agents';
import { StreamDeadlineError } from '@forge/agents/stream-deadline.ts';
import type { EventLogger } from '@forge/kernel';
import { architectAgentSpec } from './architect-session.ts';

export type StructuredResult<T> = {
  output: T | null;
  /** Brain paths Read by the agent during this turn (for brain_context). */
  brainReads: string[];
};

/**
 * Architect-local thin wrapper over the shared `runStructuredTurn` (R-05 spine
 * extracted to interactive-session.ts). It binds the architect's model + tool
 * allow-list (derived from skills/architect/SKILL.md, SPEC §1) and narrows the
 * generic `reads` down to the `brain/` paths the PLAN's brain-context section
 * needs (ARCH-1). Callsites keep their `{ output, brainReads }` shape.
 */
export async function runStructured<T>(args: {
  queryFn: QueryFn;
  prompt: string;
  schema: unknown;
  /** W8-B6 — the run's logger + initiative id, so the architect's own bound
   *  library hooks can fire and record. Required, not optional: an optional
   *  field here would let a call site silently spawn hook-blind. */
  logger: EventLogger;
  initiativeId: string;
  /** Bead forge-8vfn.6.10.19 — the PROJECT GROUND this turn runs on, passed to
   *  the SDK as `cwd`. REQUIRED, like `logger` above and for the same reason: an
   *  optional field here would let a call site silently spawn ground-blind, and
   *  a ground-blind architect session inherits the BRIDGE's cwd — the forge repo
   *  root — so a relative write by it lands in forge's own tree.
   *
   *  It comes from `ArchitectStatus.project_repo_path`, which the start route
   *  already validated through `rejectStartProjectRepoPath` before the session
   *  record existed; this is the same value being USED rather than a fresh
   *  request-derived path entering here. */
  cwd: string;
  /** SPEC §5 (wave-6): the session's requested kickoff tier
   *  (`status.modelTier`), resolved against `architectAgentSpec` — absent
   *  resolves to the unchanged `ARCHITECT_MODEL` default. */
  modelTier?: ModelTier;
  onToolUse?: (d: ToolUseLiveDetail) => void;
  onHeartbeat?: () => void;
  onText?: (text: string) => void;
  onThinking?: (text: string) => void;
  /** Row 193b (T1 ruling 1973gq) — `plumbing.turnBudgetUsd`, evaluated per
   *  ATTEMPT below: the stall retry runs after the stalled attempt's bounded
   *  unpriced row is written, so the retry is capped against what is left. */
  turnBudgetUsd?: () => number | undefined;
}): Promise<StructuredResult<T>> {
  const runOnce = () => runStructuredTurn<T>({
    maxBudgetUsd: args.turnBudgetUsd?.(),
    queryFn: args.queryFn,
    prompt: args.prompt,
    schema: args.schema,
    model: resolveSessionModel(architectAgentSpec, args.modelTier),
    cwd: args.cwd,
    allowedTools: architectAgentSpec.allowedTools,
    disallowedTools: architectAgentSpec.disallowedTools,
    ...hooksSpreadForAgent({ skill: architectAgentSpec.skill, logger: args.logger, initiativeId: args.initiativeId }),
    onToolUse: args.onToolUse,
    onHeartbeat: args.onHeartbeat,
    onText: args.onText,
    onThinking: args.onThinking,
    label: 'architect-structured',
    // `forge-8vfn.7.6.73` — a turn that ends without a price leaves THIS row
    // instead of the cost row below. Before it, an unpriced architect turn
    // emitted `cost_usd: 0`, which `endedUnpricedTurns` skips as priced: the
    // ceiling under-counted rather than halting.
    onTurnEndedUnpriced: (info) => emitTurnEndedUnpricedRow(args.logger, {
      initiativeId: args.initiativeId, phase: 'architect', skill: 'architect',
      message: 'architect.turn-ended-unpriced',
    }, info),
  });
  // Row 193 (T1 ruling 1973fy) — S10 beat 30, row 6 run 6: this turn's stream
  // saw `system×12, rate_limit_event×1` and no assistant message for 360s, and
  // `StreamDeadlineError` — whose own text says "transient; routes to auto-
  // retry" — failed the whole session. The retry it promises existed only on
  // the CYCLE paths (`developer-loop.ts` F-44/G3, `scheduler-dispatch.ts` F-27)
  // and in `verify-cycle.mjs`'s harness (`scripts/lib/architect-retry.mjs`);
  // an interactive session is upstream of all of them and was never retried.
  //
  // ONE re-run of the SAME turn, the bound `architect-draft-repair.ts` (row
  // 159) and the harness retry already use: a second stall rethrows and the
  // session fails as before. SCOPED to the stall by type, not by
  // `classifyCrash`'s broader transient list — a thrown 429 or network reset
  // is a different ruling (the harness retry draws the same line). The
  // classifier's verdict is still recorded, so the row reads like dev-loop's
  // `agent-crash-retry`. NO BACKOFF SLEEP: the stall already waited the whole
  // idle window, and between attempts no heartbeat ticks (row 164's ticker
  // lives inside `runStructuredTurn`), so a sleep would only look like a hang.
  //
  // The stalled attempt KEEPS its `turn-ended-unpriced` row (emitted inside
  // `runStructuredTurn` before the throw): nothing priced it, and a retry that
  // succeeds does not change what the first attempt cost (row 184 / item 76).
  let result: Awaited<ReturnType<typeof runOnce>>;
  try {
    result = await runOnce();
  } catch (err) {
    if (!(err instanceof StreamDeadlineError)) throw err;
    const crash = classifyCrash(err.message, null);
    args.logger.emit({
      initiative_id: args.initiativeId, phase: 'architect', skill: 'architect', event_type: 'log',
      input_refs: [], output_refs: [], message: 'architect.turn-stall-retry',
      metadata: {
        crash_class: crash.kind, crash_reason: crash.reason, label: err.label, idle_ms: err.idleMs,
        ...(err.nonProgressSummary !== undefined ? { non_progress: err.nonProgressSummary } : {}),
        max_attempts: 2,
      },
    });
    result = await runOnce();
  }
  const { output, reads, costUsd } = result;
  // bead forge-8vfn.18 — emit the turn's spend so the ceiling can bound stage 1.
  // Authoritative because this phase emits no `iteration` events (trap pinned in
  // architect-turn-cost-event.test.ts). Best-effort: never fail a completed turn.
  //
  // GUARDED ON NON-NULL (7.6.73): the priced row and the unpriced row above are
  // mutually exclusive by the primitive's own construction, so this branch is
  // what keeps a turn from leaving two terminal rows or, worse, a $0 row that
  // reads as a measurement.
  if (costUsd !== null) {
    emitTurnCostRow(args.logger, {
      initiativeId: args.initiativeId, phase: 'architect', skill: 'architect',
      message: 'architect.turn-cost',
    }, costUsd);
  }
  return { output, brainReads: reads.filter((p) => p.includes('brain/')) };
}
