/**
 * Tests for the ADR 040 fix-loop drain — selection + re-claim logic. The cycle
 * run is injected (`runDrainCycle`) so these stay git/SDK-free; the real spine
 * is exercised end-to-end by a live cycle (verify:cycle).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { drainPendingFixWorkItems, type FixLoopDrainStatus } from './drain-fix-loop.ts';
import { writeReviewCapExhaustedMarker } from './fix-work-items.ts';
import { writeWorkItem, type WorkItem } from './work-item.ts';
import type { CycleInput } from './cycle-context.ts';

const GATE = ['go', 'test', './...'];
const ID = 'INIT-2026-07-25-drain-fix-loop';

function setup(): { root: string; queueRoot: string; wt: string } {
  const root = mkdtempSync(join(tmpdir(), 'drain-fix-loop-'));
  const queueRoot = join(root, '_queue');
  for (const d of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(queueRoot, d), { recursive: true });
  }
  const wt = join(root, 'wt');
  mkdirSync(wt, { recursive: true });
  return { root, queueRoot, wt };
}

function writeManifest(
  queueRoot: string,
  state: string,
  wt: string,
  opts: { cycleId?: string; reviewRounds?: number } = {},
): void {
  const lines = [
    '---',
    `initiative_id: ${ID}`,
    'project: demo',
    `project_repo_path: ${wt}`,
    "created_at: '2026-07-25T00:00:00.000Z'",
    'iteration_budget: 2',
    'cost_budget_usd: 1',
    'phase: ready-for-review',
    'origin: architect',
    `worktree_path: ${wt}`,
    ...(opts.cycleId ? [`cycle_id: ${opts.cycleId}`] : []),
    ...(opts.reviewRounds !== undefined ? [`review_rounds: ${opts.reviewRounds}`] : []),
    '---',
    `# ${ID}`,
    '',
  ];
  writeFileSync(join(queueRoot, state, `${ID}.md`), lines.join('\n'));
}

function baseWi(overrides: Partial<WorkItem> & Pick<WorkItem, 'work_item_id'>): WorkItem {
  return {
    initiative_id: ID,
    status: 'pending',
    depends_on: [],
    acceptance_criteria: [{ given: 'g', when: 'w', then: 't' }],
    files_in_scope: ['src/a.ts'],
    estimated_iterations: 2,
    quality_gate_cmd: GATE,
    body: `${overrides.work_item_id} body`,
    ...overrides,
  };
}

/** Seed a post-first-cycle queue: a complete PM WI and one pending review-fix WI. */
function seedDrainableQueue(wt: string): void {
  writeWorkItem(baseWi({ work_item_id: 'WI-1', status: 'complete' }), wt);
  writeWorkItem(baseWi({ work_item_id: 'WI-2', status: 'pending', origin: 'review-fix' }), wt);
}

test('drain: pending fix WIs + unmerged PR → drained; threads cycleId+resumeFrom; sendback.loop-completed event recorded', async () => {
  const { root, queueRoot, wt } = setup();
  try {
    seedDrainableQueue(wt);
    writeManifest(queueRoot, 'ready-for-review', wt, { cycleId: 'CYCLE-XYZ', reviewRounds: 1 });
    const logsRoot = join(root, '_logs');
    const calls: CycleInput[] = [];
    const results = await drainPendingFixWorkItems({
      queueRoot,
      logsRoot,
      confirmMerge: () => false,
      runDrainCycle: async (input) => {
        calls.push(input);
        return { status: 'pr-open' };
      },
    });

    assert.deepEqual(results.map((r) => r.status), ['drained' as FixLoopDrainStatus]);
    assert.equal(calls.length, 1, 'runDrainCycle was called once');
    assert.equal(calls[0]!.cycleId, 'CYCLE-XYZ', 'threads the persisted cycle_id');
    assert.equal(calls[0]!.resumeFrom, 'develop');

    // The stub did not run closure, so the drain returns the stranded manifest
    // from in-flight back to ready-for-review.
    assert.equal(existsSync(join(queueRoot, 'ready-for-review', `${ID}.md`)), true);
    assert.equal(existsSync(join(queueRoot, 'in-flight', `${ID}.md`)), false);

    // Round evidence: sendback.loop-completed with metadata.round === review_rounds.
    const eventsPath = join(logsRoot, 'CYCLE-XYZ', 'events.jsonl');
    const events = readFileSync(eventsPath, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { message?: string; metadata?: Record<string, unknown> });
    const evt = events.find((e) => e.message === 'sendback.loop-completed');
    assert.ok(evt, 'sendback.loop-completed event was recorded');
    assert.equal(evt!.metadata?.round, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('drain: no pending fix WIs → no-pending (a pending PM WI without origin does NOT trigger the drain)', async () => {
  const { root, queueRoot, wt } = setup();
  try {
    writeWorkItem(baseWi({ work_item_id: 'WI-1', status: 'pending' }), wt); // no origin
    writeManifest(queueRoot, 'ready-for-review', wt, { cycleId: 'CYCLE-XYZ' });
    let called = false;
    const results = await drainPendingFixWorkItems({
      queueRoot,
      confirmMerge: () => false,
      runDrainCycle: async () => { called = true; return { status: 'pr-open' }; },
    });
    assert.deepEqual(results.map((r) => r.status), ['no-pending']);
    assert.equal(called, false);
    assert.equal(existsSync(join(queueRoot, 'ready-for-review', `${ID}.md`)), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('drain: merged PR → pr-merged (finalize-merged domain), runDrainCycle NOT called', async () => {
  const { root, queueRoot, wt } = setup();
  try {
    seedDrainableQueue(wt);
    writeManifest(queueRoot, 'ready-for-review', wt, { cycleId: 'CYCLE-XYZ' });
    let called = false;
    const results = await drainPendingFixWorkItems({
      queueRoot,
      confirmMerge: () => true,
      runDrainCycle: async () => { called = true; return { status: 'pr-open' }; },
    });
    assert.deepEqual(results.map((r) => r.status), ['pr-merged']);
    assert.equal(called, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('drain: a failed fix work-item → needs-operator (never auto-retry), runDrainCycle NOT called', async () => {
  const { root, queueRoot, wt } = setup();
  try {
    writeWorkItem(baseWi({ work_item_id: 'WI-1', status: 'complete' }), wt);
    writeWorkItem(baseWi({ work_item_id: 'WI-2', status: 'failed', origin: 'review-fix' }), wt);
    writeManifest(queueRoot, 'ready-for-review', wt, { cycleId: 'CYCLE-XYZ' });
    let called = false;
    const results = await drainPendingFixWorkItems({
      queueRoot,
      confirmMerge: () => false,
      runDrainCycle: async () => { called = true; return { status: 'pr-open' }; },
    });
    assert.deepEqual(results.map((r) => r.status), ['needs-operator']);
    assert.equal(results[0]!.detail, 'failed fix work-item');
    assert.equal(called, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('drain: REVIEW-CAP-EXHAUSTED marker present → needs-operator, notify NOT called (no re-notify per sweep)', async () => {
  const { root, queueRoot, wt } = setup();
  try {
    seedDrainableQueue(wt);
    writeReviewCapExhaustedMarker(wt, 'cap exhausted at round 6');
    writeManifest(queueRoot, 'ready-for-review', wt, { cycleId: 'CYCLE-XYZ' });
    let notified = false;
    let called = false;
    const results = await drainPendingFixWorkItems({
      queueRoot,
      confirmMerge: () => false,
      runDrainCycle: async () => { called = true; return { status: 'pr-open' }; },
      notify: () => { notified = true; },
    });
    assert.deepEqual(results.map((r) => r.status), ['needs-operator']);
    assert.match(results[0]!.detail ?? '', /marker/);
    assert.equal(called, false);
    assert.equal(notified, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('drain: manifest review_rounds > FORGE_REVIEW_MAX_SEND_BACK_ROUNDS → cap-exceeded, notify called', async () => {
  const { root, queueRoot, wt } = setup();
  const prevRounds = process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS;
  const prevTotal = process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS;
  try {
    process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS = '1';
    delete process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS;
    seedDrainableQueue(wt); // 1 fix WI — under the (default) total cap
    writeManifest(queueRoot, 'ready-for-review', wt, { cycleId: 'CYCLE-XYZ', reviewRounds: 2 });
    const notifications: string[] = [];
    let called = false;
    const results = await drainPendingFixWorkItems({
      queueRoot,
      confirmMerge: () => false,
      runDrainCycle: async () => { called = true; return { status: 'pr-open' }; },
      notify: (msg) => { notifications.push(msg); },
    });
    assert.deepEqual(results.map((r) => r.status), ['cap-exceeded']);
    assert.equal(called, false);
    assert.equal(notifications.length, 1);
  } finally {
    if (prevRounds === undefined) delete process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS;
    else process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS = prevRounds;
    if (prevTotal === undefined) delete process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS;
    else process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS = prevTotal;
    rmSync(root, { recursive: true, force: true });
  }
});

test('drain: fix-WI count > FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS → cap-exceeded, notify called', async () => {
  const { root, queueRoot, wt } = setup();
  const prevRounds = process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS;
  const prevTotal = process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS;
  try {
    delete process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS;
    process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS = '1';
    seedDrainableQueue(wt); // WI-2 (1 fix WI)
    writeWorkItem(baseWi({ work_item_id: 'WI-3', status: 'pending', origin: 'review-fix' }), wt); // 2nd fix WI, over cap
    writeManifest(queueRoot, 'ready-for-review', wt, { cycleId: 'CYCLE-XYZ' });
    const notifications: string[] = [];
    let called = false;
    const results = await drainPendingFixWorkItems({
      queueRoot,
      confirmMerge: () => false,
      runDrainCycle: async () => { called = true; return { status: 'pr-open' }; },
      notify: (msg) => { notifications.push(msg); },
    });
    assert.deepEqual(results.map((r) => r.status), ['cap-exceeded']);
    assert.equal(called, false);
    assert.equal(notifications.length, 1);
  } finally {
    if (prevRounds === undefined) delete process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS;
    else process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS = prevRounds;
    if (prevTotal === undefined) delete process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS;
    else process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS = prevTotal;
    rmSync(root, { recursive: true, force: true });
  }
});

test('drain: a thrown drain cycle returns the manifest to ready-for-review (never stranded), result error', async () => {
  const { root, queueRoot, wt } = setup();
  try {
    seedDrainableQueue(wt);
    writeManifest(queueRoot, 'ready-for-review', wt, { cycleId: 'CYCLE-XYZ' });
    const results = await drainPendingFixWorkItems({
      queueRoot,
      logsRoot: join(root, '_logs'),
      confirmMerge: () => false,
      runDrainCycle: async () => { throw new Error('cycle blew up mid-drain'); },
    });
    assert.deepEqual(results.map((r) => r.status), ['error' as FixLoopDrainStatus]);
    assert.match(results[0]!.detail ?? '', /cycle blew up mid-drain/);
    // Not stranded in in-flight — the inner finally returned it to ready-for-review
    // before the throw reached the outer catch that recorded status 'error'.
    assert.equal(existsSync(join(queueRoot, 'in-flight', `${ID}.md`)), false);
    assert.equal(existsSync(join(queueRoot, 'ready-for-review', `${ID}.md`)), true);
    // No leftover heartbeat.
    assert.equal(existsSync(join(queueRoot, 'in-flight', `${ID}.md.heartbeat`)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('drain: cycle_id falls back to the latest _logs dir when the manifest lacks one', async () => {
  const { root, queueRoot, wt } = setup();
  try {
    seedDrainableQueue(wt);
    writeManifest(queueRoot, 'ready-for-review', wt); // no cycle_id
    const logsRoot = join(root, '_logs');
    mkdirSync(join(logsRoot, `2026-07-25T01-02-03_${ID}`), { recursive: true });
    const calls: CycleInput[] = [];
    await drainPendingFixWorkItems({
      queueRoot,
      logsRoot,
      confirmMerge: () => false,
      runDrainCycle: async (input) => { calls.push(input); return { status: 'pr-open' }; },
    });
    assert.equal(calls[0]!.cycleId, `2026-07-25T01-02-03_${ID}`, 'threads the latest matching _logs dir');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('drain: no worktree → no-worktree, skipped', async () => {
  const { root, queueRoot } = setup();
  try {
    writeManifest(queueRoot, 'ready-for-review', join(root, 'gone'), { cycleId: 'CYCLE-XYZ' });
    const results = await drainPendingFixWorkItems({
      queueRoot,
      confirmMerge: () => false,
      runDrainCycle: async () => ({ status: 'pr-open' }),
    });
    assert.deepEqual(results.map((r) => r.status), ['no-worktree']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
