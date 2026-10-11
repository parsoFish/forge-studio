/**
 * Bead forge-mfv5.1.36 (D-48 amended) — dependencies at the Kickoff gate, over
 * the live gitweave I2 set planted in a tmp forge root (no network, no spawn,
 * no git write):
 *
 *   - an added work item depends on the plan's LEAF work items unless the
 *     operator sets its dependencies (an explicit `[]` is a root, honoured);
 *   - `editKickoffWorkItemDeps` rewrites one pending work item's `depends_on`
 *     (worktree + snapshot), validated as a set, under the manifest lock, and
 *     is refused by name once anything is built.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';

import { addKickoffWorkItem, editKickoffWorkItemDeps, type KickoffWorkItemSource } from '../../kickoff-add-work-item.ts';
import { enqueueDevelopRun } from '../../enqueue-develop-run.ts';
import { parseWorkItem, serializeWorkItem, type WorkItem } from '../../work-item.ts';
import { I2_INIT, I2_PLAN_LEAVES, plantI2Kickoff } from '../test-fixtures/kickoff-deps-i2.ts';

const noCoverage = (): string[] => [];
const SOURCE: KickoffWorkItemSource = {
  summary: 'Live proof that gw apply --json resets before applying',
  acceptanceCriteria: [{ given: 'a stray prefixed team', when: '`python3 -m pytest tests/acceptance/test_gw_reset_before_apply.py` runs', then: 'the team is gone' }],
  qualityGateCmd: ['python3', '-m', 'pytest', 'tests/acceptance/test_gw_reset_before_apply.py'],
  filesInScope: ['tests/acceptance/test_gw_reset_before_apply.py'],
};

function withRoot(fn: (root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'forge-kickoff-deps-'));
  return fn(root).finally(() => rmSync(root, { recursive: true, force: true }));
}

const add = (root: string, source: KickoffWorkItemSource) =>
  addKickoffWorkItem({ forgeRoot: root, logsRoot: join(root, '_logs'), initiativeId: I2_INIT, source, coverage: noCoverage });
const edit = (root: string, workItemId: string, dependsOn: string[]) =>
  editKickoffWorkItemDeps({ forgeRoot: root, logsRoot: join(root, '_logs'), initiativeId: I2_INIT, workItemId, dependsOn });
const readWi = (dir: string, id: string): WorkItem => parseWorkItem(readFileSync(join(dir, `${id}.md`), 'utf8'));
const detail = (r: { status: string }) => ('detail' in r ? String(r.detail) : '');
const events = (logDir: string) => readFileSync(join(logDir, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { message: string; metadata?: unknown });

// ---- add: the default is the plan's leaves ----------------------------------

test('add without dependsOn: the new WI depends on the plan\'s leaf work items', () => withRoot(async (root) => {
  const { wiDir, snapshotDir } = plantI2Kickoff(root, { withKickoffAdds: false });
  const r = await add(root, SOURCE);
  assert.equal(r.status, 'added', detail(r));
  assert.ok(r.status === 'added');
  assert.equal(r.workItemId, 'WI-13');
  assert.deepEqual(readWi(wiDir, 'WI-13').depends_on, I2_PLAN_LEAVES, 'runs after the decomposed plan: WI-9b, WI-10, WI-11, WI-12');
  assert.deepEqual(readWi(snapshotDir, 'WI-13').depends_on, I2_PLAN_LEAVES);
}));

test('add without dependsOn beside earlier kickoff adds: their leaves count too (WI-13/14 are leaves)', () => withRoot(async (root) => {
  const { wiDir } = plantI2Kickoff(root);
  const r = await add(root, SOURCE);
  assert.ok(r.status === 'added', detail(r));
  assert.equal(r.workItemId, 'WI-15');
  assert.deepEqual(readWi(wiDir, 'WI-15').depends_on, [...I2_PLAN_LEAVES, 'WI-13', 'WI-14']);
}));

test('add with an explicit [] is a root, honoured', () => withRoot(async (root) => {
  const { wiDir } = plantI2Kickoff(root, { withKickoffAdds: false });
  const r = await add(root, { ...SOURCE, dependsOn: [] });
  assert.ok(r.status === 'added', detail(r));
  assert.deepEqual(readWi(wiDir, 'WI-13').depends_on, []);
}));

test('add with explicit dependsOn: written as given', () => withRoot(async (root) => {
  const { wiDir } = plantI2Kickoff(root, { withKickoffAdds: false });
  const r = await add(root, { ...SOURCE, dependsOn: ['WI-8'] });
  assert.ok(r.status === 'added', detail(r));
  assert.deepEqual(readWi(wiDir, 'WI-13').depends_on, ['WI-8']);
}));

test('add depending on an unknown id: invalid, naming it; nothing written', () => withRoot(async (root) => {
  const { wiDir } = plantI2Kickoff(root, { withKickoffAdds: false });
  const r = await add(root, { ...SOURCE, dependsOn: ['WI-8', 'WI-99'] });
  assert.equal(r.status, 'invalid');
  assert.match(detail(r), /depends_on references unknown work item: WI-99/);
  assert.throws(() => readWi(wiDir, 'WI-13'), /ENOENT/);
}));

test('add depending on itself (the only cycle a new WI can close): invalid, naming it', () => withRoot(async (root) => {
  plantI2Kickoff(root, { withKickoffAdds: false });
  const r = await add(root, { ...SOURCE, dependsOn: ['WI-13'] });
  assert.equal(r.status, 'invalid');
  assert.match(detail(r), /WI-13: depends_on may not reference self: WI-13/);
}));

// ---- edit: dependencies of an existing work item at the gate -----------------

test('edit WI-13\'s dependencies: worktree AND snapshot rewritten, every other field kept, event emitted', () => withRoot(async (root) => {
  const { wiDir, snapshotDir, logDir } = plantI2Kickoff(root);
  const before = readWi(wiDir, 'WI-13');
  const r = await edit(root, 'WI-13', ['WI-8']);
  assert.equal(r.status, 'edited', detail(r));
  assert.ok(r.status === 'edited');
  assert.deepEqual(r.dependsOn, ['WI-8']);
  const after = readWi(wiDir, 'WI-13');
  assert.deepEqual(after, { ...before, depends_on: ['WI-8'] });
  assert.equal(readFileSync(join(snapshotDir, 'WI-13.md'), 'utf8'), serializeWorkItem(after), 'the roadmap reads the snapshot first');
  const ev = events(logDir).find((e) => e.message === 'kickoff.work-item-deps-edited');
  assert.deepEqual(ev?.metadata, { work_item_id: 'WI-13', depends_on: ['WI-8'] });
}));

test('edit to [] makes the WI a root; an edit of a plan WI is equally allowed (nothing is built)', () => withRoot(async (root) => {
  const { wiDir } = plantI2Kickoff(root);
  assert.equal((await edit(root, 'WI-12', [])).status, 'edited');
  assert.deepEqual(readWi(wiDir, 'WI-12').depends_on, []);
}));

test('edit after anything is built: not-at-kickoff with the built reason; nothing rewritten', () => withRoot(async (root) => {
  const { wiDir } = plantI2Kickoff(root);
  writeFileSync(join(wiDir, 'WI-1.md'), serializeWorkItem({ ...readWi(wiDir, 'WI-1'), status: 'complete' }));
  const before = readFileSync(join(wiDir, 'WI-13.md'), 'utf8');
  const r = await edit(root, 'WI-13', ['WI-8']);
  assert.equal(r.status, 'not-at-kickoff');
  assert.match(detail(r), /a work item is complete/);
  assert.equal(readFileSync(join(wiDir, 'WI-13.md'), 'utf8'), before);
}));

test('edit of an unknown work item: not-found, naming it', () => withRoot(async (root) => {
  plantI2Kickoff(root);
  const r = await edit(root, 'WI-99', ['WI-8']);
  assert.equal(r.status, 'not-found');
  assert.match(detail(r), /WI-99/);
}));

test('edit that closes a cycle: invalid, naming the cycle; nothing rewritten', () => withRoot(async (root) => {
  const { wiDir } = plantI2Kickoff(root);
  const before = readFileSync(join(wiDir, 'WI-1.md'), 'utf8');
  const r = await edit(root, 'WI-1', ['WI-2']);
  assert.equal(r.status, 'invalid');
  assert.match(detail(r), /work-item dependency cycle: .*WI-1.*WI-2|work-item dependency cycle: .*WI-2.*WI-1/);
  assert.equal(readFileSync(join(wiDir, 'WI-1.md'), 'utf8'), before);
}));

test('edit naming an unknown id or itself: invalid, naming it', () => withRoot(async (root) => {
  plantI2Kickoff(root);
  assert.match(detail(await edit(root, 'WI-13', ['WI-77'])), /depends_on references unknown work item: WI-77/);
  assert.match(detail(await edit(root, 'WI-13', ['WI-13'])), /depends_on may not reference self: WI-13/);
}));

test('edit lock: Start development landing between the outer check and the lock is refused not-at-kickoff; nothing rewritten', () => withRoot(async (root) => {
  const { manifestPath, wiDir } = plantI2Kickoff(root);
  const before = readFileSync(join(wiDir, 'WI-13.md'), 'utf8');
  await lockfile.lock(manifestPath, { realpath: false });
  const pending = edit(root, 'WI-13', ['WI-8']); // passes the outer check, then waits on the lock
  await new Promise((r) => setTimeout(r, 20));
  lockfile.unlockSync(manifestPath, { realpath: false });
  const e = enqueueDevelopRun(I2_INIT, { queueRoot: join(root, '_queue') });
  assert.equal(e.status, 'enqueued', e.detail);
  const r = await pending;
  assert.equal(r.status, 'not-at-kickoff');
  assert.equal(readFileSync(join(wiDir, 'WI-13.md'), 'utf8'), before, 'nothing rewritten once development started');
}));
