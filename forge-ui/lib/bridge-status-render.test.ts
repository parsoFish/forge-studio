/**
 * W7-A1 render pins for the two shared failure surfaces:
 *   - `BridgeStatusView` (components/BridgeStatus.tsx) — the app-shell
 *     bridge-liveness banner, `[data-bridge-status]` (home-sessions-13,
 *     crosscut-01/-22);
 *   - `FetchErrorState` (components/FetchErrorState.tsx) — the per-page /
 *     per-panel failed-read state, `[data-component="fetch-error"]`
 *     (crosscut-01/-09/-12, home-sessions-29/-30, projects-03, library-13).
 *
 * `renderToStaticMarkup` over the pure components (this repo's render-test
 * convention — no jsdom). Kills:
 *  - a banner that renders text on the initial connect (a "reconnecting"
 *    flash on every page load) or that omits the root attribute while up
 *    (automation could not read the state);
 *  - a fetch-error state that frames a reachable bridge's 4xx as
 *    "could not reach the bridge" (library-13) or drops the bridge's text;
 *  - a Retry affordance that only exists in one of the two surfaces.
 *
 * RUN: cd forge-ui && npx vitest run lib/bridge-status-render.test.ts
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { BridgeStatusView, isBridgeBannerVisible } from '@/components/BridgeStatus';
import { FetchErrorState, fetchErrorPropsFrom } from '@/components/FetchErrorState';
import { BridgeReadError } from './bridge-result';
import { INITIAL_BRIDGE_STATUS, type BridgeStatusSnapshot } from './bridge-status';

const snap = (over: Partial<BridgeStatusSnapshot>): BridgeStatusSnapshot => ({ ...INITIAL_BRIDGE_STATUS, ...over });

// ---- BridgeStatusView -------------------------------------------------------

test('initial (reconnecting, never up): root carries data-component/data-bridge-status/data-bridge-ever-up, is hidden, and renders NO banner text', () => {
  const html = renderToStaticMarkup(React.createElement(BridgeStatusView, { snapshot: INITIAL_BRIDGE_STATUS }));
  expect(html).toContain('data-component="bridge-status"');
  expect(html).toContain('data-bridge-status="reconnecting"');
  expect(html).toContain('data-bridge-ever-up="false"');
  expect(html).toContain('hidden=""');
  expect(html).not.toContain('Reconnecting');
  expect(html).not.toContain('bridge-retry');
  expect(isBridgeBannerVisible(INITIAL_BRIDGE_STATUS)).toBe(false);
});

test('up: root present with data-bridge-status="up", hidden, no text, no role=alert', () => {
  const html = renderToStaticMarkup(React.createElement(BridgeStatusView, { snapshot: snap({ status: 'up', everUp: true }) }));
  expect(html).toContain('data-bridge-status="up"');
  expect(html).toContain('data-bridge-ever-up="true"');
  expect(html).toContain('hidden=""');
  expect(html).not.toContain('role="alert"');
  expect(html).not.toContain('unreachable');
});

test('down: role=alert banner with the unreachable copy, the poll cadence, the last error, and a [data-action="bridge-retry"] button', () => {
  const html = renderToStaticMarkup(React.createElement(BridgeStatusView, {
    snapshot: snap({ status: 'down', lastError: 'bridge unreachable (Failed to fetch)' }),
  }));
  expect(html).toContain('data-bridge-status="down"');
  expect(html).toContain('role="alert"');
  expect(html).toContain('Forge bridge unreachable');
  expect(html).toContain('Retrying every 3s');
  expect(html).toContain('bridge unreachable (Failed to fetch)');
  expect(html).toContain('data-action="bridge-retry"');
  expect(html).not.toContain('hidden=""');
});

test('reconnecting AFTER having been up: visible "Reconnecting to the forge bridge…" banner (a lost socket is shown; the initial connect is not)', () => {
  const html = renderToStaticMarkup(React.createElement(BridgeStatusView, { snapshot: snap({ status: 'reconnecting', everUp: true }) }));
  expect(html).toContain('data-bridge-status="reconnecting"');
  expect(html).toContain('role="alert"');
  expect(html).toContain('Reconnecting to the forge bridge');
  expect(html).toContain('data-action="bridge-retry"');
});

// ---- FetchErrorState --------------------------------------------------------

test('unreachable (no status): role=alert, data-fetch-status="error", data-fetch-reachable="false", "Could not reach the forge bridge — <what> unavailable (<error>)", NO http-status attr', () => {
  const html = renderToStaticMarkup(React.createElement(FetchErrorState, {
    what: 'sessions', error: 'bridge unreachable (Failed to fetch)', onRetry: () => {},
  }));
  expect(html).toContain('role="alert"');
  expect(html).toContain('data-component="fetch-error"');
  expect(html).toContain('data-fetch-status="error"');
  expect(html).toContain('data-fetch-reachable="false"');
  expect(html).not.toContain('data-fetch-http-status');
  expect(html).toContain('Could not reach the forge bridge — sessions unavailable');
  expect(html).toContain('bridge unreachable (Failed to fetch)');
  expect(html).toContain('data-action="retry-fetch"');
});

test('reachable (status present): "The forge bridge refused to read <what> (HTTP <n>): <bridge text verbatim>" — NEVER "could not reach" (library-13); data-fetch-http-status set', () => {
  const text = 'project-config: the flat gate keys moved to the typed testProcess object (R1-03) — migrate: quality_gate_cmd → testProcess.local.cmd';
  const html = renderToStaticMarkup(React.createElement(FetchErrorState, {
    what: 'contract stages', error: text, status: 409, compact: true,
  }));
  expect(html).toContain('data-fetch-reachable="true"');
  expect(html).toContain('data-fetch-http-status="409"');
  expect(html).toContain('The forge bridge refused to read contract stages (HTTP 409):');
  expect(html).toContain('migrate: quality_gate_cmd → testProcess.local.cmd');
  expect(html).not.toContain('Could not reach');
  expect(html).not.toContain('data-action="retry-fetch"'); // no onRetry supplied → no dead button
});

test('fetchErrorPropsFrom: BridgeReadError with status → {error,status}; without status → {error} only; a plain TypeError → its message, no status', () => {
  expect(fetchErrorPropsFrom(new BridgeReadError('/p', { ok: false, status: 400, error: 'invalid hook id "x"' })))
    .toEqual({ error: 'invalid hook id "x"', status: 400 });
  expect(fetchErrorPropsFrom(new BridgeReadError('/p', { ok: false, error: 'bridge unreachable (Failed to fetch)' })))
    .toEqual({ error: 'bridge unreachable (Failed to fetch)' });
  expect(fetchErrorPropsFrom(new TypeError('Failed to fetch'))).toEqual({ error: 'Failed to fetch' });
});
