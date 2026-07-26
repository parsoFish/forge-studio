/**
 * Tests for `runContractComplianceLoop` (R4-02-F2) — the deterministic,
 * bounded, orchestrator-authored preflight→fix→re-check convergence loop.
 *
 * The loop's authoritative signal is `runPreflight().ok` (hard-green), never an
 * agent's claim — so the loop is fully hermetic/creds-free. Logic is exercised
 * with injected preflight/auto-fix deps; one integration test drives the REAL
 * preflight machinery against a deliberately-broken fixture repo (the F2 AC).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runContractComplianceLoop, formatComplianceReport } from './contract-compliance-loop.ts';
import type { ClauseId, ClauseResult, PreflightReport } from './preflight.ts';
import type { PreflightAutoFixResult } from './preflight-fix-auto.ts';

function clause(id: ClauseId, pass: boolean, hard: boolean): ClauseResult {
  return { clause: id, title: id, hard, pass, detail: `${id} ${pass ? 'ok' : 'fail'}` };
}
function report(clauses: ClauseResult[]): PreflightReport {
  return { projectDir: '/x', projectName: 'demoproj', clauses, ok: clauses.filter((c) => c.hard).every((c) => c.pass) };
}
/** A preflight stub that returns each queued report in turn (last one sticks). */
function seqPreflight(reports: PreflightReport[]) {
  let i = 0;
  return () => reports[Math.min(i++, reports.length - 1)];
}
/** An auto-fix stub reporting the given clauses cleared. */
function autoFixStub(cleared: ClauseId[]): () => PreflightAutoFixResult {
  return () => ({ applied: cleared.map((c) => ({ clause: c, detail: 'x', cleared: true })), skipped: [] });
}

// ---------------------------------------------------------------------------
// Convergence via deterministic auto-fix
// ---------------------------------------------------------------------------

test('converges: auto-fixable hard clauses cleared → hard-green, stopReason converged', () => {
  const failing = report([clause('C1', true, true), clause('C2', false, true), clause('C4', false, true)]);
  const green = report([clause('C1', true, true), clause('C2', true, true), clause('C4', true, true)]);
  const out = runContractComplianceLoop({
    projectDir: '/x', forgeRoot: '/f',
    deps: { runPreflight: seqPreflight([failing, green, green]), applyPreflightAutoFixes: autoFixStub(['C2', 'C4']) },
  });
  assert.equal(out.finalHardGreen, true);
  assert.equal(out.converged, true);
  assert.equal(out.stopReason, 'converged');
  // Clauses that were failing at the start but pass at the end read 'fixed'.
  const byClause = Object.fromEntries(out.dispositions.map((d) => [d.clause, d.outcome]));
  assert.equal(byClause['C2'], 'fixed');
  assert.equal(byClause['C4'], 'fixed');
  assert.equal(byClause['C1'], 'passed');
});

test('every clause appears in the disposition ledger — never silent', () => {
  const green = report([clause('C1', true, true), clause('C8', true, false)]);
  const out = runContractComplianceLoop({
    projectDir: '/x', forgeRoot: '/f',
    deps: { runPreflight: seqPreflight([green]), applyPreflightAutoFixes: autoFixStub([]) },
  });
  assert.equal(out.dispositions.length, 2);
  assert.deepEqual(out.dispositions.map((d) => d.clause).sort(), ['C1', 'C8']);
});

// ---------------------------------------------------------------------------
// Non-convergence terminal states
// ---------------------------------------------------------------------------

test('unfixable hard clause (non-auto) → stopReason unfixable-hard-clause, not hard-green', () => {
  const stuck = report([clause('C1', false, true)]); // C1 is hard + NOT auto-fixable
  const out = runContractComplianceLoop({
    projectDir: '/x', forgeRoot: '/f',
    deps: { runPreflight: seqPreflight([stuck]), applyPreflightAutoFixes: autoFixStub([]) },
  });
  assert.equal(out.finalHardGreen, false);
  assert.equal(out.stopReason, 'unfixable-hard-clause');
  assert.equal(out.dispositions.find((d) => d.clause === 'C1')?.outcome, 'failed');
});

test('max-iterations: a fixer that reports cleared but never actually clears stops at the cap', () => {
  const stuck = report([clause('C1', true, true), clause('C2', false, true)]); // C2 auto but "never clears"
  const out = runContractComplianceLoop({
    projectDir: '/x', forgeRoot: '/f', maxIterations: 3,
    // preflight always shows C2 failing; auto-fix always claims it cleared → progress each round → cap.
    deps: { runPreflight: seqPreflight([stuck]), applyPreflightAutoFixes: autoFixStub(['C2']) },
  });
  assert.equal(out.finalHardGreen, false);
  assert.equal(out.stopReason, 'max-iterations');
  assert.equal(out.iterations.length, 3);
});

// ---------------------------------------------------------------------------
// Advisory disposition ("explicitly accepted-or-fixed")
// ---------------------------------------------------------------------------

test('advisory clause left un-accepted → hard-green but NOT converged (surfaced, never silently passed)', () => {
  const g = report([clause('C1', true, true), clause('C8', false, false)]);
  const out = runContractComplianceLoop({
    projectDir: '/x', forgeRoot: '/f',
    deps: { runPreflight: seqPreflight([g]), applyPreflightAutoFixes: autoFixStub([]) },
  });
  assert.equal(out.finalHardGreen, true);
  assert.equal(out.converged, false, 'an un-dispositioned advisory clause blocks convergence');
  assert.equal(out.stopReason, 'advisory-undispositioned', 'hard-green with an open advisory is not "no-progress"');
  assert.equal(out.dispositions.find((d) => d.clause === 'C8')?.outcome, 'failed');
});

test('advisory clause explicitly accepted with a rationale → converged', () => {
  const g = report([clause('C1', true, true), clause('C8', false, false)]);
  const out = runContractComplianceLoop({
    projectDir: '/x', forgeRoot: '/f',
    acceptAdvisory: { C8: 'no AGENTS.md needed for this library — README covers it' },
    deps: { runPreflight: seqPreflight([g]), applyPreflightAutoFixes: autoFixStub([]) },
  });
  assert.equal(out.converged, true);
  const c8 = out.dispositions.find((d) => d.clause === 'C8');
  assert.equal(c8?.outcome, 'accepted');
  assert.match(c8?.detail ?? '', /README covers it/);
});

// ---------------------------------------------------------------------------
// formatComplianceReport — the "operator-readable, never silent" AC half
// ---------------------------------------------------------------------------

test('formatComplianceReport: names every clause + its outcome + the terminal reason', () => {
  const failing = report([clause('C1', true, true), clause('C2', false, true), clause('C8', false, false)]);
  const fixed = report([clause('C1', true, true), clause('C2', true, true), clause('C8', false, false)]);
  const out = runContractComplianceLoop({
    projectDir: '/x', forgeRoot: '/f',
    acceptAdvisory: { C8: 'README covers agent guidance' },
    deps: { runPreflight: seqPreflight([failing, fixed, fixed]), applyPreflightAutoFixes: autoFixStub(['C2']) },
  });
  const text = formatComplianceReport(out);
  // Every clause is named — nothing silently omitted.
  for (const c of ['C1', 'C2', 'C8']) assert.match(text, new RegExp(c));
  assert.match(text, /fixed/);    // C2 was fixed
  assert.match(text, /accepted/); // C8 was accepted
  assert.match(text, /stop: converged/);
});

// ---------------------------------------------------------------------------
// Integration — the F2 AC: a deliberately-broken fixture reaches hard-green
// ---------------------------------------------------------------------------

test('AC: a deliberately-broken fixture repo reaches contract-green unattended (real preflight)', () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'ccl-'));
  const projectDir = join(forgeRoot, 'projects', 'demoproj');
  mkdirSync(join(projectDir, '.forge'), { recursive: true });
  writeFileSync(join(projectDir, 'package.json'), '{"name":"demoproj"}');
  writeFileSync(join(projectDir, 'tsconfig.json'), '{}');
  // C1 satisfied via the sidecar (single command, no slow marker); C2/ARTIFACTS/C4 fail.
  writeFileSync(join(projectDir, '.forge', 'quality_gate_cmd'), 'tsc --noEmit');
  writeFileSync(join(projectDir, '.gitignore'), 'node_modules\n');
  try {
    const out = runContractComplianceLoop({ projectDir, forgeRoot });
    assert.equal(out.finalHardGreen, true, `expected hard-green; stopReason=${out.stopReason}`);
    // The three auto-fixable clauses were cleared BY the loop.
    const byClause = Object.fromEntries(out.dispositions.map((d) => [d.clause, d.outcome]));
    assert.equal(byClause['C2'], 'fixed');
    assert.equal(byClause['C4'], 'fixed');
    assert.equal(byClause['ARTIFACTS'], 'fixed');
    // Remaining advisory gaps are SURFACED in the ledger, not silently passed.
    assert.ok(out.dispositions.some((d) => !d.hard && d.outcome === 'failed'), 'advisory gaps surfaced');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
