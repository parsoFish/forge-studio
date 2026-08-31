/**
 * Structural teeth for R3-04's negative acceptance criterion ("no
 * create/edit UI for this category anywhere", D1 of `_wave5/specs/R3-04.md`)
 * — T2-mandated (round 2, item 6). `cli/bridge-studio-connections.test.ts`'s
 * bridge-refusal tests prove the ROUTE never accepts a mutating request;
 * that is necessary but not sufficient — nothing stopped a future PR from
 * adding a `apps/studio/app/connections/new/page.tsx` that POSTs somewhere
 * else entirely, or a client helper nobody ever wired to a route. These
 * checks are the only enforcement of this AC that survives someone adding a
 * page/function later without also adding a route for it.
 *
 * Three checks, each independent:
 *   1. No authoring PAGE exists on disk at all (a pure fs check — true
 *      TODAY, before any of R3-04 lands, and must stay true forever).
 *   2. `cli/bridge-studio-connections.ts` exports no write-verb-named
 *      function (dynamic import, so a not-yet-existing module fails ONLY
 *      this one test, not the whole file — mirrors
 *      `validate.test.ts`'s `import * as` namespace-import technique, one
 *      level further: a dynamic `await import()` inside the test body keeps
 *      the failure local even when the entire module is missing, which a
 *      static namespace import at file scope cannot do for a module that
 *      does not exist at all).
 *   3. `apps/studio/lib/connection-client.ts` exports no write-verb-named
 *      function either — same technique.
 *
 * "Write verb" = create/update/delete/save/write/edit/author (case
 * insensitive). `install`/`probe` are DELIBERATELY excluded — D1 explicitly
 * permits exactly those two mutating actions (they act on the environment,
 * never on a definition).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

const WRITE_VERB_RE = /create|update|delete|save|write|edit|author/i;

function assertNoWriteExports(moduleExports: Record<string, unknown>, moduleLabel: string): void {
  const hits = Object.keys(moduleExports).filter((name) => WRITE_VERB_RE.test(name));
  assert.deepEqual(
    hits,
    [],
    `${moduleLabel} must export NO create/update/delete/save/write/edit/author-named function — a connection is registry-sourced (catalog.yaml, a PR not a UI action); found: ${JSON.stringify(hits)}`,
  );
}

// ---------------------------------------------------------------------------
// 1. No authoring page exists on disk — true today, must stay true forever.
// ---------------------------------------------------------------------------

test('no apps/studio/app/connections/new/ authoring page exists on disk', () => {
  assert.equal(existsSync(resolve(REPO_ROOT, 'apps', 'studio', 'app', 'connections', 'new')), false);
});

test('no apps/studio/app/connections/[id]/edit/ authoring page exists on disk', () => {
  assert.equal(existsSync(resolve(REPO_ROOT, 'apps', 'studio', 'app', 'connections', '[id]', 'edit')), false);
});

// ---------------------------------------------------------------------------
// 2. cli/bridge-studio-connections.ts's own export surface — dynamic import
//    so a not-yet-existing module fails ONLY this one test.
// ---------------------------------------------------------------------------

test('cli/bridge-studio-connections.ts exports no write handler (dynamic import — RED via module-not-found until WI-4 lands)', async () => {
  const mod = (await import('./bridge-studio-connections.ts')) as unknown as Record<string, unknown>;
  assertNoWriteExports(mod, 'cli/bridge-studio-connections.ts');
});

// ---------------------------------------------------------------------------
// 3. apps/studio/lib/connection-client.ts's own export surface — same
//    technique, one directory over.
// ---------------------------------------------------------------------------

test('apps/studio/lib/connection-client.ts exports no create/update/delete/save/write function (dynamic import — RED via module-not-found until WI-4 lands)', async () => {
  const mod = (await import('../../apps/studio/lib/connection-client.ts')) as unknown as Record<string, unknown>;
  assertNoWriteExports(mod, 'apps/studio/lib/connection-client.ts');
});
