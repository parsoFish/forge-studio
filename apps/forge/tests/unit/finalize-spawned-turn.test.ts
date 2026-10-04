/**
 * MEDIUM-2 (row 206 follow-up, forge-8vfn.8.5.56) — `spawnAgentTurn`'s
 * post-spawn handling: when `proc.pid` is a number, record it (this
 * OVERWRITES the claim placeholder, safe because `claimDispatchSlot` already
 * proved sole ownership); when it ISN'T (EAGAIN/ENOMEM — a spawn attempt
 * that returns with no sync throw and no pid), release the claim and report
 * the failure honestly, rather than leaving a wedged `CLAIMING` placeholder
 * and returning `{ok:true}` for a turn that never started.
 *
 * `finalizeSpawnedTurn` is extracted from `spawnAgentTurn` purely so this is
 * independently testable with a literal `pid` value — mirroring
 * `buildAgentDispatchArgs`'s own extraction in this file ("no spawn, no
 * mock"): reproducing a genuine no-sync-throw, no-pid spawn() outcome
 * through a REAL child_process call is not practically forceable from a
 * test (every documented synchronous-failure shape either throws or yields
 * a real pid in this calling context), so the outcome-handling logic is
 * pulled out and exercised directly instead of mocking node:child_process
 * (a path this repo tried and removed — see ui-bridge-agent-run-ceiling.test.ts).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { finalizeSpawnedTurn } from '../../bridge-agent-dispatch.ts';
import { claimDispatchSlot } from '@forge/kernel';

function readTurnPid(root: string, logDirName: string): string | null {
  try {
    return readFileSync(join(root, '_logs', logDirName, 'turn.pid'), 'utf8');
  } catch {
    return null;
  }
}

test('finalizeSpawnedTurn: a numeric pid overwrites the claim placeholder and reports ok:true, spawned:true', () => {
  const root = mkdtempSync(join(tmpdir(), 'finalize-spawned-turn-ok-'));
  try {
    mkdirSync(join(root, '_logs'), { recursive: true });
    claimDispatchSlot(root, 'name', 'mark', () => false);
    const result = finalizeSpawnedTurn(root, 'name', 4242);
    assert.deepEqual(result, { ok: true, spawned: true });
    assert.equal(readTurnPid(root, 'name'), '4242\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('finalizeSpawnedTurn: MEDIUM-2 — an undefined pid releases the claim and reports ok:false, never ok:true for a turn that never started', () => {
  const root = mkdtempSync(join(tmpdir(), 'finalize-spawned-turn-nopid-'));
  try {
    mkdirSync(join(root, '_logs'), { recursive: true });
    claimDispatchSlot(root, 'name', 'mark', () => false);
    const result = finalizeSpawnedTurn(root, 'name', undefined);
    assert.equal(result.ok, false, 'a spawn with no pid must never report ok:true');
    assert.ok('error' in result && typeof result.error === 'string' && result.error.length > 0);
    assert.equal(readTurnPid(root, 'name'), null, 'the claim must be released — a future dispatch must not stay wedged');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
