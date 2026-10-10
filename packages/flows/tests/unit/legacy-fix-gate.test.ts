/**
 * forge-nk1y.22 — a pending gate-fix WI compiled before #1172 carries the no-op
 * gate ['true']; re-entry rewrites it to the failing gate's own command when the
 * cycle's events.jsonl still names it, and NAMES it when they do not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { normaliseLegacyFixGates, normaliseLegacyFixGatesAtReentry, readCycleEvents, type CycleEvent } from '../../legacy-fix-gate.ts';
import { devWorkItemsDir } from '../../fix-work-items.ts';
import { readWorkItemsFromDir, writeWorkItem, type WorkItem } from '../../work-item.ts';

const INIT = 'INIT-2026-10-10-legacy-gate';
const LOCAL = ['npm', 'run', 'test:full'];
const NOOP = ['true'];

function wi(id: string, over: Partial<WorkItem> = {}): WorkItem {
  return {
    work_item_id: id, initiative_id: INIT, status: 'pending', depends_on: [],
    acceptance_criteria: [{ given: 'g', when: 'w', then: 't' }], files_in_scope: ['src/a.ts'],
    estimated_iterations: 1, quality_gate_cmd: NOOP, origin: 'gate-fix', body: `${id} body`, ...over,
  };
}
const ev = (message: string, metadata: Record<string, unknown>): CycleEvent => ({ phase: 'orchestrator', skill: 'cycle', message, metadata });
const gateRow = (gate: string, ok: boolean, cmd?: string[]) => ev('cycle.merge-gate', { gate, ok, ...(cmd ? { cmd } : {}) });
const compiled = (failed_gate: string, ids: string[], extra: Record<string, unknown> = {}) =>
  ev('merge-gate.fix-loop.compiled', { failed_gate, origin: 'gate-fix', appended_work_items: ids, round: 1, head_sha: 'a'.repeat(40), ...extra });

function withWorktree(items: WorkItem[], fn: (wt: string) => void): void {
  const wt = mkdtempSync(join(tmpdir(), 'legacy-gate-'));
  try {
    for (const w of items) writeWorkItem(w, wt, { workItemsDir: devWorkItemsDir(wt) });
    fn(wt);
  } finally { rmSync(wt, { recursive: true, force: true }); }
}
const gateOf = (wt: string, id: string) => readWorkItemsFromDir(devWorkItemsDir(wt)).items.find((w) => w.work_item_id === id)!.quality_gate_cmd;

test('local failure: the legacy WI is rewritten to the red local event\'s cmd', () => withWorktree([wi('WI-6')], (wt) => {
  const r = normaliseLegacyFixGates({ worktreePath: wt, events: [gateRow('local', false, LOCAL), compiled('local', ['WI-6'])] });
  assert.deepEqual(r, { rewritten: [{ work_item_id: 'WI-6', cmd: LOCAL }], unresolved: [] });
  assert.deepEqual(gateOf(wt, 'WI-6'), LOCAL);
}));

test('the latest red local event BEFORE the compile wins (an earlier green one and a later row are ignored)', () => withWorktree([wi('WI-6')], (wt) => {
  const r = normaliseLegacyFixGates({ worktreePath: wt, events: [gateRow('local', false, ['old']), gateRow('local', true, ['green']), compiled('local', ['WI-6']), gateRow('local', false, ['later'])] });
  assert.deepEqual(r.rewritten, [{ work_item_id: 'WI-6', cmd: ['old'] }]);
}));

test('a recorded gate_cmd on the compiled event wins over the merge-gate rows', () => withWorktree([wi('WI-6')], (wt) => {
  const r = normaliseLegacyFixGates({ worktreePath: wt, events: [gateRow('local', false, LOCAL), compiled('local', ['WI-6'], { gate_cmd: ['make', 'check'] })] });
  assert.deepEqual(r.rewritten, [{ work_item_id: 'WI-6', cmd: ['make', 'check'] }]);
  assert.deepEqual(gateOf(wt, 'WI-6'), ['make', 'check']);
}));

test('ci failure without gate_cmd: the latest local event\'s cmd (the gate the fix WI would run)', () => withWorktree([wi('WI-6')], (wt) => {
  const r = normaliseLegacyFixGates({ worktreePath: wt, events: [gateRow('local', true, LOCAL), gateRow('ci', false, ['make', 'ci']), compiled('ci', ['WI-6'])] });
  assert.deepEqual(r.rewritten, [{ work_item_id: 'WI-6', cmd: LOCAL }]);
}));

test('ci failure with no local event before it: unresolved by name, WI untouched', () => withWorktree([wi('WI-6')], (wt) => {
  const r = normaliseLegacyFixGates({ worktreePath: wt, events: [gateRow('ci', false, ['make', 'ci']), compiled('ci', ['WI-6'])] });
  assert.equal(r.rewritten.length, 0);
  assert.equal(r.unresolved[0]?.work_item_id, 'WI-6');
  assert.match(r.unresolved[0]!.reason, /no local cycle\.merge-gate event/);
  assert.deepEqual(gateOf(wt, 'WI-6'), NOOP);
}));

test('docs failure (no cmd recorded): unresolved with a named reason, WI untouched', () => withWorktree([wi('WI-6')], (wt) => {
  const r = normaliseLegacyFixGates({ worktreePath: wt, events: [ev('cycle.merge-gate', { gate: 'docs', ok: false }), compiled('docs', ['WI-6'])] });
  assert.equal(r.rewritten.length, 0);
  assert.match(r.unresolved[0]!.reason, /failed_gate "docs" has no recorded command/);
  assert.deepEqual(gateOf(wt, 'WI-6'), NOOP);
}));

test('no compiled event names the WI / unreadable events: unresolved, WI untouched', () => withWorktree([wi('WI-6')], (wt) => {
  const none = normaliseLegacyFixGates({ worktreePath: wt, events: [gateRow('local', false, LOCAL), compiled('local', ['WI-9'])] });
  assert.match(none.unresolved[0]!.reason, /no merge-gate\.fix-loop\.compiled event/);
  const bad = normaliseLegacyFixGates({ worktreePath: wt, events: { unreadable: 'ENOENT' } });
  assert.match(bad.unresolved[0]!.reason, /events\.jsonl unreadable: ENOENT/);
  assert.deepEqual(gateOf(wt, 'WI-6'), NOOP);
}));

test('a recorded cmd the WI validator refuses (shell pipeline) is unresolved, not thrown', () => withWorktree([wi('WI-6')], (wt) => {
  const r = normaliseLegacyFixGates({ worktreePath: wt, events: [gateRow('local', false, ['bash', '-c', 'npm test | tail']), compiled('local', ['WI-6'])] });
  assert.match(r.unresolved[0]!.reason, /rewrite refused/);
  assert.deepEqual(gateOf(wt, 'WI-6'), NOOP);
}));

test('UNTOUCHED controls: a real-cmd fix WI, a review-fix WI, a demo-fix WI, a complete WI, a PM WI — all [true]/real but never rewritten', () => withWorktree([
  wi('WI-1', { origin: undefined, status: 'complete', quality_gate_cmd: NOOP }), // a PM WI, no origin
  wi('WI-2', { quality_gate_cmd: ['go', 'test', './...'] }), // gate-fix, real cmd
  wi('WI-3', { origin: 'review-fix' }), // legacy-shaped but a review send-back
  wi('WI-4', { origin: 'demo-fix' }),
  wi('WI-5', { status: 'complete' }), // gate-fix, ['true'], already delivered
  wi('WI-6', { status: 'failed' }), // failed: operator territory
], (wt) => {
  const events = [gateRow('local', false, LOCAL), compiled('local', ['WI-2', 'WI-3', 'WI-4', 'WI-5', 'WI-6'])];
  const r = normaliseLegacyFixGates({ worktreePath: wt, events });
  assert.deepEqual(r, { rewritten: [], unresolved: [] });
  assert.deepEqual(['WI-1', 'WI-2', 'WI-3', 'WI-4', 'WI-5', 'WI-6'].map((id) => gateOf(wt, id)),
    [NOOP, ['go', 'test', './...'], NOOP, NOOP, NOOP, NOOP]);
}));

test('an in-progress legacy gate-fix WI is rewritten too (a crashed run re-runs it)', () => withWorktree([wi('WI-6', { status: 'in-progress' })], (wt) => {
  const r = normaliseLegacyFixGates({ worktreePath: wt, events: [gateRow('local', false, LOCAL), compiled('local', ['WI-6'])] });
  assert.equal(r.rewritten.length, 1);
  assert.equal(readWorkItemsFromDir(devWorkItemsDir(wt)).items[0]!.status, 'in-progress', 'only the gate changes');
}));

test('readCycleEvents: skips a torn line, names a missing file or an escaping cycle id', () => {
  const dir = mkdtempSync(join(tmpdir(), 'legacy-gate-log-'));
  try {
    mkdirSync(join(dir, 'C1'));
    writeFileSync(join(dir, 'C1', 'events.jsonl'), `${JSON.stringify(gateRow('local', false, LOCAL))}\n{not json\n`);
    assert.equal((readCycleEvents(dir, 'C1') as CycleEvent[]).length, 1);
    assert.match((readCycleEvents(dir, 'C2') as { unreadable: string }).unreadable, /absent or refused/);
    assert.match((readCycleEvents(dir, '../C1') as { unreadable: string }).unreadable, /absent or refused/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

function reentry(items: WorkItem[], events: CycleEvent[] | null, fn: (wt: string, logPath: string, report: ReturnType<typeof normaliseLegacyFixGatesAtReentry>) => void): void {
  withWorktree(items, (wt) => {
    const logs = mkdtempSync(join(tmpdir(), 'legacy-gate-logs-'));
    try {
      mkdirSync(join(logs, 'C1'), { recursive: true });
      const logPath = join(logs, 'C1', 'events.jsonl');
      if (events) writeFileSync(logPath, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
      fn(wt, logPath, normaliseLegacyFixGatesAtReentry({ worktreePath: wt, initiativeId: INIT, cycleId: 'C1', logsRoot: logs }));
    } finally { rmSync(logs, { recursive: true, force: true }); }
  });
}
const emitted = (logPath: string) => readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { message: string; event_type: string; metadata: Record<string, unknown> })
  .filter((e) => e.message === 'fix-loop.legacy-gate.normalised');

test('re-entry: ONE log event names the rewrite', () => reentry([wi('WI-6')], [gateRow('local', false, LOCAL), compiled('local', ['WI-6'])], (_wt, logPath) => {
  const e = emitted(logPath);
  assert.equal(e.length, 1);
  assert.equal(e[0]!.event_type, 'log');
  assert.deepEqual(e[0]!.metadata, { rewritten: [{ work_item_id: 'WI-6', cmd: LOCAL }], unresolved: [] });
}));

test('re-entry: an unresolved WI is NAMED in one error event', () => reentry([wi('WI-6')], [ev('cycle.merge-gate', { gate: 'docs', ok: false }), compiled('docs', ['WI-6'])], (wt, logPath) => {
  const e = emitted(logPath);
  assert.equal(e.length, 1);
  assert.equal(e[0]!.event_type, 'error');
  assert.deepEqual((e[0]!.metadata.unresolved as Array<{ work_item_id: string }>).map((u) => u.work_item_id), ['WI-6']);
  assert.deepEqual(gateOf(wt, 'WI-6'), NOOP);
}));

test('re-entry: nothing legacy on the queue emits nothing', () => reentry([wi('WI-6', { quality_gate_cmd: LOCAL })], [compiled('local', ['WI-6'])], (_wt, logPath, report) => {
  assert.deepEqual(report, { rewritten: [], unresolved: [] });
  assert.equal(emitted(logPath).length, 0);
}));

test('re-entry: a missing events.jsonl names the WI unresolved and does not throw', () => reentry([wi('WI-6')], null, (wt, logPath, report) => {
  assert.equal(report.unresolved.length, 1);
  assert.match(report.unresolved[0]!.reason, /events\.jsonl unreadable/);
  assert.equal(emitted(logPath).length, 1);
  assert.deepEqual(gateOf(wt, 'WI-6'), NOOP);
}));
