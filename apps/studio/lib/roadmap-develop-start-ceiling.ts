/**
 * Pure resolver for the per-kickoff develop-start cost ceiling (forge-shc).
 *
 * Lives in lib/ (not the page) because a Next.js `page.tsx` may only export a
 * default component plus Next's own reserved names — an arbitrary named export
 * there fails `next build`'s page-type check (tsc does not catch it). The
 * roadmap "Start development" affordance and its acceptance test both import
 * from here.
 *
 * Opt-in gate: absent an explicit operator edit (`ceilingTouched === false`)
 * this returns `undefined` so `POST /api/develop/start` sends no
 * `costCeilingUsd` and the manifest's own budget-derived ceiling stands —
 * never silently overwritten by the run-level default.
 */
export function resolveDevelopStartCeilingToSend(
  fieldValue: number,
  ceilingTouched: boolean,
): number | undefined {
  if (!ceilingTouched) return undefined;
  return Number.isFinite(fieldValue) && fieldValue > 0 ? fieldValue : undefined;
}
