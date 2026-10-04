/**
 * MEDIUM-4 (row 206 follow-up, forge-8vfn.8.5.56) — ONE error-end metadata
 * shape, shared by `runAgent`/`runBandAgentStandalone` (@forge/agents),
 * `runKindTurn` and `runFixTurn` (@forge/sessions): a crash reads the same
 * way everywhere. `status: 'failed'` is the marker — the existing
 * convention `endMetaIndicatesFailure` (@forge/flows) already reads — never
 * the mere presence of an `end` event.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { errorEndMetadata } from '../../logging.ts';

test('errorEndMetadata: an Error -> status "failed" + "<Class>: <message>"', () => {
  const err = new TypeError('boom');
  assert.deepEqual(errorEndMetadata(err), { status: 'failed', error: 'TypeError: boom' });
});

test('errorEndMetadata: a non-Error thrown value falls back to String(err)', () => {
  assert.deepEqual(errorEndMetadata('plain string throw'), { status: 'failed', error: 'plain string throw' });
  assert.deepEqual(errorEndMetadata(42), { status: 'failed', error: '42' });
});
