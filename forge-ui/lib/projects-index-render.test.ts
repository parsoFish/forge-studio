/**
 * Acceptance tests — the real projects index page (W6-IA-1).
 *
 * `forge-ui/app/projects/page.tsx` was a 23-line shim: it fetched the project
 * roster only to `router.replace()` to the FIRST registered project (an
 * arbitrary already-onboarded project's editor, never an index), and rendered
 * dead-end "No projects registered." text with no CTA when the roster was
 * empty. `app/page.tsx`'s Home dashboard linked its "Onboard a project" CTA
 * straight at this shim (`href="/projects"`), so the operator's one onboarding
 * entry point from Home landed on a random project instead of the onboarding
 * form.
 *
 * This file pins the REPLACEMENT: `components/studio/ProjectsIndex.tsx`'s
 * `ProjectsIndexBody` — a pure, props-driven presentational component (no
 * fetch, no `useEffect`) that `app/projects/page.tsx` now wraps with only a
 * fetch-and-`useState` shell (mirrors `app/library/page.tsx`'s existing
 * `loadAll` shape). Rendered via `react-dom/server`'s `renderToStaticMarkup`
 * — same no-jsdom, no-`@testing-library` precedent as
 * `./library-card-render.test.ts` / `./run-panel-render.test.ts` (see either
 * file's header for the full rationale): react/react-dom are already forge-ui
 * deps, and `useEffect`/data-fetching don't run under `renderToStaticMarkup`
 * anyway — which is exactly why the fetch-owning wrapper page is kept out of
 * this file and only the pure body is pinned here.
 *
 * RUN: npx vitest run lib/projects-index-render.test.ts   (from forge-ui/)
 */
import { test, expect, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// `ProjectsIndexBody` renders `<StudioPage>`, which always renders
// `<StudioNav>` — `StudioNav` calls `usePathname()` (next/navigation),
// which is `null` outside a mounted Next.js app router (as under bare
// `renderToStaticMarkup`) and crashes `pathname.startsWith(...)`. Mocked to
// a fixed pathname — the same "next/navigation mocked with a working
// usePathname" precedent spiked in
// `./knowledge-page-kb-maintenance.test.ts`'s header comment (634 bytes of
// real nav-chrome rendered clean under that mock). `next/link`'s `Link`
// (used both by StudioNav and `ProjectCard`) needs no such mock —
// `./library-card-render.test.ts` already renders it unmocked.
vi.mock('next/navigation', () => ({
  usePathname: () => '/projects',
}));

import { ProjectsIndexBody } from '@/components/studio/ProjectsIndex';
import type { Project, Kb } from './studio-client.ts';

function makeProject(overrides: Partial<Project> & { id: string }): Project {
  return { id: overrides.id, name: overrides.id, skills: [], ...overrides };
}

// ---- data-page attr — always present, whether or not the first fetch has
// ---- settled (the loading state must still identify the route). ----------

test('data-page="projects-index" is present before the first fetch settles (ready=false)', () => {
  const html = renderToStaticMarkup(React.createElement(ProjectsIndexBody, { projects: [], kbs: [], ready: false }));
  expect(html).toContain('data-page="projects-index"');
});

test('data-page="projects-index" is present once ready, alongside data-page-ready="true"', () => {
  const html = renderToStaticMarkup(React.createElement(ProjectsIndexBody, { projects: [makeProject({ id: 'p1' })], kbs: [], ready: true }));
  expect(html).toContain('data-page="projects-index"');
  expect(html).toContain('data-page-ready="true"');
});

// ---- N-project grid: every registered project renders its own card, ------
// ---- linking to ITS OWN editor — never just the first one. ----------------

test('N-project grid: every project renders its own ProjectCard, each linking to its own /projects/<id>', () => {
  const projects = [
    makeProject({ id: 'p1', name: 'P One' }),
    makeProject({ id: 'p2', name: 'P Two' }),
    makeProject({ id: 'p3', name: 'P Three' }),
  ];
  const html = renderToStaticMarkup(React.createElement(ProjectsIndexBody, { projects, kbs: [], ready: true }));
  expect(html).toContain('data-card-id="p1"');
  expect(html).toContain('data-card-id="p2"');
  expect(html).toContain('data-card-id="p3"');
  expect(html).toContain('href="/projects/p1"');
  expect(html).toContain('href="/projects/p2"');
  expect(html).toContain('href="/projects/p3"');
  expect((html.match(/data-card-type="project"/g) ?? []).length).toBe(3);
  // A real roster must never ALSO render the zero-state dead end.
  expect(html).not.toContain('data-section="projects-empty"');
});

// ---- zero-state: never terminal text — always the onboard + greenfield ---
// ---- CTAs, and only once the roster is honestly known to be empty. -------

test('zero-state (ready, no projects): renders the onboard + greenfield CTAs, both targeting /projects/new — never terminal text', () => {
  const html = renderToStaticMarkup(React.createElement(ProjectsIndexBody, { projects: [], kbs: [], ready: true }));
  expect(html).toContain('data-section="projects-empty"');
  expect(html).toContain('data-action="onboard-project-cta"');
  expect(html).toContain('data-action="create-project-cta"');
  expect(html).toContain('href="/projects/new"');
  // The old shim's dead-end copy must be gone.
  expect(html).not.toContain('No projects registered.');
});

test('loading (not ready) + no projects yet does NOT show the zero-state — avoids a false "no projects" flash before the first fetch resolves', () => {
  const html = renderToStaticMarkup(React.createElement(ProjectsIndexBody, { projects: [], kbs: [], ready: false }));
  expect(html).not.toContain('data-section="projects-empty"');
});

// ---- the persistent header CTA — present regardless of roster size -------

test('the persistent "Onboard a project" CTA is present even with projects already registered, and always targets /projects/new', () => {
  const projects = [makeProject({ id: 'p1' })];
  const html = renderToStaticMarkup(React.createElement(ProjectsIndexBody, { projects, kbs: [], ready: true }));
  expect(html).toContain('data-action="onboard-project-cta"');
  expect(html).toContain('href="/projects/new"');
});
