/**
 * Every Studio page carries the nav (and so the emergency-halt control and the
 * halt banner) inside its `main[data-page]` (row 207, forge-8vfn.8.5.57,
 * T1 1973pr).
 *
 * The story page reader roots every read at `main[data-page]`; a nav rendered
 * as a sibling before the main is outside that root and invisible to it.
 *
 * Approach: the page set comes from the filesystem (every `page.tsx` and
 * `not-found.tsx` under app/, so a new page is covered automatically). Each
 * page's default export is rendered with `renderToStaticMarkup` — the first
 * paint, where the loading branch of a fetching page renders — and the markup
 * of every `<main data-page=...>` element is checked for
 * `data-component="studio-nav"`. A page that fetches renders several branches
 * (loading, unresolved, found); the first paint reaches one, so the branches a
 * first paint cannot reach are rendered through their own components in the
 * second block below, with the page's nav slot.
 *
 * Page modules load through an eager `import.meta.glob`, so their cold
 * transform (a big page plus its whole import graph — measured 3.4 s alone and
 * 5.0 s timed-out at 2 CPUs under load for the first page, forge-nk1y.11)
 * happens while the file is collected, which carries no timeout, instead of
 * inside each test body against the 5 s testTimeout. The glob's key set is
 * checked against the filesystem walk, so a glob that drifts from it fails.
 *
 * Allowlist: empty. `app/layout.tsx` is not a page (it renders no main) and is
 * not enumerated; every enumerated page renders a `main[data-page]`, and a page
 * that renders none fails the "renders a main[data-page]" assertion instead of
 * passing silently.
 */
/// <reference types="vite/types/importMeta.d.ts" />
import { test, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { FlowRunDetail } from '../../components/studio/FlowRunDetail.tsx';
import { RunView } from '../../components/studio/agent-builder/RunView.tsx';

const PARAMS: Record<string, string> = { id: 'x', runId: 'r1', kind: 'architect', sessionId: 's1' };
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useParams: () => PARAMS,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, refresh: () => {}, prefetch: () => {} }),
  notFound: () => { throw new Error('notFound'); },
}));
vi.mock('next/link', () => ({
  default: (p: { href: string; children?: unknown }) => React.createElement('a', { href: p.href }, p.children as never),
}));
vi.mock('@/lib/use-serve-status', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useServeStatus: () => ({ status: null, ready: true, refresh: async () => {} }),
}));

const APP_DIR = resolve(__dirname, '../../app');
const PAGE_FILES = new Set(['page.tsx', 'not-found.tsx']);
const ALLOWLIST: ReadonlyMap<string, string> = new Map();

function enumeratePages(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...enumeratePages(full));
    else if (PAGE_FILES.has(name)) out.push(full);
  }
  return out.sort();
}

/** Inner markup of each `<main ... data-page=...>` element. */
function mainsWithDataPage(html: string): string[] {
  const mains: string[] = [];
  const open = /<main\b[^>]*\bdata-page=/g;
  let m: RegExpExecArray | null;
  while ((m = open.exec(html)) !== null) {
    const end = html.indexOf('</main>', m.index);
    mains.push(end === -1 ? html.slice(m.index) : html.slice(m.index, end));
  }
  return mains;
}

const pages = enumeratePages(APP_DIR);

type PageModule = { default: React.ComponentType<{ params: typeof PARAMS }> };
const PAGE_MODULES = import.meta.glob<PageModule>(
  ['../../app/**/page.tsx', '../../app/**/not-found.tsx'],
  { eager: true },
);
const moduleFor = (file: string): PageModule | undefined =>
  PAGE_MODULES[`../../app/${relative(APP_DIR, file)}`];

test('the enumeration finds the pages', () => {
  expect(pages.length).toBeGreaterThan(30);
});

test('every enumerated page is loaded by the module glob, and nothing else is', () => {
  const globbed = Object.keys(PAGE_MODULES).map((k) => k.slice('../../app/'.length)).sort();
  expect(globbed).toEqual(pages.map((f) => relative(APP_DIR, f)));
});

for (const file of pages) {
  const rel = relative(APP_DIR, file);
  if (ALLOWLIST.has(rel)) continue;
  test(`${rel}: main[data-page] contains the studio nav`, () => {
    const mod = moduleFor(file);
    expect(mod, `${rel} is loaded by the module glob`).toBeDefined();
    const html = renderToStaticMarkup(React.createElement(mod!.default, { params: PARAMS }));
    const mains = mainsWithDataPage(html);
    expect(mains.length, `${rel} renders a main[data-page]`).toBeGreaterThan(0);
    for (const main of mains) {
      expect(main, `${rel}: nav must sit inside main[data-page]`).toContain('data-component="studio-nav"');
    }
  });
}

// A fetching page paints one branch first; the resolved branches render
// through these views, which place the page's `nav` as the first child of
// their `main[data-page]` (found and not-found alike).
const NAV = React.createElement('nav', { 'data-component': 'studio-nav' });
const FINDINGS = { doc: null, failed: false };

test('FlowRunDetail renders the nav slot inside main[data-page="flow-run"]', () => {
  for (const found of [true, false]) {
    const html = renderToStaticMarkup(React.createElement(FlowRunDetail, {
      nav: NAV, runId: 'r1', found, flow: null, run: null, rows: [], findings: FINDINGS,
    }));
    const mains = mainsWithDataPage(html);
    expect(mains).toHaveLength(1);
    expect(mains[0]).toContain('data-component="studio-nav"');
  }
});

test('RunView renders the nav slot inside main[data-page="agent-run"]', () => {
  for (const found of [true, false]) {
    const html = renderToStaticMarkup(React.createElement(RunView, {
      nav: NAV, runId: 'r1', found, state: 'complete', costUsd: 0, lines: [], materials: [], outputRefs: [],
    } as never));
    const mains = mainsWithDataPage(html);
    expect(mains).toHaveLength(1);
    expect(mains[0]).toContain('data-component="studio-nav"');
  }
});
