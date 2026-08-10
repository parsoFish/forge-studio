/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Bridge URL is resolved at runtime via /api/forge-config so the value
  // doesn't have to be present when `next dev` starts. See lib/bridge-client.ts.

  // Moved routes keep a working wire redirect so old bookmarks/deep-links still
  // resolve (R6-03-F3, batch-F ruling 47). The redirect is what a raw request
  // gets — it is served BEFORE any page renders, unlike a client-side
  // router.replace. Library vacated `/` for its own pillar; `/` redirects to
  // `/library` until R6-07 fills `/` with the Home surface, so the hop is
  // temporary (permanent:false → 307), never cached forever by browsers.
  async redirects() {
    return [
      { source: '/', destination: '/library', permanent: false },
    ];
  },
};

export default nextConfig;
