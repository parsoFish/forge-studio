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
 * (packages/library/community-no-trust-decisions.test.ts scans this file's source text).
 *
 * W6-CR-2 adds `sortCommunityItems` (operator-locked: SIMPLE SORTS ONLY —
 * name / stars / updated / source, no search/facets/tags sort) and
 * `freshnessBadge` (never renders a date for a null `fetchedAt` — see each
 * function's own doc comment below for the full contract).
 *
 * W8-B5b adds `refreshOutcomeView` — the pure derivation from a
 * `postCommunityRefresh()` transport result (community-client.ts) to what the
 * /community page's "Refresh registry" button renders.
 */

import type { CommunityItem, CommunityKind, CommunityInstallState, CommunityHub, CommunityHubWithCount, CommunitySignals, CommunityRefreshResult } from './community-client.ts';

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

/** Case-insensitive match on name + desc + id + category + hub label +
 *  signals attribution + upstream URL (W7-B3, community-05: the operator's
 *  natural query terms — the id shown in the URL, the hub names in the strip,
 *  the attribution on the card — all used to return zero results). Empty
 *  query returns a NEW array of every item, unfiltered.
 *
 *  W8-B5 (exit row E11) adds `category` — the word the registry itself files
 *  rows under ("planning", "memory", "review"), and one of the first an
 *  operator browsing a library types. It could not be added before: the field
 *  reached neither the client type nor the server's wire projection, so a
 *  search-term-only change would have been a no-op. A `null` category (an
 *  item with no registry row) simply never matches — it is NOT coerced to
 *  `''`, which would quietly match a query of nothing in particular. */
export function filterCommunityItems(items: readonly CommunityItem[], query: string): CommunityItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  return items.filter((item) =>
    item.name.toLowerCase().includes(q) ||
    item.desc.toLowerCase().includes(q) ||
    item.id.toLowerCase().includes(q) ||
    (item.category !== null && item.category.toLowerCase().includes(q)) ||
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
  // W7-B3 (library-31): the id is occupied by a local skill the community
  // pipeline does not manage — neither installed nor installable here.
  'present-unmanaged': 'Present locally — unmanaged',
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
// installActionForItem — W7-B3 (community-09 / -18 / -19, library-31): the
// ONE decision for the detail page's install section. Every item either
// installs (directly, or behind the confirm step for a real npm spawn),
// routes to the page that owns it, or says exactly why not — with the real
// upstream URL to browse. Pure; the page renders the verdict verbatim.
// ---------------------------------------------------------------------------

export type CommunityInstallAction =
  | { action: 'install' }
  | { action: 'install-confirm' }
  | { action: 'open-owning'; href: string }
  | { action: 'present-unmanaged'; href: string }
  | { action: 'browse-upstream'; href: string }
  | { action: 'none-system' };

function owningHrefForKind(kind: CommunityKind, id: string): string {
  if (kind === 'skill') return `/skills/${encodeURIComponent(id)}`;
  if (kind === 'hook') return `/hooks/${encodeURIComponent(id)}`;
  return `/connections/${encodeURIComponent(id)}`;
}

export function installActionForItem(item: {
  kind: CommunityKind;
  id: string;
  vendored: boolean;
  installState: CommunityInstallState;
  upstream: string;
  /** Connection kinds only — `install.method` from the detail payload; null
   *  for skill/hook (no install method concept exists there). */
  installMethod: string | null;
}): CommunityInstallAction {
  if (item.installState === 'present-unmanaged') {
    return { action: 'present-unmanaged', href: owningHrefForKind(item.kind, item.id) };
  }
  if (item.kind === 'mcp' || item.kind === 'tool') {
    // community-18: an installed connection ALWAYS links its own page —
    // system-provided/external included (they were the unlinked ones).
    if (item.installState !== 'not-installed') return { action: 'open-owning', href: owningHrefForKind(item.kind, item.id) };
    if (item.installMethod === 'npm') return { action: 'install-confirm' };
    if (item.installMethod === 'external') return { action: 'browse-upstream', href: item.upstream };
    return { action: 'none-system' };
  }
  // skill | hook
  if (!item.vendored) return { action: 'browse-upstream', href: item.upstream };
  if (item.installState === 'not-installed') return { action: 'install' };
  return { action: 'open-owning', href: owningHrefForKind(item.kind, item.id) };
}

/**
 * W8-B5 (community-18 / exit row E16) — the SECONDARY link to the connection's
 * own page, rendered BESIDE whatever `installActionForItem` decided.
 *
 * The earlier community-18 fix only reached the INSTALLED case (its own
 * comment above says so): `installActionForItem` returns `open-owning` when
 * `installState !== 'not-installed'`, so a not-installed mcp/tool — the most
 * common state, and the one where an operator most needs the config vars, the
 * env-var list and the probe explanation — had no route to
 * `/connections/<id>` at all. The install action is deliberately NOT changed:
 * a not-installed npm connection still offers its two-step install confirm,
 * an external one still offers its upstream, a system-provided one still says
 * why there is nothing to install here. This ADDS the missing link.
 *
 * Returns `null` — never a duplicate — when the primary action ALREADY links
 * that page (`open-owning`, `present-unmanaged`), and for skill/hook, whose
 * owning pages are the local libraries and only exist once something has been
 * installed there.
 */
export function connectionPageLinkFor(
  item: { kind: CommunityKind; id: string },
  action: CommunityInstallAction,
): string | null {
  if (item.kind !== 'mcp' && item.kind !== 'tool') return null;
  if (action.action === 'open-owning' || action.action === 'present-unmanaged') return null;
  return owningHrefForKind(item.kind, item.id);
}

// ---------------------------------------------------------------------------
// The empty state — W8-B5 (community-36 / exit row E14).
//
// The hub chip already computed "this hub is DECLARED but indexes nothing"
// and said so in its own tooltip; the empty block below the grid never read
// it and collapsed every zero-result view to "Nothing matches this filter."
// — so selecting skills.sh (a real, registered hub forge indexes nothing
// from yet) read as a failed search rather than as the honest state of that
// source. Classic declared-data-fails-open: a value parsed and surfaced, then
// enforced nowhere downstream.
//
// The cure derives the state from the SELECTED HUB'S OWN `itemCount` through
// `isHubDeclaredOnly` — the SAME predicate the chip uses — so there is no
// second copy of the flag to go stale, and no way for the chip and the empty
// block to disagree about the same hub.
// ---------------------------------------------------------------------------

export const COMMUNITY_EMPTY_STATES = ['empty-index', 'no-match', 'hub-declared-only'] as const;
export type CommunityEmptyStateKind = (typeof COMMUNITY_EMPTY_STATES)[number];

export type CommunityEmptyState = { state: CommunityEmptyStateKind; message: string };

/** A real, registered hub that forge has indexed nothing from yet. Derived
 *  from the hub's own DERIVED-per-request count — never a declared flag. */
export function isHubDeclaredOnly(hub: { itemCount: number }): boolean {
  return hub.itemCount === 0;
}

export function communityEmptyState(args: {
  hubs: readonly CommunityHubWithCount[];
  hubFilter: string | null;
  kind: CommunityKind | 'all';
  query: string;
}): CommunityEmptyState {
  // The hub the operator actually selected, looked up in the live strip. A
  // `hubFilter` naming a hub that is not there (a stale link, a hub removed
  // from hubs.yaml) falls through to the generic state rather than
  // fabricating a name for it.
  const selected = args.hubFilter === null
    ? undefined
    : args.hubs.find((h) => h.id === args.hubFilter);

  if (selected && isHubDeclaredOnly(selected)) {
    // Beats every other reason: no kind filter and no query can match a hub
    // that indexes nothing, so "nothing matches your filter" would be the
    // less true of the two statements.
    return {
      state: 'hub-declared-only',
      message: `${selected.name} is a declared source — nothing from it is indexed yet. A targeted refresh can propose items from it.`,
    };
  }

  const filtering = args.query.trim().length > 0 || args.kind !== 'all' || args.hubFilter !== null;
  if (filtering) return { state: 'no-match', message: 'Nothing matches this filter.' };
  return { state: 'empty-index', message: 'The community index is empty.' };
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

/**
 * W8-B5b — `lastTerminalRefreshOf` USED TO LIVE HERE, and its deletion is the
 * point, not a side effect.
 *
 * It answered "when was the registry last refreshed?" by scanning SESSION
 * rows for the newest terminal `community-refresh` session. The registry file
 * carries that answer itself — `meta.lastRefresh` (`studio/community/
 * registry.yaml`), which `lastRefreshLabel` above already reads — so the page
 * had two sources for one fact, and the session-shaped one was about to
 * outlive the session kind that fed it.
 *
 * That is what made the old "never refreshed" line a DERIVATION defect rather
 * than a missing-kind defect: it was right for the wrong reason. Both sources
 * currently agree (this checkout's `meta.lastRefresh` is genuinely `null` and
 * every source row is genuinely `fetchedBy: seed`), so the rendered STRING did
 * not change when the derivation did. Tests must therefore assert the SOURCE,
 * never the string — `community-view.test.ts` pins that the registry file is
 * where the answer comes from and that no session-derived path survives.
 */

// ---------------------------------------------------------------------------
// refreshOutcomeView — W8-B5b: the ONE pure derivation from a
// `postCommunityRefresh()` transport result to what the /community page
// button renders. No React, no fetch, no DOM (this module's own convention,
// restated in its header) — the page reads `state`/`headline`/`detail`
// verbatim.
//
// FOUR rules this function exists to hold:
//
//  1. The dry-bridge refusal renders as an HONEST, NAMED refusal that states
//     the route it reached — never a generic error, and never rounded up to
//     a faked success. Tone mirrors `connection-library-view.ts`'s own
//     "Install suppressed — nothing was run (dry-bridge / no-spawn mode)."
//  2. A 200 whose `errors` array is non-empty is a PARTIAL outcome, not a
//     clean success — it is never rounded up to "refreshed" (the exact lie
//     `all-sources-failed` answering 502 instead of 200 exists to prevent one
//     level up, at the route; this is the same discipline one level down, at
//     the render).
//  3. Never fabricate a count, a date or an age: every figure below is read
//     straight off the server's own `counts`/`lastRefresh` — nothing here
//     re-derives or guesses at a number the bridge did not send.
//  4. (W8-B5b hostile-review FINDING 1) A successful write is never retracted
//     or buried by a SECOND, independent failure — the caller's own
//     `postWriteReloadFailed` (see `RefreshOutcomeViewOptions` below) is
//     reconciled onto the base outcome, never allowed to replace it.
// ---------------------------------------------------------------------------

export type CommunityRefreshOutcomeView = { state: string; headline: string; detail: string | null };

/**
 * W8-B5b hostile-review FINDING 1 — `postWriteReloadFailed` is the caller's
 * (the /community page's) own honest report that the re-read it issued AFTER
 * a successful write did not come back. Both facts are true at once and both
 * must be stated: the write happened (the base headline/detail below,
 * UNCHANGED), and the page below may now be showing stale data because the
 * re-read that would have refreshed it failed. This function must NEVER
 * retract or bury the write's own success just because a second, independent
 * read failed — that clobbering (a rendered success sitting under a rendered
 * full-page failure) is the exact defect this option exists to close.
 *
 * Only meaningful when the result actually wrote (`state:'ok', wrote:true`)
 * — the ONE case the page's own re-read is triggered from; any other result
 * state ignores the flag rather than fabricate a "stale" claim for an
 * outcome that never touched the registry file.
 */
export type RefreshOutcomeViewOptions = { postWriteReloadFailed?: boolean };

function describeRefreshFailures(errors: readonly { source: string; message: string }[]): string {
  return errors.map((e) => `${e.source}: ${e.message}`).join('\n');
}

export function refreshOutcomeView(
  result: CommunityRefreshResult,
  opts: RefreshOutcomeViewOptions = {},
): CommunityRefreshOutcomeView {
  const base = baseRefreshOutcomeView(result);
  if (opts.postWriteReloadFailed && result.state === 'ok' && result.wrote) {
    // A NEW, deliberately distinct state — e.g. 'refreshed-stale-view' for
    // the clean-success case — never an overload of the plain 'refreshed' /
    // 'partial' values, so a caller cannot mistake a stale view for a fresh
    // one by string-matching the old state alone.
    const staleNotice = 'The page below could not be re-read after this write — what is shown may now be stale. Reload to see the latest.';
    return {
      state: `${base.state}-stale-view`,
      headline: base.headline,
      detail: base.detail !== null ? `${base.detail}\n\n${staleNotice}` : staleNotice,
    };
  }
  return base;
}

function baseRefreshOutcomeView(result: CommunityRefreshResult): CommunityRefreshOutcomeView {
  switch (result.state) {
    case 'refused-dry-bridge':
      return {
        state: 'refused-dry-bridge',
        headline: 'Refresh suppressed — nothing was run (dry-bridge / no-spawn mode).',
        detail: `The bridge refused ${result.method} ${result.route} rather than making the real outbound GitHub/npm call.`,
      };

    case 'ok': {
      if (result.errors.length > 0) {
        // RULE 2 — a partial pass is never presented as a clean refresh.
        const verified = result.counts.refreshed + result.counts.unchanged;
        return {
          state: 'partial',
          headline: `Partial refresh — ${verified} of ${result.counts.total} row(s) verified, ${result.errors.length} source(s) failed.`,
          detail: describeRefreshFailures(result.errors),
        };
      }
      if (!result.wrote) {
        return {
          state: 'no-op',
          // W8-B5b hostile-review FINDING 4 — `postCommunityRefresh` (this
          // function's ONE production caller, via the /community page's
          // "Refresh registry" button) POSTs packages/library/bridge-studio-community.ts's
          // route, whose handler calls `runCommunityRefresh({ forgeRoot })`
          // with NO `dryRun` key — so a 200 reaching the UI always carries
          // `dryRun: false`, and the `result.dryRun` arm below is
          // UNREACHABLE from the browser today. It stays, and is pinned by a
          // dedicated test (community-view.test.ts), because it mirrors the
          // SERVER's own real `CommunityRefreshResult.dryRun` type (`--dry-run`
          // is a real CLI flag) rather than a screen an operator can actually
          // reach right now — an honest defensive mirror, not dead code.
          headline: result.dryRun
            ? `Dry run — computed ${result.counts.total} row(s), wrote nothing.`
            : 'Nothing to verify — the registry has no queryable rows, so nothing was written.',
          detail: null,
        };
      }
      return {
        state: 'refreshed',
        headline: `Refreshed — ${result.counts.refreshed} updated, ${result.counts.unchanged} unchanged of ${result.counts.total}.`,
        // RULE 3 — only rendered when the server actually sent a stamp.
        detail: result.lastRefresh !== null ? `Registry stamp: ${result.lastRefresh}.` : null,
      };
    }

    case 'refused':
      return { state: 'refused', headline: result.error, detail: result.remedy };

    case 'server-error':
      return { state: 'server-error', headline: result.error, detail: null };

    case 'transport-error':
      return {
        state: 'transport-error',
        headline: 'Could not reach the forge bridge.',
        detail: result.error,
      };

    default: {
      const exhaustive: never = result;
      throw new Error(`refreshOutcomeView: unrecognised result state ${JSON.stringify(exhaustive)}`);
    }
  }
}
