/**
 * sessions-index-filter — pure filter derivation for the `/sessions` index
 * (W7-B1, home-sessions-07: the index had no filter, no sort, no grouping —
 * a static mirror of the bridge sort with no operator lever at all).
 *
 * PURE on purpose (mirrors `home-view.ts`'s own contract): no fetch, no DOM,
 * no React — `SessionsIndexBody` holds the filter STATE and calls these to
 * derive what to render, so the behaviour is unit-testable without a mount.
 *
 * Filtering never re-sorts: the bridge's needs-you-first-then-newest order
 * (`sortAndCapSessionIndexRows`, apps/forge/ui-bridge.ts) is preserved verbatim —
 * a filter only removes rows, exactly like the component's own established
 * "renders that order verbatim, never re-sorting client-side" rule.
 */

import type { SessionIndexRow } from './studio-client';

/** `''` on any field = no constraint (the "all" option). */
export type SessionFilters = {
  kind: string;
  project: string;
  /** One of the bridge's derived lifecycle states (`working` |
   *  `awaiting-operator` | `crashed` | `stalled` — `terminal` never appears
   *  in the active set this page shows). */
  state: string;
  needsYouOnly: boolean;
};

export const NO_SESSION_FILTERS: SessionFilters = { kind: '', project: '', state: '', needsYouOnly: false };

export function hasActiveSessionFilters(f: SessionFilters): boolean {
  return f.kind !== '' || f.project !== '' || f.state !== '' || f.needsYouOnly;
}

/** Order-preserving filter — never re-sorts, only removes. */
export function filterSessionRows(rows: readonly SessionIndexRow[], f: SessionFilters): SessionIndexRow[] {
  return rows.filter((r) =>
    (f.kind === '' || r.kind === f.kind) &&
    (f.project === '' || r.project === f.project) &&
    (f.state === '' || r.state === f.state) &&
    (!f.needsYouOnly || r.needsYou),
  );
}

/** Distinct values in FIRST-SEEN order (the bridge's own sort) — the filter
 *  dropdowns offer only values that actually exist in the current set,
 *  never a hardcoded list that could drift from reality. */
function distinctInOrder(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

export function distinctSessionKinds(rows: readonly SessionIndexRow[]): string[] {
  return distinctInOrder(rows.map((r) => r.kind));
}

export function distinctSessionProjects(rows: readonly SessionIndexRow[]): string[] {
  return distinctInOrder(rows.map((r) => r.project));
}

export function distinctSessionStates(rows: readonly SessionIndexRow[]): string[] {
  return distinctInOrder(rows.map((r) => r.state));
}

/** Review round 1 — a controlled `<select>` whose ACTIVE value vanished from
 *  the live set (the W7-B1 WS refetch can remove the last row of the
 *  filtered kind) would silently display the "all …" option while the stale
 *  constraint keeps filtering. Keep the active value in the option list so
 *  the UI always SHOWS the constraint it is applying. */
export function filterOptions(present: readonly string[], active: string): string[] {
  return active !== '' && !present.includes(active) ? [...present, active] : [...present];
}
