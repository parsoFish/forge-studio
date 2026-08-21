'use client';

import { MAIN_CONTENT_ID } from '@/lib/main-landmark';

/**
 * SkipLink — the first tab stop on every route (W7-C3, crosscut-18).
 *
 * A keyboard user was forced through the brand link + six nav pillars on
 * every page before reaching content. This link is visually hidden until
 * focused (`.skip-link` in globals.css) and jumps focus to the page's
 * `<main>` landmark.
 *
 * The target is DECLARED, not stamped (W7-C3 review, A-H2/A-H3): every
 * `<main>` in the app renders `id={MAIN_CONTENT_ID}` in its own markup, so
 * the fragment resolves in the prerendered HTML, survives a route replacing
 * its `<main>` mid-life, and never overwrites an id a route already owns.
 * The first cut stamped the id from a `useEffect([pathname])` and broke all
 * three ways — see `lib/main-landmark.ts` for the post-mortem and
 * `lib/main-landmark.test.ts` for the enumeration that keeps it true.
 *
 * The click handler still runs: `href="#id"` moves the viewport but not
 * focus, so the handler makes the landmark focusable (`tabindex="-1"` keeps
 * it out of the tab order) and focuses it. If the landmark is genuinely
 * missing the handler does nothing and the anchor's own default applies —
 * the enumeration test, not a runtime patch, is what stops that state.
 */
export function SkipLink() {
  return (
    <a
      className="skip-link"
      href={`#${MAIN_CONTENT_ID}`}
      data-component="skip-link"
      onClick={(e) => {
        const main = document.getElementById(MAIN_CONTENT_ID);
        if (!main) return; // fall through to the anchor default
        e.preventDefault();
        main.setAttribute('tabindex', '-1');
        main.focus();
      }}
    >
      Skip to content
    </a>
  );
}
