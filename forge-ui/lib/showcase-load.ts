/**
 * SHOWCASE load orchestration (R4-14 WI-2) — the pure piece extracted from
 * the not-SSR-drivable `app/projects/[id]/showcase/page.tsx`'s own load
 * effect. Resolves the cycle via the REAL `listShowcaseCycleIds`
 * (`./project-showcase.ts` — head of list = `deriveShowcaseCycleId`'s pick,
 * with a W7-B6 operator override validated against the same list), then
 * calls the INJECTED
 * `fetchDemo` (the real caller passes `fetchDemoModel`, `./bridge-client.ts`)
 * EXACTLY once with EXACTLY that derived cycleId — the declared-data-fails-
 * open guard: a wrong/duplicate/never call here would silently N+1 the
 * bridge or show the wrong cycle's demo.
 */

import { listShowcaseCycleIds } from './project-showcase';
import type { Cycle, DemoModel } from './bridge-client';

export type ShowcaseLoadResult =
  | { kind: 'empty' }
  | { kind: 'loaded'; cycleId: string; model: DemoModel | null };

/**
 * Resolve the project's showcase cycle and fetch its `DemoModel`. When no
 * eligible cycle exists, `fetchDemo` is NEVER called and the result signals
 * `'empty'` — never a fabricated/blank `'loaded'` state.
 */
export async function loadShowcase(args: {
  cycles: Cycle[];
  projectId: string;
  fetchDemo: (cycleId: string) => Promise<DemoModel | null>;
  /** W7-B6 (projects-21): an operator-picked cycle from the cycle switcher.
   *  Honoured ONLY when it is genuinely eligible for this project (in
   *  `listShowcaseCycleIds`) — an unknown/foreign id falls back to the
   *  derived newest pick, never a fetch against an arbitrary id. */
  requestedCycleId?: string;
}): Promise<ShowcaseLoadResult> {
  const { cycles, projectId, fetchDemo, requestedCycleId } = args;
  const eligible = listShowcaseCycleIds(cycles, projectId);
  const cycleId = requestedCycleId !== undefined && eligible.includes(requestedCycleId)
    ? requestedCycleId
    : (eligible[0] ?? null);
  if (cycleId === null) {
    return { kind: 'empty' };
  }
  const model = await fetchDemo(cycleId);
  return { kind: 'loaded', cycleId, model };
}
