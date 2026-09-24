/**
 * The architect's OWN `brain.read` event — forge-8vfn.8.3.5 (M7-C ABR).
 * ARCH-1's `brain-query` marker fires per turn before any tool call, so it
 * can't name a KB. U2 (forge-8vfn.5.16) gave the PM a real `brain.read` from
 * its deterministic pre-fetch; the architect has none — it reads brain/ via
 * its own tool calls mid-conversation. Same event shape, `reader: 'architect'`.
 *
 * `kind-turn.ts`'s hooks are already ruling 78's whole budget, and
 * `architect-steps.ts` is near the file cap, so neither is touched.
 * `withBrainReadTracking` wraps each phase's `KindStepHandler` from OUTSIDE,
 * at `architect.ts`'s `steps:` table. It observes through `onToolUse` — the
 * EXISTING live tool-telemetry callback every sub-turn (interview/explore/
 * draft/critic) already threads through unchanged (`runStructuredTurn`'s own
 * loop calls it for every tool_use block) — never `queryFn`: bead 5.50's lock
 * (`run-query-marker.enforce.test.ts`) requires every production `queryFn` be
 * a caller-supplied pass-through, on pain of a spawned child losing its
 * sweep marker, so this module must never construct or inject one.
 */
import type { EventLogger } from '@forge/kernel';
import { deriveKbIdFromBrainPath } from '@forge/knowledge/brain-paths.ts';
import type { ToolUseLiveDetail } from '@forge/agents/ralph/claude-agent.ts';
import type { KindStepHandler, KindTurnInput, KindTurnPlumbing, KindTurnResult, KindTurnStatus } from './kind-turn.ts';

/** Write tools never touch brain/, so these three are exhaustive. */
const KB_READ_TOOL_NAMES = new Set(['Read', 'Grep', 'Glob']);

/** kbId -> distinct paths read this turn — `themeCount` is distinct FILES,
 *  not tool calls, so a re-Read (a retried draft round) counts once. */
export type BrainReadTally = Map<string, Set<string>>;

/**
 * `ToolUseLiveDetail.inputSummary` (`summarizeToolInput`, tool-event-emit.ts)
 * IS the path for Read/Glob; for Grep it is `` `${pattern} @ ${path}` `` when
 * a `path` arg was given, else just the pattern. Never the raw tool input —
 * this reads the SAME summary the tool_use event log already carries, no new
 * seam onto the SDK message.
 */
function pathFromToolUseDetail(detail: ToolUseLiveDetail): string | null {
  if (!KB_READ_TOOL_NAMES.has(detail.name)) return null;
  const summary = detail.inputSummary;
  if (!summary) return null;
  if (detail.name !== 'Grep') return summary;
  const at = summary.lastIndexOf(' @ ');
  return at === -1 ? null : summary.slice(at + 3);
}

/** Wrap an `onToolUse` callback: forwards every call unchanged (the shared
 *  live-telemetry sink still sees everything), then tallies Read/Grep/Glob
 *  brain/ paths into the shared `tally`. */
export function withBrainReadTally(
  base: (d: ToolUseLiveDetail) => void,
  tally: BrainReadTally,
): (d: ToolUseLiveDetail) => void {
  return (detail) => {
    base(detail);
    const path = pathFromToolUseDetail(detail);
    if (!path) return;
    const kbId = deriveKbIdFromBrainPath(path);
    if (!kbId) return;
    const seen = tally.get(kbId);
    if (seen) seen.add(path);
    else tally.set(kbId, new Set([path]));
  };
}

/** One `brain.read` event per KB in `tally` — same shape as the PM's:
 *  `event_type: 'brain-query'` (reused), `message: 'brain.read'`,
 *  `metadata: {kbId, themeCount, reader: 'architect', runId}`. */
export function emitArchitectBrainReadEvents(args: {
  logger: EventLogger;
  initiativeId: string;
  tally: BrainReadTally;
}): void {
  const { logger, initiativeId, tally } = args;
  for (const [kbId, paths] of tally) {
    logger.emit({
      initiative_id: initiativeId,
      phase: 'architect',
      skill: 'architect-runner',
      event_type: 'brain-query',
      input_refs: [...paths],
      output_refs: [],
      message: 'brain.read',
      metadata: { kbId, themeCount: paths.size, reader: 'architect', runId: initiativeId },
    });
  }
}

/** Wrap a `KindStepHandler`: tally + emit at turn end, step's own
 *  return/throw unchanged (a `finally`, so a throw keeps what was read). */
export function withBrainReadTracking<
  S extends KindTurnStatus,
  R extends KindTurnResult,
  I extends KindTurnInput = KindTurnInput,
>(step: KindStepHandler<S, R, I>): KindStepHandler<S, R, I> {
  return async (args) => {
    const tally: BrainReadTally = new Map();
    const plumbing: KindTurnPlumbing = { ...args.plumbing, onToolUse: withBrainReadTally(args.plumbing.onToolUse, tally) };
    try {
      return await step({ ...args, plumbing });
    } finally {
      emitArchitectBrainReadEvents({ logger: args.plumbing.logger, initiativeId: args.plumbing.initiativeId, tally });
    }
  };
}
