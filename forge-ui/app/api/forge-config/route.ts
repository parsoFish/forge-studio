/**
 * Runtime config endpoint — exposes the bridge PORT (not full URL) the
 * client should talk to.
 *
 * Why port-only: the client builds the bridge URL using
 * `window.location.hostname` + port. This is critical for WSL2 + Windows
 * browser: the browser sees `localhost`, and WSL2 auto-forwards
 * `localhost:<port>` to the WSL-side process. Returning `127.0.0.1:<port>`
 * would make the Windows browser hit its own loopback (where nothing is
 * listening). The Next.js API route reads FORGE_BRIDGE_URL server-side
 * and extracts the port.
 *
 * W6-P4: this route is now the FALLBACK path only — `app/layout.tsx` inlines
 * the same port (via the shared `resolveBridgePortFromEnv` this route also
 * calls) as `window.__FORGE_BRIDGE_PORT__` in the initial HTML, so
 * `resolveBridgeUrl()` (lib/bridge-client.ts) resolves with zero network
 * round-trips on the common path. This route stays live for any caller that
 * reads it directly (or a future entry point that isn't behind the root
 * layout).
 */
import { resolveBridgePortFromEnv } from '@/lib/bridge-port';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ bridgePort: resolveBridgePortFromEnv() });
}
