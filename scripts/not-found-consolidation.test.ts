/**
 * W7-A4 — every `[id]`-style route's unknown-id branch renders the ONE
 * shared `NotFound` (forge-ui/components/NotFound.tsx), and the app has a
 * Studio-chrome `not-found.tsx` for unmatched paths (crosscut-27, crosscut-07).
 *
 * Source-level wiring pin, in the style of ./page-shell-consolidation.test.ts:
 * the render contract itself is pinned in forge-ui/lib/not-found-render.test.ts;
 * THIS test proves each route family actually uses it (a page can only reach
 * `data-page="not-found"` through the shared component) and that the legacy
 * hand-rolled treatments the walkthrough catalogued are gone — a page that
 * keeps its own inline "not found" markup would silently re-fork the
 * contract.
 *
 * RUN: node --test --experimental-strip-types scripts/not-found-consolidation.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'forge-ui', 'app');
const SHARED = join(ROOT, 'forge-ui', 'components', 'NotFound.tsx');

/** Every route whose unknown-id branch must be the shared NotFound. */
const ID_PAGES = [
  'agents/[id]/page.tsx',
  'agents/[id]/run/[runId]/page.tsx',
  'projects/[id]/page.tsx',
  'projects/[id]/showcase/page.tsx',
  'flows/[id]/page.tsx',
  'flows/[id]/run/[runId]/page.tsx',
  'skills/[id]/page.tsx',
  'hooks/[id]/page.tsx',
  'connections/[id]/page.tsx',
  'templates/[id]/page.tsx',
  'community/[kind]/[id]/page.tsx',
  'sessions/[kind]/[sessionId]/page.tsx',
  'knowledge/page.tsx',
  'artifact/page.tsx',
];

/** Legacy hand-rolled treatments the walkthrough catalogued (crosscut-27) —
 *  each one is a page-local not-found body that must be GONE. */
const LEGACY_MARKERS: Array<[string, RegExp]> = [
  ['projects/[id]/page.tsx', /data-project-not-found/],
  ['flows/[id]/page.tsx', /not found\.\s*<\/|&rdquo; not found/],
  ['agents/[id]/page.tsx', /router\.replace\('\/agents\/new'\)/],
  ['templates/[id]/page.tsx', /No template "\{id\}"/],
  ['hooks/[id]/page.tsx', /No hook &quot;\{id\}&quot;/],
  ['connections/[id]/page.tsx', /No connection &quot;\{id\}&quot;/],
  ['community/[kind]/[id]/page.tsx', /No community item &quot;/],
  ['skills/[id]/page.tsx', /No skill "\{id\}" — neither on disk/],
];

test('the shared NotFound component exists and owns the data-page="not-found" root', () => {
  assert.ok(existsSync(SHARED), 'forge-ui/components/NotFound.tsx must exist');
  const src = readFileSync(SHARED, 'utf8');
  assert.match(src, /data-page="not-found"/);
  assert.match(src, /data-not-found-kind/);
  assert.match(src, /data-not-found-id/);
  assert.match(src, /data-action="not-found-back"/);
});

test('every [id] route family imports and renders the shared NotFound', () => {
  const missing: string[] = [];
  for (const rel of ID_PAGES) {
    const p = join(APP, rel);
    assert.ok(existsSync(p), `${rel} exists`);
    const src = readFileSync(p, 'utf8');
    if (!/from '@\/components\/NotFound'/.test(src) || !/<NotFound\b/.test(src)) missing.push(rel);
  }
  assert.deepEqual(missing, [], `pages not wired to the shared NotFound: ${missing.join(', ')}`);
});

test('the legacy hand-rolled not-found bodies are gone', () => {
  const offenders: string[] = [];
  for (const [rel, re] of LEGACY_MARKERS) {
    const src = readFileSync(join(APP, rel), 'utf8');
    if (re.test(src)) offenders.push(`${rel} still matches ${re}`);
  }
  assert.deepEqual(offenders, []);
});

test('no page outside NotFound.tsx mints its own data-page="not-found" root', () => {
  const offenders: string[] = [];
  for (const rel of ID_PAGES) {
    const src = readFileSync(join(APP, rel), 'utf8');
    if (/data-page="not-found"/.test(src)) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], 'only the shared component may render the not-found root');
});

test('app/not-found.tsx exists and renders the shared NotFound (unmatched paths keep Studio chrome)', () => {
  const p = join(APP, 'not-found.tsx');
  assert.ok(existsSync(p), 'forge-ui/app/not-found.tsx must exist');
  const src = readFileSync(p, 'utf8');
  assert.match(src, /from '@\/components\/NotFound'/);
  assert.match(src, /<NotFound\b/);
});
