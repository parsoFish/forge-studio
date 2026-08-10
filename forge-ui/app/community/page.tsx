'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { StudioPage } from '@/components/StudioPage';
import { fetchCommunityIndex, COMMUNITY_KINDS, type CommunityItem, type CommunityHubWithCount, type CommunityKind } from '@/lib/community-client';
import { filterByKind, filterCommunityItems, installStateLabel, signalsLabel, hubLabel } from '@/lib/community-view';

// ---------------------------------------------------------------------------
// Community browser — /community (R3-07-F1). The ONE cross-kind browse
// surface over skills, hooks, MCPs and tools — the per-kind marketplace
// stubs this initiative retires (F1/F2 on /skills). Every hub, item, install
// state and signal below is exactly what the bridge computed — no re-derived
// state, no fabricated default (house rule, restated per this initiative's
// own D2: this page owns ZERO trust decisions — install ROUTES to the
// owning pipeline's page, it never approves or overrides anything itself).
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
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<CommunityKind | 'all'>('all');
  const [query, setQuery] = useState('');

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
  const filtered = filterCommunityItems(byKind, query);

  return (
    <StudioPage
      dataPage="community-browser"
      ready={status !== 'loading'}
      data={{
        'data-item-count': filtered.length,
        'data-kind-filter': kind,
        'data-hub-count': hubs.length,
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
              <CommunityCard key={`${item.kind}/${item.id}`} item={item} />
            ))}
          </div>
        )}
    </StudioPage>
  );
}

// ---------------------------------------------------------------------------
// CommunityCard
// ---------------------------------------------------------------------------

function CommunityCard({ item }: { item: CommunityItem }) {
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
      </div>
    </Link>
  );
}
