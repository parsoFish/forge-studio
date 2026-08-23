import Link from 'next/link';
import type { HookLibraryEntry } from '@/lib/hook-client';
import { hookBadges } from '@/lib/hook-library-view';
import type { CommunityItem } from '@/lib/community-client';
import { installStateLabel } from '@/lib/community-view';

// ---------------------------------------------------------------------------
// HookLibraryResults — the /hooks results block (loading/error/empty-
// state/local grid/community section), extracted OUT of
// app/hooks/page.tsx into its own component (W8-B4) for two reasons:
//
//  1. Testability — a pure, props-driven component (no fetch, no
//     useEffect) can be rendered directly via react-dom/server's
//     renderToStaticMarkup with fixed props
//     (forge-ui/lib/hooks-page-render.test.ts), mirroring this exact
//     precedent for the Library shelves (components/studio/LibraryHub.tsx,
//     pinned by lib/library-hub-render.test.ts).
//  2. Next.js App Router constraint — a `page.tsx` file may ONLY export the
//     framework's own whitelisted names (default, metadata,
//     generateStaticParams, ...); any other named export fails
//     `next build`'s generated route-type check
//     (`.next/types/app/hooks/page.ts`, `OmitWithTag<...> does not satisfy
//     the constraint '{ [x: string]: never }'`). This component must live
//     outside `app/` to be exported and unit-tested at all — confirmed by
//     reproducing that exact tsc error when it briefly lived in page.tsx.
//
// W8-B4 (library-38, S2 regression): the empty state is gated on BOTH lists
// being empty (`filtered.length === 0 && communityHooks.length === 0`) —
// the pre-fix code checked `filtered.length` alone, so a query matching
// only a community hook rendered "No hooks match your search." directly
// above the matching card. `communityHooks` here is ALREADY query-filtered
// by the caller (app/hooks/page.tsx) — this component never re-filters.
//
// W8-B4 (library-09, S2 PARTIAL): `hookBadges()` now has a positive
// 'approved' arm (lib/hook-library-view.ts) — HookCard below renders
// whatever it returns generically, so the fix reaches this render site
// (call site 1; components/studio/LibraryHub.tsx's ShelfHookCard is call
// site 2 — see lib/library-hub-render.test.ts) without any change here.
// ---------------------------------------------------------------------------

const BADGE_STYLE: Record<string, React.CSSProperties> = {
  'needs-review': { color: '#fbbf24', borderColor: 'rgba(251,191,36,.4)', background: 'rgba(251,191,36,.08)' },
  blocked: { color: '#f87171', borderColor: 'rgba(248,113,113,.4)', background: 'rgba(248,113,113,.08)' },
  overridden: { color: 'var(--dim)', borderColor: 'var(--line-2)', background: 'rgba(255,255,255,.04)' },
  // W8-B4 (library-09): the ONE positive arm, matching InstallStateBadge's
  // own positive-state color token (components/studio/LibraryHub.tsx —
  // `var(--sage, #7cb87c)`) rather than inventing a new one.
  approved: { color: 'var(--sage, #7cb87c)', borderColor: 'rgba(124,184,124,.4)', background: 'rgba(124,184,124,.08)' },
};

export type HookLibraryResultsProps = {
  status: 'loading' | 'error' | 'ready';
  error: string | null;
  query: string;
  filtered: HookLibraryEntry[];
  communityHooks: readonly CommunityItem[];
};

export function HookLibraryResults({ status, error, query, filtered, communityHooks }: HookLibraryResultsProps) {
  return (
    <>
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

      {status === 'ready' && filtered.length === 0 && communityHooks.length === 0 && (
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
    </>
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
