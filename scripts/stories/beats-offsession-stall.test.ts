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
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { DEFAULT_STALL_CEILING_MS } from '../../packages/sessions/bridge-studio-lifecycle.ts';
import {
  STALL_CEILING_MS, runLogDir, runLogIdleMs, newestChannelSince, makeAgentChannelDoor,
  doorWorthRunning, scanSummary,
} from './beats-agent-proc.mjs';
import { waitForHandleOrStall, waitForConsequence } from './beats-page.mjs';

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

  const door = makeAgentChannelDoor(root);
  assert.notEqual(door, null);
  // A just-written channel is not stalled, and the door says nothing.
  assert.equal(door(runId, Date.now()), null);
  // A root the runner does not have is no door at all, rather than a door that
  // answers wrongly.
  assert.equal(makeAgentChannelDoor(''), null);
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
// Over 664(i)'s gate (2 x the 180 s ceiling), because a bound at or under it is
// deliberately NOT doored. Nothing waits this long: every doored test below ends
// at the door on its first poll; the bound is here to clear the gate, not to be
// spent. The two controls that DO spend a bound use `SHORT` instead.
const BOUND = 2 * STALL_CEILING_MS + 10_000;
const SHORT = 4_000;
/** Shrunk so a test can cross it; the real one is bound to the product above. */
/**
 * A stand-in for the real channel door. Its SHAPE is the contract under test:
 * `(runId, sinceMs) => {reason, detail} | null`, where null means "nothing to
 * report, keep waiting".
 */
const door = (stop: { reason: string; detail: string } | null) => () => stop;
const QUIET = { reason: 'channel-quiet', detail: 'has written nothing for 200s, past the 180s stall ceiling.' };
const NONE = { reason: 'no-channel', detail: 'no agent channel appeared in 200s.' };

test('580 (RED before the fix): a run that has gone silent ends the wait early, not at the bound', async () => {
  // Beat 16's exact shape. Before this, the unscoped branch was a bare
  // `waitFor` and this spent every millisecond of the declared bound.
  const page = artifactPage({ runId: '_architect-2026-09-10T13-54-57-9eaf7fae' });
  const began = Date.now();
  const stall = await waitForHandleOrStall(page as never, HANDLE, BOUND, null, null, door(QUIET));
  const took = Date.now() - began;

  assert.notEqual(stall, null, 'it must report a stall, not simply return');
  assert.ok(took < BOUND / 2, `it must end early, not at the bound — took ${took} ms of ${BOUND}`);
  assert.match(stall!.why, /channel-quiet/, `it names WHICH finding this is: ${stall!.why}`);
  assert.match(stall!.why, /stall ceiling/, stall!.why);
  assert.match(stall!.why, /open-reflect/, `and the handle that never came: ${stall!.why}`);
});

test('580 (CONTROL): a run that IS writing keeps its full declared bound', async () => {
  // The control run 5 justified: at 23:58 the runner's log had been silent
  // 2 m 31 s while the architect's events.jsonl grew 33 822 → 48 409 bytes. A
  // door that fired here would kill beats that are progressing normally.
  const page = artifactPage({ runId: '_architect-live' });
  const began = Date.now();
  const stall = await waitForHandleOrStall(page as never, HANDLE, SHORT, null, null, door(null));
  const took = Date.now() - began;

  assert.equal(stall, null, 'a writing run is not a stalled one');
  assert.ok(took >= SHORT - 200, `it must spend the whole declared bound — took ${took} ms of ${SHORT}`);
});

test('7.5.8: a page naming NO run still gets a door — this is what 580 was missing', async () => {
  // SUPERSEDES 580's control, deliberately. Under 580 this case had no door at
  // all: `data-run` was the only channel, so a beat that pressed something from
  // a page naming no run sat its whole bound. That is exactly what S10 run 7's
  // beat 7 did — twenty minutes on `/projects/gitpulse`, which publishes no
  // run — and the door now falls back to the newest dispatch created since the
  // press, reporting `no-channel` when none ever appears.
  const page = artifactPage({ runId: null });
  const began = Date.now();
  const stall = await waitForHandleOrStall(page as never, HANDLE, BOUND, null, null, door(NONE));
  const took = Date.now() - began;

  assert.notEqual(stall, null, 'a page naming no run is no longer un-doored');
  assert.ok(took < BOUND / 2, `it must end early, not at the bound — took ${took} ms of ${BOUND}`);
  assert.match(stall!.why, /no-channel/, `and say WHICH finding it is: ${stall!.why}`);
  assert.match(stall!.why, /open-reflect/, stall!.why);
});

test('7.5.8 (CONTROL): no door at all is still today\'s behaviour', async () => {
  // The runner without a ROOT — `makeAgentChannelDoor('')` returns null — must
  // spend the declared bound exactly as before. A missing door is not a stall
  // verdict.
  const page = artifactPage({ runId: null });
  const began = Date.now();
  const stall = await waitForHandleOrStall(page as never, HANDLE, SHORT, null, null, null);

  assert.equal(stall, null);
  assert.ok(Date.now() - began >= SHORT - 200, 'the bound still governs when there is nothing to observe');
});

test('580 (CONTROL): the handle appearing still wins, immediately', async () => {
  const page = artifactPage({ runId: '_architect-silent', hasHandle: true });
  const began = Date.now();
  const stall = await waitForHandleOrStall(page as never, HANDLE, BOUND, null, null, door(QUIET));

  assert.equal(stall, null);
  assert.ok(Date.now() - began < 500, 'a present handle is checked before the door');
});

/**
 * The two fixtures ruling 626 requires, driven through the REAL door against a
 * REAL `_logs` tree rather than a stand-in.
 *
 * The stand-in above pins the WAIT's behaviour given a door's answer. These pin
 * the DOOR's answer given a filesystem — and they are written this way because
 * the last defect in this area was a hand-written fixture agreeing with its
 * author: five green tests against a path shape the producer never emitted
 * (#615). A fake door cannot tell you that `newestChannelSince` reads birth
 * time, or that a dispatch dir is `_`-prefixed.
 */
function realDoor() {
  const root = mkdtempSync(join(tmpdir(), 'forge-channel-'));
  mkdirSync(join(root, '_logs'), { recursive: true });
  return { root, logs: join(root, '_logs'), door: makeAgentChannelDoor(root)! };
}

test('626 (RED): nothing ever starts — run 7 beat 7\'s shape — is `no-channel` after the ceiling', () => {
  // Beat 7 pressed Plan, the enqueue succeeded, and no scheduler claimed it:
  // no dispatch dir was ever created. Twenty minutes of a funded run.
  const { door } = realDoor();
  const pressedAt = Date.now() - (STALL_CEILING_MS + 5_000);

  const stop = door(null, pressedAt);
  assert.notEqual(stop, null, 'past the ceiling with no channel, the wait must end');
  assert.equal(stop!.reason, 'no-channel');
  assert.match(stop!.detail, /never started|nothing under _logs/, stop!.detail);

  // BEFORE the ceiling it says nothing — a dispatch is allowed to take a moment
  // to create its directory, and this must not red a beat that is merely early.
  assert.equal(door(null, Date.now() - 1_000), null);
});

test('626 (RED): a channel that goes quiet is `channel-quiet`, and a writing one is neither', () => {
  const { logs, door } = realDoor();
  const pressedAt = Date.now() - 60_000;
  const dispatch = join(logs, '_architect-2026-09-11T00-00-00-abcd1234');
  mkdirSync(dispatch, { recursive: true });
  const events = join(dispatch, 'events.jsonl');
  writeFileSync(events, '{}');

  // Written just now: the agent is working, and the beat keeps its full bound.
  assert.equal(door(null, pressedAt), null, 'a writing channel is not a stalled one');

  // Now age it past the ceiling.
  const old = (Date.now() - (STALL_CEILING_MS + 10_000)) / 1000;
  utimesSync(events, old, old);
  const stop = door(null, pressedAt);
  assert.notEqual(stop, null);
  assert.equal(stop!.reason, 'channel-quiet');
  assert.match(stop!.detail, /_architect-2026-09-11T00-00-00-abcd1234/, `it names the channel: ${stop!.detail}`);
});

test('626: the fallback takes a dispatch born SINCE the press, never a bystander', () => {
  // A pre-existing dir that happens to be written during the wait belongs to
  // somebody else's run. Matching it would let another lane's activity hold
  // this beat's bound open — or end it with a verdict about a channel this
  // press never started.
  const { logs } = realDoor();
  const older = join(logs, '_agent-from-an-earlier-run');
  mkdirSync(older, { recursive: true });
  writeFileSync(join(older, 'events.jsonl'), '{}');

  // A press AFTER that directory was born finds no channel of its own.
  assert.equal(
    newestChannelSince(logs, Date.now() + 1_000),
    null,
    "a dir born before the press is not this press's channel",
  );
  // And one before it does.
  assert.equal(newestChannelSince(logs, Date.now() - 60_000), older);

  // NOT ASSERTED HERE, deliberately: that the door then reports `no-channel`
  // for this tree. That needs a dispatch born before a press which is ALSO
  // further in the past than the stall ceiling, and a directory's birth time
  // cannot be back-dated — `utimes` moves atime and mtime, never `birthtime`.
  // Writing it anyway would mean weakening the filter to something a test can
  // reach, which is how a fixture starts dictating the behaviour instead of
  // checking it. The `no-channel` path is covered by the test above, on a tree
  // with no bystander in it.
});

/**
 * THE TEST THAT WAS MISSING — T1 ruling 640, bought twice at twenty minutes.
 *
 * `forge-8vfn.7.5.8` put the channel door in `waitForHandleOrStall`, and every
 * test above exercises it there. But that is the PRE-act wait: it returns the
 * moment the control appears, which is what a press does. An off-session beat
 * spends its bound in `waitForConsequence`, AFTER the act — and that is where
 * S10 run 7's beat 7 and run 8's beat 8 each sat their full twenty minutes with
 * the door a few lines away and never consulted.
 *
 * Both verdicts said which wait it was, in their own words: "gave up at the
 * agent wait (declared 1200000 ms)" is `beatBound`'s label, produced on the
 * consequence path. The door was tested against the wait I had changed rather
 * than the wait the measurement named (§15.356), so the tests passed and the
 * defect shipped.
 *
 * These drive `waitForConsequence` directly, which is the only place this could
 * have been caught.
 */
function planPage() {
  // Beat 8's shape: the page is fine, the press succeeded, and the state the
  // beat waits for will never arrive because nothing is going to compute it.
  const locator = (): any => ({
    first: () => locator(), count: async () => 1, nth: () => locator(),
    evaluateAll: async (fn: any, a: any) => fn([], a), waitFor: async () => {},
    click: async () => {}, fill: async () => {},
  });
  return {
    url: () => 'http://localhost:4124/projects/gitpulse',
    locator,
    waitForSelector: async () => {},
    evaluate: async (_fn: unknown, arg?: { wanted?: string[] }) => {
      const all: Record<string, string> = {
        page: 'projects', 'page-ready': 'true', 'project-id': 'gitpulse', 'plan-state': 'unplanned',
      };
      const w = arg?.wanted ?? null;
      return {
        data: w === null ? all : Object.fromEntries(Object.entries(all).filter(([k]) => w.includes(k))),
        nested: [], lifecycle: null, lifecycleError: null, sessionPhase: null,
      };
    },
  };
}

const PLAN_BEAT = {
  act: 'Plan the initiative the Architect produced',
  expect: { route: '/projects/gitpulse', data: { page: 'projects', 'plan-state': 'planned' } },
  say: 'the station between deciding and building',
};

test('640 (RED before the fix): the CONSEQUENCE wait consults the door — beat 8\'s exact shape', async () => {
  // Run 8's condition as the door SEES it: no channel belonging to this press.
  //
  // The run's `_logs/` did hold one dispatch, born nine minutes before the
  // press — but a directory's birth time cannot be back-dated (`utimes` moves
  // atime and mtime only), so a fixture cannot stage "born before a press that
  // is itself older than the ceiling". An empty log dir puts the door in
  // exactly the state that one produced, and the birth-time filter that makes
  // them equivalent is pinned by its own test above. What THIS test is for is
  // WHICH WAIT asks — and before 640 the answer was neither.
  const { door } = realDoor();
  const pressedAt = Date.now() - (STALL_CEILING_MS + 5_000);

  const began = Date.now();
  const stall = await waitForConsequence(
    planPage() as never, PLAN_BEAT, 2 * STALL_CEILING_MS + 10_000, null, null, null,
    // The door as the runner builds it, given the press time this beat began at.
    (runId: string | null) => door(runId, pressedAt),
  );
  const took = Date.now() - began;

  assert.notEqual(stall, null, 'before 640 this returned null and the beat spent its whole bound');
  assert.match(stall!.why, /no-channel/, `and it names WHICH finding: ${stall!.why}`);
  assert.ok(took < 5_000, `it must end at the door, not at the 20 s bound — took ${took} ms`);
});

test('640 (CONTROL): a run that IS writing keeps the consequence bound', async () => {
  const { logs, door } = realDoor();
  const fresh = join(logs, '_architect-live');
  mkdirSync(fresh, { recursive: true });
  writeFileSync(join(fresh, 'events.jsonl'), '{}');
  const pressedAt = Date.now() - 1_000;

  const began = Date.now();
  const stall = await waitForConsequence(
    planPage() as never, PLAN_BEAT, 1_200, null, null, null,
    (runId: string | null) => door(runId, pressedAt),
  );

  assert.equal(stall, null, 'a writing channel is not a stalled one');
  assert.ok(Date.now() - began >= 1_000, 'and the declared bound still governs');
});

test('640 (CONTROL): no door at all leaves the consequence wait exactly as it was', async () => {
  const began = Date.now();
  const stall = await waitForConsequence(planPage() as never, PLAN_BEAT, 1_000, null, null, null, null);

  assert.equal(stall, null);
  assert.ok(Date.now() - began >= 900, 'unchanged: the bound is what governs when there is nothing to observe');
});

test('640 REGRESSION: a SESSION beat is never doored by the channel — lane A\'s S1 run 5', () => {
  // 640 shipped without this gate and it cost another lane two beats of a
  // funded run. A session beat's dispatch dir was born when the SESSION
  // started, long before this beat's wait began, so `newestChannelSince`
  // finds nothing and the door reports `no-channel` about an agent that is
  // demonstrably working: S1 beats 6 and 9 were killed at 180 s of a 420 s
  // bound while the beat's own probe printed `SDK child utime 18 → 371`.
  //
  // A session beat is already doored, and better — `stopReasonFor` is the
  // PRODUCT's crashed/stalled/terminal verdict for the session in scope. The
  // channel door is for beats with no session to ask about.
  //
  // Asserted at the GATE rather than through the wait, because the wait would
  // need a whole session fixture to reach the same line and would then be
  // testing the fixture. The condition IS the fix.
  const src = readFileSync(new URL('./beats-page.mjs', import.meta.url), 'utf8');
  const consequenceDoor = src.slice(src.indexOf('export async function waitForConsequence'));
  assert.match(
    consequenceDoor,
    /if \(stallDoor !== null && sessionScope === null && doorWorthRunning\(timeoutMs, STALL_CEILING_MS\)\) \{/,
    'the consequence wait must consult the channel door only when there is no session to ask about',
  );
  // And the pre-act wait reaches it only through `waitOffSession`, which is
  // already unreachable for a session beat.
  assert.match(src, /if \(sessionScope === null\) return waitOffSession\(/, 'the handle wait stays scoped as it was');
});

test('664(i): the door is NEVER CONSULTED when it would consume most of the bound', async () => {
  // Lane A's S1 beat 9: a 200 s bound against a 180 s ceiling leaves the beat
  // twenty seconds of its own patience. A beat that asked for 200 s has SAID it
  // expects to wait; the door firing there is the verdict, not an early exit.
  //
  // Asserted by giving the wait a door that THROWS if it is called, and a
  // handle that arrives quickly. The first draft of this test waited the whole
  // 360 s bound to prove the same thing and took six minutes of wall clock —
  // a test that burns the bound to prove the bound is not burned.
  const page = artifactPage({ runId: null, hasHandle: true });
  const exploding = () => { throw new Error('the door must not be consulted on a short bound'); };

  const stall = await waitForHandleOrStall(
    page as never, HANDLE, 2 * STALL_CEILING_MS, null, null, exploding as never,
  );

  assert.equal(stall, null, 'the handle arrived and the wait ended on it');
});

test('664(i): a bound comfortably over twice the ceiling IS still doored', async () => {
  // The control: the rule must not disable the door generally. Run 9's beat had
  // a 20-minute bound and the door saved seventeen minutes of it.
  const page = artifactPage({ runId: null });
  const began = Date.now();
  const stall = await waitForHandleOrStall(page as never, HANDLE, 2 * STALL_CEILING_MS + 1, null, null, door(NONE));

  assert.notEqual(stall, null, 'a long bound keeps its door');
  assert.ok(Date.now() - began < 5_000, 'and ends at the door rather than the bound');
});

test('664(ii): the door states what it scanned, so an off-session red is decidable', () => {
  // S1 beat 9 reded `no-channel` with no probe beside it and nobody could tell
  // whether the door was right: `makeAgentProcProbe` returns null for every
  // non-session route, so an off-session beat is doored by evidence it never
  // prints. Beat 6's false red was provable only because its session path
  // printed 1768 samples.
  //
  // Staged with an EMPTY `_logs`, which is the state a press that dispatched
  // nothing actually produces. The other branch — "newest dir born N seconds
  // BEFORE this press" — needs a directory born before a press that is itself
  // older than the ceiling, and birth time cannot be back-dated (`utimes` moves
  // atime and mtime only). That is the third time this fixture limit has caught
  // me in this file; it is recorded here rather than worked around, because the
  // alternative is weakening the filter to something a test can reach.
  const { door: realDoorFn } = realDoor();

  assert.equal(realDoorFn(null, Date.now() - 1_000), null, 'before the ceiling it says nothing');

  const past = realDoorFn(null, Date.now() - (STALL_CEILING_MS + 5_000));
  assert.notEqual(past, null);
  assert.equal(past!.reason, 'no-channel');
  assert.match(past!.detail, /Scanned /, `it must state its evidence: ${past!.detail}`);
  assert.match(past!.detail, /0 dispatch dir\(s\)/, past!.detail);
  assert.match(past!.detail, /newest none/, past!.detail);
});

/**
 * T1 ruling 751 (§15.430) — THE DOOR WAS LOOKING AT THE WRONG SHELF.
 *
 * Run 12's beat 23 reported `newest _architect-2026-09-11T15-11-38 born 857s
 * BEFORE this press` and that was read as "nothing was dispatched". It was true
 * and irrelevant: the daemon HAD claimed within a second of beat 7's green and
 * run a full cycle to ready-for-review, into
 * `_logs/2026-09-11T15-19-39_INIT-2026-09-11-exclude-author-flag/`.
 *
 * Dispatch dirs come in two shapes and the door only knew one:
 *
 *   _architect-<ts>-<id>   _bridge-<ts>-<id>    `_`-prefixed sessions
 *   <ISO-ts>_INIT-<slug>                         cycle dirs — NO leading `_`
 *
 * `startsWith('_')` in `newestChannelSince` AND in `scanSummary` skipped every
 * cycle dir, so a press that started a REAL CYCLE could be doored `no-channel`,
 * and the scan line printed to justify it named an unrelated older session.
 * 664(ii) added that scan line so a reader could CHECK the door — which is worth
 * nothing while the scan shares the door's blind spot.
 */
test('a cycle dir counts as a dispatch — it does not start with an underscore', () => {
  const root = mkdtempSync(join(tmpdir(), 'story-cycle-scan-'));
  const logs = join(root, '_logs');
  mkdirSync(logs, { recursive: true });
  const before = Date.now() - 1000;
  mkdirSync(join(logs, '2026-09-11T15-19-39_INIT-2026-09-11-exclude-author-flag'));
  const found = newestChannelSince(logs, before);
  assert.notEqual(found, null);
  assert.ok(String(found).includes('_INIT-2026-09-11-exclude-author-flag'));
});

test('the scan line counts cycle dirs too, so it can be used to check the door', () => {
  const root = mkdtempSync(join(tmpdir(), 'story-cycle-scan2-'));
  const logs = join(root, '_logs');
  mkdirSync(logs, { recursive: true });
  mkdirSync(join(logs, '_architect-2026-09-11T15-11-38-197f1c6a'));
  mkdirSync(join(logs, '2026-09-11T15-19-39_INIT-exclude-author-flag'));
  mkdirSync(join(logs, 'not-a-dispatch'));
  // Asserted on `scanSummary` directly. Reaching it through the door would need
  // dispatch dirs OLDER than the press, and birth time cannot be backdated —
  // the test would end up asserting the fixture rather than the scan.
  const line = scanSummary(logs, Date.now());
  assert.ok(line.includes('2 dispatch dir(s)'), line);
  assert.ok(line.includes('_INIT-exclude-author-flag'), line);
});

/**
 * §15.431 — A BOUND AT EXACTLY TWICE THE CEILING MUST NOT RETIRE THE DOOR.
 *
 * Beat 8's bound was cut 20 min -> 6 min on run 11's measured 2m01s cycle. 6 min
 * is EXACTLY `2 * STALL_CEILING_MS`, and the skip test was `<=`, so the
 * tightening silently retired the door that had saved 34 minutes the run before.
 * Two correct decisions whose composition nobody measured — and run 12 spent 6
 * minutes on beat 8 where 3 would have done.
 *
 * At exactly 2x the door still saves HALF the bound, which is the whole reason
 * it exists. The skip belongs to bounds a door really would swallow.
 */
test('at exactly twice the stall ceiling the door still runs — it saves half the bound', () => {
  assert.equal(doorWorthRunning(2 * STALL_CEILING_MS, STALL_CEILING_MS), true);
});

test('below twice the ceiling the door would consume most of the bound, so it is skipped', () => {
  assert.equal(doorWorthRunning(2 * STALL_CEILING_MS - 1, STALL_CEILING_MS), false);
});

test('a bound far above the ceiling always runs the door', () => {
  assert.equal(doorWorthRunning(20 * 60_000, STALL_CEILING_MS), true);
});
