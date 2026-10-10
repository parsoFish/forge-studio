/**
 * Bead forge-mfv5.1.27 — a red merge gate parks a FIX ROUND in
 * `_queue/ready-for-review/` and the drain re-enters it at once. Closure still
 * logs `closure.manifest-moved-to-ready-for-review`, so the queue door (T1
 * 1637) would credit that park as the review terminal. It must not: the guard
 * mirrors the Kickoff gate's, keyed on closure's own `closure-with-pending-fix-wi`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { channelTerminalState, queueManifestTerminal } from './beats-queue-terminal.mjs';

const INIT = 'INIT-2026-10-10-fix-round-park';

function plant(rounds: Array<'fix' | 'review'>): { root: string; dir: string } {
  const root = mkdtempSync(join(tmpdir(), 'story-fix-round-'));
  const dir = join(root, '_logs', `2026-10-10T01-55-59_${INIT}`);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(root, '_queue', 'ready-for-review'), { recursive: true });
  writeFileSync(join(root, '_queue', 'ready-for-review', `${INIT}.md`), '# parked\n');
  const rows = [{ event_type: 'start', message: 'cycle.start', started_at: '2026-10-10T01:56:00.000Z' }];
  rounds.forEach((kind, i) => {
    const at = `2026-10-10T05:0${i}:16.762Z`;
    rows.push({ event_type: 'start', message: 'closure.start', started_at: at });
    if (kind === 'fix') rows.push({ event_type: 'log', message: 'closure-with-pending-fix-wi', started_at: at, metadata: { pending_work_items: ['WI-6'], round: i + 1 } } as never);
    rows.push({ event_type: 'log', message: 'closure.manifest-moved-to-ready-for-review', started_at: at });
  });
  writeFileSync(join(dir, 'events.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return { root, dir };
}

test('a gate-red fix-round park is NOT credited as the review terminal (queue door + channel door)', () => {
  const { root, dir } = plant(['fix']);
  const q = queueManifestTerminal(root, INIT, dir);
  assert.equal(q?.unknown, true, JSON.stringify(q));
  assert.match(q!.detail, /fix round 1 for the drain — not the review terminal/);
  const c = channelTerminalState(root, dir);
  assert.equal(c?.unknown, true, JSON.stringify(c));
  assert.notEqual(c?.state, 'ready-for-review');
});

test('CONTROL: the round AFTER a fix round, parked for review, is credited', () => {
  const { root, dir } = plant(['fix', 'review']);
  const q = queueManifestTerminal(root, INIT, dir);
  assert.equal(q?.state, 'ready-for-review', JSON.stringify(q));
  assert.equal(channelTerminalState(root, dir)?.state, 'ready-for-review');
});
