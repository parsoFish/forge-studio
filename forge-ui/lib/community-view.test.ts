/**
 * Tests for forge-ui/lib/community-view.ts (R3-07-F1) — DOES NOT EXIST YET.
 * Vitest cannot even collect this file until it lands (module-not-found is
 * the expected red).
 *
 * Pure view-state derivation for the /community library page +
 * /community/[kind]/[id] detail page — mirrors connection-library-view.ts's
 * testability convention exactly: no DOM, no React, no network, no
 * re-derivation of server-computed facts (installState, probeState, hub
 * match, signals) — this module assumes a parsed, already-trustworthy
 * `CommunityItem`/`CommunityHub` (from ./community-client.ts) and only ever
 * reshapes it for rendering.
 *
 * COVERAGE LIMIT (stated per the T3 task brief's AT-placement rule):
 * component-level rendering of the /community pages themselves is
 * DESCOPED from this AT suite — there is no jsdom/testing-library in this
 * repo's forge-ui vitest config (`environment: 'node'`, and adding one is
 * forbidden by house convention). What backstops the actual page
 * components: `npm run build` (type-checks every call site against this
 * module's exported signatures) and the live journey beats in
 * `scripts/journeys/community.mjs` (a separate T3, per the brief) driving
 * the real rendered DOM end-to-end. This file only pins the PURE logic.
 *
 * `installStateLabel('no signals published' etc.)` wording below is pinned
 * to the EXACT phrase the binding T2 spec (`_wave5/specs/R3-07.md`, D5)
 * quotes verbatim ("An item with no published signals renders 'no signals
 * published' — never a zero") and the README ("unaffiliated") — these are
 * not this file's own invented copy, they are spec-literal.
 *
 * ---------------------------------------------------------------------------
 * T2 ROUND 6, AT GROUP 3: `communityBadgeForSkill` — DOES NOT EXIST YET.
 * `forge-ui/app/skills/page.tsx` currently joins the community index onto
 * EVERY skill card by (kind==='skill', id) alone, with no check that the
 * card is actually source==='community' — a catalog community-skills entry
 * sharing an id with a genuinely local, hand-authored skill (a collision
 * `listSkillLibrary` documents as expected — "filesystem wins on existence/
 * trust; catalog wins on display metadata") cross-attributes the catalog
 * entry's hub/signals/provenance onto the operator's OWN file. The join
 * logic must live here, as a pure function, so it is vitest-pinnable
 * instead of only catchable by a live `ui:journey` DOM walk. Expected RED:
 * `communityBadgeForSkill` is not yet exported from `./community-view.ts`.
 */
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import {
  filterByKind,
  filterCommunityItems,
  filterByHub,
  installStateLabel,
  signalsLabel,
  hubLabel,
  communityBadgeForSkill,
  sortCommunityItems,
  freshnessBadge,
  lastRefreshLabel,
  installActionForItem,
  refreshOutcomeView,
  COMMUNITY_SORT_KEYS,
  COMMUNITY_SORT_LABELS,
} from './community-view.ts';
import type { CommunityItem, CommunityHub, CommunityRefreshResult } from './community-client.ts';

function item(overrides: Partial<CommunityItem> = {}): CommunityItem {
  return {
    id: 'x',
    kind: 'tool',
    name: 'X',
    desc: 'An x thing.',
    // W8-B5 (community-05 / exit row E11): `category` joined CommunityItem so
    // the browse search can match it. Nullable — this fixture is a tool, which
    // has no registry row and therefore genuinely has no category.
    category: null,
    upstream: 'https://example.com/x',
    hub: null,
    signals: null,
    vendored: false,
    installState: 'not-installed',
    probeState: null,
    origin: 'test',
    fetchedAt: null,
    fetchedBy: 'local',
    upstreamUpdatedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// filterByKind — AC #1: "every kind filters correctly"
// ---------------------------------------------------------------------------

test('filterByKind("all") returns every item, unfiltered, as a NEW array', () => {
  const items = [item({ id: 'a', kind: 'skill' }), item({ id: 'b', kind: 'hook' })];
  const result = filterByKind(items, 'all');
  expect(result).toEqual(items);
  expect(result).not.toBe(items);
});

for (const kind of ['skill', 'hook', 'mcp', 'tool'] as const) {
  test(`filterByKind("${kind}") returns ONLY ${kind} items — no other kind leaks through`, () => {
    const items = [
      item({ id: 'a', kind: 'skill' }),
      item({ id: 'b', kind: 'hook' }),
      item({ id: 'c', kind: 'mcp' }),
      item({ id: 'd', kind: 'tool' }),
    ];
    const result = filterByKind(items, kind);
    expect(result.length).toBe(1);
    expect(result[0]!.kind).toBe(kind);
  });
}

test('filterByKind on an item set with NO match for the requested kind returns []', () => {
  const items = [item({ id: 'a', kind: 'skill' })];
  expect(filterByKind(items, 'hook')).toEqual([]);
});

// ---------------------------------------------------------------------------
// filterCommunityItems — search by name/desc, case-insensitive
// ---------------------------------------------------------------------------

test('filterCommunityItems: empty query returns every item, unfiltered', () => {
  const items = [item({ id: 'a' }), item({ id: 'b' })];
  expect(filterCommunityItems(items, '')).toEqual(items);
});

test('filterCommunityItems: matches on name, case-insensitive', () => {
  const items = [item({ id: 'a', name: 'Dependency Diff Review' }), item({ id: 'b', name: 'Block Force Push' })];
  const result = filterCommunityItems(items, 'dependency');
  expect(result.map((i) => i.id)).toEqual(['a']);
});

test('filterCommunityItems: matches on desc too', () => {
  const items = [item({ id: 'a', name: 'X', desc: 'refuses a force-push to a protected branch' })];
  expect(filterCommunityItems(items, 'force-push').map((i) => i.id)).toEqual(['a']);
});

test('filterCommunityItems: no match returns []', () => {
  const items = [item({ id: 'a', name: 'X', desc: 'y' })];
  expect(filterCommunityItems(items, 'zzz-no-match-zzz')).toEqual([]);
});

// ---------------------------------------------------------------------------
// installStateLabel — D3: 4 distinct, non-empty labels; needs-review must
// read distinctly from installed (the trust-semantics rendering AC — a
// tampered item must never LOOK installed).
// ---------------------------------------------------------------------------

test('installStateLabel produces a non-empty, DISTINCT label for each of the four states', () => {
  const states = ['not-installed', 'draft-pending-approval', 'needs-review', 'installed'] as const;
  const labels = states.map((s) => installStateLabel(s));
  for (const label of labels) expect(label.length).toBeGreaterThan(0);
  expect(new Set(labels).size).toBe(4);
});

test('installStateLabel("needs-review") must not read as "installed" — a tampered item must never be presented as trustworthy (D3)', () => {
  const needsReview = installStateLabel('needs-review').toLowerCase();
  const installed = installStateLabel('installed').toLowerCase();
  expect(needsReview).not.toBe(installed);
  expect(needsReview).toMatch(/review/);
});

// ---------------------------------------------------------------------------
// signalsLabel — D5: never a fabricated zero; spec-literal "no signals
// published" phrase for a null signal.
// ---------------------------------------------------------------------------

test('signalsLabel(null) reads "no signals published" — the spec-literal phrase (D5), never a zero', () => {
  expect(signalsLabel(null)).toMatch(/no signals published/i);
});

test('signalsLabel never renders the bare digit "0" or an empty string for a null signal', () => {
  const label = signalsLabel(null);
  expect(label.trim()).not.toBe('0');
  expect(label.trim()).not.toBe('');
});

test('signalsLabel with a real stars figure includes BOTH the figure and its curated attribution — never presented as forge\'s own ranking', () => {
  const label = signalsLabel({ stars: '228k', attributedTo: 'obra/superpowers + Matt Pocock', starsNumeric: 228_000 });
  expect(label).toContain('228k');
  expect(label).toContain('obra/superpowers + Matt Pocock');
});

// ---------------------------------------------------------------------------
// hubLabel — D4: spec-literal "unaffiliated" for a null hub.
// ---------------------------------------------------------------------------

test('hubLabel(null) reads "unaffiliated" — the spec-literal word (D4), never an invented hub name', () => {
  expect(hubLabel(null)).toMatch(/unaffiliated/i);
});

test('hubLabel with a real hub renders its name', () => {
  const hub: CommunityHub = { id: 'mcp-servers', name: 'modelcontextprotocol/servers', url: 'https://github.com/modelcontextprotocol/servers', kinds: 'MCPs' };
  expect(hubLabel(hub)).toContain('modelcontextprotocol/servers');
});

// ---------------------------------------------------------------------------
// communityBadgeForSkill — T2 round 6, AT GROUP 3: the /skills join must be
// gated on the skill's OWN source, never on id alone. `entry` deliberately
// takes a minimal structural shape ({id, source}) rather than importing
// forge-ui/lib/skill-client.ts's full SkillLibraryEntry type — this module
// stays decoupled from that client, matching its own stated "no
// re-derivation of a fact the community index didn't send" convention.
// ---------------------------------------------------------------------------

const COLLIDING_COMMUNITY_ITEM: CommunityItem = {
  id: 'collide-id',
  kind: 'skill',
  name: 'Collide Id (community)',
  desc: 'A catalog community-skills entry.',
  // W8-B5 (community-05 / exit row E11): a registry-sourced skill carries its
  // own real category over the wire.
  category: 'review',
  upstream: 'https://example.com/collide-id',
  hub: { id: 'example-hub', name: 'Example Hub', url: 'https://example.com', kinds: 'skills' },
  signals: { stars: '9.9k', attributedTo: 'Catalog Curator', starsNumeric: 9900 },
  vendored: false,
  installState: 'not-installed',
  probeState: null,
  origin: 'studio/catalog.yaml (community-skills)',
  fetchedAt: null,
  fetchedBy: 'seed',
  upstreamUpdatedAt: null,
};

test('communityBadgeForSkill: a LOCAL entry never gets a badge, even when the community index carries an item with the SAME id — the reviewer-reproduced collision', () => {
  const localEntry = { id: 'collide-id', source: 'local' };
  const result = communityBadgeForSkill(localEntry, [COLLIDING_COMMUNITY_ITEM]);
  expect(result).toBeNull();
});

test('communityBadgeForSkill: a genuine source:"community" entry with a matching index item returns that item', () => {
  const communityEntry = { id: 'collide-id', source: 'community' };
  const result = communityBadgeForSkill(communityEntry, [COLLIDING_COMMUNITY_ITEM]);
  expect(result).toEqual(COLLIDING_COMMUNITY_ITEM);
});

test('communityBadgeForSkill: a source:"community" entry with NO matching index item returns null, not a fabricated badge', () => {
  const communityEntry = { id: 'no-such-id-in-index', source: 'community' };
  const result = communityBadgeForSkill(communityEntry, [COLLIDING_COMMUNITY_ITEM]);
  expect(result).toBeNull();
});

test('communityBadgeForSkill: never matches a non-skill-kind item sharing the id (kind discrimination, D13)', () => {
  const communityEntry = { id: 'collide-id', source: 'community' };
  const mcpItem: CommunityItem = { ...COLLIDING_COMMUNITY_ITEM, kind: 'mcp' };
  const result = communityBadgeForSkill(communityEntry, [mcpItem]);
  expect(result).toBeNull();
});

// ---------------------------------------------------------------------------
// sortCommunityItems (W6-CR-2) — operator-locked SIMPLE SORTS ONLY: name /
// stars / updated / source. Pure, new-array, null-last, stable-on-tie.
// ---------------------------------------------------------------------------

function withStars(id: string, name: string, starsNumeric: number | null): CommunityItem {
  return item({
    id,
    name,
    signals: starsNumeric === null ? null : { stars: String(starsNumeric), attributedTo: 'someone', starsNumeric },
  });
}

function withFetchedAt(id: string, name: string, fetchedAt: string | null): CommunityItem {
  return item({ id, name, fetchedAt });
}

test('sortCommunityItems: returns a NEW array, never the same reference, and never mutates the input', () => {
  const items = [item({ id: 'b', name: 'B' }), item({ id: 'a', name: 'A' })];
  const original = [...items];
  const result = sortCommunityItems(items, 'name', 'asc');
  expect(result).not.toBe(items);
  expect(items).toEqual(original);
});

test('sortCommunityItems("name", "asc") sorts alphabetically', () => {
  const items = [item({ id: 'c', name: 'Charlie' }), item({ id: 'a', name: 'Alpha' }), item({ id: 'b', name: 'Bravo' })];
  expect(sortCommunityItems(items, 'name', 'asc').map((i) => i.id)).toEqual(['a', 'b', 'c']);
});

test('sortCommunityItems("name", "desc") reverses the order', () => {
  const items = [item({ id: 'c', name: 'Charlie' }), item({ id: 'a', name: 'Alpha' }), item({ id: 'b', name: 'Bravo' })];
  expect(sortCommunityItems(items, 'name', 'desc').map((i) => i.id)).toEqual(['c', 'b', 'a']);
});

test('sortCommunityItems("stars", "desc") ranks highest numeric stars first', () => {
  const items = [withStars('a', 'A', 10), withStars('b', 'B', 1000), withStars('c', 'C', 500)];
  expect(sortCommunityItems(items, 'stars', 'desc').map((i) => i.id)).toEqual(['b', 'c', 'a']);
});

test('sortCommunityItems("stars", "asc") ranks lowest numeric stars first', () => {
  const items = [withStars('a', 'A', 10), withStars('b', 'B', 1000), withStars('c', 'C', 500)];
  expect(sortCommunityItems(items, 'stars', 'asc').map((i) => i.id)).toEqual(['a', 'c', 'b']);
});

test('sortCommunityItems("stars", ...): a null signals block (no stars at all) sorts LAST in BOTH directions — never a fabricated zero', () => {
  const items = [withStars('has-stars', 'Has', 10), withStars('no-stars', 'None', null)];
  expect(sortCommunityItems(items, 'stars', 'asc').map((i) => i.id)).toEqual(['has-stars', 'no-stars']);
  expect(sortCommunityItems(items, 'stars', 'desc').map((i) => i.id)).toEqual(['has-stars', 'no-stars']);
});

test('sortCommunityItems("stars", ...): a non-null signals block with a null starsNumeric (display names a different unit) ALSO sorts LAST', () => {
  const noNumeric = item({ id: 'installs-only', name: 'Installs', signals: { stars: '156k installs', attributedTo: 'x', starsNumeric: null } });
  const items = [withStars('has-stars', 'Has', 10), noNumeric];
  expect(sortCommunityItems(items, 'stars', 'desc').map((i) => i.id)).toEqual(['has-stars', 'installs-only']);
});

test('sortCommunityItems("updated", "desc") ranks the most recently fetchedAt first', () => {
  const items = [
    withFetchedAt('old', 'Old', '2026-01-01T00:00:00.000Z'),
    withFetchedAt('new', 'New', '2026-08-01T00:00:00.000Z'),
    withFetchedAt('mid', 'Mid', '2026-04-01T00:00:00.000Z'),
  ];
  expect(sortCommunityItems(items, 'updated', 'desc').map((i) => i.id)).toEqual(['new', 'mid', 'old']);
});

test('sortCommunityItems("updated", "asc") ranks the least recently fetchedAt first', () => {
  const items = [
    withFetchedAt('old', 'Old', '2026-01-01T00:00:00.000Z'),
    withFetchedAt('new', 'New', '2026-08-01T00:00:00.000Z'),
  ];
  expect(sortCommunityItems(items, 'updated', 'asc').map((i) => i.id)).toEqual(['old', 'new']);
});

test('sortCommunityItems("updated", ...): a null fetchedAt (seed, never verified) sorts LAST in BOTH directions — never treated as the epoch', () => {
  const items = [withFetchedAt('verified', 'Verified', '2026-01-01T00:00:00.000Z'), withFetchedAt('seed', 'Seed', null)];
  expect(sortCommunityItems(items, 'updated', 'asc').map((i) => i.id)).toEqual(['verified', 'seed']);
  expect(sortCommunityItems(items, 'updated', 'desc').map((i) => i.id)).toEqual(['verified', 'seed']);
});

test('sortCommunityItems("source", "asc") groups by hub label, then breaks ties by name', () => {
  const hubA: CommunityHub = { id: 'hub-a', name: 'Alpha Hub', url: 'https://example.com/a', kinds: 'skills' };
  const hubB: CommunityHub = { id: 'hub-b', name: 'Beta Hub', url: 'https://example.com/b', kinds: 'skills' };
  const items = [
    item({ id: 'a2', name: 'Zeta', hub: hubA }),
    item({ id: 'b1', name: 'Yankee', hub: hubB }),
    item({ id: 'a1', name: 'Alpha Item', hub: hubA }),
  ];
  // Alpha Hub group first (asc), Alpha Item before Zeta within it (name tiebreak).
  expect(sortCommunityItems(items, 'source', 'asc').map((i) => i.id)).toEqual(['a1', 'a2', 'b1']);
});

test('sortCommunityItems("source", "desc") reverses the GROUP order, but the within-group name tiebreak stays ascending', () => {
  const hubA: CommunityHub = { id: 'hub-a', name: 'Alpha Hub', url: 'https://example.com/a', kinds: 'skills' };
  const hubB: CommunityHub = { id: 'hub-b', name: 'Beta Hub', url: 'https://example.com/b', kinds: 'skills' };
  const items = [
    item({ id: 'a2', name: 'Zeta', hub: hubA }),
    item({ id: 'b1', name: 'Yankee', hub: hubB }),
    item({ id: 'a1', name: 'Alpha Item', hub: hubA }),
  ];
  expect(sortCommunityItems(items, 'source', 'desc').map((i) => i.id)).toEqual(['b1', 'a1', 'a2']);
});

test('sortCommunityItems("source", ...): a null hub groups under "unaffiliated" — a real bucket, not forced last (unlike stars/updated nulls)', () => {
  const hubA: CommunityHub = { id: 'hub-a', name: 'Alpha Hub', url: 'https://example.com/a', kinds: 'skills' };
  const items = [item({ id: 'affiliated', name: 'X', hub: hubA }), item({ id: 'unaffiliated', name: 'Y', hub: null })];
  // "Alpha Hub" < "unaffiliated" alphabetically — affiliated sorts first here,
  // but the point is "unaffiliated" is present as a real group, not dropped.
  const asc = sortCommunityItems(items, 'source', 'asc');
  expect(asc.map((i) => i.id)).toContain('unaffiliated');
  expect(asc.map((i) => i.id)).toEqual(['affiliated', 'unaffiliated']);
});

test('sortCommunityItems: STABILITY — items sharing the IDENTICAL sort key preserve their ORIGINAL relative order (name/stars/updated single-key sorts)', () => {
  const items = [
    withStars('first', 'First', 100),
    withStars('second', 'Second', 100),
    withStars('third', 'Third', 100),
  ];
  expect(sortCommunityItems(items, 'stars', 'desc').map((i) => i.id)).toEqual(['first', 'second', 'third']);
  expect(sortCommunityItems(items, 'stars', 'asc').map((i) => i.id)).toEqual(['first', 'second', 'third']);

  const sameUpdated = [
    withFetchedAt('x', 'X', '2026-01-01T00:00:00.000Z'),
    withFetchedAt('y', 'Y', '2026-01-01T00:00:00.000Z'),
  ];
  expect(sortCommunityItems(sameUpdated, 'updated', 'asc').map((i) => i.id)).toEqual(['x', 'y']);
});

test('sortCommunityItems: an unrecognised sort key throws rather than silently falling back to an arbitrary order', () => {
  const items = [item({ id: 'a' })];
  expect(() => sortCommunityItems(items, 'bogus' as never, 'asc')).toThrow();
});

// ---------------------------------------------------------------------------
// freshnessBadge (W6-CR-2) — NEVER a date for a null fetchedAt.
// ---------------------------------------------------------------------------

const NOW = Date.parse('2026-08-15T00:00:00.000Z');

test('freshnessBadge(null, now) reads "seed — never verified" — the spec-literal phrase, never a fabricated date', () => {
  const badge = freshnessBadge(null, NOW);
  expect(badge.state).toBe('seed');
  expect(badge.label).toMatch(/seed — never verified/);
});

test('freshnessBadge: an unparsable fetchedAt degrades to the SAME seed treatment — an honest "don\'t know" beats a fabricated time', () => {
  const badge = freshnessBadge('not-a-real-date', NOW);
  expect(badge.state).toBe('seed');
  expect(badge.label).toMatch(/seed — never verified/);
});

test('freshnessBadge: a fetchedAt older than 30 days reads "stale"', () => {
  const thirtyOneDaysAgo = new Date(NOW - 31 * 24 * 60 * 60 * 1000).toISOString();
  const badge = freshnessBadge(thirtyOneDaysAgo, NOW);
  expect(badge.state).toBe('stale');
  expect(badge.label).toBe('stale');
});

test('freshnessBadge: a fetchedAt exactly at the 30-day boundary is NOT yet stale', () => {
  const exactlyThirtyDaysAgo = new Date(NOW - 30 * 24 * 60 * 60 * 1000).toISOString();
  const badge = freshnessBadge(exactlyThirtyDaysAgo, NOW);
  expect(badge.state).not.toBe('stale');
});

test('freshnessBadge: a recent fetchedAt (2 days ago) renders a relative time, never a raw date string', () => {
  const twoDaysAgo = new Date(NOW - 2 * 24 * 60 * 60 * 1000).toISOString();
  const badge = freshnessBadge(twoDaysAgo, NOW);
  expect(badge.state).toBe('fresh');
  expect(badge.label).toMatch(/2d ago/);
  expect(badge.label).not.toMatch(/\d{4}-\d{2}-\d{2}/); // never a raw ISO/date string
});

test('freshnessBadge: a fetchedAt just a few hours ago renders hours, not days', () => {
  const threeHoursAgo = new Date(NOW - 3 * 60 * 60 * 1000).toISOString();
  const badge = freshnessBadge(threeHoursAgo, NOW);
  expect(badge.state).toBe('fresh');
  expect(badge.label).toMatch(/3h ago/);
});

test('freshnessBadge: a fetchedAt in the future (clock skew) never renders a negative age', () => {
  const future = new Date(NOW + 60_000).toISOString();
  const badge = freshnessBadge(future, NOW);
  expect(badge.label).not.toMatch(/-/);
});

test('freshnessBadge: is wall-clock independent — the SAME fetchedAt + nowMs pair always produces the SAME badge (D7)', () => {
  const fetchedAt = '2026-08-10T00:00:00.000Z';
  expect(freshnessBadge(fetchedAt, NOW)).toEqual(freshnessBadge(fetchedAt, NOW));
});

// ---------------------------------------------------------------------------
// W7-B3 (community-05): search matches id + hub label + provenance/
// attributedTo + upstream — not just name/desc. The operator's natural query
// terms (the id in the URL, the hub names in the strip, the attribution on
// the card) all resolved to zero results.
// ---------------------------------------------------------------------------

test('filterCommunityItems: matches on id ("tdd" finds superpowers-tdd whose display name never says tdd)', () => {
  const items = [item({ id: 'superpowers-tdd', name: 'Test-Driven Development' }), item({ id: 'other', name: 'Other' })];
  expect(filterCommunityItems(items, 'TDD').map((i) => i.id)).toEqual(['superpowers-tdd']);
});

test('filterCommunityItems: matches on the hub label shown in the strip', () => {
  const items = [
    item({ id: 'a', hub: { id: 'superpowers', name: 'Superpowers', url: 'https://github.com/obra/superpowers', kinds: 'skills' } }),
    item({ id: 'b', hub: null }),
  ];
  expect(filterCommunityItems(items, 'superpowers').map((i) => i.id)).toEqual(['a']);
});

test('filterCommunityItems: matches on the signals attribution (provenance shown on the card)', () => {
  const items = [
    item({ id: 'a', signals: { stars: '1', attributedTo: 'obra/superpowers + Matt Pocock', starsNumeric: 1 } }),
    item({ id: 'b' }),
  ];
  expect(filterCommunityItems(items, 'obra').map((i) => i.id)).toEqual(['a']);
});

test('filterCommunityItems: matches on the upstream URL host', () => {
  const items = [item({ id: 'a', upstream: 'https://github.com/anthropics/skills' }), item({ id: 'b' })];
  expect(filterCommunityItems(items, 'anthropics').map((i) => i.id)).toEqual(['a']);
});

// ---------------------------------------------------------------------------
// W7-B3 (community-04): the sort control's label for the fetchedAt sort is
// "Last checked" — the fact it actually sorts on (when FORGE last verified
// the row), never the overloaded word "Updated" (which reads as upstream
// change time, a DIFFERENT claim rendered separately on the detail page).
// ---------------------------------------------------------------------------

test('COMMUNITY_SORT_LABELS names the fetchedAt sort "Last checked", never "Updated"', () => {
  expect(COMMUNITY_SORT_LABELS.updated).toBe('Last checked');
  for (const key of COMMUNITY_SORT_KEYS) {
    expect(typeof COMMUNITY_SORT_LABELS[key]).toBe('string');
    expect(COMMUNITY_SORT_LABELS[key].length).toBeGreaterThan(0);
  }
});

// ---------------------------------------------------------------------------
// W7-B3 (community-17): hub chips are FILTERS on the local index — pure
// predicate here; the chip's outbound URL stays a secondary affordance.
// ---------------------------------------------------------------------------

test('filterByHub(null) passes every item through as a NEW array', () => {
  const items = [item({ id: 'a' }), item({ id: 'b' })];
  const result = filterByHub(items, null);
  expect(result).toEqual(items);
  expect(result).not.toBe(items);
});

test('filterByHub keeps only items whose hub id matches', () => {
  const hub = { id: 'superpowers', name: 'Superpowers', url: 'https://github.com/obra/superpowers', kinds: 'skills' };
  const items = [item({ id: 'a', hub }), item({ id: 'b', hub: null })];
  expect(filterByHub(items, 'superpowers').map((i) => i.id)).toEqual(['a']);
  expect(filterByHub(items, 'nothing-indexed-hub')).toEqual([]);
});

// ---------------------------------------------------------------------------
// W7-B3 (community-16/community-03): the registry-level freshness line —
// meta.lastRefresh is the agent-commit stamp; null is the honest "no refresh
// has ever been committed", never a fabricated date.
// ---------------------------------------------------------------------------

test('lastRefreshLabel: null reads as never-refreshed, with no date in it', () => {
  const label = lastRefreshLabel(null, NOW);
  expect(label.toLowerCase()).toContain('never');
  expect(label).not.toMatch(/\d{4}-\d{2}-\d{2}/);
});

test('lastRefreshLabel: a real lastRefresh renders a relative age', () => {
  const twoHoursAgo = new Date(NOW - 2 * 60 * 60 * 1000).toISOString();
  expect(lastRefreshLabel(twoHoursAgo, NOW)).toMatch(/2h ago/);
});

test('lastRefreshLabel: an unparsable stamp degrades to the never-refreshed wording, not NaN', () => {
  const label = lastRefreshLabel('not-a-date', NOW);
  expect(label).not.toMatch(/NaN/);
  expect(label.toLowerCase()).toContain('never');
});

// ---------------------------------------------------------------------------
// W7-B3 (library-31): the fourth install state — present locally, unmanaged.
// Distinct label; never conflated with installed OR not-installed.
// ---------------------------------------------------------------------------

test('installStateLabel: present-unmanaged reads as locally-present-but-unmanaged, distinct from every other label', () => {
  const label = installStateLabel('present-unmanaged');
  expect(label.toLowerCase()).toContain('unmanaged');
  expect(label).not.toBe(installStateLabel('installed'));
  expect(label).not.toBe(installStateLabel('not-installed'));
});

// ---------------------------------------------------------------------------
// W7-B3 (community-09 / -18 / -19): the ONE install-action decision for the
// detail page — every item either installs, routes to its owning page, or
// says exactly why not (with the real upstream to browse). Pure, so the page
// can never re-derive it divergently.
// ---------------------------------------------------------------------------

test('installActionForItem: a non-vendored skill is a browse-upstream dead-end WITH the real URL (community-09)', () => {
  const action = installActionForItem({ kind: 'skill', id: 'handoff', vendored: false, installState: 'not-installed', upstream: 'https://github.com/obra/superpowers', installMethod: null });
  expect(action).toEqual({ action: 'browse-upstream', href: 'https://github.com/obra/superpowers' });
});

test('installActionForItem: present-unmanaged routes to the owning library page, never an Install button (library-31)', () => {
  const action = installActionForItem({ kind: 'skill', id: 'handoff', vendored: false, installState: 'present-unmanaged', upstream: 'https://x', installMethod: null });
  expect(action).toEqual({ action: 'present-unmanaged', href: '/skills/handoff' });
});

test('installActionForItem: an INSTALLED connection always links its own /connections page — system-provided included (community-18)', () => {
  const action = installActionForItem({ kind: 'tool', id: 'git', vendored: false, installState: 'installed', upstream: 'https://git-scm.com', installMethod: 'system-provided' });
  expect(action).toEqual({ action: 'open-owning', href: '/connections/git' });
});

test('installActionForItem: an npm connection not yet installed requires the CONFIRM flow, never a one-click spawn (community-19)', () => {
  const action = installActionForItem({ kind: 'mcp', id: 'github-mcp', vendored: false, installState: 'not-installed', upstream: 'https://x', installMethod: 'npm' });
  expect(action).toEqual({ action: 'install-confirm' });
});

test('installActionForItem: a vendored skill not yet installed installs directly (draft pipeline owns trust)', () => {
  const action = installActionForItem({ kind: 'skill', id: 'dependency-diff-review', vendored: true, installState: 'not-installed', upstream: 'https://x', installMethod: null });
  expect(action).toEqual({ action: 'install' });
});

test('installActionForItem: an installed vendored skill routes to its owning page', () => {
  const action = installActionForItem({ kind: 'skill', id: 'dependency-diff-review', vendored: true, installState: 'installed', upstream: 'https://x', installMethod: null });
  expect(action).toEqual({ action: 'open-owning', href: '/skills/dependency-diff-review' });
});

test('installActionForItem: an external-method connection says browse at the real upstream', () => {
  const action = installActionForItem({ kind: 'tool', id: 'gh', vendored: false, installState: 'not-installed', upstream: 'https://cli.github.com', installMethod: 'external' });
  expect(action).toEqual({ action: 'browse-upstream', href: 'https://cli.github.com' });
});

test('installActionForItem: a system-provided connection not present has nothing to install (honest absence)', () => {
  const action = installActionForItem({ kind: 'tool', id: 'docker', vendored: false, installState: 'not-installed', upstream: 'https://docker.com', installMethod: 'system-provided' });
  expect(action).toEqual({ action: 'none-system' });
});

// ---------------------------------------------------------------------------
// W7-B3 review F2 (community-16) — lastTerminalRefreshOf. The defect this
// pins against: /community fetched sessions with the DEFAULT activeOnly=true
// (?active=1 excludes every terminal row), so the "open-last-refresh-session"
// link was dead code — permanently null. The page now fetches
// fetchStudioSessions(false); this helper owns the selection.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// W8-B5b — freshness is DERIVED FROM THE REGISTRY, and the session-derived
// path is GONE. `lastTerminalRefreshOf`'s two tests used to live here.
//
// WHY THESE ASSERT THE SOURCE AND NOT THE STRING. Both derivations currently
// produce the SAME rendered words: this checkout's registry genuinely has
// `meta.lastRefresh: null` and every source row is genuinely `fetchedBy:
// seed`, so "never refreshed — every row is still the hand-curated seed" was
// already the honest answer — the old code just reached it for the wrong
// reason (no terminal session row existed). A test pinned to that sentence
// would have passed identically before and after the fix and proved nothing.
// So these pin WHERE the answer comes from.
// ---------------------------------------------------------------------------

const REGISTRY_DOC = yaml.load(
  readFileSync(resolve(__dirname, '..', '..', 'studio', 'community', 'registry.yaml'), 'utf8'),
) as { meta?: { lastRefresh?: string | null }; sources?: Record<string, { fetchedAt?: string | null; fetchedBy?: string }> };

test('registry-derived freshness: the registry-level line is a pure function of the REAL registry file\'s own meta.lastRefresh', () => {
  // The registry file is the source of truth, so this test reads it rather
  // than a fixture: `meta.lastRefresh` must be a key that EXISTS (an absent
  // key is a schema break, not a null), and whatever it holds is what the
  // label renders.
  expect(REGISTRY_DOC.meta, 'studio/community/registry.yaml must declare meta').toBeTruthy();
  expect('lastRefresh' in (REGISTRY_DOC.meta ?? {}), 'meta.lastRefresh must be PRESENT, even when null').toBe(true);

  const fromFile = REGISTRY_DOC.meta?.lastRefresh ?? null;
  const label = lastRefreshLabel(fromFile, NOW);
  if (fromFile === null) {
    expect(label).toMatch(/never refreshed/);
  } else {
    expect(label).toMatch(/last refreshed/);
    expect(label).not.toMatch(/never/);
  }
});

test('registry-derived freshness: per-source provenance also comes from the registry — every seed row reads seed, and a fetchedAt stamp is what moves it', () => {
  const sources = Object.values(REGISTRY_DOC.sources ?? {});
  expect(sources.length, 'the registry must declare at least one source row').toBeGreaterThan(0);
  for (const src of sources) {
    expect('fetchedAt' in src, 'every source row must carry fetchedAt as a PRESENT key').toBe(true);
    // The badge is a pure function of that field and nothing else — no
    // session, no run history, no wall-clock guess.
    const badge = freshnessBadge(src.fetchedAt ?? null, NOW);
    if ((src.fetchedAt ?? null) === null) expect(badge.state).toBe('seed');
  }
});

test('the SESSION-derived freshness path is GONE from the module, not merely unused', () => {
  const viewSource = readFileSync(resolve(__dirname, 'community-view.ts'), 'utf8');
  // A helper that selects a freshness answer out of session rows must not
  // exist here in any form — leaving it exported but uncalled is how a
  // deleted derivation comes back.
  expect(viewSource).not.toMatch(/export function lastTerminalRefreshOf/);
  expect(viewSource).not.toMatch(/terminal: boolean; sessionId: string/);
});

test('the /community page reads NO sessions index at all — one fact, one source', () => {
  const pageSource = readFileSync(resolve(__dirname, '..', 'app', 'community', 'page.tsx'), 'utf8');
  // This is the assertion that actually kills the defect class: the page may
  // not reach for the sessions index to answer a question the registry
  // already answers. An import is the whole capability, so the import is what
  // is pinned.
  expect(pageSource).not.toMatch(/fetchStudioSessions/);
  expect(pageSource).not.toMatch(/from '@\/lib\/studio-client'/);
  // POSITIVE CONTROL — this one assertion passed BEFORE this change too, and
  // that is deliberate: the two above are satisfiable by deleting the whole
  // freshness feature, so this pins that the registry-derived line survived
  // the deletion of the session-derived one. Verified against `git show
  // ae3cc433:` that the two `not.toMatch` assertions genuinely FAIL on the
  // pre-change source — they are regression catchers, not decoration.
  expect(pageSource).toMatch(/lastRefreshLabel\(meta\?\.lastRefresh/);
});

// ---------------------------------------------------------------------------
// W8-B5b — refreshOutcomeView. The pure derivation from a
// `postCommunityRefresh()` transport result to what the /community page's
// "Refresh registry" button renders. DOES NOT EXIST YET — the import above
// (`refreshOutcomeView`) is the expected RED until community-view.ts exports
// it.
// ---------------------------------------------------------------------------

const OK_COUNTS = { total: 5, refreshed: 2, unchanged: 3, noUpstream: 0, failed: 0 };

test('refreshOutcomeView: a clean 200 with no errors renders "refreshed", never "partial"', () => {
  const result: CommunityRefreshResult = {
    state: 'ok',
    wrote: true,
    dryRun: false,
    lastRefresh: '2026-08-24T10:00:00.000Z',
    counts: OK_COUNTS,
    outcomes: [],
    errors: [],
  };
  const view = refreshOutcomeView(result);
  expect(view.state).toBe('refreshed');
  expect(view.headline).toContain('2 updated');
  expect(view.headline).toContain('3 unchanged');
  expect(view.headline).not.toMatch(/partial/i);
  // RULE 3 — the stamp is rendered ONLY because the server actually sent one.
  expect(view.detail).toContain('2026-08-24T10:00:00.000Z');
});

test('refreshOutcomeView: a 200 with a non-empty "errors" array is a PARTIAL outcome, never rounded up to a clean refresh', () => {
  const result: CommunityRefreshResult = {
    state: 'ok',
    wrote: true,
    dryRun: false,
    lastRefresh: '2026-08-24T10:00:00.000Z',
    counts: { total: 4, refreshed: 1, unchanged: 1, noUpstream: 0, failed: 2 },
    outcomes: [],
    errors: [
      { source: 'github.com/obra/superpowers', kind: 'timeout', message: 'request timed out after 10000ms' },
      { source: 'github.com/example/thing', kind: 'not-found', message: '404' },
    ],
  };
  const view = refreshOutcomeView(result);
  expect(view.state).not.toBe('refreshed');
  expect(view.state).toBe('partial');
  expect(view.headline).toMatch(/partial/i);
  expect(view.headline).toContain('2 of 4');
  expect(view.detail).toContain('github.com/obra/superpowers: request timed out after 10000ms');
  expect(view.detail).toContain('github.com/example/thing: 404');
});

test('refreshOutcomeView: a 200 that verified nothing and wrote nothing renders an honest no-op, not a fabricated "refreshed"', () => {
  const result: CommunityRefreshResult = {
    state: 'ok',
    wrote: false,
    dryRun: false,
    lastRefresh: null,
    counts: { total: 0, refreshed: 0, unchanged: 0, noUpstream: 0, failed: 0 },
    outcomes: [],
    errors: [],
  };
  const view = refreshOutcomeView(result);
  expect(view.state).toBe('no-op');
  expect(view.headline).not.toMatch(/refreshed/i);
  // RULE 3 — no lastRefresh was sent, so none is fabricated.
  expect(view.detail).toBeNull();
});

test('refreshOutcomeView: the dry-bridge refusal renders as an honest, NAMED refusal that states the route it reached — never a generic error or a faked success', () => {
  const result: CommunityRefreshResult = {
    state: 'refused-dry-bridge',
    route: '/api/studio/community/refresh',
    method: 'POST',
    action: 'network',
  };
  const view = refreshOutcomeView(result);
  expect(view.state).toBe('refused-dry-bridge');
  expect(view.headline.toLowerCase()).toContain('suppressed');
  expect(view.headline).not.toMatch(/refreshed/i);
  expect(view.detail).toContain('POST /api/studio/community/refresh');
});

test('refreshOutcomeView: a typed server refusal surfaces the server\'s own reason and remedy verbatim, never a generic message', () => {
  const result: CommunityRefreshResult = {
    state: 'refused',
    status: 409,
    error: `GitHub rejected the credential currently in FORGE_GH_TOKEN.`,
    reason: 'invalid-token',
    remedy: 'Issue a fresh token with public-repository read access and re-export FORGE_GH_TOKEN, then re-run.',
  };
  const view = refreshOutcomeView(result);
  expect(view.state).toBe('refused');
  expect(view.headline).toBe(result.error);
  expect(view.detail).toBe(result.remedy);
});

test('refreshOutcomeView: a bare 500 server-error renders the server\'s own message with no fabricated remedy', () => {
  const result: CommunityRefreshResult = { state: 'server-error', status: 500, error: 'unexpected token in JSON' };
  const view = refreshOutcomeView(result);
  expect(view.state).toBe('server-error');
  expect(view.headline).toBe('unexpected token in JSON');
  expect(view.detail).toBeNull();
});

test('refreshOutcomeView: a transport error (bridge never reached) is distinguished from every refusal above', () => {
  const result: CommunityRefreshResult = { state: 'transport-error', error: 'bridge unreachable: TypeError: fetch failed' };
  const view = refreshOutcomeView(result);
  expect(view.state).toBe('transport-error');
  expect(view.headline.toLowerCase()).toContain('could not reach');
  expect(view.detail).toBe(result.error);
});
