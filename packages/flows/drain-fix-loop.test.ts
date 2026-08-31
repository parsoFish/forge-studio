/**
 * Tests for the ADR 040 fix-loop drain — selection + re-claim logic. The cycle
 * run is injected (`runDrainCycle`) so these stay git/SDK-free; the real spine
 * is exercised end-to-end by a live cycle (verify:cycle).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { drainPendingFixWorkItems, type FixLoopDrainStatus } from './drain-fix-loop.ts';
import { writeReviewCapExhaustedMarker } from './fix-work-items.ts';
import { writeWorkItem, type WorkItem } from './work-item.ts';
import type { CycleInput } from './cycle-context.ts';

const GATE = ['go', 'test', './...'];
const ID = 'INIT-2026-07-25-drain-fix-loop';

/**
 * SEC-02 round 4: `worktree_path` / `project_repo_path` are now containment-
 * checked against `<forgeRoot>/_worktrees` and `<forgeRoot>/projects`
 * respectively (mirroring round 3's `finalize-merged.ts` fix) — so both
 * containment ROOTS must exist on disk (a missing root fails CLOSED), and the
 * two fields are DISTINCT real directories under their own root (never the
 * same value; they're checked against different roots).
 *
 * `wt` is deliberately NOT pre-created here — most tests populate it lazily
 * via `seedDrainableQueue`/`writeWorkItem` (whose own `mkdirSync(...,
 * {recursive:true})` creates the whole chain), and the "no worktree" test
 * below depends on it staying absent while still being a properly-ROOTED,
 * identity-bound path (`<forgeRoot>/_worktrees/<ID>`) so a future containment
 * guard doesn't reject it before ever reaching the existence check it's
 * actually testing.
 */
function setup(): { root: string; queueRoot: string; wt: string; repo: string } {
  const root = mkdtempSync(join(tmpdir(), 'drain-fix-loop-'));
  const queueRoot = join(root, '_queue');
  for (const d of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(queueRoot, d), { recursive: true });
  }
  mkdirSync(join(root, '_worktrees'), { recursive: true });
  mkdirSync(join(root, 'projects'), { recursive: true });
  const wt = join(root, '_worktrees', ID); // identity-bound to the fixed module ID; NOT pre-created
  const repo = join(root, 'projects', 'demo');
  mkdirSync(repo, { recursive: true });
  return { root, queueRoot, wt, repo };
}

function writeManifest(
  queueRoot: string,
  state: string,
  wt: string,
  repo: string,
  opts: { cycleId?: string; reviewRounds?: number } = {},
): void {
  const lines = [
    '---',
    `initiative_id: ${ID}`,
    'project: demo',
    `project_repo_path: ${repo}`,
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

/** Parameterized manifest writer for the round-4 multi-id (mixed sweep) cases
 *  — the module's own `writeManifest` above hardcodes the fixed `ID`. */
function writeManifestForId(
  queueRoot: string,
  state: string,
  id: string,
  fields: { worktreePath: string; projectRepoPath: string; cycleId?: string },
): void {
  const lines = [
    '---',
    `initiative_id: ${id}`,
    'project: demo',
    `project_repo_path: ${fields.projectRepoPath}`,
    "created_at: '2026-07-25T00:00:00.000Z'",
    'iteration_budget: 2',
    'cost_budget_usd: 1',
    'phase: ready-for-review',
    'origin: architect',
    `worktree_path: ${fields.worktreePath}`,
    ...(fields.cycleId ? [`cycle_id: ${fields.cycleId}`] : []),
    '---',
    `# ${id}`,
    '',
  ];
  writeFileSync(join(queueRoot, state, `${id}.md`), lines.join('\n'));
}

function baseWiFor(id: string, overrides: Partial<WorkItem> & Pick<WorkItem, 'work_item_id'>): WorkItem {
  return {
    initiative_id: id,
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

function baseWi(overrides: Partial<WorkItem> & Pick<WorkItem, 'work_item_id'>): WorkItem {
  return baseWiFor(ID, overrides);
}

/** Seed a post-first-cycle queue: a complete PM WI and one pending review-fix WI. */
function seedDrainableQueueFor(id: string, wt: string): void {
  writeWorkItem(baseWiFor(id, { work_item_id: 'WI-1', status: 'complete' }), wt);
  writeWorkItem(baseWiFor(id, { work_item_id: 'WI-2', status: 'pending', origin: 'review-fix' }), wt);
}

function seedDrainableQueue(wt: string): void {
  seedDrainableQueueFor(ID, wt);
}

test('drain: pending fix WIs + unmerged PR → drained; threads cycleId+resumeFrom; sendback.loop-completed event recorded', async () => {
  const { root, queueRoot, wt, repo } = setup();
  try {
    seedDrainableQueue(wt);
    writeManifest(queueRoot, 'ready-for-review', wt, repo, { cycleId: 'CYCLE-XYZ', reviewRounds: 1 });
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
  const { root, queueRoot, wt, repo } = setup();
  try {
    writeWorkItem(baseWi({ work_item_id: 'WI-1', status: 'pending' }), wt); // no origin
    writeManifest(queueRoot, 'ready-for-review', wt, repo, { cycleId: 'CYCLE-XYZ' });
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
  const { root, queueRoot, wt, repo } = setup();
  try {
    seedDrainableQueue(wt);
    writeManifest(queueRoot, 'ready-for-review', wt, repo, { cycleId: 'CYCLE-XYZ' });
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
  const { root, queueRoot, wt, repo } = setup();
  try {
    writeWorkItem(baseWi({ work_item_id: 'WI-1', status: 'complete' }), wt);
    writeWorkItem(baseWi({ work_item_id: 'WI-2', status: 'failed', origin: 'review-fix' }), wt);
    writeManifest(queueRoot, 'ready-for-review', wt, repo, { cycleId: 'CYCLE-XYZ' });
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
  const { root, queueRoot, wt, repo } = setup();
  try {
    seedDrainableQueue(wt);
    writeReviewCapExhaustedMarker(wt, 'cap exhausted at round 6');
    writeManifest(queueRoot, 'ready-for-review', wt, repo, { cycleId: 'CYCLE-XYZ' });
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
  const { root, queueRoot, wt, repo } = setup();
  const prevRounds = process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS;
  const prevTotal = process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS;
  try {
    process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS = '1';
    delete process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS;
    seedDrainableQueue(wt); // 1 fix WI — under the (default) total cap
    writeManifest(queueRoot, 'ready-for-review', wt, repo, { cycleId: 'CYCLE-XYZ', reviewRounds: 2 });
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
  const { root, queueRoot, wt, repo } = setup();
  const prevRounds = process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS;
  const prevTotal = process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS;
  try {
    delete process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS;
    process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS = '1';
    seedDrainableQueue(wt); // WI-2 (1 fix WI)
    writeWorkItem(baseWi({ work_item_id: 'WI-3', status: 'pending', origin: 'review-fix' }), wt); // 2nd fix WI, over cap
    writeManifest(queueRoot, 'ready-for-review', wt, repo, { cycleId: 'CYCLE-XYZ' });
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
  const { root, queueRoot, wt, repo } = setup();
  try {
    seedDrainableQueue(wt);
    writeManifest(queueRoot, 'ready-for-review', wt, repo, { cycleId: 'CYCLE-XYZ' });
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
  const { root, queueRoot, wt, repo } = setup();
  try {
    seedDrainableQueue(wt);
    writeManifest(queueRoot, 'ready-for-review', wt, repo); // no cycle_id
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
  const { root, queueRoot, wt, repo } = setup();
  try {
    // `wt` is deliberately left uncreated by `setup()` — a properly-rooted,
    // identity-bound path (<forgeRoot>/_worktrees/<ID>) that simply doesn't
    // exist on disk yet, so containment passes and the existence check is
    // what actually produces 'no-worktree'. (Previously this test used an
    // arbitrary unrooted `join(root, 'gone')` value — replaced because that
    // shape would now fail containment FIRST, changing this test's own
    // status from 'no-worktree' to 'error' for a reason unrelated to what it
    // tests. See the round-4 fixture note in `setup()`'s docstring.)
    writeManifest(queueRoot, 'ready-for-review', wt, repo, { cycleId: 'CYCLE-XYZ' });
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

// ---------------------------------------------------------------------------
// SEC-02 round 4 — a near-exact mirror of round 3
// (`orchestrator/finalize-merged.test.ts`), this module's own docstring calls
// it "a sibling of `finalize-merged`". Worse than round 3: this sweep
// RE-ENTERS A WHOLE CYCLE (`runCycle({resumeFrom:'develop'})` — dev-loop, PM,
// demo, adversarial-review) against the manifest-supplied `worktreePath` /
// `projectRepoPath`, and does the same unguarded `resolve(logsRoot, cycleId)`
// as round 2's headline. Confirmed live (manual repro, before these tests
// were written) that both an out-of-root worktree_path and an out-of-root
// project_repo_path reach `runDrainCycle` directly today, and a traversing
// cycle_id creates a real directory outside `<forgeRoot>/_logs` via
// `createLogger`.
// ---------------------------------------------------------------------------

test('(RED) [SEC-02 round 4] worktree_path outside the forge root: sweep does not crash, runDrainCycle is NEVER invoked with the poisoned path, confirmMerge never invoked with it either, sentinel survives byte-identical', async () => {
  const { root, queueRoot, repo } = setup();
  const outside = mkdtempSync(join(tmpdir(), 'drain-r4-wt-outside-'));
  try {
    const nestedDir = join(outside, 'nested');
    mkdirSync(nestedDir, { recursive: true });
    const sentinelFile = join(nestedDir, 'secret.txt');
    const sentinelBytes = 'SENTINEL-R4-WT-BYTES-9d31c7a2\n';
    writeFileSync(sentinelFile, sentinelBytes);

    const id = 'INIT-2026-07-25-r4-wt-escape';
    // Real pending fix WIs planted UNDER the poisoned dir — without this the
    // drain would exit early at 'no-pending' before ever reaching
    // confirmMerge/runDrainCycle, and the escape would never be exercised.
    seedDrainableQueueFor(id, outside);
    writeManifestForId(queueRoot, 'ready-for-review', id, {
      worktreePath: outside, // THE ATTACK
      projectRepoPath: repo, // legitimate — isolates the escape to worktree_path only
      cycleId: `2026-07-25T01-02-03_${id}`,
    });

    const confirmCalls: string[] = [];
    const drainCalls: CycleInput[] = [];
    const results = await drainPendingFixWorkItems({
      queueRoot,
      logsRoot: join(root, '_logs'),
      confirmMerge: (wt: string) => { confirmCalls.push(wt); return false; },
      runDrainCycle: async (input) => { drainCalls.push(input); return { status: 'pr-open' }; },
    });

    // PRIMARY: the pre-existing outside directory must survive untouched.
    assert.equal(existsSync(outside), true, 'sentinel directory must still exist');
    assert.equal(existsSync(sentinelFile), true, 'nested sentinel file must still exist');
    assert.equal(readFileSync(sentinelFile, 'utf8'), sentinelBytes, 'sentinel bytes must be BYTE-IDENTICAL');

    // The pin: assert on the stubs' call records, not a status string alone.
    assert.ok(
      !confirmCalls.includes(outside),
      `confirmMerge must NEVER be invoked with the poisoned worktree_path — got calls: ${JSON.stringify(confirmCalls)}`,
    );
    assert.ok(
      !drainCalls.some((c) => c.worktreePath === outside),
      `runDrainCycle must NEVER be invoked with the poisoned worktree_path — got calls: ${JSON.stringify(drainCalls)}`,
    );

    // The sweep itself must not crash: this manifest degrades to its own
    // existing per-manifest error path; siblings (none here) still process.
    const result = results.find((r) => r.initiativeId === id);
    assert.ok(result, `expected a result entry for ${id} — got ${JSON.stringify(results)}`);
    assert.equal(
      result!.status,
      'error',
      `expected the poisoned manifest to degrade to status:'error' (the sweep's existing per-manifest error path) — got ${JSON.stringify(result)}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('(RED) [SEC-02 round 4] project_repo_path outside <forgeRoot>/projects: sweep does not crash, and nothing downstream (runDrainCycle) receives the poisoned path', async () => {
  const { root, queueRoot } = setup();
  const outsideRepo = mkdtempSync(join(tmpdir(), 'drain-r4-repo-outside-'));
  try {
    const id = 'INIT-2026-07-25-r4-repo-escape';
    const wt = join(root, '_worktrees', id); // legitimate, identity-bound worktree
    seedDrainableQueueFor(id, wt); // creates wt via writeWorkItem's own mkdirSync
    writeManifestForId(queueRoot, 'ready-for-review', id, {
      worktreePath: wt,
      projectRepoPath: outsideRepo, // THE ATTACK
      cycleId: `2026-07-25T01-02-03_${id}`,
    });

    const drainCalls: CycleInput[] = [];
    const results = await drainPendingFixWorkItems({
      queueRoot,
      logsRoot: join(root, '_logs'),
      confirmMerge: () => false,
      runDrainCycle: async (input) => { drainCalls.push(input); return { status: 'pr-open' }; },
    });

    assert.ok(
      !drainCalls.some((c) => c.projectRepoPath === outsideRepo),
      `runDrainCycle must NEVER be invoked with the poisoned project_repo_path — got calls: ${JSON.stringify(drainCalls)}`,
    );

    const result = results.find((r) => r.initiativeId === id);
    assert.ok(result, `expected a result entry for ${id} — got ${JSON.stringify(results)}`);
    assert.equal(
      result!.status,
      'error',
      `expected the poisoned manifest to degrade to status:'error' — got ${JSON.stringify(result)}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outsideRepo, { recursive: true, force: true });
  }
});

test('(RED) [SEC-02 round 4] traversing cycle_id: no file or directory may be created outside <forgeRoot>/_logs', async () => {
  const { root, queueRoot, repo } = setup();
  const uniqueSuffix = `sec02-r4-escape-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const cycleId = `../../${uniqueSuffix}`;
  const logsRoot = join(root, '_logs');
  // The SAME construction the vulnerable sink uses (`resolve(logsRoot,
  // cycleId)` inside createLogger, `orchestrator/logging.ts:124`) — used only
  // to compute WHERE the escape artifact would land if the write succeeds.
  const escapeTarget = resolve(logsRoot, cycleId);
  assert.ok(!escapeTarget.startsWith(root), 'sanity: the escape target must be genuinely outside forgeRoot');

  try {
    const id = 'INIT-2026-07-25-r4-cycleid-escape';
    const wt = join(root, '_worktrees', id);
    seedDrainableQueueFor(id, wt);
    writeManifestForId(queueRoot, 'ready-for-review', id, {
      worktreePath: wt,
      projectRepoPath: repo,
      cycleId, // THE ATTACK
    });

    const results = await drainPendingFixWorkItems({
      queueRoot,
      logsRoot,
      confirmMerge: () => false,
      runDrainCycle: async () => ({ status: 'pr-open' }),
    });

    assert.equal(
      existsSync(escapeTarget),
      false,
      `no directory may be created OUTSIDE <forgeRoot>/_logs for a traversing cycle_id — escapeTarget=${escapeTarget}, results=${JSON.stringify(results)}`,
    );

    const result = results.find((r) => r.initiativeId === id);
    assert.ok(result, `expected a result entry for ${id} — got ${JSON.stringify(results)}`);
    assert.equal(
      result!.status,
      'error',
      `expected the poisoned manifest to degrade to status:'error' — got ${JSON.stringify(result)}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(escapeTarget, { recursive: true, force: true });
  }
});

// MANDATORY positive control — without this the suite would pass against a
// guard that rejects everything, which is not a guard.
test('non-regression [SEC-02 round 4]: legitimate worktree_path + project_repo_path + real cycle_id still drains exactly as before', async () => {
  const { root, queueRoot, wt, repo } = setup();
  try {
    seedDrainableQueue(wt);
    writeManifest(queueRoot, 'ready-for-review', wt, repo, { cycleId: `2026-07-25T01-02-03_${ID}` });
    const drainCalls: CycleInput[] = [];
    const results = await drainPendingFixWorkItems({
      queueRoot,
      logsRoot: join(root, '_logs'),
      confirmMerge: () => false,
      runDrainCycle: async (input) => { drainCalls.push(input); return { status: 'pr-open' }; },
    });
    assert.deepEqual(results.map((r) => r.status), ['drained']);
    assert.equal(drainCalls.length, 1, 'runDrainCycle invoked exactly once');
    assert.equal(drainCalls[0]!.worktreePath, wt, 'threaded the real worktree path');
    assert.equal(drainCalls[0]!.projectRepoPath, repo, 'threaded the real project repo path');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('(RED) [SEC-02 round 4] mixed sweep: a poisoned manifest degrades to status:error while its LEGITIMATE sibling in the SAME sweep still drains (per-manifest fault isolation)', async () => {
  const { root, queueRoot, repo } = setup();
  const outside = mkdtempSync(join(tmpdir(), 'drain-r4-mixed-outside-'));
  try {
    const badId = 'INIT-2026-07-25-r4-mixed-bad';
    seedDrainableQueueFor(badId, outside);
    writeManifestForId(queueRoot, 'ready-for-review', badId, {
      worktreePath: outside, // THE ATTACK
      projectRepoPath: repo,
      cycleId: `2026-07-25T01-02-03_${badId}`,
    });

    const goodId = 'INIT-2026-07-25-r4-mixed-good';
    const goodWt = join(root, '_worktrees', goodId);
    seedDrainableQueueFor(goodId, goodWt);
    writeManifestForId(queueRoot, 'ready-for-review', goodId, {
      worktreePath: goodWt,
      projectRepoPath: repo,
      cycleId: `2026-07-25T01-02-04_${goodId}`,
    });

    const confirmCalls: string[] = [];
    const drainCalls: CycleInput[] = [];
    const results = await drainPendingFixWorkItems({
      queueRoot,
      logsRoot: join(root, '_logs'),
      confirmMerge: (w: string) => { confirmCalls.push(w); return false; },
      runDrainCycle: async (input) => { drainCalls.push(input); return { status: 'pr-open' }; },
    });

    const badResult = results.find((r) => r.initiativeId === badId);
    const goodResult = results.find((r) => r.initiativeId === goodId);
    assert.ok(badResult, `expected a result entry for the poisoned manifest — got ${JSON.stringify(results)}`);
    assert.ok(goodResult, `expected a result entry for the legitimate manifest — got ${JSON.stringify(results)}`);
    assert.equal(
      badResult!.status,
      'error',
      `expected the poisoned manifest to degrade to status:'error' (an element fault, not a collection failure) — got ${JSON.stringify(badResult)}`,
    );
    assert.equal(
      goodResult!.status,
      'drained',
      `expected the sibling LEGITIMATE manifest to still drain in the SAME sweep — got ${JSON.stringify(goodResult)}`,
    );
    assert.ok(!confirmCalls.includes(outside), `confirmMerge must never be invoked with the poisoned path — got ${JSON.stringify(confirmCalls)}`);
    assert.ok(!drainCalls.some((c) => c.worktreePath === outside), `runDrainCycle must never be invoked with the poisoned path — got ${JSON.stringify(drainCalls)}`);
    assert.ok(drainCalls.some((c) => c.worktreePath === goodWt), `runDrainCycle must still be invoked with the legitimate sibling's real path — got ${JSON.stringify(drainCalls)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
