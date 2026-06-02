/**
 * Hex selection model (Feature #9) — clicking any pipeline hex (phase /
 * feature / work-item) selects it; a side drawer then shows that hex's
 * definition + a scoped activity tracker.
 *
 * `SelectedHex` is the single shared shape threaded from app/page.tsx through
 * AgentGraphCanvas → each hex node's onSelect, and into the detail drawer.
 *
 * `eventMatchesHex` is the ONE place the "does this event belong to the
 * selected hex?" rule lives, so the drawer's activity scope and the
 * ActivityPanel's hex filter can't drift:
 *   - wi      → metadata.work_item_id === id
 *   - feature → metadata.feature_id === id (dev-loop + PM emit it)
 *   - phase   → the event's canonical phase === id (closure folds into
 *               review-loop; the developer-unifier skill folds into unifier —
 *               mirroring the spine's phase derivation in phases.ts)
 */

import type { EventLogEntry } from './bridge-client';
import { canonicalPhase } from './phases';

export type HexKind = 'phase' | 'feature' | 'wi';

export type SelectedHex = { kind: HexKind; id: string };

/** The spine phase an event renders under — mirrors phaseForEvent in phases.ts
 *  (kept local so the filter matches the hex the operator actually clicked). */
function spinePhaseOf(e: EventLogEntry): string {
  if (e.skill === 'developer-unifier') return 'unifier';
  return canonicalPhase(e.phase);
}

export function eventMatchesHex(e: EventLogEntry, hex: SelectedHex): boolean {
  switch (hex.kind) {
    case 'wi':
      return readMetaString(e, 'work_item_id') === hex.id;
    case 'feature':
      return readMetaString(e, 'feature_id') === hex.id;
    case 'phase':
      return spinePhaseOf(e) === hex.id;
  }
}

function readMetaString(e: EventLogEntry, key: string): string | null {
  const v = e.metadata?.[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}
