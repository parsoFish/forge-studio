import Link from 'next/link';

// ---------------------------------------------------------------------------
// KnowledgeEmptyState — the Knowledge page's honest "no KBs yet" state
// (W6-IA-4 sweep finding C4#1).
//
// Before this, an empty-KB list left `ready` false FOREVER: the "Resolve
// active KB id" effect only sets `currentId` when `allKbs.length > 0`, and
// the "Load KB detail" effect (the ONLY place `ready` was ever set to
// `true`) starts with `if (!currentId) return;` — so a genuinely empty
// install never reached `data-page-ready="true"` at all, and the Explore
// tab rendered the generic "Loading…" text forever, never the honest
// "No KB data available." branch it already had for a settled-but-empty
// graph.
//
// A pure, presentational leaf component (no fetch, no StudioNav/StudioPage
// nesting) so it renders under `renderToStaticMarkup` with no mocking at
// all — see `../../../lib/knowledge-empty-state-render.test.ts`.
// ---------------------------------------------------------------------------

export function KnowledgeEmptyState() {
  return (
    <div
      data-component="knowledge-empty"
      style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 14, padding: 40, textAlign: 'center',
      }}
    >
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text)', margin: 0 }}>
        No knowledge bases yet
      </h2>
      <p style={{ fontSize: 13.5, color: 'var(--dim)', maxWidth: 420, lineHeight: 1.6, margin: 0 }}>
        Knowledge bases hold the compounding brain every planner, reflector, and reviewer reads from.
        Create the first one to get started.
      </p>
      {/* data-action="new-kb-empty-cta" — DISTINCT from the page header's
          ALWAYS-present `data-action="new-kb"` (app/knowledge/page.tsx),
          so a selector for either one is never ambiguous when both render
          at once (a genuinely empty KB roster). Mirrors the established
          "-first"/base-action naming split already used for the flows
          index's first-run CTA (FlowsIndexBody.tsx's `new-flow-first`
          alongside app/flows/page.tsx's own always-present `new-flow`). */}
      <Link href="/knowledge/new" className="btn btn-primary" data-action="new-kb-empty-cta" style={{ textDecoration: 'none' }}>
        + New knowledge base
      </Link>
    </div>
  );
}
