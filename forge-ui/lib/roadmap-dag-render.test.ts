/**
 * MARKER: R4-13:roadmap-dag-render  (grep this token to locate the suite)
 *
 * DOM acceptance tests for the R4-13 roadmap-tab rework: the project detail
 * page's roadmap surface stops being a chronological <SerpentineTimeline>
 * (forge-ui/components/studio/SerpentineTimeline.tsx — a winding "over TIME"
 * spine that orders initiatives by their INIT-YYYY-MM-DD date and pops a
 * host-rendered <InitiativeCard> off the clicked dot) and BECOMES a real
 * dependency DAG, <RoadmapDag> (forge-ui/components/studio/RoadmapDag.tsx —
 * NOT YET CREATED). SerpentineTimeline + its `data-roadmap-timeline` /
 * `data-roadmap-popover` popover host is the KILLED impl this component
 * replaces.
 *
 * WHY THIS FILE IS RED AT BASE: it imports `@/components/studio/RoadmapDag`,
 * which does not exist on `feat/r4-13-roadmap-dag` off bd7490bc. The module
 * fails to resolve, so the whole suite errors at collection — the canonical
 * "subject absent" red for a not-yet-built component. Every assertion below is
 * a legitimate pin against a component that has to be written to satisfy it.
 *
 * RENDER CONVENTION (repo NO-jsdom pattern — see lib/run-panel-render.test.ts):
 * render the REAL component via react-dom/server's `renderToStaticMarkup` and
 * assert on the markup string. No jsdom / @testing-library/react (neither is
 * installed). `useEffect`/click handlers (ResizeObserver, Inspect fetch,
 * requeue/abandon dispatch) DO NOT run under `renderToStaticMarkup`; these
 * tests pin the INITIAL-render DOM contract only.
 *
 * PROPS this file pins as the contract the implementer must build to
 * (<RoadmapDag> does not exist, so there is no prop type to conform to yet):
 *
 *   roadmap: ProjectRoadmap                 // lib/bridge-client.ts
 *   cycleGroups: InitiativeGroup[]          // lib/cycle-grouping.ts (the run-link join source)
 *
 * NEW data-* HOOKS this file pins (none exist in the tree today — SerpentineTimeline
 * emits only `data-roadmap-node` on an SVG hit-circle, no edges, no run links):
 *
 *   [data-roadmap-dag]                       the DAG container
 *   [data-roadmap-node]                      one per initiative (carries [data-initiative-id])
 *   [data-dep-edge]                          one per (child depends-on parent) pair, carrying:
 *     [data-dep-from="<parent/prerequisite initiativeId>"]
 *     [data-dep-to="<child/dependent initiativeId>"]
 *   EDGE DIRECTION CONTRACT (pinned here, resolves the brief's ambiguity): an
 *   edge flows prerequisite -> dependent, i.e. data-dep-from is the id listed
 *   INSIDE some initiative's `dependsOnInitiatives` (the parent the child waits
 *   on), data-dep-to is that initiative's own id (the child). This matches the
 *   roots-on-the-left topological ordering DependencyDag.tsx already uses.
 *
 * AFFORDANCES RE-HOMED from the retired <InitiativeCard> onto the DAG node —
 * the SAME data-* bytes app/projects/[id]/page.tsx emits today (~:1097-1380),
 * asserted verbatim so nothing is silently lost when the subtree moves:
 *   unplanned (pending + workItems===undefined):
 *     [data-plan-state="unplanned"], [data-action="plan-initiative"],
 *     [data-section="initiative-blocked-until-planned"]
 *   recoverable (status in {in-flight, ready-for-review, failed}):
 *     [data-recovery-item], [data-action="recovery-inspect"],
 *     [data-action="recovery-requeue"], [data-action="recovery-abandon"],
 *     [data-section="recovery-detail"]
 *   NOTE on recovery-detail: in the current <InitiativeCard> this section is
 *   click-gated behind Inspect (`{recoveryDetail && (...)}`, seeded by a fetch
 *   that renderToStaticMarkup cannot trigger). This file DELIBERATELY pins it
 *   as STRUCTURALLY PRESENT on a recoverable DAG node — the brief lists it as a
 *   required affordance, and a detail region reachable only through an
 *   un-testable interaction is exactly the "affordance silently lost on
 *   re-home" this AT exists to prevent. The implementer must render the
 *   recovery-detail region unconditionally on a recoverable node (it may be
 *   empty/placeholder until Inspect populates it).
 *
 * RUN: npx vitest run lib/roadmap-dag-render.test.ts   (from forge-ui/)
 */

import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { RoadmapDag } from '@/components/studio/RoadmapDag';
import type { ProjectRoadmap, RoadmapInitiative, RoadmapWorkItem } from '@/lib/bridge-client';
import type { InitiativeGroup } from '@/lib/cycle-grouping';

// ---------------------------------------------------------------------------
// Fixture — a REAL multi-initiative roadmap DAG:
//   INIT-A  (done)     deps []            <- has runs (c-active + prior c-old)
//   INIT-B  (failed)   deps [A]           <- recoverable node (AT5)
//   INIT-C  (pending)  deps [A, B]        <- TWO parents at DIFFERENT depths
//                                            (A at level 0, B at level 1); planned
//   INIT-D  (pending)  deps []            <- unplanned (workItems===undefined) (AT5)
//
// dependsOnInitiatives edges (child depends-on parent): (B,A) (C,A) (C,B) = 3
// edges, >=2, and C carries two parents whose depths differ.
// ---------------------------------------------------------------------------

function wi(id: string): RoadmapWorkItem {
  return { id, title: `work item ${id}`, dependsOn: [] };
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

// The run-link join source. Only INIT-A carries runs: an active cycle plus one
// completed prior attempt that must remain reachable.
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
  roadmap: ProjectRoadmap = buildRoadmap(),
  cycleGroups: InitiativeGroup[] = buildCycleGroups(),
): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderToStaticMarkup(React.createElement(RoadmapDag as any, { roadmap, cycleGroups }));
}

// ---------------------------------------------------------------------------
// String-based DOM helpers (test-local; component markup uses plain
// string/number attr values with no embedded `<`/`>`/`"`).
// ---------------------------------------------------------------------------

/** Count occurrences of a bare/valued attribute, NOT its `-suffixed` siblings.
 *  `data-roadmap-node` matches `data-roadmap-node`, `data-roadmap-node=""`,
 *  `data-roadmap-node ` but NOT `data-roadmap-node-status`. */
function countAttr(html: string, attr: string): number {
  const re = new RegExp(`${attr.replace(/[-]/g, '\\-')}(?=[\\s=>/"])`, 'g');
  return (html.match(re) ?? []).length;
}

/** Smallest `<tag ...>` substring containing `marker`. */
function tagContaining(html: string, marker: string): string {
  const idx = html.indexOf(marker);
  if (idx === -1) return '';
  const start = html.lastIndexOf('<', idx);
  const end = html.indexOf('>', idx);
  if (start === -1 || end === -1) return '';
  return html.slice(start, end + 1);
}

/** Parse every [data-dep-edge] element's {from,to}. */
function depEdges(html: string): Array<{ from: string; to: string }> {
  const tags = html.match(/<[^>]*\bdata-dep-edge\b[^>]*>/g) ?? [];
  return tags.map((tag) => ({
    from: tag.match(/\bdata-dep-from="([^"]*)"/)?.[1] ?? '',
    to: tag.match(/\bdata-dep-to="([^"]*)"/)?.[1] ?? '',
  }));
}

// ---------------------------------------------------------------------------
// AT1 — DAG container + one node per initiative + every dependency edge, in the
// right direction. (rule 34/36/38 — kills "nodes without edges" and
// "single-parent-only edges".)
// ---------------------------------------------------------------------------

test('[R4-13] AT1: [data-roadmap-dag] container present and one [data-roadmap-node] per initiative', () => {
  const roadmap = buildRoadmap();
  const html = render(roadmap);
  expect(html).toContain('data-roadmap-dag');
  expect(countAttr(html, 'data-roadmap-node')).toBe(roadmap.initiatives.length);
});

test('[R4-13] AT1: every initiativeId is present as [data-initiative-id]', () => {
  const roadmap = buildRoadmap();
  const html = render(roadmap);
  for (const init of roadmap.initiatives) {
    expect(html).toContain(`data-initiative-id="${init.initiativeId}"`);
  }
});

test('[R4-13] AT1: EVERY (child,parent) in dependsOnInitiatives -> exactly one [data-dep-edge] with from=parent, to=child; no extras', () => {
  const roadmap = buildRoadmap();
  const html = render(roadmap);

  const expectedEdges = roadmap.initiatives.flatMap((init) =>
    init.dependsOnInitiatives.map((parent) => ({ from: parent, to: init.initiativeId })),
  );
  // Sanity: the fixture genuinely exercises >=2 edges (kills a green-by-empty test).
  expect(expectedEdges.length).toBeGreaterThanOrEqual(2);

  const edges = depEdges(html);
  // No missing edges, no fabricated extras.
  expect(edges.length).toBe(expectedEdges.length);
  for (const want of expectedEdges) {
    const matches = edges.filter((e) => e.from === want.from && e.to === want.to);
    expect(matches.length).toBe(1);
  }
});

test('[R4-13] AT1: the two-parent node (INIT-C, parents at different depths) has BOTH parent edges — kills single-parent-only rendering', () => {
  const html = render();
  const intoC = depEdges(html).filter((e) => e.to === 'INIT-C');
  expect(intoC.length).toBe(2);
  expect(new Set(intoC.map((e) => e.from))).toEqual(new Set(['INIT-A', 'INIT-B']));
});

// ---------------------------------------------------------------------------
// AT4 — per-node run dig-in, COMPLETED runs included. The node joined to a
// cycle group emits a real run link to its active cycle, and its prior
// (completed) cycle stays reachable. (kills wrong href shape / dropping
// priorCycleIds.)
// ---------------------------------------------------------------------------

test('[R4-13] AT4: node with runs emits a run link to the active cycle with the EXACT /flows/forge-develop/run/<cycleId> shape', () => {
  const html = render();
  expect(html).toContain('href="/flows/forge-develop/run/c-active"');
});

test('[R4-13] AT4: the prior COMPLETED cycle stays reachable — priorCycleIds not dropped', () => {
  const html = render();
  expect(html).toContain('href="/flows/forge-develop/run/c-old"');
});

test('[R4-13] AT4: run link is joined on the cycleId, never the bare initiativeId — kills wrong href shape', () => {
  const html = render();
  expect(html).not.toContain('href="/flows/forge-develop/run/INIT-A"');
});

// ---------------------------------------------------------------------------
// AT5 — R4-11 affordances re-homed onto the DAG node (the SAME bytes the
// current InitiativeCard emits). Kills: affordances silently lost when the
// InitiativeCard subtree re-homes.
// ---------------------------------------------------------------------------

test('[R4-13] AT5: an UNPLANNED initiative (workItems===undefined) keeps data-plan-state="unplanned", the plan-initiative action, and the blocked-until-planned lock', () => {
  const html = render();
  expect(html).toContain('data-plan-state="unplanned"');
  expect(html).toContain('data-action="plan-initiative"');
  expect(html).toContain('data-section="initiative-blocked-until-planned"');
  // The plan trigger stays bound to the unplanned initiative (INIT-D), not detached.
  const planBtn = tagContaining(html, 'data-action="plan-initiative"');
  expect(planBtn).toContain('data-initiative-id="INIT-D"');
});

test('[R4-13] AT5: a RECOVERABLE initiative keeps [data-recovery-item] + inspect/requeue/abandon actions + the recovery-detail section', () => {
  const html = render();
  expect(html).toContain('data-recovery-item');
  expect(html).toContain('data-action="recovery-inspect"');
  expect(html).toContain('data-action="recovery-requeue"');
  expect(html).toContain('data-action="recovery-abandon"');
  // Deliberately pinned as structurally present (see header note) so the
  // detail region cannot be silently dropped when the subtree re-homes.
  expect(html).toContain('data-section="recovery-detail"');
  // The recovery block stays bound to the recoverable initiative (INIT-B).
  const recoveryItem = tagContaining(html, 'data-recovery-item');
  expect(recoveryItem).toContain('data-recovery-initiative="INIT-B"');
});
