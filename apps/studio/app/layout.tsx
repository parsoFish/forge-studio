import type { ReactNode } from 'react';
import './globals.css';
import Script from 'next/script';
import { BridgeStatus } from '@/components/BridgeStatus';
import { SkipLink } from '@/components/SkipLink';

export const metadata = {
  title: 'forge',
  description: 'Operator UI for the forge autonomous multi-agent orchestrator.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // forge-nk1y.29: the bridge PORT is the LAUNCHED one, from the Next process's env at serve
  // time — `/api/forge-config/script` sets `window.__FORGE_BRIDGE_PORT__` before hydration
  // (`beforeInteractive`), so this layout stays static. It used to inline the build-time default
  // (4123), which the first bridge call trusted: an alt-port Studio read, and from a writing page
  // wrote, another session's bridge. Unset (the script has not run), `resolveBridgeUrl` asks
  // `/api/forge-config` before its first call. The host always comes from
  // `window.location.hostname` (windows-browser-to-wsl-via-window-location.md).
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
        <Script src="/api/forge-config/script" strategy="beforeInteractive" />
        {/* W7-C3 (crosscut-18): the skip-to-content link is the first tab
            stop on every route — see components/SkipLink.tsx. */}
        <SkipLink />
        <BridgeStatus />
        {children}
      </body>
    </html>
  );
}
