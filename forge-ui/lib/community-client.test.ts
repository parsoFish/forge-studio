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
import { parseCommunityHub, parseCommunityHubWithCount, parseCommunityItem, parseCommunityIndexMeta, parseRegistryItemResponse } from './community-client.ts';

const WELL_FORMED_HUB = { id: 'mcp-servers', name: 'modelcontextprotocol/servers', url: 'https://github.com/modelcontextprotocol/servers', kinds: 'MCPs' };

const WELL_FORMED_SKILL_ITEM = {
  id: 'handoff',
  kind: 'skill',
  name: 'Handoff',
  desc: 'Compress the current session into a markdown transfer doc.',
  // W8-B5 (community-05 / exit row E11): a registry-sourced skill carries its
  // own real category over the wire.
  category: 'memory',
  upstream: 'https://github.com/obra/superpowers',
  hub: { id: 'superpowers', name: 'obra/superpowers', url: 'https://github.com/obra/superpowers', kinds: 'skills' },
  signals: { stars: '228k', attributedTo: 'obra/superpowers + Matt Pocock', starsNumeric: 228000 },
  vendored: false,
  installState: 'not-installed',
  probeState: null,
  origin: 'studio/catalog.yaml (community-skills)',
  fetchedAt: null,
  fetchedBy: 'seed',
  upstreamUpdatedAt: null,
};

const WELL_FORMED_TOOL_ITEM = {
  id: 'git',
  kind: 'tool',
  name: 'git',
  desc: 'Worktrees, branches, commits.',
  // A catalog connection has NO registry row, so it honestly carries null —
  // the key is still PRESENT (this module's absent-vs-explicit-null rule).
  category: null,
  upstream: 'https://git-scm.com/',
  hub: null,
  signals: null,
  vendored: false,
  installState: 'installed',
  probeState: 'available',
  origin: 'listConnections (studio/catalog.yaml tools:)',
  fetchedAt: null,
  fetchedBy: 'local',
  upstreamUpdatedAt: null,
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
  const item = { ...WELL_FORMED_SKILL_ITEM, signals: { stars: '5', attributedTo: 'someone', starsNumeric: 5 } };
  expect(parseCommunityItem(item).signals).toEqual({ stars: '5', attributedTo: 'someone', starsNumeric: 5 });
});

// ---------------------------------------------------------------------------
// W6-CR-2 — fetchedAt / fetchedBy / upstreamUpdatedAt / signals.starsNumeric
// ---------------------------------------------------------------------------

test('parseCommunityItem: throws when "fetchedAt" key is ABSENT — an explicit null is required, never fabricated from a missing key', () => {
  const { fetchedAt: _fetchedAt, ...rest } = WELL_FORMED_SKILL_ITEM;
  expect(() => parseCommunityItem(rest)).toThrow();
});

test('parseCommunityItem: throws when "upstreamUpdatedAt" key is ABSENT', () => {
  const { upstreamUpdatedAt: _upstreamUpdatedAt, ...rest } = WELL_FORMED_SKILL_ITEM;
  expect(() => parseCommunityItem(rest)).toThrow();
});

test('parseCommunityItem: throws when "fetchedBy" is missing — never defaulted to an empty string', () => {
  const { fetchedBy: _fetchedBy, ...rest } = WELL_FORMED_SKILL_ITEM;
  expect(() => parseCommunityItem(rest)).toThrow();
});

test('parseCommunityItem: throws when "fetchedAt" is present but not a string or null (e.g. a number)', () => {
  expect(() => parseCommunityItem({ ...WELL_FORMED_SKILL_ITEM, fetchedAt: 12345 })).toThrow();
});

test('parseCommunityItem: a real ISO fetchedAt round-trips', () => {
  const item = { ...WELL_FORMED_SKILL_ITEM, fetchedAt: '2026-08-01T00:00:00.000Z' };
  expect(parseCommunityItem(item).fetchedAt).toBe('2026-08-01T00:00:00.000Z');
});

test('parseCommunityItem: throws when "signals.starsNumeric" key is ABSENT', () => {
  const item = { ...WELL_FORMED_SKILL_ITEM, signals: { stars: '5', attributedTo: 'someone' } };
  expect(() => parseCommunityItem(item)).toThrow();
});

test('parseCommunityItem: throws when "signals.starsNumeric" is a string, not a number or null', () => {
  const item = { ...WELL_FORMED_SKILL_ITEM, signals: { stars: '5', attributedTo: 'someone', starsNumeric: '5' } };
  expect(() => parseCommunityItem(item)).toThrow();
});

test('parseCommunityItem: "signals.starsNumeric" of null round-trips (a display string naming a different unit)', () => {
  const item = { ...WELL_FORMED_SKILL_ITEM, signals: { stars: '156k installs', attributedTo: 'someone', starsNumeric: null } };
  expect(parseCommunityItem(item).signals?.starsNumeric).toBeNull();
});

test('parseCommunityItem: throws when "vendored" is not a boolean', () => {
  expect(() => parseCommunityItem({ ...WELL_FORMED_TOOL_ITEM, vendored: 'false' })).toThrow();
});

test('parseCommunityItem: a hub object with a missing field inside it throws (the nested parser is reused, not re-implemented)', () => {
  const item = { ...WELL_FORMED_SKILL_ITEM, hub: { id: 'x', name: 'X' /* missing url, kinds */ } };
  expect(() => parseCommunityItem(item)).toThrow();
});

// ---------------------------------------------------------------------------
// W7-B3 (community-16 / community-03): the registry-level meta block —
// refuse-don't-coerce like every other parser here.
// ---------------------------------------------------------------------------

test('parseCommunityIndexMeta: both nulls round-trip (fresh root / non-git root)', () => {
  expect(parseCommunityIndexMeta({ lastRefresh: null, registryDirty: null })).toEqual({ lastRefresh: null, registryDirty: null });
});

test('parseCommunityIndexMeta: real values round-trip', () => {
  expect(parseCommunityIndexMeta({ lastRefresh: '2026-08-19T10:00:00.000Z', registryDirty: true })).toEqual({
    lastRefresh: '2026-08-19T10:00:00.000Z',
    registryDirty: true,
  });
});

test('parseCommunityIndexMeta: throws on a missing meta object or coerced-looking shapes', () => {
  expect(() => parseCommunityIndexMeta(undefined)).toThrow();
  expect(() => parseCommunityIndexMeta({ lastRefresh: 12345, registryDirty: null })).toThrow();
  expect(() => parseCommunityIndexMeta({ lastRefresh: null, registryDirty: 'clean' })).toThrow();
});

// ---------------------------------------------------------------------------
// W7-B3 review F6 — parseRegistryItemResponse (fetchRegistryItem's parse
// step). The defect: this parse used to run INLINE after `res.ok` with no
// guard, so a malformed 200 body (proxy HTML, field rename) rejected
// UNHANDLED and stranded the edit form at data-page-ready="false" forever.
// The contract now: the parse THROWS on any unexpected shape (same
// refuse-don't-coerce rule as every parser above), and fetchRegistryItem —
// its one caller — catches and returns ok:false like every sibling.
// ---------------------------------------------------------------------------

const WELL_FORMED_REGISTRY_ROW = {
  item: {
    id: 'handoff',
    kind: 'skill',
    name: 'Handoff',
    desc: 'Compress the current session.',
    category: 'memory',
    sourceUrl: 'https://github.com/obra/superpowers',
    provenance: 'obra/superpowers',
    tier: 'sonnet',
    signals: { stars: 4200, starsDisplay: '4.2k', attributedTo: 'obra' },
    upstreamUpdatedAt: '2026-08-01',
  },
};

test('parseRegistryItemResponse: a well-formed registry row round-trips (ok:true, fields intact)', () => {
  const r = parseRegistryItemResponse(WELL_FORMED_REGISTRY_ROW);
  expect(r.ok).toBe(true);
  expect(r.item.id).toBe('handoff');
  expect(r.item.signals?.stars).toBe(4200);
  expect(r.item.upstreamUpdatedAt).toBe('2026-08-01');
});

test('parseRegistryItemResponse: THROWS on a body with no "item" object — never a fabricated empty form prefill', () => {
  expect(() => parseRegistryItemResponse({ ok: true })).toThrow();
  expect(() => parseRegistryItemResponse('<!doctype html>')).toThrow();
  expect(() => parseRegistryItemResponse(null)).toThrow();
});

test('parseRegistryItemResponse: THROWS when a required string field is missing (e.g. sourceUrl) — never defaulted', () => {
  const { sourceUrl: _dropped, ...rest } = WELL_FORMED_REGISTRY_ROW.item;
  expect(() => parseRegistryItemResponse({ item: rest })).toThrow();
});
