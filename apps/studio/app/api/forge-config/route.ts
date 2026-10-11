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
 * forge-nk1y.29: `./script` serves the same port as `window.__FORGE_BRIDGE_PORT__`, loaded
 * before hydration by `app/layout.tsx`; `resolveBridgeUrl()` asks THIS route before its first
 * bridge call whenever that global is absent, and after any invalidation.
 */
import { resolveBridgePortFromEnv } from '@/lib/bridge-port';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ bridgePort: resolveBridgePortFromEnv() });
}
