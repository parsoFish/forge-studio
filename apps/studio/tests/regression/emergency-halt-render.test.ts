/**
 * The one emergency halt — Studio half (D-03): nav control, global banner,
 * notice, queued tone, wire parsing, and the 409 `halted` message. Row 207
 * (forge-8vfn.8.5.57).
 */
import { test, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  EmergencyHaltBanner,
  EmergencyHaltControlView,
} from '../../components/studio/EmergencyHalt.tsx';
import { ServeStatusNotice } from '../../components/studio/ServeStatusNotice.tsx';
import { queuedServeTone } from '../../lib/run-controls.ts';
import { describePostCommit } from '../../lib/architect-plan-view.ts';
import { HALTED_MESSAGE, bridgeErrorMessage } from '../../lib/bridge-result.ts';
import { parseServeStatus, parseServeHalt, bridgePost, type ServeStatus } from '../../lib/bridge-client-core.ts';

const SINCE = '2026-10-04T10:15:00.000Z';
function serve(over: Partial<ServeStatus> = {}): ServeStatus {
  return { state: 'running', pid: 1, restarts: 0, nextRestartAt: null, halt: null, ...over };
}
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const count = (s: string, needle: string) => s.split(needle).length - 1;

test('nav control off: "Emergency halt", data-action emergency-halt, no release', () => {
  const out = html(React.createElement(EmergencyHaltControlView, { halt: null, onPress: () => {} }));
  expect(out).toContain('data-component="emergency-halt"');
  expect(out).toContain('data-halt-state="off"');
  expect(out).toContain('data-action="emergency-halt"');
  expect(out).toContain('>Emergency halt<');
  expect(out).not.toContain('release-halt');
});

test('nav control on: "Release halt", exactly one release-halt element', () => {
  const halt = { since: SINCE, actor: 'op', active: 1, queued: 2 };
  const out = html(React.createElement(EmergencyHaltControlView, { halt, onPress: () => {} }));
  expect(out).toContain('data-halt-state="on"');
  expect(count(out, 'data-action="release-halt"')).toBe(1);
  expect(out).toContain('>Release halt<');
  expect(out).not.toContain('data-action="emergency-halt"');
});

test('a press error renders inline, never swallowed', () => {
  const out = html(React.createElement(EmergencyHaltControlView, { halt: null, error: 'HTTP 500', onPress: () => {} }));
  expect(out).toContain('data-halt-error');
  expect(out).toContain('HTTP 500');
});

test('banner present on halt with attributes and drain text; absent when off; no second release control', () => {
  expect(html(React.createElement(EmergencyHaltBanner, { halt: null }))).toBe('');
  const out = html(React.createElement(EmergencyHaltBanner, { halt: { since: SINCE, actor: null, active: 2, queued: 3 } }));
  expect(out).toContain('role="alert"');
  expect(out).toContain('data-component="emergency-halt-banner"');
  expect(out).toContain('data-halt-active="2"');
  expect(out).toContain('data-halt-queued="3"');
  expect(out).toMatch(/Emergency halt on since \d\d:\d\d — 2 runs finishing, nothing new starts\. 3 queued, waiting for release\./);
  expect(out).not.toContain('release-halt');
});

test('notice renders on halt even when serve is running: active > 0 branch', () => {
  const out = html(React.createElement(ServeStatusNotice, { status: serve({ halt: { since: SINCE, actor: null, active: 1, queued: 4 } }) }));
  expect(out).toContain('data-serve-halt="on"');
  expect(out).toContain('data-halt-active="1"');
  expect(out).toContain('data-halt-queued="4"');
  expect(out).toMatch(/Emergency halt on since \d\d:\d\d — 1 run finishing, nothing new starts\. 4 queued, waiting for release\./);
});

test('notice halt text: active = 0 branch, and since null omits the time', () => {
  const out = html(React.createElement(ServeStatusNotice, { status: serve({ halt: { since: null, actor: null, active: 0, queued: 0 } }) }));
  expect(out).toContain('Emergency halt on — every active run finished. 0 queued, waiting for release.');
});

test('notice keeps non-halt behaviour', () => {
  expect(html(React.createElement(ServeStatusNotice, { status: serve() }))).toBe('');
  const out = html(React.createElement(ServeStatusNotice, { status: serve({ state: 'down' }) }));
  expect(out).toContain('forge serve is not running');
  expect(out).not.toContain('data-serve-halt');
});

test('queuedServeTone: halted takes precedence over every state', () => {
  const halt = { since: SINCE, actor: null, active: 0, queued: 1 };
  expect(queuedServeTone(serve({ halt }))).toBe('halted');
  expect(queuedServeTone(serve({ state: 'down', halt }))).toBe('halted');
  expect(queuedServeTone(serve({ state: 'unsupervised', halt }))).toBe('halted');
  expect(queuedServeTone(serve())).toBe('running');
  expect(queuedServeTone(null)).toBe('unknown');
});

test('describePostCommit: a queued initiative under halt does not promise a pickup', () => {
  const halt = { since: SINCE, actor: null, active: 0, queued: 1 };
  const v = describePostCommit([{ initiativeId: 'INIT-1', queueState: 'queued' } as never], serve({ halt }));
  expect(v.tone).toBe('queued-halted');
  expect(v.serveNotReady).toBe(true);
});

test('wire parsing: absent/null halt → not halted; valid → fields; malformed → halted with nulls', () => {
  expect(parseServeStatus({ state: 'running', pid: 1, restarts: 0, nextRestartAt: null })?.halt).toBeNull();
  expect(parseServeHalt(null)).toBeNull();
  expect(parseServeHalt({ since: SINCE, actor: 'op', active: 1, queued: 2 })).toEqual({ since: SINCE, actor: 'op', active: 1, queued: 2 });
  expect(parseServeHalt('oops')).toEqual({ since: null, actor: null, active: null, queued: null });
  expect(parseServeHalt({ since: 5, active: 'x', queued: -1 })).toEqual({ since: null, actor: null, active: null, queued: null });
  expect(parseServeStatus('nope')).toBeNull();
});

test('409 halted maps to the one message via bridgeErrorMessage', () => {
  expect(bridgeErrorMessage(409, { error: 'halted', since: SINCE })).toBe(HALTED_MESSAGE);
  expect(HALTED_MESSAGE).toBe('The emergency halt is on — release it to start new work.');
  expect(bridgeErrorMessage(409, { error: 'other' })).toBe('other');
});

afterEach(() => { vi.unstubAllGlobals(); });

test('bridgePost surfaces a halted refusal as the mapped message', async () => {
  vi.stubGlobal('window', { __FORGE_BRIDGE_PORT__: 4123, location: { protocol: 'http:', hostname: 'localhost' } });
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'halted', since: SINCE }), { status: 409 }));
  const r = await bridgePost('/api/architect/start', {});
  expect(r).toEqual({ ok: false, error: HALTED_MESSAGE });
});

test('pull/release client calls hit the halt routes and surface refusals', async () => {
  const { pullEmergencyHalt, releaseEmergencyHalt } = await import('../../lib/bridge-client-core.ts');
  vi.stubGlobal('window', { __FORGE_BRIDGE_PORT__: 4123, location: { protocol: 'http:', hostname: 'localhost' } });
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(String(url));
    return String(url).endsWith('/release')
      ? new Response(JSON.stringify({ halt: null }), { status: 200 })
      : new Response(JSON.stringify({ halt: { since: SINCE, actor: 'op', active: 1, queued: 0 } }), { status: 200 });
  });
  expect(await pullEmergencyHalt()).toEqual({ since: SINCE, actor: 'op', active: 1, queued: 0 });
  await releaseEmergencyHalt();
  expect(calls).toEqual(['http://localhost:4123/api/halt', 'http://localhost:4123/api/halt/release']);
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'boom' }), { status: 500 }));
  await expect(pullEmergencyHalt()).rejects.toThrow('boom');
});
