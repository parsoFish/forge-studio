/**
 * Tests for orchestrator/file-verdict.ts — fileVerdictPaths path resolution.
 * (The verdict-response parser was removed 2026-06-03: nothing read it; the UI
 * send-back re-enters via requeue, not by parsing the response file.)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import { fileVerdictPaths } from './file-verdict.ts';

test('fileVerdictPaths: resolves prompt + response paths under in-flight/', () => {
  const p = fileVerdictPaths('INIT-2026-06-03-x', '_queue');
  assert.equal(p.promptPath, resolve('_queue', 'in-flight', 'INIT-2026-06-03-x.verdict-prompt.md'));
  assert.equal(p.responsePath, resolve('_queue', 'in-flight', 'INIT-2026-06-03-x.verdict-response.md'));
});

test('fileVerdictPaths: defaults queueRoot to _queue', () => {
  const p = fileVerdictPaths('INIT-x');
  assert.match(p.responsePath, /_queue\/in-flight\/INIT-x\.verdict-response\.md$/);
});
