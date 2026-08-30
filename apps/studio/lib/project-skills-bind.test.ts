/**
 * W8-C3 WI-4 — `SkillsBind`'s two live defects, both in the same 127-line file
 * (`components/studio/project-builder/SkillsBind.tsx`), both instances of the
 * campaign's dominant class.
 *
 * · **projects-06** (P1, bead forge-6gv.13.2) — "a project-local skill cannot
 *   be re-bound because the picker is forge-wide only, and its search ignores
 *   skill ids". At branch base the picker's `catalog` is only ever
 *   `GET /api/studio/catalog`'s forge-wide list, while the forge<->project
 *   contract puts skills INSIDE the project
 *   (`.forge/skills/demo-design/SKILL.md`). Unbind one and it is gone for
 *   good. And `catalog.filter(...)` matched `name` and `desc` only — an
 *   operator who types the id they see in `project.json` finds nothing.
 *
 * · **projects-43** (bead forge-6gv.13.1, folded into this lane by the
 *   pre-decomposition split ruling because it is the SAME FILE as
 *   projects-06) — a bound skill that no longer exists renders as a normal,
 *   healthy chip: `const item = catalog.find(c => c.id === sid)` followed by
 *   `{item?.name ?? sid}`. The `??` IS the defect: an unresolvable binding is
 *   silently displayed as its own raw id and reads as fine.
 *
 * RUN: npx vitest run lib/project-skills-bind.test.ts   (from forge-ui/)
 */
import { test, expect, vi, afterEach } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Every file under `dir`, recursively — used by the call-site enumeration
 *  below, because "you fixed one of N call sites" is this wave's most-repeated
 *  finding and the only defence is counting them. */
function readdirSyncDeep(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? readdirSyncDeep(join(dir, e.name)) : [join(dir, e.name)],
  );
}

import { SkillsBind } from '@/components/studio/project-builder/SkillsBind';
import { offeredSkills, filterSkillCatalog, resolveSkillBinding } from './project-skills-bind.ts';
import { fetchStudioProjects } from './studio-client.ts';

const CATALOG = [
  { id: 'security-review', name: 'Security Review', desc: 'audit the diff' },
  { id: 'tdd-workflow', name: 'TDD Workflow', desc: 'red first' },
];

function render(props: Partial<React.ComponentProps<typeof SkillsBind>> = {}) {
  return renderToStaticMarkup(React.createElement(SkillsBind, {
    skills: [], onChange: () => {}, catalog: CATALOG, ...props,
  }));
}

// ---------------------------------------------------------------------------
// projects-06a — search must match the id
// ---------------------------------------------------------------------------

test('projects-06: the library search matches a skill ID, not only its name and description', () => {
  // `security-review`'s NAME is "Security Review" and its desc is "audit the
  // diff"; neither contains the token an operator reads off project.json.
  expect(filterSkillCatalog(CATALOG, 'security-review').map((s) => s.id)).toEqual(['security-review']);
});

test('projects-06: search still matches name and description, case-insensitively, and an empty search constrains nothing', () => {
  expect(filterSkillCatalog(CATALOG, 'RED FIRST').map((s) => s.id)).toEqual(['tdd-workflow']);
  expect(filterSkillCatalog(CATALOG, 'security rev').map((s) => s.id)).toEqual(['security-review']);
  expect(filterSkillCatalog(CATALOG, '   ').map((s) => s.id)).toEqual(['security-review', 'tdd-workflow']);
});

// ---------------------------------------------------------------------------
// projects-06b — the picker must offer the project's OWN skills
// ---------------------------------------------------------------------------

test('projects-06: a project-local skill is OFFERED by the picker, so an unbound one can be re-bound', () => {
  const html = render({ localSkills: ['demo-design'] });
  expect(html).toContain('data-skill-id="demo-design"');
  expect(html).toContain('data-skill-source="project"');
});

test('projects-06: a project-local skill is findable by the search too', () => {
  expect(filterSkillCatalog(offeredSkills(CATALOG, ['demo-design']), 'demo-des').map((s) => s.id)).toEqual(['demo-design']);
});

test('resolveSkillBinding: an id in neither source is "missing"; a forge-wide one is "forge"; a project-local one is "project"', () => {
  const offered = offeredSkills(CATALOG, ['demo-design']);
  expect(resolveSkillBinding('ghost-skill', offered)).toEqual({ id: 'ghost-skill', resolved: false, source: 'missing', label: 'ghost-skill' });
  expect(resolveSkillBinding('security-review', offered)).toEqual({ id: 'security-review', resolved: true, source: 'forge', label: 'Security Review' });
  expect(resolveSkillBinding('demo-design', offered)).toEqual({ id: 'demo-design', resolved: true, source: 'project', label: 'demo-design' });
});

test('an id present BOTH forge-wide and project-locally is offered exactly ONCE — the forge-wide entry wins its metadata', () => {
  const html = render({ localSkills: ['tdd-workflow'] });
  expect((html.match(/data-skill-id="tdd-workflow"/g) ?? []).length).toBe(1);
});

// ---------------------------------------------------------------------------
// projects-43 — an unresolvable binding must NOT read as healthy
// ---------------------------------------------------------------------------

test('projects-43: a bound skill that resolves to nothing renders as MISSING, not as a normal chip', () => {
  const html = render({ skills: ['ghost-skill'] });
  expect(html).toContain('data-skill-id="ghost-skill"');
  expect(html).toContain('data-resolved="missing"');
  // and it must SAY so, not merely carry an attribute nobody renders
  expect(html.toLowerCase()).toContain('missing');
});

test('projects-43: a chip for a skill that DOES resolve is marked resolved, and shows the catalog name', () => {
  const html = render({ skills: ['security-review'] });
  expect(html).toContain('data-resolved="ok"');
  expect(html).toContain('Security Review');
  expect(html).not.toContain('data-resolved="missing"');
});

test('projects-43 + projects-06 compose: a bound PROJECT-LOCAL skill resolves (it exists) and is marked as project-sourced', () => {
  const html = render({ skills: ['demo-design'], localSkills: ['demo-design'] });
  expect(html).toContain('data-resolved="ok"');
  expect(html).toContain('data-skill-source="project"');
});

test('the drop zone counts every binding, resolvable or not — a missing binding is still bound', () => {
  const html = render({ skills: ['security-review', 'ghost-skill'] });
  expect(html).toContain('data-count="2"');
});

// ---------------------------------------------------------------------------
// The wire boundary for localSkills
// ---------------------------------------------------------------------------

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

test('fetchStudioProjects parses localSkills: a real array survives; absent and garbage both normalise to []', async () => {
  stubProjectsRoute({ projects: [
    { id: 'a', name: 'A', skills: [], localSkills: ['demo-design'] },
    { id: 'b', name: 'B', skills: [] },
    { id: 'c', name: 'C', skills: [], localSkills: 'demo-design' },
    { id: 'd', name: 'D', skills: [], localSkills: ['ok', 7, null] },
  ] });
  const rows = await fetchStudioProjects();
  expect(rows.map((r) => r.localSkills)).toEqual([['demo-design'], [], [], ['ok']]);
});

// ---------------------------------------------------------------------------
// DISPATCH — the campaign's dominant defect is a field that is parsed and
// surfaced but wired nowhere. `localSkills` is useless unless the project page
// actually hands it to the picker, and no render test above would notice if it
// did not. Pinned at the source, the same way `./community-surface-wiring.test.ts`
// and `./detail-pages-fail-closed-wiring.test.ts` pin their own wirings.
// ---------------------------------------------------------------------------

test('the project page PASSES localSkills to SkillsBind — a derived field wired to nothing is the defect class this lane exists to close', () => {
  const src = readFileSync(new URL('../app/projects/[id]/page.tsx', import.meta.url), 'utf8');
  const call = src.slice(src.indexOf('<SkillsBind'));
  expect(call.slice(0, call.indexOf('/>'))).toMatch(/localSkills=\{/);
});

test('SkillsBind has exactly ONE consumer in forge-ui — so the wiring pin above covers every call site, not one of several', () => {
  const consumers = readdirSyncDeep(new URL('../app/', import.meta.url).pathname)
    .concat(readdirSyncDeep(new URL('../components/', import.meta.url).pathname))
    .filter((f) => /\.tsx?$/.test(f) && !f.endsWith('SkillsBind.tsx'))
    .filter((f) => readFileSync(f, 'utf8').includes('<SkillsBind'));
  expect(consumers.map((f) => f.split('/apps/studio/')[1])).toEqual(['app/projects/[id]/page.tsx']);
});
