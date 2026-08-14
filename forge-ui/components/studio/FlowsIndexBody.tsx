'use client';

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
// ---------------------------------------------------------------------------

export type FlowsIndexBodyProps = {
  flows: Flow[];
  runs: Run[];
  projects: Project[];
};

export function FlowsIndexBody({ flows, runs, projects }: FlowsIndexBodyProps) {
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
          No flows yet — string agents together into a pipeline to build your first one.
        </p>
        <Link
          href="/flows/new"
          className="btn btn-primary"
          data-action="new-flow"
          style={{ textDecoration: 'none', display: 'inline-block' }}
        >
          + New flow
        </Link>
      </div>
    );
  }

  return (
    <div
      className="card-grid"
      data-component="flows-grid"
      style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(288px, 1fr))', gap: 14 }}
    >
      {flows.map((f, i) => (
        <FlowCard key={f.id} flow={f} runs={runs} projects={projects} index={i} />
      ))}
    </div>
  );
}
