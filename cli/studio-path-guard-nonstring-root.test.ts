/**
 * studio-path-guard-nonstring-root.test.ts — round-2 pin from the adversarial
 * containment review of the forge-01u segment fix.
 *
 * WHAT THE REVIEW MEASURED. The segment fix's own comment justified NOT gating
 * `root` by asserting that a non-string root already fails safe, because
 * `realpathSync` throws on it. That is true of every non-string value the
 * module could plausibly receive EXCEPT one: an empty array stringifies to the
 * empty string, and `realpathSync([])` does not throw — it resolves to the
 * process working directory. The guard would then walk its segments beneath a
 * root nobody chose, and report `ok`.
 *
 * NOT WIRE-REACHABLE, and the module's CONTRACT already says `root` must be
 * trusted/config-derived: every call site in `cli/` + `orchestrator/` passes a
 * fixed or config-derived root, never a request field. This pin exists because
 * the comment made a universal claim the code did not support — in this repo an
 * over-claimed guarantee is treated as a defect — and the cheapest honest
 * resolution is to make the claim true rather than to narrow the prose.
 *
 * GREEN CONDITION: a non-string `root` produces the guard's ordinary rejection.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { resolveGuardedPath, guardedFile } from './studio-path-guard.ts';

function withRoot(fn: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'guard-nonstring-root-'));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('a non-string containment root is rejected, never resolved to somewhere else', () => {
  for (const bad of [[] as unknown, {} as unknown, 0 as unknown, null as unknown, undefined as unknown] as const) {
    const res = resolveGuardedPath(bad as unknown as string, ['anything']);
    assert.equal(
      res.ok,
      false,
      `a ${Object.prototype.toString.call(bad)} root must be rejected, got ${JSON.stringify(res)}`,
    );
  }
});

test('the guard family collapses to null for a non-string root', () => {
  for (const mode of ['read', 'write', 'readdir'] as const) {
    assert.equal(
      guardedFile([] as unknown as string, ['anything'], mode),
      null,
      `guardedFile(mode=${mode}) must return null for a non-string root`,
    );
  }
});

test('positive control: a legitimate string root still resolves (before AND after the fix)', () => {
  withRoot((root) => {
    mkdirSync(join(root, 'child'));
    const res = resolveGuardedPath(root, ['child']);
    assert.equal(res.ok, true, 'a real root with a real child must resolve ok');
  });
});
