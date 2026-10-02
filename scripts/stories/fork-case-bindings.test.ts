/**
 * fork-case-bindings.test.ts — forge-8vfn.8.5.16, the fix for a MEASURED
 * defect (row 180, bead `forge-8vfn.8.5.16`, T1 ruling 1973bq).
 *
 * THE DEFECT. S2 (`tests/stories/S2.story.mjs`) forks beat 3 over three
 * starters (`fork.from: 1`), and `expandForkedBeats` (`beats-fork.mjs`)
 * re-emits beats 1-2 before every case AFTER THE FIRST, then the fork beat and
 * the whole remainder — once per case, each on its own ground. A remainder
 * beat BINDS a value the page mints (`<architectSessionId>`), and the binding
 * store the runner threads across the whole expanded sequence (`run-story.mjs`)
 * never reset between cases — so case 2's ("cli") own mint was compared
 * against case 1's ("api"), and a real run reded with:
 *
 *   ✗ 10[cli] data-architect-session-id: expected 2026-10-02T06-27-38-a34e93c5
 *   (bound as <architectSessionId> by an earlier beat), got
 *   2026-10-02T06-41-16-a7dfe8f6
 *
 * — followed by three MORE beats going green against case 1's session,
 * because the mismatch never stopped the later beats from reading the
 * (wrong) already-bound value.
 *
 * THE FIX. Bindings are per fork case: `expandForkedBeats` marks the FIRST
 * entry it emits for a case after the first `caseStart: true, from: <n>`
 * (`fork.from`, or the fork's own beat number when there is nothing to
 * replay), and `clearForCase` (`beats-fork.mjs`) drops every binding made at
 * beat `<n>` or later before that entry — and every later entry of the same
 * case — ever runs against the store. A binding made STRICTLY BEFORE `<n>`
 * survives, because the beat that made it ran exactly once, for every case
 * alike.
 *
 * THIS FILE drives the REAL `expandForkedBeats` and the REAL binding-store
 * functions (`emptyBindingsStore`/`clearForCase`/`recordBindings`) together
 * with the REAL `driveBeat` against a fake page — the same functions
 * `run-story.mjs` itself calls, never a reimplementation of the mechanism
 * under test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driveBeat } from './beats-drive.mjs';
import {
  expandForkedBeats, emptyBindingsStore, clearForCase, recordBindings,
} from './beats-fork.mjs';
import { el, READY_MAIN, fakeStudio } from './test-fixtures/fake-studio.ts';

const BASE_URL = 'http://localhost:4124';

/** The case a flattened entry's label names ("3[cli]" -> "cli"), or `null`
 *  for a plain, un-cased entry (the first case's own plain walk). */
function caseOfLabel(label: string): string | null {
  const m = /\[([^\]]+)\]$/.exec(label);
  return m === null ? null : m[1];
}

/**
 * Drive one story's WHOLE expanded sequence through the real `driveBeat`,
 * threading the real binding store exactly as `run-story.mjs`'s own loop
 * does — `clearForCase` before the beat runs, `recordBindings` after.
 *
 * `onEntry` lets a test move the fake page's own live state (which case is
 * "active") before the entry it is about to drive — the harness has no
 * navigation of its own to do that, by design (see the file header: every
 * beat below stands on the SAME route throughout).
 */
async function driveWhole(beats: object[], groundProject: string, page: unknown, onEntry: (entry: any) => void) {
  let store = emptyBindingsStore();
  const verdicts: { label: string; verdict: any }[] = [];
  for (const [i, entry] of expandForkedBeats(beats, groundProject).entries()) {
    store = clearForCase(store, entry);
    onEntry(entry);
    // eslint-disable-next-line no-await-in-loop
    const verdict = await driveBeat(page, entry.beat, i, BASE_URL, store.values);
    store = recordBindings(store, entry.number, verdict.bindings);
    verdicts.push({ label: entry.label, verdict });
  }
  return { verdicts, store };
}

// ───────────────────────────────────────────────── S2's own shape: from: 1

// A fork at beat 2, `from: 1` — ONE entry beat (S2 has two; one is enough to
// exercise the same mechanism), a bind in the remainder (beat 3), and a later
// beat (4) asserting it. Three cases, like S2's three starters.
const SESSION_ID = { api: 'sess-api-aaa111', cli: 'sess-cli-bbb222', webapp: 'sess-webapp-ccc333' };

function s2ShapeBeats() {
  return [
    {
      act: 'Open the Projects pillar',
      do: [],
      expect: { route: '/projects/active', data: { page: 'projects-index' } },
      say: 's',
    },
    {
      act: 'Name it, pick a starter, and create the project',
      do: [{ fill: 'create-app-type', with: 'api' }],
      expect: { route: '/projects/active', data: { 'project-id': 'story-proof' } },
      fork: { over: 'create-app-type', cases: ['api', 'cli', 'webapp'], from: 1 },
      say: 's',
    },
    {
      act: 'Start the architect and see its own session id minted on the page',
      do: [],
      expect: {
        route: '/projects/active',
        data: { 'project-id': 'story-proof', 'session-id': '<sessionId>' },
      },
      say: 's',
    },
    {
      act: 'Confirm the session id this case minted, standing on the same page',
      do: [],
      expect: {
        route: '/projects/active',
        data: { 'project-id': 'story-proof', 'session-id': '<sessionId>' },
      },
      say: 's',
    },
  ];
}

function makeFakePage(current: { project: string; sessionId: string }) {
  return fakeStudio({
    start: '/projects/active',
    commitMs: 0,
    pages: {
      '/projects/active': {
        elements: [READY_MAIN('projects-index'), el('select', { 'data-field': 'create-app-type' })],
        get data() {
          return {
            page: 'projects-index',
            'page-ready': 'true',
            'project-id': current.project,
            'session-id': current.sessionId,
          };
        },
      },
    },
  });
}

test('a fork case re-binds what its own beats bind: case 2 asserts ITS OWN value, never case 1\'s', async () => {
  const current = { project: 'story-proof-api', sessionId: SESSION_ID.api };
  const page = makeFakePage(current);
  const { verdicts } = await driveWhole(s2ShapeBeats(), 'story-proof', page, (entry) => {
    const c = caseOfLabel(entry.label) ?? 'api';
    current.project = `story-proof-${c}`;
    current.sessionId = SESSION_ID[c as keyof typeof SESSION_ID];
  });

  const byLabel = new Map(verdicts.map((v) => [v.label, v.verdict]));
  const labels = verdicts.map((v) => v.label);

  // Every case, every beat, green — including case 2 ("cli") and case 3
  // ("webapp") re-binding the SAME placeholder name their own beat 3 mints.
  for (const label of labels) {
    const v = byLabel.get(label);
    assert.equal(v.status, 'green', `${label} should be green: ${v.failures.join(' | ')}`);
  }

  // THE DEFECT, pinned directly: case 2's own beat 3 (labelled "3[cli]") must
  // bind CASE 2's session id, never case 1's leftover.
  assert.equal(byLabel.get('3[cli]').bindings.sessionId, SESSION_ID.cli);
  assert.equal(byLabel.get('4[cli]').bindings.sessionId, SESSION_ID.cli);
  assert.equal(byLabel.get('3[webapp]').bindings.sessionId, SESSION_ID.webapp);
  assert.equal(byLabel.get('4[webapp]').bindings.sessionId, SESSION_ID.webapp);
  // And case 1's own beats bound case 1's value, never disturbed by what ran after it.
  assert.equal(byLabel.get('3[api]').bindings.sessionId, SESSION_ID.api);
});

test('without the reset, case 2 would compare its own mint against case 1\'s (characterisation of the defect)', async () => {
  // This does not call `clearForCase` at all — the exact shape the defect
  // measured: ONE store, carried unconditionally across every case.
  const current = { project: 'story-proof-api', sessionId: SESSION_ID.api };
  const page = makeFakePage(current);
  let bindings: Record<string, string> = {};
  let redAt3cli: any = null;
  for (const [i, entry] of expandForkedBeats(s2ShapeBeats(), 'story-proof').entries()) {
    const c = caseOfLabel(entry.label) ?? 'api';
    current.project = `story-proof-${c}`;
    current.sessionId = SESSION_ID[c as keyof typeof SESSION_ID];
    // eslint-disable-next-line no-await-in-loop
    const verdict = await driveBeat(page, entry.beat, i, BASE_URL, bindings);
    bindings = { ...bindings, ...verdict.bindings };
    if (entry.label === '3[cli]') redAt3cli = verdict;
  }
  assert.equal(redAt3cli.status, 'red', 'case 2\'s own beat 3 collides with case 1\'s leftover binding without the reset');
  assert.match(
    redAt3cli.failures.join(' | '),
    /bound as <?sessionId>? by an earlier beat.*got/s,
  );
});

// ─────────────────────────────────── a binding made BEFORE `from` stays shared

// A fork at beat 3, `from: 2` — beat 1 binds `<sharedId>` and is NEVER
// replayed (it sits before `from`), beat 2 is the lone entry beat, beat 4 (the
// remainder) reasserts `<sharedId>` AND binds a fresh `<caseId>` every case.
function fromTwoBeats() {
  return [
    {
      act: 'Open home and note the session already running',
      do: [],
      expect: { route: '/home', data: { 'shared-id': '<sharedId>' } },
      say: 's',
    },
    {
      act: 'Open the Projects pillar',
      do: [],
      expect: { route: '/projects/active', data: { page: 'projects-index' } },
      say: 's',
    },
    {
      act: 'Name it, pick a starter, and create the project',
      do: [{ fill: 'create-app-type', with: 'api' }],
      expect: { route: '/projects/active', data: { 'project-id': 'story-proof' } },
      fork: { over: 'create-app-type', cases: ['api', 'cli'], from: 2 },
      say: 's',
    },
    {
      act: 'Check the shared session is still named, and mint this case\'s own id',
      do: [],
      expect: {
        route: '/projects/active',
        data: { 'project-id': 'story-proof', 'shared-id': '<sharedId>', 'case-id': '<caseId>' },
      },
      say: 's',
    },
  ];
}

test('a binding made BEFORE `from` stays visible to every case; one made at/after `from` resets', async () => {
  const CASE_ID = { api: 'case-api-111', cli: 'case-cli-222' };
  const current = { project: 'story-proof-api', caseId: CASE_ID.api };
  const homePage = fakeStudio({
    start: '/home',
    commitMs: 0,
    pages: {
      '/home': {
        elements: [READY_MAIN('home'), el('a', { href: '/projects/active' }, '/projects/active')],
        data: { page: 'home', 'shared-id': 'shared-value-xyz' },
      },
      '/projects/active': {
        elements: [READY_MAIN('projects-index'), el('select', { 'data-field': 'create-app-type' })],
        get data() {
          return {
            page: 'projects-index',
            'page-ready': 'true',
            'project-id': current.project,
            'case-id': current.caseId,
            // Carried on every page the same way `<sharedId>`'s own source
            // beat (1) declared it — a persistent fact, not something only
            // beat 1's own route happens to answer.
            'shared-id': 'shared-value-xyz',
          };
        },
      },
    },
  });

  const { verdicts, store } = await driveWhole(fromTwoBeats(), 'story-proof', homePage, (entry) => {
    const c = caseOfLabel(entry.label) ?? 'api';
    current.project = `story-proof-${c}`;
    current.caseId = CASE_ID[c as keyof typeof CASE_ID];
  });

  const byLabel = new Map(verdicts.map((v) => [v.label, v.verdict]));
  for (const [label, v] of byLabel) {
    assert.equal(v.status, 'green', `${label} should be green: ${v.failures.join(' | ')}`);
  }

  // `<sharedId>` — bound by beat 1, numbered BEFORE `from: 2` — is never
  // cleared: case "cli"'s own beat 4 still reads it from the store.
  assert.equal(byLabel.get('1').bindings.sharedId, 'shared-value-xyz');
  assert.equal(store.values.sharedId, 'shared-value-xyz', 'the shared binding survives to the end of the run');

  // `<caseId>` — bound at beat 4, numbered AT/AFTER `from: 2` — resets: case
  // "cli" mints its OWN value, never case "api"'s.
  assert.equal(byLabel.get('4[api]').bindings.caseId, CASE_ID.api);
  assert.equal(byLabel.get('4[cli]').bindings.caseId, CASE_ID.cli);
  assert.equal(store.values.caseId, CASE_ID.cli, 'the store ends on the LAST case\'s own binding');
});

// ──────────────────────────────────────────── unit-level: the store alone

test('clearForCase is a no-op for an entry with no caseStart', () => {
  const store = recordBindings(emptyBindingsStore(), 3, { foo: 'bar' });
  const after = clearForCase(store, { label: '4' });
  assert.equal(after, store, 'an entry carrying no caseStart returns the SAME store, not a rebuilt copy');
});

test('clearForCase drops bindings made at or after `from`, keeps the rest', () => {
  let store = emptyBindingsStore();
  store = recordBindings(store, 1, { sharedId: 'shared' });
  store = recordBindings(store, 5, { caseId: 'case-one' });
  const cleared = clearForCase(store, { caseStart: true, from: 2 });
  assert.deepEqual(cleared.values, { sharedId: 'shared' });
  assert.deepEqual(cleared.boundAt, { sharedId: 1 });
});

test('clearForCase keeps a binding made EXACTLY at `from` cleared (at-or-after, not strictly-after)', () => {
  let store = emptyBindingsStore();
  store = recordBindings(store, 2, { caseId: 'case-one' });
  const cleared = clearForCase(store, { caseStart: true, from: 2 });
  assert.deepEqual(cleared.values, {}, 'a binding made ON the replay boundary belongs to the previous case');
});

test('recordBindings is a no-op when the verdict bound nothing', () => {
  const store = emptyBindingsStore();
  const after = recordBindings(store, 3, {});
  assert.equal(after, store);
});

// ────────────────────────────────────────────── S7's door fork cannot leak

test('S7-shape door fork: expandForkedBeats never marks a caseStart — one case, once, nothing to reset', () => {
  // A door fork's `over` names no `fill` step, so `isFillFork` is false and
  // the beat is carried through UNCHANGED, as exactly one entry — there is no
  // second case run to leak INTO. Proven structurally rather than against the
  // real S7 story, which is `beats-fork-ground.test.ts`'s own door.
  const beats = [
    { act: 'a', do: [], expect: { route: '/x', data: {} }, say: 's' },
    {
      act: 'b',
      do: [{ fill: 'authoring-launcher-project', with: 'mdtoc' }, { press: 'start-authoring' }],
      expect: { route: '/skills/new', data: { 'minted-session-id': '<authoringSessionId>' } },
      say: 's',
      fork: { over: 'authoring-door', cases: ['creation-agent', 'manual-form'] },
    },
    { act: 'c', do: [], expect: { route: '/skills', data: {} }, say: 's' },
  ];
  const out = expandForkedBeats(beats, 'story-s7');
  assert.equal(out.length, 3, 'a door fork contributes exactly one entry');
  assert.ok(out.every((e) => e.caseStart === undefined), 'no entry is ever a case-reset boundary for a door fork');
});
