/**
 * forge-nk1y.29 — the launched bridge port as a script, served per request and loaded
 * `beforeInteractive` by `app/layout.tsx`, so the static layout no longer inlines a build-time
 * default that the first bridge call would trust. See `bridgePortScript` (lib/bridge-port.ts).
 */
import { bridgePortScript } from '@/lib/bridge-port';

export const dynamic = 'force-dynamic';

export function GET() {
  return new Response(bridgePortScript(), {
    headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store' },
  });
}
