/**
 * forge-mfv5.1.47 (row 3, D-06 + D-20) — a develop resume whose
 * `.forge/work-items` is gone restores it from the cycle's own durable record:
 * the `work-items-snapshot/` copy and the typed `reviewer.verdict.send-back`
 * events that appended fix items after the snapshot was taken (the measured
 * I3b shape: snapshot WI-1..14, WI-15 only in the send-back event). Either
 * source missing in a way that leaves the set incomplete is a refusal by name,
 * never "no work items found". Tmp roots only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { restoreWorkItemsForResume } from '../../work-items-restore.ts';
import { parseWorkItem, serializeWorkItem, type WorkItem } from '../../work-item.ts';

const ID = 'INIT-2026-10-16-restore';
const CYCLE = `2026-10-16T08-00-00_${ID}`;

function wi(id: string, status: WorkItem['status'], files: string[]): WorkItem {
  return {
    work_item_id: id,
    initiative_id: ID,
    status,
    depends_on: [],
    acceptance_criteria: [{ given: 'g', when: 'w', then: 't' }],
    files_in_scope: files,
    quality_gate_cmd: ['npm', 'test'],
    estimated_iterations: 3,
    body: `# ${id}\n`,
  };
}

const SEND_BACK_ACS = [
  { id: 'AC1', given: 'the CLI', when: 'python3 -m pytest tests/acceptance -q', then: 'it fails naming the var', check: { argv: ['python3', '-m', 'pytest', 'tests/acceptance', '-q'], expect: 'fail', unsetEnv: ['GW_CALLER_TOKEN'] } },
  { id: 'AC2', given: 'the package', when: 'grep runs', then: 'no match', check: { argv: ['python3', '-c', 'import sys; sys.exit(0)'], expect: 'pass' } },
];

type World = { dir: string; wt: string; logsRoot: string };

function world(opts: { snapshot: boolean; sendBack: 'none' | 'typed' | 'no-gate'; worktreeItems?: boolean }): World {
  const dir = mkdtempSync(join(tmpdir(), 'forge-wi-restore-'));
  const wt = join(dir, 'wt');
  mkdirSync(join(wt, '.forge', 'work-items'), { recursive: true });
  if (opts.worktreeItems) writeFileSync(join(wt, '.forge', 'work-items', 'WI-1.md'), serializeWorkItem(wi('WI-1', 'complete', ['src/live.ts'])));
  const logsRoot = join(dir, '_logs');
  const cycleDir = join(logsRoot, CYCLE);
  mkdirSync(cycleDir, { recursive: true });
  if (opts.snapshot) {
    const snap = join(cycleDir, 'work-items-snapshot');
    mkdirSync(snap);
    writeFileSync(join(snap, 'WI-1.md'), serializeWorkItem(wi('WI-1', 'complete', ['src/a.ts'])));
    writeFileSync(join(snap, 'WI-2.md'), serializeWorkItem(wi('WI-2', 'complete', ['src/b.ts'])));
    writeFileSync(join(snap, '_graph.md'), '# graph\n');
    writeFileSync(join(snap, '_decomposition.md'), '# decomposition\n');
  }
  const lines = [JSON.stringify({ message: 'pm.work-item-emitted', metadata: { work_item_id: 'WI-1' } })];
  if (opts.sendBack !== 'none') {
    lines.push(JSON.stringify({
      message: 'reviewer.verdict.send-back',
      initiative_id: ID,
      metadata: {
        decided_by: 'operator',
        rationale: 'verdict 2: AC1 and AC2 unmet at head',
        acceptance_criteria: SEND_BACK_ACS,
        concern_kind: 'code-fix',
        quality_gate_cmd: opts.sendBack === 'typed' ? ['python3', '-m', 'pytest', 'tests/'] : null,
        appended_work_items: ['WI-3'],
        origin: 'review-fix',
        round: 2,
      },
    }));
  }
  writeFileSync(join(cycleDir, 'events.jsonl'), lines.join('\n') + '\n');
  return { dir, wt, logsRoot };
}

const restore = (w: World) => restoreWorkItemsForResume({ worktreePath: w.wt, initiativeId: ID, cycleId: CYCLE, logsRoot: w.logsRoot });
const wiDir = (w: World): string => join(w.wt, '.forge', 'work-items');

test('restore: an empty .forge/work-items + a snapshot + a typed send-back → snapshot WIs + _graph/_decomposition copied, the fix item re-minted pending with its checks', () => {
  const w = world({ snapshot: true, sendBack: 'typed' });
  try {
    const r = restore(w);
    assert.deepEqual(r, { status: 'restored', fromSnapshot: ['WI-1', 'WI-2'], reminted: ['WI-3'] });
    assert.deepEqual(readdirSync(wiDir(w)).sort(), ['WI-1.md', 'WI-2.md', 'WI-3.md', '_decomposition.md', '_graph.md']);
    assert.equal(parseWorkItem(readFileSync(join(wiDir(w), 'WI-1.md'), 'utf8')).status, 'complete', 'snapshot status kept');
    const fix = parseWorkItem(readFileSync(join(wiDir(w), 'WI-3.md'), 'utf8'));
    assert.equal(fix.status, 'pending');
    assert.equal(fix.origin, 'review-fix');
    assert.deepEqual(fix.quality_gate_cmd, ['python3', '-m', 'pytest', 'tests/']);
    assert.equal(fix.acceptance_criteria.length, 2);
    assert.deepEqual(fix.acceptance_criteria.map((a) => a.check?.expect), ['fail', 'pass'], 'every falsifying check survives the re-mint');
    assert.deepEqual(fix.acceptance_criteria[0]!.check?.unsetEnv, ['GW_CALLER_TOKEN']);
    for (const f of ['src/a.ts', 'src/b.ts']) assert.ok(fix.files_in_scope.includes(f), `scope is the dev-WI union (${f})`);
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('restore: a send-back alone (no snapshot) cannot rebuild the dev items it builds on — refused by name', () => {
  const w = world({ snapshot: false, sendBack: 'typed' });
  try {
    const r = restore(w);
    assert.equal(r.status, 'refused');
    if (r.status === 'refused') assert.match(r.reason, /work-items-snapshot/);
    assert.deepEqual(readdirSync(wiDir(w)), [], 'nothing written on a refusal');
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('restore: neither a snapshot nor a send-back → refused by name, naming the missing sources', () => {
  const w = world({ snapshot: false, sendBack: 'none' });
  try {
    const r = restore(w);
    assert.equal(r.status, 'refused');
    if (r.status === 'refused') assert.match(r.reason, /no work-items-snapshot/);
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('restore: a send-back event that carries no gate cannot be re-minted exactly — refused by name, nothing written', () => {
  const w = world({ snapshot: true, sendBack: 'no-gate' });
  try {
    const r = restore(w);
    assert.equal(r.status, 'refused');
    if (r.status === 'refused') assert.match(r.reason, /WI-3.*no quality_gate_cmd/);
    assert.deepEqual(readdirSync(wiDir(w)), [], 'all-or-nothing: the snapshot copy is not left half-done');
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('restore: a non-empty .forge/work-items is present — nothing is touched', () => {
  const w = world({ snapshot: true, sendBack: 'typed', worktreeItems: true });
  try {
    assert.deepEqual(restore(w), { status: 'present' });
    assert.deepEqual(readdirSync(wiDir(w)), ['WI-1.md']);
    assert.ok(readFileSync(join(wiDir(w), 'WI-1.md'), 'utf8').includes('src/live.ts'), 'the live copy wins');
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});

test('restore: a send-back whose fix item IS in the snapshot is not minted twice', () => {
  const w = world({ snapshot: true, sendBack: 'typed' });
  try {
    const snap = join(w.logsRoot, CYCLE, 'work-items-snapshot');
    writeFileSync(join(snap, 'WI-3.md'), serializeWorkItem({ ...wi('WI-3', 'complete', ['src/c.ts']), origin: 'review-fix' }));
    const r = restore(w);
    assert.deepEqual(r, { status: 'restored', fromSnapshot: ['WI-1', 'WI-2', 'WI-3'], reminted: [] });
    assert.equal(parseWorkItem(readFileSync(join(wiDir(w), 'WI-3.md'), 'utf8')).status, 'complete');
    assert.ok(!existsSync(join(wiDir(w), 'WI-4.md')));
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
  }
});
