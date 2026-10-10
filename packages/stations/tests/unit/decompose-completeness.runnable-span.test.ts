/**
 * forge-mfv5.1.28 — `firstRunnableSpan`: D-47's runnable-command detection,
 * exported so a verdict-gate review comment's inline command becomes the fix
 * work item's gate (apps/forge/review-comment-gate.ts). The span text is the
 * gitweave I1 round-2 comment's real command.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { firstRunnableSpan } from '../../phases/decompose-completeness.ts';

test('the first inline-code span led by a test runner is returned verbatim', () => {
  assert.equal(firstRunnableSpan('AC2 is not met: `python3 -m pytest tests/` fails on main'), 'python3 -m pytest tests/');
});

test('a non-runner span before it is skipped — the FIRST RUNNABLE span wins', () => {
  assert.equal(firstRunnableSpan('edit `tests/conftest.py`, then `pytest -q tests/` and `go test ./...`'), 'pytest -q tests/');
});

test('no span led by a runner → null (prose and non-runner spans stay prose)', () => {
  assert.equal(firstRunnableSpan('the archive branch `archive/april-2026` is missing'), null);
  assert.equal(firstRunnableSpan('plain prose with no code at all'), null);
});

test('the runner is matched as WHOLE tokens — `pytestx` is not `pytest`', () => {
  assert.equal(firstRunnableSpan('run `pytestx tests/`'), null);
});
