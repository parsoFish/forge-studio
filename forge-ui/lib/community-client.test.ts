/**
 * Tests for forge-ui/lib/community-client.ts (R3-07-F1/F2/F3) — DOES NOT
 * EXIST YET. Vitest cannot even collect this file until it lands
 * (module-not-found is the expected red, mirroring connection-client.test.ts's
 * own header note).
 *
 * community-client.ts mirrors connection-client.ts's / hook-client.ts's role
 * — client-side fetch + parse helpers for the `/api/studio/community*`
 * bridge routes (see cli/bridge-studio-community.ts's own header for the
 * transport shapes).
 *
 * Tests ONLY the pure parse functions — no fetch, no window, no jsdom (this
 * repo's forge-ui vitest config is `environment: 'node'`, a standing
 * decision — `resolveBridgeUrl()` requires `window`; the over-the-wire
 * behaviour is pinned by cli/bridge-studio-community.test.ts instead).
 *
 * Every parser below must REFUSE (throw) on a malformed payload rather than
 * coerce it — this campaign's recurring `Array.isArray(x) ? x : []` /
 * `?? []` / `?? null` fabrication defect, forbidden explicitly in the T3
 * task brief for this module. `hub`/`signals`/`probeState` are all
 * legitimately NULLABLE fields on `CommunityItem` — but the KEY must still
 * be PRESENT (explicit `null`) in the payload; an ABSENT key is a malformed
 * response, never silently treated the same as an explicit null.
 */
import { test, expect } from 'vitest';
import { parseCommunityHub, parseCommunityHubWithCount, parseCommunityItem } from './community-client.ts';

const WELL_FORMED_HUB = { id: 'mcp-servers', name: 'modelcontextprotocol/servers', url: 'https://github.com/modelcontextprotocol/servers', kinds: 'MCPs' };

const WELL_FORMED_SKILL_ITEM = {
  id: 'handoff',
  kind: 'skill',
  name: 'Handoff',
  desc: 'Compress the current session into a markdown transfer doc.',
  upstream: 'https://github.com/obra/superpowers',
  hub: { id: 'superpowers', name: 'obra/superpowers', url: 'https://github.com/obra/superpowers', kinds: 'skills' },
  signals: { stars: '228k', attributedTo: 'obra/superpowers + Matt Pocock' },
  vendored: false,
  installState: 'not-installed',
  probeState: null,
  origin: 'studio/catalog.yaml (community-skills)',
};

const WELL_FORMED_TOOL_ITEM = {
  id: 'git',
  kind: 'tool',
  name: 'git',
  desc: 'Worktrees, branches, commits.',
  upstream: 'https://git-scm.com/',
  hub: null,
  signals: null,
  vendored: false,
  installState: 'installed',
  probeState: 'available',
  origin: 'listConnections (studio/catalog.yaml tools:)',
};

// ---------------------------------------------------------------------------
// parseCommunityHub / parseCommunityHubWithCount
// ---------------------------------------------------------------------------

test('parseCommunityHub: a well-formed hub round-trips exactly', () => {
  expect(parseCommunityHub(WELL_FORMED_HUB)).toEqual(WELL_FORMED_HUB);
});

test('parseCommunityHub: throws on a missing required field (url)', () => {
  const { url: _url, ...rest } = WELL_FORMED_HUB;
  expect(() => parseCommunityHub(rest)).toThrow();
});

test('parseCommunityHub: throws when "kinds" is not a string (never coerced from an array)', () => {
  expect(() => parseCommunityHub({ ...WELL_FORMED_HUB, kinds: ['skills', 'hooks'] })).toThrow();
});

test('parseCommunityHubWithCount: a well-formed hub-with-count round-trips exactly, including itemCount: 0 (the honest zero is not falsy-coerced away)', () => {
  const withZero = { ...WELL_FORMED_HUB, itemCount: 0 };
  expect(parseCommunityHubWithCount(withZero)).toEqual(withZero);
});

test('parseCommunityHubWithCount: throws when itemCount is missing — never defaulted to 0', () => {
  expect(() => parseCommunityHubWithCount(WELL_FORMED_HUB)).toThrow();
});

test('parseCommunityHubWithCount: throws when itemCount is a string (e.g. "3") — never coerced to a number', () => {
  expect(() => parseCommunityHubWithCount({ ...WELL_FORMED_HUB, itemCount: '3' })).toThrow();
});

// ---------------------------------------------------------------------------
// parseCommunityItem — the core cross-kind projection
// ---------------------------------------------------------------------------

test('parseCommunityItem: a well-formed skill item (with hub + signals) round-trips exactly', () => {
  expect(parseCommunityItem(WELL_FORMED_SKILL_ITEM)).toEqual(WELL_FORMED_SKILL_ITEM);
});

test('parseCommunityItem: a well-formed tool item (hub:null, signals:null, probeState:"available") round-trips exactly', () => {
  expect(parseCommunityItem(WELL_FORMED_TOOL_ITEM)).toEqual(WELL_FORMED_TOOL_ITEM);
});

test('parseCommunityItem: throws when "hub" key is ABSENT — an explicit null is required, never fabricated from a missing key', () => {
  const { hub: _hub, ...rest } = WELL_FORMED_TOOL_ITEM;
  expect(() => parseCommunityItem(rest)).toThrow();
});

test('parseCommunityItem: throws when "signals" key is ABSENT — same rule as hub', () => {
  const { signals: _signals, ...rest } = WELL_FORMED_TOOL_ITEM;
  expect(() => parseCommunityItem(rest)).toThrow();
});

test('parseCommunityItem: throws when "probeState" key is ABSENT', () => {
  const { probeState: _probeState, ...rest } = WELL_FORMED_TOOL_ITEM;
  expect(() => parseCommunityItem(rest)).toThrow();
});

test('parseCommunityItem: throws when "desc" is missing — never defaulted to an empty string', () => {
  const { desc: _desc, ...rest } = WELL_FORMED_SKILL_ITEM;
  expect(() => parseCommunityItem(rest)).toThrow();
});

test('parseCommunityItem: throws on an unrecognised "kind" — never silently coerced to a guessed kind', () => {
  expect(() => parseCommunityItem({ ...WELL_FORMED_TOOL_ITEM, kind: 'cli' })).toThrow();
});

test('parseCommunityItem: throws on an unrecognised "installState" — never silently coerced to "not-installed"', () => {
  expect(() => parseCommunityItem({ ...WELL_FORMED_TOOL_ITEM, installState: 'sort-of-installed' })).toThrow();
});

test('parseCommunityItem: "signals.stars" is never the empty string or "0" — a malformed signals object with an empty stars string still parses (the SERVER is responsible for never emitting one; D5\'s "never a zero" is a server-side AT, not a client parse-time rejection) but this file records the contract expectation', () => {
  // This is a documentation-only assertion: the client is not the enforcement
  // point for D5 (orchestrator/studio/community-index.test.ts owns that AT);
  // this test only proves the well-formed fixture the rest of this file
  // relies on is not itself an accidental zero/empty-string case.
  expect(WELL_FORMED_SKILL_ITEM.signals?.stars).not.toBe('0');
  expect(WELL_FORMED_SKILL_ITEM.signals?.stars).not.toBe('');
});

test('parseCommunityItem: signals present with a non-empty stars string and a non-empty attributedTo round-trips', () => {
  const item = { ...WELL_FORMED_SKILL_ITEM, signals: { stars: '5', attributedTo: 'someone' } };
  expect(parseCommunityItem(item).signals).toEqual({ stars: '5', attributedTo: 'someone' });
});

test('parseCommunityItem: throws when "vendored" is not a boolean', () => {
  expect(() => parseCommunityItem({ ...WELL_FORMED_TOOL_ITEM, vendored: 'false' })).toThrow();
});

test('parseCommunityItem: a hub object with a missing field inside it throws (the nested parser is reused, not re-implemented)', () => {
  const item = { ...WELL_FORMED_SKILL_ITEM, hub: { id: 'x', name: 'X' /* missing url, kinds */ } };
  expect(() => parseCommunityItem(item)).toThrow();
});
