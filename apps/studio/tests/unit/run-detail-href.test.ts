/**
 * `forge-8vfn.8.1.18` — the run's OWN detail page — `/flows/<flowId>/run/
 * <runId>`, the same shape `RunRail.tsx:394` already links
 * (`/flows/${run.flowId}/run/${run.id}`). The gate/artifact viewer
 * (`app/artifact/page.tsx`) had no path to it at all — only `monitorHref`,
 * the flow MONITOR — so an operator at a gate could not get back to the
 * run's own timeline.
 *
 * Mirrors `gate-artifact-href.test.ts`'s shape for the same reason: a run
 * record that does not exist, or one whose flow id came back empty
 * (`parseRun`'s `?? ''` default for a field the wire dropped), has nothing
 * honest to link — `null` rather than a guessed path.
 *
 * RUN: npx vitest run apps/studio/tests/unit/run-detail-href.test.ts   (from apps/studio/)
 */

import { test, expect } from 'vitest';
import { runDetailHref } from '@/lib/run-detail-href';
import type { Run } from '@/lib/studio-client';

function run(over: Partial<Run> = {}): Run {
  return { id: 'CYCLE-1', flowId: 'forge-develop', ...over } as unknown as Run;
}

test('a known run with a known flow links to its own detail page', () => {
  expect(runDetailHref(run())).toBe('/flows/forge-develop/run/CYCLE-1');
});

test('no run record — no link, never a guessed path', () => {
  expect(runDetailHref(null)).toBeNull();
});

test('an empty flow id resolves nothing — an orphan run has no flow of record', () => {
  expect(runDetailHref(run({ flowId: '' }))).toBeNull();
});

test('an empty run id resolves nothing either', () => {
  expect(runDetailHref(run({ id: '' }))).toBeNull();
});

test('both segments are URL-encoded — flow/cycle ids carry slashes and colons in other shapes', () => {
  expect(runDetailHref(run({ id: 'a/b:c', flowId: 'f/g' }))).toBe('/flows/f%2Fg/run/a%2Fb%3Ac');
});
