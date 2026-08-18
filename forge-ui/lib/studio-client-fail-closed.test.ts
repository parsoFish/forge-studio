/**
 * W7-A1 fail-closed TABLE test over every studio-client read
 * (home-sessions-V01: "the single shared fetch primitive behind ~26 Studio
 * client functions silently converts EVERY bridge failure into the caller's
 * empty fallback").
 *
 * For each read function this file drives the REAL function through a mocked
 * `bridgeFetch` (the transport it must ride — crosscut-26) and asserts:
 *   1. transport: exactly ONE `bridgeFetch` call with the expected path, and
 *      NO direct global `fetch` call from studio-client (the port-correction
 *      policy lives in bridge-client alone);
 *   2. 500 with a JSON `error` body → the promise REJECTS with a
 *      BridgeReadError{status:500, message:<verbatim>} (throwing reads), or
 *      resolves `{ok:false, error:<verbatim>}` (status-shaped reads) — never
 *      an empty/neutral value;
 *   3. transport throw → REJECTS/`ok:false` with `bridge unreachable (…)`
 *      and NO status;
 *   4. 200 with malformed JSON → REJECTS/`ok:false` (never `[]`);
 *   5. 404 → `null` for the "no such object" reads, `[]` for the two
 *      documented empty-log reads, and REJECTS for list reads (a 404 on an
 *      index route is a broken bridge, not an empty roster);
 *   6. positive control: a real 200 body resolves to a value (so the failure
 *      assertions above are not passing because the function is broken).
 *
 * Kills the pre-fix `studioGet(path, fallback)`: every failure case resolved
 * to the fallback, so rows 2–5 all fail RED against main.
 *
 * RUN: cd forge-ui && npx vitest run lib/studio-client-fail-closed.test.ts
 */
import { test, expect, vi, afterEach, beforeEach } from 'vitest';

// Mock ONLY the transport. `bridgeFetch` is what studio-client must call;
// each test replaces `mockBridgeFetch`'s implementation. Global fetch is
// stubbed to a spy that must NEVER be called (assertion 1).
const mockBridgeFetch = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>();
vi.mock('./bridge-client.ts', () => ({
  bridgeFetch: (path: string, init?: RequestInit) => mockBridgeFetch(path, init),
  resolveBridgeUrl: vi.fn(async () => 'http://bridge.test'),
}));

import * as sc from './studio-client';

const globalFetchSpy = vi.fn(async () => { throw new Error('studio-client must not call global fetch directly'); });

beforeEach(() => {
  mockBridgeFetch.mockReset();
  vi.stubGlobal('fetch', globalFetchSpy);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonRes(status: number, body: unknown, jsonThrows = false): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => { if (jsonThrows) throw new SyntaxError('Unexpected token <'); return body; },
  } as unknown as Response;
}

type Row = {
  name: string;
  call: () => Promise<unknown>;
  path: string;
  /** a real 200 body → `positive(value)` must hold */
  okBody: unknown;
  positive: (v: unknown) => void;
  /** how the function propagates a failure */
  mode: 'throws' | 'status-shaped';
  /** what a 404 means for this read */
  on404: 'null' | 'empty-array' | 'throws' | 'status-shaped';
};

const RUN = { id: 'run-1', flowId: 'forge-develop', status: 'active', phases: [] };

const ROWS: Row[] = [
  // ---- list reads: THROW on any failure, 404 included ----
  { name: 'fetchRuns', call: () => sc.fetchRuns(), path: '/api/runs', okBody: { runs: [RUN] }, positive: (v) => expect((v as unknown[]).length).toBe(1), mode: 'throws', on404: 'throws' },
  { name: 'fetchPlannedInitiatives', call: () => sc.fetchPlannedInitiatives(), path: '/api/runs/planned', okBody: { planned: [{ initiativeId: 'INIT-1', project: null, title: 't', ready: true, blockedBy: [] }] }, positive: (v) => expect((v as unknown[]).length).toBe(1), mode: 'throws', on404: 'throws' },
  { name: 'fetchStudioAgents', call: () => sc.fetchStudioAgents(), path: '/api/studio/agents', okBody: { agents: [{ id: 'a', name: 'A' }] }, positive: (v) => expect((v as unknown[]).length).toBe(1), mode: 'throws', on404: 'throws' },
  { name: 'fetchStudioAgentsWithMeta', call: () => sc.fetchStudioAgentsWithMeta(), path: '/api/studio/agents', okBody: { agents: [{ id: 'a', name: 'A' }], defaultCostCeilingUsd: 3 }, positive: (v) => expect((v as { defaultCostCeilingUsd: number }).defaultCostCeilingUsd).toBe(3), mode: 'throws', on404: 'throws' },
  { name: 'fetchStarters', call: () => sc.fetchStarters(), path: '/api/studio/starters', okBody: { starters: [{ id: 's', name: 'S' }] }, positive: (v) => expect((v as unknown[]).length).toBe(1), mode: 'throws', on404: 'throws' },
  { name: 'fetchStarterFlow', call: () => sc.fetchStarterFlow(), path: '/api/studio/starters', okBody: { flow: { id: 'f' } }, positive: (v) => expect((v as { id: string }).id).toBe('f'), mode: 'throws', on404: 'throws' },
  { name: 'fetchStudioFlows', call: () => sc.fetchStudioFlows(), path: '/api/studio/flows', okBody: { flows: [{ id: 'f', name: 'F' }] }, positive: (v) => expect((v as unknown[]).length).toBe(1), mode: 'throws', on404: 'throws' },
  { name: 'fetchStandingTriggers', call: () => sc.fetchStandingTriggers(), path: '/api/triggers', okBody: { triggers: [] }, positive: (v) => expect(Array.isArray(v)).toBe(true), mode: 'throws', on404: 'throws' },
  { name: 'fetchStudioProjects', call: () => sc.fetchStudioProjects(), path: '/api/studio/projects', okBody: { projects: [{ id: 'p', name: 'P' }] }, positive: (v) => expect((v as unknown[]).length).toBe(1), mode: 'throws', on404: 'throws' },
  { name: 'fetchStudioKbs', call: () => sc.fetchStudioKbs(), path: '/api/studio/kbs', okBody: { kbs: [{ id: 'k', name: 'K' }] }, positive: (v) => expect((v as unknown[]).length).toBe(1), mode: 'throws', on404: 'throws' },
  { name: 'fetchStudioSessions', call: () => sc.fetchStudioSessions(), path: '/api/studio/sessions?active=1', okBody: { sessions: [{ kind: 'demo', sessionId: 's1' }] }, positive: (v) => expect((v as unknown[]).length).toBe(1), mode: 'throws', on404: 'throws' },
  { name: 'fetchKbIngestActivity', call: () => sc.fetchKbIngestActivity('k'), path: '/api/studio/kbs/k/ingest-activity', okBody: { events: [{ kb: 'k', freshThemes: 1, impl: 'x', cycleId: 'c' }] }, positive: (v) => expect((v as unknown[]).length).toBe(1), mode: 'throws', on404: 'throws' },
  { name: 'fetchStudioCatalog', call: () => sc.fetchStudioCatalog(), path: '/api/studio/catalog', okBody: { catalog: { skills: [{ id: 'x' }] } }, positive: (v) => expect((v as { skills: unknown[] }).skills.length).toBe(1), mode: 'throws', on404: 'throws' },
  { name: 'fetchLatestStandaloneRun', call: () => sc.fetchLatestStandaloneRun('agent-x'), path: '/api/agents/agent-x/history', okBody: { ok: true, rows: [{ id: 'r1', linkKind: 'standalone', status: 'running', when: '2026-08-18T00:00:00Z' }] }, positive: (v) => expect((v as { id: string }).id).toBe('r1'), mode: 'throws', on404: 'throws' },
  { name: 'fetchContractStages', call: () => sc.fetchContractStages('gitpulse'), path: '/api/studio/projects/gitpulse/contract-stages', okBody: { ok: true, stages: [{ stage: 'contract', status: 'present', source: 's', detail: [], bytes: null }] }, positive: (v) => expect((v as unknown[]).length).toBe(1), mode: 'throws', on404: 'throws' },
  { name: 'fetchRepoStatus', call: () => sc.fetchRepoStatus('p'), path: '/api/studio/projects/p/repo-status', okBody: { pending: true, branch: 'forge-studio' }, positive: (v) => expect((v as { pending: boolean }).pending).toBe(true), mode: 'throws', on404: 'throws' },
  { name: 'fetchProjectStarters', call: () => sc.fetchProjectStarters(), path: '/api/studio/projects/starters', okBody: { appTypes: ['next'] }, positive: (v) => expect(v).toEqual(['next']), mode: 'throws', on404: 'throws' },
  // ---- "no such object" reads: 404 → null, everything else THROWS ----
  { name: 'fetchRun', call: () => sc.fetchRun('run-1'), path: '/api/runs/run-1', okBody: { run: RUN }, positive: (v) => expect((v as { id: string }).id).toBe('run-1'), mode: 'throws', on404: 'null' },
  { name: 'fetchAgentCapability', call: () => sc.fetchAgentCapability('a'), path: '/api/studio/agents/a/capability', okBody: { capability: { interactive: false, runtimeSdks: ['claude'], fanoutCapable: false, materials: [], costCeilingEnforceable: true, modelTierStrategy: 'fixed' } }, positive: (v) => expect(v).not.toBeNull(), mode: 'throws', on404: 'null' },
  { name: 'fetchKb', call: () => sc.fetchKb('k'), path: '/api/studio/kbs/k', okBody: { kb: { id: 'k', name: 'K' }, graph: { nodes: [], edges: [] }, health: { ok: true } }, positive: (v) => expect((v as { kb: { id: string } }).kb.id).toBe('k'), mode: 'throws', on404: 'null' },
  { name: 'fetchKbNode', call: () => sc.fetchKbNode('k', 'n'), path: '/api/studio/kbs/k/nodes/n', okBody: { node: { id: 'n' } }, positive: (v) => expect((v as { id: string }).id).toBe('n'), mode: 'throws', on404: 'null' },
  { name: 'fetchFlow', call: () => sc.fetchFlow('f'), path: '/api/studio/flows/f', okBody: { flow: { id: 'f', name: 'F' } }, positive: (v) => expect((v as { id: string }).id).toBe('f'), mode: 'throws', on404: 'null' },
  { name: 'fetchPreflight', call: () => sc.fetchPreflight('p'), path: '/api/studio/projects/p/preflight', okBody: { clauses: [], ready: true }, positive: (v) => expect((v as { ready: boolean }).ready).toBe(true), mode: 'throws', on404: 'null' },
  { name: 'resolveKbNode', call: () => sc.resolveKbNode('n'), path: '/api/studio/kbs/resolve-node/n', okBody: { kbId: 'k' }, positive: (v) => expect(v).toEqual({ kbId: 'k' }), mode: 'throws', on404: 'null' },
  // ---- documented empty-log read: 404 → [] (no events.jsonl yet), everything else THROWS ----
  { name: 'fetchPhaseLog', call: () => sc.fetchPhaseLog('run-1', 'dev'), path: '/api/runs/run-1/phases/dev/log', okBody: { lines: [{ at: 't', kind: 'info', text: 'x' }] }, positive: (v) => expect((v as unknown[]).length).toBe(1), mode: 'throws', on404: 'empty-array' },
  // ---- status-shaped reads: never throw; ok:false + the bridge's own text ----
  { name: 'fetchKbDrainRun', call: () => sc.fetchKbDrainRun('k', 'r'), path: '/api/studio/kbs/k/drain/r', okBody: { ok: true, runId: 'r', state: 'running', round: 1, counts: { auto: 0, agent: 0, user: 0 }, perFinding: [], costUsd: 0, updatedAt: 't' }, positive: (v) => expect((v as { ok: boolean }).ok).toBe(true), mode: 'status-shaped', on404: 'status-shaped' },
  { name: 'fetchActiveOrLatestKbDrain', call: () => sc.fetchActiveOrLatestKbDrain('k'), path: '/api/studio/kbs/k/drain', okBody: { ok: true, runId: null }, positive: (v) => expect((v as { ok: boolean }).ok).toBe(true), mode: 'status-shaped', on404: 'status-shaped' },
  { name: 'fetchActiveOrLatestConsolidate', call: () => sc.fetchActiveOrLatestConsolidate('k'), path: '/api/studio/kbs/k/consolidate/active', okBody: { ok: true, runId: 'c1', state: 'running', cleared: false }, positive: (v) => expect((v as { runId: string }).runId).toBe('c1'), mode: 'status-shaped', on404: 'status-shaped' },
  { name: 'fetchActiveOnboarding', call: () => sc.fetchActiveOnboarding('p'), path: '/api/studio/projects/p/onboarding/active', okBody: { ok: true, sessionId: 's', runId: 'r', phase: 'running' }, positive: (v) => expect((v as { sessionId: string }).sessionId).toBe('s'), mode: 'status-shaped', on404: 'status-shaped' },
];

test('table covers every studioGet-backed read exported by studio-client (a new read must be added here)', () => {
  const names = ROWS.map((r) => r.name).sort();
  expect(names).toEqual([...new Set(names)]);
  expect(names.length).toBeGreaterThanOrEqual(29);
});

for (const row of ROWS) {
  test(`${row.name}: transport — exactly ONE bridgeFetch(${row.path}) and NO direct global fetch (positive control resolves a value)`, async () => {
    mockBridgeFetch.mockImplementation(async () => jsonRes(200, row.okBody));
    const v = await row.call();
    row.positive(v);
    expect(mockBridgeFetch).toHaveBeenCalledTimes(1);
    expect(mockBridgeFetch.mock.calls[0][0]).toBe(row.path);
    expect(globalFetchSpy).not.toHaveBeenCalled();
  });

  test(`${row.name}: 500 {error:"boom"} → ${row.mode === 'throws' ? 'REJECTS BridgeReadError{status:500,message:"boom"}' : 'resolves {ok:false,error:"boom"}'} — never an empty value`, async () => {
    mockBridgeFetch.mockImplementation(async () => jsonRes(500, { error: 'boom' }));
    if (row.mode === 'throws') {
      await expect(row.call()).rejects.toMatchObject({ name: 'BridgeReadError', status: 500, message: 'boom' });
    } else {
      const v = (await row.call()) as { ok: boolean; error?: string };
      expect(v.ok).toBe(false);
      expect(v.error).toBe('boom');
    }
  });

  test(`${row.name}: 4xx body with a \`message\` field surfaces it verbatim (bridge contract-stages/gitpulse 409 class)`, async () => {
    const text = 'project-config: the flat gate keys moved to the typed testProcess object (R1-03) — migrate: quality_gate_cmd → testProcess.local.cmd';
    mockBridgeFetch.mockImplementation(async () => jsonRes(409, { ok: false, message: text }));
    if (row.mode === 'throws') {
      await expect(row.call()).rejects.toMatchObject({ name: 'BridgeReadError', status: 409, message: text });
    } else {
      const v = (await row.call()) as { ok: boolean; error?: string };
      expect(v.ok).toBe(false);
      expect(v.error).toBe(text);
    }
  });

  test(`${row.name}: transport throw → ${row.mode === 'throws' ? 'REJECTS' : '{ok:false}'} with "bridge unreachable (…)" and NO status`, async () => {
    mockBridgeFetch.mockImplementation(async () => { throw new TypeError('Failed to fetch'); });
    if (row.mode === 'throws') {
      let caught: unknown;
      try { await row.call(); } catch (e) { caught = e; }
      expect(caught).toMatchObject({ name: 'BridgeReadError', message: 'bridge unreachable (Failed to fetch)' });
      expect((caught as { status?: number }).status).toBeUndefined();
    } else {
      const v = (await row.call()) as { ok: boolean; error?: string };
      expect(v.ok).toBe(false);
      expect(v.error).toBe('bridge unreachable (Failed to fetch)');
    }
  });

  test(`${row.name}: 200 with malformed JSON → ${row.mode === 'throws' ? 'REJECTS' : '{ok:false}'} (never a fabricated empty value)`, async () => {
    mockBridgeFetch.mockImplementation(async () => jsonRes(200, null, true));
    if (row.mode === 'throws') {
      await expect(row.call()).rejects.toMatchObject({ name: 'BridgeReadError', status: 200 });
    } else {
      const v = (await row.call()) as { ok: boolean; error?: string };
      expect(v.ok).toBe(false);
      expect(v.error).toMatch(/malformed JSON/);
    }
  });

  test(`${row.name}: 404 {error:"unknown"} → ${row.on404}`, async () => {
    mockBridgeFetch.mockImplementation(async () => jsonRes(404, { error: 'unknown' }));
    switch (row.on404) {
      case 'null':
        await expect(row.call()).resolves.toBeNull();
        break;
      case 'empty-array':
        await expect(row.call()).resolves.toEqual([]);
        break;
      case 'throws':
        await expect(row.call()).rejects.toMatchObject({ name: 'BridgeReadError', status: 404, message: 'unknown' });
        break;
      case 'status-shaped': {
        const v = (await row.call()) as { ok: boolean; error?: string };
        expect(v.ok).toBe(false);
        expect(v.error).toBe('unknown');
        break;
      }
    }
  });
}

// ---- writes: the bridge's own error/message text survives on a non-2xx -----

test('studioPost-backed write (dispatchKbDrain): a 409 body `message` (no `error` field) is surfaced verbatim, and it rides bridgeFetch', async () => {
  mockBridgeFetch.mockImplementation(async () => jsonRes(409, { ok: false, message: 'a drain run is already active for this kb' }));
  const r = await sc.dispatchKbDrain('k');
  expect(r).toMatchObject({ ok: false, error: 'a drain run is already active for this kb' });
  expect(mockBridgeFetch).toHaveBeenCalledTimes(1);
  expect(mockBridgeFetch.mock.calls[0][0]).toBe('/api/studio/kbs/k/drain');
  expect(globalFetchSpy).not.toHaveBeenCalled();
});

test('studioPost-backed write: a non-2xx with a NON-JSON body still reports {ok:false, error:"HTTP 502"} (never a thrown-JSON string)', async () => {
  mockBridgeFetch.mockImplementation(async () => jsonRes(502, null, true));
  const r = await sc.dispatchKbDrain('k');
  expect(r).toMatchObject({ ok: false, error: 'HTTP 502' });
});
