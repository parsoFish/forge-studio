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
 */
import { test, expect } from 'vitest';
import { filterByKind, filterCommunityItems, installStateLabel, signalsLabel, hubLabel } from './community-view.ts';
import type { CommunityItem, CommunityHub } from './community-client.ts';

function item(overrides: Partial<CommunityItem> = {}): CommunityItem {
  return {
    id: 'x',
    kind: 'tool',
    name: 'X',
    desc: 'An x thing.',
    upstream: 'https://example.com/x',
    hub: null,
    signals: null,
    vendored: false,
    installState: 'not-installed',
    probeState: null,
    origin: 'test',
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
  const label = signalsLabel({ stars: '228k', attributedTo: 'obra/superpowers + Matt Pocock' });
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
