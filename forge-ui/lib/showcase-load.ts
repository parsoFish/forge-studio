/**
 * SHOWCASE load orchestration (R4-14 WI-2) — the pure piece extracted from
 * the not-SSR-drivable `app/projects/[id]/showcase/page.tsx`'s own load
 * effect. Calls the REAL `deriveShowcaseCycleId` (`./project-showcase.ts`)
 * to decide which cycle's demo to render, then calls the INJECTED
 * `fetchDemo` (the real caller passes `fetchDemoModel`, `./bridge-client.ts`)
 * EXACTLY once with EXACTLY that derived cycleId — the declared-data-fails-
 * open guard: a wrong/duplicate/never call here would silently N+1 the
 * bridge or show the wrong cycle's demo.
 */

import { deriveShowcaseCycleId } from './project-showcase';
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
}): Promise<ShowcaseLoadResult> {
  const { cycles, projectId, fetchDemo } = args;
  const cycleId = deriveShowcaseCycleId(cycles, projectId);
  if (cycleId === null) {
    return { kind: 'empty' };
  }
  const model = await fetchDemo(cycleId);
  return { kind: 'loaded', cycleId, model };
}
