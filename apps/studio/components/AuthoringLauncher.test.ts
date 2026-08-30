/**
 * DOM regression tests for `AuthoringLauncher.tsx` (R4-21 T3, BLOCKER-2 fix
 * — the entry point into the creation-agent authoring session, rendered from
 * `/skills/new` and `/hooks/new`).
 *
 * Mirrors `forge-ui/lib/run-panel-render.test.ts`'s own pattern: renders the
 * REAL component via `react-dom/server`'s `renderToStaticMarkup` and asserts
 * on the resulting markup string — no jsdom, no `@testing-library/react`
 * (neither is installed). `useState`/click-handler interaction does not run
 * under `renderToStaticMarkup`; this file pins the INITIAL-render DOM
 * contract only (the `data-*` hooks scripts/journeys/*.mjs will drive).
 *
 * RUN: npx vitest run components/AuthoringLauncher.test.ts   (from forge-ui/)
 */

import { test, expect, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { AuthoringLauncher } from './AuthoringLauncher';

type Props = {
  knownProjects?: string[];
  onStarted?: (sessionId: string, project: string) => void;
};

function render(props: Props = {}): string {
  return renderToStaticMarkup(React.createElement(AuthoringLauncher, props));
}

test('initial render carries the launcher section + all its field/action data-* hooks', () => {
  const html = render();
  expect(html).toContain('data-section="authoring-launcher"');
  expect(html).toContain('data-authoring-launcher-ready="false"'); // nothing typed yet
  expect(html).toContain('data-field="authoring-launcher-project"');
  expect(html).toContain('data-field="authoring-launcher-prompt"');
  expect(html).toContain('data-action="start-authoring"');
});

test('the submit button is disabled (canSubmit=false) before any field is filled in', () => {
  const html = render();
  const idx = html.indexOf('data-action="start-authoring"');
  const start = html.lastIndexOf('<', idx);
  const end = html.indexOf('>', idx);
  const tag = html.slice(start, end + 1);
  expect(tag).toContain('disabled=""');
});

test('known projects render as <option> entries in the project datalist', () => {
  const html = render({ knownProjects: ['gitpulse', 'mdtoc'] });
  expect(html).toContain('id="forge-authoring-known-projects"');
  expect(html).toContain('value="gitpulse"');
  expect(html).toContain('value="mdtoc"');
});

test('copy is honest about the project field being scratch space, not ownership — "not what this belongs to"', () => {
  const html = render();
  expect(html).toContain('not what this belongs to');
});

test('no error banner renders on initial mount (nothing submitted yet)', () => {
  const html = render();
  expect(html).not.toContain('data-authoring-launcher-error');
});

// ---------------------------------------------------------------------------
// W8-B4 WI-4 — /templates/new gets a third AuthoringLauncher consumer
// (skills/new, hooks/new were the first two). Same launcher, same
// generic `authoring` session kind — no `kind` field on the wire, the
// creation-agent's SKILL.md asks which shape (skill/hook/template) the
// operator wants (WI-3's territory, not this file's).
//
// Four pins:
//  1. /templates/new renders the AuthoringLauncher (the connected page,
//     not just the shared component in isolation).
//  2. The pre-existing hand-authoring path (category/id/content form +
//     "Create template" button) still renders alongside it — this is an
//     ADDITIONAL entry point, not a replacement.
//  3. project-scaffold is never offered through the launcher, and the
//     guard is a DERIVATION off the page's own WritableCategory/
//     CATEGORY_LABEL source of truth — not a second hard-coded list.
//  4. The full set of AuthoringLauncher consumers across forge-ui is
//     exactly {skills/new, hooks/new, templates/new} — a future
//     connections authoring page would fail this the moment it renders
//     the launcher.
// ---------------------------------------------------------------------------

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => '/templates/new',
}));

test('app/templates/new/page.tsx: the connected page mounts the AuthoringLauncher (pin 1 — an authoring session, not just the hand-authoring form)', async () => {
  const { default: TemplateBuilderPage } = await import('@/app/templates/new/page');
  const html = renderToStaticMarkup(React.createElement(TemplateBuilderPage));
  expect(html).toContain('data-section="authoring-launcher"');
  expect(html).toContain('data-action="start-authoring"');
});

test('app/templates/new/page.tsx: the pre-existing hand-authoring controls still render, disabled under the SAME initial condition as before (pin 2 — this is an additional door, not "replace the builder")', async () => {
  const { default: TemplateBuilderPage } = await import('@/app/templates/new/page');
  const html = renderToStaticMarkup(React.createElement(TemplateBuilderPage));
  expect(html).toContain('data-field="template-category"');
  expect(html).toContain('data-field="template-id"');
  expect(html).toContain('data-field="template-content"');
  const idx = html.indexOf('data-action="create-template"');
  expect(idx).toBeGreaterThan(-1);
  const start = html.lastIndexOf('<', idx);
  const end = html.indexOf('>', idx);
  const tag = html.slice(start, end + 1);
  // No id typed yet — slugOk is false, exactly the same pre-existing
  // disabled condition the hand-authoring form always had.
  expect(tag).toContain('disabled=""');
});

test('app/templates/new/page.tsx: the authoring-launcher guard derives from CATEGORY_LABEL — today it never offers project-scaffold (pin 3, half 1)', async () => {
  const { CATEGORY_LABEL, writableCategoryNames } = await import('@/lib/template-authoring-view');
  expect(Object.keys(CATEGORY_LABEL)).not.toContain('project-scaffold');
  const names = writableCategoryNames(CATEGORY_LABEL);
  expect(names).toEqual(Object.values(CATEGORY_LABEL));
  expect(names.join(' ')).not.toMatch(/project-scaffold/i);
});

test('app/templates/new/page.tsx: the derivation is generic, not a second hard-coded list — a category added to the labels map flows through automatically (pin 3, half 2)', async () => {
  const { CATEGORY_LABEL, writableCategoryNames } = await import('@/lib/template-authoring-view');
  const hypothetical: Record<string, string> = {
    ...CATEGORY_LABEL,
    'project-scaffold': 'Project scaffold (hypothetical — proves no second list filters this)',
  };
  expect(writableCategoryNames(hypothetical)).toContain(
    'Project scaffold (hypothetical — proves no second list filters this)',
  );
});

// ---- pin 4: the full enumeration of AuthoringLauncher consumers -----------

const FORGE_UI_ROOT = resolve(import.meta.dirname, '..');

/** Recursively scans a directory tree for `.tsx`/`.ts` files that actually
 *  RENDER `<AuthoringLauncher` (not merely import it) — returns paths
 *  relative to `root`, sorted. This is the generic mechanism pin 4 proves:
 *  it does not enumerate the three known consumers by name, it discovers
 *  them, so a NEW consumer (e.g. a future connections authoring page) is
 *  picked up automatically and fails the equality assertion below. */
function findAuthoringLauncherConsumers(dir: string, root: string): string[] {
  const hits: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      hits.push(...findAuthoringLauncherConsumers(p, root));
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      const src = readFileSync(p, 'utf8');
      if (/<AuthoringLauncher\b/.test(src)) hits.push(relative(root, p).split('\\').join('/'));
    }
  }
  return hits.sort();
}

test('the scanner generalizes: a synthetic future consumer (e.g. a connections authoring page) is discovered, not just the three known ones (mechanism proof for pin 4)', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'authoring-launcher-scan-'));
  try {
    mkdirSync(join(fixtureRoot, 'skills', 'new'), { recursive: true });
    mkdirSync(join(fixtureRoot, 'connections', 'new'), { recursive: true });
    writeFileSync(join(fixtureRoot, 'skills', 'new', 'page.tsx'), "<AuthoringLauncher knownProjects={[]} />");
    writeFileSync(
      join(fixtureRoot, 'connections', 'new', 'page.tsx'),
      "// a hypothetical FUTURE connections authoring page\n<AuthoringLauncher knownProjects={[]} />",
    );
    const found = findAuthoringLauncherConsumers(fixtureRoot, fixtureRoot);
    expect(found).toEqual(['connections/new/page.tsx', 'skills/new/page.tsx']);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('the REAL set of AuthoringLauncher consumers under forge-ui/app is exactly {skills/new, hooks/new, templates/new} (pin 4)', () => {
  const consumers = findAuthoringLauncherConsumers(join(FORGE_UI_ROOT, 'app'), FORGE_UI_ROOT);
  expect(consumers).toEqual(['app/hooks/new/page.tsx', 'app/skills/new/page.tsx', 'app/templates/new/page.tsx']);
});
