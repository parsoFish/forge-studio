/**
 * Hex selection model (Feature #9) — clicking any pipeline hex (phase /
 * feature / work-item) selects it; a side drawer then shows that hex's
 * definition + a scoped activity tracker.
 *
 * `SelectedHex` is the single shared shape threaded from app/page.tsx through
 * AgentGraphCanvas → each hex node's onSelect, and into the detail drawer.
 *
 * `eventMatchesHex` is the ONE place the "does this event belong to the
 * selected hex?" rule lives. It reuses `canonicalPhase` from phases.ts so the
 * routing rule stays in one place:
 *   - wi      → metadata.work_item_id === id
 *   - feature → metadata.feature_id === id (dev-loop + PM emit it)
 *   - phase   → canonical spine phase === id (closure → review-loop;
 *               developer-unifier skill → unifier)
 */

import type { EventLogEntry } from './bridge-client';
import { canonicalPhase } from './phases';

export type HexKind = 'phase' | 'feature' | 'wi';

export type SelectedHex = { kind: HexKind; id: string };

export function eventMatchesHex(e: EventLogEntry, hex: SelectedHex): boolean {
  switch (hex.kind) {
    case 'wi':
      return readMetaString(e, 'work_item_id') === hex.id;
    case 'feature':
      return readMetaString(e, 'feature_id') === hex.id;
    case 'phase': {
      // developer-unifier events belong to the 'unifier' spine phase, matching
      // the same rule as phaseForEvent in phases.ts (single source of truth for
      // the routing rule; we reuse canonicalPhase from there).
      const spinePhase = e.skill === 'developer-unifier' ? 'unifier' : canonicalPhase(e.phase);
      return spinePhase === hex.id;
    }
  }
}

function readMetaString(e: EventLogEntry, key: string): string | null {
  const v = e.metadata?.[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}
