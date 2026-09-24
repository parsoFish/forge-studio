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
 * at `architect.ts`'s `steps:` table, substituting a tallying `queryFn`
 * every sub-turn (interview/explore/draft/critic) threads through unchanged
 * — wrapping once observes the whole turn; messages re-yielded as-is.
 */
import type { EventLogger } from '@forge/kernel';
import { deriveKbIdFromBrainPath } from '@forge/knowledge/brain-paths.ts';
import { extractPath } from '@forge/agents/tool-event-emit.ts';
import type { QueryFn } from '../interactive-session.ts';
import type { KindStepHandler, KindTurnInput, KindTurnPlumbing, KindTurnResult, KindTurnStatus } from './kind-turn.ts';

/** Write tools never touch brain/, so these three are exhaustive. */
const KB_READ_TOOL_NAMES = new Set(['Read', 'Grep', 'Glob']);

/** kbId -> distinct paths read this turn — `themeCount` is distinct FILES,
 *  not tool calls, so a re-Read (a retried draft round) counts once. */
export type BrainReadTally = Map<string, Set<string>>;

/** Wrap a `queryFn` so every Read/Grep/Glob tool_use is tallied into the
 *  shared `tally`, message re-yielded unchanged. */
export function withBrainReadTally(base: QueryFn, tally: BrainReadTally): QueryFn {
  return (params) => {
    const source = base(params);
    return (async function* () {
      for await (const msg of source) {
        recordBrainReadsFromMessage(msg, tally);
        yield msg;
      }
    })();
  };
}

function recordBrainReadsFromMessage(msg: unknown, tally: BrainReadTally): void {
  const m = msg as { type?: string; message?: { content?: Array<{ type?: string; name?: string; input?: unknown }> } };
  if (m?.type !== 'assistant') return;
  for (const block of m.message?.content ?? []) {
    if (block?.type !== 'tool_use' || !block.name || !KB_READ_TOOL_NAMES.has(block.name)) continue;
    const path = extractPath(block.input);
    if (!path) continue;
    const kbId = deriveKbIdFromBrainPath(path);
    if (!kbId) continue;
    const seen = tally.get(kbId);
    if (seen) seen.add(path);
    else tally.set(kbId, new Set([path]));
  }
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
    const plumbing: KindTurnPlumbing = { ...args.plumbing, queryFn: withBrainReadTally(args.plumbing.queryFn, tally) };
    try {
      return await step({ ...args, plumbing });
    } finally {
      emitArchitectBrainReadEvents({ logger: args.plumbing.logger, initiativeId: args.plumbing.initiativeId, tally });
    }
  };
}
