/**
 * The run's OWN detail page — `/flows/<flowId>/run/<runId>` — `forge-8vfn.8.1.18`.
 *
 * The gate/artifact viewer (`app/artifact/page.tsx`) linked ONLY to the flow
 * MONITOR (`monitorHref`), never to the run's own timeline — `RunRail.tsx:394`
 * already links this exact shape (`/flows/${run.flowId}/run/${run.id}`) from
 * a different surface, so an operator sitting at a gate had no path back to
 * the run that produced it, and the stories runner's real-nav
 * (`scripts/stories/beats-drive.mjs`'s `[data-nav][href], a[href]`) found no
 * anchor to it at all.
 *
 * Returns `null` rather than guessing, same rule as `gate-artifact-href.ts`:
 * an absent run record has no flow of record, and a run whose flow id (or id)
 * came back empty (`studio-client.ts`'s `parseRun` defaults a dropped wire
 * field to `''`) has nothing honest to link either. A missing link is
 * honest; a guessed one spends the operator's attention on a route that may
 * not resolve.
 */

import type { Run } from './studio-client';

export function runDetailHref(run: Run | null): string | null {
  if (run === null) return null;
  if (!run.flowId || !run.id) return null;
  return `/flows/${encodeURIComponent(run.flowId)}/run/${encodeURIComponent(run.id)}`;
}
