'use client';

import type { CSSProperties } from 'react';
import { getBridgeStatusStore, useBridgeStatus } from '@/lib/use-bridge-status';
import { BRIDGE_HEALTH_POLL_MS, type BridgeStatusSnapshot } from '@/lib/bridge-status';

/**
 * BridgeStatus — the ONE shared bridge-liveness banner (W7-A1: home-sessions-13,
 * crosscut-01/-22), mounted once in `app/layout.tsx` so EVERY route carries it.
 *
 * DOM contract (docs/forge-ui-dom-and-harness.md, "Global — BridgeStatus"):
 *   `[data-component="bridge-status"][data-bridge-status="up"|"down"|"reconnecting"]
 *    [data-bridge-ever-up="true"|"false"]`
 * The root is ALWAYS in the DOM with those attributes (automation reads the
 * state whether or not the banner is showing). The banner text + Retry
 * button (`[data-action="bridge-retry"]`) render only when
 * `status === "down"` (confirmed unreachable) or `status === "reconnecting"`
 * after the bridge had already been up in this tab (a lost socket). The
 * initial connect never flashes a banner.
 *
 * `BridgeStatusView` is the pure half (render-pinned via renderToStaticMarkup
 * in lib/bridge-status-render.test.ts); `BridgeStatus` wires it to the store.
 */

export function isBridgeBannerVisible(s: BridgeStatusSnapshot): boolean {
  return s.status === 'down' || (s.status === 'reconnecting' && s.everUp);
}

const BANNER_BASE: CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '7px 16px',
  fontSize: 13,
  lineHeight: 1.4,
  fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial',
  borderBottom: '1px solid var(--line, #263038)',
};

const DOWN_STYLE: CSSProperties = { ...BANNER_BASE, color: '#f87171', background: 'rgba(248,113,113,.10)' };
const RECONNECTING_STYLE: CSSProperties = { ...BANNER_BASE, color: 'var(--amber, #f59e0b)', background: 'rgba(245,158,11,.10)' };

const RETRY_STYLE: CSSProperties = {
  marginLeft: 'auto',
  fontSize: 12,
  padding: '3px 10px',
  borderRadius: 'var(--radius-sm, 6px)',
  border: '1px solid currentColor',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
};

export function BridgeStatusView({ snapshot, onRetry }: { snapshot: BridgeStatusSnapshot; onRetry?: () => void }) {
  const visible = isBridgeBannerVisible(snapshot);
  const attrs = {
    'data-component': 'bridge-status',
    'data-bridge-status': snapshot.status,
    'data-bridge-ever-up': snapshot.everUp ? 'true' : 'false',
  } as const;

  if (!visible) {
    return <div {...attrs} hidden aria-hidden="true" />;
  }

  const down = snapshot.status === 'down';
  const secs = Math.round(BRIDGE_HEALTH_POLL_MS / 1000);
  return (
    <div {...attrs} role="alert" style={down ? DOWN_STYLE : RECONNECTING_STYLE}>
      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: 'currentColor', flexShrink: 0 }} />
      <span>
        {down
          ? `Forge bridge unreachable — Studio can't read or change forge state right now. Retrying every ${secs}s.`
          : 'Reconnecting to the forge bridge…'}
        {snapshot.lastError ? (
          <span data-bridge-error style={{ opacity: 0.8, marginLeft: 6, fontFamily: 'var(--font-mono, ui-monospace)', fontSize: 12 }}>
            ({snapshot.lastError})
          </span>
        ) : null}
      </span>
      <button type="button" data-action="bridge-retry" onClick={onRetry} style={RETRY_STYLE}>
        Retry now
      </button>
    </div>
  );
}

export function BridgeStatus() {
  const snapshot = useBridgeStatus();
  return <BridgeStatusView snapshot={snapshot} onRetry={() => getBridgeStatusStore().retryNow()} />;
}
