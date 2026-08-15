'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { StudioPage } from '@/components/StudioPage';
import { fetchCommunityIndex, COMMUNITY_KINDS, type CommunityItem, type CommunityHubWithCount, type CommunityKind } from '@/lib/community-client';
import {
  filterByKind,
  filterCommunityItems,
  installStateLabel,
  signalsLabel,
  hubLabel,
  sortCommunityItems,
  freshnessBadge,
  COMMUNITY_SORT_KEYS,
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

const SORT_KEY_LABEL: Record<CommunitySortKey, string> = {
  name: 'Name',
  stars: 'Stars',
  updated: 'Updated',
  source: 'Source',
};

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
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<CommunityKind | 'all'>('all');
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<CommunitySortKey>(DEFAULT_COMMUNITY_SORT_KEY);
  const [sortDir, setSortDir] = useState<CommunitySortDirection>(DEFAULT_COMMUNITY_SORT_DIRECTION);
  const [nowMs] = useState(() => Date.now());

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
      setStatus('ready');
      setError(null);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const byKind = filterByKind(items, kind);
  const searched = filterCommunityItems(byKind, query);
  const filtered = sortCommunityItems(searched, sortKey, sortDir);

  return (
    <StudioPage
      dataPage="community-browser"
      ready={status !== 'loading'}
      data={{
        'data-item-count': filtered.length,
        'data-kind-filter': kind,
        'data-hub-count': hubs.length,
        'data-sort-key': sortKey,
        'data-sort-dir': sortDir,
      }}
      title="Community"
      lede={
        <>
          One browser over every source hub — skills, hooks, MCP servers and tools. Installing pulls a copy
          into the matching local library with provenance and hub signals kept; approval (if the object needs
          it) happens on its own owning page, never here.
        </>
      }
    >

        {status === 'ready' && (
          <div data-component="hub-strip" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
            {hubs.map((hub) => (
              <a
                key={hub.id}
                href={hub.url}
                target="_blank"
                rel="noreferrer"
                data-hub-id={hub.id}
                data-hub-kinds={hub.kinds}
                data-hub-item-count={hub.itemCount}
                className="badge"
                style={{ textDecoration: 'none' }}
                title={hub.kinds}
              >
                {hub.name} <span style={{ color: 'var(--faint)' }}>· {hub.itemCount}</span>
              </a>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24, alignItems: 'center' }}>
          <input
            type="text"
            data-field="community-search"
            placeholder="Search the community index by name or description…"
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
                Sort: {SORT_KEY_LABEL[k]}
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
            {query || kind !== 'all' ? 'Nothing matches this filter.' : 'The community index is empty.'}
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
