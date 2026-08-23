/**
 * community-url-state — `/community`'s browse state, expressed as a URL
 * (W8-B5 / WI-6, exit row E15).
 *
 * THE DEFECT. The browse page held kind / hub / query / sort key / sort
 * direction in five `useState`s and never touched the router. Open a card,
 * press Back, and every one of them was gone; the view could not be linked or
 * shared, and the address bar disagreed with the page. Studio already treats
 * the URL as the place a selection lives (`/knowledge?node=`), so this is the
 * house pattern applied to the one surface that missed it.
 *
 * TWO PROPERTIES THIS MODULE EXISTS TO GUARANTEE:
 *
 *  1. `parseCommunityViewState` is TOTAL. A URL is operator-editable input
 *     arriving at a system boundary — hand-typed, bookmarked, link-rotted. An
 *     unrecognised `kind`/`sort`/`dir` degrades to the documented default
 *     rather than throwing or, worse, letting a filter vocabulary the page
 *     does not have reach `data-kind-filter`.
 *
 *  2. `communityViewStateToSearch` OMITS every value that equals its default,
 *     so the default view's canonical URL is the bare `/community` the
 *     journeys already wait for — the page never rewrites itself to
 *     `?kind=all&sort=name&dir=asc` on mount, and never buries the Back
 *     button under a synthetic history entry.
 *
 * The sort defaults are IMPORTED from community-view.ts rather than restated:
 * a second copy of "the default sort is name/asc" is exactly the kind of
 * duplicate fact this campaign keeps finding out of sync.
 */
import { COMMUNITY_KINDS, type CommunityKind } from './community-client.ts';
import {
  COMMUNITY_SORT_KEYS,
  COMMUNITY_SORT_DIRECTIONS,
  DEFAULT_COMMUNITY_SORT_KEY,
  DEFAULT_COMMUNITY_SORT_DIRECTION,
  type CommunitySortKey,
  type CommunitySortDirection,
} from './community-view.ts';

export type CommunityKindFilter = CommunityKind | 'all';

export type CommunityViewState = {
  kind: CommunityKindFilter;
  /** `null` = no hub filter. Never the empty string — an empty `?hub=` is the
   *  honest "no filter", not a hub whose id happens to be "". */
  hub: string | null;
  query: string;
  sortKey: CommunitySortKey;
  sortDir: CommunitySortDirection;
};

/** The query-string keys. Short and stable — they are part of every link an
 *  operator shares, so renaming one breaks their bookmarks. */
export const COMMUNITY_URL_PARAMS = {
  kind: 'kind',
  hub: 'hub',
  query: 'q',
  sortKey: 'sort',
  sortDir: 'dir',
} as const;

export const DEFAULT_COMMUNITY_VIEW_STATE: CommunityViewState = {
  kind: 'all',
  hub: null,
  query: '',
  sortKey: DEFAULT_COMMUNITY_SORT_KEY,
  sortDir: DEFAULT_COMMUNITY_SORT_DIRECTION,
};

function asParams(search: string | URLSearchParams): URLSearchParams {
  if (typeof search !== 'string') return search;
  try {
    return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  } catch {
    // URLSearchParams is extremely tolerant, but a caller could still hand us
    // something exotic. A URL that cannot be read is the DEFAULT view — never
    // a thrown error inside a render.
    return new URLSearchParams();
  }
}

/** One value from a vocabulary, or the default. `URLSearchParams.get` already
 *  returns the FIRST value of a repeated key, which is the deterministic
 *  choice — never a joined "a,b" pseudo-value. */
function oneOf<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

const KIND_FILTERS: readonly CommunityKindFilter[] = ['all', ...COMMUNITY_KINDS];

/** TOTAL: never throws, whatever the URL says. */
export function parseCommunityViewState(search: string | URLSearchParams): CommunityViewState {
  const params = asParams(search);
  const hub = params.get(COMMUNITY_URL_PARAMS.hub);
  const query = params.get(COMMUNITY_URL_PARAMS.query);
  return {
    kind: oneOf(params.get(COMMUNITY_URL_PARAMS.kind), KIND_FILTERS, DEFAULT_COMMUNITY_VIEW_STATE.kind),
    hub: hub !== null && hub.length > 0 ? hub : null,
    query: query ?? '',
    sortKey: oneOf(params.get(COMMUNITY_URL_PARAMS.sortKey), COMMUNITY_SORT_KEYS, DEFAULT_COMMUNITY_SORT_KEY),
    sortDir: oneOf(params.get(COMMUNITY_URL_PARAMS.sortDir), COMMUNITY_SORT_DIRECTIONS, DEFAULT_COMMUNITY_SORT_DIRECTION),
  };
}

/** The search string for `state`, carrying ONLY what differs from the default
 *  — one canonical URL per view, and an empty string for the default view. */
export function communityViewStateToSearch(state: CommunityViewState): string {
  const params = new URLSearchParams();
  if (state.kind !== DEFAULT_COMMUNITY_VIEW_STATE.kind) params.set(COMMUNITY_URL_PARAMS.kind, state.kind);
  if (state.hub !== null && state.hub.length > 0) params.set(COMMUNITY_URL_PARAMS.hub, state.hub);
  // A whitespace-only query filters nothing (filterCommunityItems trims it),
  // so it is not a view worth putting in a link.
  if (state.query.trim().length > 0) params.set(COMMUNITY_URL_PARAMS.query, state.query);
  if (state.sortKey !== DEFAULT_COMMUNITY_VIEW_STATE.sortKey) params.set(COMMUNITY_URL_PARAMS.sortKey, state.sortKey);
  if (state.sortDir !== DEFAULT_COMMUNITY_VIEW_STATE.sortDir) params.set(COMMUNITY_URL_PARAMS.sortDir, state.sortDir);
  return params.toString();
}

/** `/community` or `/community?<search>` — the href the router navigates to. */
export function communityHrefFor(state: CommunityViewState): string {
  const search = communityViewStateToSearch(state);
  return search.length > 0 ? `/community?${search}` : '/community';
}

/** A router write already issued but not yet reflected in the URL: the state
 *  it wrote, plus the search string that was current when it was issued. */
export type PendingCommunityWrite = { from: string; state: CommunityViewState };

/**
 * What a NEW write should build on.
 *
 * Moving the browse state into the URL introduces a hazard the five
 * `useState`s did not have: a router write is ASYNCHRONOUS. A second
 * interaction landing before the first has been applied would otherwise read
 * the STALE url state and silently drop the first change — pick a kind, then
 * immediately click a hub chip, and the kind is gone.
 *
 * So: while the URL has NOT moved since a write was issued, that write's state
 * is the base. The moment the URL changes — to our own write's target, or
 * anywhere else (a Back press, a pasted link) — the pending write is stale and
 * the URL wins. Returning the inputs by reference (never a clone) keeps this a
 * pure selection, not a merge.
 */
export function writeBaseState(
  urlState: CommunityViewState,
  search: string,
  pending: PendingCommunityWrite | null,
): CommunityViewState {
  if (pending !== null && pending.from === search) return pending.state;
  return urlState;
}
