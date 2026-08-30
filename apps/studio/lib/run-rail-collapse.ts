/**
 * run-rail-collapse — the RunRail's per-flow group-collapse persistence
 * (W7-A3, flows-31). Sits next to the already-persisted run selection
 * (`forge-run-sel:<flowId>`, app/flows/[id]/page.tsx): a stored map wins,
 * otherwise COMPLETE starts collapsed once it outgrows the threshold.
 */
export const RUN_RAIL_COLLAPSE_THRESHOLD = 10;

export type RailStatus = 'gated' | 'active' | 'failed' | 'planned' | 'complete';
export type RailCollapsed = Partial<Record<RailStatus, boolean>>;

const RAIL_STATUSES: RailStatus[] = ['gated', 'active', 'failed', 'planned', 'complete'];

export function railStorageKey(flowId: string): string {
  return `forge-run-groups:${flowId}`;
}

function parseStored(stored: string | null): RailCollapsed | null {
  if (!stored) return null;
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const out: RailCollapsed = {};
    for (const key of RAIL_STATUSES) {
      const v = (parsed as Record<string, unknown>)[key];
      if (v === undefined) continue;
      if (typeof v !== 'boolean') return null;
      out[key] = v;
    }
    return out;
  } catch {
    return null;
  }
}

export function initialCollapsed(stored: string | null, counts: Partial<Record<RailStatus, number>>): RailCollapsed {
  const fromStore = parseStored(stored);
  if (fromStore) return fromStore;
  return (counts.complete ?? 0) > RUN_RAIL_COLLAPSE_THRESHOLD ? { complete: true } : {};
}

export function serializeCollapsed(c: RailCollapsed): string {
  return JSON.stringify(c);
}

/**
 * W7-FIX-A3: which of a group's runs the rail renders. An expanded group
 * renders every run; a collapsed group renders ONLY the currently selected
 * run (when it belongs to the group) — collapse hides the pile, never the
 * selection. Without this, the just-completed, selected run vanished from
 * the rail the moment COMPLETE crossed the threshold, and the only
 * `[data-run-id]` left for it was the HistoryLedger row (a link).
 */
export function visibleGroupRuns<T extends { id: string }>(group: T[], isCollapsed: boolean, activeRunId: string | null): T[] {
  if (!isCollapsed) return group;
  return group.filter((r) => r.id === activeRunId);
}
