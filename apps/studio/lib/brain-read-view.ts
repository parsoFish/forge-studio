/**
 * forge-8vfn.5.16 (M7-C U2) — pure reducer over a run's raw event stream
 * (from `useCycleEvents`), folding every real `message:"brain.read"` event
 * (emitted by `packages/stations/phases/project-manager.ts`, one per KB
 * `readPmBrainContext`'s deterministic pre-fetch actually touched) into one
 * row per KB. Feeds PhaseDrawer.tsx's `data-brain-read-kb`/
 * `data-brain-read-count` — a surface distinct from both the pre-existing
 * plain-text "brain reads: N" line (a raw tool-use COUNT, no KB attribution)
 * and the Knowledge page's Ingest Activity tab (the reflector's WRITE side,
 * `reflect.kb-ingest`).
 *
 * No DOM, no network — mirrors hook-library-view.ts's testability
 * convention (this repo's vitest has no jsdom).
 */
import type { EventLogEntry } from './bridge-client';

export type BrainReadSummaryRow = { kbId: string; count: number };

/**
 * `events` is a run's FULL raw event stream (unfiltered). Deliberately
 * strict on `metadata.kbId` being a non-empty string — the architect's
 * OWN pre-existing `brain-query` event_type (an unconditional per-turn
 * marker, `packages/sessions/kinds/architect.ts`) shares the same
 * `event_type` but carries no `kbId`, and must never fabricate a row here.
 */
export function deriveBrainReadSummary(events: readonly EventLogEntry[]): BrainReadSummaryRow[] {
  const counts = new Map<string, number>();
  for (const e of events) {
    if (e.message !== 'brain.read') continue;
    const kbId = e.metadata?.['kbId'];
    if (typeof kbId !== 'string' || !kbId) continue;
    const themeCount = e.metadata?.['themeCount'];
    const delta = typeof themeCount === 'number' ? themeCount : 1;
    counts.set(kbId, (counts.get(kbId) ?? 0) + delta);
  }
  return [...counts.entries()].map(([kbId, count]) => ({ kbId, count }));
}
