/**
 * `gate-step-timeout.sh` bounds one gate step. A hung `npm test` once held a
 * gate and the suite-lock for 64 minutes; the helper kills the step's whole
 * process group on expiry (SIGTERM, grace, SIGKILL), prints one TIMEOUT line
 * and exits 124 — and gate.sh records that as a FAIL row naming TIMEOUT.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPTS = join(import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts');
const HELPER = join(SCRIPTS, 'gate-step-timeout.sh');
const GATE = join(SCRIPTS, 'gate.sh');

const run = (args: string[], env: Record<string, string> = {}) => {
  const { NODE_TEST_CONTEXT: _n, ...rest } = process.env;
  const t0 = Date.now();
  const r = spawnSync('bash', [HELPER, ...args], {
    encoding: 'utf8', env: { ...rest, GATE_STEP_TIMEOUT_GRACE_SECS: '1', ...env },
  });
  return { status: r.status, stderr: r.stderr ?? '', ms: Date.now() - t0 };
};

// A SIGKILLed orphan is a zombie until init reaps it, and kill(pid, 0) still
// succeeds on a zombie — so "survived" means running (not Z) after a bounded wait.
const running = (pid: number) => {
  try { return !/^\d+ \(.*\) Z /.test(readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch { return false; }
};
const survivesBound = (pid: number, ms = 3000) => {
  const end = Date.now() + ms;
  while (running(pid) && Date.now() < end) spawnSync('sleep', ['0.05']);
  return running(pid);
};

describe('gate-step-timeout.sh', () => {
  test('a SIGTERM-ignoring step is killed: exit 124, one TIMEOUT line, no survivor', () => {
    const d = mkdtempSync(join(tmpdir(), 'gate-sto-'));
    const pidfile = join(d, 'pid');
    try {
      const r = run(['1', '--', 'sh', '-c', `trap "" TERM; sleep 30 & echo $! > ${pidfile}; wait`]);
      assert.equal(r.status, 124, r.stderr);
      assert.ok(r.ms < 15000, `took ${r.ms}ms`);
      const lines = r.stderr.split('\n').filter((l) => l.startsWith('TIMEOUT after'));
      assert.equal(lines.length, 1, r.stderr);
      assert.match(lines[0], /^TIMEOUT after 1s: sh -c /);
      const pid = Number(readFileSync(pidfile, 'utf8').trim());
      assert.ok(pid > 1);
      assert.equal(survivesBound(pid), false, `step child ${pid} survived the timeout`);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('a fast step passes its own exit code through (0 and 3)', () => {
    assert.equal(run(['5', '--', 'sh', '-c', 'exit 0']).status, 0);
    const r = run(['5', '--', 'sh', '-c', 'exit 3']);
    assert.equal(r.status, 3);
    assert.doesNotMatch(r.stderr, /TIMEOUT/);
  });

  test('gate.sh routes its npm-test step through the helper: 124 is a FAIL row naming TIMEOUT', () => {
    const d = mkdtempSync(join(tmpdir(), 'gate-sto-tree-'));
    const c = mkdtempSync(join(tmpdir(), 'gate-sto-camp-'));
    try {
      mkdirSync(join(d, '.github', 'workflows'), { recursive: true });
      writeFileSync(join(d, '.github', 'workflows', 'ci.yml'),
        'name: CI\non: [push]\njobs:\n  build-and-test:\n    runs-on: ubuntu-latest\n    steps:\n      - name: T\n        run: npm test\n');
      mkdirSync(join(d, 'packages', 'kernel'), { recursive: true });
      mkdirSync(join(d, 'node_modules', '@forge'), { recursive: true });
      symlinkSync(join(d, 'packages', 'kernel'), join(d, 'node_modules', '@forge', 'kernel'));
      writeFileSync(join(d, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0', scripts: { test: 'sleep 60' } }));
      const { NODE_TEST_CONTEXT: _n, GATE_RERUN_ALONE: _g, ...rest } = process.env;
      const r = spawnSync('bash', [GATE, d, c], {
        encoding: 'utf8',
        env: { ...rest, GATE_NPM_TEST_TIMEOUT_SECS: '1', GATE_STEP_TIMEOUT_GRACE_SECS: '1' },
      });
      assert.match(r.stdout, /^FAIL {2}npm test .*TIMEOUT/m, r.stdout);
      assert.match(r.stdout, /^GATE_SH_EXIT=1$/m, r.stdout);
    } finally {
      rmSync(d, { recursive: true, force: true });
      rmSync(c, { recursive: true, force: true });
    }
  });
});
