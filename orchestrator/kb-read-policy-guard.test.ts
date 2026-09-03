/**
 * F1 — the PRODUCTION lint over the real repo brain.
 *
 * The other eight cases in this file moved to
 * `packages/knowledge/tests/regression/kb-read-policy-guard.test.ts` with their
 * subject (M4-knowledge s5): `kbReadPolicyViolation` and the KB descriptor
 * loaders are knowledge's own, and a `orchestrator/` test importing them was a
 * `legacy-to-package` row.
 *
 * This one stays, and the reason is not incidental: it drives `runStudioLint`,
 * which imports `@forge/flows`, `@forge/sessions`, `@forge/agents`, five
 * `@forge/library` modules AND `orchestrator/studio/{registry,validate}.ts`
 * directly. No package at any rank can host that (rule 1 carries no rank
 * exception), so a test that drives it cannot live in one either.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runStudioLint } from '../cli/studio-lint.ts';

test('F1: runStudioLint over the REAL repo brain emits no read-policy error (the 4 project KBs + the real top-level KBs all pass through the production check)', () => {
  const result = runStudioLint(process.cwd());
  const readPolicyErrors = result.findings.filter((f) => f.check === 'read-policy');
  assert.deepEqual(
    readPolicyErrors,
    [],
    `the real brain must carry no read-policy violations — got: ${JSON.stringify(readPolicyErrors)}`,
  );
});

