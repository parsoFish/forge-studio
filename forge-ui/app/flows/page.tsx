'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { StudioNav } from '@/components/StudioNav';
import { FlowsIndexBody } from '@/components/studio/FlowsIndexBody';
import {
  fetchStudioFlows,
  fetchRuns,
  fetchStudioProjects,
  type Flow,
  type Project,
  type Run,
} from '@/lib/studio-client';

// ---------------------------------------------------------------------------
// Flows index — /flows (W6-IA-2).
//
// The flows pillar's own browse surface: every flow the operator can run, as
// a card grid (reusing the REAL FlowCard from the library shelf's flows
// section), with a zero-state carrying the same "+ New flow" CTA when none
// exist yet. `StudioNav.tsx`'s Flows nav item still deep-links straight to
// `/flows/forge-develop` — repointing it to this index is a LATER lane
// (IA-5) and is deliberately NOT done here; this route is reached today via
// direct navigation and its own card on `/library`.
//
// This is a thin connected shell: all render CONTRACT (grid rows,
// zero-state, card reuse) lives on `FlowsIndexBody`
// (components/studio/FlowsIndexBody.tsx), which is render-tested directly —
// see `lib/flows-index-render.test.ts`'s header for why the page itself
// isn't (a `useEffect` fetch that doesn't run under SSR-style rendering,
// same known gap as every other dynamic Studio page).
// ---------------------------------------------------------------------------

export default function FlowsIndexPage() {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [f, r, p] = await Promise.all([fetchStudioFlows(), fetchRuns(), fetchStudioProjects()]);
      if (cancelled) return;
      setFlows(f);
      setRuns(r);
      setProjects(p);
      setReady(true);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main
      data-page="flows-index"
      data-page-ready={ready ? 'true' : 'false'}
      data-flow-count={flows.length}
      style={{ minHeight: '100vh', background: 'var(--bg)' }}
    >
      <StudioNav />

      <div className="page-wrap" style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 28px 64px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 20 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--text)', margin: 0 }}>
            Flows
          </h1>
          <span
            className="lib-count"
            style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--faint)', background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 4, padding: '1px 7px' }}
          >
            {flows.length}
          </span>
          <span style={{ flex: 1 }} />
          <Link
            href="/flows/new"
            className="btn btn-primary"
            data-action="new-flow"
            style={{ textDecoration: 'none' }}
          >
            + New flow
          </Link>
        </div>

        {ready ? (
          <FlowsIndexBody flows={flows} runs={runs} projects={projects} />
        ) : (
          <div style={{ color: 'var(--faint)', fontSize: 13, padding: '24px 0' }}>Loading flows…</div>
        )}
      </div>
    </main>
  );
}
