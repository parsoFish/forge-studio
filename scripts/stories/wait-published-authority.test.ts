/**
 * The session's/run's PUBLISHED state is the authority, in BOTH directions —
 * row 184 (forge-8vfn.8.5.20), measured twice in one recorded run, opposite
 * directions, same root.
 *
 * DOOR 1, ZOMBIE EXTENDS. S2 beat 12's architect wrote `awaiting-answers` 39 s
 * in — an operator gate, turn over — and the beat sat in its agent wait for
 * the FULL declared bound anyway, because nothing asked the session's own
 * phase whether there was still something to wait FOR. The runner's own
 * `/proc` trend said the agent was WORKING the whole time, right up until it
 * was reaped — a true reading of the wrong question. Pid/heartbeat liveness
 * may only EXTEND a wait while the product has published nothing conclusive;
 * it must never be read as a reason to sit past a gate the product already
 * turned over.
 *
 * DOOR 2, EARLY DEATH. S6 beat 14's drain run finished green within ~1 s and
 * was reaped just as fast — faster than the page's own next poll could render
 * it. Process death must never end a wait on its own: one dead reading proves
 * nothing, so a dispatch gets exactly one free poll before anything is
 * decided, giving the page one more chance to show what the dispatch already
 * wrote.
 *
 * Fixtures follow the house style of `beats-agent-stall.test.ts` /
 * `beats-offsession-stall.test.ts`: fake pages (no real browser) and a fake
 * `/proc` trend (never load-bearing, diagnostic only).
 *
 * ROW 200 (forge-8vfn.8.5.40, T1 1973gw/1973ha) — A WALL-CLOCK ELAPSED-MS
 * ASSERTION IS NOT A PROPERTY. This file used to run on real timers and judge
 * every door by how many milliseconds it took; under a loaded full suite row
 * 184b's positive control failed in BOTH directions (202 ms against a 240 ms
 * floor, 4.6 s against a 2 s ceiling) and passed alone. Every wait now runs on
 * a mocked `setTimeout`/`Date` (`agent-wait-liveness-run7-capture.test.ts`'s
 * `replay` shape), every page answers by POLL NUMBER rather than by elapsed
 * time, every turn.pid carries an explicit mtime on that same clock, and the
 * early-death door is wrapped to record each look it takes. The assertions
 * are the ORDER of those looks and the count of polls — never a duration.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { driveBeat } from './beats-drive.mjs';
import { waitForConsequence } from './beats-page.mjs';
import { runRepeatStep } from './beats-repeat.mjs';
import { makeAgentChannelDoor } from './beats-agent-proc.mjs';
import { CONSEQUENCE_POLL_MS } from './beats-page-read.mjs';
import { PRESS_GRACE_MS } from './beats-early-death.mjs';

const SESSION = '/sessions/architect/s1';

/** Mocked `setTimeout`/`Date`, starting at the real clock so fs-born dirs
 *  (`newestChannelSince` reads a dir's real birthtime) sit on the same side
 *  of every anchor they did before. */
function fakeClock(t: any): number {
  const t0 = Date.now();
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: t0 });
  return t0;
}

/** Advance the mocked clock in small steps until `pending` settles — every
 *  timer, the code under test's own polls and this file's fixtures alike,
 *  fires at its exact fake instant whatever the host is doing. `limitMs` only
 *  bounds a hang; it is never what a test asserts on. */
async function drive<T>(t: any, pending: Promise<T>, limitMs: number): Promise<T> {
  let done = false;
  let value: unknown;
  pending.then((v) => { done = true; value = v; }, (e) => { done = true; value = e; });
  const flush = () => new Promise((r) => setImmediate(r));
  const until = Date.now() + limitMs;
  while (!done && Date.now() < until) {
    await flush(); await flush();
    if (done) break;
    t.mock.timers.tick(10);
  }
  await flush();
  assert.ok(done, `the wait was still running ${limitMs} fake ms in — the drive limit ran out first`);
  if (value instanceof Error) throw value;
  return value as T;
}

/** Pin a file's mtime to an instant on the FAKE clock — a turn.pid's mtime is
 *  the early-death door's only birth signal (`readBirthMs`, `run-observe.mjs`). */
function bornAt(path: string, ms: number) {
  utimesSync(path, ms / 1000, ms / 1000);
}

type DoorLook = { turn: string | null; judged: boolean; stop: string | null };

/** The REAL `makeAgentChannelDoor`, with its early-death door wrapped to
 *  record every look: which turn.pid it saw, whether the press grace had
 *  already passed (`judged` — the door's own `PRESS_GRACE_MS` rule, read on
 *  the same fake clock), and what it returned. */
function recordingDoor(root: string, dir: string | null) {
  const real = makeAgentChannelDoor(root) as any;
  assert.notEqual(real, null);
  const looks: DoorLook[] = [];
  const door: any = (...args: unknown[]) => real(...args);
  door.earlyDeath = (runId: string | null, sinceMs: number, boundRunId: string | null = null, pressMs: number = sinceMs) => {
    const stop = real.earlyDeath(runId, sinceMs, boundRunId, pressMs);
    let turn: string | null = null;
    if (dir !== null) { try { turn = readFileSync(join(dir, 'turn.pid'), 'utf8').trim(); } catch { turn = null; } }
    looks.push({ turn, judged: Date.now() - pressMs >= PRESS_GRACE_MS, stop: stop?.reason ?? null });
    return stop;
  };
  return { door, looks, real };
}

// ───────────────────────── DOOR 1 — ZOMBIE EXTENDS ─────────────────────────

/** A session parked at `awaiting-answers` from the first read, forever — the
 *  do block has already finished, so nothing on this beat will ever answer
 *  it, however long the wait sits. */
function awaitingAnswersSession() {
  return {
    url: () => `http://localhost:4124${SESSION}`,
    goto: async () => {},
    locator: () => ({ first: () => ({}), count: async () => 0, evaluateAll: async (fn: any, arg: any) => fn([], arg) }),
    waitForURL: async () => {},
    waitForSelector: async () => {},
    evaluate: async () => ({
      data: { page: 'session', 'page-ready': 'true', 'session-phase': 'awaiting-answers' },
      nested: [], lifecycle: null, lifecycleError: null, sessionPhase: 'awaiting-answers',
    }),
  };
}

/** A probe whose trend says WORKING throughout — exactly the misleading
 *  reading row 184 measured: a parent lingering with a zombie child, right up
 *  until the process is gone. `waitForConsequence` samples it once at the END
 *  of every poll that did not return, so `calls` is a poll count. */
function workingProbe() {
  const p: any = () => { p.calls += 1; };
  p.calls = 0;
  p.summary = () =>
    'agent /proc over 4 sample(s): parent state=S utime 66→74, SDK child state=Z utime 45→238, ' +
    'and the process was gone by the end — it was WORKING';
  return p;
}

test('row 184 DOOR 1 (RED before the fix): a published operator gate ends the agent wait within one poll, not at the declared bound', async (t) => {
  // S2 beat 12's exact shape, reduced: no `do` left to run, declaring
  // `awaiting-verdict` while the product has already settled at
  // `awaiting-answers`. Before the fix this sat out the whole 780 ms
  // (scaled down from the measured 780000 ms) and reported the generic
  // "gave up at the agent wait" — naming a bound that explains nothing about
  // WHY there was nothing left to wait for.
  fakeClock(t);
  const page = awaitingAnswersSession();
  const probe = workingProbe();
  const beat = {
    act: 'Watch the Architect finish drafting',
    do: [],
    wait: { for: 'agent', upTo: 780 },
    expect: { route: SESSION, data: { page: 'session', 'page-ready': 'true', 'session-phase': 'awaiting-verdict' } },
    say: 'A parent lingers with a zombie child; the gate the product published is the authority, not the trend.',
  };

  const verdict: any = await drive(t, driveBeat(page as never, beat as never, 1, 'http://localhost:4124', {}, undefined, probe), 5_000);

  assert.equal(verdict.status, 'red', JSON.stringify(verdict.failures));
  // Row 200: the probe is sampled at the end of every poll that did not
  // return, so ZERO samples means the wait ended on its very first poll — the
  // one that first read the gate — and never slept toward the bound.
  assert.equal(probe.calls, 0, `the gate must end the wait on the poll that first reads it — ${probe.calls} full poll(s) went by first`);
  const said = verdict.failures.join(' | ');
  assert.match(said, /operator gate "awaiting-answers"/, `the gate must be NAMED. Got: ${said}`);
  assert.match(said, /nothing here will answer it/, said);
});

test('row 184 DOOR 1 (positive control): a session still interviewing is never cut short by the new gate check', async (t) => {
  // The gate check fires on the LITERAL phase `awaiting-answers` only — a
  // session still `interviewing` (no questions asked yet) must wait exactly
  // as patiently as before.
  fakeClock(t);
  let polls = 0;
  const page = {
    url: () => `http://localhost:4124${SESSION}`,
    goto: async () => {},
    locator: () => ({ first: () => ({}), count: async () => 0, evaluateAll: async (fn: any, arg: any) => fn([], arg) }),
    waitForURL: async () => {},
    waitForSelector: async () => {},
    evaluate: async () => {
      polls += 1;
      const phase = polls >= 3 ? 'awaiting-verdict' : 'interviewing'; // two polls of interview first
      return {
        data: { page: 'session', 'page-ready': 'true', 'session-phase': phase },
        nested: [], lifecycle: null, lifecycleError: null, sessionPhase: phase,
      };
    },
  };
  const beat = {
    act: 'Watch the Architect finish drafting',
    do: [],
    wait: { for: 'agent', upTo: 3000 },
    expect: { route: SESSION, data: { page: 'session', 'page-ready': 'true', 'session-phase': 'awaiting-verdict' } },
    say: 'A healthy interview must still be waited for.',
  };
  const verdict: any = await drive(t, driveBeat(page as never, beat as never, 1, 'http://localhost:4124'), 10_000);
  assert.equal(verdict.status, 'green', JSON.stringify(verdict.failures));
  assert.ok(polls >= 3, `both interviewing polls were sat through, not cut short — ${polls} poll(s)`);
});

test('row 184 DOOR 1b (ZOMBIE EXTENDS, runRepeatStep): a published CRASH wins over a liveness reading that stays fresh forever', async (t) => {
  // T1 1973bq's own fix made this loop's bound an INACTIVITY window, reset by
  // the session's liveness once a round has been seen (`sawGate`). Before
  // THIS fix, nothing in the loop ever asked the session's own crash/stall
  // verdict, so a liveness reading that never goes stale (the zombie shape —
  // a parent lingering with trailing writes) could keep the loop open for the
  // WHOLE bound even after the product had already published a crash.
  fakeClock(t);
  let crashed = false;
  let readsAfterCrash = 0;
  const page = {
    url: () => `http://localhost:4124${SESSION}`,
    locator: () => ({ count: async () => (crashed ? 0 : 1) }),
    evaluate: async () => {
      if (crashed) readsAfterCrash += 1;
      return {
        data: {}, nested: [],
        lifecycle: crashed ? 'crashed' : 'working',
        lifecycleError: crashed ? 'SDK child exited 1' : null,
        sessionPhase: null,
      };
    },
  };
  // The round "succeeds" once — the act the loop was waiting to run — and the
  // session crashes immediately after, exactly as a turn dying mid-round
  // would look from this loop's own vantage point.
  const run = async () => { crashed = true; return { waitedForHandle: true, error: null }; };
  const matches = async () => false; // `until` (`awaiting-verdict`) is never met — only the crash can end this

  const r: any = await drive(t, runRepeatStep({
    page: page as never,
    step: { repeat: [{ fill: 'question-freetext', with: 'the answer' }], until: { 'session-phase': 'awaiting-verdict' } },
    left: () => 20_000,
    matches,
    timeoutMs: 20_000,
    run: run as never,
    sessionScope: SESSION,
    // Liveness reads as PERPETUALLY FRESH — before this fix, exactly the
    // reading that would have reset this loop's own inactivity deadline
    // forever (T1 1973bq), holding it open for the whole 20 s bound.
    readSessionLivenessNow: () => 0,
  }), 25_000);

  assert.notEqual(r.error, null, 'the crash must end the loop; liveness alone must never keep it open past a published stop');
  assert.match(r.error as string, /crashed/i, `Got: ${r.error}`);
  // Row 200: the FIRST read of the session after the crash is the one that
  // ends the loop — liveness never buys it a second look.
  assert.equal(readsAfterCrash, 1, `liveness must not override the published crash — ${readsAfterCrash} read(s) after it`);
});

test('row 184 DOOR 1 CONTROL (runRepeatStep): "awaiting-answers" is still "go answer", never "keep waiting"', async (t) => {
  // The gate's whole point, unregressed: once the architect's own round is
  // visible, the repeat answers it immediately — my new crash/stall check
  // never fires on a session that is merely `working`.
  fakeClock(t);
  const state = { phase: 'awaiting-answers', filled: [] as string[], gateReadsBeforeAnswer: 0 };
  const page = {
    url: () => `http://localhost:4124${SESSION}`,
    locator: () => ({
      count: async () => {
        if (state.filled.length === 0) state.gateReadsBeforeAnswer += 1;
        return state.phase === 'awaiting-answers' ? 1 : 0;
      },
    }),
    evaluate: async () => ({
      data: {}, nested: [], lifecycle: 'working', lifecycleError: null, sessionPhase: state.phase,
    }),
  };
  const matches = async (spec: Record<string, string>) =>
    Object.entries(spec).every(([k, v]) => (k === 'session-phase' ? state.phase === v : false));
  const run = async (steps: any[]) => {
    state.filled.push(steps[0].with);
    state.phase = 'awaiting-verdict'; // one round answers it
    return { waitedForHandle: true, error: null };
  };

  const r: any = await drive(t, runRepeatStep({
    page: page as never,
    step: { repeat: [{ fill: 'question-freetext', with: 'the answer' }], until: { 'session-phase': 'awaiting-verdict' } },
    left: () => 5_000,
    matches,
    timeoutMs: 5_000,
    run: run as never,
    sessionScope: SESSION,
  }), 10_000);

  assert.equal(r.error, null, `Got: ${r.error}`);
  assert.deepEqual(state.filled, ['the answer'], 'the gate means go answer — the round must actually run');
  // Row 200: answered on the FIRST sighting of the gate, never after a poll.
  assert.equal(state.gateReadsBeforeAnswer, 1, 'the gate must be answered on the read that first sees it');
});

// ───────────────────────── DOOR 2 — EARLY DEATH ─────────────────────────

/** An off-session page (modelling the KB Health tab) publishing `data-run`
 *  and a `drain-state` that reads `green` once `greenWhen(poll)` holds — the
 *  poll number, never the elapsed time. */
function drainPage({ runId, greenWhen }: { runId: string; greenWhen: (poll: number) => boolean }) {
  const node = { getAttribute: (k: string) => (k === 'data-run' ? runId : null) };
  const page = {
    polls: 0,
    url: () => 'http://localhost:4124/knowledge',
    locator: () => ({
      first: () => ({ evaluate: async (fn: (n: unknown) => unknown) => fn(node) }),
      count: async () => 0,
      evaluateAll: async (fn: any, arg: any) => fn([], arg),
    }),
    evaluate: async () => {
      page.polls += 1;
      return {
        data: { page: 'knowledge', 'page-ready': 'true', 'drain-state': greenWhen(page.polls) ? 'green' : 'running' },
        nested: [], lifecycle: null, lifecycleError: null, sessionPhase: null,
      };
    },
  };
  return page;
}

/** A dispatch dir this door will read as REAPED on its very first look: a
 *  dead pid (`999999`, this repo's own convention for "definitely not a live
 *  process" — `beats-priced-wait.test.ts`), with real event lines so it is
 *  not misread as NEVER-STARTED. Born NOW on the fake clock — the instant the
 *  wait that watches it starts, never a photo finish with its anchor. */
function reapedDispatchDir(root: string, runId: string) {
  const dir = join(root, '_logs', runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'turn.pid'), '999999\n');
  bornAt(join(dir, 'turn.pid'), Date.now());
  writeFileSync(join(dir, 'events.jsonl'), '{"event_type":"start"}\n{"event_type":"applied"}\n');
  return dir;
}

const judgedOf = (looks: DoorLook[]) => looks.filter((l) => l.judged).map((l) => l.stop);

test('row 184 DOOR 2: a dispatch reaped before the page catches up still goes GREEN, one poll later', async (t) => {
  // S6 beat 14's exact shape: the drain finished and was reaped inside ~1 s,
  // and at the instant this wait first looks, the PAGE still reads `running`
  // — a dispatch dir, not a page refresh, is instant. One grace poll later
  // the page has caught up to `green`, which must win over the dead process.
  fakeClock(t);
  const root = mkdtempSync(join(tmpdir(), 'wait-authority-'));
  const runId = '_kbdrain-1';
  const dir = reapedDispatchDir(root, runId);
  const { door, looks } = recordingDoor(root, dir);

  // Green on the poll AFTER the door's first judged look at the dead turn —
  // exactly the read its one free poll exists to give the page.
  const page = drainPage({ runId, greenWhen: () => looks.some((l) => l.judged) });
  const beat = {
    act: "Open the knowledge base's Health tab and drain it to green",
    // Early death is scoped to a DECLARED agent-scale wait (PR #1058 follow-up) —
    // this models the real shape a drain beat would declare.
    wait: { for: 'settle', key: 'drain-state', while: 'running', upTo: 5_000 },
    expect: { route: '/knowledge', data: { page: 'knowledge', 'drain-state': 'green' } },
  };

  const stall = await drive(t, waitForConsequence(page as never, beat as never, 5_000, null, null, null, door), 10_000);

  assert.equal(stall, null, 'process death must not end a wait on its own — the page caught up and this must be GREEN');
  assert.deepEqual(judgedOf(looks), [null], 'the door judged the dead turn exactly once — its free poll — and the page answered on the next');
});

test('row 184 DOOR 2 (RED before the fix): a dispatch that stays reaped with nothing published reds within a poll or two, not at the declared bound', async (t) => {
  // The mirror case: the process is gone and the page NEVER shows anything
  // but `running` — one grace poll is given, exactly once, and then this
  // reports honestly rather than sitting out the rest of the bound.
  fakeClock(t);
  const root = mkdtempSync(join(tmpdir(), 'wait-authority-'));
  const runId = '_kbdrain-2';
  const dir = reapedDispatchDir(root, runId);
  const { door, looks } = recordingDoor(root, dir);

  const page = drainPage({ runId, greenWhen: () => false });
  const beat = {
    act: "Open the knowledge base's Health tab and drain it to green",
    // Early death is scoped to a DECLARED agent-scale wait (PR #1058 follow-up) —
    // this models the real shape a drain beat would declare.
    wait: { for: 'settle', key: 'drain-state', while: 'running', upTo: 5_000 },
    expect: { route: '/knowledge', data: { page: 'knowledge', 'drain-state': 'green' } },
  };

  const stall = await drive(t, waitForConsequence(page as never, beat as never, 5_000, null, null, null, door), 10_000);

  assert.notEqual(stall, null, 'a dispatch that never publishes anything must still red, eventually');
  assert.match((stall as { why: string }).why, /REAPED/, `Got: ${JSON.stringify(stall)}`);
  // Row 200 — the ORDER, not a duration: the first judged look is the free
  // poll (one dead reading proves nothing), the second fires, and nothing
  // after it — the EARLY DEATH door, not the 5000 ms bound, ended this.
  assert.deepEqual(judgedOf(looks), [null, 'channel-quiet'], JSON.stringify(looks));
  assert.ok(page.polls < 5_000 / CONSEQUENCE_POLL_MS, `ended on poll ${page.polls}, well short of the bound`);
});

test('row 184 DOOR 2 (positive control): a channel that is genuinely still writing is never touched by the early-death door', async (t) => {
  // `classifyUnmeasuredDispatch` only reaches `reaped` on a dead pid or a
  // static log; a live, growing dispatch must sit exactly as it always has.
  fakeClock(t);
  const root = mkdtempSync(join(tmpdir(), 'wait-authority-'));
  const runId = '_kbdrain-3';
  const dir = join(root, '_logs', runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'turn.pid'), String(process.pid)); // this test's OWN pid — unquestionably alive
  bornAt(join(dir, 'turn.pid'), Date.now());
  writeFileSync(join(dir, 'events.jsonl'), '{"event_type":"start"}\n');
  const { door, looks } = recordingDoor(root, dir);

  const page = drainPage({ runId, greenWhen: (poll) => poll >= 6 }); // past the press grace AND two judged looks
  const beat = {
    act: "Open the knowledge base's Health tab and drain it to green",
    // Early death is scoped to a DECLARED agent-scale wait (PR #1058 follow-up) —
    // this models the real shape a drain beat would declare.
    wait: { for: 'settle', key: 'drain-state', while: 'running', upTo: 5_000 },
    expect: { route: '/knowledge', data: { page: 'knowledge', 'drain-state': 'green' } },
  };

  const stall = await drive(t, waitForConsequence(page as never, beat as never, 5_000, null, null, null, door), 10_000);
  assert.equal(stall, null, 'a live dispatch must reach its own green exactly as before');
  assert.equal(page.polls, 6, 'it waited for the page, not for the door');
  assert.ok(judgedOf(looks).length >= 2 && judgedOf(looks).every((s) => s === null), JSON.stringify(looks));
});

// ──────────── PR #1058 FOLLOW-UP — EARLY DEATH IS SCOPED TO AN AGENT WAIT ────────────

/**
 * CI's own costless `stories` job reded `proof` beat 5 ("Fill in the name,
 * the quality gate and the north star … then press 'Onboard project →'") —
 * a plain press/fill beat (`tests/stories/proof.story.mjs`) that declares NO
 * `wait` field at all. `waitForConsequence`'s ungated `earlyDeath` check had
 * no way to tell that apart from a genuine agent wait, scanned `_logs/` for
 * the newest dispatch born since the press, found the Studio bridge's own
 * `_bridge-<ts>-<id>` log, read it as REAPED, and ended the wait before the
 * page's own `project-id` read ever got a second poll. On main the same beat
 * is green.
 */
function bridgeLogDir(root: string, runId: string) {
  const dir = join(root, '_logs', runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'turn.pid'), '999999\n'); // dead — the bridge's own pid bookkeeping differs, but REAPED either way
  bornAt(join(dir, 'turn.pid'), Date.now());
  writeFileSync(join(dir, 'events.jsonl'), '{"event_type":"start"}\n{"event_type":"health"}\n');
  return dir;
}

/** `proof` beat 5's shape: no `data-run`, no `wait`, a press that navigates
 *  and an expectation that the resulting page answers on `readyOnPoll`. */
function onboardPage({ readyOnPoll }: { readyOnPoll: number }) {
  const node = { getAttribute: () => null }; // the page names no run at all
  const page = {
    polls: 0,
    url: () => 'http://localhost:4124/projects/story-proof',
    locator: () => ({
      first: () => ({ evaluate: async (fn: (n: unknown) => unknown) => fn(node) }),
      count: async () => 0,
      evaluateAll: async (fn: any, arg: any) => fn([], arg),
    }),
    evaluate: async () => {
      page.polls += 1;
      return {
        data: { page: 'projects', 'page-ready': 'true', 'project-id': page.polls >= readyOnPoll ? 'story-proof' : '' },
        nested: [], lifecycle: null, lifecycleError: null, sessionPhase: null,
      };
    },
  };
  return page;
}

// The page's own read lands well AFTER earlyDeath's decision cycle — the
// press grace (`PRESS_GRACE_MS`, two polls), then a free poll, then a firing
// one — the ordinary lag a real browser has rendering a fetch response, and
// exactly why the door would fire before the page ever got a fair look.
const ONBOARD_READY_POLL = PRESS_GRACE_MS / CONSEQUENCE_POLL_MS + 4;

test('row 184 follow-up (RED before this fix): a plain press/fill beat with NO declared wait is never doored by a reaped _bridge-* log — proof beat 5\'s exact shape', async (t) => {
  fakeClock(t);
  const root = mkdtempSync(join(tmpdir(), 'wait-authority-'));
  // The anchor sits a full second BEFORE the bridge log is born — the same
  // margin `beats-offsession-stall.test.ts`'s own fixtures use (`626`'s "a
  // dispatch is allowed to take a moment to create its directory"), and
  // needed here for the identical reason: the filesystem's clock and
  // `Date.now()` can disagree by a few ms (`FS_CLOCK_SLACK_MS`,
  // `beats-queue-terminal.mjs`), so an anchor taken an instant before
  // `mkdirSync` can register as born AFTER it. Without the margin this
  // fixture would exercise nothing: `newestChannelSince` finds nothing,
  // `earlyDeath` reports nothing, and the test would pass whether or not the
  // bridge-exclusion exists.
  const anchorMs = Date.now() - 1_000;
  bridgeLogDir(root, '_bridge-2026-10-02T10-58-32-653-2wg7t63g');
  const { door, looks } = recordingDoor(root, null);

  // Nothing here ever dispatched an agent; the bridge log is pure
  // coincidence, born in the same window as the press.
  const page = onboardPage({ readyOnPoll: ONBOARD_READY_POLL });
  const beat = {
    act: 'Fill in the name, the quality gate and the north star — and under Advanced, the repo path — then press "Onboard project →"',
    // NO `wait` field — proof.story.mjs's own beat 5, verbatim.
    expect: { route: '/projects/story-proof', data: { page: 'projects', 'project-id': 'story-proof', 'page-ready': 'true' } },
  };

  const stall = await drive(t, waitForConsequence(page as never, beat as never, 15_000, null, null, null, door, anchorMs), 20_000);

  assert.equal(stall, null, `a beat with no declared wait must never be ended by the agent-channel door. Got: ${JSON.stringify(stall)}`);
  assert.equal(page.polls, ONBOARD_READY_POLL, 'must actually wait for the page, and end on the poll it answers');
  assert.equal(looks.length, 0, 'a beat with no declared wait never consults the early-death door at all');
});

test('row 184 follow-up (positive control): a GENUINE agent wait is still protected from a bridge log born in the same window', async (t) => {
  // The gate closes the hole for a beat with no wait at all; this proves the
  // narrower bridge-exclusion ALSO holds for a beat that legitimately
  // declares one, names no run, and has nothing else in `_logs/` for the
  // scan to find except the bridge's own log.
  fakeClock(t);
  const root = mkdtempSync(join(tmpdir(), 'wait-authority-'));
  const anchorMs = Date.now() - 1_000; // the same fs/JS clock margin as the test above
  bridgeLogDir(root, '_bridge-2026-10-02T10-58-32-653-2wg7t63g');
  const { door, looks } = recordingDoor(root, null);

  const page = onboardPage({ readyOnPoll: ONBOARD_READY_POLL });
  const beat = {
    act: 'Watch a dispatched agent finish, off-session',
    wait: { for: 'agent', upTo: 15_000 },
    expect: { route: '/projects/story-proof', data: { page: 'projects', 'project-id': 'story-proof', 'page-ready': 'true' } },
  };

  const stall = await drive(t, waitForConsequence(page as never, beat as never, 15_000, null, null, null, door, anchorMs), 20_000);

  assert.equal(stall, null, `a _bridge-* log must never stand in for this beat's own dispatch. Got: ${JSON.stringify(stall)}`);
  assert.equal(page.polls, ONBOARD_READY_POLL, 'must actually wait for the page, and end on the poll it answers');
  assert.ok(judgedOf(looks).length >= 2, `the door WAS consulted past its press grace — ${JSON.stringify(looks)}`);
  assert.ok(looks.every((l) => l.stop === null), `and never fired on the bridge log: ${JSON.stringify(looks)}`);
});

test('row 184 follow-up (control): a beat that genuinely declares `for: "agent"` still gets the early-death door for a REAL dispatch', async (t) => {
  // The gate must not throw the baby out with the bathwater: DOOR 2's own
  // scenario (a declared wait, a reaped dispatch that is NOT a bridge log)
  // must still be caught.
  fakeClock(t);
  const root = mkdtempSync(join(tmpdir(), 'wait-authority-'));
  const runId = '_kbdrain-4';
  const dir = reapedDispatchDir(root, runId);
  const { door, looks } = recordingDoor(root, dir);

  const page = drainPage({ runId, greenWhen: () => false });
  const beat = {
    act: "Open the knowledge base's Health tab and drain it to green",
    wait: { for: 'agent', upTo: 5_000 },
    expect: { route: '/knowledge', data: { page: 'knowledge', 'drain-state': 'green' } },
  };

  const stall = await drive(t, waitForConsequence(page as never, beat as never, 5_000, null, null, null, door), 10_000);

  assert.notEqual(stall, null, 'a genuinely reaped, non-bridge dispatch on a DECLARED wait must still red');
  assert.match((stall as { why: string }).why, /REAPED/, `Got: ${JSON.stringify(stall)}`);
  assert.deepEqual(judgedOf(looks), [null, 'channel-quiet'], 'its free poll, then the door — never the bound');
});

// ──────── ROW 184b (forge-8vfn.8.5.21, regression from #1058) — EARLY DEATH
// JUDGES ONLY A TURN BORN AT OR AFTER THIS WAIT'S OWN ANCHOR ────────

/**
 * S1 beat 11's exact shape ("Open the session, read the plan and press
 * Approve"), green in three earlier recorded runs, red right after #1058:
 * pressing approve-plan makes the bridge spawn a NEW finalize turn for the
 * SAME session dir the draft turn already used, and until it does, the
 * session's `turn.pid` still names the PREVIOUS (draft) turn — already dead.
 *
 * `stallDoor` is built ONCE per STORY and shared across every beat
 * (`run-story.mjs`), so an EARLIER beat's own wait on the draft turn can
 * leave `death`'s cache for this exact dir already `graced: true` by the
 * time THIS beat's press takes its own, brand-new anchor. Before the fix
 * that stale grace fired on the very first poll — 0 s in — for a finalize
 * turn that had not even started yet.
 */
function agingTurnDir(root: string, runId: string) {
  const dir = join(root, '_logs', runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'turn.pid'), '999999\n'); // the draft turn, already dead
  writeFileSync(join(dir, 'events.jsonl'), '{"event_type":"start"}\n{"event_type":"draft"}\n');
  return dir;
}

/** The finalize turn appears on this poll — AFTER the press grace has let
 *  the door judge the OLD turn twice, so the birth rule (not the grace) is
 *  what has to keep it shut until then. */
const FINALIZE_SPAWN_POLL = PRESS_GRACE_MS / CONSEQUENCE_POLL_MS + 3;

/** The architect session: `awaiting-verdict` until `committedOnPoll`, then
 *  `committed` — the approve press's consequence. `onPoll` runs at the top of
 *  each read, i.e. BEFORE that same poll's early-death look. */
function architectApprovePage({ runId, committedOnPoll, onPoll }: { runId: string; committedOnPoll: number; onPoll: (poll: number) => void }) {
  const node = { getAttribute: (k: string) => (k === 'data-run' ? runId : null) };
  const page = {
    polls: 0,
    url: () => `http://localhost:4124${SESSION}`,
    goto: async () => {},
    locator: () => ({
      first: () => ({ evaluate: async (fn: (n: unknown) => unknown) => fn(node) }),
      count: async () => 0,
      evaluateAll: async (fn: any, arg: any) => fn([], arg),
    }),
    waitForURL: async () => {},
    waitForSelector: async () => {},
    evaluate: async () => {
      page.polls += 1;
      onPoll(page.polls);
      const phase = page.polls >= committedOnPoll ? 'committed' : 'awaiting-verdict';
      return {
        data: { page: 'session', 'page-ready': 'true', 'architect-phase': phase },
        nested: [], lifecycle: null, lifecycleError: null, sessionPhase: phase,
      };
    },
  };
  return page;
}

/** THE EARLIER BEAT'S OWN WAIT on the draft turn, reduced to its last two
 *  looks: the SAME dead pid, sighted and graced once already — `death`'s
 *  cache state exactly as S1 beat 11 found it. Then the approve press, a
 *  full second later on the fake clock — well past `FS_CLOCK_SLACK_MS`
 *  (250 ms), so the draft turn's `turn.pid` is UNAMBIGUOUSLY born before it,
 *  never a photo finish between birth and anchor. Returns the press. */
function earlierWaitGraced(t: any, real: any, dir: string, runId: string): number {
  const earlierAnchor = Date.now() - 1_000;
  bornAt(join(dir, 'turn.pid'), earlierAnchor);
  real.earlyDeath(runId, earlierAnchor);
  real.earlyDeath(runId, earlierAnchor);
  t.mock.timers.tick(1_000);
  return Date.now();
}

/** Spawn the finalize turn into the SAME dir, born now on the fake clock. */
function spawnFinalize(dir: string, pid: string, events?: string) {
  writeFileSync(join(dir, 'turn.pid'), `${pid}\n`);
  bornAt(join(dir, 'turn.pid'), Date.now());
  if (events !== undefined) writeFileSync(join(dir, 'events.jsonl'), events);
}

test('row 184b (RED before the fix): approving a plan must not inherit an earlier wait\'s grace on the SAME dispatch dir', async (t) => {
  fakeClock(t);
  const root = mkdtempSync(join(tmpdir(), 'wait-authority-'));
  const runId = '_architect-s1';
  const dir = agingTurnDir(root, runId);
  const { door, looks, real } = recordingDoor(root, dir);
  // Before the fix, `death`'s cache already reads `graced: true` for this dir
  // and fires on the very FIRST judged look, for a finalize turn that has
  // not even started.
  const anchorMs = earlierWaitGraced(t, real, dir, runId);

  // The finalize turn is alive (this test's own pid) and writes, and the
  // page commits two polls after it appears.
  const page = architectApprovePage({
    runId,
    committedOnPoll: FINALIZE_SPAWN_POLL + 2,
    onPoll: (poll) => {
      if (poll === FINALIZE_SPAWN_POLL) {
        spawnFinalize(dir, String(process.pid), '{"event_type":"start"}\n{"event_type":"draft"}\n{"event_type":"finalize"}\n');
      }
    },
  });
  const beat = {
    act: 'Open the session, read the plan and press Approve',
    wait: { for: 'agent', upTo: 5_000 },
    expect: { route: SESSION, data: { page: 'session', 'architect-phase': 'committed' } },
  };

  const stall = await drive(t, waitForConsequence(page as never, beat as never, 5_000, null, null, null, door, anchorMs), 10_000);

  assert.equal(stall, null, `the finalize turn must be allowed to run. Got: ${JSON.stringify(stall)}`);
  assert.equal(page.polls, FINALIZE_SPAWN_POLL + 2, 'must actually wait for the page to commit, not die on a stale grace');
  const oldJudged = looks.filter((l) => l.judged && l.turn === '999999');
  assert.ok(oldJudged.length >= 1, `the stale draft turn WAS judged past the press grace — ${JSON.stringify(looks)}`);
  assert.ok(looks.every((l) => l.stop === null), `and nothing ever fired: ${JSON.stringify(looks)}`);
});

test('row 184b (positive control): a FRESH turn born after the anchor is still judged — reaped is reaped, once it is genuinely new', async (t) => {
  // The fix must not swing to "nothing on this dir ever ends a wait again":
  // a finalize turn that spawns and ALSO dies, writing no new events, still
  // gets caught — after ITS OWN one free poll, never the stale zero-grace
  // and never a free pass forever.
  //
  // Row 200 (forge-8vfn.8.5.40): this test measured both directions under
  // load on real timers ("took 202 ms" against its 240 ms floor; 4.6 s
  // against its 2 s ceiling). It now asserts the ORDER of the door's looks:
  // null while only the old turn exists, null on the new turn's first
  // sighting (its free poll), and a firing look on the poll after that.
  fakeClock(t);
  const root = mkdtempSync(join(tmpdir(), 'wait-authority-'));
  const runId = '_architect-s2';
  const dir = agingTurnDir(root, runId);
  const { door, looks, real } = recordingDoor(root, dir);
  const anchorMs = earlierWaitGraced(t, real, dir, runId);

  // The finalize turn spawns and is ALSO already dead — no new events, a
  // second, equally gone pid.
  const page = architectApprovePage({
    runId,
    committedOnPoll: Number.POSITIVE_INFINITY,
    onPoll: (poll) => { if (poll === FINALIZE_SPAWN_POLL) spawnFinalize(dir, '999998'); },
  });
  const beat = {
    act: 'Open the session, read the plan and press Approve',
    wait: { for: 'agent', upTo: 2_000 },
    expect: { route: SESSION, data: { page: 'session', 'architect-phase': 'committed' } },
  };

  const stall = await drive(t, waitForConsequence(page as never, beat as never, 2_000, null, null, null, door, anchorMs), 5_000);

  assert.notEqual(stall, null, 'a genuinely new turn that also dies must still be caught');
  assert.match((stall as { why: string }).why, /REAPED/, `Got: ${JSON.stringify(stall)}`);
  const judged = looks.filter((l) => l.judged);
  const old = judged.filter((l) => l.turn === '999999');
  const fresh = judged.filter((l) => l.turn === '999998');
  assert.ok(old.length >= 1 && old.every((l) => l.stop === null),
    `the door returns null while only the OLD turn exists, past its press grace — ${JSON.stringify(looks)}`);
  assert.deepEqual(fresh.map((l) => l.stop), [null, 'channel-quiet'],
    `the NEW turn's first sighting is its free poll, and only the poll after that fires — ${JSON.stringify(looks)}`);
  assert.equal(judged.indexOf(fresh[0]), old.length, 'every old-turn look precedes the new turn\'s first');
  assert.equal(looks[looks.length - 1], fresh[1], 'the firing look is the last one — the door, not the bound, ended this');
});
