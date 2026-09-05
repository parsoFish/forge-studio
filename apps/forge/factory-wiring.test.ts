/**
 * The one resolution seam (ADR 048 clause 2). What these pin is not that the
 * factory resolves — every other suite proves that by using it — but the two
 * things a seam gets WRONG: swallowing a real breakage as "not installed", and
 * asking the question twice and getting two answers.
 *
 * The deletability claim itself is NOT tested here. It is proven by execution
 * in `scripts/factory-deletable.mjs`, which removes the package and boots the
 * bridge; a test that merely READ the imports would be the "claimed, not
 * proven" shape ADR 048 clause 3 exists to forbid.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { NO_EXAMPLE_INSTALLED, resolveInstalledFactory, resetInstalledFactoryForTests } from './factory-wiring.ts';

test('the installed example resolves through the seam, and twice gives the SAME object (kills: a resolver that re-imports per call, so two callers could disagree about whether an example is installed)', async () => {
  resetInstalledFactoryForTests();
  const first = await resolveInstalledFactory();
  const second = await resolveInstalledFactory();
  assert.ok(first, 'the example package is installed in this checkout');
  assert.equal(first, second, 'the resolution is memoized by identity, not recomputed');
  assert.equal(typeof first.phaseWiring.executor.run, 'function');
  assert.equal(first.singleWiAllowed('code'), false);
  assert.equal(first.singleWiAllowed('docs'), true);
  assert.equal(first.singleWiAllowed('not-a-class'), null, 'an unknown class gets no opinion, never a default');
});

test('a factory that IS installed and fails to load is NOT reported as "no example installed" (kills: a catch-all that turns every future breakage in the example into silent graceful degradation)', () => {
  // Structural, and deliberately so: the discrimination lives in one predicate,
  // and the failure it guards against is a `catch { return null }`. Reading the
  // seam for that shape is the only way to assert it without breaking the
  // installed package on disk, which the destructive script does properly.
  const source = readFileSync(join(import.meta.dirname, 'factory-wiring.ts'), 'utf8');
  assert.match(source, /ERR_MODULE_NOT_FOUND/, 'absence is recognised by the module-resolution error code');
  assert.match(source, /includes\('@forge\/factory'\)/, 'and by the specifier that failed, so another package\'s absence is not mistaken for the example\'s');
  assert.match(source, /if \(!isFactoryNotInstalled\(err\)\) throw err;/, 'anything else rethrows');
});

test('the absence message names the package and the reason, so an operator is not left guessing (kills: a bare "not found")', () => {
  assert.match(NO_EXAMPLE_INSTALLED, /packages\/factory/);
  assert.match(NO_EXAMPLE_INSTALLED, /ADR 048/);
});
