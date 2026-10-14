/**
 * forge-mfv5.1.38 — a WI gate whose runner executed ZERO tests passed: gitweave
 * I3b's live-acceptance WIs (WI-9/11/12) printed "1 skipped in 0.01s", exit 0,
 * and were recorded `gate.pass` at iteration 1. The fixtures are those gates'
 * own stdout (copied from the I3b cycle's events.jsonl). Pure parsing — no
 * spawn (§6.16).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { judgeGateTestSummary, parseGateTestSummary } from '../../ralph/gate-test-summary.ts';

const fx = (n: string): string => readFileSync(join(import.meta.dirname, '../test-fixtures/i3b-skip-gates', n), 'utf8');

test('I3b WI-9 (pytest -q) and WI-11 (pytest verbose): 0 executed, 1 skipped', () => {
  for (const f of ['WI-9.stdout.txt', 'WI-11.stdout.txt']) {
    assert.deepEqual(parseGateTestSummary(fx(f)), { runner: 'pytest', passed: 0, failed: 0, skipped: 1, skipReasons: [] }, f);
  }
});

test('a skip-only run is a gate failure by name, with the runner\'s skip reasons', () => {
  const out = 'SKIPPED [1] tests/acceptance/test_gw_self_serve.py:14: GW_CALLER_TOKEN not set\n============ 1 skipped in 0.02s ============\n';
  const v = judgeGateTestSummary(out, { acceptance: false });
  assert.equal(v, 'gate ran 0 tests — 1 skipped (pytest): tests/acceptance/test_gw_self_serve.py:14: GW_CALLER_TOKEN not set');
});

test('the I3b WI-9 output is refused, naming that pytest printed no reasons', () => {
  assert.equal(judgeGateTestSummary(fx('WI-9.stdout.txt'), { acceptance: true }), 'gate ran 0 tests — 1 skipped (pytest): no skip reasons in the output (run pytest with -rs to print them)');
});

test('a run that executed tests is not touched, skips or not', () => {
  assert.equal(judgeGateTestSummary('..s\n2 passed, 1 skipped in 0.31s\n', { acceptance: true }), null);
  assert.deepEqual(parseGateTestSummary('== 3 passed, 1 failed, 2 skipped, 1 error in 1.0s =='), { runner: 'pytest', passed: 3, failed: 2, skipped: 2, skipReasons: [] });
});

test('vitest summaries', () => {
  assert.deepEqual(parseGateTestSummary(' Test Files  1 skipped (1)\n      Tests  2 skipped (2)\n'), { runner: 'vitest', passed: 0, failed: 0, skipped: 2, skipReasons: [] });
  assert.equal(parseGateTestSummary('      Tests  3 passed | 1 skipped (4)\n')!.passed, 3);
  assert.match(judgeGateTestSummary('      Tests  2 skipped (2)\n', { acceptance: false }) ?? '', /^gate ran 0 tests — 2 skipped \(vitest\)/);
});

test('node:test summaries, with the # SKIP reasons', () => {
  const out = 'ok 1 - reads the org # SKIP needs GW_TOKEN\n1..1\n# tests 1\n# suites 0\n# pass 0\n# fail 0\n# cancelled 0\n# skipped 1\n# todo 0\n';
  assert.deepEqual(parseGateTestSummary(out), { runner: 'node:test', passed: 0, failed: 0, skipped: 1, skipReasons: ['reads the org — needs GW_TOKEN'] });
  assert.equal(judgeGateTestSummary(out, { acceptance: false }), 'gate ran 0 tests — 1 skipped (node:test): reads the org — needs GW_TOKEN');
  assert.equal(judgeGateTestSummary('# pass 4\n# fail 0\n# skipped 1\n', { acceptance: true }), null);
});

test('no recognised summary: an ordinary gate (tsc, a build) is not judged; an acceptance gate is refused by name', () => {
  assert.equal(parseGateTestSummary('Compiled successfully.\n'), null);
  assert.equal(judgeGateTestSummary('Compiled successfully.\n', { acceptance: false }), null);
  assert.equal(
    judgeGateTestSummary('ok  \tgithub.com/x/y\t0.01s\n', { acceptance: true }),
    'acceptance gate output carries no recognised test summary (pytest, vitest, node:test, go test -v) — forge cannot prove a test ran',
  );
});

test('go test -v: skips counted, with the t.Skip reason line', () => {
  const out = '=== RUN   TestAccOrg\n--- SKIP: TestAccOrg (0.00s)\n    org_test.go:12: TF_ACC not set\nPASS\nok  \tgithub.com/x/y\t0.01s\n';
  assert.deepEqual(parseGateTestSummary(out), { runner: 'go test -v', passed: 0, failed: 0, skipped: 1, skipReasons: ['TestAccOrg — TF_ACC not set'] });
  assert.equal(judgeGateTestSummary('--- PASS: TestA (0.01s)\n--- SKIP: TestB (0.00s)\n', { acceptance: true }), null);
});
