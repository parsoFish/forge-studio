/**
 * The answer cap is enforced in two places that must agree: the carved
 * `/api/instructions/answer` route (this package) and the generic session
 * affordance dispatch (`cli/bridge-studio-affordances.ts`, a host arm until row
 * 37 carves). The host cannot import the package constant yet — a
 * legacy-to-package edge is an allow-graph violation — so the number is
 * duplicated for exactly as long as that dispatch stays in the host.
 *
 * A duplicated limit that drifts is worse than a shared one: the side that
 * drifts LOW silently truncates an operator's answer while the other accepts it,
 * and nothing is red. This test is the whole reason the duplication is
 * tolerable, and it deletes itself along with the duplicate when row 37 lands.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MAX_ANSWER_FIELD_BYTES } from './session-answer-limits.ts';

test('the host affordance dispatch enforces the SAME answer cap as the carved route', () => {
  const host = readFileSync(join(import.meta.dirname, '..', '..', 'cli', 'bridge-studio-affordances.ts'), 'utf8');
  const m = /export const MAX_ANSWER_FIELD_BYTES = ([^;]+);/.exec(host);
  assert.ok(m, 'cli/bridge-studio-affordances.ts no longer declares MAX_ANSWER_FIELD_BYTES — if row 37 has carved, delete this test and its duplicate');
  // eslint-disable-next-line no-eval -- a literal arithmetic expression from our own repo, read at test time
  const hostValue = Number(eval(m[1]));
  assert.equal(hostValue, MAX_ANSWER_FIELD_BYTES, 'the two copies of the answer cap have drifted');
});
