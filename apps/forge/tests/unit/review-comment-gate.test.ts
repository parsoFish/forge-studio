/**
 * forge-mfv5.1.28 — a blocking verdict-gate comment's runnable inline command
 * becomes its criterion's WHEN and the fix work item's gate; a GWT-shaped body
 * becomes the criterion itself. Provenance: gitweave I1 round 2, where the
 * operator's real GWT and `python3 -m pytest tests/` both landed inside the
 * generic THEN and the compiled WI-7 fell back to the vacuous project gate.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { ReviewComment } from '@forge/flows';
import { deriveVerdictWithGates, commentGateExtraction } from '../../review-comment-gate.ts';

const comment = (body: string, over: Partial<ReviewComment> = {}): ReviewComment => ({
  id: 'C-1', region: 'ac-2', body, blocking: true, resolved: false, at: '2026-10-10T00:00:00.000Z', ...over,
});

test('a runnable inline command becomes the WHEN-command and the gate', () => {
  const v = deriveVerdictWithGates([comment('AC2 is not met — `python3 -m pytest tests/` still fails on two deselected tests')]);
  assert.equal(v.kind, 'send-back');
  if (v.kind !== 'send-back') return;
  assert.deepEqual(v.acceptanceCriteria, [{
    given: 'the demo region "ac-2"',
    when: 'the operator runs `python3 -m pytest tests/`',
    then: 'AC2 is not met — `python3 -m pytest tests/` still fails on two deselected tests',
  }]);
  assert.deepEqual(v.qualityGateCmd, ['python3', '-m', 'pytest', 'tests/']);
  assert.deepEqual(commentGateExtraction(comment('x `python3 -m pytest tests/`')), { ok: true, commentId: 'C-1', cmd: ['python3', '-m', 'pytest', 'tests/'] });
});

test('a GWT-shaped body is parsed into given/when/then, case-insensitive, lines or clauses', () => {
  const lines = deriveVerdictWithGates([comment('GIVEN the pruned tree\nWHEN `python3 -m pytest tests/` runs\nTHEN zero tests fail')]);
  assert.ok(lines.kind === 'send-back');
  assert.deepEqual(lines.acceptanceCriteria, [{ given: 'the pruned tree', when: '`python3 -m pytest tests/` runs', then: 'zero tests fail' }]);
  assert.deepEqual(lines.qualityGateCmd, ['python3', '-m', 'pytest', 'tests/']);
  const clauses = deriveVerdictWithGates([comment('given the archive branch, when it is listed, then its tip equals main')]);
  assert.ok(clauses.kind === 'send-back');
  assert.deepEqual(clauses.acceptanceCriteria, [{ given: 'the archive branch', when: 'it is listed', then: 'its tip equals main' }]);
  assert.equal(clauses.qualityGateCmd, undefined, 'no runnable span → no gate; the project gate stays the fallback');
});

test('a pipeline in backticks is refused by name — the fallback is kept and the criterion keeps today\'s shape', () => {
  const body = 'run `pytest tests/ | tee out.txt` and read it';
  const v = deriveVerdictWithGates([comment(body)]);
  assert.ok(v.kind === 'send-back');
  assert.equal(v.qualityGateCmd, undefined);
  assert.deepEqual(v.acceptanceCriteria, [{ given: 'the demo region "ac-2"', when: 'the operator reviews the change', then: body }]);
  const x = commentGateExtraction(comment(body));
  assert.ok(x && !x.ok);
  assert.equal(x.cmd, 'pytest tests/ | tee out.txt');
  assert.match(x.reason, /pipeline|chain/);
});

test('backticks with no runner keep today\'s shape unchanged, with no extraction', () => {
  const body = 'the branch `archive/april-2026` is missing';
  const v = deriveVerdictWithGates([comment(body)]);
  assert.ok(v.kind === 'send-back');
  assert.deepEqual(v.acceptanceCriteria, [{ given: 'the demo region "ac-2"', when: 'the operator reviews the change', then: body }]);
  assert.equal(v.qualityGateCmd, undefined);
  assert.equal(commentGateExtraction(comment(body)), null);
});

test('the FIRST blocker with a valid command supplies the gate; an explicit ac is kept verbatim', () => {
  const ac = { given: 'g', when: 'w', then: 't' };
  const v = deriveVerdictWithGates([
    comment('prose only', { id: 'C-1' }),
    comment('see `go test ./...`', { id: 'C-2', ac }),
    comment('and `npm test`', { id: 'C-3' }),
    comment('resolved `cargo test`', { id: 'C-4', resolved: true }),
  ]);
  assert.ok(v.kind === 'send-back');
  assert.deepEqual(v.acceptanceCriteria[1], ac);
  assert.deepEqual(v.qualityGateCmd, ['go', 'test', './...']);
  assert.equal(v.acceptanceCriteria.length, 3);
});

test('no blocking, unresolved comment → approve, exactly as before', () => {
  assert.deepEqual(deriveVerdictWithGates([comment('`pytest`', { blocking: false })]), { kind: 'approve' });
});
