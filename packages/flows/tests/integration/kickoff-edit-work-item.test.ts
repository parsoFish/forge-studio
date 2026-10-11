/**
 * Bead forge-nk1y.32 (D-48 amended) — a work item ADDED at the Kickoff gate
 * (its `kickoff.work-item-added` event) can be edited in full or deleted until
 * anything is built; every scope entry submitted at the gate is one relative
 * path. Over gitweave I2 as it stands live (`plantI2Kickoff(root, { live: true })`:
 * WI-14 holds ONE files_in_scope entry naming two paths — it can never pass).
 * Tmp roots only: no network, no spawn, no git write.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';

import { scopeEntryErrors } from '@forge/contracts';
import { addKickoffWorkItem, deleteKickoffWorkItem, editKickoffWorkItem, type KickoffWorkItemEdit, type KickoffWorkItemSource } from '../../kickoff-add-work-item.ts';
import { enqueueDevelopRun } from '../../enqueue-develop-run.ts';
import { parseManifest } from '../../manifest.ts';
import { parseWorkItem, serializeWorkItem, type WorkItem } from '../../work-item.ts';
import { I2_INIT, plantI2Kickoff } from '../test-fixtures/kickoff-deps-i2.ts';

const WI14_ENTRY = 'tests/test_docs_no_terraform_tokens.py .github/copilot-context.md'; // verbatim, live
const FIXED = ['tests/test_docs_no_terraform_tokens.py', '.github/copilot-context.md'];
const SOURCE: KickoffWorkItemSource = {
  summary: 'Live proof that gw apply --json resets before applying',
  acceptanceCriteria: [{ given: 'a stray prefixed team', when: 'the reset test runs', then: 'the team is gone' }],
  qualityGateCmd: ['python3', '-m', 'pytest', 'tests/acceptance/test_gw_reset_before_apply.py'],
  filesInScope: ['tests/acceptance/test_gw_reset_before_apply.py'],
};

function withRoot(fn: (root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'forge-kickoff-edit-'));
  return fn(root).finally(() => rmSync(root, { recursive: true, force: true }));
}
const gate = (root: string) => ({ forgeRoot: root, logsRoot: join(root, '_logs'), initiativeId: I2_INIT });
const add = (root: string, source: KickoffWorkItemSource) => addKickoffWorkItem({ ...gate(root), source, coverage: () => [] });
const edit = (root: string, workItemId: string, e: KickoffWorkItemEdit) => editKickoffWorkItem({ ...gate(root), workItemId, edit: e });
const del = (root: string, workItemId: string) => deleteKickoffWorkItem({ ...gate(root), workItemId });
const readWi = (dir: string, id: string): WorkItem => parseWorkItem(readFileSync(join(dir, `${id}.md`), 'utf8'));
const detail = (r: { status: string }) => ('detail' in r ? String(r.detail) : '');
const events = (logDir: string) => readFileSync(join(logDir, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { message: string; metadata?: unknown });
const built = (wiDir: string) => writeFileSync(join(wiDir, 'WI-1.md'), serializeWorkItem({ ...readWi(wiDir, 'WI-1'), status: 'complete' }));

// ---- (c) the path rule ---------------------------------------------------------

test('scopeEntryErrors: one relative path per entry — whitespace, "..", leading "/", empty refused by name', () => {
  assert.deepEqual(scopeEntryErrors('files_in_scope', ['a/b.py', '.github/x.md']), []);
  const cases: Array<[string, RegExp]> = [
    [WI14_ENTRY, /contains whitespace/], ['a\tb', /contains whitespace/], ['../x', /".." segment/], ['a/../x', /".." segment/],
    ['/abs', /absolute/], ['', /is empty/],
  ];
  for (const [entry, why] of cases) {
    const [e] = scopeEntryErrors('files_in_scope', [entry]);
    assert.ok(e?.startsWith(`files_in_scope entry ${JSON.stringify(entry)} refused: `), e);
    assert.match(e!, why);
    assert.match(e!, /one relative path per entry/);
  }
  assert.match(scopeEntryErrors('creates', ['/x'])[0]!, /^creates entry "\/x" refused: is absolute/);
});

test('add: the live WI-14 entry (two paths on one line) is invalid, naming it; nothing written, nothing split', () => withRoot(async (root) => {
  const { wiDir } = plantI2Kickoff(root, { withKickoffAdds: false });
  const r = await add(root, { ...SOURCE, filesInScope: [WI14_ENTRY] });
  assert.equal(r.status, 'invalid');
  assert.match(detail(r), /files_in_scope entry "tests\/test_docs_no_terraform_tokens\.py \.github\/copilot-context\.md" refused: contains whitespace/);
  assert.equal(existsSync(join(wiDir, 'WI-13.md')), false);
  for (const bad of ['../x', '/abs', '', 'a\tb']) assert.equal((await add(root, { ...SOURCE, filesInScope: [bad] })).status, 'invalid', bad);
  const c = await add(root, { ...SOURCE, creates: ['/abs'] });
  assert.equal(c.status, 'invalid');
  assert.match(detail(c), /creates entry "\/abs" refused/);
}));

test('add with creates (each in files_in_scope): written; a creates entry outside files_in_scope is invalid', () => withRoot(async (root) => {
  const { wiDir } = plantI2Kickoff(root, { withKickoffAdds: false });
  const ok = await add(root, { ...SOURCE, creates: [SOURCE.filesInScope[0]!] });
  assert.equal(ok.status, 'added', detail(ok));
  assert.deepEqual(readWi(wiDir, 'WI-13').creates, SOURCE.filesInScope);
  const bad = await add(root, { ...SOURCE, creates: ['tests/other.py'] });
  assert.match(detail(bad), /creates entry tests\/other\.py must appear in files_in_scope/);
}));

// ---- (a) full edit of a kickoff-added work item ----------------------------------

test('edit WI-14 (live): files_in_scope fixed + creates set → worktree AND snapshot rewritten, event lists the changed fields', () => withRoot(async (root) => {
  const { wiDir, snapshotDir, logDir } = plantI2Kickoff(root, { withKickoffAdds: true, live: true });
  const before = readWi(wiDir, 'WI-14');
  assert.deepEqual(before.files_in_scope, [WI14_ENTRY], 'the live defect');
  const r = await edit(root, 'WI-14', { filesInScope: FIXED, creates: [FIXED[0]!], summary: before.body.trim() });
  assert.equal(r.status, 'edited', detail(r));
  const after = readWi(wiDir, 'WI-14');
  assert.deepEqual(after, { ...before, files_in_scope: FIXED, creates: [FIXED[0]!] });
  assert.equal(readFileSync(join(snapshotDir, 'WI-14.md'), 'utf8'), serializeWorkItem(after));
  const ev = events(logDir).filter((e) => e.message === 'kickoff.work-item-edited').at(-1);
  assert.deepEqual(ev?.metadata, { work_item_id: 'WI-14', fields: ['filesInScope', 'creates'] }, 'summary was submitted unchanged: not listed');
}));

test('edit WI-14: summary, acceptance criteria, gate command and dependencies, all at once', () => withRoot(async (root) => {
  const { wiDir, logDir } = plantI2Kickoff(root, { withKickoffAdds: true, live: true });
  const e: KickoffWorkItemEdit = {
    summary: 'No Terraform tokens in docs', acceptanceCriteria: [{ given: 'g', when: 'w', then: 't' }],
    qualityGateCmd: ['python3', '-m', 'pytest', 'tests/x.py'], filesInScope: ['tests/x.py'], creates: [], dependsOn: ['WI-13'],
  };
  const r = await edit(root, 'WI-14', e);
  assert.equal(r.status, 'edited', detail(r));
  const wi = readWi(wiDir, 'WI-14');
  assert.equal(wi.body.trim(), 'No Terraform tokens in docs');
  assert.deepEqual([wi.acceptance_criteria, wi.quality_gate_cmd, wi.files_in_scope, wi.creates, wi.depends_on],
    [e.acceptanceCriteria, e.qualityGateCmd, ['tests/x.py'], undefined, ['WI-13']]);
  assert.deepEqual((events(logDir).at(-1)?.metadata as { fields: string[] }).fields, ['summary', 'acceptanceCriteria', 'qualityGateCmd', 'filesInScope', 'dependsOn']);
}));

test('edit WI-14 leaving its bad entry (summary only): invalid, the path rule names the entry; nothing rewritten', () => withRoot(async (root) => {
  const { wiDir } = plantI2Kickoff(root, { withKickoffAdds: true, live: true });
  const before = readFileSync(join(wiDir, 'WI-14.md'), 'utf8');
  const r = await edit(root, 'WI-14', { summary: 'x' });
  assert.equal(r.status, 'invalid');
  assert.match(detail(r), /files_in_scope entry ".*copilot-context\.md" refused: contains whitespace/);
  for (const bad of ['../x', '/abs', '', 'a\tb']) assert.equal((await edit(root, 'WI-14', { filesInScope: [bad] })).status, 'invalid', bad);
  assert.equal(readFileSync(join(wiDir, 'WI-14.md'), 'utf8'), before);
}));

test('edit: a gate pipeline or a cycle in the resulting set is invalid, named', () => withRoot(async (root) => {
  plantI2Kickoff(root, { withKickoffAdds: true, live: true });
  assert.equal((await edit(root, 'WI-14', { filesInScope: FIXED, qualityGateCmd: ['bash', '-c', 'pytest | grep ok'] })).status, 'invalid');
  assert.equal((await edit(root, 'WI-14', { filesInScope: FIXED, dependsOn: ['WI-13'] })).status, 'edited');
  assert.match(detail(await edit(root, 'WI-13', { summary: 'x', dependsOn: ['WI-14'] })), /work-item dependency cycle/);
}));

test('edit a PLAN work item: any field but dependsOn is refused not-a-kickoff-work-item; dependsOn-only still edits (row 11)', () => withRoot(async (root) => {
  const { wiDir } = plantI2Kickoff(root, { withKickoffAdds: true, live: true });
  const before = readFileSync(join(wiDir, 'WI-12.md'), 'utf8');
  const r = await edit(root, 'WI-12', { summary: 'rewritten' });
  assert.equal(r.status, 'not-a-kickoff-work-item');
  assert.match(detail(r), /WI-12/);
  assert.equal(readFileSync(join(wiDir, 'WI-12.md'), 'utf8'), before);
  assert.equal((await edit(root, 'WI-12', { dependsOn: [] })).status, 'edited');
  assert.deepEqual(readWi(wiDir, 'WI-12').depends_on, []);
}));

test('edit after anything is built: not-at-kickoff; nothing rewritten', () => withRoot(async (root) => {
  const { wiDir } = plantI2Kickoff(root, { withKickoffAdds: true, live: true });
  built(wiDir);
  const r = await edit(root, 'WI-14', { filesInScope: FIXED });
  assert.equal(r.status, 'not-at-kickoff');
  assert.deepEqual(readWi(wiDir, 'WI-14').files_in_scope, [WI14_ENTRY]);
}));

test('edit with an unreadable events log: refused not-a-kickoff-work-item (fail closed), naming the log', () => withRoot(async (root) => {
  const { wiDir, logDir } = plantI2Kickoff(root, { withKickoffAdds: true, live: true });
  rmSync(join(logDir, 'events.jsonl'));
  const r = await edit(root, 'WI-14', { filesInScope: FIXED });
  assert.equal(r.status, 'not-a-kickoff-work-item');
  assert.match(detail(r), /events\.jsonl/);
  assert.deepEqual(readWi(wiDir, 'WI-14').files_in_scope, [WI14_ENTRY]);
}));

// ---- (b) delete a kickoff-added work item ------------------------------------------

test('delete WI-14 (no dependents): gone from the worktree, the snapshot and the manifest specs; event emitted', () => withRoot(async (root) => {
  const { wiDir, snapshotDir, manifestPath, logDir } = plantI2Kickoff(root, { withKickoffAdds: true, live: true });
  assert.ok(parseManifest(readFileSync(manifestPath, 'utf8')).specs?.includes('WI-14'));
  const r = await del(root, 'WI-14');
  assert.equal(r.status, 'deleted', detail(r));
  assert.equal(existsSync(join(wiDir, 'WI-14.md')), false);
  assert.equal(existsSync(join(snapshotDir, 'WI-14.md')), false);
  assert.equal(parseManifest(readFileSync(manifestPath, 'utf8')).specs?.includes('WI-14'), false);
  assert.deepEqual(events(logDir).at(-1), { ...events(logDir).at(-1), message: 'kickoff.work-item-deleted', metadata: { work_item_id: 'WI-14' } });
}));

test('delete WI-13 while WI-14 depends on it: has-dependents naming WI-14; nothing changed', () => withRoot(async (root) => {
  const { wiDir, manifestPath } = plantI2Kickoff(root, { withKickoffAdds: true, live: true });
  assert.equal((await edit(root, 'WI-14', { dependsOn: ['WI-13'] })).status, 'edited');
  const manifest = readFileSync(manifestPath, 'utf8');
  const r = await del(root, 'WI-13');
  assert.equal(r.status, 'has-dependents');
  assert.match(detail(r), /WI-14/);
  assert.equal(existsSync(join(wiDir, 'WI-13.md')), true);
  assert.equal(readFileSync(manifestPath, 'utf8'), manifest);
}));

test('delete a plan work item: not-a-kickoff-work-item; after anything is built: not-at-kickoff', () => withRoot(async (root) => {
  const { wiDir } = plantI2Kickoff(root, { withKickoffAdds: true, live: true });
  const a = await del(root, 'WI-12');
  assert.equal(a.status, 'not-a-kickoff-work-item');
  assert.equal(existsSync(join(wiDir, 'WI-12.md')), true);
  built(wiDir);
  assert.equal((await del(root, 'WI-14')).status, 'not-at-kickoff');
  assert.equal(existsSync(join(wiDir, 'WI-14.md')), true);
}));

test('delete with an unreadable events log: refused (fail closed); an unknown id: not-found', () => withRoot(async (root) => {
  const { wiDir, logDir } = plantI2Kickoff(root, { withKickoffAdds: true, live: true });
  rmSync(join(logDir, 'events.jsonl'));
  const r = await del(root, 'WI-14');
  assert.equal(r.status, 'not-a-kickoff-work-item');
  assert.match(detail(r), /events\.jsonl/);
  assert.equal(existsSync(join(wiDir, 'WI-14.md')), true);
  assert.equal((await del(root, 'WI-99')).status, 'not-found');
}));

test('delete lock: Start development landing while it waits is refused not-at-kickoff; nothing removed', () => withRoot(async (root) => {
  const { manifestPath, wiDir } = plantI2Kickoff(root, { withKickoffAdds: true, live: true });
  await lockfile.lock(manifestPath, { realpath: false });
  const pending = del(root, 'WI-14');
  await new Promise((r) => setTimeout(r, 20));
  lockfile.unlockSync(manifestPath, { realpath: false });
  assert.equal(enqueueDevelopRun(I2_INIT, { queueRoot: join(root, '_queue') }).status, 'enqueued');
  const r = await pending;
  assert.equal(r.status, 'not-at-kickoff');
  assert.equal(existsSync(join(wiDir, 'WI-14.md')), true);
}));

test('a kickoff-added work item deleted then re-added keeps its provenance (the added event names the reused id)', () => withRoot(async (root) => {
  const { wiDir } = plantI2Kickoff(root, { withKickoffAdds: true, live: true });
  assert.equal((await del(root, 'WI-14')).status, 'deleted');
  const r = await add(root, { ...SOURCE, filesInScope: FIXED });
  assert.ok(r.status === 'added' && r.workItemId === 'WI-14', detail(r));
  assert.equal((await edit(root, 'WI-14', { summary: 'again' })).status, 'edited');
  assert.equal(readWi(wiDir, 'WI-14').body.trim(), 'again');
}));
