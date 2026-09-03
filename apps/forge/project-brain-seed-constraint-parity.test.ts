/**
 * A two-package oracle, living where both packages are legal to import.
 *
 * `seedProjectBrain` (`@forge/knowledge`) writes a `profile.md` carrying a
 * DOCUMENTED `forge:constraint` example, and `loadProjectConstraintBlocks`
 * (`@forge/projects`) is the real parser the work-item compiler uses. The
 * assertion is that the shipped example is INERT: it parses to zero live
 * blocks, or every fresh project would silently inject a phantom example
 * constraint into every work item.
 *
 * It moved out of `packages/knowledge/tests/unit/project-brain-seed.test.ts`
 * (M4-knowledge s5). `knowledge` and `projects` are both rank 2 and the
 * allow-graph forbids siblings importing each other in either direction, so
 * that test could not stay — and none of the three usual answers fits:
 *
 *   - moving the parser to kernel would put a bespoke markdown-clause grammar
 *     in the one package everything depends on, against kernel's own charter;
 *   - inverting it is impossible — there is no production call site to inject
 *     into, only this test calls it;
 *   - having knowledge define its own parser would DEFEAT THE TEST, which
 *     exists precisely to prove the two packages' real outputs compose.
 *
 * `apps/forge/` is the assembly point `classify()` gives no rule at all, and
 * `apps/forge/*.test.ts` is in the root test glob. So the oracle keeps both
 * real implementations and stops being a boundary violation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { seedProjectBrain } from '@forge/knowledge/project-brain-seed.ts';
import { loadProjectConstraintBlocks } from '@forge/projects/constraint-blocks.ts';

test('seedProjectBrain: the documented forge:constraint example is inert — parses to zero live blocks (knowledge writes it, projects parses it)', () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'project-brain-seed-test-'));
  try {
    seedProjectBrain(forgeRoot, 'acme-cli', 'Acme CLI');
    // Must not throw (a malformed/unterminated live block throws loudly —
    // see constraint-blocks.ts) and must contribute no constraint blocks to
    // the compiler, or every fresh project would silently inject a phantom
    // example constraint into every work item.
    const blocks = loadProjectConstraintBlocks(forgeRoot, 'acme-cli');
    assert.deepEqual(blocks, []);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
