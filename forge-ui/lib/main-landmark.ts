/**
 * main-landmark — the id every route's `<main>` DECLARES (W7-C3 review,
 * A-H1/A-H2/A-H3, park-point C3-PP-1).
 *
 * The skip link needs a fragment that resolves. The first cut stamped one
 * onto `document.querySelector('main')` from a `useEffect` keyed to the
 * pathname, which broke three ways at once: it OVERWROTE an id a route had
 * already declared for its own selectors (`#col-center`), it never re-ran
 * when a route swapped its `<main>` mid-life (loading `<main>` → `<RunView>`
 * is a component-type change at the same tree position, so React mounts a
 * brand-new, id-less node while `pathname` is unchanged), and it left the
 * prerendered HTML advertising a dangling fragment until hydration.
 *
 * The cure is to stop stamping and start declaring: the id lives in the
 * markup, on the same element the route already renders as its landmark, so
 * it is true in SSR output, true in every branch, and cannot clobber
 * anything. `lib/main-landmark.test.ts` enumerates every `<main>` in the app
 * and fails when a new one lands without it.
 */
export const MAIN_CONTENT_ID = 'main-content';
