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
 * `beats-offsession-stall.test.ts`: fake pages (no real browser), a fake
 * `/proc` trend (never load-bearing, diagnostic only), and real but small
 * timers rather than a mocked clock — `CONSEQUENCE_POLL_MS` (100 ms) is a
 * real constant this file never imports, only outlives by a small, fixed
 * multiple.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { driveBeat } from './beats-drive.mjs';
import { waitForConsequence } from './beats-page.mjs';
import { runRepeatStep } from './beats-repeat.mjs';
import { makeAgentChannelDoor } from './beats-agent-proc.mjs';

const SESSION = '/sessions/architect/s1';

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
 *  until the process is gone. */
function workingProbe() {
  const p: any = () => { p.calls += 1; };
  p.calls = 0;
  p.summary = () =>
    'agent /proc over 4 sample(s): parent state=S utime 66→74, SDK child state=Z utime 45→238, ' +
    'and the process was gone by the end — it was WORKING';
  return p;
}

test('row 184 DOOR 1 (RED before the fix): a published operator gate ends the agent wait within one poll, not at the declared bound', async () => {
  // S2 beat 12's exact shape, reduced: no `do` left to run, declaring
  // `awaiting-verdict` while the product has already settled at
  // `awaiting-answers`. Before the fix this sat out the whole 780 ms
  // (scaled down from the measured 780000 ms) and reported the generic
  // "gave up at the agent wait" — naming a bound that explains nothing about
  // WHY there was nothing left to wait for.
  const page = awaitingAnswersSession();
  const probe = workingProbe();
  const beat = {
    act: 'Watch the Architect finish drafting',
    do: [],
    wait: { for: 'agent', upTo: 780 },
    expect: { route: SESSION, data: { page: 'session', 'page-ready': 'true', 'session-phase': 'awaiting-verdict' } },
    say: 'A parent lingers with a zombie child; the gate the product published is the authority, not the trend.',
  };

  const began = Date.now();
  const verdict = await driveBeat(page as never, beat as never, 1, 'http://localhost:4124', {}, undefined, probe);
  const took = Date.now() - began;

  assert.equal(verdict.status, 'red', JSON.stringify(verdict.failures));
  assert.ok(took < 500, `must end within a poll or two of the gate, not the 780 ms bound — took ${took} ms`);
  assert.ok(probe.calls === 0 || probe.calls > 0, 'the probe may or may not have been sampled before the gate ended it — either is fine, it is never load-bearing');
  const said = verdict.failures.join(' | ');
  assert.match(said, /operator gate "awaiting-answers"/, `the gate must be NAMED. Got: ${said}`);
  assert.match(said, /nothing here will answer it/, said);
});

test('row 184 DOOR 1 (positive control): a session still interviewing is never cut short by the new gate check', async () => {
  // The gate check fires on the LITERAL phase `awaiting-answers` only — a
  // session still `interviewing` (no questions asked yet) must wait exactly
  // as patiently as before.
  let asked = false;
  const page = {
    url: () => `http://localhost:4124${SESSION}`,
    goto: async () => {},
    locator: () => ({ first: () => ({}), count: async () => 0, evaluateAll: async (fn: any, arg: any) => fn([], arg) }),
    waitForURL: async () => {},
    waitForSelector: async () => {},
    evaluate: async () => {
      const phase = asked ? 'awaiting-verdict' : 'interviewing';
      return {
        data: { page: 'session', 'page-ready': 'true', 'session-phase': phase },
        nested: [], lifecycle: null, lifecycleError: null, sessionPhase: phase,
      };
    },
  };
  setTimeout(() => { asked = true; }, 150);
  const beat = {
    act: 'Watch the Architect finish drafting',
    do: [],
    wait: { for: 'agent', upTo: 3000 },
    expect: { route: SESSION, data: { page: 'session', 'page-ready': 'true', 'session-phase': 'awaiting-verdict' } },
    say: 'A healthy interview must still be waited for.',
  };
  const verdict = await driveBeat(page as never, beat as never, 1, 'http://localhost:4124');
  assert.equal(verdict.status, 'green', JSON.stringify(verdict.failures));
});

test('row 184 DOOR 1b (ZOMBIE EXTENDS, runRepeatStep): a published CRASH wins over a liveness reading that stays fresh forever', async () => {
  // T1 1973bq's own fix made this loop's bound an INACTIVITY window, reset by
  // the session's liveness once a round has been seen (`sawGate`). Before
  // THIS fix, nothing in the loop ever asked the session's own crash/stall
  // verdict, so a liveness reading that never goes stale (the zombie shape —
  // a parent lingering with trailing writes) could keep the loop open for the
  // WHOLE bound even after the product had already published a crash.
  let crashed = false;
  const page = {
    url: () => `http://localhost:4124${SESSION}`,
    locator: () => ({ count: async () => (crashed ? 0 : 1) }),
    evaluate: async () => ({
      data: {}, nested: [],
      lifecycle: crashed ? 'crashed' : 'working',
      lifecycleError: crashed ? 'SDK child exited 1' : null,
      sessionPhase: null,
    }),
  };
  // The round "succeeds" once — the act the loop was waiting to run — and the
  // session crashes immediately after, exactly as a turn dying mid-round
  // would look from this loop's own vantage point.
  const run = async () => { crashed = true; return { waitedForHandle: true, error: null }; };
  const matches = async () => false; // `until` (`awaiting-verdict`) is never met — only the crash can end this

  const began = Date.now();
  const r = await runRepeatStep({
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
  });
  const took = Date.now() - began;

  assert.notEqual(r.error, null, 'the crash must end the loop; liveness alone must never keep it open past a published stop');
  assert.match(r.error as string, /crashed/i, `Got: ${r.error}`);
  assert.ok(took < 2_000, `liveness must not override the published crash — took ${took} ms of a 20000 ms bound`);
});

test('row 184 DOOR 1 CONTROL (runRepeatStep): "awaiting-answers" is still "go answer", never "keep waiting"', async () => {
  // The gate's whole point, unregressed: once the architect's own round is
  // visible, the repeat answers it immediately — my new crash/stall check
  // never fires on a session that is merely `working`.
  const state = { phase: 'awaiting-answers', filled: [] as string[] };
  const page = {
    url: () => `http://localhost:4124${SESSION}`,
    locator: () => ({ count: async () => (state.phase === 'awaiting-answers' ? 1 : 0) }),
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

  const began = Date.now();
  const r = await runRepeatStep({
    page: page as never,
    step: { repeat: [{ fill: 'question-freetext', with: 'the answer' }], until: { 'session-phase': 'awaiting-verdict' } },
    left: () => 5_000,
    matches,
    timeoutMs: 5_000,
    run: run as never,
    sessionScope: SESSION,
  });

  assert.equal(r.error, null, `Got: ${r.error}`);
  assert.deepEqual(state.filled, ['the answer'], 'the gate means go answer — the round must actually run');
  assert.ok(Date.now() - began < 1_000);
});

// ───────────────────────── DOOR 2 — EARLY DEATH ─────────────────────────

/** An off-session page (modelling the KB Health tab) publishing `data-run`
 *  and a `drain-state` that flips from `running` to `green` at `greenAfterMs`
 *  — or never, for the control. */
function drainPage({ runId, greenAfterMs }: { runId: string; greenAfterMs: number }) {
  const startedAt = Date.now();
  const node = { getAttribute: (k: string) => (k === 'data-run' ? runId : null) };
  return {
    url: () => 'http://localhost:4124/knowledge',
    locator: () => ({
      first: () => ({ evaluate: async (fn: (n: unknown) => unknown) => fn(node) }),
      count: async () => 0,
      evaluateAll: async (fn: any, arg: any) => fn([], arg),
    }),
    evaluate: async () => ({
      data: {
        page: 'knowledge', 'page-ready': 'true',
        'drain-state': Date.now() - startedAt >= greenAfterMs ? 'green' : 'running',
      },
      nested: [], lifecycle: null, lifecycleError: null, sessionPhase: null,
    }),
  };
}

/** A dispatch dir this door will read as REAPED on its very first look: a
 *  dead pid (`999999`, this repo's own convention for "definitely not a live
 *  process" — `beats-priced-wait.test.ts`), with real event lines so it is
 *  not misread as NEVER-STARTED. */
function reapedDispatchDir(root: string, runId: string) {
  const dir = join(root, '_logs', runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'turn.pid'), '999999\n');
  writeFileSync(join(dir, 'events.jsonl'), '{"event_type":"start"}\n{"event_type":"applied"}\n');
  return dir;
}

test('row 184 DOOR 2: a dispatch reaped before the page catches up still goes GREEN, one poll later', async () => {
  // S6 beat 14's exact shape: the drain finished and was reaped inside ~1 s,
  // and at the instant this wait first looks, the PAGE still reads `running`
  // — a dispatch dir, not a page refresh, is instant. One grace poll later
  // the page has caught up to `green`, which must win over the dead process.
  const root = mkdtempSync(join(tmpdir(), 'wait-authority-'));
  const runId = '_kbdrain-1';
  reapedDispatchDir(root, runId);
  const stallDoor = makeAgentChannelDoor(root);
  assert.notEqual(stallDoor, null);

  const page = drainPage({ runId, greenAfterMs: 50 }); // inside the one free poll (CONSEQUENCE_POLL_MS = 100 ms)
  const beat = {
    act: "Open the knowledge base's Health tab and drain it to green",
    // Early death is scoped to a DECLARED agent-scale wait (PR #1058 follow-up) —
    // this models the real shape a drain beat would declare.
    wait: { for: 'settle', key: 'drain-state', while: 'running', upTo: 5_000 },
    expect: { route: '/knowledge', data: { page: 'knowledge', 'drain-state': 'green' } },
  };

  const began = Date.now();
  const stall = await waitForConsequence(page as never, beat as never, 5_000, null, null, null, stallDoor as never);
  const took = Date.now() - began;

  assert.equal(stall, null, 'process death must not end a wait on its own — the page caught up and this must be GREEN');
  assert.ok(took < 1_000, `must not sit out the 5000 ms bound either — took ${took} ms`);
});

test('row 184 DOOR 2 (RED before the fix): a dispatch that stays reaped with nothing published reds within a poll or two, not at the declared bound', async () => {
  // The mirror case: the process is gone and the page NEVER shows anything
  // but `running` — one grace poll is given, exactly once, and then this
  // reports honestly rather than sitting out the rest of the bound.
  const root = mkdtempSync(join(tmpdir(), 'wait-authority-'));
  const runId = '_kbdrain-2';
  reapedDispatchDir(root, runId);
  const stallDoor = makeAgentChannelDoor(root);

  const page = drainPage({ runId, greenAfterMs: Number.POSITIVE_INFINITY });
  const beat = {
    act: "Open the knowledge base's Health tab and drain it to green",
    // Early death is scoped to a DECLARED agent-scale wait (PR #1058 follow-up) —
    // this models the real shape a drain beat would declare.
    wait: { for: 'settle', key: 'drain-state', while: 'running', upTo: 5_000 },
    expect: { route: '/knowledge', data: { page: 'knowledge', 'drain-state': 'green' } },
  };

  const began = Date.now();
  const stall = await waitForConsequence(page as never, beat as never, 5_000, null, null, null, stallDoor as never);
  const took = Date.now() - began;

  assert.notEqual(stall, null, 'a dispatch that never publishes anything must still red, eventually');
  assert.match((stall as { why: string }).why, /REAPED/, `Got: ${JSON.stringify(stall)}`);
  assert.ok(took < 1_000, `the EARLY DEATH door must fire well before the 5000 ms bound — took ${took} ms`);
  assert.ok(took >= 90, `and not on the very first poll — one dead reading proves nothing — took ${took} ms`);
});

test('row 184 DOOR 2 (positive control): a channel that is genuinely still writing is never touched by the early-death door', async () => {
  // `classifyUnmeasuredDispatch` only reaches `reaped` on a dead pid or a
  // static log; a live, growing dispatch must sit exactly as it always has.
  const root = mkdtempSync(join(tmpdir(), 'wait-authority-'));
  const runId = '_kbdrain-3';
  const dir = join(root, '_logs', runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'turn.pid'), String(process.pid)); // this test's OWN pid — unquestionably alive
  writeFileSync(join(dir, 'events.jsonl'), '{"event_type":"start"}\n');
  const stallDoor = makeAgentChannelDoor(root);

  const page = drainPage({ runId, greenAfterMs: 150 });
  const beat = {
    act: "Open the knowledge base's Health tab and drain it to green",
    // Early death is scoped to a DECLARED agent-scale wait (PR #1058 follow-up) —
    // this models the real shape a drain beat would declare.
    wait: { for: 'settle', key: 'drain-state', while: 'running', upTo: 5_000 },
    expect: { route: '/knowledge', data: { page: 'knowledge', 'drain-state': 'green' } },
  };

  const stall = await waitForConsequence(page as never, beat as never, 5_000, null, null, null, stallDoor as never);
  assert.equal(stall, null, 'a live dispatch must reach its own green exactly as before');
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
  writeFileSync(join(dir, 'events.jsonl'), '{"event_type":"start"}\n{"event_type":"health"}\n');
  return dir;
}

/** `proof` beat 5's shape: no `data-run`, no `wait`, a press that navigates
 *  and an expectation that the resulting page answers a moment later. */
function onboardPage({ readyAfterMs }: { readyAfterMs: number }) {
  const startedAt = Date.now();
  const node = { getAttribute: () => null }; // the page names no run at all
  return {
    url: () => 'http://localhost:4124/projects/story-proof',
    locator: () => ({
      first: () => ({ evaluate: async (fn: (n: unknown) => unknown) => fn(node) }),
      count: async () => 0,
      evaluateAll: async (fn: any, arg: any) => fn([], arg),
    }),
    evaluate: async () => ({
      data: {
        page: 'projects', 'page-ready': 'true',
        'project-id': Date.now() - startedAt >= readyAfterMs ? 'story-proof' : '',
      },
      nested: [], lifecycle: null, lifecycleError: null, sessionPhase: null,
    }),
  };
}

test('row 184 follow-up (RED before this fix): a plain press/fill beat with NO declared wait is never doored by a reaped _bridge-* log — proof beat 5\'s exact shape', async () => {
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
  const stallDoor = makeAgentChannelDoor(root);
  assert.notEqual(stallDoor, null);

  // The page's own read lands well AFTER earlyDeath's two-poll decision
  // cycle (~100-200 ms) — the ordinary lag a real browser has rendering a
  // fetch response, and exactly why this fires before the page ever gets a
  // fair second look. Nothing here ever dispatched an agent; the bridge log
  // is pure coincidence, born in the same window as the press.
  const page = onboardPage({ readyAfterMs: 500 });
  const beat = {
    act: 'Fill in the name, the quality gate and the north star — and under Advanced, the repo path — then press "Onboard project →"',
    // NO `wait` field — proof.story.mjs's own beat 5, verbatim.
    expect: { route: '/projects/story-proof', data: { page: 'projects', 'project-id': 'story-proof', 'page-ready': 'true' } },
  };

  const began = Date.now();
  const stall = await waitForConsequence(page as never, beat as never, 15_000, null, null, null, stallDoor as never, anchorMs);
  const took = Date.now() - began;

  assert.equal(stall, null, `a beat with no declared wait must never be ended by the agent-channel door. Got: ${JSON.stringify(stall)}`);
  assert.ok(took >= 450, `must actually wait for the page, not pass by luck — took ${took} ms`);
  assert.ok(took < 2_000, `the page's own catch-up must win, well short of the 15000 ms bound — took ${took} ms`);
});

test('row 184 follow-up (positive control): a GENUINE agent wait is still protected from a bridge log born in the same window', async () => {
  // The gate closes the hole for a beat with no wait at all; this proves the
  // narrower bridge-exclusion ALSO holds for a beat that legitimately
  // declares one, names no run, and has nothing else in `_logs/` for the
  // scan to find except the bridge's own log.
  const root = mkdtempSync(join(tmpdir(), 'wait-authority-'));
  const anchorMs = Date.now() - 1_000; // the same fs/JS clock margin as the test above
  bridgeLogDir(root, '_bridge-2026-10-02T10-58-32-653-2wg7t63g');
  const stallDoor = makeAgentChannelDoor(root);

  const page = onboardPage({ readyAfterMs: 500 });
  const beat = {
    act: 'Watch a dispatched agent finish, off-session',
    wait: { for: 'agent', upTo: 15_000 },
    expect: { route: '/projects/story-proof', data: { page: 'projects', 'project-id': 'story-proof', 'page-ready': 'true' } },
  };

  const began = Date.now();
  const stall = await waitForConsequence(page as never, beat as never, 15_000, null, null, null, stallDoor as never, anchorMs);
  const took = Date.now() - began;

  assert.equal(stall, null, `a _bridge-* log must never stand in for this beat's own dispatch. Got: ${JSON.stringify(stall)}`);
  assert.ok(took >= 450, `took ${took} ms`);
  assert.ok(took < 2_000, `took ${took} ms`);
});

test('row 184 follow-up (control): a beat that genuinely declares `for: "agent"` still gets the early-death door for a REAL dispatch', async () => {
  // The gate must not throw the baby out with the bathwater: DOOR 2's own
  // scenario (a declared wait, a reaped dispatch that is NOT a bridge log)
  // must still be caught.
  const root = mkdtempSync(join(tmpdir(), 'wait-authority-'));
  const runId = '_kbdrain-4';
  reapedDispatchDir(root, runId);
  const stallDoor = makeAgentChannelDoor(root);

  const page = drainPage({ runId, greenAfterMs: Number.POSITIVE_INFINITY });
  const beat = {
    act: "Open the knowledge base's Health tab and drain it to green",
    wait: { for: 'agent', upTo: 5_000 },
    expect: { route: '/knowledge', data: { page: 'knowledge', 'drain-state': 'green' } },
  };

  const began = Date.now();
  const stall = await waitForConsequence(page as never, beat as never, 5_000, null, null, null, stallDoor as never);
  const took = Date.now() - began;

  assert.notEqual(stall, null, 'a genuinely reaped, non-bridge dispatch on a DECLARED wait must still red');
  assert.match((stall as { why: string }).why, /REAPED/, `Got: ${JSON.stringify(stall)}`);
  assert.ok(took < 1_000, `took ${took} ms`);
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

/** The architect session: `awaiting-verdict` until `committedAfterMs` after
 *  this page was built, then `committed` — the approve press's consequence. */
function architectApprovePage({ runId, committedAfterMs }: { runId: string; committedAfterMs: number }) {
  const startedAt = Date.now();
  const node = { getAttribute: (k: string) => (k === 'data-run' ? runId : null) };
  return {
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
      const phase = Date.now() - startedAt >= committedAfterMs ? 'committed' : 'awaiting-verdict';
      return {
        data: { page: 'session', 'page-ready': 'true', 'architect-phase': phase },
        nested: [], lifecycle: null, lifecycleError: null, sessionPhase: phase,
      };
    },
  };
}

test('row 184b (RED before the fix): approving a plan must not inherit an earlier wait\'s grace on the SAME dispatch dir', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wait-authority-'));
  const runId = '_architect-s1';
  const dir = agingTurnDir(root, runId);
  const stallDoor = makeAgentChannelDoor(root);
  assert.notEqual(stallDoor, null);

  // THE EARLIER BEAT'S OWN WAIT on the draft turn, reduced to its last two
  // polls: the SAME dead pid, sighted and graced once already — `death`'s
  // cache state exactly as S1 beat 11 found it.
  const earlierAnchor = Date.now() - 1_000;
  (stallDoor as any).earlyDeath(runId, earlierAnchor);
  (stallDoor as any).earlyDeath(runId, earlierAnchor);

  // Real wall-clock time, well past `FS_CLOCK_SLACK_MS` (250 ms), so the
  // draft turn's `turn.pid` is UNAMBIGUOUSLY born before the approve press
  // that follows — never a photo finish between birth and anchor.
  await new Promise((resolve) => setTimeout(resolve, 400));

  // The approve press — a brand-new anchor. Before the fix, `death`'s cache
  // already reads `graced: true` for this dir and fires on the very FIRST
  // poll, 0 s in, for a finalize turn that has not even started.
  const anchorMs = Date.now();
  // The bridge spawns the finalize turn 150 ms after the press — well inside
  // the declared bound, and "one free grace poll" must still apply to IT.
  setTimeout(() => {
    writeFileSync(join(dir, 'turn.pid'), String(process.pid)); // this test's own pid — unquestionably alive
    writeFileSync(join(dir, 'events.jsonl'), '{"event_type":"start"}\n{"event_type":"draft"}\n{"event_type":"finalize"}\n');
  }, 150);

  const page = architectApprovePage({ runId, committedAfterMs: 400 });
  const beat = {
    act: 'Open the session, read the plan and press Approve',
    wait: { for: 'agent', upTo: 5_000 },
    expect: { route: SESSION, data: { page: 'session', 'architect-phase': 'committed' } },
  };

  const began = Date.now();
  const stall = await waitForConsequence(page as never, beat as never, 5_000, null, null, null, stallDoor as never, anchorMs);
  const took = Date.now() - began;

  assert.equal(stall, null, `the finalize turn must be allowed to run. Got: ${JSON.stringify(stall)}`);
  assert.ok(took >= 380, `must actually wait for the page to commit, not die on a stale grace — took ${took} ms`);
});

test('row 184b (positive control): a FRESH turn born after the anchor is still judged — reaped is reaped, once it is genuinely new', async () => {
  // The fix must not swing to "nothing on this dir ever ends a wait again":
  // a finalize turn that spawns and ALSO dies, writing no new events, still
  // gets caught — after ITS OWN one free poll, never the stale zero-grace
  // and never a free pass forever.
  const root = mkdtempSync(join(tmpdir(), 'wait-authority-'));
  const runId = '_architect-s2';
  const dir = agingTurnDir(root, runId);
  const stallDoor = makeAgentChannelDoor(root);

  const earlierAnchor = Date.now() - 1_000;
  (stallDoor as any).earlyDeath(runId, earlierAnchor);
  (stallDoor as any).earlyDeath(runId, earlierAnchor);

  await new Promise((resolve) => setTimeout(resolve, 400));
  const anchorMs = Date.now();
  // The finalize turn spawns 150 ms after the press, and is ALSO already
  // dead — no new events, a second, equally gone pid.
  setTimeout(() => {
    writeFileSync(join(dir, 'turn.pid'), '999998\n');
  }, 150);

  const page = architectApprovePage({ runId, committedAfterMs: Number.POSITIVE_INFINITY });
  const beat = {
    act: 'Open the session, read the plan and press Approve',
    wait: { for: 'agent', upTo: 2_000 },
    expect: { route: SESSION, data: { page: 'session', 'architect-phase': 'committed' } },
  };

  const began = Date.now();
  const stall = await waitForConsequence(page as never, beat as never, 2_000, null, null, null, stallDoor as never, anchorMs);
  const took = Date.now() - began;

  assert.notEqual(stall, null, 'a genuinely new turn that also dies must still be caught');
  assert.match((stall as { why: string }).why, /REAPED/, `Got: ${JSON.stringify(stall)}`);
  assert.ok(took >= 240, `must wait for the NEW turn to appear, then give IT its own free poll — took ${took} ms`);
  assert.ok(took < 2_000, `took ${took} ms`);
});
