/**
 * Pure view-state derivation for the /community browse page +
 * /community/[kind]/[id] detail page (R3-07-F1; sort + freshness W6-CR-2).
 *
 * Mirrors connection-library-view.ts's testability convention exactly: no
 * DOM, no React, no network, no re-derivation of any server-computed fact
 * (installState, probeState, hub match, signals) — this module assumes a
 * parsed, already-trustworthy `CommunityItem`/`CommunityHub` (from
 * ./community-client.ts) and only ever reshapes it for rendering.
 * Immutability: every function returns a NEW array, never mutates its input.
 *
 * D2 — this file owns ZERO trust decisions: it never references
 * approve/override/re-pin machinery, not even in a comment
 * (cli/community-no-trust-decisions.test.ts scans this file's source text).
 *
 * W6-CR-2 adds `sortCommunityItems` (operator-locked: SIMPLE SORTS ONLY —
 * name / stars / updated / source, no search/facets/tags sort) and
 * `freshnessBadge` (never renders a date for a null `fetchedAt` — see each
 * function's own doc comment below for the full contract).
 */

import type { CommunityItem, CommunityKind, CommunityInstallState, CommunityHub, CommunitySignals } from './community-client.ts';

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

/** Filter by kind, or pass every item through unfiltered for 'all'. Always
 *  returns a NEW array — never the same reference as `items`, even for the
 *  unfiltered case, so a caller can never mistake it for a live view onto
 *  the input. */
export function filterByKind(items: readonly CommunityItem[], kind: CommunityKind | 'all'): CommunityItem[] {
  if (kind === 'all') return [...items];
  return items.filter((item) => item.kind === kind);
}

/** Case-insensitive match on name + desc + id + hub label + signals
 *  attribution + upstream URL (W7-B3, community-05: the operator's natural
 *  query terms — the id shown in the URL, the hub names in the strip, the
 *  attribution on the card — all used to return zero results). Empty query
 *  returns a NEW array of every item, unfiltered. */
export function filterCommunityItems(items: readonly CommunityItem[], query: string): CommunityItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  return items.filter((item) =>
    item.name.toLowerCase().includes(q) ||
    item.desc.toLowerCase().includes(q) ||
    item.id.toLowerCase().includes(q) ||
    hubLabel(item.hub).toLowerCase().includes(q) ||
    (item.signals !== null && item.signals.attributedTo.toLowerCase().includes(q)) ||
    item.upstream.toLowerCase().includes(q),
  );
}

/** W7-B3 (community-17): hub chips filter the LOCAL index. `null` = no hub
 *  filter (every item, as a NEW array). Same conventions as filterByKind. */
export function filterByHub(items: readonly CommunityItem[], hubId: string | null): CommunityItem[] {
  if (hubId === null) return [...items];
  return items.filter((item) => item.hub?.id === hubId);
}

// ---------------------------------------------------------------------------
// installStateLabel — D3: four distinct, non-empty labels. "needs-review"
// must read distinctly from "installed" — a tampered item must never be
// presented as trustworthy.
// ---------------------------------------------------------------------------

const INSTALL_STATE_LABELS: Record<CommunityInstallState, string> = {
  'not-installed': 'Not installed',
  'draft-pending-approval': 'Draft — pending approval',
  'needs-review': 'Needs review — do not trust yet',
  installed: 'Installed',
};

export function installStateLabel(state: CommunityInstallState): string {
  return INSTALL_STATE_LABELS[state];
}

// ---------------------------------------------------------------------------
// signalsLabel — D5: an item with no published signals renders the
// spec-literal "no signals published", never a fabricated zero. A real
// signal always carries both the figure AND its curated attribution — never
// presented as forge's own ranking.
// ---------------------------------------------------------------------------

export function signalsLabel(signals: CommunitySignals | null): string {
  if (signals === null) return 'no signals published';
  return `★ ${signals.stars} · curated by ${signals.attributedTo}`;
}

// ---------------------------------------------------------------------------
// hubLabel — D4: a null hub renders the spec-literal "unaffiliated", never
// an invented hub name.
// ---------------------------------------------------------------------------

export function hubLabel(hub: CommunityHub | null): string {
  if (hub === null) return 'unaffiliated';
  return hub.name;
}

// ---------------------------------------------------------------------------
// communityBadgeForSkill — the /skills page join, gated on the skill's OWN
// source, never on id alone. A catalog community-skills entry and a
// genuinely local, hand-authored skill can legitimately share an id
// (listSkillLibrary documents the collision as expected: "filesystem wins on
// existence/trust; catalog wins on display metadata") — joining by id alone
// would cross-attribute the catalog entry's hub/signals/provenance onto the
// operator's own file. `entry` takes a minimal structural shape ({id,
// source}) rather than importing forge-ui/lib/skill-client.ts's full
// SkillLibraryEntry type, keeping this module decoupled from that client.
// ---------------------------------------------------------------------------

export function communityBadgeForSkill(entry: { id: string; source: string }, items: readonly CommunityItem[]): CommunityItem | null {
  if (entry.source !== 'community') return null;
  const match = items.find((item) => item.kind === 'skill' && item.id === entry.id);
  return match ? match : null;
}

// ---------------------------------------------------------------------------
// sortCommunityItems — W6-CR-2: SIMPLE SORTS ONLY (operator-locked: name /
// stars / updated / source — no search/facets/tags sort exists or is
// planned). Mirrors this file's own filter conventions above: pure, returns
// a NEW array, never mutates `items`.
//
// null-last (never fabricated): a null `stars`/`updated` value is an HONEST
// absence of data, not a zero or an epoch date — it sorts LAST regardless of
// `dir` (asc AND desc), so a genuinely starred/verified item is never pushed
// below an unknown one just because the direction flipped.
//
// 'updated' sorts on `fetchedAt` — the SAME fact the freshness badge below
// renders (deliberately never `upstreamUpdatedAt`, a different claim: "when
// did the UPSTREAM project last change" vs "when did FORGE last verify this
// row"). The sort and the badge must always agree on what "freshness" means
// for an item.
//
// 'source' groups by the item's hub label (`hubLabel` — the SAME
// "unaffiliated" fallback the card already renders, never a second,
// divergent grouping fact), then breaks ties by name; the name tiebreak
// stays ascending regardless of `dir` — only the group ordering flips. This
// is the ONE key with an explicit two-level rule; `name`/`stars`/`updated`
// are single-key comparisons, so a tie between two items with the identical
// key value keeps their ORIGINAL relative order (`Array.prototype.sort` is
// guaranteed stable, ES2019+) rather than an arbitrary re-shuffle.
// ---------------------------------------------------------------------------

export const COMMUNITY_SORT_KEYS = ['name', 'stars', 'updated', 'source'] as const;
export type CommunitySortKey = (typeof COMMUNITY_SORT_KEYS)[number];

/** W7-B3 (community-04): the operator-facing label for each sort key. The
 *  `updated` key sorts on `fetchedAt` — when FORGE last verified the row —
 *  so its label says exactly that ("Last checked"), never the overloaded
 *  word "Updated" (upstream change time is a DIFFERENT claim, rendered as
 *  its own row on the detail page). */
export const COMMUNITY_SORT_LABELS: Record<CommunitySortKey, string> = {
  name: 'Name',
  stars: 'Stars',
  updated: 'Last checked',
  source: 'Source',
};

export const COMMUNITY_SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type CommunitySortDirection = (typeof COMMUNITY_SORT_DIRECTIONS)[number];

/** The default sort — deterministic, applied whenever the operator has not
 *  chosen otherwise (W6-CR-2 design note: name/asc, never an unsorted /
 *  server-order default). */
export const DEFAULT_COMMUNITY_SORT_KEY: CommunitySortKey = 'name';
export const DEFAULT_COMMUNITY_SORT_DIRECTION: CommunitySortDirection = 'asc';

/** null sorts LAST regardless of `dir` — a null is an honest absence, not a
 *  zero, and must never be pushed to the front just because `dir` flipped. */
function compareNullableNumber(a: number | null, b: number | null, dir: CommunitySortDirection): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return dir === 'asc' ? a - b : b - a;
}

function fetchedAtMs(item: CommunityItem): number | null {
  if (item.fetchedAt === null) return null;
  const ms = Date.parse(item.fetchedAt);
  return Number.isFinite(ms) ? ms : null;
}

function compareName(a: CommunityItem, b: CommunityItem): number {
  return a.name.localeCompare(b.name);
}

export function sortCommunityItems(
  items: readonly CommunityItem[],
  key: CommunitySortKey,
  dir: CommunitySortDirection,
): CommunityItem[] {
  const sorted = [...items];
  switch (key) {
    case 'name':
      sorted.sort((a, b) => (dir === 'asc' ? compareName(a, b) : -compareName(a, b)));
      return sorted;
    case 'stars':
      sorted.sort((a, b) =>
        compareNullableNumber(a.signals?.starsNumeric ?? null, b.signals?.starsNumeric ?? null, dir),
      );
      return sorted;
    case 'updated':
      sorted.sort((a, b) => compareNullableNumber(fetchedAtMs(a), fetchedAtMs(b), dir));
      return sorted;
    case 'source':
      sorted.sort((a, b) => {
        const groupCmp = hubLabel(a.hub).localeCompare(hubLabel(b.hub));
        const directed = dir === 'asc' ? groupCmp : -groupCmp;
        return directed !== 0 ? directed : compareName(a, b);
      });
      return sorted;
    default: {
      const exhaustive: never = key;
      throw new Error(`sortCommunityItems: unrecognised sort key "${String(exhaustive)}"`);
    }
  }
}

// ---------------------------------------------------------------------------
// freshnessBadge — W6-CR-2: never render a date for a null fetchedAt. `nowMs`
// is threaded through explicitly (D7 — mirrors history-ledger.ts's own
// formatWhen) so this stays wall-clock-independent and unit-testable.
// ---------------------------------------------------------------------------

export const FRESHNESS_STATES = ['seed', 'stale', 'fresh'] as const;
export type FreshnessState = (typeof FRESHNESS_STATES)[number];

export type FreshnessBadge = { state: FreshnessState; label: string };

const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const SEED_LABEL = 'seed — never verified';

function relativeAge(ageMs: number): string {
  const minutes = Math.floor(ageMs / MINUTE_MS);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(ageMs / HOUR_MS);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(ageMs / DAY_MS);
  return `${days}d ago`;
}

/**
 * The freshness badge for an item's `fetchedAt`. NEVER renders a date for a
 * null `fetchedAt` — the spec-literal "seed — never verified" label (a seed
 * row this repo hand-curated but has never verified against upstream). A
 * present-but-unparsable `fetchedAt` degrades to the SAME seed treatment (an
 * honest "we don't actually know" beats a fabricated relative time). A
 * `fetchedAt` older than 30 days reads "stale"; anything fresher renders a
 * relative time, never the raw date.
 */
export function freshnessBadge(fetchedAt: string | null, nowMs: number): FreshnessBadge {
  if (fetchedAt === null) return { state: 'seed', label: SEED_LABEL };
  const thenMs = Date.parse(fetchedAt);
  if (!Number.isFinite(thenMs)) return { state: 'seed', label: SEED_LABEL };
  const ageMs = Math.max(0, nowMs - thenMs);
  if (ageMs > STALE_AFTER_MS) return { state: 'stale', label: 'stale' };
  return { state: 'fresh', label: relativeAge(ageMs) };
}

/**
 * W7-B3 (community-16 / community-03): the registry-LEVEL freshness line —
 * `meta.lastRefresh` is stamped only by `commitRegistryDraft` (an approved
 * agent refresh actually landing). `null` — and an unparsable stamp — read
 * as the honest "never", never a fabricated or NaN age.
 */
export function lastRefreshLabel(lastRefresh: string | null, nowMs: number): string {
  if (lastRefresh === null) return 'never refreshed — every row is still the hand-curated seed';
  const thenMs = Date.parse(lastRefresh);
  if (!Number.isFinite(thenMs)) return 'never refreshed — every row is still the hand-curated seed';
  return `last refreshed ${relativeAge(Math.max(0, nowMs - thenMs))}`;
}
