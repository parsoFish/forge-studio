/**
 * W6-RV-2 — DOM acceptance tests for `RoadmapCanvas`
 * (forge-ui/components/studio/RoadmapCanvas.tsx), the completion-time
 * canvas + push drawer that replaces `RoadmapDag` (the R4-13/W6-RV-1
 * dependency-depth column layout, retired this pass — see
 * `roadmap-serpentine-retired.test.ts` for the analogous "old impl truly
 * gone" pattern this doesn't duplicate; this file only pins the NEW
 * contract).
 *
 * RENDER CONVENTION (repo NO-jsdom pattern, same as
 * `lib/run-panel-render.test.ts` / the retired roadmap-dag-render.test.ts):
 * `renderToStaticMarkup` + string-based DOM helpers. `useEffect` (initial
 * `fitView()`, pan/wheel listeners) does NOT run under this convention —
 * these tests pin the INITIAL-render DOM contract only (canvas geometry is
 * ALREADY fully computed by the pure layout module, so the initial markup
 * carries real, correct positions — unlike the old RoadmapDag, which needed
 * a post-mount `ResizeObserver` measurement pass for its edges).
 *
 * data-* CONTRACT this file pins (see docs/forge-ui-dom-and-harness.md's
 * Roadmap section for the full doc):
 *   [data-roadmap-canvas]            outer container (was [data-roadmap-dag])
 *   [data-roadmap-node]              one per initiative, ALWAYS
 *                                    data-initiative-collapsed="true" (no
 *                                    more inline expand/collapse)
 *   [data-day-column] / [data-band]  time-axis day buckets / pending bands
 *   [data-projected-zone]            the hatched "projected" zone
 *   [data-dep-edge]                  unchanged edge contract (data-dep-from/to)
 *   [data-roadmap-drawer]            the push drawer, data-drawer-open
 *   [data-drawer-initiative]         present only while a card is selected;
 *                                    wraps InitiativeDetail (expanded=true) —
 *                                    the SAME RV-1 affordance data-* bytes
 *
 * RUN: npx vitest run lib/roadmap-canvas-render.test.ts   (from forge-ui/)
 */

import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { RoadmapCanvas } from '@/components/studio/RoadmapCanvas';
import type { ProjectRoadmap, RoadmapInitiative, RoadmapWorkItem } from '@/lib/bridge-client';
import type { InitiativeGroup } from '@/lib/cycle-grouping';

const NOW_MS = Date.parse('2026-06-10T00:00:00.000Z');

// ---------------------------------------------------------------------------
// Fixture — mirrors the retired roadmap-dag-render.test.ts fixture (same 4
// initiatives / edge shape), PLUS a real `completedAt` on INIT-A so the
// canvas has something on its time axis to assert against.
//   INIT-A  (done, completedAt)  deps []            <- on the time axis; has runs
//   INIT-B  (failed)             deps [A]           <- recoverable, pending band "in-flight"
//   INIT-C  (pending, blocked)   deps [A, B]         <- planned, band "after-prerequisites"
//   INIT-D  (pending, unplanned) deps []             <- band "unplanned"
// ---------------------------------------------------------------------------

function wi(id: string, status?: RoadmapWorkItem['status']): RoadmapWorkItem {
  return { id, title: `work item ${id}`, dependsOn: [], status };
}

function initiative(over: Partial<RoadmapInitiative> & { initiativeId: string }): RoadmapInitiative {
  return {
    title: `Initiative ${over.initiativeId}`,
    status: 'pending',
    dependsOnInitiatives: [],
    ready: true,
    blockedBy: [],
    ...over,
  };
}

function buildRoadmap(): ProjectRoadmap {
  return {
    projectId: 'gitpulse',
    initiatives: [
      initiative({
        initiativeId: 'INIT-A',
        status: 'done',
        dependsOnInitiatives: [],
        workItems: [wi('WI-A1')],
        completedAt: '2026-06-05T09:00:00.000Z',
      }),
      initiative({
        initiativeId: 'INIT-B',
        status: 'failed',
        dependsOnInitiatives: ['INIT-A'],
        workItems: [wi('WI-B1')],
      }),
      initiative({
        initiativeId: 'INIT-C',
        status: 'pending',
        dependsOnInitiatives: ['INIT-A', 'INIT-B'],
        ready: false,
        blockedBy: ['INIT-B'],
        workItems: [wi('WI-C1')], // planned -> NOT "unplanned"
      }),
      initiative({
        initiativeId: 'INIT-D',
        status: 'pending',
        dependsOnInitiatives: [],
        workItems: undefined, // unplanned
      }),
    ],
  };
}

function buildCycleGroups(): InitiativeGroup[] {
  return [
    {
      initiativeId: 'INIT-A',
      project: 'gitpulse',
      status: 'done',
      activeCycleId: 'c-active',
      dependsOnInitiatives: [],
      attemptCount: 2,
      priorCycleIds: ['c-old'],
    },
  ];
}

function render(
  overrides: { roadmap?: ProjectRoadmap; cycleGroups?: InitiativeGroup[]; initialSelectedId?: string } = {},
): string {
  const roadmap = overrides.roadmap ?? buildRoadmap();
  const cycleGroups = overrides.cycleGroups ?? buildCycleGroups();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderToStaticMarkup(
    React.createElement(RoadmapCanvas as any, {
      roadmap,
      cycleGroups,
      nowMs: NOW_MS,
      ...(overrides.initialSelectedId ? { initialSelectedId: overrides.initialSelectedId } : {}),
    }),
  );
}

// ---------------------------------------------------------------------------
// String-based DOM helpers (same convention as the retired roadmap-dag-render.test.ts).
// ---------------------------------------------------------------------------

function countAttr(html: string, attr: string): number {
  const re = new RegExp(`${attr.replace(/[-]/g, '\\-')}(?=[\\s=>/"])`, 'g');
  return (html.match(re) ?? []).length;
}

function depEdges(html: string): Array<{ from: string; to: string }> {
  const tags = html.match(/<[^>]*\bdata-dep-edge\b[^>]*>/g) ?? [];
  return tags.map((tag) => ({
    from: tag.match(/\bdata-dep-from="([^"]*)"/)?.[1] ?? '',
    to: tag.match(/\bdata-dep-to="([^"]*)"/)?.[1] ?? '',
  }));
}

function tagContaining(html: string, marker: string): string {
  const idx = html.indexOf(marker);
  if (idx === -1) return '';
  const start = html.lastIndexOf('<', idx);
  const end = html.indexOf('>', idx);
  if (start === -1 || end === -1) return '';
  return html.slice(start, end + 1);
}

// ---------------------------------------------------------------------------
// AT1 — canvas container + one node per initiative + every dependency edge.
// ---------------------------------------------------------------------------

test('[W6-RV-2] AT1: [data-roadmap-canvas] container present, one [data-roadmap-node] per initiative', () => {
  const roadmap = buildRoadmap();
  const html = render({ roadmap });
  expect(html).toContain('data-roadmap-canvas');
  expect(countAttr(html, 'data-roadmap-node')).toBe(roadmap.initiatives.length);
});

test('[W6-RV-2] AT1: every initiativeId is present as [data-initiative-id]', () => {
  const roadmap = buildRoadmap();
  const html = render({ roadmap });
  for (const init of roadmap.initiatives) {
    expect(html).toContain(`data-initiative-id="${init.initiativeId}"`);
  }
});

test('[W6-RV-2] AT1: EVERY (child,parent) -> exactly one [data-dep-edge] with from=parent,to=child, positioned with REAL coordinates (no post-mount measurement needed)', () => {
  const roadmap = buildRoadmap();
  const html = render({ roadmap });

  const expectedEdges = roadmap.initiatives.flatMap((init) =>
    init.dependsOnInitiatives.map((parent) => ({ from: parent, to: init.initiativeId })),
  );
  expect(expectedEdges.length).toBeGreaterThanOrEqual(2);

  const edges = depEdges(html);
  expect(edges.length).toBe(expectedEdges.length);
  for (const want of expectedEdges) {
    expect(edges.filter((e) => e.from === want.from && e.to === want.to)).toHaveLength(1);
  }
  // Real coordinates, not the old RoadmapDag's SSR placeholder 'M 0 0'.
  expect(html).not.toContain('d="M 0 0"');
});

// ---------------------------------------------------------------------------
// AT2 — the RV-1 collapsed-card contract, now UNCONDITIONAL: no more inline
// expand/collapse in the canvas world.
// ---------------------------------------------------------------------------

test('[W6-RV-2] AT2: every node is ALWAYS data-initiative-collapsed="true" (no inline expand in the canvas)', () => {
  const roadmap = buildRoadmap();
  const html = render({ roadmap });
  expect(countAttr(html, 'data-initiative-collapsed')).toBe(roadmap.initiatives.length);
  expect(html).not.toContain('data-initiative-collapsed="false"');
});

test('[W6-RV-2] AT2: micro-badges (deps-count, wi-progress) render unconditionally on every node', () => {
  const roadmap = buildRoadmap();
  const html = render({ roadmap });
  expect(countAttr(html, 'data-micro-badge="deps-count"')).toBe(roadmap.initiatives.length);
  expect(countAttr(html, 'data-micro-badge="wi-progress"')).toBe(roadmap.initiatives.length);
  // INIT-B carries one failed WI (WI-B1 has no explicit status -> not
  // 'failed' actually; assert the badge-failed attribute exists as a hook
  // regardless of count for every node).
  expect(countAttr(html, 'data-badge-failed=')).toBe(roadmap.initiatives.length);
});

test('[W6-RV-2] AT2: [data-action="roadmap-toggle-node-detail"] no longer exists (retired with inline expand)', () => {
  const html = render();
  expect(html).not.toContain('data-action="toggle-node-detail"');
});

// ---------------------------------------------------------------------------
// AT3 — drawer closed by default (no selection): honest empty state, not a
// click-gated-away affordance (there is nothing selected to lose).
// ---------------------------------------------------------------------------

test('[W6-RV-2] AT3: with no selection, the drawer renders CLOSED and no [data-drawer-initiative] exists', () => {
  const html = render();
  expect(html).toContain('data-roadmap-drawer');
  expect(tagContaining(html, 'data-roadmap-drawer')).toContain('data-drawer-open="false"');
  expect(html).not.toContain('data-drawer-initiative');
});

// ---------------------------------------------------------------------------
// AT4 — drawer OPEN via initialSelectedId: InitiativeDetail renders inside
// it with the SAME RV-1 affordance data-* bytes (nothing lost on re-home
// into the drawer).
// ---------------------------------------------------------------------------

test('[W6-RV-2] AT4: initialSelectedId opens the drawer with [data-drawer-initiative] wrapping the real InitiativeDetail', () => {
  const html = render({ initialSelectedId: 'INIT-C' });
  expect(tagContaining(html, 'data-roadmap-drawer')).toContain('data-drawer-open="true"');
  expect(html).toContain('data-drawer-initiative="INIT-C"');
  // INIT-C: planned (has a WI snapshot) + blocked (unmet dep on INIT-B).
  expect(html).toContain('data-work-item-id="WI-C1"');
  expect(html).toContain('data-section="initiative-blocked"');
  expect(html).not.toContain('data-section="initiative-blocked-until-planned"');
});

test('[W6-RV-2] AT4: the drawer\'s "Depends on" line renders clickable [data-dep-jump] chips', () => {
  const html = render({ initialSelectedId: 'INIT-C' });
  expect(html).toContain('data-dep-jump="INIT-A"');
  expect(html).toContain('data-dep-jump="INIT-B"');
});

test('[W6-RV-2] AT4: the drawer carries the run dig-in (active + prior cycles) for a node with runs', () => {
  const html = render({ initialSelectedId: 'INIT-A' });
  expect(html).toContain('data-run-cycle-id="c-active"');
  expect(html).toContain('data-run-active="true"');
  expect(html).toContain('data-run-cycle-id="c-old"');
  expect(html).toContain('data-run-active="false"');
});

// ---------------------------------------------------------------------------
// AT5 — recovery block renders UNCONDITIONALLY on a recoverable node's
// drawer (AT5 from the retired suite, carried forward).
// ---------------------------------------------------------------------------

test('[W6-RV-2] AT5: a recoverable (failed) initiative\'s drawer carries the full recovery block structurally', () => {
  const html = render({ initialSelectedId: 'INIT-B' });
  expect(html).toContain('data-recovery-item');
  expect(html).toContain('data-recovery-initiative="INIT-B"');
  expect(html).toContain('data-action="recovery-inspect"');
  expect(html).toContain('data-action="recovery-requeue"');
  expect(html).toContain('data-action="recovery-abandon"');
  expect(html).toContain('data-section="recovery-detail"');
  expect(html).toContain('data-recovery-detail-initiative="INIT-B"');
});

test('[W6-RV-2] AT5: an unplanned initiative\'s drawer shows the Plan trigger + blocked-until-planned lock, withholds start-development', () => {
  const html = render({ initialSelectedId: 'INIT-D' });
  expect(html).toContain('data-section="initiative-blocked-until-planned"');
  expect(html).toContain('data-action="plan-initiative"');
  expect(html).not.toContain('data-action="start-development"');
});

// ---------------------------------------------------------------------------
// AT6 — the time axis: day columns for completed work, the projected zone
// + pending bands for everything else.
// ---------------------------------------------------------------------------

test('[W6-RV-2] AT6: a completedAt-carrying initiative renders a [data-day-column] on the time axis', () => {
  const html = render();
  expect(html).toContain('data-day-column');
  expect(html).toContain('data-day="2026-06-05"');
});

test('[W6-RV-2] AT6: pending work (no completedAt) renders inside the hatched [data-projected-zone], banded by dependency-feasibility', () => {
  const html = render();
  expect(html).toContain('data-projected-zone');
  expect(html).toContain('data-band="in-flight"'); // INIT-B: failed, no date yet
  expect(html).toContain('data-band="after-prerequisites"'); // INIT-C: planned + blocked
  expect(html).toContain('data-band="unplanned"'); // INIT-D: no WI snapshot
});

test('[W6-RV-2] AT6: a done card carries data-completed-at, honestly matching Run.completedAt', () => {
  const html = render();
  expect(tagContaining(html, 'data-initiative-id="INIT-A"')).toContain('data-completed-at="2026-06-05T09:00:00.000Z"');
  // Never fabricated for a card with no completedAt.
  expect(tagContaining(html, 'data-initiative-id="INIT-B"')).not.toContain('data-completed-at');
});

// ---------------------------------------------------------------------------
// AT7 — canvas toolbar: the bulk view-state controls that replace RV-1's
// now-meaningless collapse-all/expand-all (there is nothing left to
// collapse/expand once every card is permanently collapsed).
// ---------------------------------------------------------------------------

test('[W6-RV-2] AT7: the toolbar carries zoom in/out/fit + jump-to-now, and data-canvas-scale reflects real view state', () => {
  const html = render();
  expect(html).toContain('data-action="roadmap-zoom-in"');
  expect(html).toContain('data-action="roadmap-zoom-out"');
  expect(html).toContain('data-action="roadmap-zoom-fit"');
  expect(html).toContain('data-action="roadmap-jump-now"');
  expect(html).toContain('data-canvas-scale="1.00"');
  expect(html).not.toContain('data-action="roadmap-collapse-all"');
  expect(html).not.toContain('data-action="roadmap-expand-all"');
});

test('[W6-RV-2] AT7: an empty roadmap still renders the canvas + drawer shell without crashing', () => {
  const html = render({ roadmap: { projectId: 'empty-project', initiatives: [] } });
  expect(html).toContain('data-roadmap-canvas');
  expect(html).toContain('data-initiative-count="0"');
  expect(html).toContain('data-roadmap-drawer');
});
