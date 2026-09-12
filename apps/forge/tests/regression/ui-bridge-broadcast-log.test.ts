/**
 * `forge-8vfn.7.6.35` (T1 ruling 753(1), raised by M6-C from the other side).
 *
 * THE QUESTION THAT COULD NOT BE ANSWERED. S10 run 12's trace had to establish
 * whether the bridge broadcast `cycle-list-changed` when the daemon moved a
 * manifest through the queue. It could not be answered AT ALL: the run booted
 * its own bridge and left no `_bridge-*` dir, and `ui-bridge.ts`'s `broadcast`
 * recorded nothing. The strongest available statement was "watchQueue watches
 * all six dirs, the manifest demonstrably moved, therefore it must have
 * broadcast" — a mechanism plus a disk state, not a measurement.
 *
 * It matters because the two answers are different beads in different files: a
 * stale card with NO broadcast is a watcher defect; a stale card WITH a
 * broadcast is a subscriber defect. **The subscriber count is the half that
 * turns the record into a discriminator** — `type` plus `timestamp` says the
 * bridge spoke; `subscribers=0` versus `subscribers=1` says whether anyone was
 * listening, recorded at the moment it happens rather than reconstructed after.
 *
 * RUN: node --experimental-strip-types --test apps/forge/tests/regression/ui-bridge-broadcast-log.test.ts
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WebSocket } from 'ws';

import { startBridge } from '../../ui-bridge.ts';

process.env.FORGE_ARCHITECT_NO_SPAWN = '1';

let forgeRoot: string;
let url: string;
let closeBridge: () => Promise<void>;

/** Every `_bridge-*` run the bridge opened under this fixture's `_logs`. */
function bridgeRunDirs(): string[] {
  return readdirSync(join(forgeRoot, '_logs'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('_bridge-'))
    .map((e) => e.name);
}

type Entry = { event_type: string; metadata?: Record<string, unknown>; started_at?: string };

function broadcastEntries(): Entry[] {
  const out: Entry[] = [];
  for (const dir of bridgeRunDirs()) {
    let raw = '';
    try { raw = readFileSync(join(forgeRoot, '_logs', dir, 'events.jsonl'), 'utf8'); } catch { continue; }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      const entry = JSON.parse(line) as Entry;
      if (entry.metadata?.['broadcast'] === true) out.push(entry);
    }
  }
  return out;
}

/**
 * Touch a queue dir so `watchQueue`'s `fsWatch` fires (`ui-bridge.ts:499`), then
 * wait for the record rather than for a fixed delay — `fs.watch` is not
 * synchronous and a sleep long enough to be safe is long enough to be slow.
 */
async function triggerQueueBroadcast(name: string, waitMs = 4000): Promise<Entry[]> {
  const before = broadcastEntries().length;
  writeFileSync(join(forgeRoot, '_queue', 'pending', name), 'id: x\n', 'utf8');
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const now = broadcastEntries();
    if (now.length > before) return now.slice(before);
    await new Promise((r) => setTimeout(r, 50));
  }
  return [];
}

function connect(): Promise<WebSocket> {
  const ws = new WebSocket(`${url.replace(/^http/, 'ws')}/ws`);
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-broadcast-log-'));
  for (const state of ['pending', 'in-flight', 'ready-for-review', 'merged', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'projects'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'flows'), { recursive: true });
  writeFileSync(
    join(forgeRoot, 'studio', 'catalog.yaml'),
    ['sdks: []', 'models: []', 'tools: []', 'mcps: []', 'guards: []', 'community-skills: []', ''].join('\n'),
  );
  ({ url, close: closeBridge } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (closeBridge) await closeBridge();
  delete process.env.FORGE_ARCHITECT_NO_SPAWN;
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

test('the bridge opens its own `_bridge-*` run at BOOT, not on first broadcast', () => {
  // Deliberately at boot. `isDispatchDir` (`scripts/stories/beats-agent-proc.mjs`)
  // treats ANY `_`-prefixed `_logs` entry as a dispatch dir, and the story
  // harness anchors a beat's agent-channel door on the newest one BORN AFTER a
  // press. A lazily-opened bridge run would be born mid-story on the very queue
  // change a press caused, and door a beat onto the bridge's own log. Born at
  // boot it predates every press, and the door filters by birth time.
  assert.equal(bridgeRunDirs().length, 1, `expected exactly one _bridge-* run; got ${JSON.stringify(bridgeRunDirs())}`);
});

test('a cycle-list-changed broadcast is recorded with its type and a timestamp — "did it fire?" is answerable from bytes', async () => {
  const fresh = await triggerQueueBroadcast('INIT-one.md');
  assert.ok(fresh.length > 0, 'a queue write must leave a broadcast record; got none');
  const rec = fresh.find((e) => e.metadata?.['type'] === 'cycle-list-changed');
  assert.ok(rec, `expected a cycle-list-changed record; got ${JSON.stringify(fresh.map((e) => e.metadata?.['type']))}`);
  assert.ok(typeof rec.started_at === 'string' && rec.started_at !== '', 'the record carries a timestamp');
});

test('SUBSCRIBER COUNT is the discriminator: 0 with nobody listening, 1 with a client attached', async () => {
  const none = await triggerQueueBroadcast('INIT-two.md');
  const noneRec = none.find((e) => e.metadata?.['type'] === 'cycle-list-changed');
  assert.ok(noneRec, 'a broadcast with no subscriber is still recorded — silence is the finding');
  assert.equal(noneRec.metadata?.['subscribers'], 0, 'nobody was listening, and the record must say so');

  const ws = await connect();
  try {
    const one = await triggerQueueBroadcast('INIT-three.md');
    const oneRec = one.find((e) => e.metadata?.['type'] === 'cycle-list-changed');
    assert.ok(oneRec, 'the broadcast with a client attached must be recorded too');
    assert.equal(oneRec.metadata?.['subscribers'], 1, 'one client was listening; a stale card here is a SUBSCRIBER defect, not a watcher one');
  } finally {
    ws.close();
  }
});
