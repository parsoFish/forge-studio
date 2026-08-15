/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Bridge URL is resolved at runtime via /api/forge-config so the value
  // doesn't have to be present when `next dev` starts. See lib/bridge-client.ts.

  // Moved routes keep a working wire redirect so old bookmarks/deep-links still
  // resolve (R6-03-F3, batch-F ruling 47). `/` was the interim exception:
  // Library vacated `/` for its own pillar and `/` redirected to `/library`
  // until R6-07 filled `/` with the Home surface. R6-07 is that moment — `/`
  // is reclaimed as its own first-class route (app/page.tsx), so the old
  // rule is retired outright rather than repointed. This is the single
  // source for every *pure path-shape* move (no data lookup needed to know
  // the destination) — W6-IA-8 populated it for the first time, retiring the
  // client-shim pages that used to do this same mapping at runtime. A
  // data-dependent legacy route (one whose destination needs a lookup, e.g.
  // `/demo/[sessionId]` resolving its owning project) stays a page, not an
  // entry here.
  async redirects() {
    return [
      // Architect (M7-4 / R2-10 PR2, WI-8, ADR-031): interview + PLAN gate
      // consolidated onto the shared session shell. `/interview` is listed
      // first so a request never chains through two redirect hops.
      {
        source: '/architect/:sessionId/interview',
        destination: '/sessions/architect/:sessionId',
        permanent: true,
      },
      {
        source: '/architect/:sessionId',
        destination: '/sessions/architect/:sessionId',
        permanent: true,
      },
      // Instructions-creator interview (R2-10 PR2, WI-8): same shared-session-
      // shell consolidation.
      {
        source: '/instructions/:sessionId',
        destination: '/sessions/instructions/:sessionId',
        permanent: true,
      },
      // Project-brain builder review (R2-10 PR2, WI-8): same shared-session-
      // shell consolidation. Next forwards any unmatched query string (the
      // shim's `?project=` fallback hint) onto the destination automatically.
      {
        source: '/project-brain/:sessionId',
        destination: '/sessions/project-brain/:sessionId',
        permanent: true,
      },
      // Review human moment (M7-3, ADR-031): unified artifact viewer.
      {
        source: '/review/:cycleId',
        destination: '/artifact?run=:cycleId&type=verdict&mode=gate',
        permanent: true,
      },
      // Reflection human moment (M7-3, ADR-031): unified artifact viewer.
      {
        source: '/reflect/:cycleId',
        destination: '/artifact?run=:cycleId&type=reflection&mode=view',
        permanent: true,
      },
      // Stuck-initiative recovery surface (R4-11-T3): folded onto the
      // library's per-project roadmap InitiativeCard.
      {
        source: '/recovery',
        destination: '/library',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
