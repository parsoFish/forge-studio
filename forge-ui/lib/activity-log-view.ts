/**
 * Pure row-derivation for the shared `ActivityLog` drawer
 * (`components/studio/ActivityLog.tsx`) — generalized off
 * `ArchitectActivityLog.tsx` (W6-B7). Kept side-effect-free and independent
 * of React so the thinking-clamp/expand model, the redacted-literal row, the
 * tool-coalesced summary row, and the per-sink cap-marker row are each
 * unit-testable without a DOM.
 *
 * Wire shapes this derives from (W6-B1, `orchestrator/interactive-session.ts`
 * + `orchestrator/tool-event-emit.ts` — NOT re-imported here: `forge-ui/` has
 * no dependency on `orchestrator/`, so the two marker literals below are
 * intentionally duplicated, not shared, across that boundary):
 *   - `event_type: 'tool_use'`, `metadata: { tool, input_summary, seq }` —
 *     one row per real tool call, always full text (never clamped).
 *   - `event_type: 'tool_use'`, `metadata: { coalesced: true,
 *     coalesced_count, sampled_out_count }` — the sampler's per-iteration
 *     "what I dropped" summary row (`tool-event-emit.ts`'s `flushIteration`).
 *   - `event_type: 'log'`, `metadata: { kind: 'thinking' | 'reasoning' }` —
 *     forwarded thinking/reasoning text, per-block capped server-side at
 *     700/400 chars respectively. `message === '[thinking redacted]'`
 *     (kind `'thinking'` only) is the literal marker for a
 *     `redacted_thinking` content block — rendered verbatim, never clamped.
 *     `metadata.capped === true` marks the ONE terminal
 *     `[thinking capped after 300 rows]` / `[reasoning capped after 300
 *     rows]` row a sink writes once its per-turn row ceiling is hit.
 *
 * Design call (not dictated by the mock, which only ever shows `kind:
 * 'thinking'` rows): `'reasoning'` rows get the SAME clamp+expand treatment
 * as `'thinking'` rows — both are capped free-text sinks with the identical
 * per-block-cap shape server-side, differing only in tag/length, so treating
 * them differently in the view would be an arbitrary asymmetry.
 */

import type { EventLogEntry } from './bridge-client';

/** Mirrors `orchestrator/interactive-session.ts`'s `REDACTED_THINKING_MARKER`
 *  — duplicated (not imported) across the forge-ui/orchestrator boundary. */
export const REDACTED_THINKING_MARKER = '[thinking redacted]';

/** Clamp point for thinking/reasoning rows (operator round-3 UX: "~200
 *  chars with per-block expand"). */
export const ACTIVITY_THINKING_CLAMP_CHARS = 200;

/** Total rendered rows, newest-last (mirrors `ArchitectActivityLog`'s
 *  `MAX_ENTRIES`, sized up: the drawer is full-width/scrollable rather than
 *  a ~280px inline box, so it can comfortably hold more history). */
export const ACTIVITY_LOG_MAX_ROWS = 150;

export type ActivityRowKind =
  | 'tool'
  | 'tool-coalesced'
  | 'thinking'
  | 'thinking-redacted'
  | 'reasoning'
  | 'capped'
  /** W7-B2 (knowledge-01): a job's own per-transition progress line —
   *  `event_type:'log'` with `metadata.kind:'progress'` (the kb-drain loop
   *  emits these: round-start / auto / turn-start / turn-end / gated /
   *  cancelled). Opt-in per event, so plain operator log lines still render
   *  nothing. */
  | 'progress';

export type ActivityRowClamp = {
  /** The first `ACTIVITY_THINKING_CLAMP_CHARS` characters of `text`. */
  shown: string;
  /** How many characters are hidden — the "+N chars" expander label. */
  restChars: number;
};

export type ActivityRow = {
  /** `EventLogEntry.event_id` — stable React key + expand-state key. */
  key: string;
  kind: ActivityRowKind;
  /** Short tag-chip label: the tool name, or 'think'/'reason'/'coalesced'. */
  tag: string;
  /** Full, untruncated row text. */
  text: string;
  /** Present only for a clampable ('thinking'/'reasoning') row whose text
   *  exceeds the clamp threshold; `null` for every other row (including a
   *  short thinking/reasoning block that never needed clamping). */
  clamp: ActivityRowClamp | null;
};

function clampFor(text: string): ActivityRowClamp | null {
  if (text.length <= ACTIVITY_THINKING_CLAMP_CHARS) return null;
  return {
    shown: text.slice(0, ACTIVITY_THINKING_CLAMP_CHARS),
    restChars: text.length - ACTIVITY_THINKING_CLAMP_CHARS,
  };
}

function toolRow(ev: EventLogEntry): ActivityRow {
  const meta = ev.metadata ?? {};
  if (meta['coalesced'] === true) {
    const coalesced = typeof meta['coalesced_count'] === 'number' ? meta['coalesced_count'] : 0;
    const sampledOut = typeof meta['sampled_out_count'] === 'number' ? meta['sampled_out_count'] : 0;
    const parts: string[] = [];
    if (coalesced > 0) parts.push(`${coalesced} coalesced`);
    if (sampledOut > 0) parts.push(`${sampledOut} sampled out`);
    return {
      key: ev.event_id,
      kind: 'tool-coalesced',
      tag: 'coalesced',
      text: parts.length > 0 ? parts.join(' · ') : 'calls coalesced',
      clamp: null,
    };
  }
  const tool = typeof meta['tool'] === 'string' ? (meta['tool'] as string) : ev.skill || '?';
  const inputSummary = typeof meta['input_summary'] === 'string' ? (meta['input_summary'] as string) : '';
  return { key: ev.event_id, kind: 'tool', tag: tool, text: inputSummary, clamp: null };
}

/** `null` for a `'log'` event this drawer has no row for (any `metadata.kind`
 *  other than `'thinking'`/`'reasoning'` — e.g. a plain operator-facing log
 *  line with no `kind` at all). */
function logRow(ev: EventLogEntry): ActivityRow | null {
  const meta = ev.metadata ?? {};
  const kind = meta['kind'];
  if (kind === 'progress') {
    // Strip a `kb-drain.`-style producer prefix down to the transition name
    // for the tag chip; the full message stays as the row text.
    const message = ev.message ?? '';
    const dot = message.indexOf('.');
    const paren = message.indexOf(' (');
    const tag = dot >= 0 ? message.slice(dot + 1, paren > dot ? paren : undefined) : 'progress';
    return { key: ev.event_id, kind: 'progress', tag: tag || 'progress', text: message, clamp: null };
  }
  if (kind !== 'thinking' && kind !== 'reasoning') return null;
  const message = ev.message ?? '';
  const tag = kind === 'thinking' ? 'think' : 'reason';
  if (meta['capped'] === true) {
    return { key: ev.event_id, kind: 'capped', tag, text: message, clamp: null };
  }
  if (kind === 'thinking' && message === REDACTED_THINKING_MARKER) {
    return { key: ev.event_id, kind: 'thinking-redacted', tag, text: message, clamp: null };
  }
  return { key: ev.event_id, kind, tag, text: message, clamp: clampFor(message) };
}

/** Derive the drawer's rows from a cycle's full event list — pure, no
 *  side effects. Events are assumed already chronological (append-only, as
 *  `useCycleEvents` provides); the return is capped to the newest
 *  `ACTIVITY_LOG_MAX_ROWS`. */
export function toActivityRows(events: readonly EventLogEntry[]): ActivityRow[] {
  const rows: ActivityRow[] = [];
  for (const ev of events) {
    let row: ActivityRow | null = null;
    if (ev.event_type === 'tool_use') row = toolRow(ev);
    else if (ev.event_type === 'log') row = logRow(ev);
    if (row) rows.push(row);
  }
  return rows.length > ACTIVITY_LOG_MAX_ROWS ? rows.slice(rows.length - ACTIVITY_LOG_MAX_ROWS) : rows;
}

/** The collapsed drawer's slim-bar summary — "phase chip + last activity
 *  line + cost" (operator round-3 UX). Honest empty state, never fabricated. */
export function deriveLastActivityLine(rows: readonly ActivityRow[]): string {
  if (rows.length === 0) return 'Waiting for activity…';
  const last = rows[rows.length - 1];
  const detail = last.text.length > 80 ? `${last.text.slice(0, 80)}…` : last.text;
  return detail ? `${last.tag} · ${detail}` : last.tag;
}

/** Cost/token/wall-time ticker text (mock: `$0.18 · 41.3k tok · 3m 12s`).
 *  Every field is OPTIONAL and rendered only when the caller actually has a
 *  wired value for it — `null` (omit the ticker entirely) when none are
 *  given, never a fabricated `$0.00`. Today only `RunPanel` has a real
 *  `costUsd` source (`PolledAgentRunStatus`); the architect/instructions
 *  session summary types carry no cost field yet (a disclosed gap, not
 *  papered over here). */
export function formatActivityCostTicker(input: {
  costUsd?: number;
  tokensTotal?: number;
  elapsedMs?: number;
}): string | null {
  const parts: string[] = [];
  if (typeof input.costUsd === 'number') parts.push(`$${input.costUsd.toFixed(2)}`);
  if (typeof input.tokensTotal === 'number') {
    parts.push(input.tokensTotal >= 1000 ? `${(input.tokensTotal / 1000).toFixed(1)}k tok` : `${input.tokensTotal} tok`);
  }
  if (typeof input.elapsedMs === 'number' && input.elapsedMs >= 0) {
    const totalSec = Math.floor(input.elapsedMs / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    parts.push(m > 0 ? `${m}m ${s}s` : `${s}s`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}
