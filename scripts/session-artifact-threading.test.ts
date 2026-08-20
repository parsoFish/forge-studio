/**
 * Acceptance test — W7-B1 (sessions-kinds-07, S1): the generic session
 * page's artifact pane is wired for real.
 *
 * THE DEFECT: `/sessions/demo/<sid>` rendered
 * `<SessionArtifactPane artifact activeStage/>` ONLY — `project`,
 * `sessionId` and `onFinalizeGeneration` were never threaded, even though
 * the pane's own props already accept and forward all three into
 * `GenerationGallery`. Result: on the DEDICATED demo-session screen the
 * demo itself could not be opened (canView needs project+sessionId) and
 * "Finalize this generation" was permanently disabled ("Not available from
 * this view") — the whole deliverable unreachable from its own page.
 *
 * Source-level pin (same technique as `home-no-new-polling.test.ts` /
 * `not-found-consolidation.test.ts`): the page component is a hook-heavy
 * client page with two poll loops — a renderToStaticMarkup harness would
 * need the whole bridge mocked, so the wiring is pinned structurally
 * instead: the ONE `<SessionArtifactPane` call site must thread the three
 * props. The pane/gallery BEHAVIOUR for present-vs-absent props is already
 * render-tested (`session-artifact-view.test.ts` et al.); what was missing
 * was only this call site.
 *
 * RUN: node --test --experimental-strip-types scripts/session-artifact-threading.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = join(ROOT, 'forge-ui', 'app', 'sessions', '[kind]', '[sessionId]', 'page.tsx');

function paneCallSite(src: string): string {
  const i = src.indexOf('<SessionArtifactPane');
  assert.ok(i !== -1, 'the session page must render <SessionArtifactPane');
  const end = src.indexOf('/>', i);
  assert.ok(end !== -1, 'the <SessionArtifactPane …/> call site must be self-closing');
  return src.slice(i, end);
}

test('W7-B1 (sessions-kinds-07): the session page threads project + sessionId into SessionArtifactPane, so generation "view →" links resolve on the session screen', () => {
  const site = paneCallSite(readFileSync(PAGE, 'utf8'));
  assert.ok(/\bproject=/.test(site), 'SessionArtifactPane must receive project= (canView needs it)');
  assert.ok(/\bsessionId=/.test(site), 'SessionArtifactPane must receive sessionId= (canView needs it)');
});

test('W7-B1 (sessions-kinds-07): the session page wires onFinalizeGeneration — "Finalize this generation" must not be permanently disabled on the demo session\'s own page', () => {
  const src = readFileSync(PAGE, 'utf8');
  const site = paneCallSite(src);
  assert.ok(/\bonFinalizeGeneration=/.test(site), 'SessionArtifactPane must receive onFinalizeGeneration=');
  assert.ok(src.includes('demoBuilderLock'), 'the finalize handler must post through the existing demoBuilderLock client — never a bespoke endpoint');
});
