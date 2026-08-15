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
 * W6-P4 (redesigned per review): this route is now the AUTHORITATIVE
 * CORRECTION path, not the hot path — `app/layout.tsx` inlines the
 * fixed-port convention's DEFAULT (a build-time literal, `lib/bridge-port.ts`'s
 * `DEFAULT_BRIDGE_PORT` — never this route's env read) as
 * `window.__FORGE_BRIDGE_PORT__`, so `resolveBridgeUrl()`
 * (lib/bridge-client.ts) tries that optimistically first with ZERO network
 * round-trips. This route is only hit when that first real bridge call
 * fails outright (e.g. a `--bridge-port` override moved the bridge off the
 * default) — `resolveBridgeUrl`'s one-shot correction falls back here for
 * the real, env-derived answer.
 */
import { resolveBridgePortFromEnv } from '@/lib/bridge-port';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ bridgePort: resolveBridgePortFromEnv() });
}
