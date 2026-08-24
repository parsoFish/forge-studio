'use client';

import { useCallback, useEffect, useRef, useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { StudioPage } from '@/components/StudioPage';
import {
  fetchCommunityIndex,
  postCommunityRefresh,
  COMMUNITY_KINDS,
  COMMUNITY_REFRESH_ROUTE,
  type CommunityItem,
  type CommunityHubWithCount,
  type CommunityKind,
  type CommunityIndexMeta,
  type CommunityRefreshResult,
} from '@/lib/community-client';
import { fetchStudioSessions, type SessionIndexRow } from '@/lib/studio-client';
import {
  filterByKind,
  filterByHub,
  filterCommunityItems,
  installStateLabel,
  signalsLabel,
  hubLabel,
  sortCommunityItems,
  freshnessBadge,
  lastRefreshLabel,
  lastTerminalRefreshOf,
  isHubDeclaredOnly,
  communityEmptyState,
  refreshOutcomeView,
  COMMUNITY_SORT_KEYS,
  COMMUNITY_SORT_LABELS,
  type CommunitySortKey,
} from '@/lib/community-view';
import { disabledAttrs } from '@/lib/disabled-reason';
import {
  parseCommunityViewState,
  communityHrefFor,
  writeBaseState,
  type CommunityViewState,
  type PendingCommunityWrite,
} from '@/lib/community-url-state';

// ---------------------------------------------------------------------------
// Community browser — /community (R3-07-F1; sort + freshness W6-CR-2). The
// ONE cross-kind browse surface over skills, hooks, MCPs and tools — the
// per-kind marketplace stubs this initiative retires (F1/F2 on /skills).
// Every hub, item, install state and signal below is exactly what the bridge
// computed — no re-derived state, no fabricated default (house rule,
// restated per this initiative's own D2: this page owns ZERO trust
// decisions — install ROUTES to the owning pipeline's page, it never
// approves or overrides anything itself).
//
// W6-CR-2, operator-locked: ordering is SIMPLE SORTS ONLY (name / stars /
// updated / source) — no search/facets/tags sort. Default is name/asc,
// deterministic (documented in docs/forge-ui-dom-and-harness.md).
//
// ---------------------------------------------------------------------------
// W8-B5 (community-35 / exit row E15) — THE BROWSE STATE LIVES IN THE URL.
// ---------------------------------------------------------------------------
// kind / hub / query / sort key / sort direction used to be five `useState`s,
// and this file never touched the router: open a card, press Back, and every
// one of them was gone — and the view could be neither linked nor shared.
// They now READ from the query string (`lib/community-url-state.ts`, which
// validates every value at that boundary and degrades an unknown one to the
// documented default rather than letting a filter vocabulary the page does
// not have reach `data-kind-filter`) and are WRITTEN back through the router:
//
//   - kind / hub / sort  → router.push, so Back genuinely restores them.
//   - the search box     → a LOCAL draft (typing stays instant) mirrored to
//                          the URL on a short debounce with router.REPLACE,
//                          so a burst of keystrokes never becomes a burst of
//                          history entries to press Back through.
//
// The default view serialises to the bare `/community`: this page never
// rewrites its own URL on mount.
//
// W8-B5 (community-36 / exit row E14): the empty block consumes the DERIVED
// empty state (`communityEmptyState`), which reads the selected hub's own
// itemCount through the SAME `isHubDeclaredOnly` predicate the chips use — so
// there is no second copy of the declared-only flag to go stale, and the chip
// and the empty block can never disagree about the same hub.
// ---------------------------------------------------------------------------

const KIND_FILTERS: Array<CommunityKind | 'all'> = ['all', ...COMMUNITY_KINDS];

const KIND_LABEL: Record<CommunityKind | 'all', string> = {
  all: 'All',
  skill: 'Skills',
  hook: 'Hooks',
  mcp: 'MCPs',
  tool: 'Tools',
};

/** How long the search box waits before mirroring itself into the URL. Long
 *  enough that a normal typing burst produces ONE navigation; short enough
 *  that the address bar is right by the time anyone reads or copies it. */
const QUERY_URL_DEBOUNCE_MS = 350;

function CommunityBrowserInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  // The URL is the state. Every rendered attribute below reads from HERE, so
  // the DOM contract and the address bar can never disagree.
  const viewState = parseCommunityViewState(search);
  const { kind, hub: hubFilter, sortKey, sortDir } = viewState;

  const [hubs, setHubs] = useState<CommunityHubWithCount[]>([]);
  const [items, setItems] = useState<CommunityItem[]>([]);
  const [meta, setMeta] = useState<CommunityIndexMeta | null>(null);
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [error, setError] = useState<string | null>(null);
  // The search box's live value. The URL holds the durable copy; this is the
  // one being typed into, so the list filters on every keystroke while the
  // address bar catches up on the debounce below.
  const [queryDraft, setQueryDraft] = useState(viewState.query);
  const [nowMs] = useState(() => Date.now());
  // W7-B3 (community-16): the refresh sessions this surface used to lose —
  // in-flight (non-terminal) + the most recent terminal one, from the SAME
  // sessions index /sessions reads. Advisory: a failed read keeps [] (the
  // strip renders nothing false; the index itself carries its own state).
  const [refreshSessions, setRefreshSessions] = useState<SessionIndexRow[]>([]);
  // W8-B5b — the deterministic (LLM-free) refresh: null until the operator
  // has clicked the button at least once (data-section="refresh-result" is
  // deliberately absent until then — no empty shell). `refreshing` gates the
  // button through disabledAttrs while the request is in flight.
  const [refreshResult, setRefreshResult] = useState<CommunityRefreshResult | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // W8-B5b — the index read is a REUSABLE callback, not an effect-local
  // closure, because a successful deterministic refresh REWRITES the very
  // file this read derives from. Before this, `meta.lastRefresh` was captured
  // once at mount and never re-read, so a real refresh left the page stating
  // two contradictory things at once: the result strip saying "Refreshed — N
  // updated" beside `[data-component="registry-last-refresh"]` still saying
  // "never refreshed", with `data-last-refresh` and every item's freshness
  // badge equally stale. One fact, one source — the same rule the hub chips
  // and the empty state already share through `isHubDeclaredOnly`.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const loadIndex = useCallback(async () => {
    const r = await fetchCommunityIndex();
    if (!mounted.current) return;
    if (!r.ok) {
      setStatus('error');
      setError(r.error ?? 'could not reach the forge bridge');
      return;
    }
    setHubs(r.hubs);
    setItems(r.items);
    setMeta(r.meta);
    setStatus('ready');
    setError(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadIndex();
    // W7-B3 review F2: activeOnly=false is load-bearing — the default
    // (?active=1) excludes every TERMINAL row, which made
    // lastTerminalRefresh permanently null and the
    // "open-last-refresh-session" link dead code (the community-16 defect).
    fetchStudioSessions(false)
      .then((rows) => {
        if (!cancelled) setRefreshSessions(rows.filter((row) => row.kind === 'community-refresh'));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  /** A router write already issued but not yet reflected in the URL. A router
   *  write is ASYNCHRONOUS, so a second interaction landing before the first
   *  is applied must build on the FIRST one's state — otherwise picking a kind
   *  and immediately clicking a hub chip drops the kind. `writeBaseState`
   *  (pure, unit-tested) owns that rule; the moment the URL moves — to our own
   *  target or to a Back press's — the pending write is stale and the URL
   *  wins. */
  const pendingWrite = useRef<PendingCommunityWrite | null>(null);
  if (pendingWrite.current !== null && pendingWrite.current.from !== search) pendingWrite.current = null;

  // The state a write (a click, or the search debounce firing) builds on, read
  // at fire time via a ref rather than captured — otherwise a filter clicked
  // mid-typing-burst would be clobbered when the timer lands.
  const baseRef = useRef<CommunityViewState>(viewState);
  baseRef.current = writeBaseState(viewState, search, pendingWrite.current);
  const searchRef = useRef(search);
  searchRef.current = search;

  /** The last query value THIS page wrote to the URL. It tells our own
   *  debounced write (which must not disturb the draft) apart from an
   *  EXTERNAL change — a Back/Forward press, or a pasted link — which must
   *  put the draft back in step with the address bar. */
  const lastWrittenQuery = useRef(viewState.query);

  const writeState = useCallback((next: CommunityViewState, mode: 'push' | 'replace') => {
    pendingWrite.current = { from: searchRef.current, state: next };
    lastWrittenQuery.current = next.query;
    const href = communityHrefFor(next);
    if (mode === 'push') router.push(href, { scroll: false });
    else router.replace(href, { scroll: false });
  }, [router]);

  // Back / Forward / a pasted link changed the query in the URL — resync the
  // box. Our own debounced write is skipped here, so typing is never
  // truncated by the navigation it just caused.
  useEffect(() => {
    if (viewState.query === lastWrittenQuery.current) return;
    lastWrittenQuery.current = viewState.query;
    setQueryDraft(viewState.query);
  }, [viewState.query]);

  // Trailing-edge debounce: one REPLACE per typing burst, never one per
  // keystroke — the address bar ends up right without burying Back.
  useEffect(() => {
    if (queryDraft === baseRef.current.query) return;
    const timer = setTimeout(() => {
      writeState({ ...baseRef.current, query: queryDraft }, 'replace');
    }, QUERY_URL_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [queryDraft, viewState.query, writeState]);

  const byKind = filterByKind(items, kind);
  const byHub = filterByHub(byKind, hubFilter);
  const searched = filterCommunityItems(byHub, queryDraft);
  const filtered = sortCommunityItems(searched, sortKey, sortDir);
  const emptyState = communityEmptyState({ hubs, hubFilter, kind, query: queryDraft });
  const inFlightRefresh = refreshSessions.filter((row) => !row.terminal);
  const lastTerminalRefresh = lastTerminalRefreshOf(refreshSessions);
  const refreshView = refreshResult !== null ? refreshOutcomeView(refreshResult) : null;

  // W8-B5b — the deterministic refresh. `postCommunityRefresh` never throws
  // (every failure — transport, dry-bridge, a typed refusal, a bare 500 — is
  // a typed result state, not a rejection), so there is no swallowed-error
  // path here: whatever comes back is rendered, never dropped on the floor
  // the way the sessions fetch above (`.catch(() => {})`) is allowed to be —
  // that fetch is advisory strip decoration; this one is the operator's own
  // explicit request.
  const handleRefreshClick = useCallback(async () => {
    setRefreshing(true);
    const result = await postCommunityRefresh();
    if (!mounted.current) return;
    setRefreshResult(result);
    setRefreshing(false);
    // The registry file just changed on disk — re-read the index so the
    // freshness the page STATES is the freshness the registry now HAS. Only
    // on a real write: a dry-bridge refusal, a typed refusal and a partial
    // pass that wrote nothing all leave the file untouched, and re-reading
    // after those would be a request that cannot tell anyone anything new.
    if (result.state === 'ok' && result.wrote) await loadIndex();
  }, [loadIndex]);

  return (
    <StudioPage
      dataPage="community-browser"
      ready={status !== 'loading'}
      data={{
        'data-item-count': filtered.length,
        'data-kind-filter': kind,
        'data-hub-filter': hubFilter ?? 'all',
        'data-hub-count': hubs.length,
        'data-sort-key': sortKey,
        'data-sort-dir': sortDir,
        ...(meta ? { 'data-registry-dirty': String(meta.registryDirty), 'data-last-refresh': meta.lastRefresh ?? 'never' } : {}),
      }}
      title="Community"
      lede={
        <>
          One browser over every source hub — skills, hooks, MCP servers and tools. Installing pulls a copy
          into the matching local library with provenance and hub signals kept; approval (if the object needs
          it) happens on its own owning page, never here.
        </>
      }
      actions={
        <>
          <Link
            href="/community/new"
            data-action="add-registry-item"
            className="btn btn-sm"
            title="Add a curated item to studio/community/registry.yaml (W7-B3 — hand-curated rows are stamped fetchedBy: operator)"
          >
            + Add item
          </Link>
          <button
            type="button"
            data-action="refresh-community-registry"
            className="btn btn-sm"
            onClick={() => { void handleRefreshClick(); }}
            {...disabledAttrs(
              refreshing ? 'A refresh is already in flight.' : null,
              `Fetch real upstream signals for every registry row and write the verified facts back (POST ${COMMUNITY_REFRESH_ROUTE}) — deterministic, no agent involved`,
            )}
          >
            Refresh registry
          </button>
        </>
      }
    >

        {status === 'ready' && (
          <section
            data-section="refresh-registry-state"
            data-in-flight-count={inFlightRefresh.length}
            style={{
              display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'baseline', marginBottom: 14,
              fontSize: 12.5, color: 'var(--dim)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 12px',
            }}
          >
            <span data-component="registry-last-refresh">Registry {lastRefreshLabel(meta?.lastRefresh ?? null, nowMs)}.</span>
            {meta?.registryDirty === true && (
              <span data-component="registry-dirty" style={{ color: 'var(--ember)' }}>
                Uncommitted changes — <code style={{ fontSize: 11.5 }}>studio/community/registry.yaml</code> has been
                written by Studio but not yet committed; commit it via your normal git flow.
              </span>
            )}
            {inFlightRefresh.map((row) => (
              <Link
                key={row.sessionId}
                href={row.href}
                data-action="open-refresh-session"
                data-session-state={row.state}
                style={{ color: 'var(--ember)', textDecoration: 'none' }}
              >
                Refresh in flight ({row.state}) — {row.sessionId} →
              </Link>
            ))}
            {inFlightRefresh.length === 0 && lastTerminalRefresh && (
              <Link
                href={lastTerminalRefresh.href}
                data-action="open-last-refresh-session"
                style={{ color: 'var(--dim)', textDecoration: 'underline' }}
              >
                Last refresh session: {lastTerminalRefresh.sessionId} ({lastTerminalRefresh.phase}) →
              </Link>
            )}
          </section>
        )}

        {/* W8-B5b — the deterministic refresh's own outcome. Absent until the
            operator has clicked "Refresh registry" at least once (no empty
            shell); `data-refresh-route` is set ONLY from the route the
            SERVER echoed back in a dry-bridge refusal — never a hardcoded
            client-side literal, so its presence is evidence the request
            actually reached that route. */}
        {refreshResult !== null && refreshView !== null && (
          <section
            data-section="refresh-result"
            data-refresh-state={refreshView.state}
            {...(refreshResult.state === 'refused-dry-bridge' ? { 'data-refresh-route': refreshResult.route } : {})}
            style={{
              marginBottom: 18, fontSize: 12.5, color: 'var(--dim)',
              border: '1px solid var(--line)', borderRadius: 8, padding: '8px 12px',
            }}
          >
            <div style={{ color: 'var(--text)' }}>{refreshView.headline}</div>
            {refreshView.detail !== null && (
              <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{refreshView.detail}</div>
            )}
          </section>
        )}

        {status === 'ready' && (
          <div data-component="hub-strip" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
            {hubs.map((hub) => {
              // The SAME predicate the empty state below reads — ONE fact
              // about this hub, never a chip-local copy of it (community-36).
              const declaredOnly = isHubDeclaredOnly(hub);
              const active = hubFilter === hub.id;
              return (
                <span key={hub.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <button
                    type="button"
                    data-action="filter-hub"
                    data-hub-id={hub.id}
                    data-hub-kinds={hub.kinds}
                    data-hub-item-count={hub.itemCount}
                    data-hub-declared-only={declaredOnly ? 'true' : 'false'}
                    className="badge"
                    onClick={() => writeState({ ...baseRef.current, hub: active ? null : hub.id }, 'push')}
                    style={{
            cursor: 'pointer', border: active ? '1px solid var(--ember, #FF9E4A)' : undefined,
                      opacity: declaredOnly ? 0.65 : 1,
                    }}
                    title={
                      declaredOnly
                        ? `${hub.name} is a declared source — nothing from it is indexed yet (a targeted refresh can propose items from it)`
                        : `Filter the index to ${hub.name}'s items (${hub.kinds})`
                    }
                  >
                    {hub.name}{' '}
                    <span style={{ color: 'var(--faint)' }}>{declaredOnly ? '· declared — nothing indexed' : `· ${hub.itemCount}`}</span>
                  </button>
                  <a
                    href={hub.url}
                    target="_blank"
                    rel="noreferrer"
                    data-action="open-hub-site"
                    data-hub-id={hub.id}
                    title={`Open ${hub.name} in a new tab`}
                    style={{ color: 'var(--faint)', textDecoration: 'none', fontSize: 11 }}
                  >
                    ⧉
                  </a>
                </span>
              );
            })}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24, alignItems: 'center' }}>
          {/* W8-B5 (community-32): a placeholder is not an accessible name — it
              vanishes the moment anything is typed, and assistive tech is not
              required to announce it. The sibling sort <select> already carried
              an aria-label; this now matches that pattern. */}
          <input
            type="text"
            data-field="community-search"
            aria-label="Search the community index by name, id, description, category, hub or provenance"
            placeholder="Search by name, id, description, category, hub or provenance…"
            value={queryDraft}
            onChange={(e) => setQueryDraft(e.target.value)}
            style={{
 width: '100%', maxWidth: 340, background: 'var(--bg-2)',
              border: '1px solid var(--line)', borderRadius: 'var(--radius-sm, 6px)', color: 'var(--text)',
              fontSize: 13, padding: '8px 11px', boxSizing: 'border-box',
            }}
          />
          {KIND_FILTERS.map((k) => (
            <button
              key={k}
              type="button"
              data-action="filter-kind"
              data-kind={k}
              className="btn btn-sm"
              onClick={() => writeState({ ...baseRef.current, kind: k }, 'push')}
              style={k === kind ? { borderColor: 'var(--ember, #FF9E4A)', color: 'var(--text)' } : undefined}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
          <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--line)', margin: '0 2px' }} />
          <select
            data-community-sort
            value={sortKey}
            onChange={(e) => writeState({ ...baseRef.current, sortKey: e.target.value as CommunitySortKey }, 'push')}
            className="btn btn-sm"
            style={{ cursor: 'pointer' }}
            aria-label="Sort the community index by"
          >
            {COMMUNITY_SORT_KEYS.map((k) => (
              <option key={k} value={k}>
                Sort: {COMMUNITY_SORT_LABELS[k]}
              </option>
            ))}
          </select>
          <button
            type="button"
            data-action="toggle-sort-direction"
            data-sort-direction={sortDir}
            className="btn btn-sm"
            onClick={() => writeState({ ...baseRef.current, sortDir: baseRef.current.sortDir === 'asc' ? 'desc' : 'asc' }, 'push')}
            title={sortDir === 'asc' ? 'Ascending — click for descending' : 'Descending — click for ascending'}
          >
            {sortDir === 'asc' ? '↑ Asc' : '↓ Desc'}
          </button>
        </div>

        {status === 'loading' && (
          <div style={{ color: 'var(--dim)', fontSize: 13.5, padding: '24px 0' }}>Loading the community index…</div>
        )}

        {status === 'error' && (
          <div
            data-component="fetch-error"
            style={{ color: '#f87171', fontSize: 13, padding: '14px 16px', border: '1px solid rgba(248,113,113,.35)', borderRadius: 'var(--radius-sm, 6px)', background: 'rgba(248,113,113,.06)' }}
          >
            Could not reach the forge bridge — the community index is unavailable ({error}). This is NOT the
            same as an empty index; retry once the bridge is back up.
          </div>
        )}

        {status === 'ready' && filtered.length === 0 && (
          <div
            data-component="community-empty"
            data-empty-state={emptyState.state}
            style={{ color: 'var(--faint)', fontSize: 13, fontStyle: 'italic', padding: '24px 0' }}
          >
            {emptyState.message}
          </div>
        )}

        {status === 'ready' && filtered.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
            {filtered.map((item) => (
              <CommunityCard key={`${item.kind}/${item.id}`} item={item} nowMs={nowMs} />
            ))}
          </div>
        )}
    </StudioPage>
  );
}

/** `useSearchParams` in a client component needs a Suspense boundary — Next
 *  otherwise refuses to statically render the route at build time. Mirrors
 *  /knowledge's own wrapper. */
export default function CommunityBrowserPage() {
  return (
    <Suspense
      fallback={
        <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--faint)', fontSize: 13 }}>
          Loading the community index…
        </div>
      }
    >
      <CommunityBrowserInner />
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// CommunityCard
// ---------------------------------------------------------------------------

function CommunityCard({ item, nowMs }: { item: CommunityItem; nowMs: number }) {
  const freshness = freshnessBadge(item.fetchedAt, nowMs);
  return (
    <Link
      href={`/community/${encodeURIComponent(item.kind)}/${encodeURIComponent(item.id)}`}
      className="lib-card"
      data-card-type="community-item"
      data-item-id={item.id}
      data-item-kind={item.kind}
      data-item-hub={item.hub?.id}
      // W8-B5 (community-05): ABSENT for an item with no registry row — the
      // same discipline data-item-hub / data-fetched-at already hold, never a
      // fabricated attribute value.
      data-item-category={item.category ?? undefined}
      data-install-state={item.installState}
      data-has-signals={item.signals !== null ? 'true' : 'false'}
      data-fetched-at={item.fetchedAt ?? undefined}
      style={{ display: 'block' }}
    >
      <div className="card-top">
        <span className="card-name">{item.name}</span>
        <span className="badge">{item.kind}</span>
      </div>
      <p className="card-body">{item.desc}</p>
      <div className="card-meta">
        <span className="card-stat">{hubLabel(item.hub)}</span>
        <span className="card-stat">{signalsLabel(item.signals)}</span>
        <span className="card-stat">{installStateLabel(item.installState)}</span>
        <span
          className="card-stat"
          data-component="freshness-badge"
          data-freshness={freshness.state}
          style={freshness.state === 'seed' ? { color: 'var(--faint)', fontStyle: 'italic' } : undefined}
        >
          {freshness.label}
        </span>
      </div>
    </Link>
  );
}
