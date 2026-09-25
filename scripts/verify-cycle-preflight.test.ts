/**
 * Kills the $2.18 architect spend that was then correctly refused at CLAIM
 * time (hard clause C2) — a refusal that should have cost $0. This is the
 * pure judgement `scripts/verify-cycle.mjs`'s thin call site uses to refuse
 * BEFORE stage 1 (the architect) when `runPreflight` (`@forge/projects`)
 * already knows the project will fail claim-validator.ts's own check.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { contractPreflightVerdict, shouldRunContractPreflight, refuseUnlessContractReady } from './lib/verify-cycle-preflight.mjs';

test('contractPreflightVerdict: refuses on a failing HARD clause and NAMES it', () => {
  const report = {
    projectDir: '/home/parso/forge/projects/gitpulse',
    projectName: 'gitpulse',
    ok: false,
    clauses: [
      { clause: 'C1', title: 'Runnable test process', hard: true, pass: true, detail: 'npm test declared' },
      { clause: 'C2', title: 'Scratch hygiene', hard: true, pass: false, detail: 'tracked scratch files: .run-lock, ledger.md' },
      { clause: 'C5', title: 'Constraint docs', hard: false, pass: true, detail: 'present' },
    ],
  };
  const verdict = contractPreflightVerdict(report);
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.failingHard, [{ clause: 'C2', detail: 'tracked scratch files: .run-lock, ledger.md' }]);
  assert.match(verdict.message, /REFUSING before the architect/);
  assert.match(verdict.message, /gitpulse/);
  assert.match(verdict.message, /\bC2\b/);
});

test('contractPreflightVerdict: names EVERY failing hard clause, not just the first', () => {
  const report = {
    projectDir: '/tmp/x', projectName: 'gitpulse', ok: false,
    clauses: [
      { clause: 'C2', title: 'Scratch hygiene', hard: true, pass: false, detail: 'tracked scratch files' },
      { clause: 'C4', title: 'Machine-readable architecture context', hard: true, pass: false, detail: 'missing roadmap.md' },
    ],
  };
  const verdict = contractPreflightVerdict(report);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.failingHard.length, 2);
  assert.match(verdict.message, /\bC2\b/);
  assert.match(verdict.message, /\bC4\b/);
});

test('contractPreflightVerdict: PASSES when only ADVISORY (non-hard) clauses fail', () => {
  const report = {
    projectDir: '/tmp/x',
    projectName: 'gitpulse',
    ok: true,
    clauses: [
      { clause: 'C1', title: 'Runnable test process', hard: true, pass: true, detail: 'ok' },
      { clause: 'C2', title: 'Scratch hygiene', hard: true, pass: true, detail: 'ok' },
      { clause: 'BRAIN', title: 'Brain freshness', hard: false, pass: false, detail: 'stale theme paths cited' },
    ],
  };
  const verdict = contractPreflightVerdict(report);
  assert.equal(verdict.ok, true, 'an advisory-only failure must never refuse the run');
  assert.deepEqual(verdict.failingHard, []);
});

test('contractPreflightVerdict: passes clean when every clause passes', () => {
  const report = {
    projectDir: '/tmp/x', projectName: 'gitpulse', ok: true,
    clauses: [{ clause: 'C1', title: 'Runnable test process', hard: true, pass: true, detail: 'ok' }],
  };
  const verdict = contractPreflightVerdict(report);
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.failingHard, []);
});

test('shouldRunContractPreflight: a real-ground run (no --base-sha) RUNS the preflight', () => {
  assert.equal(shouldRunContractPreflight(null), true);
  assert.equal(shouldRunContractPreflight(undefined), true);
});

test('shouldRunContractPreflight: the routine tier (--base-sha) SKIPS the preflight — its frozen corpus deliberately fails C2', () => {
  assert.equal(shouldRunContractPreflight('9f7d624abc'), false);
});

// ---------------------------------------------------------------------------
// refuseUnlessContractReady — the orchestration verify-cycle.mjs's call site
// delegates to entirely. `runPreflight` and `process.exit` are the two impure
// edges; both are exercised here without touching a real project dir or
// actually ending this test process (process.exit is mocked to throw instead
// of exiting, a standard node:test pattern — the throw is what this test
// catches as proof the refusal path ran).
// ---------------------------------------------------------------------------

test('refuseUnlessContractReady: skipped on the routine tier (--base-sha) — runPreflight is NEVER called', () => {
  let called = false;
  const result = refuseUnlessContractReady({
    repoPath: '/tmp/gitpulse',
    baseSha: '9f7d624abc',
    forgeRoot: '/tmp/forge',
    log: () => { throw new Error('log must not fire when the preflight is skipped'); },
    runPreflight: () => { called = true; return { ok: true, projectName: 'gitpulse', clauses: [] }; },
  });
  assert.equal(called, false, 'the routine tier must never call runPreflight at all');
  assert.equal(result, undefined);
});

test('refuseUnlessContractReady: refuses on a failing hard clause — logs the clause + message, then exits non-zero', () => {
  const logs = [];
  const exitMock = mock.method(process, 'exit', (code) => {
    throw new Error(`EXIT:${code}`);
  });
  try {
    assert.throws(
      () => refuseUnlessContractReady({
        repoPath: '/tmp/gitpulse',
        baseSha: null,
        forgeRoot: '/tmp/forge',
        log: (msg) => logs.push(msg),
        runPreflight: (dir, opts) => {
          assert.equal(dir, '/tmp/gitpulse');
          assert.equal(opts.forgeRoot, '/tmp/forge');
          assert.equal(opts.requireRunnableGate, true, 'must run the SAME check claim-validator.ts runs at claim time');
          return {
            projectName: 'gitpulse',
            ok: false,
            clauses: [{ clause: 'C2', title: 'Scratch hygiene', hard: true, pass: false, detail: 'tracked scratch files: .run-lock' }],
          };
        },
      }),
      /EXIT:1/,
    );
  } finally {
    exitMock.mock.restore();
  }
  assert.ok(logs.some((l) => l.includes('C2') && l.includes('tracked scratch files')), `expected a log line naming C2 + its detail, got: ${JSON.stringify(logs)}`);
  assert.ok(logs.some((l) => /REFUSING before the architect/.test(l) && l.includes('gitpulse')), `expected the named refusal line, got: ${JSON.stringify(logs)}`);
});

test('refuseUnlessContractReady: passes silently when contract-ready — no log, no exit', () => {
  const logs = [];
  const exitMock = mock.method(process, 'exit', () => {
    throw new Error('must not exit on a contract-ready project');
  });
  try {
    const result = refuseUnlessContractReady({
      repoPath: '/tmp/gitpulse',
      baseSha: null,
      forgeRoot: '/tmp/forge',
      log: (msg) => logs.push(msg),
      runPreflight: () => ({
        projectName: 'gitpulse',
        ok: true,
        clauses: [{ clause: 'C1', title: 'Runnable test process', hard: true, pass: true, detail: 'ok' }],
      }),
    });
    assert.equal(result, undefined);
  } finally {
    exitMock.mock.restore();
  }
  assert.deepEqual(logs, []);
});
