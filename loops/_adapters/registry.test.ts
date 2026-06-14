/**
 * Registry tests (M8-A): the flywheel adapters are registered and resolvable,
 * but report unavailable in CI (their dep + creds are absent). This proves the
 * runtime seam is wired without requiring any external SDK/key.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { registeredSdkIds, isSdkAvailable, getAdapter } from './registry.ts';

test('registry includes the live + flywheel adapters', () => {
  const ids = registeredSdkIds();
  for (const id of ['claude', 'example', 'gemini', 'aider']) {
    assert.ok(ids.includes(id), `registry must include "${id}"`);
  }
});

test('gemini + aider resolve via getAdapter without throwing', () => {
  assert.equal(getAdapter('gemini').id, 'gemini');
  assert.equal(getAdapter('aider').id, 'aider');
});

test('gemini + aider are unavailable in CI (dep + creds absent); claude is live', () => {
  assert.equal(isSdkAvailable('gemini'), false, 'gemini needs @google/genai + GEMINI_API_KEY');
  assert.equal(isSdkAvailable('aider'), false, 'aider needs the aider CLI + a model key');
  assert.equal(isSdkAvailable('claude'), true, 'claude is the live reference adapter');
});

test('an unregistered id is not available (boolean gate, no throw)', () => {
  assert.equal(isSdkAvailable('no-such-sdk'), false);
});
