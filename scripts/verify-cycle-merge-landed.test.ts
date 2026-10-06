/**
 * Bead forge-8vfn.30.5 — "the cycle reached merge" must key on the cycle THIS
 * run started. A stale manifest of the same initiative id, left in
 * `_queue/done/` by an earlier run, was accepted after 3 minutes and the gate
 * wrote FAIL while the real cycle was still running the developer agent.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { manifestLandedForRun } from './verify-cycle-merge-landed.mjs';

const ID = 'INIT-2026-10-05-coupling-sort-flag';
const mk = (cycle: string) => `---\ninitiative_id: ${ID}\ncycle_id: ${cycle}\n---\nbody\n`;

function queue(): { root: string; paths: { merged: string; done: string } } {
  const root = mkdtempSync(join(tmpdir(), 'vc-merge-landed-'));
  const paths = { merged: join(root, 'merged'), done: join(root, 'done') };
  mkdirSync(paths.merged); mkdirSync(paths.done);
  return { root, paths };
}
const plant = (dir: string, cycle: string, mtimeMs: number): void => {
  const f = join(dir, `${ID}.md`);
  writeFileSync(f, mk(cycle));
  utimesSync(f, mtimeMs / 1000, mtimeMs / 1000);
};

const START = Date.parse('2026-10-05T10:00:00Z');

test('a STALE done manifest with the same id, older than the run start, is NOT reached', () => {
  const { root, paths } = queue();
  try {
    plant(paths.done, 'cycle-OLD', START - 3_600_000);
    assert.equal(manifestLandedForRun({ queuePaths: paths, initiativeId: ID, cycleId: 'cycle-NEW', runStartMs: START }), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a same-id manifest newer than the start but carrying ANOTHER cycle_id is NOT reached', () => {
  const { root, paths } = queue();
  try {
    plant(paths.done, 'cycle-OLD', START + 1000);
    assert.equal(manifestLandedForRun({ queuePaths: paths, initiativeId: ID, cycleId: 'cycle-NEW', runStartMs: START }), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('our own cycle manifest in done/ or merged/, newer than the start, IS reached', () => {
  for (const state of ['done', 'merged'] as const) {
    const { root, paths } = queue();
    try {
      plant(paths[state], 'cycle-NEW', START + 1000);
      assert.equal(manifestLandedForRun({ queuePaths: paths, initiativeId: ID, cycleId: 'cycle-NEW', runStartMs: START }), true, state);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test('no cycle id known: fails closed (a bare id match is never enough)', () => {
  const { root, paths } = queue();
  try {
    plant(paths.done, 'cycle-NEW', START + 1000);
    assert.equal(manifestLandedForRun({ queuePaths: paths, initiativeId: ID, cycleId: null, runStartMs: START }), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('absent manifest: not reached', () => {
  const { root, paths } = queue();
  try {
    assert.equal(manifestLandedForRun({ queuePaths: paths, initiativeId: ID, cycleId: 'cycle-NEW', runStartMs: START }), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
