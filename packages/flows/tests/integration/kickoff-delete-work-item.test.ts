/**
 * Bead forge-nk1y.32 12b (D-48 amended) — a work item ADDED at the Kickoff gate
 * (its `kickoff.work-item-added` event) can be deleted until anything is
 * built; deletion is refused while another work item depends on it. Over
 * gitweave I2 as it stands live (`plantI2Kickoff(root, { live: true })`).
 * Tmp roots only: no network, no spawn, no git write.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';

import {
  addKickoffWorkItem,
  deleteKickoffWorkItem,
  editKickoffWorkItem,
  type KickoffWorkItemEdit,
  type KickoffWorkItemSource,
} from '../../kickoff-add-work-item.ts';
import { enqueueDevelopRun } from '../../enqueue-develop-run.ts';
import { parseManifest } from '../../manifest.ts';
import { parseWorkItem, serializeWorkItem, type WorkItem } from '../../work-item.ts';
import { I2_INIT, plantI2Kickoff } from '../test-fixtures/kickoff-deps-i2.ts';

const FIXED = ['tests/test_docs_no_terraform_tokens.py', '.github/copilot-context.md'];
const SOURCE: KickoffWorkItemSource = {
  summary: 'No Terraform references left in agent context or docs',
  acceptanceCriteria: [{ given: 'the repository after I2', when: 'the docs test runs', then: 'no Terraform tokens remain' , check: { argv: ['python3', '-m', 'pytest', 'tests/'], expect: 'pass' as const } }],
  qualityGateCmd: ['python3', '-m', 'pytest', 'tests/test_docs_no_terraform_tokens.py'],
  filesInScope: FIXED,
};

function withRoot(fn: (root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'forge-kickoff-delete-'));
  return fn(root).finally(() => rmSync(root, { recursive: true, force: true }));
}
const live = (root: string) => plantI2Kickoff(root, { withKickoffAdds: true, live: true });
const gate = (root: string) => ({ forgeRoot: root, logsRoot: join(root, '_logs'), initiativeId: I2_INIT });
const add = (root: string, source: KickoffWorkItemSource) => addKickoffWorkItem({ ...gate(root), source, coverage: () => [] });
const edit = (root: string, workItemId: string, e: KickoffWorkItemEdit) => editKickoffWorkItem({ ...gate(root), workItemId, edit: e });
const del = (root: string, workItemId: string) => deleteKickoffWorkItem({ ...gate(root), workItemId });
const readWi = (dir: string, id: string): WorkItem => parseWorkItem(readFileSync(join(dir, `${id}.md`), 'utf8'));
const detail = (r: { status: string }) => ('detail' in r ? String(r.detail) : '');
const specs = (manifestPath: string) => parseManifest(readFileSync(manifestPath, 'utf8')).specs ?? [];
type Ev = { message: string; metadata?: unknown };
const lastEvent = (logDir: string): Ev | undefined => {
  const lines = readFileSync(join(logDir, 'events.jsonl'), 'utf8').trim().split('\n');
  return lines.map((l) => JSON.parse(l) as Ev).at(-1);
};
const built = (wiDir: string) => {
  writeFileSync(join(wiDir, 'WI-1.md'), serializeWorkItem({ ...readWi(wiDir, 'WI-1'), status: 'complete' }));
};

test('delete WI-14 (no dependents): gone from the worktree, the snapshot and the specs; event emitted', () => withRoot(async (root) => {
  const { wiDir, snapshotDir, manifestPath, logDir } = live(root);
  assert.ok(specs(manifestPath).includes('WI-14'));
  const r = await del(root, 'WI-14');
  assert.equal(r.status, 'deleted', detail(r));
  assert.equal(existsSync(join(wiDir, 'WI-14.md')), false);
  assert.equal(existsSync(join(snapshotDir, 'WI-14.md')), false);
  assert.equal(specs(manifestPath).includes('WI-14'), false);
  const ev = lastEvent(logDir);
  assert.equal(ev?.message, 'kickoff.work-item-deleted');
  assert.deepEqual(ev?.metadata, { work_item_id: 'WI-14' });
}));

test('delete WI-13 while WI-14 depends on it: has-dependents naming WI-14; nothing changed', () => withRoot(async (root) => {
  const { wiDir, manifestPath } = live(root);
  assert.equal((await edit(root, 'WI-14', { dependsOn: ['WI-13'] })).status, 'edited');
  const manifest = readFileSync(manifestPath, 'utf8');
  const r = await del(root, 'WI-13');
  assert.equal(r.status, 'has-dependents');
  assert.match(detail(r), /WI-14/);
  assert.equal(existsSync(join(wiDir, 'WI-13.md')), true);
  assert.equal(readFileSync(manifestPath, 'utf8'), manifest);
}));

test('delete a plan work item: not-a-kickoff-work-item; after anything is built: not-at-kickoff', () => withRoot(async (root) => {
  const { wiDir } = live(root);
  const a = await del(root, 'WI-12');
  assert.equal(a.status, 'not-a-kickoff-work-item');
  assert.equal(existsSync(join(wiDir, 'WI-12.md')), true);
  built(wiDir);
  assert.equal((await del(root, 'WI-14')).status, 'not-at-kickoff');
  assert.equal(existsSync(join(wiDir, 'WI-14.md')), true);
}));

test('delete with an unreadable events log: refused (fail closed); an unknown id: not-found', () => withRoot(async (root) => {
  const { wiDir, logDir } = live(root);
  rmSync(join(logDir, 'events.jsonl'));
  const r = await del(root, 'WI-14');
  assert.equal(r.status, 'not-a-kickoff-work-item');
  assert.match(detail(r), /events\.jsonl/);
  assert.equal(existsSync(join(wiDir, 'WI-14.md')), true);
  assert.equal((await del(root, 'WI-99')).status, 'not-found');
}));

test('delete lock: Start development landing while it waits is refused by the in-lock re-check', () => withRoot(async (root) => {
  const { manifestPath, wiDir } = live(root);
  await lockfile.lock(manifestPath, { realpath: false });
  const pending = del(root, 'WI-14');
  await new Promise((r) => setTimeout(r, 20));
  lockfile.unlockSync(manifestPath, { realpath: false });
  assert.equal(enqueueDevelopRun(I2_INIT, { queueRoot: join(root, '_queue') }).status, 'enqueued');
  const r = await pending;
  assert.equal(r.status, 'not-at-kickoff');
  assert.match(detail(r), /while the request waited on its lock/, 'refused by the re-check, not by a later write failing');
  assert.equal(existsSync(join(wiDir, 'WI-14.md')), true);
}));

test('deleted then re-added: the reused id is kickoff-added again (a new added event)', () => withRoot(async (root) => {
  const { wiDir } = live(root);
  assert.equal((await del(root, 'WI-14')).status, 'deleted');
  const r = await add(root, SOURCE);
  assert.ok(r.status === 'added' && r.workItemId === 'WI-14', detail(r));
  assert.equal((await edit(root, 'WI-14', { summary: 'again' })).status, 'edited');
  assert.equal(readWi(wiDir, 'WI-14').body.trim(), 'again');
}));
