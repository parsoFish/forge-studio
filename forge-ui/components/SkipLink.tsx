'use client';

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
 * carries a stable id — and threading an id through every shell would touch
 * ~30 files for what is purely focus plumbing. So the click handler focuses
 * the first `<main>` directly (tabIndex -1 makes a landmark focusable
 * without joining the tab order); the `href="#main-content"` fallback keeps
 * it a real link for AT that activates links without firing click handlers.
 */
export function SkipLink() {
  return (
    <a
      className="skip-link"
      href="#main-content"
      data-component="skip-link"
      onClick={(e) => {
        const main = document.querySelector('main');
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
