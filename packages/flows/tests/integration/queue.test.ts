/**
 * Smoke tests for the queue module. Verifies:
 *   - claim() atomically renames pending → in-flight
 *   - heartbeat is written
 *   - moveTo() advances to ready-for-review / failed / done
 *   - recover() returns stale-heartbeat items to pending
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  claim,
  counts,
  getPaths,
  listAllInitiativeIds,
  listPending,
  moveTo,
  promoteMergedToDone,
  recover,
  writeHeartbeat,
} from '../../queue.ts';
import { operatorStopPath } from '../../operator-stop.ts';

function mkQueue(): { dir: string; paths: ReturnType<typeof getPaths> } {
  const dir = mkdtempSync(join(tmpdir(), 'forge-queue-'));
  const paths = getPaths(join(dir, '_queue'));
  for (const p of [paths.pending, paths.inFlight, paths.readyForReview, paths.merged, paths.done, paths.failed]) {
    mkdirSync(p, { recursive: true });
  }
  return { dir, paths };
}

test('queue: claim renames pending → in-flight and writes heartbeat', () => {
  const { dir, paths } = mkQueue();
  try {
    const filename = 'INIT-test.md';
    writeFileSync(join(paths.pending, filename), '---\ninitiative_id: INIT-test\n---\n');

    assert.equal(listPending(paths).length, 1);
    const claimed = claim(filename, paths);
    assert.ok(claimed, 'claim returned a path');
    assert.equal(listPending(paths).length, 0);
    assert.ok(existsSync(join(paths.inFlight, filename)));
    assert.ok(existsSync(join(paths.inFlight, filename + '.heartbeat')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('queue: counts reflect each subdirectory', () => {
  const { dir, paths } = mkQueue();
  try {
    writeFileSync(join(paths.pending, 'a.md'), 'x');
    writeFileSync(join(paths.pending, 'b.md'), 'x');
    writeFileSync(join(paths.done, 'c.md'), 'x');
    const c = counts(paths);
    assert.deepEqual(c, {
      pending: 2,
      'in-flight': 0,
      'ready-for-review': 0,
      merged: 0,
      done: 1,
      failed: 0,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('queue: moveTo advances state and removes from in-flight', () => {
  const { dir, paths } = mkQueue();
  try {
    const filename = 'INIT-x.md';
    writeFileSync(join(paths.pending, filename), '---\ninitiative_id: INIT-x\n---\n');
    claim(filename, paths);
    moveTo(filename, 'ready-for-review', paths);
    assert.ok(existsSync(join(paths.readyForReview, filename)));
    assert.ok(!existsSync(join(paths.inFlight, filename)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('queue: moveTo advances in-flight → merged (R4-11-F1 confirmed-merge move)', () => {
  const { dir, paths } = mkQueue();
  try {
    const filename = 'INIT-y.md';
    writeFileSync(join(paths.pending, filename), '---\ninitiative_id: INIT-y\n---\n');
    claim(filename, paths);
    moveTo(filename, 'merged', paths);
    assert.ok(existsSync(join(paths.merged, filename)));
    assert.ok(!existsSync(join(paths.inFlight, filename)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('queue: promoteMergedToDone moves merged/ → done/ (the second terminal move, same sweep)', () => {
  const { dir, paths } = mkQueue();
  try {
    const filename = 'INIT-z.md';
    writeFileSync(join(paths.merged, filename), '---\ninitiative_id: INIT-z\n---\n');
    const to = promoteMergedToDone(filename, paths);
    assert.ok(existsSync(join(paths.done, filename)));
    assert.ok(!existsSync(join(paths.merged, filename)));
    assert.equal(to, join(paths.done, filename));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('queue: recover returns stale-heartbeat items to pending', () => {
  const { dir, paths } = mkQueue();
  try {
    const filename = 'INIT-stale.md';
    writeFileSync(join(paths.pending, filename), '---\ninitiative_id: INIT-stale\n---\n');
    claim(filename, paths);

    // Backdate the heartbeat to make it stale.
    const hbPath = join(paths.inFlight, filename + '.heartbeat');
    const past = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
    utimesSync(hbPath, past, past);

    const result = recover({
      paths,
      staleHeartbeatMs: 5 * 60 * 1000,
      worktreeExists: () => true,
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].reason, 'stale-heartbeat');
    assert.deepEqual(result[0].recovered, [filename]);
    assert.ok(existsSync(join(paths.pending, filename)), 'item back in pending');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('queue: moveTo from in-flight removes a live operator-stop flag too (M7 row 150 round 4)', () => {
  const { dir, paths } = mkQueue();
  try {
    const filename = 'INIT-stop-move.md';
    writeFileSync(join(paths.pending, filename), '---\ninitiative_id: INIT-stop-move\n---\n');
    claim(filename, paths);
    const flagPath = operatorStopPath(paths.inFlight, 'INIT-stop-move');
    writeFileSync(flagPath, '{}');
    assert.ok(existsSync(flagPath), 'precondition: the flag exists before the move');

    moveTo(filename, 'failed', paths);

    assert.ok(!existsSync(flagPath), 'the operator-stop flag must not outlive the halt');
    assert.ok(existsSync(join(paths.failed, filename)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  'queue: claim removes a STALE operator-stop flag from a prior cycle before renaming ' +
    '(M7 row 150 round 4)',
  () => {
  const { dir, paths } = mkQueue();
  try {
    const filename = 'INIT-stale-stop.md';
    writeFileSync(join(paths.pending, filename), '---\ninitiative_id: INIT-stale-stop\n---\n');
    const flagPath = operatorStopPath(paths.inFlight, 'INIT-stale-stop');
    writeFileSync(flagPath, '{}');
    assert.ok(existsSync(flagPath), 'precondition: a stale flag from a prior cycle is present');

    const claimed = claim(filename, paths);

    assert.ok(claimed, 'claim still succeeds');
    assert.ok(existsSync(join(paths.inFlight, filename)), 'the manifest is now in-flight');
    assert.ok(!existsSync(flagPath), 'a stale flag must never meet the new cycle');
    assert.ok(existsSync(join(paths.inFlight, filename + '.heartbeat')), 'heartbeat still written');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('queue: writeHeartbeat updates mtime', async () => {
  const { dir, paths } = mkQueue();
  try {
    const filename = 'INIT-hb.md';
    writeFileSync(join(paths.pending, filename), '---\ninitiative_id: INIT-hb\n---\n');
    claim(filename, paths);
    const hbPath = join(paths.inFlight, filename + '.heartbeat');
    // Backdate, then write a new heartbeat.
    const past = new Date(Date.now() - 10_000);
    utimesSync(hbPath, past, past);
    const before = statSync(hbPath).mtimeMs;
    writeHeartbeat(filename, paths);
    const after = statSync(hbPath).mtimeMs;
    assert.ok(after >= before, 'mtime advanced or equal');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listAllInitiativeIds: finds an id in every queue state dir, ignores non-manifests (forge-8vfn.30.5)', () => {
  const { dir, paths } = mkQueue();
  try {
    const { root, ...states } = paths;
    const want = new Set<string>();
    Object.values(states).forEach((d, i) => {
      writeFileSync(join(d, `INIT-2026-10-05-s${i}.md`), 'x');
      want.add(`INIT-2026-10-05-s${i}`);
    });
    writeFileSync(join(paths.done, 'INIT-2026-10-05-x.stop'), 'x');
    assert.deepEqual(listAllInitiativeIds(paths), want);
    assert.equal(want.size, 6);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
