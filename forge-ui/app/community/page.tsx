'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { StudioPage } from '@/components/StudioPage';
import { fetchCommunityIndex, COMMUNITY_KINDS, type CommunityItem, type CommunityHubWithCount, type CommunityKind, type CommunityIndexMeta } from '@/lib/community-client';
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
  COMMUNITY_SORT_KEYS,
  COMMUNITY_SORT_LABELS,
  DEFAULT_COMMUNITY_SORT_KEY,
  DEFAULT_COMMUNITY_SORT_DIRECTION,
  type CommunitySortKey,
  type CommunitySortDirection,
} from '@/lib/community-view';

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
// ---------------------------------------------------------------------------

const KIND_FILTERS: Array<CommunityKind | 'all'> = ['all', ...COMMUNITY_KINDS];

const KIND_LABEL: Record<CommunityKind | 'all', string> = {
  all: 'All',
  skill: 'Skills',
  hook: 'Hooks',
  mcp: 'MCPs',
  tool: 'Tools',
};

export default function CommunityBrowserPage() {
  const [hubs, setHubs] = useState<CommunityHubWithCount[]>([]);
  const [items, setItems] = useState<CommunityItem[]>([]);
  const [meta, setMeta] = useState<CommunityIndexMeta | null>(null);
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<CommunityKind | 'all'>('all');
  // W7-B3 (community-17): hub chips filter the LOCAL index; null = all hubs.
  const [hubFilter, setHubFilter] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<CommunitySortKey>(DEFAULT_COMMUNITY_SORT_KEY);
  const [sortDir, setSortDir] = useState<CommunitySortDirection>(DEFAULT_COMMUNITY_SORT_DIRECTION);
  const [nowMs] = useState(() => Date.now());
  // W7-B3 (community-16): the refresh sessions this surface used to lose —
  // in-flight (non-terminal) + the most recent terminal one, from the SAME
  // sessions index /sessions reads. Advisory: a failed read keeps [] (the
  // strip renders nothing false; the index itself carries its own state).
  const [refreshSessions, setRefreshSessions] = useState<SessionIndexRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const r = await fetchCommunityIndex();
      if (cancelled) return;
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
    }
    void load();
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

  const byKind = filterByKind(items, kind);
  const byHub = filterByHub(byKind, hubFilter);
  const searched = filterCommunityItems(byHub, query);
  const filtered = sortCommunityItems(searched, sortKey, sortDir);
  const inFlightRefresh = refreshSessions.filter((row) => !row.terminal);
  const lastTerminalRefresh = lastTerminalRefreshOf(refreshSessions);

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
          <Link
            href="/sessions/community-refresh/new"
            data-action="refresh-community-registry"
            className="btn btn-sm"
            title="Kick off the community-refresh agent — fetches real upstream signals and drafts a reviewable diff of the registry (W6-CR-3)"
          >
            Refresh registry (agent)
          </Link>
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

        {status === 'ready' && (
          <div data-component="hub-strip" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
            {hubs.map((hub) => {
              const declaredOnly = hub.itemCount === 0;
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
                    onClick={() => setHubFilter((prev) => (prev === hub.id ? null : hub.id))}
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
          <input
            type="text"
            data-field="community-search"
            placeholder="Search by name, id, description, hub or provenance…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              width: '100%', maxWidth: 340, background: 'var(--bg-2)',
              border: '1px solid var(--line)', borderRadius: 'var(--radius-sm, 6px)', color: 'var(--text)',
              fontSize: 13, padding: '8px 11px', outline: 'none', boxSizing: 'border-box',
            }}
          />
          {KIND_FILTERS.map((k) => (
            <button
              key={k}
              type="button"
              data-action="filter-kind"
              data-kind={k}
              className="btn btn-sm"
              onClick={() => setKind(k)}
              style={k === kind ? { borderColor: 'var(--ember, #FF9E4A)', color: 'var(--text)' } : undefined}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
          <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--line)', margin: '0 2px' }} />
          <select
            data-community-sort
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as CommunitySortKey)}
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
            onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
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
          <div style={{ color: 'var(--faint)', fontSize: 13, fontStyle: 'italic', padding: '24px 0' }}>
            {query || kind !== 'all' || hubFilter !== null ? 'Nothing matches this filter.' : 'The community index is empty.'}
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
