/**
 * The knowledge base the operator was last working on — bead
 * `forge-8vfn.5.14`'s third and sharpest finding.
 *
 * WHAT WAS MEASURED. Story S6 beat 12: the operator creates `story-s6`, walks
 * away to start a planner run on the project it is bound to, comes back to
 * `/knowledge`, and is looking at somebody else's knowledge base —
 * `data-kb-id: expected "story-s6", got "cycles"`. A bare `/knowledge` picked
 * `allKbs[0].id`, the first row of the roster, so "go back to the knowledge
 * base" landed on whichever KB happens to sort first. Twice, in two separate
 * runs (2026-09-07 and 2026-09-08).
 *
 * The other two findings of that bead are already fixed and were re-derived
 * before this was written: the tabs carry `data-action="open-kb-tab-*"` and
 * `#kb-select` carries `data-field="kb-select"`.
 *
 * WHY LOCAL STORAGE. This is a per-operator, per-browser convenience, not
 * state the server owns: two people looking at the same forge should not
 * shove each other between knowledge bases, and a remembered selection has no
 * meaning to any other consumer. `KbGraph.tsx` in this same directory already
 * keeps its layout and tension presets exactly this way, prefix and all, so
 * this follows the neighbourhood's own convention rather than inventing one.
 *
 * EVERY ACCESS IS GUARDED, in both directions. `localStorage` throws outright
 * in a private window, in a browser configured to block site data, and under
 * some embedded contexts — and a page that cannot remember a selection must
 * still render. A read that fails returns `null` and the caller falls back to
 * the roster's first entry, which is exactly today's behaviour: this feature
 * can only ever improve on that, never replace it with an error.
 */

import { useEffect } from 'react';

const LAST_VIEWED_KEY = 'kb-last-viewed';

/** The last KB this browser looked at, or `null` if there is none to trust. */
export function readLastViewedKb(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LAST_VIEWED_KEY);
    return raw !== null && raw !== '' ? raw : null;
  } catch {
    return null; /* localStorage unavailable — fall back, never throw */
  }
}

/** Remember the KB the operator is on. A falsy id clears nothing and writes nothing. */
export function writeLastViewedKb(kbId: string): void {
  if (typeof window === 'undefined' || !kbId) return;
  try {
    window.localStorage.setItem(LAST_VIEWED_KEY, kbId);
  } catch {
    /* localStorage unavailable — the page simply will not remember */
  }
}

/**
 * Which KB should a bare `/knowledge` open?
 *
 * PURE, and separate from the page for that reason: the decision is the thing
 * worth testing, and it has three cases that are easy to get wrong. The
 * remembered id is honoured ONLY if the roster still contains it — a KB that
 * was deleted, or that belongs to a forge this browser last used, must not
 * strand the operator on a not-found; that is why this takes the roster
 * rather than trusting storage.
 */
export function initialKbId(rosterIds: readonly string[], remembered: string | null): string | null {
  if (rosterIds.length === 0) return null;
  if (remembered !== null && rosterIds.includes(remembered)) return remembered;
  return rosterIds[0];
}

/**
 * Record the KB the page has settled on, so a later bare `/knowledge` can
 * return to it.
 *
 * A CONFIRMED id only. `url-optimistic` is a guess the settled roster has not
 * agreed with yet, and remembering a guess would let one bad `?id=` in the
 * address bar become this browser's default knowledge base.
 *
 * Deliberately its own hook rather than a line inside the effect that CHOOSES
 * the id: that effect decides, this one records, and folding them together is
 * how a decision starts depending on its own side effect. Keeping it here
 * also keeps the whole persistence concern — key, guards, read, write and the
 * when — in one file the page does not have to know the inside of.
 */
export function useRememberLastViewedKb(idConfirmed: boolean, currentId: string): void {
  useEffect(() => {
    if (idConfirmed && currentId) writeLastViewedKb(currentId);
  }, [idConfirmed, currentId]);
}
