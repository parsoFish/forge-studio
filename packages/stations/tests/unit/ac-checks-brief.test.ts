/**
 * forge-mfv5.1.55 row 2 — the checks' brief is bounded: every unsatisfied check
 * is named whatever its output size, the tails share CHECKS_BRIEF_MAX, and a
 * cut tail names the cap. Pure: composes from in-memory runs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CHECKS_BRIEF_MAX, composeAcChecksVerdict } from '../../phases/ac-checks-brief.ts';
import type { AcCheckRun } from '../../phases/wi-quality-gate.ts';

const run = (label: string, satisfied: boolean, out: string, extra: Partial<AcCheckRun['info']> = {}): AcCheckRun => ({
  label, expect: 'pass', satisfied,
  info: { passed: satisfied, exitCode: satisfied ? 0 : 1, durationMs: 5, stdoutTail: out, stderrTail: out, command: `[${label} expect pass] pytest -k ${label}`, ac: { label, expect: 'pass' }, ...extra },
});

test('20 unsatisfied checks with 4 KB streams: the brief stays within CHECKS_BRIEF_MAX, names all 20, each keeps its LAST bytes, and the cap is named', () => {
  const runs = Array.from({ length: 20 }, (_, i) => run(`SB${i}`, false, `${'x'.repeat(4000)}TAIL_${i}`));
  const v = composeAcChecksVerdict(runs, 3);
  assert.equal(v.passed, false);
  assert.equal(v.iteration, 3);
  const size = Buffer.byteLength(v.stderrTail, 'utf8');
  assert.ok(size <= CHECKS_BRIEF_MAX, `brief ${size} bytes > ${CHECKS_BRIEF_MAX}`);
  for (let i = 0; i < 20; i++) {
    assert.match(v.stderrTail, new RegExp(`=== SB${i} \\(expect pass\\) — exit 1`));
    assert.ok(v.stderrTail.includes(`TAIL_${i}`), `SB${i} keeps the end of its output`);
  }
  assert.match(v.stderrTail, /last \d+ of 4006 bytes — capped/);
  assert.match(v.stderrTail, /Tails share a 16384-byte budget/);
});

test('a small output is carried whole, with no cap line', () => {
  const v = composeAcChecksVerdict([run('AC1', false, 'short failure'), run('AC2', true, 'ok')], 1);
  assert.match(v.stderrTail, /short failure/);
  assert.doesNotMatch(v.stderrTail, /bytes — capped\)/);
  assert.doesNotMatch(v.stderrTail, /=== AC2/);
  assert.match(v.command, /1 of 2 acceptance checks unsatisfied: AC1/);
});

test('verdict flags: all satisfied → pass with an empty body; only errored/timed-out unsatisfied → errored/timedOut; a fixable failure → neither', () => {
  const ok = composeAcChecksVerdict([run('A', true, '')], 1);
  assert.deepEqual([ok.passed, ok.exitCode, ok.stderrTail, ok.errored, ok.timedOut], [true, 0, '', undefined, undefined]);
  const err = run('E', false, '', { errored: true, exitCode: -5, rejectReason: 'live-env-missing' });
  const slow = run('T', false, '', { timedOut: true, exitCode: -6, rejectReason: 'gate-timeout' });
  assert.equal(composeAcChecksVerdict([err], 1).errored, true);
  assert.equal(composeAcChecksVerdict([err, slow], 1).timedOut, true);
  const mixed = composeAcChecksVerdict([err, run('F', false, 'boom')], 1);
  assert.deepEqual([mixed.errored, mixed.timedOut, mixed.exitCode], [undefined, undefined, 1]);
  assert.match(mixed.stderrTail, /=== E \(expect pass\) — ERRORED \(live-env-missing\) — the check could not run; reported, never a pass/);
});

test('the budget is UTF-8 bytes: multi-byte output stays within CHECKS_BRIEF_MAX and no character is split', () => {
  const runs = Array.from({ length: 10 }, (_, i) => run(`U${i}`, false, `${'日'.repeat(4096)}末${i}`));
  const v = composeAcChecksVerdict(runs, 1);
  const size = Buffer.byteLength(v.stderrTail, 'utf8');
  assert.ok(size <= CHECKS_BRIEF_MAX, `brief ${size} bytes > ${CHECKS_BRIEF_MAX}`);
  assert.doesNotMatch(v.stderrTail, /\uFFFD/, 'no split character');
  for (let i = 0; i < 10; i++) assert.ok(v.stderrTail.includes(`末${i}`), `U${i} keeps the end of its output`);
});
