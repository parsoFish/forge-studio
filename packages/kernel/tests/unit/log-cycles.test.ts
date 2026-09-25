/**
 * forge-6gv.8.1 — `composeSafeRunId`: compose `prefix + id` and re-validate
 * the RESULT against `isSafeRunId`, so a caller never has to trust a
 * concatenation to inherit its parts' safety by construction alone (the
 * same discipline `bridge-agents-slug.ts` already applies by hand to its
 * own composed `_agent-<slug>-<stamp>` ids).
 *
 * WHAT EACH TEST KILLS:
 *  - "a safe prefix + safe id composes and validates" kills a version that
 *    always returns null, or that never actually composes the two halves.
 *  - "an id carrying a traversal segment is refused" kills a version that
 *    checks only the prefix, or only the id, instead of the COMPOSED whole.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { composeSafeRunId, isSafeRunId } from '../../log-cycles.ts';

describe('composeSafeRunId', () => {
  it('a safe prefix + a safe id composes into a string that IS the concatenation, and is itself safe', () => {
    const result = composeSafeRunId('_hook-test-fire-', 'my-hook');
    assert.equal(result, '_hook-test-fire-my-hook');
    assert.equal(isSafeRunId(result as string), true);
  });

  it('an id carrying ".." is refused (null), even though the prefix alone is safe', () => {
    assert.equal(composeSafeRunId('_hook-test-fire-', '../../etc'), null);
  });

  it('an id carrying a "/" is refused (null)', () => {
    assert.equal(composeSafeRunId('_hook-test-fire-', 'a/b'), null);
  });
});
