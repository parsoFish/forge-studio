/**
 * Spec §5 item 1's merge-boundary columns, and the station that consumes them.
 *
 * These tests were written AFTER `runClassMergeBoundary` rather than before it —
 * the module's shape was driven out by the compiler while the selection was
 * threaded into `@forge/flows`. Each is therefore MUTATION-CHECKED instead of
 * merely written: the comment on each names the one-line change to the
 * implementation that makes it fail, and each was run against that change.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runClassMergeBoundary, type MergeBoundaryDeps } from './merge-boundary.ts';
import { CLASS_PROFILES } from '../class-profiles.ts';
import type { MergeGateResult } from '@forge/flows/cycle-helpers.ts';

const INPUT = { initiativeId: 'INIT-x', worktreePath: '/wt', projectRepoPath: '/repo' } as never;

function stubLogger() {
  const emitted: any[] = [];
  return { emitted, cycleId: 'c', emit(p: any) { emitted.push(p); return { ...p, event_id: `e${emitted.length}` }; } };
}

function deps(over: Partial<MergeBoundaryDeps> = {}): MergeBoundaryDeps {
  return {
    runTestGate: () => ({ ok: true, evidence: [] }) as MergeGateResult,
    changedMarkdown: () => ['docs/a.md'],
    docsGate: () => [],
    ...over,
  };
}

test('kills "the class table is decorative": the SELECTION the gate receives is the class\'s, not a constant', () => {
  const seen: Array<{ gates: readonly string[]; hasVerb: boolean }> = [];
  const d = deps({ runTestGate: (_i, _l, sel) => { seen.push(sel); return { ok: true, evidence: [] }; } });
  runClassMergeBoundary(CLASS_PROFILES.code, INPUT, stubLogger() as never, d);
  runClassMergeBoundary(CLASS_PROFILES.config, INPUT, stubLogger() as never, d);
  runClassMergeBoundary(CLASS_PROFILES.docs, INPUT, stubLogger() as never, d);
  assert.deepEqual(seen.map((s) => [...s.gates]), [['ci', 'local'], ['local'], []]);
  assert.deepEqual(seen.map((s) => s.hasVerb), [false, false, true], 'only docs carries a verb, and the gate is told so');
});

test('kills "the verb runs on a red suite too": a failed test gate returns immediately, one cause per boundary', () => {
  let docsRan = false;
  const red = { ok: false, failedGate: 'local', cmd: ['x'], output: 'red' } as MergeGateResult;
  const res = runClassMergeBoundary(CLASS_PROFILES.docs, INPUT, stubLogger() as never, deps({
    runTestGate: () => red,
    docsGate: () => { docsRan = true; return []; },
  }));
  assert.deepEqual(res, red);
  assert.equal(docsRan, false);
});

test('kills "a class with no verb still pays for one": code returns the test gate untouched', () => {
  let docsRan = false;
  const res = runClassMergeBoundary(CLASS_PROFILES.code, INPUT, stubLogger() as never, deps({
    docsGate: () => { docsRan = true; return []; },
  }));
  assert.deepEqual(res, { ok: true, evidence: [] });
  assert.equal(docsRan, false, 'the verb is null for code — running it would be spend the class did not ask for');
});

test('kills "the docs verb is decorative": findings make the boundary RED, with the finding text as its output', () => {
  const logger = stubLogger();
  const res = runClassMergeBoundary(CLASS_PROFILES.docs, INPUT, logger as never, deps({
    docsGate: () => [{ path: 'docs/a.md', line: 7, check: 'links', detail: 'dead link ./nope.md' }],
  }));
  assert.equal(res.ok, false);
  assert.equal((res as { failedGate: string }).failedGate, 'docs');
  assert.match((res as { output: string }).output, /docs\/a\.md:7 \[links\] dead link/);
  assert.ok(logger.emitted.some((e) => e.message === 'cycle.merge-gate' && e.metadata.gate === 'docs' && e.metadata.ok === false));
});

test('kills "an empty check reads as a green one": a docs class whose diff has NO markdown is RED, not clean', () => {
  // The whole boundary for `docs` is this verb. Over a diff with no markdown it
  // would check nothing, and nothing-checked is indistinguishable from
  // everything-passed unless it is refused here.
  const res = runClassMergeBoundary(CLASS_PROFILES.docs, INPUT, stubLogger() as never, deps({ changedMarkdown: () => [] }));
  assert.equal(res.ok, false);
  assert.equal((res as { failedGate: string }).failedGate, 'docs');
  assert.match((res as { output: string }).output, /would check nothing/);
});

test('a clean docs gate appends its OWN evidence row — a reader can tell "no finding" from "never ran"', () => {
  const res = runClassMergeBoundary(CLASS_PROFILES.docs, INPUT, stubLogger() as never, deps({
    runTestGate: () => ({ ok: true, evidence: [{ gate: 'local', cmd: ['npm', 'test'], ok: true }] }) as MergeGateResult,
  }));
  assert.equal(res.ok, true);
  const evidence = (res as { evidence: Array<{ gate: string; ok: boolean }> }).evidence;
  assert.deepEqual(evidence.map((e) => e.gate), ['local', 'docs']);
  assert.ok(evidence.every((e) => e.ok));
});
