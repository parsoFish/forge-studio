'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/** The fragment the skip link targets, stamped onto the route's own <main>. */
const MAIN_ID = 'main-content';

/**
 * SkipLink — the first tab stop on every route (W7-C3, crosscut-18).
 *
 * A keyboard user was forced through the brand link + six nav pillars on
 * every page before reaching content. This link is visually hidden until
 * focused (`.skip-link` in globals.css) and jumps focus to the page's
 * `<main>` element.
 *
 * Every route renders exactly one `<main>` (the StudioPage/PageLoadError/
 * NotFound shells and the bespoke detail pages all root in one), but none
 * carries a stable id of its own — and threading an id through every shell
 * would touch ~30 files for what is purely focus plumbing. So this component
 * stamps `#main-content` onto whatever `<main>` the current route rendered,
 * re-stamping on every client-side navigation (the element is replaced), and
 * the click handler focuses it directly (tabIndex -1 makes a landmark
 * focusable without joining the tab order).
 *
 * The stamp is what keeps `href="#main-content"` HONEST: without it the link
 * advertises a fragment that resolves to nothing, so any AT that follows the
 * href rather than firing the click handler skips to nowhere — a skip link
 * that silently does not skip is worse than none, because it reads as
 * provided.
 */
export function SkipLink() {
  const pathname = usePathname();
  useEffect(() => {
    document.querySelector('main')?.setAttribute('id', MAIN_ID);
  }, [pathname]);
  return (
    <a
      className="skip-link"
      href={`#${MAIN_ID}`}
      data-component="skip-link"
      onClick={(e) => {
        const main = document.querySelector('main');
        if (!main) return; // fall through to the anchor default
        e.preventDefault();
        main.setAttribute('id', MAIN_ID);
        main.setAttribute('tabindex', '-1');
        main.focus();
      }}
    >
      Skip to content
    </a>
  );
}
