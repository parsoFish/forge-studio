/**
 * RED — forge-8vfn.8.3.4: `GenerationGallery`'s "finalize-generation" and
 * `SessionInteractivePanel`'s verdict-approve generation picker used to be
 * wired to two INDEPENDENT selection states, so they could disagree on
 * which generation an approve would lock.
 *
 * Source-level pin (same technique as `session-artifact-threading.test.ts`,
 * which this file sits beside): the session page is a hook-heavy client
 * page with two poll loops — a `renderToStaticMarkup` harness would need
 * the whole bridge mocked, so the wiring is pinned structurally instead.
 * `SessionGenerationLockOne.test.ts` (apps/studio/tests/contract/) pins the
 * RENDER-level half (both components honour a controlled selection prop);
 * this file pins that the PAGE feeds the exact same `useState` pair to
 * `SessionArtifactPane` (which threads it to `GenerationGallery`) AND to
 * BOTH `SessionInteractivePanel` call sites (the legacy-session branch and
 * the live branch) — never two differently-named state variables that
 * happen to have the same shape.
 *
 * RUN: node --test --experimental-strip-types scripts/session-generation-lock-one.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = join(ROOT, 'apps', 'studio', 'app', 'sessions', '[kind]', '[sessionId]', 'page.tsx');

/** Every self-closing `<tagOpen ... />` call site of a component, in source
 *  order — `SessionInteractivePanel` has two (legacy + live). */
function callSites(src: string, tagOpen: string): string[] {
  const sites: string[] = [];
  let i = 0;
  for (;;) {
    const start = src.indexOf(tagOpen, i);
    if (start === -1) break;
    const end = src.indexOf('/>', start);
    assert.ok(end !== -1, `${tagOpen} call site must be self-closing`);
    sites.push(src.slice(start, end));
    i = end + 2;
  }
  return sites;
}

test('forge-8vfn.8.3.4: the session page declares exactly ONE selected-generation state', () => {
  const src = readFileSync(PAGE, 'utf8');
  const declarations = src.match(/const \[selectedGeneration, setSelectedGeneration\] = useState/g) ?? [];
  assert.equal(declarations.length, 1, `expected exactly one selectedGeneration useState declaration, found ${declarations.length}`);
});

test('forge-8vfn.8.3.4: SessionArtifactPane (which feeds GenerationGallery) reads and writes the page\'s selectedGeneration state', () => {
  const src = readFileSync(PAGE, 'utf8');
  const sites = callSites(src, '<SessionArtifactPane');
  assert.equal(sites.length, 1, `expected exactly one SessionArtifactPane call site, found ${sites.length}`);
  assert.match(sites[0]!, /\bselectedGeneration=\{selectedGeneration\}/, 'SessionArtifactPane must receive selectedGeneration={selectedGeneration}');
  assert.match(sites[0]!, /\bonSelectGeneration=\{setSelectedGeneration\}/, 'SessionArtifactPane must receive onSelectGeneration={setSelectedGeneration}');
});

test('forge-8vfn.8.3.4: BOTH SessionInteractivePanel call sites (legacy + live) read and write the SAME selectedGeneration state — never a second, independently-named one', () => {
  const src = readFileSync(PAGE, 'utf8');
  const sites = callSites(src, '<SessionInteractivePanel');
  assert.equal(sites.length, 2, `expected exactly two SessionInteractivePanel call sites (legacy + live), found ${sites.length}`);
  for (const [index, site] of sites.entries()) {
    assert.match(site, /\bselectedGeneration=\{selectedGeneration\}/, `SessionInteractivePanel call site #${index} must receive selectedGeneration={selectedGeneration}`);
    assert.match(site, /\bonSelectGeneration=\{setSelectedGeneration\}/, `SessionInteractivePanel call site #${index} must receive onSelectGeneration={setSelectedGeneration}`);
  }
});
