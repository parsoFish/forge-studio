'use client';

import { useState, type CSSProperties } from 'react';
import Link from 'next/link';
import type { Flow, Project, Run } from '@/lib/studio-client';
import { FlowCard } from '@/components/studio/LibraryCard';

// ---------------------------------------------------------------------------
// FlowsIndexBody — the presentational body of `/flows` (W6-IA-2, the flows
// pillar's own browse index; `app/flows/page.tsx` is the thin connected
// shell around it).
//
// Pure, props-driven — mirrors the RunView precedent
// (`lib/run-view-render.test.ts`'s header): every dynamic-route/index page in
// this app is `'use client'` and either fetches via `useEffect` or reads a
// router hook (`usePathname`, here via the sibling `<StudioNav/>`), neither
// of which resolves under bare `react-dom/server` `renderToStaticMarkup`. So
// the render-tested CONTRACT lives on this component, which only ever
// receives the already-resolved flow/run/project lists — never a loading
// state of its own. The connected page decides when data is ready and
// renders this component (or its own "Loading…" text) accordingly; that
// wiring is verified by `tsc`/build only, exactly as RunView's own page glue
// is.
//
// Reuses the REAL `FlowCard` (`components/studio/LibraryCard.tsx`) — same
// card type as the library shelf's flows section, so a flow reached via
// `/flows` looks byte-identical to one reached via `/library`.
//
// "What counts as empty" mirrors `app/library/page.tsx:95-113`'s first-run
// key, NOT a naive `flows.length === 0` — a brand-new install ships ~5 OOTB
// seed flows, so that check is dead code on every real install. THREE
// states, not two:
//   - true-empty (`flows.length === 0`): no flows registered at all. An
//     artificial state a real install never reaches (kept honest rather
//     than assumed unreachable — review round finding).
//   - first-run (`flows.length > 0` but no flow has `origin === 'studio'`):
//     only shipped/OOTB flows exist, the operator hasn't authored one of
//     their own yet. The banner renders ABOVE the grid, not instead of it —
//     the OOTB flows stay visible and runnable underneath.
//   - steady-state (`hasUserFlow`): banner gone, grid only.
// Both "haven't built your first flow" CTAs (true-empty + first-run) share
// `data-action="new-flow-first"` — distinct from the page header's
// ALWAYS-present `data-action="new-flow"` (`app/flows/page.tsx`), so
// automation can tell the one-time onboarding nudge apart from the
// persistent create affordance instead of matching two identical actions.
// ---------------------------------------------------------------------------

export type FlowsIndexBodyProps = {
  flows: Flow[];
  runs: Run[];
  projects: Project[];
};

const FIRST_FLOW_CTA_STYLE: CSSProperties = { textDecoration: 'none', display: 'inline-block' };

export function FlowsIndexBody({ flows, runs, projects }: FlowsIndexBodyProps) {
  // W7-C1 (flows-19): a client-side name/goal/id filter — the agents index
  // precedent. Local UI state only; the true-empty state below renders no
  // filter (nothing to filter).
  const [filter, setFilter] = useState('');

  if (flows.length === 0) {
    return (
      <div
        data-component="flows-zero-state"
        style={{
          padding: '56px 24px',
          textAlign: 'center',
          border: '1px dashed var(--line)',
          borderRadius: 'var(--radius)',
          color: 'var(--dim)',
        }}
      >
        <p style={{ fontSize: 14, margin: '0 0 16px' }}>
          No flows registered at all — string agents together into a pipeline to build your first one.
        </p>
        <Link href="/flows/new" className="btn btn-primary" data-action="new-flow-first" style={FIRST_FLOW_CTA_STYLE}>
          + New flow
        </Link>
      </div>
    );
  }

  // A user-authored flow carries origin 'studio' (PUT /api/studio/flows); the
  // shipped palette ships 'seed'/'ootb-library' and must never suppress this
  // banner — same rule `app/library/page.tsx`'s `hasUserFlow` already
  // encodes for the library shelf's first-run onramp.
  const hasUserFlow = flows.some((f) => f.origin === 'studio');

  const needle = filter.trim().toLowerCase();
  const visibleFlows =
    needle === ''
      ? flows
      : flows.filter(
          (f) =>
            f.id.toLowerCase().includes(needle) ||
            f.name.toLowerCase().includes(needle) ||
            (f.goal ?? '').toLowerCase().includes(needle),
        );

  return (
    <>
      {!hasUserFlow && (
        <div
          data-component="flows-first-run"
          style={{
            marginBottom: 24,
            padding: '20px 24px',
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius)',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <p style={{ fontSize: 13.5, color: 'var(--dim)', margin: 0, flex: 1, minWidth: 240, lineHeight: 1.6 }}>
            Every flow below is a ready-made starter. Build your own to customize the pipeline.
          </p>
          <Link href="/flows/new" className="btn btn-primary" data-action="new-flow-first" style={FIRST_FLOW_CTA_STYLE}>
            + New flow
          </Link>
        </div>
      )}
      {/* W7-C1 (flows-19): filter row — data-flow-visible-count mirrors the
          post-filter grid so automation never has to count cards. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <input
          type="search"
          data-field="flows-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter flows by name or goal…"
          aria-label="Filter flows"
          style={{
            flex: '0 1 320px',
            background: 'var(--bg-2)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text)',
            fontSize: 13,
            padding: '6px 10px',
                      }}
        />
        {needle !== '' && (
          <span style={{ fontSize: 12, color: 'var(--dim)' }}>
            {visibleFlows.length} of {flows.length} flow{flows.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <div
        className="card-grid"
        data-component="flows-grid"
        data-flow-visible-count={visibleFlows.length}
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(288px, 1fr))', gap: 14 }}
      >
        {visibleFlows.map((f, i) => (
          <FlowCard key={f.id} flow={f} runs={runs} projects={projects} index={i} />
        ))}
      </div>
      {visibleFlows.length === 0 && (
        <p data-component="flows-filter-empty" style={{ color: 'var(--dim)', fontSize: 13, padding: '16px 0' }}>
          No flows match “{filter.trim()}”.
        </p>
      )}
    </>
  );
}
