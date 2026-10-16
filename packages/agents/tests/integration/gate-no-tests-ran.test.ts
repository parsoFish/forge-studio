/**
 * forge-mfv5.1.38 door test: through the REAL gate spawn (makeQualityGateFromCmd
 * → runGateCapturing → execFileSync), an exit-0 gate whose runner executed zero
 * tests is NOT a pass. The command replays gitweave I3b WI-9's own gate stdout
 * from a fixture — no test runner, no network (§6.16).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeQualityGateFromCmd, type GateRunInfo } from '../../ralph/stop-conditions.ts';

const WI9 = join(import.meta.dirname, '../test-fixtures/i3b-skip-gates/WI-9.stdout.txt');
const printing = (text: string): string[] => [process.execPath, '-e', `process.stdout.write(${JSON.stringify(text)})`];
const replaying = (file: string): string[] => [process.execPath, '-e', `process.stdout.write(require('fs').readFileSync(${JSON.stringify(file)}, 'utf8'))`];

function run(cmd: string[], options?: Parameters<typeof makeQualityGateFromCmd>[3]): { passed: boolean; info: GateRunInfo } {
  const dir = mkdtempSync(join(tmpdir(), 'forge-gate-notests-'));
  try {
    let info: GateRunInfo | undefined;
    const passed = makeQualityGateFromCmd(dir, cmd, (i) => { info = i; }, options)({ iteration: 1 });
    return { passed, info: info! };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('I3b WI-9: "1 skipped in 0.01s", exit 0 → the gate FAILS by name, the reason reaches the dev loop', () => {
  const { passed, info } = run(replaying(WI9));
  assert.equal(passed, false);
  assert.equal(info.passed, false);
  assert.equal(info.rejectReason, 'no-tests-ran');
  assert.match(info.stderrTail, /\[forge gate-no-tests\] gate ran 0 tests — 1 skipped \(pytest\): no skip reasons in the output \(run pytest with -rs to print them\)/);
});

test('a run that executed tests still passes', () => {
  assert.equal(run(printing('..s\n2 passed, 1 skipped in 0.31s\n')).passed, true);
});

test('an ordinary gate with no test summary (a build) is unchanged', () => {
  assert.equal(run(printing('Compiled successfully.\n')).passed, true);
});

test('an acceptance gate (it targets the live suite) with no recognised summary is refused by name', () => {
  process.env.FORGE_TEST_GATE_ACC = '1';
  try {
    const { passed, info } = run(printing('ok  \tgithub.com/x/y\t0.01s\n'), { requiredEnv: ['FORGE_TEST_GATE_ACC'], acceptance: true });
    assert.equal(passed, false);
    assert.equal(info.rejectReason, 'no-tests-ran');
    assert.match(info.stderrTail, /acceptance gate output carries no recognised test summary/);
    // forge-mfv5.1.44: requiredEnv alone does not class a gate as acceptance — a guard keeps its exit-code verdict.
    assert.equal(run(printing('ok  \tgithub.com/x/y\t0.01s\n'), { requiredEnv: ['FORGE_TEST_GATE_ACC'] }).passed, true);
  } finally {
    delete process.env.FORGE_TEST_GATE_ACC;
  }
});
