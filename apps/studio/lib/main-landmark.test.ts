/**
 * W7-C3 review (A-H1 / A-H2 / A-H3, park-point C3-PP-1) — the skip link's
 * target is DECLARED in the markup, never stamped at runtime.
 *
 * The shipped version regex-grepped `SkipLink.tsx`'s SOURCE for a
 * `setAttribute('id', …)` call, which is why it stayed green through three
 * separate breakages of the thing it claimed to pin. These tests assert the
 * RENDERED output instead — the shells really do emit
 * `<main id="main-content">` — plus one enumeration that fails when any new
 * `<main>` lands without the declaration.
 *
 * RUN: cd forge-ui && npx vitest run lib/main-landmark.test.ts
 */
import { test, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { MAIN_CONTENT_ID } from './main-landmark';

// The nav reads the active pillar from the router; nothing else in these
// shells touches Next runtime context.
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

const ROOT = resolve(__dirname, '..');

/** Every .tsx under app/ + components/ (the whole rendered surface). */
function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...tsxFiles(p));
    else if (entry.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/**
 * Opening `<main` tags that are real JSX — the token is the first thing on
 * its line. Prose mentions of `<main>` inside a docstring or a `//` comment
 * sit after a `*` or `//`, so they never match.
 */
const JSX_MAIN_RE = /^[ \t]*<main\b/gm;

test('A-H2/A-H3: the shared shells RENDER <main id="main-content"> — the id is in the markup, not an effect', async () => {
  const { StudioPage } = await import('../components/StudioPage');
  const { NotFound } = await import('../components/NotFound');
  const { StudioArchitectShell } = await import('../components/StudioArchitectShell');
  const shells: Array<[string, string]> = [
    ['StudioPage', renderToStaticMarkup(createElement(StudioPage, { dataPage: 'x', title: 'X' }))],
    ['NotFound', renderToStaticMarkup(createElement(NotFound, { kind: 'skill', id: 'x', backHref: '/skills', backLabel: 'Skills' }))],
    ['StudioArchitectShell', renderToStaticMarkup(createElement(StudioArchitectShell, { dataPage: 'x', ready: true, title: 'X', children: null }))],
  ];
  for (const [name, html] of shells) {
    expect(html, `${name} must render a <main> landmark`).toMatch(/<main[^>]*>/);
    expect(html, `${name}'s <main> must DECLARE id="${MAIN_CONTENT_ID}"`)
      .toMatch(new RegExp(`<main[^>]*\\bid="${MAIN_CONTENT_ID}"`));
  }
});

test('A-H3: the skip link points at that same declared id and stamps nothing', async () => {
  const { SkipLink } = await import('../components/SkipLink');
  const html = renderToStaticMarkup(createElement(SkipLink));
  expect(html).toMatch(new RegExp(`href="#${MAIN_CONTENT_ID}"`));
  const src = readFileSync(resolve(ROOT, 'components/SkipLink.tsx'), 'utf8');
  expect(src, 'the target must be ONE constant shared with the markup, not a second literal')
    .toMatch(/MAIN_CONTENT_ID/);
  expect(src, 'the id must never be written at runtime — that is what clobbered #col-center and died on a <main> swap')
    .not.toMatch(/setAttribute\(\s*'id'/);
});

test('A-H1/A-H2: EVERY <main> in the app declares the id (enumerated — a new one without it fails here)', () => {
  const offenders: string[] = [];
  let mains = 0;
  for (const file of [...tsxFiles(join(ROOT, 'app')), ...tsxFiles(join(ROOT, 'components'))]) {
    const src = readFileSync(file, 'utf8');
    const matches = [...src.matchAll(JSX_MAIN_RE)];
    if (matches.length === 0) continue;
    mains += matches.length;
    for (const m of matches) {
      // The attribute list runs from `<main` to the tag's closing `>`.
      const openEnd = src.indexOf('>', m.index!);
      const tag = src.slice(m.index!, openEnd);
      if (!tag.includes('id={MAIN_CONTENT_ID}')) {
        offenders.push(`${relative(ROOT, file)}:${src.slice(0, m.index!).split('\n').length}`);
      }
    }
  }
  expect(mains, 'the enumeration must actually find the <main> landmarks').toBeGreaterThan(15);
  expect(offenders, `these <main> landmarks do not declare id={MAIN_CONTENT_ID}: ${offenders.join(', ')}`).toEqual([]);
});

test('A-H1: the agent builder roots its [data-page] on the <main>, not a <div> wrapping one', () => {
  const src = readFileSync(resolve(ROOT, 'app/agents/[id]/page.tsx'), 'utf8');
  // The route root carries data-page="agents"; deadpaths asserts that element
  // IS the landmark (rootTag === 'MAIN' + the skip fragment resolves to it).
  const rootIdx = src.indexOf('data-page="agents"');
  expect(rootIdx, 'the agent builder must still declare data-page="agents"').toBeGreaterThan(-1);
  const openTag = src.lastIndexOf('<', rootIdx);
  expect(src.slice(openTag, openTag + 5), 'the [data-page] root must be the <main> landmark').toBe('<main');
  expect(src, 'the centre column keeps its own id — the landmark must not steal it')
    .toMatch(/id="col-center"/);
});
