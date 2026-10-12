/**
 * The architect's OWN `brain.read` event — forge-8vfn.8.3.5 (M7-C ABR).
 * Full rationale (why `onToolUse` and not `queryFn`, why `inputSummary`):
 * `packages/sessions/design.md` §"kinds/architect-brain-read.ts observes
 * onToolUse, never queryFn".
 */
import { readFileSync } from 'node:fs';

import type { EventLogger } from '@forge/kernel';
import { deriveKbIdFromBrainPath } from '@forge/knowledge';
import type { ToolUseLiveDetail } from '@forge/agents';
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

/** A path as the brain names it (`brain/...`), whatever absolute checkout it was read from. */
const brainRelative = (p: string): string | null => {
  if (!p.startsWith('/')) return p.includes('brain/') ? p : null; // already checkout-relative
  const at = p.indexOf('/brain/');
  return at === -1 ? null : p.slice(at + 1);
};

/**
 * forge-mfv5.1.24 — the brain paths this SESSION read, from its own `brain.read` events (every turn:
 * interview, explore, draft, revise), sorted. `null` when the log cannot be read (UNKNOWN, §6.15).
 */
export function sessionBrainReadPaths(logFilePath: string): string[] | null {
  let raw: string;
  try {
    raw = readFileSync(logFilePath, 'utf8');
  } catch {
    return null;
  }
  const out = new Set<string>();
  for (const line of raw.split('\n')) {
    if (!line.includes('"brain.read"')) continue;
    try {
      const ev = JSON.parse(line) as { message?: string; input_refs?: unknown };
      if (ev.message !== 'brain.read' || !Array.isArray(ev.input_refs)) continue;
      for (const ref of ev.input_refs) if (typeof ref === 'string') { const rel = brainRelative(ref); if (rel) out.add(rel); }
    } catch { /* a torn line is skipped; the rest of the log still counts */ }
  }
  return [...out].sort();
}

/**
 * forge-mfv5.1.24 — the PLAN's Brain context: the draft turn's reads ∪ the session's read log. Empty
 * only when the session read nothing, and only then is `architect.brain-gap` emitted. An unreadable
 * log never reads as "none consulted": the entry says the log could not be read.
 */
export function architectBrainContext(args: {
  draftReads: readonly string[];
  logFilePath: string;
  logger: EventLogger;
  initiativeId: string;
}): Array<{ path: string; summary: string }> {
  const session = sessionBrainReadPaths(args.logFilePath);
  const paths = [...new Set([...args.draftReads.map((p) => brainRelative(p) ?? p), ...(session ?? [])])].sort();
  if (paths.length > 0) return paths.map((path) => ({ path, summary: 'read during the architect session' }));
  if (session === null) return [{ path: args.logFilePath, summary: 'read log unreadable — brain consultation UNKNOWN' }];
  args.logger.emit({
    initiative_id: args.initiativeId, phase: 'architect', skill: 'architect-runner', event_type: 'brain-query',
    input_refs: [args.logFilePath], output_refs: [], message: 'architect.brain-gap', metadata: { reason: 'the session read no brain file' },
  });
  return [];
}
