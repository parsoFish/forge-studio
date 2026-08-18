/**
 * DOM contract + acceptance tests for the flow run-detail SURFACE (R6-01
 * WI-2 / F4) — the presentational component behind route
 * `/flows/[id]/run/[runId]`, `components/studio/FlowRunDetail.tsx`. Neither
 * the component nor the route file exists yet, so every assertion here is a
 * legitimate RED against a not-yet-created file.
 *
 * ROUTE SHAPE IS DECIDED: `/flows/[id]/run/[runId]`, mirroring the existing
 * `app/agents/[id]/run/[runId]/page.tsx`. (`app/flows/[id]/page.tsx` already
 * owns the `[id]` dynamic segment, so the flat `/flows/run/<id>` form is not
 * available.)
 *
 * WHY A PURE PRESENTATIONAL COMPONENT, NOT THE PAGE: there is no jsdom and
 * no `@testing-library/react` in this repo, and every dynamic-route page
 * here is `'use client'` reading its param via `useParams()` — a hook
 * needing the Next app-router context that bare `renderToStaticMarkup`
 * cannot mount. This is the SAME documented gap as
 * `./run-view-render.test.ts` (R6-04 WI-4), and the resolution is the same:
 * the page is a thin fetching shell, the contract lives on a props-driven
 * component. `renderToStaticMarkup` works here only because
 * `forge-ui/vitest.config.ts` already carries `resolve.alias['@']` +
 * `oxc.jsx` from that same pass — this file adds NO config and NO dependency.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ASSUMED EXPORTS from `@/components/studio/FlowRunDetail` (none exist yet):
 *
 *   export type FlowRunDetailProps = {
 *     runId: string;
 *     found: boolean;                    // false = no such run
 *     flow: Flow | null;
 *     run: Run | null;
 *     rows: FlowRunTimelineRow[];        // from lib/flow-run-timeline.ts
 *     findings: ReviewFindingsDoc | null;// review-findings.json, or null
 *   };
 *   export function FlowRunDetail(props: FlowRunDetailProps): JSX.Element
 *
 * ASSUMED data-* CONTRACT — REUSING the vocabulary that already exists
 * (`data-node-id`, `data-status`, `data-phase-cost-usd` are already carried
 * by the monitor's phase hexes at `components/studio/FlowTopology.tsx:407`;
 * `data-page` / `data-run-id` / `data-run-found` / `data-component=
 * "run-not-found"` are already carried by `RunView.tsx:55`). NO parallel
 * vocabulary is invented here:
 *
 *   [data-page="flow-run"][data-run-id][data-run-found="true"|"false"]
 *                                      [data-run-status][data-flow-id]
 *   [data-component="run-not-found"]                  the honest 404 body
 *   [data-section="run-timeline"]                     the timeline container
 *   [data-timeline-row="true"][data-node-id][data-status]
 *                             [data-phase-cost-usd]   one row per flow node
 *   [data-node-note]                                  ONLY when note != null
 *   [data-section="run-trigger"][data-trigger-kind]
 *              [data-trigger-source][data-trigger-scope]   provenance
 *   [data-section="review-findings"]                  ← ReviewFindingsPanel's
 *                                                       OWN existing contract
 *
 * `data-phase-cost-usd` is formatted `.toFixed(2)`, matching FlowTopology's
 * own `data-phase-cost-usd={(hex.costUsd ?? 0).toFixed(2)}` verbatim.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * MEASURED GROUNDS:
 *
 * (a) THERE IS NO PER-FINDING `state`. `orchestrator/flow-artifacts.ts:304`
 *   declares `ReviewFinding = {id, severity, category, title, detail,
 *   evidence[], acRef?}` — no `state`. `validateReviewFindings` neither
 *   accepts nor produces one, and a repo-wide grep for a finding-state
 *   producer returns nothing. The design mockup shows a `state` column with
 *   NO PRODUCER BEHIND IT; the test below fails if anyone hardcodes "open".
 *
 * (a2) The findings renderer ALREADY EXISTS — `components/
 *   ReviewFindingsPanel.tsx`, with its own shipped `data-*` contract
 *   ([data-section="review-findings"][data-findings-count], per-row
 *   [data-finding][data-finding-severity][data-finding-category]), fetched
 *   today by `app/artifact/page.tsx:505` via its `fetchJsonArtifact(runId,
 *   'review-findings.json')` helper. This surface MUST render through that
 *   component, not fork a second findings renderer.
 *
 * (e) TRIGGER PROVENANCE vocabulary is RESERVED, verbatim, in
 *   `docs/forge-ui-dom-and-harness.md:830-836`: "a run's own trigger renders
 *   [data-trigger-kind][data-trigger-source][data-trigger-scope]
 *   (`data-trigger-scope=""` when `scope` is `null`)" — and that same
 *   passage names "R6-01-F4 run detail" as one of the consuming surfaces
 *   that attach them. Used verbatim below.
 */

import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { FlowRunDetail, type FlowRunDetailProps } from '@/components/studio/FlowRunDetail';
import { parseRun } from './studio-client.ts';
import type { Flow, Run } from './studio-client.ts';
import type { FlowRunTimelineRow } from './flow-run-timeline.ts';

// ---------------------------------------------------------------------------
// Fixtures — the real seed flow `forge-develop` and the archived run measured
// off the real `listRuns` (see ./flow-run-timeline.test.ts's header).
// ---------------------------------------------------------------------------

function developFlow(): Flow {
  return {
    id: 'forge-develop',
    name: 'Develop',
    goal: 'Build the initiative.',
    nodes: [
      { id: 'dev', agent: 'developer-ralph' },
      { id: 'demo', agent: 'demo-agent', resumable: true },
      { id: 'adversarial-review', agent: 'adversarial-review' },
      { id: 'review', gate: 'verdict' },
    ],
    edges: [],
    triggers: [],
  };
}

function archivedRun(over: Partial<Run> = {}): Run {
  return {
    id: '2026-01-01T00-00-00_INIT-done-2',
    flowId: 'forge-develop',
    initiativeId: 'INIT-done-2',
    initiative: 'Archived probe',
    status: 'complete',
    origin: 'architect',
    costUsd: 4.1,
    startedAt: '2026-01-01T00:05:00Z',
    phases: { dev: 'complete' },
    phaseMeta: { dev: { costUsd: 3.5, retries: 0 } },
    artifactsReady: {},
    workItems: [],
    flowLineage: ['forge-develop'],
    ...over,
  };
}

function rows(): FlowRunTimelineRow[] {
  return [
    { nodeId: 'dev', agent: 'developer-ralph', status: 'complete', costUsd: 3.5, note: '4 files · +120 · 2 commits', artifacts: [] },
    { nodeId: 'demo', agent: 'demo-agent', status: 'pending', costUsd: 0, note: null, artifacts: [] },
    { nodeId: 'adversarial-review', agent: 'adversarial-review', status: 'pending', costUsd: 0, note: null, artifacts: [] },
    { nodeId: 'review', agent: null, status: 'pending', costUsd: 0, note: null, artifacts: [] },
  ];
}

function baseProps(over: Partial<FlowRunDetailProps> = {}): FlowRunDetailProps {
  return {
    runId: '2026-01-01T00-00-00_INIT-done-2',
    found: true,
    flow: developFlow(),
    run: archivedRun(),
    rows: rows(),
    findings: null,
    ...over,
  };
}

function render(over: Partial<FlowRunDetailProps> = {}): string {
  return renderToStaticMarkup(React.createElement(FlowRunDetail as never, baseProps(over) as never));
}

/** The single element carrying `data-node-id="<id>"`, as raw markup. */
function rowMarkup(html: string, nodeId: string): string {
  const i = html.indexOf(`data-node-id="${nodeId}"`);
  if (i === -1) throw new Error(`no element with data-node-id="${nodeId}" in rendered markup`);
  const start = html.lastIndexOf('<', i);
  const end = html.indexOf('>', i);
  return html.slice(start, end + 1);
}

// ---------------------------------------------------------------------------
// PAGE IDENTITY — the deadpaths sweep requires a [data-page] on every route
// ---------------------------------------------------------------------------

test('the surface carries its own page identity and the run it is showing', () => {
  // KILLS: a page with no [data-page] — `scripts/e2e-deadpaths.mjs` asserts
  // every reachable route renders one, so a missing attribute is a dead path.
  // Also kills reusing [data-page="flow-monitor"] (already owned by
  // app/flows/[id]/page.tsx:351), which would make the two routes
  // indistinguishable to every journey selector.
  const html = render();

  expect(html).toContain('data-page="flow-run"');
  expect(html).toContain('data-run-id="2026-01-01T00-00-00_INIT-done-2"');
  expect(html).toContain('data-flow-id="forge-develop"');
  expect(html).not.toContain('data-page="flow-monitor"');
});

test('an ARCHIVED (completed) run reports its real status, not a live-looking one', () => {
  // KILLS: hardcoding an 'active'/'running' status on the detail surface.
  // Measured: `listRuns` maps a `_queue/done/` manifest to RunStatus
  // 'complete' (orchestrator/run-model.ts:169), and the detail page must say
  // so — the whole point of F4 is that completed runs get a surface too.
  expect(render()).toContain('data-run-status="complete"');
});

// ---------------------------------------------------------------------------
// THE NEVER-EXISTED RUN — R6-04's contract, applied to flow runs
// ---------------------------------------------------------------------------

test('a run that never existed renders an honest not-found, never a fabricated timeline', () => {
  // KILLS: the exact defect R6-04 already closed once for AGENT runs —
  // fabricating a `running` state for a runId that was never dispatched.
  // A flow run-detail page that renders four pending node rows for a
  // non-existent run is the same lie in table form.
  const html = render({ found: false, run: null, rows: [], flow: developFlow() });

  expect(html).toContain('data-run-found="false"');
  expect(html).toContain('data-component="run-not-found"');
  expect(html).not.toContain('data-timeline-row="true"');
  expect(html).not.toContain('data-node-id="dev"');
});

test('a found run is not rendered through the not-found path', () => {
  // KILLS: an inverted `found` branch (a real run showing "no run found"),
  // and a component that renders BOTH branches unconditionally.
  const html = render();

  expect(html).toContain('data-run-found="true"');
  expect(html).not.toContain('data-component="run-not-found"');
});

// ---------------------------------------------------------------------------
// TIMELINE ROWS — one per flow node, carrying id + status + cost
// ---------------------------------------------------------------------------

test('every flow node gets exactly one timeline row, in the flow definition order', () => {
  // KILLS: rendering only the nodes that ran (which would drop demo,
  // adversarial-review and review), and re-ordering rows in the view layer.
  // Order is asserted by POSITION IN THE MARKUP, not by a count.
  const html = render();

  expect(html).toContain('data-section="run-timeline"');
  const at = (id: string) => html.indexOf(`data-node-id="${id}"`);
  expect(at('dev')).toBeGreaterThan(-1);
  expect(at('demo')).toBeGreaterThan(at('dev'));
  expect(at('adversarial-review')).toBeGreaterThan(at('demo'));
  expect(at('review')).toBeGreaterThan(at('adversarial-review'));
});

test("each row carries its OWN node id, status and cost on one element", () => {
  // KILLS: splitting the three facts across unrelated elements (so no
  // selector can read a row as a unit), and — critically — stamping the
  // RUN's status/cost onto every row. The dev row must read complete/3.50
  // while its siblings read pending/0.00, on a run whose own status is
  // 'complete' and whose own cost is 4.10.
  const html = render();

  const dev = rowMarkup(html, 'dev');
  expect(dev).toContain('data-timeline-row="true"');
  expect(dev).toContain('data-status="complete"');
  expect(dev).toContain('data-phase-cost-usd="3.50"');

  const demo = rowMarkup(html, 'demo');
  expect(demo).toContain('data-status="pending"');
  expect(demo).toContain('data-phase-cost-usd="0.00"');
});

test('no row ever carries the run-level total as its cost', () => {
  // KILLS: `data-phase-cost-usd={run.costUsd}` on rows. 4.10 is the RUN's
  // total (measured); it must appear on no row at all.
  const html = render();
  for (const id of ['dev', 'demo', 'adversarial-review', 'review']) {
    expect(rowMarkup(html, id)).not.toContain('data-phase-cost-usd="4.10"');
  }
});

test('cost is formatted with the same .toFixed(2) convention the phase hexes already use', () => {
  // KILLS: emitting a raw float ("3.5") or a currency-prefixed string
  // ("$3.50") into the attribute. FlowTopology.tsx:413 already ships
  // `data-phase-cost-usd={(hex.costUsd ?? 0).toFixed(2)}`; a second format
  // for the same attribute name would break every existing selector.
  const dev = rowMarkup(render(), 'dev');

  expect(dev).toContain('data-phase-cost-usd="3.50"');
  expect(dev).not.toContain('data-phase-cost-usd="3.5"');
  expect(dev).not.toContain('data-phase-cost-usd="$3.50"');
});

test('a node with no note emits NO note attribute rather than an empty or invented one', () => {
  // KILLS: `data-node-note=""` placeholders and invented filler prose
  // ("Waiting to start…"). An absent fact is absent from the DOM — the
  // honest-empty rule. `demo`'s row has note: null.
  const html = render();

  expect(rowMarkup(html, 'dev')).toContain('data-node-note="4 files · +120 · 2 commits"');
  expect(rowMarkup(html, 'demo')).not.toContain('data-node-note');
});

test('the note rendered is the one the derivation produced, not re-derived in the view', () => {
  // KILLS: a component that recomputes the note from `run.phaseMeta` instead
  // of rendering the row it was handed — which would re-introduce exactly
  // the derivation the pure module exists to own (and test). Feeding a
  // distinctive note through proves the value is a passthrough.
  const custom = rows();
  custom[0] = { ...custom[0], note: 'SENTINEL-NOTE-VALUE' };
  const html = render({ rows: custom });

  expect(rowMarkup(html, 'dev')).toContain('data-node-note="SENTINEL-NOTE-VALUE"');
});

// ---------------------------------------------------------------------------
// TRIGGER PROVENANCE — the reserved vocabulary, verbatim
// ---------------------------------------------------------------------------

test('a triggered run renders the reserved trigger-provenance attributes', () => {
  // KILLS: inventing a parallel vocabulary (data-trigger, data-fired-by,
  // data-provenance-*). These three names are RESERVED verbatim in
  // docs/forge-ui-dom-and-harness.md:830, which names "R6-01-F4 run detail"
  // as a surface that must attach them.
  const run = archivedRun();
  (run as Run & { trigger?: unknown }).trigger = {
    kind: 'schedule',
    source: 'cron:0 9 * * 1',
    scope: 'gitpulse',
  };
  const html = render({ run });

  expect(html).toContain('data-section="run-trigger"');
  expect(html).toContain('data-trigger-kind="schedule"');
  expect(html).toContain('data-trigger-source="cron:0 9 * * 1"');
  expect(html).toContain('data-trigger-scope="gitpulse"');
});

test('an UNSCOPED trigger renders data-trigger-scope="" — not omitted, not "null"', () => {
  // KILLS: the three wrong ways to render a null scope — dropping the
  // attribute (indistinguishable from "not a triggered run"), stringifying
  // it as "null"/"undefined", or substituting a word like "all"/"global".
  // The doc pins the empty string explicitly: `data-trigger-scope=""` when
  // `scope` is `null`. An unscoped trigger is a REAL, distinct state
  // (docs also keep `projects: null` distinct from `projects: []` on the
  // wire), so it must stay visible and distinguishable.
  const run = archivedRun();
  (run as Run & { trigger?: unknown }).trigger = {
    kind: 'webhook',
    source: 'github:push',
    scope: null,
  };
  const html = render({ run });

  expect(html).toContain('data-trigger-kind="webhook"');
  expect(html).toContain('data-trigger-scope=""');
  expect(html).not.toContain('data-trigger-scope="null"');
  expect(html).not.toContain('data-trigger-scope="undefined"');
});

test('a run with NO trigger renders no trigger section at all', () => {
  // KILLS: rendering an empty/placeholder provenance block for a run that
  // was never triggered. Measured: `deriveTrigger` omits the `trigger` KEY
  // entirely when there is no derivable provenance (run-model.ts:627,
  // `...(trigger !== undefined ? { trigger } : {})`) — absence is
  // meaningful, and the UI must not manufacture a row for it.
  const run = archivedRun();
  expect('trigger' in run).toBe(false); // precondition
  const html = render({ run });

  expect(html).not.toContain('data-section="run-trigger"');
  expect(html).not.toContain('data-trigger-kind');
});

test('parseRun carries `trigger` through to the client instead of dropping it', () => {
  // KILLS the CURRENT state of the code: `forge-ui/lib/studio-client.ts`'s
  // `parseRun` enumerates fields explicitly and does NOT list `trigger`, so
  // the provenance R2-08-F4 put on the server model
  // (orchestrator/run-model.ts:127) is silently discarded before any surface
  // can render it. This is the "declared-data-fails-open" standing defect:
  // a field parsed and served end-to-end, then dropped at the last hop. The
  // client `Run` type must gain the field and `parseRun` must pass it on.
  const parsed = parseRun({
    ...archivedRun(),
    trigger: { kind: 'schedule', source: 'cron:0 9 * * 1', scope: null },
  }) as Run & { trigger?: { kind: string; source: string; scope: string | null } };

  expect(parsed.trigger).toEqual({ kind: 'schedule', source: 'cron:0 9 * * 1', scope: null });
});

test('parseRun leaves `trigger` absent for a run that has none', () => {
  // KILLS: a parseRun that defaults `trigger` to `{}`/null and thereby makes
  // an untriggered run indistinguishable from a triggered one — the same
  // fidelity bug R2-08-F4 fixed server-side when 'triggered' origin was
  // being coerced to 'architect'.
  const parsed = parseRun(archivedRun()) as Run & { trigger?: unknown };

  expect('trigger' in parsed && parsed.trigger !== undefined).toBe(false);
});

// ---------------------------------------------------------------------------
// FINDINGS — through the EXISTING panel, with no fabricated state
// ---------------------------------------------------------------------------

const FINDINGS_DOC = {
  initiative_id: 'INIT-done-2',
  headSha: 'abcdef1234567890',
  reviewedAt: '2026-01-01T00:20:00Z',
  summary: 'One real correctness risk in the delivered diff.',
  findings: [
    {
      id: 'RF-1',
      severity: 'major' as const,
      category: 'correctness',
      title: 'Unhandled null from resolveBridgeUrl',
      detail: 'A null base silently produces a relative fetch.',
      evidence: [{ file: 'forge-ui/lib/studio-client.ts', line: 42, excerpt: 'const base = await resolveBridgeUrl();' }],
      acRef: 'AC-2',
    },
  ],
};

test('findings render through the EXISTING ReviewFindingsPanel contract, not a fork', () => {
  // KILLS: a second, parallel findings renderer on this page. The panel at
  // components/ReviewFindingsPanel.tsx already ships this exact vocabulary
  // and is already the renderer on /artifact (page.tsx:712, :890); forking
  // it would mean two surfaces drifting apart on the same artifact.
  const html = render({ findings: FINDINGS_DOC });

  expect(html).toContain('data-section="review-findings"');
  expect(html).toContain('data-findings-count="1"');
  expect(html).toContain('data-finding="RF-1"');
  expect(html).toContain('data-finding-severity="major"');
  expect(html).toContain('data-finding-category="correctness"');
});

test('finding EVIDENCE is rendered, since every finding claim is pointer-backed', () => {
  // KILLS: a findings table that shows severity/title only and drops the
  // file:line evidence. `validateReviewFindings` REQUIRES ≥1 evidence
  // pointer per finding precisely so no claim is unbacked
  // (flow-artifacts.ts:367); a surface that hides it discards the guarantee.
  const html = render({ findings: FINDINGS_DOC });

  expect(html).toContain('forge-ui/lib/studio-client.ts');
  expect(html).toContain('42');
});

test('NO per-finding `state` is rendered — there is no producer for one', () => {
  // KILLS: a hardcoded "open" (or any fabricated per-finding lifecycle
  // state) copied from the design mockup, which shows a `state` column that
  // NOTHING produces. Measured (a): `ReviewFinding`
  // (orchestrator/flow-artifacts.ts:304) has id/severity/category/title/
  // detail/evidence/acRef and NO state; `validateReviewFindings` neither
  // accepts nor emits one; a repo-wide grep finds no producer anywhere.
  // Rendering "open" would be the UI asserting a fact the system cannot
  // know — this test is the guard that keeps the surface honest.
  const html = render({ findings: FINDINGS_DOC });

  expect(html).not.toContain('data-finding-state');
  expect(html).not.toContain('>open<');
  expect(html).not.toContain('>fixed<');
});

test('an explicit CLEAN PASS renders as such, and is not confused with no review at all', () => {
  // KILLS: treating `findings: []` (an explicit clean pass — the artifact
  // was written and said "nothing found", flow-artifacts.ts:297) the same as
  // `findings: null` (no artifact; the review never ran). The panel already
  // distinguishes these: `doc === null` renders nothing.
  const clean = render({ findings: { ...FINDINGS_DOC, findings: [] } });
  const absent = render({ findings: null });

  expect(clean).toContain('data-section="review-findings"');
  expect(clean).toContain('data-findings-count="0"');
  expect(absent).not.toContain('data-section="review-findings"');
});

// ---------------------------------------------------------------------------
// W7-A3 (crosscut-05 / crosscut-23 / flows-06 / home-sessions-17) — the run
// page reaches data-page-ready and is no longer a dead end: a breadcrumb back
// to the flow monitor, the run's artifacts, and (when known) its project.
// ---------------------------------------------------------------------------

test('W7-A3: main[data-page="flow-run"] carries data-page-ready="true" once resolved (found AND not-found)', () => {
  expect(render()).toMatch(/<main[^>]*data-page="flow-run"[^>]*data-page-ready="true"/);
  expect(render({ found: false, run: null, rows: [] })).toMatch(/<main[^>]*data-page="flow-run"[^>]*data-page-ready="true"/);
});

test('W7-A3: a found run renders the breadcrumb — back to its OWN flow monitor, its artifacts, and its project', () => {
  const html = render({ run: archivedRun({ project: 'mdtoc' }) });
  expect(html).toContain('data-section="run-breadcrumb"');
  expect(html).toMatch(/<a[^>]*data-action="back-to-monitor"[^>]*href="\/flows\/forge-develop"/);
  expect(html).toMatch(/<a[^>]*data-action="open-artifacts"[^>]*href="\/artifact\?run=2026-01-01T00-00-00_INIT-done-2&(amp;)?type=plan&(amp;)?mode=view"/);
  expect(html).toMatch(/<a[^>]*data-action="open-project"[^>]*href="\/projects\/mdtoc"/);
});

test('W7-A3: no project on the run → no project link fabricated; not-found still links back to the flow', () => {
  const html = render();
  expect(html).not.toContain('data-action="open-project"');
  const nf = render({ found: false, run: null, rows: [] });
  expect(nf).toMatch(/<a[^>]*data-action="back-to-monitor"[^>]*href="\/flows\/forge-develop"/);
  expect(nf).not.toContain('data-action="open-artifacts"');
});
