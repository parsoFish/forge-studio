/**
 * W8-B5 / WI-6 (exit row E15) — `/community`'s browse state lives in the URL.
 *
 * DOES NOT EXIST YET when this file is first written: `./community-url-state.ts`
 * is created by this work item, so the expected first red is module-not-found.
 *
 * THE DEFECT. `app/community/page.tsx:58-63` held kind / hub / query / sortKey
 * / sortDir in five `useState`s and the file had ZERO
 * `useSearchParams`/`useRouter`/`pushState` hits. Open a card, hit Back, and
 * the filter, hub, search and sort were all gone; the view could not be linked
 * or shared either.
 *
 * The parse side must be TOTAL and never throw: a URL is operator-editable
 * (and link-rot-able) input arriving at a system boundary. An unrecognised
 * `kind`/`sort`/`dir` degrades to the documented default rather than
 * rendering a filter vocabulary the page does not have.
 *
 * The serialise side OMITS every value that equals its default, so the
 * canonical default view is the bare `/community` the journeys already
 * `waitForURL('**\/community')` on — a page that rewrote itself to
 * `/community?kind=all&sort=name&dir=asc` on mount would break that contract
 * and bury the Back button under a synthetic entry.
 */
import { test, expect } from 'vitest';
import {
  COMMUNITY_URL_PARAMS,
  DEFAULT_COMMUNITY_VIEW_STATE,
  parseCommunityViewState,
  communityViewStateToSearch,
  writeBaseState,
  type CommunityViewState,
} from './community-url-state.ts';
import { COMMUNITY_KINDS } from './community-client.ts';
import {
  COMMUNITY_SORT_KEYS,
  COMMUNITY_SORT_DIRECTIONS,
  DEFAULT_COMMUNITY_SORT_KEY,
  DEFAULT_COMMUNITY_SORT_DIRECTION,
} from './community-view.ts';

const KIND_FILTERS = ['all', ...COMMUNITY_KINDS] as const;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

test('DEFAULT_COMMUNITY_VIEW_STATE reuses community-view.ts\'s OWN sort defaults — never a second copy that can drift', () => {
  expect(DEFAULT_COMMUNITY_VIEW_STATE.sortKey).toBe(DEFAULT_COMMUNITY_SORT_KEY);
  expect(DEFAULT_COMMUNITY_VIEW_STATE.sortDir).toBe(DEFAULT_COMMUNITY_SORT_DIRECTION);
  expect(DEFAULT_COMMUNITY_VIEW_STATE.kind).toBe('all');
  expect(DEFAULT_COMMUNITY_VIEW_STATE.hub).toBeNull();
  expect(DEFAULT_COMMUNITY_VIEW_STATE.query).toBe('');
});

test('an EMPTY query string parses to exactly the default state', () => {
  expect(parseCommunityViewState('')).toEqual(DEFAULT_COMMUNITY_VIEW_STATE);
});

test('the DEFAULT state serialises to an EMPTY search string — the bare /community URL the journeys wait for', () => {
  expect(communityViewStateToSearch(DEFAULT_COMMUNITY_VIEW_STATE)).toBe('');
});

// ---------------------------------------------------------------------------
// Round-trip — ENUMERATED over every value of every vocabulary
// ---------------------------------------------------------------------------

for (const kind of KIND_FILTERS) {
  test(`round-trip: kind="${kind}" survives serialise → parse`, () => {
    const state: CommunityViewState = { ...DEFAULT_COMMUNITY_VIEW_STATE, kind };
    expect(parseCommunityViewState(communityViewStateToSearch(state))).toEqual(state);
  });
}

for (const sortKey of COMMUNITY_SORT_KEYS) {
  for (const sortDir of COMMUNITY_SORT_DIRECTIONS) {
    test(`round-trip: sort="${sortKey}"/dir="${sortDir}" survives serialise → parse`, () => {
      const state: CommunityViewState = { ...DEFAULT_COMMUNITY_VIEW_STATE, sortKey, sortDir };
      expect(parseCommunityViewState(communityViewStateToSearch(state))).toEqual(state);
    });
  }
}

test('round-trip: a full non-default state survives serialise → parse', () => {
  const state: CommunityViewState = { kind: 'mcp', hub: 'superpowers', query: 'diff review', sortKey: 'stars', sortDir: 'desc' };
  expect(parseCommunityViewState(communityViewStateToSearch(state))).toEqual(state);
});

test('round-trip: a query with URL-hostile characters survives verbatim', () => {
  for (const query of ['a&b=c', 'spaces  kept', '100%', 'ü/ø?#', '+plus+']) {
    const state: CommunityViewState = { ...DEFAULT_COMMUNITY_VIEW_STATE, query };
    expect(parseCommunityViewState(communityViewStateToSearch(state)).query).toBe(query);
  }
});

test('round-trip: a hub id with URL-hostile characters survives verbatim', () => {
  const state: CommunityViewState = { ...DEFAULT_COMMUNITY_VIEW_STATE, hub: 'a b&c' };
  expect(parseCommunityViewState(communityViewStateToSearch(state)).hub).toBe('a b&c');
});

test('parseCommunityViewState accepts a URLSearchParams as well as a string', () => {
  const params = new URLSearchParams({ [COMMUNITY_URL_PARAMS.kind]: 'hook', [COMMUNITY_URL_PARAMS.query]: 'x' });
  expect(parseCommunityViewState(params)).toEqual({ ...DEFAULT_COMMUNITY_VIEW_STATE, kind: 'hook', query: 'x' });
});

// ---------------------------------------------------------------------------
// Boundary validation — a URL is external input. TOTAL, never throws.
// ---------------------------------------------------------------------------

test('an unrecognised kind degrades to "all" — never a filter vocabulary the page does not have', () => {
  expect(parseCommunityViewState(`${COMMUNITY_URL_PARAMS.kind}=agent`).kind).toBe('all');
});

test('an unrecognised sort key degrades to the default sort key', () => {
  expect(parseCommunityViewState(`${COMMUNITY_URL_PARAMS.sortKey}=popularity`).sortKey).toBe(DEFAULT_COMMUNITY_SORT_KEY);
});

test('an unrecognised sort direction degrades to the default direction', () => {
  expect(parseCommunityViewState(`${COMMUNITY_URL_PARAMS.sortDir}=sideways`).sortDir).toBe(DEFAULT_COMMUNITY_SORT_DIRECTION);
});

test('an EMPTY hub param is the honest "no hub filter" null, never the empty-string hub id', () => {
  expect(parseCommunityViewState(`${COMMUNITY_URL_PARAMS.hub}=`).hub).toBeNull();
});

test('a repeated param takes the FIRST value — deterministic, never a joined "a,b" pseudo-value', () => {
  expect(parseCommunityViewState(`${COMMUNITY_URL_PARAMS.kind}=skill&${COMMUNITY_URL_PARAMS.kind}=hook`).kind).toBe('skill');
});

test('parseCommunityViewState never throws on hostile input', () => {
  for (const raw of ['%', '%%%', 'kind', '=', '&&&', 'kind=%E0%A4%A', 'q=%']) {
    expect(() => parseCommunityViewState(raw)).not.toThrow();
  }
});

test('a leading "?" is tolerated — callers pass either form', () => {
  expect(parseCommunityViewState(`?${COMMUNITY_URL_PARAMS.kind}=tool`).kind).toBe('tool');
});

// ---------------------------------------------------------------------------
// Serialisation omits defaults — one canonical URL per view
// ---------------------------------------------------------------------------

test('only NON-default values reach the search string — no ?kind=all&sort=name&dir=asc noise', () => {
  const search = communityViewStateToSearch({ ...DEFAULT_COMMUNITY_VIEW_STATE, kind: 'skill' });
  const params = new URLSearchParams(search);
  expect([...params.keys()]).toEqual([COMMUNITY_URL_PARAMS.kind]);
  expect(params.get(COMMUNITY_URL_PARAMS.kind)).toBe('skill');
});

test('a whitespace-only query is not written to the URL — it filters nothing', () => {
  expect(communityViewStateToSearch({ ...DEFAULT_COMMUNITY_VIEW_STATE, query: '   ' })).toBe('');
});

test('serialise → parse → serialise is stable (idempotent) for a full state', () => {
  const state: CommunityViewState = { kind: 'skill', hub: 'forge-seed', query: 'diff', sortKey: 'updated', sortDir: 'desc' };
  const once = communityViewStateToSearch(state);
  expect(communityViewStateToSearch(parseCommunityViewState(once))).toBe(once);
});

test('COMMUNITY_URL_PARAMS names all five keys and they are distinct', () => {
  const names = Object.values(COMMUNITY_URL_PARAMS);
  expect(names.length).toBe(5);
  expect(new Set(names).size).toBe(5);
});

// ---------------------------------------------------------------------------
// writeBaseState — coalescing rapid interactions.
//
// Moving the state into the URL introduces a hazard the five useStates did not
// have: a router write is ASYNCHRONOUS, so a second click landing before the
// first has been applied would read the STALE url state and silently drop the
// first change (pick a kind, immediately pick a hub → the kind is gone). This
// is the pure rule the page uses to decide what a new write builds on.
// ---------------------------------------------------------------------------

const A: CommunityViewState = { kind: 'skill', hub: null, query: '', sortKey: 'name', sortDir: 'asc' };
const B: CommunityViewState = { kind: 'skill', hub: 'superpowers', query: '', sortKey: 'name', sortDir: 'asc' };

test('writeBaseState: with no write in flight, a new write builds on the URL\'s own state', () => {
  expect(writeBaseState(A, 'kind=skill', null)).toEqual(A);
});

test('writeBaseState: a write still in flight (the URL has not moved) is what the NEXT write builds on — the second click never drops the first', () => {
  // The operator clicked "skill" (writing A), then clicked the superpowers hub
  // before the router applied it. The URL still reads the pre-A search.
  expect(writeBaseState(DEFAULT_COMMUNITY_VIEW_STATE, '', { from: '', state: A })).toEqual(A);
});

test('writeBaseState: once the URL HAS moved, the pending write is stale and the URL wins', () => {
  expect(writeBaseState(B, 'kind=skill&hub=superpowers', { from: '', state: A })).toEqual(B);
});

test('writeBaseState: a Back press (the URL moves somewhere else entirely) drops the pending write rather than resurrecting it', () => {
  const backTarget: CommunityViewState = { ...DEFAULT_COMMUNITY_VIEW_STATE, kind: 'mcp' };
  expect(writeBaseState(backTarget, 'kind=mcp', { from: '', state: A })).toEqual(backTarget);
});

test('writeBaseState never mutates or clones-away either input', () => {
  const pending = { from: 'x', state: A };
  expect(writeBaseState(B, 'x', pending)).toBe(A);
  expect(writeBaseState(B, 'y', pending)).toBe(B);
});
