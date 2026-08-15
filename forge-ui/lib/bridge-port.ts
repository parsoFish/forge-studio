/**
 * Server-side derivation of the bridge PORT from `FORGE_BRIDGE_URL` — the env
 * var `cli/forge-watch.ts` sets on the Next.js process (`uiEnv`, both the
 * `next dev` and `next start` spawn paths). Never a host: WSL2 + Windows
 * browser needs the host to come from `window.location.hostname` client-side
 * (brain/cycles/themes/windows-browser-to-wsl-via-window-location.md) — this
 * helper only ever hands back the port number the client composes into a URL.
 *
 * Shared by two call sites (W6-P4):
 *   - `app/api/forge-config/route.ts` — the pre-W6-P4 fetch fallback, kept
 *     for any caller that predates the inlined-global fast path.
 *   - `app/layout.tsx` — the zero-RTT path: inlines this same value as a
 *     `window.__FORGE_BRIDGE_PORT__` global in the initial HTML so
 *     `resolveBridgeUrl()` (lib/bridge-client.ts) can skip the
 *     `/api/forge-config` round trip entirely.
 */
export function resolveBridgePortFromEnv(env: NodeJS.ProcessEnv = process.env): number | null {
  const url = env.FORGE_BRIDGE_URL ?? '';
  if (!url) return null;
  try {
    return Number(new URL(url).port) || null;
  } catch {
    return null;
  }
}
