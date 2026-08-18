/**
 * DOM acceptance tests for R4-12-F1's project-page "contract buildout" panel —
 * an ASYNC server component `ProjectContractPanel`
 * (`forge-ui/components/studio/project-builder/ProjectContractPanel.tsx`) that
 * does NOT exist yet. Every assertion below is a legitimate RED against a
 * not-yet-created module; the import resolves to nothing, so vitest fails the
 * whole file at collection until the implementer lands it. Named here so the
 * killed impl is unambiguous.
 *
 * This REPLACES a removed `components/studio/project-builder/
 * ProjectContractPanel.test.tsx` — SAME assertions, CORRECT convention +
 * location. Per this repo's render-test convention (there is NO jsdom and NO
 * @testing-library/react; `useEffect` NEVER runs under renderToStaticMarkup):
 *   - This file is a `.test.ts` in `lib/` (NOT a `.tsx` under `components/`).
 *     A `.test.tsx` under `components/` runs NOWHERE (vitest's glob is
 *     `lib/**\/*.test.ts`) and pollutes `next build` (tsconfig excludes only
 *     `**\/*.test.ts`). This location runs, and stays out of the Next build.
 *   - Components are asserted on `renderToStaticMarkup` output. Because the
 *     subject is an ASYNC component (it awaits its OWN GET before returning
 *     markup — a `useEffect`/`useState` client-fetch would NEVER run here, so
 *     the panel is deliberately a server component that fetches inline), it is
 *     AWAITED first: `const el = await ProjectContractPanel(props); const html
 *     = renderToStaticMarkup(el as any)`. `renderToStaticMarkup` is
 *     synchronous and the awaited tree is already fully resolved, so no jsdom /
 *     Suspense boundary is involved.
 *
 * LOAD-BEARING CONTRACT this file pins (the implementer builds to it):
 *   - `ProjectContractPanel` is `async function ProjectContractPanel(props)`
 *     and awaits its OWN `GET /api/studio/projects/<projectId>/contract-stages`
 *     fetch — it does NOT take a `rows={}` prop (a `useEffect` fetch would
 *     never run in this render harness, and a prop would not prove the panel
 *     owns its data source). It reuses `session-client`'s exported
 *     `ContractStageRow` type + `parseContractStageRow` (the SAME parser the
 *     session-shell's `contract-buildout` artifact already runs — no third
 *     client-side mirror of the row shape).
 *   - Props carried directly (NOT fetched): `northStar?`, `instructions?`,
 *     `instructionsSource?` — the verbatim north-star + conventions VIEW.
 *
 * data-* vocabulary this file pins (mirrors docs/forge-ui-dom-and-harness.md's
 * contract-buildout section + components/studio/ContractBuildout.tsx's
 * existing `data-checklist-row`/`data-checklist-status`/`data-detail-line`
 * hooks — reused, not reinvented):
 *   [data-section="contract-panel"]            the panel wrapper
 *   [data-checklist-row-count]                 the fetched row count
 *   [data-checklist-row=<stage>]               one per fetched stage
 *   [data-checklist-status="present"|"absent"] each row's presence
 *   [data-detail-line]                         a row's detail entries (secrets = NAMES only)
 *   [data-contract-northstar]                  verbatim north-star VIEW
 *   [data-contract-northstar-state="missing"]  no north-star supplied
 *   [data-contract-conventions-source=<src>]   verbatim conventions VIEW + its source
 *
 * FETCH HARNESS (matches lib/agent-ledger.test.ts / lib/studio-client.test.ts
 * verbatim): the panel's fetch flows through `resolveBridgeUrl()`
 * (./bridge-client) before `fetch()`; under this repo's `environment:'node'`
 * vitest config the REAL `resolveBridgeUrl` returns '' (its `typeof window`
 * SSR guard trips with no `window`), which short-circuits before the real
 * `fetch` is ever reached — so the fetch is only exercisable with
 * `resolveBridgeUrl` replaced by a fixed base. `vi.mock` is hoisted above
 * every import and matches by RESOLVED file path, so `'./bridge-client.ts'`
 * here intercepts the extensionless `from './bridge-client'` import wherever it
 * appears in the panel's module graph (studio-client / the component itself).
 * `importOriginal` is spread so EVERY other bridge-client export stays real —
 * only `resolveBridgeUrl` is overridden — so nuking the module can't
 * accidentally break an unrelated transitive import in the component graph.
 *
 * RUN: npx vitest run lib/project-contract-panel-render.test.ts   (from forge-ui/)
 */

import { test, expect, vi, afterEach } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { ContractStageRow } from '@/lib/session-client';

// KILLED IMPL: a panel module that does not exist at all. Until
// `ProjectContractPanel` is exported from this path, this import is
// `undefined` and every test below fails at the `await ProjectContractPanel(...)`
// call — the RED that names exactly the gap R4-12-F1 closes.
import { ProjectContractPanel } from '@/components/studio/project-builder/ProjectContractPanel';

vi.mock('./bridge-client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./bridge-client.ts')>();
  return {
    ...actual,
    resolveBridgeUrl: vi.fn(async () => 'http://bridge.test'),
  // W7-A1: studio-client rides bridge-client's `bridgeFetch` (one transport,
  // crosscut-26) — the mock forwards to the stubbed global fetch against the
  // same fixed base, so each test's `vi.stubGlobal('fetch', …)` still drives it.
  bridgeFetch: vi.fn(async (path: string, init?: RequestInit) => (init === undefined ? fetch(`http://bridge.test${path}`) : fetch(`http://bridge.test${path}`, init))),
  };
});

// ---------------------------------------------------------------------------
// Props (the impl does not exist — typed locally, component cast to any).
// ---------------------------------------------------------------------------

type Props = {
  projectId: string;
  northStar?: string | null;
  instructions?: string | null;
  instructionsSource?: string | null;
};

// ---------------------------------------------------------------------------
// Captured REAL 200 body of GET /api/studio/projects/mdtoc/contract-stages
// (`{ ok, project, stages, sourcesScanned }`), rows in canonical
// deriveContractStages order (contract, instructions, secrets, demo, roadmap).
// Public repo — GITHUB_TOKEN / ADO_PAT are fake IDENTIFIERS used as env-var
// NAMES, never real secret values.
// ---------------------------------------------------------------------------

const CAPTURED_STAGES: ContractStageRow[] = [
  { stage: 'contract', status: 'present', source: '.forge/project.json', detail: ['gate command: npm test'], bytes: null },
  { stage: 'instructions', status: 'present', source: 'AGENTS.md', detail: ['source file: AGENTS.md'], bytes: 1234 },
  { stage: 'secrets', status: 'present', source: '.forge/project.json', detail: ['GITHUB_TOKEN', 'ADO_PAT'], bytes: null },
  { stage: 'demo', status: 'present', source: '.forge/project.json', detail: ['step: api'], bytes: null },
  { stage: 'roadmap', status: 'present', source: 'roadmap.md', detail: ['brain profile: present'], bytes: 4096 },
];

function capturedBody(): Record<string, unknown> {
  return {
    ok: true,
    project: 'mdtoc',
    // fresh copies so a test's poison mutation can't leak across tests
    stages: CAPTURED_STAGES.map((r) => ({ ...r, detail: [...r.detail] })),
    sourcesScanned: [
      '.forge/project.json (contract)',
      'AGENTS.md (instructions)',
      '.forge/project.json (secrets: NAMES ONLY, never a value)',
      '.forge/project.json (demo)',
      'roadmap.md (roadmap)',
    ],
  };
}

const CONTRACT_STAGE_ORDER = ['contract', 'instructions', 'secrets', 'demo', 'roadmap'];

// ---------------------------------------------------------------------------
// Render + string-based DOM helpers (the panel itself is untouched — this file
// only reads its awaited output).
// ---------------------------------------------------------------------------

/** Stub `global.fetch` for the panel's own GET; return the spy. `json`
 *  resolves `body`. `ok`/`status` set so a consumer that reads either the
 *  envelope (fetchContractStages-style) OR a bare `res.json()` is satisfied. */
function stubFetch(body: Record<string, unknown>): ReturnType<typeof vi.fn> {
  const spy = vi.fn(async () => ({ ok: true, status: 200, json: async () => body }));
  vi.stubGlobal('fetch', spy);
  return spy;
}

/** Await the async component, then render its resolved tree to static markup. */
async function renderPanel(props: Props): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const el = await (ProjectContractPanel as any)(props);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderToStaticMarkup(el as any);
}

function count(html: string, substr: string): number {
  return html.split(substr).length - 1;
}

/** Smallest `<tag ...>` substring whose opening `<` is the nearest before
 *  `marker`. Sufficient (no real DOM parser) for pinning that a rendered value
 *  sits inside an element carrying a given data-* hook. Mirrors
 *  run-panel-render.test.ts's helper of the same name. */
function tagContaining(html: string, marker: string): string {
  const idx = html.indexOf(marker);
  if (idx === -1) return '';
  const start = html.lastIndexOf('<', idx);
  const end = html.indexOf('>', idx);
  if (start === -1 || end === -1) return '';
  return html.slice(start, end + 1);
}

/** A bounded window of `html` starting at the first match of `needle`. Used
 *  for co-location assertions (a marker rendered INSIDE a given element),
 *  robust to whether the value lands in the attribute or as nested text. */
function sliceFrom(html: string, needle: RegExp, span = 800): string {
  const idx = html.search(needle);
  if (idx === -1) return '';
  return html.slice(idx, idx + span);
}

/** The markup block for one checklist row: from its `data-checklist-row="<stage>"`
 *  hook up to the NEXT row's hook (or end of markup for the last row). Lets a
 *  row's status/detail be asserted whether they sit on the row element itself
 *  or on a child, without over-coupling to the exact element nesting. */
function rowRegion(html: string, stage: string): string {
  const start = html.indexOf(`data-checklist-row="${stage}"`);
  if (start === -1) return '';
  const next = html.indexOf('data-checklist-row="', start + 1);
  return html.slice(start, next === -1 ? html.length : next);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// AT-F1-2 — non-empty rows via the panel's OWN fetch (rule 38)
// ---------------------------------------------------------------------------

test('AT-F1-2: the panel fetches its OWN GET /projects/mdtoc/contract-stages, renders [data-section="contract-panel"] with data-checklist-row-count="5" and exactly 5 [data-checklist-row] rows (one per stage, each with a present/absent status) — kills a panel that renders NOTHING from the real fetch', async () => {
  const fetchSpy = stubFetch(capturedBody());

  const html = await renderPanel({ projectId: 'mdtoc' });

  // --- own-fetch proof (rule 38): the panel sourced its rows from the route,
  // not from a prop. EXACTLY ONE GET to that route (kills an N+1 render), at a
  // URL ending in the exact path (kills a hand-rolled / wrong path that would
  // 404 the checklist into emptiness).
  const stagesCalls = fetchSpy.mock.calls.filter((c) => String(c[0]).endsWith('/projects/mdtoc/contract-stages'));
  expect(stagesCalls).toHaveLength(1);
  const init = stagesCalls[0][1] as { method?: string } | undefined;
  expect(init?.method ?? 'GET').toBe('GET');

  // --- rendered the real fetch, not nothing ---
  expect(html).toContain('data-section="contract-panel"');
  expect(html).toContain('data-checklist-row-count="5"');

  // exactly 5 per-row hooks. `data-checklist-row=` is NOT a substring of
  // `data-checklist-row-count=` (the char after `row` is `-`, not `=`), so
  // this count isolates the rows.
  expect(count(html, 'data-checklist-row=')).toBe(5);

  // each of the 5 fetched stages rendered its own row (kills a fixed-count
  // placeholder that ignores the fetched stage identities)
  for (const stage of CONTRACT_STAGE_ORDER) {
    expect(html).toContain(`data-checklist-row="${stage}"`);
  }

  // every row carries a present/absent status, and only those two values
  const present = count(html, 'data-checklist-status="present"');
  const absent = count(html, 'data-checklist-status="absent"');
  expect(present + absent).toBe(5);
  // this captured payload is all-present
  expect(present).toBe(5);
});

// ---------------------------------------------------------------------------
// AT-F1-3 — secrets: NAMES ONLY, never a value, never a fabricated mask
// ---------------------------------------------------------------------------

test('AT-F1-3: the secrets row renders its env-var NAMES (GITHUB_TOKEN, ADO_PAT) as [data-detail-line], and a value-shaped poison smuggled onto the wire NEVER reaches the html (nor a bullet/redacted mask) — kills reading a value/env or fabricating a mask', async () => {
  // Smuggle a value-shaped poison BOTH as an extra field on the secrets row
  // AND as a sibling top-level map keyed by the same names — a correct panel
  // reads ONLY the parsed `detail` string[] (env-var NAMES), so neither poison
  // path can surface. `parseContractStageRow` drops the extra row field, and
  // nothing consumes a sibling map — but if a wrong impl reached past the
  // parser for a raw value, or synthesised a placeholder, this catches it.
  const POISON = 'ghp_SECRETVALUE123';
  const body = capturedBody();
  const stages = body.stages as Array<Record<string, unknown>>;
  const secretsRow = stages.find((r) => r.stage === 'secrets')!;
  secretsRow.value = POISON;
  secretsRow.envValue = POISON;
  body.secretValues = { GITHUB_TOKEN: POISON, ADO_PAT: POISON };
  stubFetch(body);

  const html = await renderPanel({ projectId: 'mdtoc' });

  // the NAMES render as detail-line entries within the secrets row block
  const secrets = rowRegion(html, 'secrets');
  expect(secrets).toContain('data-detail-line');
  expect(secrets).toContain('GITHUB_TOKEN');
  expect(secrets).toContain('ADO_PAT');
  // and each name specifically lands inside a data-detail-line element
  expect(tagContaining(html, 'GITHUB_TOKEN')).toContain('data-detail-line');
  expect(tagContaining(html, 'ADO_PAT')).toContain('data-detail-line');

  // the value NEVER appears — not raw, not partially
  expect(html).not.toContain(POISON);
  expect(html).not.toContain('ghp_');
  // no fabricated mask standing in for a value
  expect(html).not.toContain('•'); // • bullet
  expect(html).not.toContain('●'); // ● black circle
  expect(html.toLowerCase()).not.toContain('redacted');
});

// ---------------------------------------------------------------------------
// AT-F1-5 — north-star + conventions rendered VERBATIM as a read-only VIEW
// ---------------------------------------------------------------------------

test('AT-F1-5: northStar renders VERBATIM inside [data-contract-northstar], conventions render VERBATIM inside [data-contract-conventions-source="AGENTS.md"], and NO <textarea is emitted (a verbatim VIEW, distinct from the editable NorthStar textarea) — kills paraphrase / textarea reuse', async () => {
  stubFetch(capturedBody()); // the panel still fetches its stages

  const NORTH_STAR = 'NS-VERBATIM-MARKER-9021';
  const CONVENTIONS = 'CONV-BODY-7734';
  const html = await renderPanel({
    projectId: 'mdtoc',
    northStar: NORTH_STAR,
    instructions: CONVENTIONS,
    instructionsSource: 'AGENTS.md',
  });

  // north-star VIEW element exists, and the EXACT marker renders inside it
  // (kills any paraphrase — a reworded north-star cannot contain the marker).
  // The bare view attribute is disambiguated from data-contract-northstar-state.
  expect(html).toMatch(/data-contract-northstar(?![-\w])/);
  expect(html).toContain(NORTH_STAR);
  expect(sliceFrom(html, /data-contract-northstar(?![-\w])/)).toContain(NORTH_STAR);

  // conventions VIEW carries its exact source AND the verbatim body
  expect(html).toContain('data-contract-conventions-source="AGENTS.md"');
  expect(html).toContain(CONVENTIONS);
  expect(sliceFrom(html, /data-contract-conventions-source="AGENTS\.md"/)).toContain(CONVENTIONS);

  // a read-only VIEW, NOT the editable NorthStar textarea reused here
  expect(html).not.toContain('<textarea');
});

// ---------------------------------------------------------------------------
// AT-F1-6 — honest degradation on a partial project (no crash, no blank)
// ---------------------------------------------------------------------------

test('AT-F1-6: a partial payload (secrets absent, instructions absent) with NO northStar renders [data-checklist-status="absent"] on the absent rows and [data-contract-northstar-state="missing"], with [data-section="contract-panel"] STILL present and no throw — kills a blank/crashed partial-project panel', async () => {
  const partial = capturedBody();
  const stages = partial.stages as Array<Record<string, unknown>>;
  const secretsRow = stages.find((r) => r.stage === 'secrets')!;
  secretsRow.status = 'absent';
  secretsRow.detail = [];
  const instructionsRow = stages.find((r) => r.stage === 'instructions')!;
  instructionsRow.status = 'absent';
  instructionsRow.detail = [];
  instructionsRow.bytes = null;
  stubFetch(partial);

  // If the panel throws on a partial project this await rejects and the test
  // fails — that IS the "no crash" assertion.
  const html = await renderPanel({ projectId: 'mdtoc' /* no northStar */ });

  // the panel still rendered (not blank / not crashed)
  expect(html).toContain('data-section="contract-panel"');
  expect(html).toContain('data-checklist-row-count="5"');

  // the two absent rows carry an honest absent status — and specifically the
  // secrets + instructions rows (not two arbitrary rows that keep the count at 2)
  expect(count(html, 'data-checklist-status="absent"')).toBe(2);
  expect(rowRegion(html, 'secrets')).toContain('data-checklist-status="absent"');
  expect(rowRegion(html, 'instructions')).toContain('data-checklist-status="absent"');
  // the untouched rows stay present
  expect(rowRegion(html, 'contract')).toContain('data-checklist-status="present"');

  // no north-star supplied -> an explicit missing state, never a fabricated one
  expect(html).toContain('data-contract-northstar-state="missing"');
});

// ---------------------------------------------------------------------------
// W7-A1 (projects-03 / crosscut-12) — a FAILED contract-stages read renders
// the shared failure state, never an empty-but-successful-looking checklist
// ---------------------------------------------------------------------------

const GITPULSE_409_TEXT =
  'project-config: the flat gate keys moved to the typed testProcess object (R1-03) — migrate: quality_gate_cmd → testProcess.local.cmd; acceptance_gate → testProcess.acceptance';

test('W7-A1: a 409 contract-stages reply (the REAL gitpulse config-migration body) renders [data-component="fetch-error"][data-fetch-http-status="409"] carrying the bridge text VERBATIM inside [data-section="contract-panel"], NO data-checklist-row-count="0", and the north-star VIEW still renders — kills the silent-empty checklist', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ ok: false, error: GITPULSE_409_TEXT }) })));

  const html = await renderPanel({ projectId: 'gitpulse', northStar: 'Ship it' });

  expect(html).toContain('data-section="contract-panel"');
  expect(html).toContain('data-section="contract-checklist-error"');
  expect(html).toContain('data-component="fetch-error"');
  expect(html).toContain('data-fetch-http-status="409"');
  expect(html).toContain('data-fetch-reachable="true"');
  expect(html).toContain('migrate: quality_gate_cmd → testProcess.local.cmd');
  expect(html).not.toContain('data-checklist-row-count="0"');
  expect(html).not.toContain('data-checklist-row-count');
  expect(html).not.toContain('Could not reach'); // the bridge ANSWERED — never framed as unreachable
  expect(html).toContain('data-contract-northstar-state="present"');
});

test('W7-A1: a transport failure (bridge unreachable) renders the fetch-error state with data-fetch-reachable="false" and no http status — still no empty checklist, still no throw', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));

  const html = await renderPanel({ projectId: 'mdtoc' });

  expect(html).toContain('data-section="contract-panel"');
  expect(html).toContain('data-component="fetch-error"');
  expect(html).toContain('data-fetch-reachable="false"');
  expect(html).not.toContain('data-fetch-http-status');
  expect(html).toContain('bridge unreachable (Failed to fetch)');
  expect(html).not.toContain('data-checklist-row-count');
});
