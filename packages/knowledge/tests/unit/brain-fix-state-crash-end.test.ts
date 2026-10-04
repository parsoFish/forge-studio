/**
 * HIGH-7 (row 206 follow-up, forge-8vfn.8.5.56) — `readBrainFixState` scans
 * `events.jsonl` NEWEST FIRST and returns on the FIRST `end` event, before
 * ever reaching an `error` event further back. MEDIUM-4 made `runFixTurn`'s
 * crash path emit an `end` event (naming `status: 'failed'`) AFTER its
 * `error` event, so the reversed scan now hits that `end` FIRST and
 * misreads a crash as `'not-cleared'` (as if the turn completed without
 * clearing the finding) instead of `'failed'`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readBrainFixState } from '../../bridge-studio-kb-routes-maintenance.ts';

function writeCrashLog(root: string, runId: string): void {
  const dir = join(root, '_logs', `_brainfix-${runId}`);
  mkdirSync(dir, { recursive: true });
  const lines = [
    { event_type: 'start', message: 'brain-fix.start', metadata: {} },
    { event_type: 'error', message: 'brain-fix.crashed', metadata: { error: 'pinned stream failure' } },
    // MEDIUM-4's crash-path `end` — status 'failed', no `cleared` field at all.
    { event_type: 'end', message: 'brain-fix.end (error)', metadata: { status: 'failed', error: 'Error: pinned stream failure' } },
  ];
  writeFileSync(dir + '/events.jsonl', lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

test('readBrainFixState: a crashed run (error then a status:failed end) reads state "failed", not "not-cleared"', () => {
  const root = mkdtempSync(join(tmpdir(), 'brain-fix-crash-end-'));
  try {
    writeCrashLog(root, 'r-crash-1');
    const state = readBrainFixState(root, 'r-crash-1');
    assert.equal(state.state, 'failed', `a crashed run must read 'failed', got ${JSON.stringify(state)}`);
    assert.equal(state.cleared, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('readBrainFixState: an ordinary (non-crashed) end still reads cleared/not-cleared from its own metadata, unaffected', () => {
  const root = mkdtempSync(join(tmpdir(), 'brain-fix-ok-end-'));
  try {
    const dir = join(root, '_logs', '_brainfix-r-ok-1');
    mkdirSync(dir, { recursive: true });
    const lines = [
      { event_type: 'start', message: 'brain-fix.start', metadata: {} },
      { event_type: 'end', message: 'brain-fix.end', metadata: { cleared: true } },
    ];
    writeFileSync(dir + '/events.jsonl', lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const state = readBrainFixState(root, 'r-ok-1');
    assert.equal(state.state, 'cleared');
    assert.equal(state.cleared, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
