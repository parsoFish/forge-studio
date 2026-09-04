import type { ReactNode } from 'react';
import './globals.css';
import { DEFAULT_BRIDGE_PORT } from '@/lib/bridge-port';
import { BridgeStatus } from '@/components/BridgeStatus';
import { SkipLink } from '@/components/SkipLink';

export const metadata = {
  title: 'forge',
  description: 'Operator UI for the forge autonomous multi-agent orchestrator.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // W6-P4 (redesigned per review): zero-RTT bridge URL discovery WITHOUT
  // trading away static prerendering. `DEFAULT_BRIDGE_PORT` is a plain
  // build-time literal (the fixed-port convention's default — CLAUDE.md,
  // apps/forge/forge-watch.ts's own `DEFAULT_BRIDGE_PORT`), NOT an env read, so
  // this layout has no per-request data and stays fully static — Next.js
  // prerenders it once, same as main before W6-P4 (a prior version of this
  // change added `dynamic = 'force-dynamic'` here and dynamized all 30
  // routes, trading away the 16 static shells main already had for a
  // per-request fact that has a stable default — exactly the trade this
  // redesign avoids).
  //
  // `lib/bridge-client.ts`'s `resolveBridgeUrl()` reads this global first
  // and uses it OPTIMISTICALLY for the first bridge call — zero-RTT in the
  // common case (the bridge really is on the fixed-port default). The host
  // segment still always comes from `window.location.hostname`, never from
  // here (windows-browser-to-wsl-via-window-location.md — WSL2 + a Windows
  // browser only resolves via the browser's own origin). If that first real
  // bridge call fails outright (e.g. a `--bridge-port` override moved the
  // bridge off the default), `resolveBridgeUrl` falls back to the
  // authoritative, env-derived `/api/forge-config` route and retries once —
  // see that file's header for the full resolution order.
  //
  // W7-A1: `<BridgeStatus />` (a client component) is mounted HERE, once,
  // so every route carries the shared bridge-liveness banner + the
  // `[data-bridge-status]` attribute — see components/BridgeStatus.tsx.
  // Mounting a client component keeps this layout a static server shell.
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial',
          background: '#0c1115',
          color: '#e6edf3',
        }}
      >
        <script
          dangerouslySetInnerHTML={{ __html: `window.__FORGE_BRIDGE_PORT__=${DEFAULT_BRIDGE_PORT};` }}
        />
        {/* W7-C3 (crosscut-18): the skip-to-content link is the first tab
            stop on every route — see components/SkipLink.tsx. */}
        <SkipLink />
        <BridgeStatus />
        {children}
      </body>
    </html>
  );
}
