/**
 * Bead forge-nk1y.12 (D-48) — `addKickoffWorkItem`: at the Kickoff gate the
 * operator adds a PLAN work item (no `origin`) to the decomposed set before the
 * first build. Validated as a set, D-47 coverage re-reported (never a refusal),
 * refused by name once anything is built. Every refusal runs on a tmp root: no
 * network, no spawn, no git write.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';

import { addKickoffWorkItem, buildPlanWorkItem, type KickoffWorkItemSource } from '../../kickoff-add-work-item.ts';
import { manifestAwaitsKickoff } from '../../kickoff-facts.ts';
import { enqueueDevelopRun } from '../../enqueue-develop-run.ts';
import { parseManifest, serializeManifest } from '../../manifest.ts';
import { parseWorkItem, type WorkItem } from '../../work-item.ts';
import { STRANDED_BUILT_CASES, STRANDED_INIT } from '../test-fixtures/stranded-kickoff.ts';
import { KICKOFF_ACS, RETIRE_GATE, existingWorkItem, plantKickoffWorktree } from '../test-fixtures/kickoff-worktree.ts';

/** Stub D-47 coverage: an AC whose backtick span no WI gate carries verbatim. */
function stubCoverage(acs: ReadonlyArray<{ when: string }>, items: ReadonlyArray<WorkItem>): string[] {
  const gates = items.map((w) => (w.quality_gate_cmd ?? []).join(' '));
  return acs.flatMap((ac, i) => {
    const span = /`([^`]+)`/.exec(ac.when)?.[1];
    return span && !gates.includes(span) ? [`AC${i + 1}`] : [];
  });
}

const SOURCE: KickoffWorkItemSource = {
  summary: 'Retire the legacy specs inside I1.',
  acceptanceCriteria: [{ given: 'the legacy specs', when: 'the retire test runs', then: 'none remain' }],
  qualityGateCmd: RETIRE_GATE,
  filesInScope: ['specs/legacy.md', 'tests/retire.test.ts'],
};

function withRoot(fn: (root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'forge-kickoff-add-wi-'));
  return fn(root).finally(() => rmSync(root, { recursive: true, force: true }));
}

function add(root: string, source: KickoffWorkItemSource = SOURCE, initiativeId = STRANDED_INIT) {
  return addKickoffWorkItem({ forgeRoot: root, logsRoot: join(root, '_logs'), initiativeId, source, coverage: stubCoverage });
}

const readManifest = (p: string) => parseManifest(readFileSync(p, 'utf8'));
const awaits = (root: string, manifestPath: string) => manifestAwaitsKickoff({
  queueDir: 'ready-for-review', manifest: readManifest(manifestPath), logsRoot: join(root, '_logs'), forgeRoot: root,
});

test('at kickoff: a plan WI lands in the worktree + snapshot, the manifest gains it and still awaits kickoff', () => withRoot(async (root) => {
  const { manifestPath, wiDir, snapshotDir, logDir } = plantKickoffWorktree(root);
  const existing = [1, 2, 3, 4, 5].map((n) => existingWorkItem(n));
  assert.deepEqual(stubCoverage(KICKOFF_ACS, existing), ['AC1'], 'before: the runnable AC is uncovered');

  const r = await add(root);
  assert.equal(r.status, 'added', 'detail' in r ? r.detail : '');
  assert.ok(r.status === 'added');
  assert.equal(r.workItemId, 'WI-6');
  assert.deepEqual(r.uncoveredAcceptanceCriteria, [], 'after: the new WI\'s gate carries the runnable AC');

  const wi = parseWorkItem(readFileSync(join(wiDir, 'WI-6.md'), 'utf8'));
  assert.equal(wi.origin, undefined, 'a plan WI, never a fix WI (the D-20 drain keys on origin)');
  assert.equal(wi.status, 'pending');
  assert.deepEqual(wi.depends_on, []);
  assert.deepEqual(wi.acceptance_criteria, SOURCE.acceptanceCriteria);
  assert.deepEqual(wi.quality_gate_cmd, RETIRE_GATE);
  assert.deepEqual(wi.files_in_scope, SOURCE.filesInScope);
  assert.equal(wi.estimated_iterations, 4, 'median of 2,3,4,5,8');
  assert.match(wi.body, /Retire the legacy specs inside I1\./);
  assert.equal(readFileSync(join(snapshotDir, 'WI-6.md'), 'utf8'), readFileSync(join(wiDir, 'WI-6.md'), 'utf8'), 'the roadmap reads the snapshot first');

  const m = readManifest(manifestPath);
  assert.ok(m.specs?.includes('WI-6'));
  assert.equal(m.resume_from, undefined);
  assert.equal(m.review_rounds, undefined);
  assert.ok(awaits(root, manifestPath), 'still at the Kickoff gate');

  const ev = readFileSync(join(logDir, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    .find((e) => e.message === 'kickoff.work-item-added');
  assert.deepEqual(ev?.metadata, { work_item_id: 'WI-6', uncovered_acceptance_criteria: [] });
}));

test('coverage is reported, never a refusal: a WI that leaves the runnable AC uncovered is still added', () => withRoot(async (root) => {
  plantKickoffWorktree(root);
  const r = await add(root, { ...SOURCE, qualityGateCmd: ['node', '--test', 'tests/other.test.ts'] });
  assert.ok(r.status === 'added');
  assert.deepEqual(r.uncoveredAcceptanceCriteria, ['AC1']);
}));

test('then Start development enqueues, and the added WI sits in the dir the develop run reuses', () => withRoot(async (root) => {
  plantKickoffWorktree(root);
  assert.equal((await add(root)).status, 'added');
  const e = enqueueDevelopRun(STRANDED_INIT, { queueRoot: join(root, '_queue') });
  assert.equal(e.status, 'enqueued', e.detail);
  assert.ok(existsSync(join(root, '_worktrees', STRANDED_INIT, '.forge', 'work-items', 'WI-6.md')));
}));

test('not-found: the manifest is not in ready-for-review, or the id is not canonical', () => withRoot(async (root) => {
  const { manifestPath } = plantKickoffWorktree(root);
  renameSync(manifestPath, join(root, '_queue', 'pending', `${STRANDED_INIT}.md`));
  assert.equal((await add(root)).status, 'not-found');
  assert.equal((await add(root, SOURCE, '../../etc')).status, 'not-found');
}));

for (const built of STRANDED_BUILT_CASES) {
  test(`not-at-kickoff (${built}): refused by name, nothing written`, () => withRoot(async (root) => {
    const { wiDir } = plantKickoffWorktree(root, built);
    const r = await add(root);
    assert.equal(r.status, 'not-at-kickoff');
    assert.match('detail' in r ? r.detail : '', /a work item is complete|resumes from develop|1 review round/);
    assert.ok(!existsSync(join(wiDir, 'WI-6.md')));
  }));
}

test('not-at-kickoff: a manifest from another flow is not a forge-architect kickoff', () => withRoot(async (root) => {
  const { manifestPath } = plantKickoffWorktree(root);
  writeFileSync(manifestPath, serializeManifest({ ...readManifest(manifestPath), flow_id: 'forge-develop' }));
  const r = await add(root);
  assert.equal(r.status, 'not-at-kickoff');
  assert.match('detail' in r ? r.detail : '', /not a forge-architect kickoff/);
}));

const INVALID: Array<[string, Partial<KickoffWorkItemSource>, RegExp]> = [
  ['empty ACs', { acceptanceCriteria: [] }, /acceptance_criteria must have at least one entry/],
  ['a shell-pipeline gate', { qualityGateCmd: ['bash', '-c', 'a | b'] }, /NOT a shell pipeline/],
  ['a .. scope path', { filesInScope: ['../outside.ts'] }, /may not contain '\.\.'/],
];
for (const [name, patch, named] of INVALID) {
  test(`invalid (${name}): refused naming the error, nothing written`, () => withRoot(async (root) => {
    const { wiDir, snapshotDir } = plantKickoffWorktree(root);
    const r = await add(root, { ...SOURCE, ...patch });
    assert.equal(r.status, 'invalid');
    assert.match('detail' in r ? r.detail : '', named);
    assert.deepEqual(readdirSync(wiDir).sort(), readdirSync(snapshotDir).filter((f) => f.startsWith('WI-')).sort());
    assert.ok(!existsSync(join(wiDir, 'WI-6.md')));
  }));
}

test('unsafe: a worktree_path outside the forge roots is refused before any read beneath it', () => withRoot(async (root) => {
  const { manifestPath } = plantKickoffWorktree(root);
  writeFileSync(manifestPath, serializeManifest({ ...readManifest(manifestPath), worktree_path: join(root, '..', 'elsewhere') }));
  const r = await add(root);
  assert.equal(r.status, 'unsafe');
  assert.match('detail' in r ? r.detail : '', /worktree_path/);
}));

test('lock: Start development landing while the add waits on the manifest lock is refused not-at-kickoff', () => withRoot(async (root) => {
  const { manifestPath, wiDir } = plantKickoffWorktree(root);
  const release = await lockfile.lock(manifestPath, { realpath: false }); // another writer holds it (the verdict handler's lock)
  const pending = add(root); // passes the outer check, then waits on the lock
  await new Promise((r) => setTimeout(r, 20));
  const e = enqueueDevelopRun(STRANDED_INIT, { queueRoot: join(root, '_queue') });
  assert.equal(e.status, 'enqueued', e.detail);
  await release();
  const r = await pending;
  assert.equal(r.status, 'not-at-kickoff');
  assert.ok(!existsSync(join(wiDir, 'WI-6.md')), 'nothing written once development started');
}));

test('buildPlanWorkItem (pure, reused by the verdict gate later): plan WI beside the set, or every set error', () => {
  const existing = [1, 2, 3, 4].map((n) => existingWorkItem(n));
  const ok = buildPlanWorkItem(existing, 'WI-5', STRANDED_INIT, SOURCE);
  assert.ok('workItem' in ok);
  assert.equal(ok.workItem.origin, undefined);
  assert.equal(ok.workItem.estimated_iterations, 4, 'median of 2,3,4,5 = 3.5, rounded up');
  const dup = buildPlanWorkItem(existing, 'WI-4', STRANDED_INIT, { ...SOURCE, filesInScope: [] });
  assert.ok('errors' in dup);
  assert.match(dup.errors.join('; '), /duplicate work_item_id: WI-4/);
  assert.match(dup.errors.join('; '), /files_in_scope must have at least one entry/);
  const first = buildPlanWorkItem([], 'WI-1', STRANDED_INIT, SOURCE);
  assert.ok('workItem' in first && first.workItem.estimated_iterations === 1, 'no existing WIs: at least 1');
});
