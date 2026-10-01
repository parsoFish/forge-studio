/**
 * Parity check — ADR 046 boundary fix (`studio-beyond-contracts` edges 1/2:
 * `apps/studio/tests/contract/SessionInteractivePanel.test.ts` used to import
 * `packages/sessions/studio/session-kinds.ts`'s `loadSessionKinds` and
 * `packages/sessions/studio/session-kinds-affordances.ts`'s
 * `deriveSessionAffordances` directly, which apps/studio tests may no longer
 * do — see `docs/roadmaps/1.0.md` §0, "apps/studio imports contracts only").
 *
 * WHAT THIS PROVES (W8-B3, sessions-kinds-06): the `authoring` session
 * kind's `awaiting-review` row genuinely declares `requires: [id]` in the
 * live, on-disk `studio/session-kinds.yaml` registry, deriving a `verdict`
 * affordance whose `meta.requires` is `['id']`. That fact used to be read
 * off the REAL registry from inside a studio DOM test — real-registry drift
 * detection was the point, catching the YAML changing under the fix without
 * a matching test update. `loadSessionKinds` does real file/YAML I/O (not a
 * pure function `@forge/contracts` could host), so per the boundary fix's
 * option 2 the studio DOM test now renders a HAND-BUILT affordance of this
 * same shape (the file's own established convention, see the community-14
 * test in that file) and this script is the one place left asserting the
 * shape against the real registry — so registry drift is still caught, just
 * from a `scripts/` node:test rather than an apps/studio vitest file.
 *
 * RUN: node --test --experimental-strip-types scripts/studio-parity-session-kinds.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadSessionKinds } from '../packages/sessions/studio/session-kinds.ts';
import { deriveSessionAffordances } from '../packages/sessions/studio/session-kinds-affordances.ts';

const FORGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('W8-B3 (sessions-kinds-06): the authoring kind\'s awaiting-review row requires an id, in the real, on-disk registry', () => {
  const descriptor = loadSessionKinds(FORGE_ROOT).find((k) => k.id === 'authoring');
  assert.ok(descriptor, 'the live registry must declare an "authoring" session kind');
  const verdict = deriveSessionAffordances(descriptor!, 'awaiting-review').find((a) => a.kind === 'verdict');
  assert.ok(verdict, 'authoring\'s awaiting-review row must derive a verdict affordance');
  assert.deepEqual(verdict!.meta?.requires ?? [], ['id']);
  // The exact shape apps/studio/tests/contract/SessionInteractivePanel.test.ts
  // hand-builds in its own "a verdict whose row DOES require an id" test —
  // kept in step here so the two never drift apart silently.
  assert.deepEqual(verdict!.meta?.verdicts, ['approve', 'revise', 'reject']);
});
