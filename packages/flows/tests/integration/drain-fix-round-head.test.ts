/**
 * Bead forge-mfv5.1.27 (security review, item 3) — the drain re-enters a
 * GATE-FIX round only on the branch head it was parked on. The SAME head check
 * as the requeue runs BEFORE the drain's rename claim, so a moved head parks
 * by name: no claim, no move, no re-entry. A review send-back round keeps
 * today's behaviour (CI-fixer commits may legitimately follow it).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { drainPendingFixWorkItems } from '../../drain-fix-loop.ts';
import type { PhaseWiring } from '../../phase-wiring.ts';
import { FIX_INIT, plantStrandedFixRound } from '../test-fixtures/stranded-fix-round.ts';

async function drain(opts: { move: boolean; fixOrigin?: 'gate-fix' | 'review-fix' }) {
  const root = mkdtempSync(join(tmpdir(), 'drain-fix-head-'));
  try {
    const fx = plantStrandedFixRound(root, { withGit: true, fixOrigin: opts.fixOrigin });
    if (opts.move) {
      writeFileSync(join(fx.worktree, 'stray.txt'), 'x\n');
      execFileSync('git', ['add', 'stray.txt'], { cwd: fx.worktree, stdio: 'pipe' });
      execFileSync('git', ['commit', '-q', '-m', 'stray'], { cwd: fx.worktree, stdio: 'pipe' });
    }
    let reentered = 0;
    const results = await drainPendingFixWorkItems({
      queueRoot: join(root, '_queue'), logsRoot: join(root, '_logs'), phaseWiring: {} as PhaseWiring,
      confirmMerge: () => false, runDrainCycle: async () => { reentered += 1; return { status: 'ready-for-review' }; },
    });
    const events = readFileSync(join(fx.logDir, 'events.jsonl'), 'utf8');
    return { result: results.find((r) => r.initiativeId === FIX_INIT), reentered, stillParked: existsSync(fx.manifestPath), events };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('gate-fix round + moved branch head → the drain does not re-enter, parks by name, nothing moves', async () => {
  const d = await drain({ move: true });
  assert.equal(d.reentered, 0, 'no re-entry on a moved head');
  assert.equal(d.result?.status, 'needs-operator', JSON.stringify(d.result));
  assert.match(d.result?.detail ?? '', /branch head moved since the last delivered work item/);
  assert.ok(d.stillParked, 'no claim: the manifest stays in ready-for-review');
  assert.match(d.events, /"fix-round\.head-moved"/, 'a named event');
});

test('CONTROL: gate-fix round on the delivered head re-enters', async () => {
  const d = await drain({ move: false });
  assert.equal(d.reentered, 1, JSON.stringify(d.result));
});

test('a review send-back round keeps today\'s behaviour on a moved head (re-enters)', async () => {
  const d = await drain({ move: true, fixOrigin: 'review-fix' });
  assert.equal(d.reentered, 1, JSON.stringify(d.result));
});
