/**
 * W7-C3 review (A-H4) — "every route has a <title>" / "Breadcrumbs on every
 * detail page" stop being claims in a doc and become an ENUMERATION.
 *
 * Both quantifiers shipped false: seven routes had no per-route title at all
 * (so `document.title` stayed the bare product name) and the same seven had
 * no breadcrumb. Nothing could have caught it — `document-title.test.ts`
 * pins the two shared shells by source, and the harness that would have seen
 * the rest is not in CI. This test walks EVERY `app/**\/page.tsx`, resolves
 * the chrome each route actually reaches through its own imports, and fails
 * when a new route lands without it.
 *
 * Deliberately structural, not clever: it follows local component imports up
 * to a small depth and looks for the marker each contract needs. Two things
 * it will NOT credit, because both fail open:
 *   - `StudioPage` as a breadcrumb provider (it renders one only when the
 *     caller passes `breadcrumbs=`), and
 *   - `StudioPage` as a title provider when the caller passes neither
 *     `docTitle=` nor a plain-string `title="…"` (the hook then formats an
 *     empty part list straight back to the bare product name).
 *
 * RUN: cd forge-ui && npx vitest run lib/route-chrome.test.ts
 */
import { test, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';

const ROOT = resolve(__dirname, '..');

function pageFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) pageFiles(p, out);
    else if (entry === 'page.tsx') out.push(p);
  }
  return out;
}

/** `/projects/[id]/showcase` from `app/projects/[id]/showcase/page.tsx`. */
function routePathOf(file: string): string {
  const rel = relative(join(ROOT, 'app'), file).replace(/\/page\.tsx$/, '');
  return '/' + (rel === 'page.tsx' ? '' : rel);
}

/** Local (in-repo) module specifiers this file imports, resolved to .tsx/.ts. */
function localImports(file: string, src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/from\s+'([^']+)'/g)) {
    const spec = m[1];
    let base: string | null = null;
    if (spec.startsWith('@/')) base = join(ROOT, spec.slice(2));
    else if (spec.startsWith('./') || spec.startsWith('../')) base = resolve(dirname(file), spec);
    if (!base) continue;
    for (const ext of ['.tsx', '.ts']) {
      if (existsSync(base + ext)) { out.push(base + ext); break; }
    }
  }
  return out;
}

/**
 * Does `file` reach `marker` through its own local imports (depth-limited)?
 * `skip` drops providers that only fail open (see the header).
 */
function reaches(file: string, marker: RegExp, skip: readonly string[] = [], depth = 4, seen = new Set<string>()): boolean {
  if (depth < 0 || seen.has(file) || !existsSync(file)) return false;
  seen.add(file);
  const src = readFileSync(file, 'utf8');
  if (marker.test(src)) return true;
  for (const dep of localImports(file, src)) {
    if (skip.some((s) => dep.endsWith(s))) continue;
    if (reaches(dep, marker, skip, depth - 1, seen)) return true;
  }
  return false;
}

const ROUTES = pageFiles(join(ROOT, 'app')).sort();

test('the enumeration actually finds the route set', () => {
  expect(ROUTES.length).toBeGreaterThanOrEqual(30);
});

test('A-H4: EVERY route sets its own document title (a new one without it fails here)', () => {
  const bare: string[] = [];
  for (const file of ROUTES) {
    const src = readFileSync(file, 'utf8');
    // A route that renders StudioPage inherits the title ONLY when it hands
    // the shell something to build one from.
    // `^\s*<StudioPage` — the JSX element, never a prose mention of the
    // shell inside a comment (which is all `app/library/page.tsx` carries).
    const viaShell = /^\s*<StudioPage\b/m.test(src) && !/docTitle=/.test(src) && !/\btitle="/.test(src);
    if (viaShell || !reaches(file, /useDocumentTitle\(/)) bare.push(routePathOf(file));
  }
  expect(bare, `these routes render the bare product name as their tab title: ${bare.join(', ')}`).toEqual([]);
});

test('A-H4: EVERY detail route renders a labelled breadcrumb trail', () => {
  // A detail route = one with a dynamic segment; it is reached by drilling in,
  // so it must offer the way back out.
  const detail = ROUTES.filter((f) => routePathOf(f).includes('['));
  expect(detail.length).toBeGreaterThanOrEqual(10);
  const bare: string[] = [];
  for (const file of detail) {
    const src = readFileSync(file, 'utf8');
    // The shared component, a shell that always renders one, or a route's own
    // labelled breadcrumb nav (the run pages keep a richer per-run trail).
    const marker = /<Breadcrumbs\b|aria-label="[^"]*readcrumb/;
    const ok = /breadcrumbs=\{/.test(src) || reaches(file, marker, ['components/StudioPage.tsx']);
    if (!ok) bare.push(routePathOf(file));
  }
  expect(bare, `these detail routes are dead ends — no breadcrumb, no back trail: ${bare.join(', ')}`).toEqual([]);
});

test('A-H4: the title hook runs BEFORE every early return', () => {
  // `/projects/new` returned its onboarding form from an `if (isNew)` branch
  // ABOVE the page's `useDocumentTitle` call, so that route shipped the bare
  // product name — and a hook after a conditional return is a React
  // hook-order violation the moment the branch flips without a remount.
  const offenders: string[] = [];
  for (const file of ROUTES) {
    const src = readFileSync(file, 'utf8');
    const hook = src.indexOf('useDocumentTitle(');
    if (hook < 0) continue;
    for (const m of src.matchAll(/\n  if \([^\n]*\) \{\n    return/g)) {
      if (m.index! < hook) {
        offenders.push(`${routePathOf(file)}:${src.slice(0, m.index!).split('\n').length}`);
        break;
      }
    }
  }
  expect(offenders, `useDocumentTitle sits after an early return in: ${offenders.join(', ')}`).toEqual([]);
});

test('A-H4: the ad-hoc unlabelled breadcrumb Breadcrumbs replaced is gone', () => {
  // `Breadcrumbs.tsx`'s own docstring says it replaced a "Forge Studio / …"
  // div and a "← Skills" back link. Both survived on the routes it never
  // reached; this fails if either pattern comes back.
  const offenders: string[] = [];
  for (const file of ROUTES) {
    const src = readFileSync(file, 'utf8');
    if (/&larr;\s*[A-Z]/.test(src)) offenders.push(`${routePathOf(file)} (← back link)`);
  }
  expect(offenders, `ad-hoc back links instead of the shared trail: ${offenders.join(', ')}`).toEqual([]);
});
