/**
 * Focused tests for the quality-gate command builder added in F-04, plus
 * the post-2026-05-23-dogfood tightening (requiredPaths git-diff check).
 * See [[quality-gate-cmd-must-assert-new-work]].
 *
 * G2 (2026-07-11, plan item 2.6): the NO_WORK_INDICATORS /
 * WORK_HAPPENED_PATTERNS string heuristics were DELETED — hollow-gate
 * detection is now the runner's deterministic tool-use + diff-presence
 * check (`hollow-no-work` in runner.ts) plus the requiredPaths tightening
 * here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  autoCommitWorktreeIfDirty,
  makeQualityGateFromCmd,
  readWorktreeSecretsEnv,
  resolveGateTimeoutMs,
  type GateRunInfo,
} from './stop-conditions.ts';

test('makeQualityGateFromCmd: returns true when command exits 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-qg-'));
  try {
    const gate = makeQualityGateFromCmd(dir, ['true']);
    assert.equal(gate(), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('makeQualityGateFromCmd: returns false when command exits non-zero', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-qg-'));
  try {
    const gate = makeQualityGateFromCmd(dir, ['false']);
    assert.equal(gate(), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('makeQualityGateFromCmd: returns false when binary is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-qg-'));
  try {
    const gate = makeQualityGateFromCmd(dir, ['this-binary-definitely-does-not-exist-99999']);
    assert.equal(gate(), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// re-review #1: a gate that could not RUN (missing binary) is flagged as
// `errored` with the synthetic -4 exit + `gate-errored` reason — distinct from
// a test that RAN and returned non-zero (which must NOT be errored).
test('makeQualityGateFromCmd: a missing binary is reported as a gate ERROR, not a test fail', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-qg-'));
  try {
    let info: GateRunInfo | undefined;
    const gate = makeQualityGateFromCmd(dir, ['this-binary-definitely-does-not-exist-99999'], (i) => { info = i; });
    assert.equal(gate({ iteration: 2 }), false);
    assert.ok(info, 'onRun must fire');
    assert.equal(info!.errored, true, 'missing binary ⇒ errored');
    assert.equal(info!.exitCode, -4, 'synthetic gate-errored exit code');
    assert.equal(info!.rejectReason, 'gate-errored');
    assert.match(info!.stderrTail, /BROKEN GATE/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// N10 (2026-07 betterado friction): a gate killed by its TIMEOUT is an
// ENVIRONMENT failure (load / hung build), categorically distinct from both a
// test fail (work-failure) and a broken gate (gate-errored). It gets its own
// synthetic exit (-6), `timedOut: true`, and a `gate-timeout` reject reason so
// the failure classifier can route it as transient instead of "the code was
// wrong" or "fix the gate".
test('makeQualityGateFromCmd: a gate exceeding timeoutMs is classified timedOut, not errored/work-fail', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-qg-'));
  try {
    let info: GateRunInfo | undefined;
    const gate = makeQualityGateFromCmd(
      dir,
      ['sleep', '30'],
      (i) => { info = i; },
      { timeoutMs: 300 },
    );
    assert.equal(gate({ iteration: 1 }), false);
    assert.ok(info, 'onRun must fire');
    assert.equal(info!.timedOut, true, 'killed by timeout ⇒ timedOut');
    assert.equal(info!.errored, undefined, 'timeout is NOT the broken-gate class');
    assert.equal(info!.exitCode, -6, 'synthetic gate-timeout exit code');
    assert.equal(info!.rejectReason, 'gate-timeout');
    assert.match(info!.stderrTail, /\[forge gate-timeout\]/);
    assert.match(info!.stderrTail, /environment/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('makeQualityGateFromCmd: a fast gate under timeoutMs passes normally (no timeout side effects)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-qg-'));
  try {
    let info: GateRunInfo | undefined;
    const gate = makeQualityGateFromCmd(dir, ['true'], (i) => { info = i; }, { timeoutMs: 5_000 });
    assert.equal(gate(), true);
    assert.equal(info!.timedOut, undefined);
    assert.equal(info!.passed, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveGateTimeoutMs: default 30 min, FORGE_GATE_TIMEOUT_MS overrides', () => {
  const prev = process.env.FORGE_GATE_TIMEOUT_MS;
  try {
    delete process.env.FORGE_GATE_TIMEOUT_MS;
    assert.equal(resolveGateTimeoutMs(), 30 * 60_000);
    process.env.FORGE_GATE_TIMEOUT_MS = '120000';
    assert.equal(resolveGateTimeoutMs(), 120_000);
    process.env.FORGE_GATE_TIMEOUT_MS = 'not-a-number';
    assert.equal(resolveGateTimeoutMs(), 30 * 60_000);
  } finally {
    if (prev === undefined) delete process.env.FORGE_GATE_TIMEOUT_MS;
    else process.env.FORGE_GATE_TIMEOUT_MS = prev;
  }
});

test('makeQualityGateFromCmd: a test that RAN and exited non-zero is NOT errored', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-qg-'));
  try {
    let info: GateRunInfo | undefined;
    // `false` exists and exits 1 — a real test-fail, not a broken gate.
    const gate = makeQualityGateFromCmd(dir, ['false'], (i) => { info = i; });
    assert.equal(gate({ iteration: 2 }), false);
    assert.ok(info);
    assert.notEqual(info!.errored, true, 'a ran-and-failed command must NOT be flagged errored');
    assert.equal(info!.exitCode, 1);
    assert.equal(info!.rejectReason, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('makeQualityGateFromCmd: requiredEnv with an UNSET var ERRORS the gate (live-acc skip guard)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-gate-env-'));
  const unset = 'FORGE_TEST_DEFINITELY_UNSET_ENV_XYZ';
  delete process.env[unset];
  try {
    let info: GateRunInfo | undefined;
    // `true` exits 0 — but the missing required env var must make the gate
    // ERROR *before running* (a live-acc runner would silently skip + false-pass).
    const gate = makeQualityGateFromCmd(dir, ['true'], (i) => { info = i; }, { requiredEnv: [unset] });
    assert.equal(gate(), false, 'gate must NOT pass when a required env var is unset');
    assert.ok(info);
    assert.equal(info!.passed, false);
    assert.equal(info!.errored, true, 'a live-acc gate without its env is a broken/unvalidatable gate');
    assert.equal(info!.rejectReason, 'live-env-missing');
    assert.equal(info!.exitCode, -5);
    assert.match(info!.stderrTail, new RegExp(unset));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('makeQualityGateFromCmd: requiredEnv satisfied → gate runs + passes normally', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-gate-env-'));
  const present = 'FORGE_TEST_PRESENT_ENV_XYZ';
  process.env[present] = '1';
  try {
    const gate = makeQualityGateFromCmd(dir, ['true'], undefined, { requiredEnv: [present] });
    assert.equal(gate(), true, 'gate runs (and passes) when the required env var is set');
  } finally {
    delete process.env[present];
    rmSync(dir, { recursive: true, force: true });
  }
});

test('makeQualityGateFromCmd: requiredEnv satisfied by the worktree secrets.env → gate runs with it injected', () => {
  // 2026-06-11: the contract puts live creds in the project's gitignored
  // secrets.env (self-loaded by the tests) — the guard must accept that as a
  // source AND hand the var to the gate child process (framework pre-checks
  // like Go's TF_ACC skip-check run before the test's own secrets loading).
  const dir = mkdtempSync(join(tmpdir(), 'forge-gate-secrets-'));
  const fromSecrets = 'FORGE_TEST_SECRETS_ONLY_ENV_XYZ';
  delete process.env[fromSecrets];
  try {
    writeFileSync(join(dir, 'secrets.env'), `# live creds\n${fromSecrets}=from-secrets\n`);
    let info: GateRunInfo | undefined;
    const gate = makeQualityGateFromCmd(
      dir,
      ['sh', '-c', `test "$${fromSecrets}" = from-secrets`],
      (i) => { info = i; },
      { requiredEnv: [fromSecrets] },
    );
    assert.equal(gate(), true, 'secrets.env var satisfies the guard and reaches the child process');
    assert.equal(info?.errored ?? false, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('makeQualityGateFromCmd: process env WINS over secrets.env on conflict', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-gate-secrets-'));
  const conflicted = 'FORGE_TEST_CONFLICT_ENV_XYZ';
  process.env[conflicted] = 'from-process';
  try {
    writeFileSync(join(dir, 'secrets.env'), `${conflicted}=from-secrets\n`);
    const gate = makeQualityGateFromCmd(
      dir,
      ['sh', '-c', `test "$${conflicted}" = from-process`],
      undefined,
      { requiredEnv: [conflicted] },
    );
    assert.equal(gate(), true, 'an exported var must never be overridden by secrets.env');
  } finally {
    delete process.env[conflicted];
    rmSync(dir, { recursive: true, force: true });
  }
});

test('makeQualityGateFromCmd: unsetEnv strips a declared var from the gate child (F2, R5-02 — TF_ACC leak, no requiredEnv)', () => {
  // R5-02 F2: a docs-only cycle's per-WI gate must NOT accidentally run a
  // live-acceptance suite just because the orchestrator's own process env
  // happens to carry TF_ACC=1 (an operator's shell, or a sibling live-acc
  // cycle). Before this fix, `unsetEnv` didn't exist and `runGateCapturing`
  // only ever built a scrubbed env when `requiredEnv` was non-empty — the
  // common case (no requiredEnv) inherited process.env completely unscrubbed.
  const dir = mkdtempSync(join(tmpdir(), 'forge-gate-unset-'));
  process.env.FORGE_TEST_TF_ACC_XYZ = '1';
  try {
    let info: GateRunInfo | undefined;
    const gate = makeQualityGateFromCmd(
      dir,
      ['sh', '-c', 'echo "TF_ACC=${FORGE_TEST_TF_ACC_XYZ:-UNSET}"'],
      (i) => { info = i; },
      { unsetEnv: ['FORGE_TEST_TF_ACC_XYZ'] },
    );
    assert.equal(gate(), true);
    assert.ok(info);
    assert.match(info!.stdoutTail, /TF_ACC=UNSET/, 'the declared ci_gate_unset_env var must not reach the gate child');
  } finally {
    delete process.env.FORGE_TEST_TF_ACC_XYZ;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('makeQualityGateFromCmd: without unsetEnv declared, an ambient var reaches the gate child unchanged (baseline)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-gate-unset-'));
  process.env.FORGE_TEST_TF_ACC_XYZ = '1';
  try {
    let info: GateRunInfo | undefined;
    const gate = makeQualityGateFromCmd(
      dir,
      ['sh', '-c', 'echo "TF_ACC=${FORGE_TEST_TF_ACC_XYZ:-UNSET}"'],
      (i) => { info = i; },
    );
    assert.equal(gate(), true);
    assert.match(info!.stdoutTail, /TF_ACC=1/, 'sanity: an undeclared ambient var passes through by default');
  } finally {
    delete process.env.FORGE_TEST_TF_ACC_XYZ;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('makeQualityGateFromCmd: unsetEnv strips a declared var even when requiredEnv is also set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-gate-unset-'));
  const present = 'FORGE_TEST_PRESENT_ENV_ABC';
  process.env[present] = '1';
  process.env.FORGE_TEST_TF_ACC_XYZ = '1';
  try {
    let info: GateRunInfo | undefined;
    const gate = makeQualityGateFromCmd(
      dir,
      ['sh', '-c', 'echo "TF_ACC=${FORGE_TEST_TF_ACC_XYZ:-UNSET}"'],
      (i) => { info = i; },
      { requiredEnv: [present], unsetEnv: ['FORGE_TEST_TF_ACC_XYZ'] },
    );
    assert.equal(gate(), true);
    assert.match(info!.stdoutTail, /TF_ACC=UNSET/, 'unsetEnv strips even while a separate requiredEnv guard is active');
  } finally {
    delete process.env[present];
    delete process.env.FORGE_TEST_TF_ACC_XYZ;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readWorktreeSecretsEnv: parses KEY=VALUE, skips comments/blanks, strips export + quotes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-secrets-parse-'));
  try {
    writeFileSync(
      join(dir, 'secrets.env'),
      [
        '# comment',
        '',
        'PLAIN=value',
        'export EXPORTED=ok',
        'QUOTED="with spaces"',
        "SINGLE='single'",
        'EQ_IN_VALUE=a=b',
        '=novalue',
        'not-a-pair',
      ].join('\n'),
    );
    assert.deepEqual(readWorktreeSecretsEnv(dir), {
      PLAIN: 'value',
      EXPORTED: 'ok',
      QUOTED: 'with spaces',
      SINGLE: 'single',
      EQ_IN_VALUE: 'a=b',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readWorktreeSecretsEnv: missing file → empty object (guard then names the missing var)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-secrets-parse-'));
  try {
    assert.deepEqual(readWorktreeSecretsEnv(dir), {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readWorktreeSecretsEnv: falls back to the MAIN checkout when the worktree lacks secrets.env', () => {
  // secrets.env is gitignored, so `git worktree add` never materialises it in
  // cycle worktrees — the loader must find the main checkout's copy.
  const root = mkdtempSync(join(tmpdir(), 'forge-secrets-wt-'));
  const repo = join(root, 'repo');
  const wt = join(root, 'wt');
  try {
    execFileSync('git', ['init', '-q', repo]);
    execFileSync('git', ['-C', repo, 'commit', '--allow-empty', '-m', 'init', '-q'], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
      },
    });
    writeFileSync(join(repo, 'secrets.env'), 'FROM_MAIN_CHECKOUT=yes\n');
    execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', wt, '-b', 'wt-branch']);
    assert.deepEqual(readWorktreeSecretsEnv(wt), { FROM_MAIN_CHECKOUT: 'yes' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('makeQualityGateFromCmd: returns false on empty command', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-qg-'));
  try {
    const gate = makeQualityGateFromCmd(dir, []);
    assert.equal(gate(), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('makeQualityGateFromCmd: passes additional args through', () => {
  // `sh -c "exit 7"` exits 7 — a non-zero we can be sure is from our command,
  // not a missing binary. Verifies args are forwarded.
  const dir = mkdtempSync(join(tmpdir(), 'forge-qg-'));
  try {
    const gateFail = makeQualityGateFromCmd(dir, ['sh', '-c', 'exit 1']);
    assert.equal(gateFail(), false);
    const gatePass = makeQualityGateFromCmd(dir, ['sh', '-c', 'exit 0']);
    assert.equal(gatePass(), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// -------------------------------------------------------------------------
// G2 (plan item 2.6): the no-work-indicator string scan is GONE. An exit-0
// gate passes regardless of runner chatter — hollow detection is the
// runner's diff-presence check (`hollow-no-work`) + requiredPaths below.
// -------------------------------------------------------------------------

test('G2: exit-0 + "[no tests to run]" chatter PASSES — string heuristics deleted; hollow detection lives in the runner', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-qg-'));
  try {
    let captured: GateRunInfo | undefined;
    const gate = makeQualityGateFromCmd(
      dir,
      ['sh', '-c', 'echo "ok  github.com/x/y  0.003s [no tests to run]"; exit 0'],
      (info) => { captured = info; },
    );
    assert.equal(gate(), true, 'exit-0 alone decides — no output-string scan');
    assert.equal(captured?.rejectReason, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('makeQualityGateFromCmd: exit-0 with plain passing output → passes (legit pass)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-qg-'));
  try {
    let captured: GateRunInfo | undefined;
    const gate = makeQualityGateFromCmd(
      dir,
      ['sh', '-c', 'echo "--- PASS: TestX (0.01s)"; echo "ok 1 test"; exit 0'],
      (info) => { captured = info; },
    );
    assert.equal(gate(), true);
    assert.equal(captured?.rejectReason, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// -------------------------------------------------------------------------
// Tightening 2: requiredPaths git-diff check
// -------------------------------------------------------------------------

/**
 * Set up a tiny git repo with a `main` baseline + a branch HEAD diff so the
 * requiredPaths tightening has something to check against.
 */
function setupTinyRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'forge-qg-git-'));
  const run = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  run('init', '-b', 'main');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'forge-test');
  writeFileSync(join(dir, 'README.md'), '# baseline\n');
  run('add', 'README.md');
  run('commit', '-m', 'baseline');
  run('checkout', '-b', 'forge/wi');
  writeFileSync(join(dir, 'foo.go'), 'package x\n');
  writeFileSync(join(dir, 'bar_test.go'), 'package x\n');
  run('add', 'foo.go', 'bar_test.go');
  run('commit', '-m', 'add foo.go + bar_test.go');
  return dir;
}

test('makeQualityGateFromCmd: requiredPaths matched in diff → passes', () => {
  const dir = setupTinyRepo();
  try {
    const gate = makeQualityGateFromCmd(
      dir,
      ['sh', '-c', 'echo "--- PASS: TestY"; exit 0'],
      undefined,
      { requiredPaths: ['bar_test.go'] },
    );
    assert.equal(gate(), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('makeQualityGateFromCmd: requiredPaths NOT matched in diff → rejects (the dogfood case)', () => {
  const dir = setupTinyRepo();
  try {
    let captured: GateRunInfo | undefined;
    const gate = makeQualityGateFromCmd(
      dir,
      ['sh', '-c', 'echo "--- PASS: TestY"; exit 0'],
      (info) => { captured = info; },
      { requiredPaths: ['expected_test.go'] },
    );
    assert.equal(gate(), false);
    assert.equal(captured?.rejectReason, 'required-paths-missing');
    // F1.I2: rejection message is now prescriptive — must include the
    // ACTION + the specific required path so the agent can act on it.
    assert.match(captured?.stderrTail ?? '', /REJECTED/);
    assert.match(captured?.stderrTail ?? '', /ACTION REQUIRED/);
    assert.match(captured?.stderrTail ?? '', /expected_test\.go/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('makeQualityGateFromCmd: requiredPaths with ≥1 match (others missing) → passes', () => {
  const dir = setupTinyRepo();
  try {
    // bar_test.go IS in diff; missing-thing is not. Any-of semantics → pass.
    const gate = makeQualityGateFromCmd(
      dir,
      ['sh', '-c', 'echo "--- PASS: TestY"; exit 0'],
      undefined,
      { requiredPaths: ['missing-thing', 'bar_test.go'] },
    );
    assert.equal(gate(), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('makeQualityGateFromCmd: empty requiredPaths array → no tightening, exit-0 passes', () => {
  const dir = setupTinyRepo();
  try {
    const gate = makeQualityGateFromCmd(
      dir,
      ['sh', '-c', 'exit 0'],
      undefined,
      { requiredPaths: [] },
    );
    assert.equal(gate(), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('G2: exit-0 chatter + requiredPaths present in diff → passes (no string scan to fire first)', () => {
  const dir = setupTinyRepo();
  try {
    let captured: GateRunInfo | undefined;
    const gate = makeQualityGateFromCmd(
      dir,
      ['sh', '-c', 'echo "[no tests to run]"; exit 0'],
      (info) => { captured = info; },
      { requiredPaths: ['bar_test.go'] },  // in diff — the only remaining tightening holds
    );
    assert.equal(gate(), true);
    assert.equal(captured?.rejectReason, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('makeQualityGateFromCmd: real dogfood-shape — go-test-no-tests + missing test file → requiredPaths rejects', () => {
  const dir = setupTinyRepo();
  try {
    let captured: GateRunInfo | undefined;
    // Simulates the exact 2026-05-23 betterado false-pass:
    //   `go test ./...release/... -run TestReleaseDefinition` exits 0
    //   with stdout containing "[no tests to run]" and no _test.go file
    //   in the diff. G2: the deterministic requiredPaths diff check (not a
    //   string scan) is what catches it now.
    const gate = makeQualityGateFromCmd(
      dir,
      ['sh', '-c', 'echo "ok  github.com/x/release  0.001s [no tests to run]"; exit 0'],
      (info) => { captured = info; },
      { requiredPaths: ['azuredevops/internal/service/release/resource_release_definition_test.go'] },
    );
    assert.equal(gate(), false, 'dogfood scenario must be caught by the gate now');
    assert.equal(captured?.rejectReason, 'required-paths-missing');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// autoCommitWorktreeIfDirty — G8 wave 2 (2026-07-12): this safety-net commit
// is orchestrator-issued (no agent in the loop), so it must carry
// ORCHESTRATOR_GIT_IDENTITY via explicit -c flags rather than whatever git
// identity happens to be configured in the worktree.
// ---------------------------------------------------------------------------

test('autoCommitWorktreeIfDirty: dirty tree → commits with forge-orchestrator identity, not the local gitconfig', () => {
  const dir = setupTinyRepo();
  try {
    writeFileSync(join(dir, 'uncommitted.txt'), 'missed agent commit\n');

    const committed = autoCommitWorktreeIfDirty(dir, 3, 'WI-9');
    assert.equal(committed, true);

    const run = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe', encoding: 'utf8' }).trim();
    assert.match(run('log', '-1', '--pretty=%s'), /^forge-autocommit: WI-9 iter 3 WIP/);
    // setupTinyRepo configures a LOCAL identity of test@example.com/forge-test
    // — deliberately distinct, so asserting forge-orchestrator here proves the
    // -c override actually took effect rather than passively matching.
    assert.equal(run('log', '-1', '--pretty=%an'), 'forge-orchestrator');
    assert.equal(run('log', '-1', '--pretty=%ae'), 'forge-orchestrator@forge.local');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('autoCommitWorktreeIfDirty: clean tree → returns false, no commit created', () => {
  const dir = setupTinyRepo();
  try {
    const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
    const committed = autoCommitWorktreeIfDirty(dir, 1);
    assert.equal(committed, false);
    const after = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
    assert.equal(after, before, 'no new commit on a clean tree');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

