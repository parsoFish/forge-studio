'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { StudioNav } from '@/components/StudioNav';
import { fetchHookLibrary, type HookLibraryEntry } from '@/lib/hook-client';
import { filterHooks, needsReviewCountOf, hookBadges } from '@/lib/hook-library-view';

// ---------------------------------------------------------------------------
// Hooks library — /hooks (R3-03-F4). A single flat, already-server-sorted
// list — no Local/Community split (no community-hook catalog or install
// pipeline exists yet; see hook-library-view.test.ts's header for the full
// rationale). "New hook" is the ONE place hook authoring lives (mirrors
// skills' D8 data-action="new-skill").
// ---------------------------------------------------------------------------

const BADGE_STYLE: Record<string, React.CSSProperties> = {
  'needs-review': { color: '#fbbf24', borderColor: 'rgba(251,191,36,.4)', background: 'rgba(251,191,36,.08)' },
  blocked: { color: '#f87171', borderColor: 'rgba(248,113,113,.4)', background: 'rgba(248,113,113,.08)' },
  overridden: { color: 'var(--dim)', borderColor: 'var(--line-2)', background: 'rgba(255,255,255,.04)' },
};

export default function HookLibraryPage() {
  const [entries, setEntries] = useState<HookLibraryEntry[]>([]);
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const r = await fetchHookLibrary();
      if (cancelled) return;
      if (!r.ok) {
        setStatus('error');
        setError(r.error ?? 'could not reach the forge bridge');
        return;
      }
      setEntries(r.hooks);
      setStatus('ready');
      setError(null);
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const filtered = filterHooks(entries, query);
  const needsReviewCount = needsReviewCountOf(entries);

  return (
    <main
      data-page="hook-library"
      data-page-ready={status !== 'loading' ? 'true' : 'false'}
      data-hook-count={filtered.length}
      data-needs-review-count={needsReviewCount}
      style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}
    >
      <StudioNav />
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '32px 28px 64px', width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 22, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--text)', margin: '0 0 6px' }}>
              Hooks
            </h1>
            <p style={{ fontSize: 13.5, color: 'var(--dim)', margin: 0, maxWidth: 560, lineHeight: 1.6 }}>
              Agent-lifecycle customisations — scripts an agent runs on a lifecycle event (a tool
              use, session start/end, ...). Every hook is scanned before it can run, and an
              operator must explicitly approve or override it.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link href="/community" data-action="browse-community" className="btn" style={{ whiteSpace: 'nowrap' }}>
              Browse community
            </Link>
            <Link href="/hooks/new" data-action="new-hook" className="btn btn-primary" style={{ whiteSpace: 'nowrap' }}>
              + New hook
            </Link>
          </div>
        </div>

        <input
          type="text"
          data-field="hook-search"
          placeholder="Search hooks by name or description…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            width: '100%', maxWidth: 420, marginBottom: 24, background: 'var(--bg-2)',
            border: '1px solid var(--line)', borderRadius: 'var(--radius-sm, 6px)', color: 'var(--text)',
            fontSize: 13, padding: '8px 11px', outline: 'none', boxSizing: 'border-box',
          }}
        />

        {status === 'loading' && (
          <div style={{ color: 'var(--dim)', fontSize: 13.5, padding: '24px 0' }}>Loading hooks…</div>
        )}

        {status === 'error' && (
          <div
            data-component="fetch-error"
            style={{ color: '#f87171', fontSize: 13, padding: '14px 16px', border: '1px solid rgba(248,113,113,.35)', borderRadius: 'var(--radius-sm, 6px)', background: 'rgba(248,113,113,.06)' }}
          >
            Could not reach the forge bridge — hooks are unavailable ({error}). This is NOT the
            same as an empty library; retry once the bridge is back up.
          </div>
        )}

        {status === 'ready' && filtered.length === 0 && (
          <div style={{ color: 'var(--faint)', fontSize: 13, fontStyle: 'italic', padding: '24px 0' }}>
            {query ? 'No hooks match your search.' : 'No hooks yet — author one to get started.'}
          </div>
        )}

        {status === 'ready' && filtered.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
            {filtered.map((entry) => (
              <HookCard key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// HookCard
// ---------------------------------------------------------------------------

function HookCard({ entry }: { entry: HookLibraryEntry }) {
  if (!entry.ok) {
    return (
      <Link
        href={`/hooks/${encodeURIComponent(entry.id)}`}
        className="lib-card"
        data-card-type="hook"
        data-hook-id={entry.id}
        style={{ display: 'block' }}
      >
        <div className="card-top">
          <span className="card-name">{entry.id}</span>
          <span className="badge" style={BADGE_STYLE.blocked}>malformed</span>
        </div>
        <p style={{ fontSize: 11.5, color: '#f87171', margin: 0 }}>{entry.error}</p>
      </Link>
    );
  }

  const badges = hookBadges(entry);
  const carriedByCount = entry.carriedBy.length;

  return (
    <Link
      href={`/hooks/${encodeURIComponent(entry.id)}`}
      className="lib-card"
      data-card-type="hook"
      data-hook-id={entry.id}
      data-hook-event={entry.on}
      data-hook-verdict={entry.scanVerdict}
      data-hook-trust={entry.trust}
      data-hook-carried-by-count={carriedByCount}
      style={{ display: 'block' }}
    >
      <div className="card-top">
        <span className="card-name">{entry.name}</span>
        {badges.map((b) => (
          <span key={b} className="badge" style={BADGE_STYLE[b]}>{b}</span>
        ))}
      </div>
      <p className="card-body">{entry.description || 'No description.'}</p>
      <div className="card-meta">
        <span className="card-stat">{entry.on}</span>
        <span className="card-stat">{carriedByCount} agent{carriedByCount === 1 ? '' : 's'}</span>
      </div>
    </Link>
  );
}
