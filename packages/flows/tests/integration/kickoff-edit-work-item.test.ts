/**
 * Bead forge-nk1y.32 (D-48 amended) — a work item ADDED at the Kickoff gate
 * (its `kickoff.work-item-added` event) can be edited in full until anything
 * is built; every scope entry submitted at the gate is one relative path. Over
 * gitweave I2 as it stands live (`plantI2Kickoff(root, { live: true })`: WI-14
 * holds ONE files_in_scope entry naming two paths — it can never pass).
 * Tmp roots only: no network, no spawn, no git write.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';

import { scopeEntryErrors } from '@forge/contracts';
import {
  addKickoffWorkItem,
  editKickoffWorkItem,
  type KickoffWorkItemEdit,
  type KickoffWorkItemSource,
} from '../../kickoff-add-work-item.ts';
import { enqueueDevelopRun } from '../../enqueue-develop-run.ts';
import { parseWorkItem, serializeWorkItem, type WorkItem } from '../../work-item.ts';
import { I2_INIT, plantI2Kickoff } from '../test-fixtures/kickoff-deps-i2.ts';

const WI14_ENTRY = 'tests/test_docs_no_terraform_tokens.py .github/copilot-context.md'; // verbatim, live
const FIXED = ['tests/test_docs_no_terraform_tokens.py', '.github/copilot-context.md'];
const BAD_ENTRIES = ['../x', '/abs', '', 'a\tb'];
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
const live = (root: string) => plantI2Kickoff(root, { withKickoffAdds: true, live: true });
const gate = (root: string) => ({ forgeRoot: root, logsRoot: join(root, '_logs'), initiativeId: I2_INIT });
const add = (root: string, source: KickoffWorkItemSource) => addKickoffWorkItem({ ...gate(root), source, coverage: () => [] });
const edit = (root: string, workItemId: string, e: KickoffWorkItemEdit) => editKickoffWorkItem({ ...gate(root), workItemId, edit: e });
const readWi = (dir: string, id: string): WorkItem => parseWorkItem(readFileSync(join(dir, `${id}.md`), 'utf8'));
const detail = (r: { status: string }) => ('detail' in r ? String(r.detail) : '');
type Ev = { message: string; metadata?: unknown };
const events = (logDir: string): Ev[] => {
  const lines = readFileSync(join(logDir, 'events.jsonl'), 'utf8').trim().split('\n');
  return lines.map((l) => JSON.parse(l) as Ev);
};
const built = (wiDir: string) => {
  writeFileSync(join(wiDir, 'WI-1.md'), serializeWorkItem({ ...readWi(wiDir, 'WI-1'), status: 'complete' }));
};

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

test('add: the live WI-14 entry (two paths, one line) is invalid, naming it; nothing written or split', () => withRoot(async (root) => {
  const { wiDir } = plantI2Kickoff(root, { withKickoffAdds: false });
  const r = await add(root, { ...SOURCE, filesInScope: [WI14_ENTRY] });
  assert.equal(r.status, 'invalid');
  assert.ok(detail(r).includes(`files_in_scope entry "${WI14_ENTRY}" refused: contains whitespace`), detail(r));
  assert.equal(existsSync(join(wiDir, 'WI-13.md')), false);
  for (const bad of BAD_ENTRIES) {
    assert.equal((await add(root, { ...SOURCE, filesInScope: [bad] })).status, 'invalid', bad);
  }
  const c = await add(root, { ...SOURCE, creates: ['/abs'] });
  assert.equal(c.status, 'invalid');
  assert.match(detail(c), /creates entry "\/abs" refused/);
}));

test('add with creates: written; a creates entry outside files_in_scope is invalid', () => withRoot(async (root) => {
  const { wiDir } = plantI2Kickoff(root, { withKickoffAdds: false });
  const ok = await add(root, { ...SOURCE, creates: [SOURCE.filesInScope[0]!] });
  assert.equal(ok.status, 'added', detail(ok));
  assert.deepEqual(readWi(wiDir, 'WI-13').creates, SOURCE.filesInScope);
  const bad = await add(root, { ...SOURCE, creates: ['tests/other.py'] });
  assert.match(detail(bad), /creates entry tests\/other\.py must appear in files_in_scope/);
}));

// ---- (a) full edit of a kickoff-added work item ----------------------------------

test('edit WI-14 (live): scope fixed + creates → worktree and snapshot rewritten; event lists changes', () => withRoot(async (root) => {
  const { wiDir, snapshotDir, logDir } = live(root);
  const before = readWi(wiDir, 'WI-14');
  assert.deepEqual(before.files_in_scope, [WI14_ENTRY], 'the live defect');
  const r = await edit(root, 'WI-14', { filesInScope: FIXED, creates: [FIXED[0]!], summary: before.body.trim() });
  assert.equal(r.status, 'edited', detail(r));
  const after = readWi(wiDir, 'WI-14');
  assert.deepEqual(after, { ...before, files_in_scope: FIXED, creates: [FIXED[0]!] });
  assert.equal(readFileSync(join(snapshotDir, 'WI-14.md'), 'utf8'), serializeWorkItem(after));
  const ev = events(logDir).filter((e) => e.message === 'kickoff.work-item-edited').at(-1);
  const expected = { work_item_id: 'WI-14', fields: ['filesInScope', 'creates'] };
  assert.deepEqual(ev?.metadata, expected, 'summary was submitted unchanged: not listed');
}));

test('edit WI-14: summary, acceptance criteria, gate command and dependencies, all at once', () => withRoot(async (root) => {
  const { wiDir, logDir } = live(root);
  const e: KickoffWorkItemEdit = {
    summary: 'No Terraform tokens in docs',
    acceptanceCriteria: [{ given: 'g', when: 'w', then: 't' }],
    qualityGateCmd: ['python3', '-m', 'pytest', 'tests/x.py'],
    filesInScope: ['tests/x.py'],
    creates: [],
    dependsOn: ['WI-13'],
  };
  const r = await edit(root, 'WI-14', e);
  assert.equal(r.status, 'edited', detail(r));
  const wi = readWi(wiDir, 'WI-14');
  assert.equal(wi.body.trim(), 'No Terraform tokens in docs');
  assert.deepEqual(
    [wi.acceptance_criteria, wi.quality_gate_cmd, wi.files_in_scope, wi.creates, wi.depends_on],
    [e.acceptanceCriteria, e.qualityGateCmd, ['tests/x.py'], undefined, ['WI-13']],
  );
  const fields = (events(logDir).at(-1)?.metadata as { fields: string[] }).fields;
  assert.deepEqual(fields, ['summary', 'acceptanceCriteria', 'qualityGateCmd', 'filesInScope', 'dependsOn']);
}));

test('edit WI-14 leaving its bad entry: invalid, the path rule names the entry; nothing rewritten', () => withRoot(async (root) => {
  const { wiDir } = live(root);
  const before = readFileSync(join(wiDir, 'WI-14.md'), 'utf8');
  const r = await edit(root, 'WI-14', { summary: 'x' });
  assert.equal(r.status, 'invalid');
  assert.match(detail(r), /files_in_scope entry ".*copilot-context\.md" refused: contains whitespace/);
  for (const bad of BAD_ENTRIES) {
    assert.equal((await edit(root, 'WI-14', { filesInScope: [bad] })).status, 'invalid', bad);
  }
  assert.equal(readFileSync(join(wiDir, 'WI-14.md'), 'utf8'), before);
}));

test('edit: a gate pipeline or a cycle in the resulting set is invalid, named', () => withRoot(async (root) => {
  live(root);
  const pipeline = await edit(root, 'WI-14', { filesInScope: FIXED, qualityGateCmd: ['bash', '-c', 'pytest | grep ok'] });
  assert.equal(pipeline.status, 'invalid');
  assert.equal((await edit(root, 'WI-14', { filesInScope: FIXED, dependsOn: ['WI-13'] })).status, 'edited');
  assert.match(detail(await edit(root, 'WI-13', { summary: 'x', dependsOn: ['WI-14'] })), /work-item dependency cycle/);
}));

test('edit a PLAN work item: a field but dependsOn is not-a-kickoff-work-item; dependsOn alone edits', () => withRoot(async (root) => {
  const { wiDir } = live(root);
  const before = readFileSync(join(wiDir, 'WI-12.md'), 'utf8');
  const r = await edit(root, 'WI-12', { summary: 'rewritten' });
  assert.equal(r.status, 'not-a-kickoff-work-item');
  assert.match(detail(r), /WI-12/);
  assert.equal(readFileSync(join(wiDir, 'WI-12.md'), 'utf8'), before);
  assert.equal((await edit(root, 'WI-12', { dependsOn: [] })).status, 'edited');
  assert.deepEqual(readWi(wiDir, 'WI-12').depends_on, []);
}));

test('edit after anything is built: not-at-kickoff; nothing rewritten', () => withRoot(async (root) => {
  const { wiDir } = live(root);
  built(wiDir);
  const r = await edit(root, 'WI-14', { filesInScope: FIXED });
  assert.equal(r.status, 'not-at-kickoff');
  assert.deepEqual(readWi(wiDir, 'WI-14').files_in_scope, [WI14_ENTRY]);
}));

test('edit with an unreadable events log: refused not-a-kickoff-work-item (fail closed), naming the log', () => withRoot(async (root) => {
  const { wiDir, logDir } = live(root);
  rmSync(join(logDir, 'events.jsonl'));
  const r = await edit(root, 'WI-14', { filesInScope: FIXED });
  assert.equal(r.status, 'not-a-kickoff-work-item');
  assert.match(detail(r), /events\.jsonl/);
  assert.deepEqual(readWi(wiDir, 'WI-14').files_in_scope, [WI14_ENTRY]);
}));

test('edit lock: Start development landing while it waits is refused by the in-lock re-check', () => withRoot(async (root) => {
  const { manifestPath, wiDir } = live(root);
  await lockfile.lock(manifestPath, { realpath: false });
  const pending = edit(root, 'WI-14', { filesInScope: FIXED });
  await new Promise((r) => setTimeout(r, 20));
  lockfile.unlockSync(manifestPath, { realpath: false });
  assert.equal(enqueueDevelopRun(I2_INIT, { queueRoot: join(root, '_queue') }).status, 'enqueued');
  const r = await pending;
  assert.equal(r.status, 'not-at-kickoff');
  assert.match(detail(r), /while the request waited on its lock/);
  assert.deepEqual(readWi(wiDir, 'WI-14').files_in_scope, [WI14_ENTRY]);
}));
