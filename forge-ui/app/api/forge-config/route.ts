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
 */

export const dynamic = 'force-dynamic';

export function GET() {
  const url = process.env.FORGE_BRIDGE_URL ?? '';
  let bridgePort: number | null = null;
  if (url) {
    try {
      bridgePort = Number(new URL(url).port) || null;
    } catch { /* fall through */ }
  }
  return Response.json({ bridgePort });
}
