/**
 * Live agent activity derivations (Phase B) consumed by AgentGraphCanvas
 * (ephemeral tool nodes that pulse off the active work item) and FileHeatmap
 * (the file-attention heatmap). Both read the per-tool `tool_use` /
 * `file_change` events emitted by orchestrator/tool-event-emit.ts.
 *
 * Pure + synchronous so they're unit-testable without the React tree.
 */

import type { EventLogEntry } from './bridge-client';
import { canonicalPhase } from './phases';

export type LiveToolNode = {
  /** Stable id for React Flow keying. */
  key: string;
  /** Owner hex this burst hangs off — a WI (`WI-n`) or a phase name. */
  ownerId: string;
  ownerKind: 'wi' | 'phase';
  tool: string;
  summary: string;
  /** Age in ms since the tool fired — drives the fade-in/out opacity. */
  ageMs: number;
};

/**
 * Ephemeral tool-call bursts: tool_use events whose age is within `windowMs`
 * of `nowMs`, so they flash off their owner hex and fade — the agent-flow
 * "quick burst" feel rather than a permanent pill stack. Owner is the WI when
 * the event carries `work_item_id` (dev-loop), else the phase (architect / PM
 * / review / … fire tools before any WI exists). Returns newest-first.
 *
 * Replay note: for a finished cycle every event is old, so nothing bursts —
 * correct, since replay shows final state, not live activity. Bursts only
 * animate for a genuinely live cycle (recent event timestamps).
 */
export function deriveLiveToolBursts(
  events: readonly EventLogEntry[],
  nowMs: number,
  opts: { windowMs?: number; perOwner?: number; total?: number } = {},
): LiveToolNode[] {
  const windowMs = opts.windowMs ?? 2800;
  const perOwner = opts.perOwner ?? 5;
  const total = opts.total ?? 18;
  if (!nowMs) return [];
  const perOwnerCount = new Map<string, number>();
  const out: LiveToolNode[] = [];
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e.event_type !== 'tool_use') continue;
    const md = e.metadata as { work_item_id?: string; tool?: string; input_summary?: string; coalesced?: boolean } | undefined;
    if (!md || md.coalesced === true) continue;
    const ageMs = nowMs - Date.parse(e.started_at);
    if (Number.isNaN(ageMs) || ageMs < 0 || ageMs > windowMs) continue;
    const ownerId = typeof md.work_item_id === 'string' ? md.work_item_id : canonicalPhase(e.phase);
    const ownerKind: 'wi' | 'phase' = typeof md.work_item_id === 'string' ? 'wi' : 'phase';
    const n = perOwnerCount.get(ownerId) ?? 0;
    if (n >= perOwner) continue;
    perOwnerCount.set(ownerId, n + 1);
    out.push({ key: `${ownerId}:${e.event_id}`, ownerId, ownerKind, tool: md.tool ?? 'tool', summary: md.input_summary ?? '', ageMs });
    if (out.length >= total) break;
  }
  return out;
}

export type FileHeat = {
  path: string;
  changes: number;
  lastOp: 'add' | 'modify' | 'delete';
};

/** Per-tool colour vocab mirroring agent-flow (Bash amber, write-family green, …). */
const TOOL_COLOURS: Record<string, string> = {
  Bash: '#d29922',
  Edit: '#7ee787',
  Write: '#7ee787',
  MultiEdit: '#7ee787',
  NotebookEdit: '#7ee787',
  Read: '#58a6ff',
  Grep: '#d2a8ff',
  Glob: '#d2a8ff',
  WebSearch: '#39c5cf',
  WebFetch: '#39c5cf',
};

export function toolColour(name: string): string {
  return TOOL_COLOURS[name] ?? '#8b949e';
}

export type WiActivity = { costUsd: number; tokens: number; lastReasoning: string; lastReasoningAt: string };

/**
 * Per-work-item cost + token totals + latest reasoning text, summed from the
 * SDK-backed `iteration` events (which carry cost_usd / tokens_in / tokens_out
 * and metadata.last_assistant_text). Feeds the hex agents' cost pill, token
 * bar, and reasoning bubble.
 */
export function derivePerWiActivity(events: readonly EventLogEntry[]): Record<string, WiActivity> {
  const out: Record<string, WiActivity> = {};
  // Live token reconciliation (operator: "see some cost live, not only at
  // closure"): `tokens` = committed (authoritative tokens from iteration/end
  // events) + in-flight (per-turn `usage_delta` tokens since the last
  // authoritative event). An authoritative event RESETS in-flight — its total
  // supersedes the per-turn estimate — so deltas tick the count live DURING an
  // iteration without double-counting the iteration total. No pricing table:
  // tokens tick live; $ lands at the authoritative points the SDK gives us.
  const inflight: Record<string, number> = {};
  for (const e of events) {
    const md = e.metadata as { work_item_id?: string; last_assistant_text?: string; input_tokens?: number; output_tokens?: number } | undefined;
    const wi = md?.work_item_id;
    if (typeof wi !== 'string') continue;
    const a = out[wi] ?? { costUsd: 0, tokens: 0, lastReasoning: '', lastReasoningAt: '' };
    if (e.message === 'usage_delta') {
      inflight[wi] = (inflight[wi] ?? 0) + (md?.input_tokens ?? 0) + (md?.output_tokens ?? 0);
    } else {
      let authoritative = false;
      if (typeof e.tokens_in === 'number') { a.tokens += e.tokens_in; authoritative = true; }
      if (typeof e.tokens_out === 'number') { a.tokens += e.tokens_out; authoritative = true; }
      if (authoritative) inflight[wi] = 0;
      // Count cost only on 'iteration' events. The per-WI 'ralph.end' event
      // (event_type='end', message='ralph.end') re-states the same dollars
      // already counted on the iteration events — adding it would double-count.
      if (e.event_type === 'iteration' && typeof e.cost_usd === 'number') a.costUsd += e.cost_usd;
      if (typeof md?.last_assistant_text === 'string' && md.last_assistant_text) {
        a.lastReasoning = md.last_assistant_text;
        a.lastReasoningAt = e.started_at;
      }
    }
    out[wi] = a;
  }
  for (const wi of Object.keys(out)) out[wi] = { ...out[wi], tokens: out[wi].tokens + (inflight[wi] ?? 0) };
  return out;
}

type StageTotals = { agents: number; tokens: number; costUsd: number };

/** Top-bar rollup: active-agent count, total tokens, total cost across the cycle. */
export function deriveStageTotals(
  events: readonly EventLogEntry[],
  activeAgentCount: number,
): StageTotals {
  // Same committed-vs-in-flight reconciliation as derivePerWiActivity, but
  // global — keyed by owner (work item, else phase) so a per-turn usage_delta
  // and its later authoritative iteration event reconcile against each other.
  //
  // Cost de-duplication: for phases that emit 'iteration' events (developer-loop,
  // unifier) the same dollars also appear on 'end' events — count only iteration
  // events for those phases to avoid 2x/3x over-counting. Phases with no
  // iteration events (project-manager, reflection, …) carry their cost only on
  // 'end' events and are counted as-is.
  const phasesWithIterations = new Set<string>();
  for (const e of events) {
    if (e.event_type === 'iteration') phasesWithIterations.add(e.phase ?? '');
  }

  let committed = 0;
  let costUsd = 0;
  const inflight: Record<string, number> = {};
  for (const e of events) {
    const md = e.metadata as { work_item_id?: string; input_tokens?: number; output_tokens?: number } | undefined;
    const owner = md?.work_item_id ?? e.phase ?? '*';
    if (e.message === 'usage_delta') {
      inflight[owner] = (inflight[owner] ?? 0) + (md?.input_tokens ?? 0) + (md?.output_tokens ?? 0);
    } else {
      let authoritative = false;
      if (typeof e.tokens_in === 'number') { committed += e.tokens_in; authoritative = true; }
      if (typeof e.tokens_out === 'number') { committed += e.tokens_out; authoritative = true; }
      if (authoritative) inflight[owner] = 0;
      const countCost = phasesWithIterations.has(e.phase ?? '')
        ? e.event_type === 'iteration'
        : true;
      if (countCost && typeof e.cost_usd === 'number') costUsd += e.cost_usd;
    }
  }
  const inflightTotal = Object.values(inflight).reduce((s, n) => s + n, 0);
  return { agents: activeAgentCount, tokens: committed + inflightTotal, costUsd };
}

/**
 * Aggregate `file_change` events into a path → change-count heatmap, sorted
 * hottest-first.
 */
export function deriveFileHeatmap(events: readonly EventLogEntry[]): FileHeat[] {
  const byPath = new Map<string, { changes: number; lastOp: FileHeat['lastOp'] }>();
  for (const e of events) {
    if (e.event_type !== 'file_change') continue;
    const md = e.metadata as { path?: string; op?: FileHeat['lastOp'] } | undefined;
    const path = md?.path;
    if (typeof path !== 'string') continue;
    const cur = byPath.get(path) ?? { changes: 0, lastOp: 'modify' as const };
    cur.changes += 1;
    if (md?.op) cur.lastOp = md.op;
    byPath.set(path, cur);
  }
  return Array.from(byPath.entries())
    .map(([path, v]) => ({ path, changes: v.changes, lastOp: v.lastOp }))
    .sort((a, b) => b.changes - a.changes);
}
