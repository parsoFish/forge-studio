/**
 * The activity drawer's height, published once to the two things that need it.
 *
 * Bead `forge-8vfn.7.6.6`. `ActivityLog` is `position: fixed; bottom: 0`, so
 * it overlays whatever the page has at the bottom of the VIEWPORT. Since
 * wave-6 it has reserved its height on `document.body.style.paddingBottom`,
 * which stops content being stranded underneath at the END of the document.
 * That is not the same guarantee as "no control is ever under it": a browser
 * scrolling an element minimally into view parks it at the viewport's bottom
 * edge, which is the drawer's band, wherever in the document that element
 * lives. Measured doing exactly that in M6-D's S4 run 2, on the architect
 * interview's own Submit button.
 *
 * `scroll-margin-bottom` is the property that fixes it, and CSS can only read
 * a measured height through a custom property — hence this module. Both
 * writes come from ONE number by construction, because two reservations
 * computed separately are two reservations that eventually disagree.
 */

/** The custom property the drawer publishes and controls scroll clear of.
 *  Exported so no consumer can spell it its own way (a mis-spelled `var()`
 *  falls back silently and puts the control straight back under the drawer). */
export const DRAWER_HEIGHT_VAR = '--activity-drawer-h';

/** Just the surface this module touches — so it is callable with a stub, and
 *  so nothing here can reach for the rest of `document`. */
export type ReservationTarget = {
  body: { style: { paddingBottom: string } };
  documentElement: { style: { setProperty(name: string, value: string): void } };
};

/**
 * Reserve `heightPx` at the bottom of the page: as document padding (nothing
 * stranded below the drawer) and as {@link DRAWER_HEIGHT_VAR} (nothing
 * scrolled under it).
 *
 * A non-finite height is REFUSED rather than written: `NaN px` is not a
 * reservation, it is a reservation that silently does nothing, and the last
 * good value is a better answer than that.
 */
export function reserveDrawerSpace(heightPx: number, doc: ReservationTarget): void {
  if (!Number.isFinite(heightPx)) return;
  const px = `${heightPx}px`;
  doc.body.style.paddingBottom = px;
  doc.documentElement.style.setProperty(DRAWER_HEIGHT_VAR, px);
}
