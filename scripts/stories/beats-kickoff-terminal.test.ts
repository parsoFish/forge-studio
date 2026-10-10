/**
 * Bead forge-mfv5.1.25 — the Kickoff gate as a queue terminal. A
 * decomposition-only cycle ends `cycle.end {status:'awaiting-kickoff'}` and its
 * manifest STAYS in `_queue/ready-for-review/`, so the doors read the cycle's
 * LAST `cycle.end` to tell a kickoff from a review. A beat that waits for
 * `awaiting-kickoff` ends on it; one that waits for `ready-for-review` (a real
 * post-develop review) does not mistake a kickoff for it, and vice versa.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { makeCycleTerminalDoor } from './beats-agent-proc.mjs';
import { channelTerminalState, queueManifestTerminal } from './beats-queue-terminal.mjs';

function ground(initiative: string, ends: string[]): { root: string; dir: string } {
  const root = mkdtempSync(join(tmpdir(), 'story-kickoff-terminal-'));
  const dir = join(root, '_logs', `2026-10-10T10-00-00_${initiative}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'events.jsonl'), `${JSON.stringify({ event_type: 'start', message: 'cycle.start', started_at: '2026-10-10T10:00:00.000Z' })}\n`);
  ends.forEach((status, n) => appendFileSync(join(dir, 'events.jsonl'),
    `${JSON.stringify({ event_type: 'end', message: 'cycle.end', started_at: new Date(Date.now() - 1_000 + n).toISOString(), metadata: { status } })}\n`));
  mkdirSync(join(root, '_queue', 'ready-for-review'), { recursive: true });
  writeFileSync(join(root, '_queue', 'ready-for-review', `${initiative}.md`), '# i\n');
  return { root, dir };
}

test('channelTerminalState: ready-for-review/ + last cycle.end awaiting-kickoff reads awaiting-kickoff', () => {
  const { root, dir } = ground('INIT-kick', ['awaiting-kickoff']);
  assert.equal(channelTerminalState(root, dir)?.state, 'awaiting-kickoff');
});

test('channelTerminalState: a post-develop review after the kickoff stays ready-for-review', () => {
  const { root, dir } = ground('INIT-kick-then-dev', ['awaiting-kickoff', 'ready-for-review']);
  assert.equal(channelTerminalState(root, dir)?.state, 'ready-for-review');
});

test('queueManifestTerminal (cycleOf form): the kickoff end is its own arrival, no closure event needed', () => {
  const { root, dir } = ground('INIT-kick-id', ['awaiting-kickoff']);
  const seen = queueManifestTerminal(root, 'INIT-kick-id', dir);
  assert.equal(seen?.state, 'awaiting-kickoff', JSON.stringify(seen));
});

test('the anchor-form door ends a wait for awaiting-kickoff, and reds a wait for ready-for-review', () => {
  const { root } = ground('INIT-kick-door', ['awaiting-kickoff']);
  const door = makeCycleTerminalDoor(root)!;
  assert.equal(door(null, Date.now() - 60_000, 'awaiting-kickoff')?.done, true);
  assert.equal(door(null, Date.now() - 60_000, 'ready-for-review')?.done, false);
});
