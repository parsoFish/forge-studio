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
