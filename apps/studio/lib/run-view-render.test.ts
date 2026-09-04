/**
 * DOM regression + acceptance tests for the NEW standalone run view (R6-04
 * WI-4 item 3 + item 4) — the presentational component behind route
 * `/agents/[id]/run/[runId]`, `components/studio/agent-builder/RunView.tsx`.
 * Neither the component nor the route file exists yet.
 *
 * WHY A SEPARATE PRESENTATIONAL COMPONENT, NOT THE PAGE ITSELF: every
 * existing dynamic-route page in this app (`app/agents/[id]/page.tsx` is
 * the sibling precedent) is `'use client'` and reads its route param via
 * `useParams()` from `next/navigation` — a hook that needs the Next.js app
 * router context to be mounted. Rendering that hook through bare
 * `react-dom/server`'s `renderToStaticMarkup` (no Next.js runtime present)
 * is not reliable, and the data the page fetches never resolves under SSR
 * anyway (its `useEffect` never runs) — this is the SAME "KNOWN GAP" already
 * documented in `./run-panel-render.test.ts`'s header for RunPanel.tsx's own
 * polling `useEffect`. So — mirroring the RunPanel precedent exactly — the
 * CONTRACT pinned here is on a pure, props-driven presentational component;
 * the actual `app/agents/[id]/run/[runId]/page.tsx` is a thin client shell
 * that fetches (`GET /api/agents/runs/:runId`'s new `lines` field, R6-04
 * WI-4 item 1) and renders `<RunView .../>` with the resolved data — that
 * wiring is verified by `tsc` only, exactly as RunPanel's own polling
 * wiring is today.
 *
 * REAL DATA SHAPES this file's fixtures are grounded in (nothing invented):
 *   - materials reference shape `{path, kind}` — `apps/forge/ui-bridge.ts`'s
 *     `agent-run.materials-staged` log event
 *     (`metadata.materials: [{path, kind}]`, ~line 1354) and
 *     `orchestrator/agent-dispatch.ts`'s `MaterialReference` type.
 *   - ceiling provenance `kickoff_ceiling_usd` — the `end` event's
 *     `metadata.kickoff_ceiling_usd` (`orchestrator/run-agent.ts` ~line 387),
 *     already pinned to survive into `GET /api/agents/runs/:runId`'s new
 *     `lines` field by `apps/forge/ui-bridge-agent-run.test.ts`'s new tests.
 *   - `RunLogLine[]` — `./run-log-line.ts` (this same WI, item 2).
 *
 * ASSUMED EXPORTS from `../components/studio/agent-builder/RunView.tsx`:
 *
 *   export type RunOutput = { id: string; title: string; artifact: string };
 *   export type RunMaterialRef = { path: string; kind: string };
 *   export type RunViewProps = {
 *     runId: string;
 *     found: boolean;        // false = no dispatch record exists for this runId
 *     state: string;         // passthrough of GET .../runs/:runId's `state`
 *     costUsd: number;       // passthrough of `costUsd`
 *     lines: RunLogLine[];
 *     materials: RunMaterialRef[];
 *     ceilingUsd?: number;   // undefined = no ceiling was ever set for this run
 *     outputs: RunOutput[];
 *   };
 *   export function RunView(props: RunViewProps): JSX.Element
 *
 * ASSUMED data-* CONTRACT (none of these exist yet — every assertion below
 * using them is a legitimate RED against a not-yet-created file):
 *
 *   [data-page="agent-run"][data-run-id][data-run-state][data-run-cost]
 *     [data-run-found="true"|"false"]
 *   found=false:
 *     [data-component="run-not-found"]
 *   found=true:
 *     [data-section="run-log"]                    wraps the shared RunLog
 *     [data-section="run-materials"][data-materials-count]
 *       [data-component="run-materials-empty"]    when materials is []
 *       [data-material-ref="<path>"][data-material-kind="<kind>"]   one per material
 *     [data-component="ceiling-provenance"][data-ceiling-set="true"|"false"]
 *       [data-ceiling-usd]                        when a ceiling was set
 *       [data-component="ceiling-not-recorded"]   when it was not
 *     [data-section="run-outputs"][data-outputs-count]
 *       [data-component="run-outputs-empty"]      when outputs is []
 *       <details data-output-id="...">...</details>   one per output
 *
 * RUN: npx vitest run lib/run-view-render.test.ts   (from forge-ui/)
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { RunView, type RunViewProps, type RunMaterialRef } from '@/components/studio/agent-builder/RunView';
import type { RunLogLine } from './run-log-line.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

function baseProps(overrides: Partial<RunViewProps> = {}): RunViewProps {
  return {
    runId: '_agent-issue-triage-abc123',
    found: true,
    state: 'done',
    costUsd: 0.34,
    lines: [],
    materials: [],
    ceilingUsd: undefined,
    outputRefs: [],
    ...overrides,
  };
}

function render(overrides: Partial<RunViewProps> = {}): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderToStaticMarkup(React.createElement(RunView as any, baseProps(overrides)));
}

/** Return the substring from `openMarker`'s enclosing open tag through the
 *  NEXT `</details>` — sufficient here since none of this component's
 *  `<details>` blocks nest another `<details>` inside them. */
function detailsBlockContaining(html: string, openMarker: string): string {
  const idx = html.indexOf(openMarker);
  if (idx === -1) return '';
  const start = html.lastIndexOf('<details', idx);
  const closeIdx = html.indexOf('</details>', idx);
  if (start === -1 || closeIdx === -1) return '';
  return html.slice(start, closeIdx + '</details>'.length);
}

// ---------------------------------------------------------------------------
// Route reachability — the FILE must exist at the exact expected App Router
// path. Next.js routing is file-path-based, so this is a legitimate
// structural acceptance criterion, not decoration: a route built at a
// plausible-but-wrong path (e.g. plural `/runs/`, or `/agents/[id]/runs/`)
// would leave every link into it 404ing while every OTHER test in this file
// stays green (they exercise the component directly, not the route).
// ---------------------------------------------------------------------------

test('route file exists at app/agents/[id]/run/[runId]/page.tsx — kills "route built at a different/wrong path"', () => {
  const routeFile = resolve(HERE, '..', 'app', 'agents', '[id]', 'run', '[runId]', 'page.tsx');
  expect(existsSync(routeFile)).toBe(true);
});

// ---------------------------------------------------------------------------
// Root data-* contract
// ---------------------------------------------------------------------------

test('root carries data-page, data-run-id, data-run-state, data-run-cost — present for BOTH found and not-found (automation must be able to see which run this is regardless)', () => {
  const html = render({ runId: 'my-real-run-id', state: 'running', costUsd: 1.5, found: true });
  expect(html).toContain('data-page="agent-run"');
  expect(html).toContain('data-run-id="my-real-run-id"');
  expect(html).toContain('data-run-state="running"');
  expect(html).toContain('data-run-cost="1.5"');
  expect(html).toContain('data-run-found="true"');
});

// ---------------------------------------------------------------------------
// Reachable with a real runId (found: true) — normal content renders
// ---------------------------------------------------------------------------

test('found + real data: composes the SHARED RunLog component (not a reimplementation) — a log line\'s text is visible AND the shared component\'s own data-component="run-log" marker is present — kills "reimplemented log rendering inline instead of reusing the shared renderer"', () => {
  const lines: RunLogLine[] = [{ kind: 'tool', text: 'RUNVIEW-LOG-LINE-MARKER', eventType: 'tool_use' }];
  const html = render({ found: true, lines });
  expect(html).toContain('data-section="run-log"');
  expect(html).toContain('data-component="run-log"'); // RunLog's own container
  expect(html).toContain('RUNVIEW-LOG-LINE-MARKER');
});

test('found + empty lines: the shared RunLog\'s own honest-empty state shows through (proves RunView does not swallow/replace RunLog\'s empty-state contract)', () => {
  const html = render({ found: true, lines: [] });
  expect(html).toContain('data-component="run-log-empty"');
});

// ---------------------------------------------------------------------------
// Materials provenance (item 4) — REFERENCES ONLY, never contents
// ---------------------------------------------------------------------------

test('materials: zero materials -> an honest empty state, not silently absent — kills "section vanishes entirely when nothing was attached, instead of saying so"', () => {
  const html = render({ found: true, materials: [] });
  expect(html).toContain('data-section="run-materials"');
  expect(html).toContain('data-materials-count="0"');
  expect(html).toContain('data-component="run-materials-empty"');
});

test('materials: each reference\'s path + kind are shown read-only — kills "materials silently dropped from the view" and "kind ignored"', () => {
  const materials: RunMaterialRef[] = [
    { path: 'materials/triage-notes.md', kind: 'documents' },
    { path: 'materials/screenshot.png', kind: 'images' },
  ];
  const html = render({ found: true, materials });
  expect(html).toContain('data-materials-count="2"');
  expect(html).toContain('data-material-ref="materials/triage-notes.md"');
  expect(html).toContain('data-material-kind="documents"');
  expect(html).toContain('data-material-ref="materials/screenshot.png"');
  expect(html).toContain('data-material-kind="images"');
});

test('materials: a material\'s CONTENTS must never be rendered even if present on the data — kills "dumps the whole material object (JSON.stringify) instead of just path+kind", the exact "references, never contents" defect class this codebase\'s event-log rule exists to prevent', () => {
  const dangerous = [
    { path: 'materials/secret.txt', kind: 'documents', contents: 'SECRET_BYTES_MARKER_9911' },
  ] as unknown as RunMaterialRef[];
  const html = render({ found: true, materials: dangerous });
  expect(html).not.toContain('SECRET_BYTES_MARKER_9911');
});

// ---------------------------------------------------------------------------
// Ceiling provenance (item 4) — read-only, honest when absent
// ---------------------------------------------------------------------------

test('ceiling: a recorded ceiling is shown read-only (the value present, NO editable <input> anywhere in the rendered output) — kills "reused RunPanel\'s editable ceiling input here, falsely implying it can be changed after the fact"', () => {
  const html = render({ found: true, ceilingUsd: 4.25 });
  expect(html).toContain('data-component="ceiling-provenance"');
  expect(html).toContain('data-ceiling-set="true"');
  expect(html).toContain('data-ceiling-usd="4.25"');
  expect(html).toContain('4.25');
  // No editable control anywhere in the rendered output for this prop combination.
  expect(html).not.toContain('<input');
});

test('ceiling: absent (no ceiling was ever set for this run) -> an honest "not recorded" state, never a fabricated default (e.g. always showing $10 or $0) — kills "falls back to a hardcoded default ceiling when none was set"', () => {
  const htmlA = render({ found: true, ceilingUsd: undefined });
  expect(htmlA).toContain('data-ceiling-set="false"');
  expect(htmlA).toContain('data-component="ceiling-not-recorded"');
  // Prose must be non-empty, not a decorative empty element.
  const idx = htmlA.indexOf('data-component="ceiling-not-recorded"');
  const tagEnd = htmlA.indexOf('>', idx);
  const closeIdx = htmlA.slice(tagEnd).search(/<\/(p|div|span)>/);
  const inner = closeIdx === -1 ? '' : htmlA.slice(tagEnd + 1, tagEnd + closeIdx);
  expect(inner.replace(/<[^>]+>/g, '').trim().length).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// Typed outputs as expandable cards (item 3) — template-artifact rendering
// only: the full artifact body ships in the initial HTML (native <details>
// disclosure), no click-simulation needed to prove the content is reachable.
// ---------------------------------------------------------------------------

test('outputs: zero output refs -> an honest empty state, not a fabricated placeholder card — kills "renders a fake sample card when there is no output yet"', () => {
  const html = render({ found: true, outputRefs: [] });
  expect(html).toContain('data-section="run-outputs"');
  expect(html).toContain('data-outputs-count="0"');
  expect(html).toContain('data-component="run-outputs-empty"');
  expect(html).not.toContain('<details');
});

test('outputs: real output REFERENCES render (⚑ AMENDED W7-B5 agents-06/forge-75j: the old typed RunOutput cards were hard-wired to [] — a data source that could never exist; the wire now serves the end event\'s own output_refs and the section shows THOSE)', () => {
  const html = render({
    found: true,
    outputRefs: ['projects/demo/CLAUDE.md', 'projects/demo/README.md'],
  });
  expect(html).toContain('data-outputs-count="2"');
  expect(html).toContain('data-output-ref="projects/demo/CLAUDE.md"');
  expect(html).toContain('data-output-ref="projects/demo/README.md"');
  expect(html).toContain('projects/demo/CLAUDE.md');
  expect(html).not.toContain('data-component="run-outputs-empty"');
});

test('errorText: a failed run\'s recorded reason renders VERBATIM as a run-error banner (W7-B5 agents-19 — never only the bare word "failed")', () => {
  const html = render({
    found: true,
    state: 'failed',
    errorText: 'spawn ENOENT: claude binary missing',
  });
  expect(html).toContain('data-component="run-error"');
  expect(html).toContain('spawn ENOENT: claude binary missing');
});

test('errorText absent: no run-error banner is fabricated', () => {
  const html = render({ found: true, state: 'done' });
  expect(html).not.toContain('data-component="run-error"');
});

// ---------------------------------------------------------------------------
// Unknown runId (found: false) — honest degrade, no crash, no fabrication
// ---------------------------------------------------------------------------

test('found=false: renders an explicit not-found state naming the ACTUAL requested runId (never a generic "not found" that could apply to any id) — kills "generic error message, doesn\'t even say which run"', () => {
  const html = render({ found: false, runId: 'totally-unknown-run-id-xyz', state: 'unknown', costUsd: 0 });
  expect(html).toContain('data-run-found="false"');
  expect(html).toContain('data-component="run-not-found"');
  expect(html).toContain('totally-unknown-run-id-xyz');
});

test('found=false: does not render ANY of the normal sections, even structurally — kills "renders empty-state sections underneath the not-found message anyway"', () => {
  const html = render({ found: false });
  expect(html).not.toContain('data-section="run-log"');
  expect(html).not.toContain('data-section="run-materials"');
  expect(html).not.toContain('data-component="ceiling-provenance"');
  expect(html).not.toContain('data-section="run-outputs"');
});

test('found=false wins even if the caller ALSO supplied non-empty lines/materials/outputs/ceiling (defensive — an upstream bug must not leak fabricated content through the not-found path) — kills "found flag ignored, renders whatever data happens to be present regardless"', () => {
  const html = render({
    found: false,
    lines: [{ kind: 'out', text: 'SHOULD-NOT-APPEAR-LOG', eventType: 'log' }],
    materials: [{ path: 'materials/x.md', kind: 'documents' }],
    ceilingUsd: 9.99,
    outputRefs: ['SHOULD-NOT-APPEAR-REF'],
  });
  expect(html).not.toContain('SHOULD-NOT-APPEAR-LOG');
  expect(html).not.toContain('SHOULD-NOT-APPEAR-REF');
  expect(html).not.toContain('materials/x.md');
  expect(html).not.toContain('9.99');
});

// ---------------------------------------------------------------------------
// TRIGGER PROVENANCE (debt-T trigger plumbing) — the RESERVED vocabulary,
// verbatim, per `docs/forge-ui-dom-and-harness.md`'s `data-trigger-kind`/
// `data-trigger-source`/`data-trigger-scope` contract and mirroring
// `flow-run-detail-render.test.ts`'s own trigger-provenance pins
// (lines 303-320 and 322-342) exactly, adapted to this component's props
// shape. `RunViewProps` does NOT declare a `trigger` field today (see the
// header's ASSUMED EXPORTS block above) — every overrides object below is
// therefore widened via a type cast (`as Partial<RunViewProps> & { trigger?:
// unknown }`) so TypeScript's excess-property check does not itself block
// compilation; the RED-ness of the first two tests below comes from
// `RunView.tsx` (currently four sections, no trigger handling at all —
// components/studio/agent-builder/RunView.tsx:52-78), not from a type error.
// ---------------------------------------------------------------------------

test('a run with a trigger renders the reserved trigger-provenance section — kills "trigger data silently dropped, standalone run view never shows how/why a run fired"', () => {
  const overrides = {
    trigger: { kind: 'schedule', source: 'cron:0 9 * * 1', scope: 'gitpulse' },
  } as Partial<RunViewProps> & { trigger?: unknown };
  const html = render(overrides);

  expect(html).toContain('data-section="run-trigger"');
  expect(html).toContain('data-trigger-kind="schedule"');
  expect(html).toContain('data-trigger-source="cron:0 9 * * 1"');
  expect(html).toContain('data-trigger-scope="gitpulse"');
});

test('an UNSCOPED trigger renders data-trigger-scope="" — not omitted, not "null" — kills the three wrong renderings of a null scope (dropped attribute, stringified "null"/"undefined", or a substituted word like "all"/"global")', () => {
  const overrides = {
    trigger: { kind: 'webhook', source: 'github:push', scope: null },
  } as Partial<RunViewProps> & { trigger?: unknown };
  const html = render(overrides);

  expect(html).toContain('data-trigger-kind="webhook"');
  expect(html).toContain('data-trigger-scope=""');
  expect(html).not.toContain('data-trigger-scope="null"');
  expect(html).not.toContain('data-trigger-scope="undefined"');
});

// COMPANION (not independently RED — RunView renders no run-trigger section
// under ANY input today, so this assertion already holds before the fix).
// Paired with the two RED pins directly above: once trigger handling is
// implemented, a run with no trigger prop supplied must still render no
// run-trigger section at all (the same "absence is meaningful, don't
// manufacture a row for it" rule `flow-run-detail-render.test.ts` pins at
// its own "a run with NO trigger renders no trigger section at all" test).
test('companion: a run with no trigger prop renders no run-trigger section', () => {
  const html = render();
  expect(html).not.toContain('data-section="run-trigger"');
});

// ---------------------------------------------------------------------------
// W7-A3 (agents-11 / crosscut-05) — the loaded RunView carries the
// data-page-ready flip every other Studio route honours (the shell's loading
// branch renders "false"; RunView, which replaces it, used to drop the
// attribute entirely).
// ---------------------------------------------------------------------------

test('W7-A3: RunView root carries data-page-ready="true" (found AND not-found)', () => {
  expect(render()).toMatch(/data-page="agent-run"[^>]*data-page-ready="true"/);
  expect(render({ found: false })).toMatch(/data-page="agent-run"[^>]*data-page-ready="true"/);
});
