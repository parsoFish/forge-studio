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
  // rule is retired outright rather than repointed. No route is presently
  // moved-with-nowhere-else-serving-the-old-path, so `redirects()` returns an
  // empty array — kept (not deleted) as the single source the moment forge
  // grows a genuinely moved route again.
  async redirects() {
    return [];
  },
};

export default nextConfig;
