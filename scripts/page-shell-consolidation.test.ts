/**
 * Acceptance test — one shared page shell, proven by DELETION (R6-03-F3,
 * batch-F ruling 46).
 *
 * Immutable-gate, RED-first. The "shared page shell (not per-page copies)"
 * acceptance is met only when the per-page shell duplication is REMOVED and
 * the routes render through the single component. A shell that exists ALONGSIDE
 * the old copies is additive surface, not the refactor. So this test proves the
 * delta by ABSENCE: the exact duplicated shell-header markup must appear ZERO
 * times across `forge-ui/app/**\/page.tsx`, and exactly once in the shared
 * component that now owns it.
 *
 * Kills: a StudioPage/PageHeader added while the 9 hand-rolled header copies
 * survive (additive, not consolidated).
 *
 * RUN: node --test --experimental-strip-types scripts/page-shell-consolidation.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP_DIR = join(ROOT, 'forge-ui', 'app');
const SHARED_COMPONENT = join(ROOT, 'forge-ui', 'components', 'StudioPage.tsx');

// The exact duplicated shell-header markup (the 24/700 display-font page title)
// that was hand-copied into 9 page.tsx files at the start of R6-03-F3.
const HEADER_SIGNATURE =
  "fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--text)', margin: '0 0 6px'";

// The full shelf-shell wrap the 5 library shelves each hand-rolled.
const WRAP_SIGNATURE = "maxWidth: 1080, margin: '0 auto', padding: '32px 28px 64px', width: '100%'";

function pageFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...pageFiles(p));
    else if (entry.name === 'page.tsx') out.push(p);
  }
  return out;
}

test('the duplicated shell-header markup is GONE from every app page', () => {
  const offenders = pageFiles(APP_DIR).filter((f) => readFileSync(f, 'utf8').includes(HEADER_SIGNATURE));
  assert.deepEqual(
    offenders.map((f) => f.slice(ROOT.length + 1)),
    [],
    'per-page shell header copies must be removed (ruling 46: prove by deletion), replaced by the shared component',
  );
});

test('the shelf-shell wrap is GONE from every app page', () => {
  const offenders = pageFiles(APP_DIR).filter((f) => readFileSync(f, 'utf8').includes(WRAP_SIGNATURE));
  assert.deepEqual(
    offenders.map((f) => f.slice(ROOT.length + 1)),
    [],
    'the hand-rolled 1080px shelf wrap must be owned by the shared StudioPage, not copied per page',
  );
});

test('the shared shell component exists and owns the header markup exactly once', () => {
  assert.ok(existsSync(SHARED_COMPONENT), 'forge-ui/components/StudioPage.tsx must exist (the one shell)');
  const src = readFileSync(SHARED_COMPONENT, 'utf8');
  const count = src.split(HEADER_SIGNATURE).length - 1;
  assert.equal(count, 1, `the shared shell must own the header markup exactly once (found ${count})`);
});
