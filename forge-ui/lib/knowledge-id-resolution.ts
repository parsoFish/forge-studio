/**
 * The Knowledge page's `?id=` resolution DECISION, extracted as a pure
 * function (W6-P4 review fix #4 — the prior source-regex tests over
 * `app/knowledge/page.tsx` were tautological; this is the real, unit-testable
 * behavior they stood in for).
 *
 * `app/knowledge/page.tsx`'s "Resolve active KB id" effect wires this
 * decision into state: `source === 'url-optimistic'` is the ONE case that
 * isn't final yet (the page tracks it as `idConfirmed = false`, gating
 * `data-page-ready` — review fix #3 — so an unconfirmed guess never
 * surfaces a transient `ready=true` a poller could sample before the
 * roster-settled correction below). Every other source is final.
 */

/** Minimal structural shape — deliberately NOT the full `Kb` type from
 *  studio-client.ts, so this stays trivially constructible in tests. */
export type KbIdCandidate = { id: string };

export type ActiveKbIdSource =
  | 'url-optimistic' // idParam trusted BEFORE the roster has settled — may still be corrected.
  | 'validated'       // idParam confirmed present in the settled roster.
  | 'fallback'        // idParam absent or stale; the settled roster's first KB is used instead.
  | 'none';           // settled, empty roster, no id can be resolved.

export type ActiveKbIdResolution = { id: string; source: ActiveKbIdSource };

/**
 * Given the current `?id=` URL param, the kbs roster, and whether that
 * roster has settled, decide which KB id should be active RIGHT NOW.
 *
 * Scope: this covers ONLY the plain `?id=` case (no `?node=`/`?theme=`
 * present) — that pairing has its own pre-existing, unconditionally-trusted
 * resolution in page.tsx (via `resolveKbNode`), untouched by W6-P4.
 */
export function resolveActiveKbId(
  idParam: string,
  allKbs: readonly KbIdCandidate[],
  kbListReady: boolean,
): ActiveKbIdResolution {
  if (idParam) {
    if (!kbListReady) return { id: idParam, source: 'url-optimistic' };
    if (allKbs.some((k) => k.id === idParam)) return { id: idParam, source: 'validated' };
    if (allKbs.length > 0) return { id: allKbs[0].id, source: 'fallback' };
    return { id: '', source: 'none' };
  }
  if (allKbs.length > 0) return { id: allKbs[0].id, source: 'fallback' };
  return { id: '', source: 'none' };
}
