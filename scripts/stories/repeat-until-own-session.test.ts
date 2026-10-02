/**
 * repeat-until-own-session.test.ts — row 194 (bead `forge-8vfn.8.5.32`), T1
 * ruling 1973ga: a repeat's `until` is judged ONLY on the session the beat is
 * about, never on the page the `do` block is leaving.
 *
 * MEASURED — S2 run 6 (`m7-e-run6-captures/run6.log`, beats 11–13 per case).
 * `12[api]` answered three rounds and went green; `12[cli]` and `12[webapp]`
 * went red 46 s / 68 s in with the CONSEQUENCE wait's operator-gate stop
 * (`beats-page.mjs`, row 184) and ZERO rounds answered — not one
 * `while waiting on [data-action="submit-answers"]` line for either. The two
 * reds landed 210 ms / 221 ms after each session's own `status.json` flipped
 * to `awaiting-answers` (MTIMES: 21:16:07.711 → red 21:16:07.921;
 * 21:17:34.078 → red 21:17:34.299), so the 46 s / 68 s were the WHOLE beat
 * spent in `waitForConsequence` — the repeat itself took ~0 s.
 *
 * WHY ~0 s. The beat presses `open-session` on `/monitor` and the repeat's
 * first act is to ask `until` (`session-phase: awaiting-verdict`). During the
 * client-side commit window both `page.url()` and the DOM still answer for
 * MONITOR (§2.28's class), and Monitor renders one `data-session-phase` card
 * PER SESSION. `resolveExpectations`' together-rule returns the first card
 * that answers exactly — and the api case's session, run earlier on the same
 * host, sat at `awaiting-verdict`. The repeat was "satisfied" by a NEIGHBOUR's
 * card, returned green, and the consequence wait then met this session's own
 * `awaiting-answers` with nothing left to answer it. `12[api]` ran first, so
 * no neighbour was at `awaiting-verdict` yet: that is the whole asymmetry.
 *
 * NOT `stopNow` (the row-194 brief's first reading): `stopReasonFor` returns
 * crashed / terminal-failure / stalled only — `awaiting-answers` is in none of
 * them — and a repeat-side stop would have printed the repeat's own
 * "— the repeat stops" wording, which neither red carries. Doors 3 and 4 pin
 * that the repeat still loops through `awaiting-answers` and still stops on a
 * terminal phase, so the brief's concern stays covered either way.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { driveBeat } from './beats-drive.mjs';
import { runRepeatStep } from './beats-repeat.mjs';
import { validateStory } from './story-file.mjs';
import S1 from '../../tests/stories/S1.story.mjs';
import S2 from '../../tests/stories/S2.story.mjs';
import S4 from '../../tests/stories/S4.story.mjs';
import S9 from '../../tests/stories/S9.story.mjs';
import S10 from '../../tests/stories/S10.story.mjs';

const OWN = '2026-10-02T21-15-21-6272d299';        // 12[cli]'s own session (run 6)
const NEIGHBOUR = '2026-10-02T21-03-08-40b8f299';  // 12[api]'s, at awaiting-verdict by then
const GATE = { field: '[data-field="question-freetext"]', submit: '[data-action="submit-answers"]' };

/** S2's REAL beat 12, validated, its 780 000 ms wait scaled to run in ms. */
function realBeat12() {
  const story = S2 as unknown as { beats: Record<string, unknown>[] };
  const isIt = (b: Record<string, unknown>) => /answer the Architect's questions/.test(String(b['act']));
  assert.equal(story.beats.filter(isIt).length, 1, 'fixture check: S2 must still carry exactly one answer-the-Architect beat');
  // Validated IN PLACE: its route's `<architectSessionId>` is bound by beat 10.
  const v = validateStory({ ...story, beats: story.beats.map((b) => (isIt(b) ? { ...b, wait: { for: 'agent', upTo: 4_000 } } : b)) }) as {
    beats: Record<string, unknown>[];
  };
  return v.beats.find(isIt)!;
}

/**
 * Run 6's 12[cli] timeline, reduced: standing on Monitor with the neighbour's
 * card at `awaiting-verdict`; `open-session` commits after a window in which
 * Monitor still answers; the architect then asks (gate present,
 * `awaiting-answers`) and drafts once a round is submitted.
 */
function run6CliPage({ asks = true, neighbourPhase = 'awaiting-verdict' } = {}) {
  const s = { route: '/monitor', phase: 'interviewing', gate: false, fills: 0, submits: 0 };
  const onSession = () => s.route !== '/monitor';
  const count = (sel: string): number => {
    if (sel.includes('open-session')) return onSession() ? 0 : 1;
    if (sel.startsWith(GATE.field) || sel.startsWith(GATE.submit)) return onSession() && s.gate ? 1 : 0;
    return 0;
  };
  const click = async (sel: string) => {
    if (sel.includes('open-session')) {
      setTimeout(() => { s.route = `/sessions/architect/${OWN}`; }, 150);       // the commit window
      setTimeout(() => {
        if (asks) { s.phase = 'awaiting-answers'; s.gate = true; } else s.phase = 'awaiting-verdict';
      }, 400);                                                                   // the architect asks — or drafts
    } else if (sel.startsWith(GATE.submit)) {
      s.submits += 1;
      s.gate = false;
      s.phase = 'awaiting-verdict';
    }
  };
  const locator = (sel: string): any => ({
    count: async () => count(sel),
    first: () => locator(sel), nth: () => locator(sel), locator: (inner: string) => locator(`${sel} ${inner}`),
    click: async () => click(sel),
    fill: async () => { s.fills += 1; },
    waitFor: async () => {},
    evaluate: async () => 'present and enabled',
    evaluateAll: async (fn: any, a: any) => fn([], a),
  });
  const pick = (rec: Record<string, string>, wanted: string[]) =>
    Object.fromEntries(Object.entries(rec).filter(([k]) => wanted.includes(k)));
  return {
    state: s,
    locator,
    url: () => `http://localhost:4124${s.route}`,
    goto: async () => {},
    // Playwright's own contract: resolve once the predicate holds, throw at the bound.
    waitForURL: async (ok: (u: URL) => boolean, { timeout }: { timeout: number }) => {
      for (const until = Date.now() + timeout; Date.now() < until; await new Promise((r) => setTimeout(r, 10))) {
        if (ok(new URL(`http://localhost:4124${s.route}`))) return;
      }
      throw new Error('waitForURL timed out');
    },
    waitForSelector: async () => {},
    evaluate: async (_fn: unknown, { wanted }: { wanted: string[] }) => {
      if (!onSession()) {
        // Monitor: the page root carries no phase; every session card does.
        return {
          data: pick({ page: 'monitor', 'page-ready': 'true' }, wanted),
          nested: [
            pick({ 'session-kind': 'architect', 'session-id': NEIGHBOUR, 'session-phase': neighbourPhase }, wanted),
            pick({ 'session-kind': 'architect', 'session-id': OWN, 'session-phase': 'interviewing' }, wanted),
          ],
          lifecycle: null, lifecycleError: null, sessionPhase: null,
        };
      }
      return {
        data: pick({ page: 'session', 'page-ready': 'true', 'session-kind': 'architect', 'session-phase': s.phase }, wanted),
        nested: [], lifecycle: null, lifecycleError: null, sessionPhase: s.phase,
      };
    },
  };
}

test('row 194 DOOR 1 (RED before the fix): run 6\'s 12[cli] — a neighbour\'s Monitor card never satisfies this repeat\'s `until`', async () => {
  const page = run6CliPage();
  const v = await driveBeat(page as never, realBeat12() as never, 1, 'http://localhost:4124',
    { architectSessionId: OWN }) as { status: string; failures: string[] };
  const said = v.failures.join(' | ');

  // Before the fix: the repeat returned on its first read (Monitor, neighbour
  // at awaiting-verdict), no round was answered, and the consequence wait
  // reded on this session's own `awaiting-answers` — run 6's verbatim red.
  assert.doesNotMatch(said, /operator gate "awaiting-answers"/, `run 6's red, reproduced: ${said}`);
  assert.equal(page.state.submits, 1, `the repeat must answer the round it was written to answer: ${said}`);
  assert.ok(page.state.fills >= 1, 'and fill its question first');
  assert.equal(v.status, 'green', said);
});

test('row 194 DOOR 1b (control): run 6\'s 12[api] — no neighbour at `awaiting-verdict`, and the same beat answers', async () => {
  // The asymmetry, reproduced: 12[api] ran FIRST, so no other card on Monitor
  // could answer `until`. Green before the fix as well as after it.
  const page = run6CliPage({ neighbourPhase: 'interviewing' });
  const v = await driveBeat(page as never, realBeat12() as never, 1, 'http://localhost:4124',
    { architectSessionId: OWN }) as { status: string; failures: string[] };
  assert.equal(v.status, 'green', v.failures.join(' | '));
  assert.equal(page.state.submits, 1);
});

test('row 194 DOOR 2 (positive control): `until` met on the beat\'s OWN session still ends the repeat with no round', async () => {
  // A session that drafts without asking is legitimate (S2's beat-12 comment:
  // "S2 may well draft on round one"). Scoping must not turn that into a red.
  const page = run6CliPage({ asks: false });
  const v = await driveBeat(page as never, realBeat12() as never, 1, 'http://localhost:4124',
    { architectSessionId: OWN }) as { status: string; failures: string[] };
  assert.equal(v.status, 'green', v.failures.join(' | '));
  assert.equal(page.state.submits, 0, 'no round existed, so none may be pressed');
});

const ROUND = { repeat: [{ fillAll: 'question-freetext', with: 'x' }, { press: 'submit-answers' }], until: { 'session-phase': 'awaiting-verdict' } };
const SCOPE = '/sessions/architect/s1';

/** Session page whose phase and gate the test steers; `stopNow` reads it. */
function sessionPage(phase: () => string) {
  return {
    url: () => `http://localhost:4124${SCOPE}`,
    locator: () => ({ count: async () => 1 }),
    evaluate: async () => ({ data: {}, nested: [], lifecycle: null, lifecycleError: null, sessionPhase: phase() }),
  };
}

test('row 194 DOOR 3 (pin): inside a repeat, `awaiting-answers` with the gate present keeps looping and presses', async () => {
  let phase = 'awaiting-answers';
  const acted: string[] = [];
  const r = await runRepeatStep({
    page: sessionPage(() => phase) as never, step: ROUND as never, left: () => 2_000, timeoutMs: 2_000,
    sessionScope: SCOPE, matches: async () => phase === 'awaiting-verdict',
    run: async (inner: Record<string, unknown>[]) => {
      acted.push(Object.keys(inner[0]!)[0]!);
      if (inner[0]!['press'] === 'submit-answers') phase = 'awaiting-verdict';
      return { waitedForHandle: true, error: null };
    },
  });
  assert.equal(r.error, null, String(r.error));
  assert.deepEqual(acted, ['fillAll', 'press'], 'the round is the repeat\'s to answer — the operator gate is its whole purpose');
});

test('row 194 DOOR 4 (pin): a terminal phase inside the repeat still stops it', async () => {
  const r = await runRepeatStep({
    page: sessionPage(() => 'failed') as never, step: ROUND as never, left: () => 2_000, timeoutMs: 2_000,
    sessionScope: SCOPE, matches: async () => false,
    run: async () => { throw new Error('a failed session must never be acted on'); },
  });
  assert.match(String(r.error), /terminal "failed".*the repeat stops/);
});

// ─────────── FOLLOW-UP (T1 1973gn) — a repeat the beat's route cannot scope ───────────
//
// S1 beat 11 ends on `/artifact` and S1 beat 9 on `/projects/story-s1`, so
// neither has a SESSION scope — the gate above never armed for them. Both now
// declare the page their `until` is read on (`on`), resolved like a route.

/** S1's REAL beat 11 (the approve beat), validated in place, wait scaled. */
function realS1Beat11() {
  const story = S1 as unknown as { beats: Record<string, unknown>[] };
  const i = story.beats.length - 1;
  assert.match(String(story.beats[i]!['act']), /Approve/, 'fixture check: S1\'s last beat is still the approve beat');
  const v = validateStory({
    ...story, beats: story.beats.map((b, k) => (k === i ? { ...b, wait: { for: 'agent', upTo: 4_000 } } : b)),
  }) as { beats: Record<string, unknown>[] };
  return v.beats[i]!;
}

/**
 * Standing on the project page, which here also carries ANOTHER session's
 * card at `awaiting-verdict` — the hazard S2 b12 met on Monitor. The press
 * commits to the beat's own session after a window; the architect asks; a
 * submitted round drafts; `open-plan` goes to `/artifact`; `approve-plan` commits.
 */
function s1Beat11Page() {
  const s = { route: '/projects/story-s1', phase: 'interviewing', gate: false, committed: false, submits: 0 };
  const onSession = () => s.route.startsWith('/sessions/');
  const count = (sel: string): number => {
    if (sel.includes('view-architect-session')) return s.route === '/projects/story-s1' ? 1 : 0;
    if (sel.startsWith(GATE.field) || sel.startsWith(GATE.submit)) return onSession() && s.gate ? 1 : 0;
    if (sel.includes('open-plan')) return onSession() && s.phase === 'awaiting-verdict' ? 1 : 0;
    if (sel.includes('approve-plan')) return s.route === '/artifact' && !s.committed ? 1 : 0;
    return 0;
  };
  const click = async (sel: string) => {
    if (sel.includes('view-architect-session')) {
      setTimeout(() => { s.route = `/sessions/architect/${OWN}`; }, 150);
      setTimeout(() => { s.phase = 'awaiting-answers'; s.gate = true; }, 400);
    } else if (sel.startsWith(GATE.submit)) {
      s.submits += 1; s.gate = false; s.phase = 'awaiting-verdict';
    } else if (sel.includes('open-plan')) {
      s.route = '/artifact';
    } else if (sel.includes('approve-plan')) {
      s.committed = true;
    }
  };
  const base = run6CliPage();
  const locator = (sel: string): any => ({
    ...base.locator(sel), count: async () => count(sel), click: async () => click(sel),
    first: () => locator(sel), nth: () => locator(sel),
  });
  const pick = (rec: Record<string, string>, wanted: string[]) =>
    Object.fromEntries(Object.entries(rec).filter(([k]) => wanted.includes(k)));
  return {
    ...base, state: s, locator,
    url: () => `http://localhost:4124${s.route}`,
    waitForURL: async (ok: (u: URL) => boolean, { timeout }: { timeout: number }) => {
      for (const until = Date.now() + timeout; Date.now() < until; await new Promise((r) => setTimeout(r, 10))) {
        if (ok(new URL(`http://localhost:4124${s.route}`))) return;
      }
      throw new Error('waitForURL timed out');
    },
    evaluate: async (_fn: unknown, { wanted }: { wanted: string[] }) => {
      const none = { lifecycle: null, lifecycleError: null };
      if (s.route === '/projects/story-s1') {
        return { ...none, sessionPhase: null, data: pick({ page: 'projects', 'project-id': 'story-s1' }, wanted),
          nested: [pick({ 'session-kind': 'architect', 'session-id': NEIGHBOUR, 'session-phase': 'awaiting-verdict' }, wanted)] };
      }
      if (onSession()) {
        return { ...none, sessionPhase: s.phase, nested: [],
          data: pick({ page: 'session', 'page-ready': 'true', 'session-kind': 'architect', 'session-phase': s.phase }, wanted) };
      }
      return { ...none, sessionPhase: null, nested: [], data: pick({
        section: 'architect-plan', 'architect-phase': s.committed ? 'committed' : 'awaiting-verdict',
        'gate-armed': s.committed ? 'false' : 'true', 'plan-mode': 'view' }, wanted) };
    },
  };
}

test('row 194 DOOR 5 (RED before `on`): S1 beat 11 — another session\'s card on the page being left never satisfies `until`', async () => {
  const page = s1Beat11Page();
  const v = await driveBeat(page as never, realS1Beat11() as never, 1, 'http://localhost:4124',
    { architectSessionId: OWN }) as { status: string; failures: string[] };
  const said = v.failures.join(' | ');
  assert.equal(page.state.submits, 1, `the repeat must answer the round, not take a foreign card for its end: ${said}`);
  assert.equal(v.status, 'green', said);
});

test('row 194 RATCHET: every repeat in tests/stories/ is scoped — a session route + agent wait, or its own `on`', () => {
  const stories = [S1, S2, S4, S9, S10] as unknown as { id?: string; beats: Record<string, unknown>[] }[];
  const unscoped: string[] = [];
  let seen = 0;
  for (const story of stories) {
    const v = validateStory(story as never) as { beats: Record<string, unknown>[] };
    v.beats.forEach((b, i) => {
      const route = String((b['expect'] as { route: string }).route);
      const sessionScoped = b['wait'] !== undefined && route.startsWith('/sessions/');
      for (const st of (b['do'] as Record<string, unknown>[] | undefined) ?? []) {
        if (st['repeat'] === undefined) continue;
        seen += 1;
        if (!sessionScoped && st['on'] === undefined) unscoped.push(`${String(story.id)} beat ${i + 1}: ${String(b['act'])}`);
      }
    });
  }
  assert.ok(seen >= 7, `fixture check: the seven measured repeats are still found (got ${seen})`);
  assert.deepEqual(unscoped, [], 'a repeat whose `until` a page being left could answer');
});

test('row 194: `on` is refused at LOAD when malformed or naming a binding no earlier beat makes', () => {
  const beat = (on: unknown) => ({
    act: 'a', say: 's', expect: { route: '/projects', data: { page: 'projects' } },
    do: [{ repeat: [{ press: 'x' }], until: { 'page': 'projects' }, on }],
  });
  assert.throws(() => validateStory({ ...(S2 as object), beats: [beat('sessions/x')] } as never), /\.on/);
  assert.throws(() => validateStory({ ...(S2 as object), beats: [beat('/sessions/architect/<nope>')] } as never),
    /repeat\.on names <nope>/);
});
