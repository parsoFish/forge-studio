import type { ReactNode } from 'react';
import './globals.css';
import { resolveBridgePortFromEnv } from '@/lib/bridge-port';

export const metadata = {
  title: 'forge',
  description: 'Operator UI for the forge autonomous multi-agent orchestrator.',
};

// W6-P4: LOAD-BEARING. Without this, Next.js could statically prerender the
// root layout ONCE at build time and cache the HTML, baking in whichever
// FORGE_BRIDGE_URL happened to be set during that build — exactly the
// build-time-embedding fragility `lib/bridge-client.ts`'s own header comment
// already rejected `next.config` `env` blocks for (`forge watch` restarts
// skip the build when `.next/` is fresh, and `--bridge-port` can override the
// default port per-invocation — see `cli/forge-watch.ts`). `force-dynamic`
// keeps this layout rendered fresh, per request, exactly like the
// `/api/forge-config` route it's replacing on the hot path.
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: ReactNode }) {
  // W6-P4: zero-RTT bridge URL discovery. Inlines the bridge PORT ONLY —
  // never a host: `resolveBridgeUrl()` (lib/bridge-client.ts) still builds
  // the host from `window.location.hostname`, exactly as before
  // (windows-browser-to-wsl-via-window-location.md — WSL2 + a Windows
  // browser only resolves via the browser's own origin). This is the same
  // value `/api/forge-config` computes, just read once here instead of over
  // a client fetch — the client falls back to that route when the global is
  // absent (e.g. an entry point that isn't behind this layout).
  const bridgePort = resolveBridgePortFromEnv();
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
          // eslint-disable-next-line react/no-danger -- inline global assignment,
          // must run synchronously before any client code reads it (the
          // established `next-themes`-style pattern for a pre-hydration global).
          dangerouslySetInnerHTML={{ __html: `window.__FORGE_BRIDGE_PORT__=${JSON.stringify(bridgePort)};` }}
        />
        {children}
      </body>
    </html>
  );
}
