/**
 * The stop door for a beat that is NOT on a session page — T1 ruling 580.
 *
 * WHAT WAS MISSING. `waitForHandleOrStall` had two paths, and the one taken by
 * every beat off a `/sessions/…` route was a bare `waitFor` with no poll, no
 * observation and no door. So 518's crash/terminal/stalled doors, the agent
 * process probe and 531(3) were all inert for exactly the beats carrying the
 * biggest bounds. G1/S10 run 5's beat 16 sat 14 m 13 s of its 15 minutes on a
 * page whose run had stopped writing before the beat even began.
 *
 * WHY THE DOM WAS THE WRONG SIGNAL, measured before it was built. The first
 * shape of 580 hashed `readObserved` and stopped on no change. But
 * `readObserved` collects only the keys the BEAT declared, so during a wait its
 * value sits at the pre-success values and changes exactly ONCE — at success.
 * `/artifact`'s whole contract is `data-page, data-page-ready, data-run,
 * data-artifact-type, data-mode, data-gate-state`, and the one that moves during
 * beat 16's wait moves when `open-reflect` appears, which is the success being
 * waited for. A door on that signal would have red-ed every off-session beat at
 * the ceiling whether or not the agent was working.
 *
 * WHAT THE SIGNAL IS. The run's own log. Run 5 measured the two apart: at
 * 23:58 the runner's log had been silent 2 m 31 s while the architect's
 * `events.jsonl` grew 33 822 → 48 409 bytes. `.heartbeat` and `events.jsonl` are
 * the two channels `bridge-studio-lifecycle.ts:199` already measures, and the
 * artifact page already publishes the id — `data-run={runId}` — which IS the
 * directory name under `_logs/`.
 *
 * THE DECLARED BOUND REMAINS A HARD MAXIMUM. No floor, no extension, nothing
 * runs longer than `upTo`; `MAX_DECLARED_WAIT_MS` is untouched. The only new
 * exit is earlier.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { DEFAULT_STALL_CEILING_MS } from '../../packages/sessions/bridge-studio-lifecycle.ts';
import { STALL_CEILING_MS, runLogDir, runLogIdleMs, makeOffSessionStallDoor } from './beats-agent-proc.mjs';
import { waitForHandleOrStall } from './beats-page.mjs';

test('580: the runner uses the PRODUCT\'s ceiling — one number, bound by this test', () => {
  // The runner cannot import the TypeScript constant (`run.mjs` is plain node)
  // and never speaks to the bridge, so the number is written twice. This is the
  // binding that makes that safe: a comment would not have survived, a red test
  // will.
  assert.equal(
    STALL_CEILING_MS,
    DEFAULT_STALL_CEILING_MS,
    'the story runner invented a second stall ceiling — one ceiling across the product',
  );
});

test('580: a run id from the page cannot escape _logs/', () => {
  const root = '/tmp/forge-root';
  // The real shape, and the one that broke the first draft of this regex: every
  // run id on the artifact page begins with an underscore.
  assert.equal(
    runLogDir(root, '_architect-2026-09-10T13-54-57-9eaf7fae'),
    '/tmp/forge-root/_logs/_architect-2026-09-10T13-54-57-9eaf7fae',
  );
  for (const hostile of ['../etc', 'a/../../b', '/etc/passwd', '.', '..', '', 'a b']) {
    assert.equal(runLogDir(root, hostile), null, `must refuse ${JSON.stringify(hostile)}`);
  }
  assert.equal(runLogDir('', 'ok'), null);
});

test('580: idle is read from the NEWEST of .heartbeat and events.jsonl, and no channel is not silence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-runlog-'));
  const NOW = 1_800_000_000_000;

  // No channel at all — "there is nothing to judge", not "it has been quiet".
  assert.equal(runLogIdleMs(dir, NOW), null);

  const stamp = (name: string, agoMs: number) => {
    const p = join(dir, name);
    writeFileSync(p, 'x');
    const secs = (NOW - agoMs) / 1000;
    utimesSync(p, secs, secs);
  };

  stamp('events.jsonl', 600_000);
  assert.equal(runLogIdleMs(dir, NOW), 600_000);

  // A fresher heartbeat wins: a run writing EITHER channel is not silent.
  stamp('.heartbeat', 5_000);
  assert.equal(runLogIdleMs(dir, NOW), 5_000);
});

test('580: the door resolves a page-supplied run id to its idle time', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-door-'));
  const runId = '_architect-2026-09-10T13-54-57-9eaf7fae';
  mkdirSync(join(root, '_logs', runId), { recursive: true });
  writeFileSync(join(root, '_logs', runId, 'events.jsonl'), '{}');

  const door = makeOffSessionStallDoor(root);
  assert.notEqual(door, null);
  const idle = door(runId);
  assert.ok(idle !== null && idle < 5_000, `a just-written log is not idle: ${idle}`);

  // A run the page names but that has no log dir is not a stalled run.
  assert.equal(door('_nothing-here'), null);
  // And a root the runner does not have is no door at all, rather than a door
  // that answers wrongly.
  assert.equal(makeOffSessionStallDoor(''), null);
});

/**
 * A page off any session route, modelling `/artifact`: it publishes `data-run`
 * and never grows the handle the beat is waiting for.
 */
function artifactPage({ runId, hasHandle = false }: { runId: string | null; hasHandle?: boolean }) {
  const node = { getAttribute: (k: string) => (k === 'data-run' ? runId : null) };
  const locator = (sel: string): any => ({
    first: () => locator(sel),
    count: async () => (hasHandle && sel.includes('open-reflect') ? 1 : 0),
    evaluate: async (fn: (n: unknown) => unknown) => fn(node),
    waitFor: async ({ timeout }: { timeout: number }) => {
      if (!hasHandle) await new Promise((r) => setTimeout(r, timeout));
    },
  });
  return { url: () => 'http://localhost:4124/artifact', locator };
}

const HANDLE = '[data-action="open-reflect"]';
const BOUND = 4_000;
/** Shrunk so a test can cross it; the real one is bound to the product above. */
const door = (idleMs: number | null) => () => idleMs;

test('580 (RED before the fix): a run that has gone silent ends the wait early, not at the bound', async () => {
  // Beat 16's exact shape. Before this, the unscoped branch was a bare
  // `waitFor` and this spent every millisecond of the declared bound.
  const page = artifactPage({ runId: '_architect-2026-09-10T13-54-57-9eaf7fae' });
  const began = Date.now();
  const stall = await waitForHandleOrStall(page as never, HANDLE, BOUND, null, null, door(STALL_CEILING_MS + 1));
  const took = Date.now() - began;

  assert.notEqual(stall, null, 'it must report a stall, not simply return');
  assert.ok(took < BOUND / 2, `it must end early, not at the bound — took ${took} ms of ${BOUND}`);
  assert.match(stall!.why, /_architect-2026-09-10T13-54-57-9eaf7fae/, `it names the run: ${stall!.why}`);
  assert.match(stall!.why, /stall ceiling/, stall!.why);
  assert.match(stall!.why, /open-reflect/, `and the handle that never came: ${stall!.why}`);
});

test('580 (CONTROL): a run that IS writing keeps its full declared bound', async () => {
  // The control run 5 justified: at 23:58 the runner's log had been silent
  // 2 m 31 s while the architect's events.jsonl grew 33 822 → 48 409 bytes. A
  // door that fired here would kill beats that are progressing normally.
  const page = artifactPage({ runId: '_architect-live' });
  const began = Date.now();
  const stall = await waitForHandleOrStall(page as never, HANDLE, BOUND, null, null, door(1_000));
  const took = Date.now() - began;

  assert.equal(stall, null, 'a writing run is not a stalled one');
  assert.ok(took >= BOUND - 200, `it must spend the whole declared bound — took ${took} ms of ${BOUND}`);
});

test('580 (CONTROL): a page naming no run behaves exactly as before', async () => {
  const page = artifactPage({ runId: null });
  const began = Date.now();
  const stall = await waitForHandleOrStall(page as never, HANDLE, BOUND, null, null, door(STALL_CEILING_MS + 1));
  const took = Date.now() - began;

  assert.equal(stall, null, 'no run named means nothing to judge — never a stall verdict');
  assert.ok(took >= BOUND - 200, `and the bound is still what governs — took ${took} ms`);
});

test('580 (CONTROL): the handle appearing still wins, immediately', async () => {
  const page = artifactPage({ runId: '_architect-silent', hasHandle: true });
  const began = Date.now();
  const stall = await waitForHandleOrStall(page as never, HANDLE, BOUND, null, null, door(STALL_CEILING_MS + 1));

  assert.equal(stall, null);
  assert.ok(Date.now() - began < 500, 'a present handle is checked before the door');
});
