/**
 * W7-B4 — flow-builder authoring pins:
 *
 *   flows-10  saveFlow's FAILURE path carries the server's per-node findings
 *             (the client used to throw them away → the operator saw only
 *             "validation failed"), and `FlowSaveFindings` renders one row
 *             per finding.
 *   flows-11  FlowHeader renders a Delete-flow control when the flow is
 *             deletable, and NEVER for a shipped seed.
 *   flows-13  saveFlow forwards `create: true` so the bridge can 409 a
 *             duplicate id instead of silently overwriting.
 *
 * forge-8vfn.5.12 (bead, 2nd open acceptance criterion) — a CLEAN save used
 * to render NOTHING, the exact same DOM shape as "nobody has saved yet": a
 * story's expect.data can assert a VALUE, never an absence, so no beat could
 * ever confirm a save actually lints clean. `FlowSaveFindings` now takes an
 * explicit `lintState` ('unsaved' | 'clean' | 'findings') and ALWAYS
 * renders, carrying it on `data-lint-state` alongside `data-finding-count`
 * (0 for unsaved/clean, defended even if a caller passes stale findings
 * beside a non-"findings" state). The vocabulary reuses 'clean'/'findings'
 * from the existing hook/community scan report's `HookScanVerdict`
 * ('blocked' | 'findings' | 'clean', lib/hook-client.ts) rather than
 * inventing a second word for the same fact; 'unsaved' is this component's
 * own third state (a security scan has no "not yet scanned" idle render).
 *
 * Pinned RED at branch base. RUN: npx vitest run --root apps/studio tests/integration/flow-authoring-view.test.ts
 */
import { test, expect, vi, afterEach } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Fixed transport base — mirrors studio-client.test.ts's established mock.
vi.mock('../../lib/bridge-client.ts', () => ({
  __esModule: true,
  bridgeFetch: vi.fn(async (path: string, init?: RequestInit) =>
    (init === undefined ? fetch(`http://bridge.test${path}`) : fetch(`http://bridge.test${path}`, init))),
  resolveBridgeUrl: vi.fn(async () => 'http://bridge.test'),
  onBridgeTransportFailure: vi.fn(() => () => {}),
}));

import { saveFlow } from '../../lib/studio-client';
import { FlowSaveFindings } from '@/components/studio/flow-builder/FlowSaveFindings';
import { FlowHeader } from '@/components/studio/flow-builder/FlowHeader';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function stubFetch(status: number, body: unknown): void {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  ) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// flows-10 — the failure path keeps the findings
// ---------------------------------------------------------------------------

test('saveFlow failure carries the server findings through to the caller', async () => {
  stubFetch(400, {
    error: 'validation failed',
    findings: [
      { level: 'error', object: 'flow:f', check: 'agent-ref', message: 'Node "x" references unknown agent "ghost"' },
    ],
  });
  const r = await saveFlow('f', { name: 'F' });
  expect(r.ok).toBe(false);
  expect(r.error).toBe('validation failed');
  expect(Array.isArray(r.findings)).toBe(true);
  expect((r.findings as Array<{ message?: string }>)[0]?.message).toMatch(/unknown agent "ghost"/);
});

test('saveFlow forwards create:true in the PUT body (flows-13 client half)', async () => {
  let sentBody: string | undefined;
  globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    sentBody = init?.body as string;
    return new Response(JSON.stringify({ ok: true, id: 'f', version: 1 }), { status: 200 });
  }) as unknown as typeof fetch;

  await saveFlow('f', { name: 'F', create: true });
  expect(sentBody).toBeTruthy();
  expect(JSON.parse(sentBody!)['create']).toBe(true);
});

// ---------------------------------------------------------------------------
// FlowSaveFindings — per-node rows + the tri-state lint verdict
// (forge-8vfn.5.12)
// ---------------------------------------------------------------------------

test('FlowSaveFindings renders one attributed row per finding, lintState="findings"', () => {
  const html = renderToStaticMarkup(
    React.createElement(FlowSaveFindings, {
      lintState: 'findings',
      findings: [
        { level: 'error', object: 'flow:f', check: 'agent-ref', message: 'Node "x" references unknown agent "ghost"' },
        { level: 'error', object: 'flow:f', check: 'node-shape', message: 'Node "y" has neither "agent" nor "gate"' },
      ],
    }),
  );
  expect(html).toContain('data-component="flow-save-findings"');
  expect(html).toContain('data-lint-state="findings"');
  expect(html).toContain('data-finding-count="2"');
  expect(html).toContain('unknown agent &quot;ghost&quot;');
  expect(html).toContain('agent-ref');
});

test('FlowSaveFindings renders a CLEAN verdict for a save that had zero findings — never absent', () => {
  const html = renderToStaticMarkup(
    React.createElement(FlowSaveFindings, { lintState: 'clean', findings: [] }),
  );
  expect(html).not.toBe('');
  expect(html).toContain('data-component="flow-save-findings"');
  expect(html).toContain('data-lint-state="clean"');
  expect(html).toContain('data-finding-count="0"');
});

test('FlowSaveFindings renders an UNSAVED verdict before any save has happened — never absent', () => {
  const html = renderToStaticMarkup(
    React.createElement(FlowSaveFindings, { lintState: 'unsaved', findings: [] }),
  );
  expect(html).not.toBe('');
  expect(html).toContain('data-component="flow-save-findings"');
  expect(html).toContain('data-lint-state="unsaved"');
  expect(html).toContain('data-finding-count="0"');
});

test('FlowSaveFindings defends data-finding-count=0 for a non-"findings" state even if the caller passes stale findings', () => {
  const html = renderToStaticMarkup(
    React.createElement(FlowSaveFindings, {
      lintState: 'clean',
      findings: [{ message: 'stale finding a caller forgot to clear' }],
    }),
  );
  expect(html).toContain('data-lint-state="clean"');
  expect(html).toContain('data-finding-count="0"');
});

// ---------------------------------------------------------------------------
// FlowHeader — delete-flow control (flows-11)
// ---------------------------------------------------------------------------

const HEADER_BASE = {
  flowId: 'authored',
  state: { name: 'A', goal: 'g', project: '', kb: '', triggers: [] },
  onChange: () => {},
  onSave: async () => ({ ok: true as const }),
  flows: [],
  onFlowSelect: () => {},
};

test('FlowHeader renders a delete control for a deletable (authored) flow', () => {
  const html = renderToStaticMarkup(
    React.createElement(FlowHeader, { ...HEADER_BASE, canDelete: true, onDelete: () => {} }),
  );
  expect(html).toContain('data-action="delete-flow"');
});

test('FlowHeader renders NO delete control for a seed flow', () => {
  const html = renderToStaticMarkup(
    React.createElement(FlowHeader, { ...HEADER_BASE, canDelete: false, onDelete: () => {} }),
  );
  expect(html).not.toContain('data-action="delete-flow"');
});

// ---------------------------------------------------------------------------
// FlowHeader — the last-save lint verdict starts UNSAVED (forge-8vfn.5.12)
// ---------------------------------------------------------------------------

test('FlowHeader shows an UNSAVED lint verdict on first render — before any save this mount, never a missing element', () => {
  const html = renderToStaticMarkup(React.createElement(FlowHeader, HEADER_BASE));
  expect(html).toContain('data-component="flow-save-findings"');
  expect(html).toContain('data-lint-state="unsaved"');
  expect(html).toContain('data-finding-count="0"');
});
