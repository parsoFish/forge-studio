'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { StudioNav } from '@/components/StudioNav';
import { fetchConnections, type ConnectionWire, type ConnectionKind } from '@/lib/connection-client';
import { filterConnections, readinessCounts, connectionBadges, type ConnectionBadge } from '@/lib/connection-library-view';

// ---------------------------------------------------------------------------
// Connections library — /connections (R3-04-F2). A single flat,
// already-server-sorted list of curated tools + MCP servers read from
// studio/catalog.yaml. "Connections" is the pillar label on this surface
// (roadmap's wave-5 amendment) even though the catalog sections underneath
// stay `tools:`/`mcps:` (D2 — kind is structural, never a third invented
// kind). There is NO create/edit affordance anywhere on this route or its
// detail page — curation happens by PR to catalog.yaml (D1).
// ---------------------------------------------------------------------------

const BADGE_STYLE: Record<ConnectionBadge, React.CSSProperties> = {
  'not-installed': { color: 'var(--dim)', borderColor: 'var(--line-2)', background: 'rgba(255,255,255,.04)' },
  misconfigured: { color: '#fbbf24', borderColor: 'rgba(251,191,36,.4)', background: 'rgba(251,191,36,.08)' },
  curated: { color: 'var(--dim)', borderColor: 'var(--line-2)', background: 'rgba(255,255,255,.04)' },
};

const KIND_LABEL: Record<ConnectionKind, string> = { tool: 'Tool', mcp: 'MCP' };

function installMethodLabel(entry: ConnectionWire): string {
  switch (entry.install.method) {
    case 'system-provided':
      return 'System-provided';
    case 'npm':
      return `npm · pinned ${entry.install.version}`;
    case 'external':
      return 'External — no forge install';
  }
}

export default function ConnectionLibraryPage() {
  const [entries, setEntries] = useState<ConnectionWire[]>([]);
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const r = await fetchConnections();
      if (cancelled) return;
      if (!r.ok) {
        setStatus('error');
        setError(r.error ?? 'could not reach the forge bridge');
        return;
      }
      setEntries(r.connections);
      setStatus('ready');
      setError(null);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = filterConnections(entries, query);
  const counts = readinessCounts(entries);

  return (
    <main
      data-page="connection-library"
      data-page-ready={status !== 'loading' ? 'true' : 'false'}
      data-connection-count={filtered.length}
      data-available-count={counts.available}
      data-not-installed-count={counts.notInstalled}
      data-misconfigured-count={counts.misconfigured}
      style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}
    >
      <StudioNav />
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '32px 28px 64px', width: '100%' }}>
        <div style={{ marginBottom: 22 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--text)', margin: '0 0 6px' }}>
            Connections
          </h1>
          <p style={{ fontSize: 13.5, color: 'var(--dim)', margin: 0, maxWidth: 620, lineHeight: 1.6 }}>
            Curated tools and MCP servers an agent can be given — read from
            <code style={{ margin: '0 4px' }}>studio/catalog.yaml</code>. Readiness below is the REAL result of
            probing each entry&apos;s own install + config, never a declared status. Curation happens by PR to
            the catalog — there is no create/edit surface here.
          </p>
        </div>

        {status === 'ready' && (
          <div
            data-component="readiness-summary"
            style={{ display: 'flex', gap: 14, marginBottom: 18, flexWrap: 'wrap', fontSize: 12, color: 'var(--dim)' }}
          >
            <span>{counts.available} available</span>
            <span>{counts.notInstalled} not installed</span>
            <span>{counts.misconfigured} misconfigured</span>
          </div>
        )}

        <input
          type="text"
          data-field="connection-search"
          placeholder="Search connections by name or description…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            width: '100%',
            maxWidth: 420,
            marginBottom: 24,
            background: 'var(--bg-2)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-sm, 6px)',
            color: 'var(--text)',
            fontSize: 13,
            padding: '8px 11px',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />

        {status === 'loading' && (
          <div style={{ color: 'var(--dim)', fontSize: 13.5, padding: '24px 0' }}>Loading connections…</div>
        )}

        {status === 'error' && (
          <div
            data-component="fetch-error"
            style={{
              color: '#f87171',
              fontSize: 13,
              padding: '14px 16px',
              border: '1px solid rgba(248,113,113,.35)',
              borderRadius: 'var(--radius-sm, 6px)',
              background: 'rgba(248,113,113,.06)',
            }}
          >
            Could not reach the forge bridge — connections are unavailable ({error}). This is NOT the same as an
            empty library; retry once the bridge is back up.
          </div>
        )}

        {status === 'ready' && filtered.length === 0 && (
          <div style={{ color: 'var(--faint)', fontSize: 13, fontStyle: 'italic', padding: '24px 0' }}>
            {query ? 'No connections match your search.' : 'No connections in the catalog.'}
          </div>
        )}

        {status === 'ready' && filtered.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
            {filtered.map((entry) => (
              <ConnectionCard key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// ConnectionCard
// ---------------------------------------------------------------------------

function ConnectionCard({ entry }: { entry: ConnectionWire }) {
  const badges = connectionBadges(entry);

  return (
    <Link
      href={`/connections/${encodeURIComponent(entry.id)}`}
      className="lib-card"
      data-card-type="connection"
      data-connection-id={entry.id}
      data-connection-kind={entry.kind}
      data-connection-state={entry.probe.state}
      style={{ display: 'block' }}
    >
      <div className="card-top">
        <span className="card-name">{entry.name}</span>
        <span className="badge">{KIND_LABEL[entry.kind]}</span>
        {badges.map((b) => (
          <span key={b} className="badge" style={BADGE_STYLE[b]}>
            {b}
          </span>
        ))}
      </div>
      <p className="card-body">{entry.desc || 'No description.'}</p>
      <div className="card-meta">
        <span className="card-stat">{installMethodLabel(entry)}</span>
        <span className="card-stat">{entry.usedBy.length} agent{entry.usedBy.length === 1 ? '' : 's'}</span>
      </div>
    </Link>
  );
}
