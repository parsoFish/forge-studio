/**
 * AT-12 (bead forge-3oq review, T3 companion to apps/forge/studio-provenance.test.ts's
 * AT-8/AT-9/AT-10/AT-11) — the CLIENT side of the KB/flow detail-route gap.
 *
 * `forge-ui/lib/studio-client.ts` declares `Kb.provenance` REQUIRED with a
 * comment saying "every KB that reaches the client came through
 * `fetchStudioKbs`'s parser, which always attaches a real value... there is
 * no legitimate 'KB with no provenance opinion' state" (studio-client.ts
 * :649-657). That invariant is FALSE for `fetchKb` (studio-client.ts:1093):
 *
 *   export async function fetchKb(id: string): Promise<KbDetail | null> {
 *     const body = await studioGet<{ kb?: Kb; ... }>(...);
 *     if (!body?.kb || !body.graph || !body.health) return null;
 *     return { kb: body.kb, graph: body.graph, health: body.health };
 *   }
 *
 * `body.kb` is CAST straight to `Kb` (the `<{ kb?: Kb; ... }>` type param on
 * `studioGet`) with no `parseProvenance` call — unlike `fetchStudioKbs`,
 * `fetchStudioFlows`, and `fetchStudioProjects`, which all explicitly
 * `parseProvenance(...)` at the wire boundary (studio-client.ts:1015/1071/
 * 1087). A detail-fetched KB can reach the client with `provenance: undefined`
 * (or any garbage the server happens to send) while its type says otherwise.
 * `fetchFlow` (studio-client.ts:1430) has the identical shape (lower stakes —
 * `Flow.provenance` is optional on the client type).
 *
 * Fetch harness: matches forge-ui/lib/studio-client.test.ts's own
 * `fetchContractStages` AT-F1-1 precedent EXACTLY (same `vi.mock` of
 * `./bridge-client.ts` to a fixed base, same `vi.stubGlobal('fetch', ...)` +
 * `afterEach(() => vi.unstubAllGlobals())` teardown) — no new mocking
 * machinery invented for this file.
 *
 * RUN: cd forge-ui && npx vitest run lib/studio-provenance-detail.test.ts
 */
import { test, expect, vi, afterEach } from 'vitest';

import { fetchKb, fetchFlow } from './studio-client';

// Same reasoning as studio-client.test.ts:78-92: `resolveBridgeUrl`'s real
// implementation short-circuits to '' under this repo's `environment: 'node'`
// vitest config (no `window` global), so `fetch` is only exercisable with
// `resolveBridgeUrl` replaced by a fixed base. `vi.mock` is hoisted above
// every import by vitest and matches by resolved file path, so this
// extensionless `'./bridge-client.ts'` intercepts studio-client.ts's own
// `from './bridge-client'` import.
vi.mock('./bridge-client.ts', () => ({
  resolveBridgeUrl: vi.fn(async () => 'http://bridge.test'),
  // W7-A1: studio-client rides bridge-client's `bridgeFetch` (one transport,
  // crosscut-26) — the mock forwards to the stubbed global fetch against the
  // same fixed base, so each test's `vi.stubGlobal('fetch', …)` still drives it.
  bridgeFetch: vi.fn(async (path: string, init?: RequestInit) => (init === undefined ? fetch(`http://bridge.test${path}`) : fetch(`http://bridge.test${path}`, init))),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

test('AT-12a: fetchKb normalises a garbage wire `provenance` to "unknown" instead of casting it through — kills a plain `as Kb` cast at the detail-fetch boundary', async () => {
  const fetchSpy = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      // Server payload with an out-of-band provenance token a real server
      // (post-fix, going through provenanceOfOrigin) could never emit — the
      // fixture that proves the client is PARSING, not passing the wire
      // value straight through.
      kb: {
        id: 'garbage-provenance-kb',
        name: 'Garbage Provenance KB',
        binding: { kind: 'unique' },
        counts: { index: 0, themes: 0, raw: 0 },
        lint: null,
        provenance: 'totally-not-a-real-token',
      },
      graph: { nodes: [], edges: [] },
      health: {
        layerBalance: { index: 0, theme: 0, raw: 0 },
        orphans: 0,
        linkDensity: 0,
        staleness: { staleRawCount: 0, staleThemeCount: 0 },
        lintFlags: 0,
        lintErrors: 0,
      },
    }),
  }));
  vi.stubGlobal('fetch', fetchSpy);

  const detail = await fetchKb('garbage-provenance-kb');
  expect(detail).not.toBeNull();
  expect(
    detail?.kb.provenance,
    `fetchKb must run the wire value through parseProvenance (same as fetchStudioKbs) so a garbage/absent token normalises to 'unknown', got ${JSON.stringify(detail?.kb.provenance)} — a plain cast lets a malformed or absent server value pass straight through despite Kb.provenance being declared REQUIRED`,
  ).toBe('unknown');
});

test('AT-12b: fetchKb normalises an ABSENT wire `provenance` (the honest shape of today\'s unfixed detail route) to "unknown", not undefined', async () => {
  const fetchSpy = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      // No `provenance` key at all — exactly what GET /api/studio/kbs/:id
      // sends TODAY (packages/knowledge/bridge-studio-kbs.ts's `kbPublic` spread carries no
      // provenance field pre-fix).
      kb: {
        id: 'no-provenance-kb',
        name: 'No Provenance KB',
        binding: { kind: 'unique' },
        counts: { index: 0, themes: 0, raw: 0 },
        lint: null,
      },
      graph: { nodes: [], edges: [] },
      health: {
        layerBalance: { index: 0, theme: 0, raw: 0 },
        orphans: 0,
        linkDensity: 0,
        staleness: { staleRawCount: 0, staleThemeCount: 0 },
        lintFlags: 0,
        lintErrors: 0,
      },
    }),
  }));
  vi.stubGlobal('fetch', fetchSpy);

  const detail = await fetchKb('no-provenance-kb');
  expect(detail).not.toBeNull();
  expect(
    detail?.kb.provenance,
    `an absent wire provenance must normalise to the honest 'unknown', got ${JSON.stringify(detail?.kb.provenance)} (a bare cast leaves this literally undefined, falsifying the REQUIRED Kb.provenance type)`,
  ).toBe('unknown');
});

test('AT-12c: fetchFlow normalises a garbage wire `provenance` to "unknown" instead of casting it through — kills the same `as Flow` cast on the flow detail route', async () => {
  const fetchSpy = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      flow: {
        id: 'garbage-provenance-flow',
        name: 'Garbage Provenance Flow',
        goal: 'AT-12c fixture',
        nodes: [],
        edges: [],
        triggers: [],
        origin: 'seed',
        provenance: 'totally-not-a-real-token',
      },
    }),
  }));
  vi.stubGlobal('fetch', fetchSpy);

  const flow = await fetchFlow('garbage-provenance-flow');
  expect(flow).not.toBeNull();
  expect(
    flow?.provenance,
    `fetchFlow must run the wire value through parseProvenance (same as fetchStudioFlows) so a garbage token normalises to 'unknown', got ${JSON.stringify(flow?.provenance)}`,
  ).toBe('unknown');
});
