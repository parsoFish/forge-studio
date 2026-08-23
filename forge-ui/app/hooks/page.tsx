'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { StudioPage } from '@/components/StudioPage';
import { HookLibraryResults } from '@/components/studio/HookLibraryResults';
import { fetchHookLibrary, type HookLibraryEntry } from '@/lib/hook-client';
import { filterHooks, needsReviewCountOf, communityHooksToUnion } from '@/lib/hook-library-view';
import { fetchCommunityIndex, type CommunityItem } from '@/lib/community-client';
import { filterCommunityItems } from '@/lib/community-view';

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
  // W8-B4 (library-38, S2 regression): the community union MUST be filtered
  // by the SAME query as the local list — the pre-fix code derived
  // `communityHooks` with no query applied at all, so a query matching only
  // a community hook rendered "No hooks match your search." directly ABOVE
  // the matching card (the empty state was gated on the local `filtered`
  // count alone). `filterCommunityItems` is the SAME query-match function
  // the real /community browser already uses (community-view.ts) — reused,
  // not re-derived.
  const communityHooksAll = communityHooksToUnion(communityItems, new Set(entries.map((e) => e.id)));
  const communityHooks = filterCommunityItems(communityHooksAll, query);

  return (
    <StudioPage
      dataPage="hook-library"
      ready={status !== 'loading'}
      data={{
        // W8-B4 (library-38 count half — kept SURGICALLY SEPARATE from the
        // search/empty-state fix below; see hook-library-view.ts's own
        // header and this WI's report for why): data-hook-count now counts
        // BOTH lists, mirroring /skills' data-skill-count (grouped.total —
        // every entry in its fetched+filtered list, never just a subset).
        // This is a load-bearing data-* contract
        // (docs/forge-ui-dom-and-harness.md) driven by
        // scripts/journeys/hooks.mjs — if this one line is ever reverted on
        // its own, revert it to `filtered.length` and nothing else in this
        // file needs to change.
        'data-hook-count': filtered.length + communityHooks.length,
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

        <HookLibraryResults status={status} error={error} query={query} filtered={filtered} communityHooks={communityHooks} />
    </StudioPage>
  );
}
