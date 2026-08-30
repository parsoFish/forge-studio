/**
 * W8-B5 / WI-6 — the three PURE `/community` defects (exit rows E11, E14, E16).
 *
 * Kept in its own file rather than appended to community-view.test.ts: that
 * file is part of this lane's PINNED test world (`_wave8/gate-manifests/B5.txt`)
 * and is restored from the pin when the lane is judged, so new coverage
 * written by an implementation worker belongs in a NEW file.
 *
 * ---------------------------------------------------------------------------
 * E11 — community search does not match `category`, and CANNOT.
 * ---------------------------------------------------------------------------
 * `filterCommunityItems` searched name/desc/id/hubLabel/attributedTo/upstream.
 * `category` was absent from the client type AND from the server's wire
 * projection, so "planning" — the word an operator actually types, and the
 * word the registry itself files rows under — returned nothing. Fixing the
 * search term alone would have been a no-op: the field had to reach the
 * client first. Registry-sourced rows carry a real category; a vendored
 * package or a catalog connection genuinely has none and carries `null` —
 * never an invented string, and never an empty-string stand-in that would
 * make `''` a matching query.
 *
 * ---------------------------------------------------------------------------
 * E14 — a declared-only hub falls back to the generic empty state.
 * ---------------------------------------------------------------------------
 * The hub chip already computed the state (`data-hub-declared-only`, plus a
 * specific tooltip); the empty block never read it and collapsed to
 * "Nothing matches this filter." — a value parsed and surfaced but enforced
 * nowhere, this campaign's dominant defect shape. The cure derives the state
 * from the SELECTED HUB'S OWN `itemCount` through the same
 * `isHubDeclaredOnly` predicate the chip uses, so no second copy of the flag
 * exists to go stale.
 *
 * ---------------------------------------------------------------------------
 * E16 — a NOT-installed mcp/tool row has no link to its connection page.
 * ---------------------------------------------------------------------------
 * `installActionForItem` returned `open-owning` only when
 * `installState !== 'not-installed'`; its own comment records that the
 * earlier fix targeted the INSTALLED case. A not-installed connection still
 * has a real `/connections/<id>` page (config vars, probe, how to connect
 * it) and must be reachable from the community row — IN ADDITION to whatever
 * install action the row already offers, never instead of it. The test below
 * enumerates EVERY installState x installMethod x kind x vendored
 * combination rather than only the one that was broken.
 */
import { test, expect } from 'vitest';
import {
  filterCommunityItems,
  installActionForItem,
  connectionPageLinkFor,
  isHubDeclaredOnly,
  communityEmptyState,
  COMMUNITY_EMPTY_STATES,
} from './community-view.ts';
import {
  COMMUNITY_KINDS,
  COMMUNITY_INSTALL_STATES,
  parseCommunityItem,
  type CommunityItem,
  type CommunityHubWithCount,
} from './community-client.ts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function item(overrides: Partial<CommunityItem> = {}): CommunityItem {
  return {
    id: 'x',
    kind: 'tool',
    name: 'X',
    desc: 'An x thing.',
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

function hub(overrides: Partial<CommunityHubWithCount> = {}): CommunityHubWithCount {
  return {
    id: 'skills-sh',
    name: 'skills.sh',
    url: 'https://skills.sh',
    kinds: 'skills',
    itemCount: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// E11 — search matches category
// ---------------------------------------------------------------------------

test('filterCommunityItems matches on category — the word the registry files rows under', () => {
  const items = [
    item({ id: 'a', name: 'Handoff', desc: 'compress a session', category: 'memory' }),
    item({ id: 'b', name: 'Systematic debugging', desc: 'find the bug', category: 'review' }),
  ];
  expect(filterCommunityItems(items, 'memory').map((i) => i.id)).toEqual(['a']);
  expect(filterCommunityItems(items, 'review').map((i) => i.id)).toEqual(['b']);
});

test('filterCommunityItems matches category case-insensitively, like every other search term', () => {
  const items = [item({ id: 'a', category: 'Planning' })];
  expect(filterCommunityItems(items, 'planning').map((i) => i.id)).toEqual(['a']);
  expect(filterCommunityItems(items, 'PLAN').map((i) => i.id)).toEqual(['a']);
});

test('an item with category:null is simply not matched by a category query — never a crash, never a false hit', () => {
  const items = [item({ id: 'a', category: null }), item({ id: 'b', category: 'planning' })];
  expect(filterCommunityItems(items, 'planning').map((i) => i.id)).toEqual(['b']);
});

test('a category:null item is still returned by an empty query — the null never filters it out of the index', () => {
  const items = [item({ id: 'a', category: null })];
  expect(filterCommunityItems(items, '').map((i) => i.id)).toEqual(['a']);
});

test('the category term does not widen any OTHER term: a query matching nothing still returns nothing', () => {
  const items = [item({ id: 'a', name: 'Handoff', desc: 'x', category: 'memory', upstream: 'https://example.com/x' })];
  expect(filterCommunityItems(items, 'zzzz-no-such-term')).toEqual([]);
});

test('parseCommunityItem REFUSES a payload whose "category" key is ABSENT — the same absent-vs-explicit-null rule hub/signals/probeState hold', () => {
  const wellFormed = {
    id: 'x', kind: 'tool', name: 'X', desc: 'd', category: null, upstream: 'https://example.com/x',
    hub: null, signals: null, vendored: false, installState: 'not-installed', probeState: 'available',
    origin: 'test', fetchedAt: null, fetchedBy: 'local', upstreamUpdatedAt: null,
  };
  expect(parseCommunityItem(wellFormed).category).toBeNull();
  const { category: _c, ...withoutCategory } = wellFormed;
  expect(() => parseCommunityItem(withoutCategory)).toThrow();
  expect(() => parseCommunityItem({ ...wellFormed, category: 7 })).toThrow();
  expect(parseCommunityItem({ ...wellFormed, category: 'memory' }).category).toBe('memory');
});

// The SERVER half of E11. Without it the field reaches the client for nobody,
// and every test above passes against a wire projection that never sends it —
// which is exactly the state this defect was found in. `tsc` would catch a
// missing key on the wire TYPE, but not a builder arm that quietly omits it,
// and `toWireItemSafe`'s degraded arm is the one an item's derivation failure
// actually goes through.
test('E11 (server): CommunityItemWire declares category, and BOTH wire builders populate it', () => {
  const src = readFileSync(resolve(__dirname, '../../cli/bridge-studio-community.ts'), 'utf8');
  const wireType = src.slice(src.indexOf('type CommunityItemWire = {'), src.indexOf('type WireCtx'));
  expect(wireType).toMatch(/category:\s*string \| null;/);
  // toWireItem — the real projection, sourced from the registry row itself.
  const toWireItem = src.slice(src.indexOf('function toWireItem('), src.indexOf('function toWireItemSafe('));
  expect(toWireItem).toMatch(/category:\s*categoryFor\(item, ctx\)/);
  // toWireItemSafe — the degraded arm. It must still send the KEY (an absent
  // key is a malformed response to the client's parser, which would turn one
  // item's failure into a whole-list parse throw).
  const safe = src.slice(src.indexOf('function toWireItemSafe('));
  const safeBody = safe.slice(0, safe.indexOf('\n}\n'));
  expect(safeBody).toMatch(/category:\s*null/);
  // …and it is read from the registry row, never derived or guessed.
  expect(src).toMatch(/function categoryFor\([\s\S]{0,400}ctx\.communitySkills\.find/);
});

// ---------------------------------------------------------------------------
// E14 — the declared-only empty state
// ---------------------------------------------------------------------------

test('COMMUNITY_EMPTY_STATES enumerates exactly the three distinct empty states', () => {
  expect([...COMMUNITY_EMPTY_STATES]).toEqual(['empty-index', 'no-match', 'hub-declared-only']);
});

test('isHubDeclaredOnly is TRUE for a real hub with a genuine zero item count', () => {
  expect(isHubDeclaredOnly(hub({ itemCount: 0 }))).toBe(true);
});

test('isHubDeclaredOnly is FALSE as soon as the hub indexes anything', () => {
  expect(isHubDeclaredOnly(hub({ itemCount: 1 }))).toBe(false);
});

test('no filters at all and no items ⇒ the honest empty-index state', () => {
  const state = communityEmptyState({ hubs: [], hubFilter: null, kind: 'all', query: '' });
  expect(state.state).toBe('empty-index');
  expect(state.message).toContain('empty');
});

test('a kind filter that matches nothing ⇒ the generic no-match state', () => {
  const state = communityEmptyState({ hubs: [hub({ itemCount: 3 })], hubFilter: null, kind: 'hook', query: '' });
  expect(state.state).toBe('no-match');
});

test('a search that matches nothing ⇒ the generic no-match state', () => {
  const state = communityEmptyState({ hubs: [hub({ itemCount: 3 })], hubFilter: null, kind: 'all', query: 'zzz' });
  expect(state.state).toBe('no-match');
});

test('selecting a DECLARED-ONLY hub ⇒ its own specific empty state, naming the hub', () => {
  const skillsSh = hub({ id: 'skills-sh', name: 'skills.sh', itemCount: 0 });
  const state = communityEmptyState({ hubs: [skillsSh], hubFilter: 'skills-sh', kind: 'all', query: '' });
  expect(state.state).toBe('hub-declared-only');
  expect(state.message).toContain('skills.sh');
  expect(state.message).toContain('declared');
  expect(state.message).not.toBe('Nothing matches this filter.');
});

test('the declared-only state is DERIVED from the selected hub\'s own itemCount — a hub whose count is non-zero never claims it', () => {
  const populated = hub({ id: 'superpowers', name: 'obra/superpowers', itemCount: 3 });
  const state = communityEmptyState({ hubs: [populated], hubFilter: 'superpowers', kind: 'all', query: 'zzz' });
  expect(state.state).toBe('no-match');
});

test('the declared-only state wins over a query — no query can match a hub that indexes nothing', () => {
  const skillsSh = hub({ id: 'skills-sh', itemCount: 0 });
  const state = communityEmptyState({ hubs: [skillsSh], hubFilter: 'skills-sh', kind: 'skill', query: 'anything' });
  expect(state.state).toBe('hub-declared-only');
});

test('a hubFilter naming a hub that is NOT in the list (a stale link) falls back to no-match, never a fabricated hub name', () => {
  const state = communityEmptyState({ hubs: [hub({ id: 'skills-sh', itemCount: 0 })], hubFilter: 'gone', kind: 'all', query: '' });
  expect(state.state).toBe('no-match');
  expect(state.message).not.toContain('gone');
});

// ENUMERATION — every hub in a realistic strip, each selected in turn: the
// state must agree with that hub's OWN itemCount, with no shared/stale flag.
test('every hub in the strip, selected in turn, produces the state its own itemCount implies', () => {
  const hubs = [
    hub({ id: 'forge-seed', name: 'forge seed', itemCount: 2 }),
    hub({ id: 'superpowers', name: 'obra/superpowers', itemCount: 3 }),
    hub({ id: 'skills-sh', name: 'skills.sh', itemCount: 0 }),
    hub({ id: 'mcp-servers', name: 'modelcontextprotocol/servers', itemCount: 0 }),
  ];
  for (const h of hubs) {
    const state = communityEmptyState({ hubs, hubFilter: h.id, kind: 'all', query: '' });
    expect(state.state).toBe(isHubDeclaredOnly(h) ? 'hub-declared-only' : 'no-match');
    if (isHubDeclaredOnly(h)) expect(state.message).toContain(h.name);
  }
});

// ---------------------------------------------------------------------------
// E16 — the owning connection page is reachable from EVERY connection row
// ---------------------------------------------------------------------------

const INSTALL_METHODS = ['npm', 'external', 'system-provided', null] as const;

test('a NOT-installed mcp/tool row links its connection page — the exact defect community-18 named', () => {
  const base = { kind: 'mcp' as const, id: 'memory', vendored: false, installState: 'not-installed' as const, upstream: 'https://example.com/m' };
  const action = installActionForItem({ ...base, installMethod: 'npm' });
  expect(action).toEqual({ action: 'install-confirm' });          // the install action is UNTOUCHED …
  expect(connectionPageLinkFor(base, action)).toBe('/connections/memory'); // … and the link is ADDED beside it
});

// ENUMERATION — the whole matrix, not just the arm that was broken. For every
// kind x installState x installMethod x vendored, the owning connection page
// must be reachable for mcp/tool exactly once (via the action, or via the
// added link), and never invented for skill/hook.
test('EVERY kind x installState x installMethod x vendored: a connection row always reaches /connections/<id>, exactly once', () => {
  let connectionCases = 0;
  for (const kind of COMMUNITY_KINDS) {
    for (const installState of COMMUNITY_INSTALL_STATES) {
      for (const installMethod of INSTALL_METHODS) {
        for (const vendored of [true, false]) {
          const it = { kind, id: 'the-id', vendored, installState, upstream: 'https://example.com/u', installMethod };
          const action = installActionForItem(it);
          const link = connectionPageLinkFor(it, action);
          const owningHref = '/connections/the-id';
          const actionLinksOwning =
            (action.action === 'open-owning' || action.action === 'present-unmanaged') && action.href === owningHref;

          if (kind === 'mcp' || kind === 'tool') {
            connectionCases += 1;
            expect(
              actionLinksOwning || link === owningHref,
              `${kind}/${installState}/${String(installMethod)}/vendored=${vendored} has NO route to ${owningHref}`,
            ).toBe(true);
            // Exactly once — never both, which would render the same link twice.
            expect(
              actionLinksOwning && link !== null,
              `${kind}/${installState}/${String(installMethod)}/vendored=${vendored} offers the owning link TWICE`,
            ).toBe(false);
          } else {
            expect(
              link,
              `${kind}/${installState} invented a connection page for a non-connection kind`,
            ).toBeNull();
          }
        }
      }
    }
  }
  expect(connectionCases).toBe(2 * COMMUNITY_INSTALL_STATES.length * INSTALL_METHODS.length * 2);
});

test('the added link NEVER replaces the install action: every not-installed connection keeps the action it had', () => {
  const cases = [
    { installMethod: 'npm' as const, expected: 'install-confirm' },
    { installMethod: 'external' as const, expected: 'browse-upstream' },
    { installMethod: 'system-provided' as const, expected: 'none-system' },
    { installMethod: null, expected: 'none-system' },
  ];
  for (const kind of ['mcp', 'tool'] as const) {
    for (const { installMethod, expected } of cases) {
      const it = { kind, id: 'c', vendored: false, installState: 'not-installed' as const, upstream: 'https://example.com/u', installMethod };
      expect(installActionForItem(it).action, `${kind}/${String(installMethod)}`).toBe(expected);
      expect(connectionPageLinkFor(it, installActionForItem(it))).toBe('/connections/c');
    }
  }
});

test('an INSTALLED connection is not given a second, duplicate link — its action already routes there', () => {
  for (const kind of ['mcp', 'tool'] as const) {
    const it = { kind, id: 'c', vendored: false, installState: 'installed' as const, upstream: 'https://example.com/u', installMethod: 'npm' };
    const action = installActionForItem(it);
    expect(action).toEqual({ action: 'open-owning', href: '/connections/c' });
    expect(connectionPageLinkFor(it, action)).toBeNull();
  }
});

test('the connection href is URL-encoded, exactly like owningHrefForKind — never a raw id spliced into a path', () => {
  const it = { kind: 'mcp' as const, id: 'a b/c', vendored: false, installState: 'not-installed' as const, upstream: 'https://example.com/u', installMethod: 'npm' };
  expect(connectionPageLinkFor(it, installActionForItem(it))).toBe(`/connections/${encodeURIComponent('a b/c')}`);
});
