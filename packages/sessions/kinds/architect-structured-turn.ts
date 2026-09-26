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
import type { ToolUseLiveDetail } from '@forge/agents';
import type { EventLogger } from '@forge/kernel';
import { architectAgentSpec } from './architect-session.ts';

export type StructuredResult<T> = {
  output: T | null;
  /** Brain paths Read by the agent during this turn (for brain_context). */
  brainReads: string[];
};

/**
 * Architect-local thin wrapper over the shared `runStructuredTurn` (ADR 020 spine
 * extracted to interactive-session.ts). It binds the architect's model + tool
 * allow-list (derived from skills/architect/SKILL.md, ADR-024) and narrows the
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
  /** ADR-043 §3 amendment (wave-6): the session's requested kickoff tier
   *  (`status.modelTier`), resolved against `architectAgentSpec` — absent
   *  resolves to the unchanged `ARCHITECT_MODEL` default. */
  modelTier?: ModelTier;
  onToolUse?: (d: ToolUseLiveDetail) => void;
  onHeartbeat?: () => void;
  onText?: (text: string) => void;
  onThinking?: (text: string) => void;
}): Promise<StructuredResult<T>> {
  const { output, reads, costUsd } = await runStructuredTurn<T>({
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
