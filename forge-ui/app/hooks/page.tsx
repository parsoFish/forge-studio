'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { StudioPage } from '@/components/StudioPage';
import { fetchHookLibrary, type HookLibraryEntry } from '@/lib/hook-client';
import { filterHooks, needsReviewCountOf, hookBadges, communityHooksToUnion } from '@/lib/hook-library-view';
import { fetchCommunityIndex, type CommunityItem } from '@/lib/community-client';
import { installStateLabel } from '@/lib/community-view';

// ---------------------------------------------------------------------------
// Hooks library — /hooks (R3-03-F4). The local file-package list, plus —
// W7-B3 (library-11) — the COMMUNITY union /skills has had all along: hook
// items from the community index that are not yet installed locally render
// under their own heading, linking into /community/hook/<id> where install
// lives. Facts come from the community index route (executed per item),
// never re-derived here; a failed community fetch renders NOTHING extra
// (absence is honest — it must never blank the primary local list, which is
// why it is a wholly separate effect/failure mode). "New hook" is the ONE
// place hook authoring lives (mirrors skills' D8 data-action="new-skill").
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
  // W7-B3 (library-11) — community hook items, separate fetch + failure mode.
  const [communityItems, setCommunityItems] = useState<CommunityItem[]>([]);

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
    // W7-B3 review F7: kind-scoped fetch — the bridge builds ONLY the hook
    // section (vendored packages), skipping the per-connection probe spawn
    // the full index pays. This page discards every non-hook item anyway.
    fetchCommunityIndex('hook')
      .then((r) => {
        if (!cancelled && r.ok) setCommunityItems(r.items);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const filtered = filterHooks(entries, query);
  const needsReviewCount = needsReviewCountOf(entries);
  const communityHooks = communityHooksToUnion(communityItems, new Set(entries.map((e) => e.id)));

  return (
    <StudioPage
      dataPage="hook-library"
      ready={status !== 'loading'}
      data={{
        'data-hook-count': filtered.length,
        'data-needs-review-count': needsReviewCount,
      }}
      title="Hooks"
      lede={
        <>
          Agent-lifecycle customisations — scripts an agent runs on a lifecycle event (a tool
          use, session start/end, ...). Every hook is scanned before it can run, and an
          operator must explicitly approve or override it.
        </>
      }
      actions={
        <>
          <Link href="/community" data-action="browse-community" className="btn" style={{ whiteSpace: 'nowrap' }}>
            Browse community
          </Link>
          <Link href="/hooks/new" data-action="new-hook" className="btn btn-primary" style={{ whiteSpace: 'nowrap' }}>
            + New hook
          </Link>
        </>
      }
    >

        <input
          type="text"
          data-field="hook-search"
          aria-label="Search hooks"
          placeholder="Search hooks by name or description…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
 width: '100%', maxWidth: 420, marginBottom: 24, background: 'var(--bg-2)',
            border: '1px solid var(--line)', borderRadius: 'var(--radius-sm, 6px)', color: 'var(--text)',
            fontSize: 13, padding: '8px 11px', boxSizing: 'border-box',
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

        {/* W7-B3 (library-11): community hooks not yet installed — the same
            union /skills renders. Cards route to the community detail page,
            where install (and its pre-install scan) lives. */}
        {status === 'ready' && communityHooks.length > 0 && (
          <section data-section="community-hooks" data-count={communityHooks.length} style={{ marginTop: 32 }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 12px' }}>
              Community — not installed
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
              {communityHooks.map((item) => (
                <Link
                  key={item.id}
                  href={`/community/hook/${encodeURIComponent(item.id)}`}
                  className="lib-card"
                  data-card-type="community-hook"
                  data-hook-id={item.id}
                  data-install-state={item.installState}
                  style={{ display: 'block' }}
                >
                  <div className="card-top">
                    <span className="card-name">{item.name}</span>
                    <span className="badge" style={{ color: 'var(--c-kb, #4ade80)', borderColor: 'rgba(74,222,128,.4)', background: 'rgba(74,222,128,.08)' }}>community</span>
                  </div>
                  <p className="card-body">{item.desc}</p>
                  <div className="card-meta">
                    <span className="card-stat">{installStateLabel(item.installState)}</span>
                    <span className="card-stat">install via community →</span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
    </StudioPage>
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
