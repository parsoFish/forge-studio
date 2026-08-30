/**
 * W8-C3 WI-1 — the CLIENT half of the projects index's health signal
 * (projects-08 / forge-j1e / bead forge-6gv.13.2).
 *
 * RED at branch base (`d17b4251`): `/projects` renders an identical card for
 * every project. gitpulse — whose `.forge/project.json` is still on the R1-03
 * flat gate keys, the state `GET /api/studio/projects/:id/contract-stages`
 * already 409s on — looks exactly like a fully-onboarded, buildable project.
 *
 * THE STRUCTURAL RULE THIS FILE PINS (wave-8 exit row 4): the health signal is
 * DERIVED from its source of truth on every render. There is no `health`
 * field on `Project`, no `health` prop on `ProjectCard`, and nothing on disk
 * for a writer to forget to update. `deriveProjectHealth` reads the server's
 * own per-request verdict (`configHealth`, itself derived by running the real
 * `validateProjectConfig`) and nothing else.
 *
 * Wire boundary, fail CLOSED: an absent or garbage `configHealth` normalises
 * to `'unknown'` — an honest "we do not know" — NEVER to `'ok'`. Defaulting
 * an unknown to healthy is the identical fabrication `parseKbLint` exists to
 * refuse (`{errors:0,flags:0}` invented for an absent summary).
 *
 * RUN: npx vitest run lib/projects-index-health.test.ts   (from forge-ui/)
 */
import { test, expect, vi, afterEach } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync } from 'node:fs';
import { join as joinPath } from 'node:path';

vi.mock('next/navigation', () => ({ usePathname: () => '/projects' }));

import { deriveProjectHealth, PROJECT_HEALTH_LEVELS, summariseProjectHealth } from './projects-index-health.ts';
import { fetchStudioProjects } from './studio-client.ts';
import type { Project } from './studio-client.ts';
import { ProjectCard } from '@/components/studio/LibraryCard';
import { ProjectsIndexBody } from '@/components/studio/ProjectsIndex';

function makeProject(overrides: Partial<Project> & { id: string }): Project {
  return { name: overrides.id, skills: [], ...overrides } as Project;
}

// Bridge-read harness — mirrors `./bridge-client-read-fail-closed.test.ts`'s
// stubbed-`window` + stubbed-`fetch` shape exactly (the client resolves a
// bridge origin before it fetches, so stubbing `fetch` alone is not enough).
type FakeWindow = { location: { protocol: string; hostname: string }; __FORGE_BRIDGE_PORT__?: number | null };
const HAD_WINDOW = 'window' in globalThis;
const ORIGINAL_WINDOW = (globalThis as { window?: FakeWindow }).window;
const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  if (HAD_WINDOW) (globalThis as { window?: FakeWindow }).window = ORIGINAL_WINDOW;
  else delete (globalThis as { window?: FakeWindow }).window;
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

function stubProjectsRoute(payload: unknown) {
  (globalThis as { window?: FakeWindow }).window = { location: { protocol: 'http:', hostname: 'h' }, __FORGE_BRIDGE_PORT__: 4123 };
  globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => payload }) as unknown as Response) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// The pure derivation
// ---------------------------------------------------------------------------

test('the four health levels are exactly healthy / attention / broken / unknown', () => {
  expect([...PROJECT_HEALTH_LEVELS]).toEqual(['healthy', 'attention', 'broken', 'unknown']);
});

test('configHealth "ok" derives level "healthy" with no reasons', () => {
  const h = deriveProjectHealth(makeProject({ id: 'p', configHealth: { state: 'ok' } }));
  expect(h.level).toBe('healthy');
  expect(h.reasons).toEqual([]);
});

test('configHealth "invalid" derives level "broken", and CARRIES the validator\'s own reason verbatim — not a re-worded copy', () => {
  const reason = 'project-config: the flat gate keys moved to the typed testProcess object (R1-03) — migrate: quality_gate_cmd → testProcess.local.cmd.';
  const h = deriveProjectHealth(makeProject({ id: 'gitpulse', configHealth: { state: 'invalid', reason } }));
  expect(h.level).toBe('broken');
  expect(h.reasons).toContain(reason);
});

test('configHealth "unconfigured" derives level "attention" — half-onboarded is neither healthy nor broken', () => {
  const h = deriveProjectHealth(makeProject({ id: 'p', configHealth: { state: 'unconfigured', reason: 'no .forge/project.json — onboarding is unfinished' } }));
  expect(h.level).toBe('attention');
  expect(h.reasons.length).toBeGreaterThan(0);
});

test('FAIL CLOSED: a project with NO configHealth at all derives "unknown" — never "healthy"', () => {
  const h = deriveProjectHealth(makeProject({ id: 'p' }));
  expect(h.level).toBe('unknown');
  expect(h.level).not.toBe('healthy');
});

test('deriveProjectHealth is pure — it returns a new object and mutates nothing on its input', () => {
  const project = makeProject({ id: 'p', configHealth: { state: 'ok' } });
  const snapshot = JSON.stringify(project);
  deriveProjectHealth(project);
  expect(JSON.stringify(project)).toBe(snapshot);
  expect('health' in project).toBe(false);
});

// ---------------------------------------------------------------------------
// The roster rollup
// ---------------------------------------------------------------------------

test('summariseProjectHealth counts every level, and the counts always sum to the roster size', () => {
  const projects = [
    makeProject({ id: 'a', configHealth: { state: 'ok' } }),
    makeProject({ id: 'b', configHealth: { state: 'invalid', reason: 'x' } }),
    makeProject({ id: 'c', configHealth: { state: 'unconfigured', reason: 'y' } }),
    makeProject({ id: 'd' }),
    makeProject({ id: 'e', configHealth: { state: 'ok' } }),
  ];
  const s = summariseProjectHealth(projects);
  expect(s).toEqual({ healthy: 2, attention: 1, broken: 1, unknown: 1 });
  expect(s.healthy + s.attention + s.broken + s.unknown).toBe(projects.length);
});

// ---------------------------------------------------------------------------
// The wire boundary — parse, never cast
// ---------------------------------------------------------------------------

test('fetchStudioProjects PARSES configHealth: a valid server verdict survives verbatim', async () => {
  stubProjectsRoute({ projects: [{ id: 'p', name: 'P', skills: [], configHealth: { state: 'invalid', reason: 'boom' } }] });
  const [p] = await fetchStudioProjects();
  expect(p.configHealth).toEqual({ state: 'invalid', reason: 'boom' });
});

test('fetchStudioProjects normalises an ABSENT configHealth to { state: "unknown" } — never to ok', async () => {
  stubProjectsRoute({ projects: [{ id: 'p', name: 'P', skills: [] }] });
  const [p] = await fetchStudioProjects();
  expect(p.configHealth).toEqual({ state: 'unknown' });
});

test('fetchStudioProjects normalises a GARBAGE configHealth (wrong type, unknown state token) to "unknown"', async () => {
  stubProjectsRoute({ projects: [
    { id: 'a', name: 'A', skills: [], configHealth: 'ok' },
    { id: 'b', name: 'B', skills: [], configHealth: { state: 'fine' } },
    { id: 'c', name: 'C', skills: [], configHealth: null },
  ] });
  const rows = await fetchStudioProjects();
  expect(rows.map((r) => r.configHealth?.state)).toEqual(['unknown', 'unknown', 'unknown']);
});

test('fetchStudioProjects drops a non-string reason rather than carrying it into the UI', async () => {
  stubProjectsRoute({ projects: [{ id: 'p', name: 'P', skills: [], configHealth: { state: 'invalid', reason: { nope: 1 } } }] });
  const [p] = await fetchStudioProjects();
  expect(p.configHealth).toEqual({ state: 'invalid' });
});

// ---------------------------------------------------------------------------
// Render — ProjectCard derives its OWN health; there is no prop to go stale
// ---------------------------------------------------------------------------

test('ProjectCard renders data-health derived from the project itself — with NO health prop passed', () => {
  const project = makeProject({ id: 'gitpulse', configHealth: { state: 'invalid', reason: 'flat gate keys' } });
  const html = renderToStaticMarkup(React.createElement(ProjectCard, { project, kbs: [], index: 0 }));
  expect(html).toContain('data-health="broken"');
});

test('ProjectCard: a healthy project and a broken one are NOT visually identical — the broken card names its reason', () => {
  const healthy = renderToStaticMarkup(React.createElement(ProjectCard, {
    project: makeProject({ id: 'p', configHealth: { state: 'ok' } }), kbs: [], index: 0,
  }));
  const broken = renderToStaticMarkup(React.createElement(ProjectCard, {
    project: makeProject({ id: 'p', configHealth: { state: 'invalid', reason: 'the flat gate keys moved to the typed testProcess object' } }), kbs: [], index: 0,
  }));
  expect(healthy).toContain('data-health="healthy"');
  expect(broken).toContain('data-health="broken"');
  expect(broken).toContain('the flat gate keys moved to the typed testProcess object');
  expect(healthy).not.toBe(broken);
});

test('ProjectCard: an unknown-health project says so rather than rendering as healthy', () => {
  const html = renderToStaticMarkup(React.createElement(ProjectCard, { project: makeProject({ id: 'p' }), kbs: [], index: 0 }));
  expect(html).toContain('data-health="unknown"');
  expect(html).not.toContain('data-health="healthy"');
});

test('the index grid carries the health rollup as data-* so the journey can assert it without scraping text', () => {
  const projects = [
    makeProject({ id: 'a', configHealth: { state: 'ok' } }),
    makeProject({ id: 'b', configHealth: { state: 'invalid', reason: 'x' } }),
    makeProject({ id: 'c', configHealth: { state: 'unconfigured', reason: 'y' } }),
  ];
  const html = renderToStaticMarkup(React.createElement(ProjectsIndexBody, { projects, kbs: [], ready: true }));
  expect(html).toContain('data-health-healthy="1"');
  expect(html).toContain('data-health-attention="1"');
  expect(html).toContain('data-health-broken="1"');
  expect(html).toContain('data-health-unknown="0"');
});

// ---------------------------------------------------------------------------
// ENUMERATION PIN — the no-`health`-prop argument rests on a fact about call
// sites, and this campaign's most-repeated finding is a coverage claim nobody
// counted. Pinned so the claim in `projects-index-health.ts`'s header cannot
// rot silently: if a second consumer appears, this test names it and the
// reviewer gets to ask whether it derives health the same way.
// ---------------------------------------------------------------------------

test('ProjectCard is rendered by exactly one component — so "derives its own health" covers every site, and a new site is announced here', () => {
  const roots = [new URL('../app/', import.meta.url).pathname, new URL('../components/', import.meta.url).pathname];
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(joinPath(dir, e.name)) : [joinPath(dir, e.name)],
    );
  const consumers = roots
    .flatMap(walk)
    .filter((f) => /\.tsx?$/.test(f) && !f.endsWith('LibraryCard.tsx'))
    .filter((f) => /<ProjectCard\b/.test(readFileSync(f, 'utf8')))
    .map((f) => f.split('/apps/studio/')[1]);
  expect(consumers).toEqual(['components/studio/ProjectsIndex.tsx']);
});
