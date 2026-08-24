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
import {
  parseCommunityHub,
  parseCommunityHubWithCount,
  parseCommunityItem,
  parseCommunityIndexMeta,
  parseRegistryItemResponse,
  parseCommunityRefreshResponse,
} from './community-client.ts';

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

// ---------------------------------------------------------------------------
// W8-B5b — parseCommunityRefreshResponse (postCommunityRefresh's parse step,
// cli/bridge-studio-community.ts's `POST /api/studio/community/refresh`).
// DOES NOT EXIST YET — the import above is the expected RED until
// community-client.ts exports it. Same refuse-don't-coerce discipline as
// every parser in this file: a malformed shape THROWS.
// ---------------------------------------------------------------------------

const WELL_FORMED_REFRESH_OK = {
  wrote: true,
  dryRun: false,
  lastRefresh: '2026-08-24T10:00:00.000Z',
  counts: { total: 2, refreshed: 1, unchanged: 1, noUpstream: 0, failed: 0 },
  outcomes: [
    { id: 'handoff', source: 'github.com/obra/superpowers', status: 'refreshed', detail: 'stars 228000 -> 229000' },
    { id: 'dependency-diff-review', source: 'github.com/obra/superpowers', status: 'unchanged', detail: 'no change' },
  ],
  errors: [],
};

test('parseCommunityRefreshResponse: a well-formed 200 body round-trips to state:"ok" with every field intact, including an empty "errors" array', () => {
  const r = parseCommunityRefreshResponse(200, WELL_FORMED_REFRESH_OK);
  expect(r).toEqual({ state: 'ok', ...WELL_FORMED_REFRESH_OK });
});

test('parseCommunityRefreshResponse: a 200 with a non-empty "errors" array still parses as state:"ok" — refreshOutcomeView, not the parser, decides "partial"', () => {
  const withErrors = { ...WELL_FORMED_REFRESH_OK, errors: [{ source: 'github.com/x/y', kind: 'timeout', message: 'timed out' }] };
  const r = parseCommunityRefreshResponse(200, withErrors);
  expect(r.state).toBe('ok');
  expect(r.state === 'ok' && r.errors).toEqual(withErrors.errors);
});

test('parseCommunityRefreshResponse: THROWS on a 200 body missing "counts" — never defaulted to a fabricated tally', () => {
  const { counts: _dropped, ...rest } = WELL_FORMED_REFRESH_OK;
  expect(() => parseCommunityRefreshResponse(200, rest)).toThrow();
});

test('parseCommunityRefreshResponse: THROWS on a 200 body whose "outcomes" is not an array — never coerced from `?? []`', () => {
  expect(() => parseCommunityRefreshResponse(200, { ...WELL_FORMED_REFRESH_OK, outcomes: null })).toThrow();
});

test('parseCommunityRefreshResponse: THROWS on a 200 body with an unrecognised outcome status', () => {
  const bad = { ...WELL_FORMED_REFRESH_OK, outcomes: [{ id: 'x', source: null, status: 'bogus-status', detail: 'x' }] };
  expect(() => parseCommunityRefreshResponse(200, bad)).toThrow();
});

test('parseCommunityRefreshResponse: the 409 dry-bridge refusal parses to state:"refused-dry-bridge", surfacing the route the server echoed back', () => {
  const r = parseCommunityRefreshResponse(409, {
    error: 'dry-bridge',
    route: '/api/studio/community/refresh',
    method: 'POST',
    action: 'network',
  });
  expect(r).toEqual({ state: 'refused-dry-bridge', route: '/api/studio/community/refresh', method: 'POST', action: 'network' });
});

test('parseCommunityRefreshResponse: a TYPED refusal (reason+remedy) parses to state:"refused" — distinguished from dry-bridge by the "reason" key, not by the shared 409 status', () => {
  const r = parseCommunityRefreshResponse(409, {
    error: 'GitHub rejected the credential currently in FORGE_GH_TOKEN.',
    reason: 'invalid-token',
    remedy: 'Issue a fresh token and re-export FORGE_GH_TOKEN, then re-run.',
    wrote: false,
  });
  expect(r).toEqual({
    state: 'refused',
    status: 409,
    error: 'GitHub rejected the credential currently in FORGE_GH_TOKEN.',
    reason: 'invalid-token',
    remedy: 'Issue a fresh token and re-export FORGE_GH_TOKEN, then re-run.',
  });
});

test('parseCommunityRefreshResponse: a TYPED refusal carrying optional counts/outcomes/errors (all-sources-failed) carries them through', () => {
  const r = parseCommunityRefreshResponse(502, {
    error: 'no source produced a verified answer, so nothing was written',
    reason: 'all-sources-failed',
    remedy: 'Re-run once the upstreams answer.',
    wrote: false,
    counts: { total: 1, refreshed: 0, unchanged: 0, noUpstream: 0, failed: 1 },
    outcomes: [{ id: 'x', source: 'github.com/x/y', status: 'failed', detail: 'timeout' }],
    errors: [{ source: 'github.com/x/y', kind: 'timeout', message: 'timed out' }],
  });
  expect(r.state).toBe('refused');
  expect(r.state === 'refused' && r.counts).toEqual({ total: 1, refreshed: 0, unchanged: 0, noUpstream: 0, failed: 1 });
});

test('parseCommunityRefreshResponse: THROWS on a typed refusal carrying an unrecognised "reason" — never silently accepted as a plausible string', () => {
  expect(() =>
    parseCommunityRefreshResponse(409, { error: 'x', reason: 'some-new-reason-nobody-taught-the-client', remedy: 'y', wrote: false }),
  ).toThrow();
});

test('parseCommunityRefreshResponse: the bare 500 catch-all ({error} only, no "reason") parses to state:"server-error", never mistaken for a typed refusal', () => {
  const r = parseCommunityRefreshResponse(500, { error: 'unexpected token in JSON' });
  expect(r).toEqual({ state: 'server-error', status: 500, error: 'unexpected token in JSON' });
});

test('parseCommunityRefreshResponse: THROWS on a malformed payload — not an object, or missing the required "error" string on a refusal — REFUSED, never coerced', () => {
  expect(() => parseCommunityRefreshResponse(500, null)).toThrow();
  expect(() => parseCommunityRefreshResponse(500, '<!doctype html>')).toThrow();
  expect(() => parseCommunityRefreshResponse(500, {})).toThrow();
  expect(() => parseCommunityRefreshResponse(200, { wrote: 'yes', dryRun: false, lastRefresh: null, counts: WELL_FORMED_REFRESH_OK.counts, outcomes: [], errors: [] })).toThrow();
});

// ---------------------------------------------------------------------------
// W8-B5b hostile-review FINDING 3 — a parser type-check with no test that it
// fires. The reviewer mutated `parseCommunityRefreshOutcome`'s "source" field
// from a validating `parseNullableField(... typeof v !== 'string' -> throw)`
// to a bare `(r['source'] as string) ?? null` coercion — the exact
// "coerce instead of refuse" shape this file's own header bans — and ALL
// pre-existing tests still passed, because nothing ever gave `outcome.source`
// a non-string, non-null value.
//
// Below is ONE dedicated test per explicit type-check in the community-refresh
// parsing section (parseCommunityRefreshCounts through
// parseCommunityRefreshResponse) that was not already covered by an existing
// test above. Each gives THAT field a wrong-typed (or, for an enum, an
// unrecognised) value and asserts the parse REFUSES. Already-covered sites
// (not duplicated here): the "outcomes" array check, the outcome "status"
// enum, the top-level "wrote" boolean, and the refusal "reason" enum — all
// four already have a dedicated throw-test above this block.
//
// See this campaign's `scripts/w8b5b-scratch-mutation-proof.sh` (run
// separately, output in the session report) for proof that at least three of
// these NEW tests actually fail against a coerced implementation — the same
// check the reviewer applied to find this gap in the first place.
// ---------------------------------------------------------------------------

// --- parseCommunityRefreshCounts: 5 requireNumber call sites -----------------

for (const field of ['total', 'refreshed', 'unchanged', 'noUpstream', 'failed'] as const) {
  test(`parseCommunityRefreshResponse: THROWS when counts.${field} is not a number (e.g. a string) — never coerced`, () => {
    const bad = { ...WELL_FORMED_REFRESH_OK, counts: { ...WELL_FORMED_REFRESH_OK.counts, [field]: 'not-a-number' } };
    expect(() => parseCommunityRefreshResponse(200, bad)).toThrow();
  });
}

// --- top-level "dryRun" requireBoolean ---------------------------------------

test('parseCommunityRefreshResponse: THROWS when "dryRun" is not a boolean (e.g. a string) — never coerced', () => {
  expect(() => parseCommunityRefreshResponse(200, { ...WELL_FORMED_REFRESH_OK, dryRun: 'false' })).toThrow();
});

// --- top-level "lastRefresh" inline typeof check (nullable field) -----------

test('parseCommunityRefreshResponse: THROWS when "lastRefresh" is present but not a string or null (e.g. a number) — never coerced', () => {
  expect(() => parseCommunityRefreshResponse(200, { ...WELL_FORMED_REFRESH_OK, lastRefresh: 12345 })).toThrow();
});

// --- parseCommunityRefreshOutcome: id / source / detail ----------------------

test('parseCommunityRefreshResponse: THROWS when an outcome\'s "id" is not a string', () => {
  const bad = { ...WELL_FORMED_REFRESH_OK, outcomes: [{ id: 42, source: null, status: 'refreshed', detail: 'x' }] };
  expect(() => parseCommunityRefreshResponse(200, bad)).toThrow();
});

test('parseCommunityRefreshResponse: THROWS when an outcome\'s "source" is present but not a string or null (e.g. a number) — the EXACT field the reviewer\'s coerce-instead-of-refuse mutation targeted', () => {
  const bad = { ...WELL_FORMED_REFRESH_OK, outcomes: [{ id: 'x', source: 42, status: 'refreshed', detail: 'x' }] };
  expect(() => parseCommunityRefreshResponse(200, bad)).toThrow();
});

test('parseCommunityRefreshResponse: THROWS when an outcome\'s "detail" is not a string', () => {
  const bad = { ...WELL_FORMED_REFRESH_OK, outcomes: [{ id: 'x', source: null, status: 'refreshed', detail: 42 }] };
  expect(() => parseCommunityRefreshResponse(200, bad)).toThrow();
});

// --- parseCommunityRefreshFailures: the "errors" array check ----------------

test('parseCommunityRefreshResponse: THROWS when "errors" is not an array — never coerced from `?? []`', () => {
  expect(() => parseCommunityRefreshResponse(200, { ...WELL_FORMED_REFRESH_OK, errors: null })).toThrow();
});

// --- parseCommunityRefreshFailure: source / kind / message -------------------

test('parseCommunityRefreshResponse: THROWS when an error entry\'s "source" is not a string', () => {
  const bad = { ...WELL_FORMED_REFRESH_OK, errors: [{ source: 42, kind: 'timeout', message: 'x' }] };
  expect(() => parseCommunityRefreshResponse(200, bad)).toThrow();
});

test('parseCommunityRefreshResponse: THROWS on an error entry with an unrecognised "kind" — the enum-membership check', () => {
  const bad = { ...WELL_FORMED_REFRESH_OK, errors: [{ source: 'x', kind: 'made-up-kind', message: 'x' }] };
  expect(() => parseCommunityRefreshResponse(200, bad)).toThrow();
});

test('parseCommunityRefreshResponse: THROWS when an error entry\'s "message" is not a string', () => {
  const bad = { ...WELL_FORMED_REFRESH_OK, errors: [{ source: 'x', kind: 'timeout', message: 42 }] };
  expect(() => parseCommunityRefreshResponse(200, bad)).toThrow();
});

// --- refusal-path requireString sites: error / route / method / action / remedy

test('parseCommunityRefreshResponse: THROWS when the top-level "error" field is present but not a string (e.g. a number)', () => {
  expect(() => parseCommunityRefreshResponse(500, { error: 12345 })).toThrow();
});

test('parseCommunityRefreshResponse: THROWS on a dry-bridge refusal whose "route" is not a string', () => {
  expect(() => parseCommunityRefreshResponse(409, { error: 'dry-bridge', route: 42, method: 'POST', action: 'network' })).toThrow();
});

test('parseCommunityRefreshResponse: THROWS on a dry-bridge refusal whose "method" is not a string', () => {
  expect(() => parseCommunityRefreshResponse(409, { error: 'dry-bridge', route: '/x', method: 42, action: 'network' })).toThrow();
});

test('parseCommunityRefreshResponse: THROWS on a dry-bridge refusal whose "action" is not a string', () => {
  expect(() => parseCommunityRefreshResponse(409, { error: 'dry-bridge', route: '/x', method: 'POST', action: 42 })).toThrow();
});

test('parseCommunityRefreshResponse: THROWS on a typed refusal whose "remedy" is not a string', () => {
  expect(() => parseCommunityRefreshResponse(409, { error: 'x', reason: 'invalid-token', remedy: 42, wrote: false })).toThrow();
});
