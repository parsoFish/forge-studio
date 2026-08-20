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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
  on404: 'null' | 'empty-array' | 'throws' | 'status-shaped' | 'run-lookup-absent';
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
  // W7-B5 (agents-39): the aggregate recent-runs read — fail-closed like
  // every other roster-shaped read (a failed read must never render as "no
  // agent has ever run"; agents-index maps the throw to unresolved===total).
  { name: 'fetchRecentAgentRunsAggregate', call: () => sc.fetchRecentAgentRunsAggregate(20), path: '/api/agents/runs/recent?limit=20', okBody: { ok: true, rows: [{ id: 'r1', when: '2026-08-18T00:00:00Z', what: 'x', agents: ['architect'], status: 'complete', costUsd: 1, href: '/flows/f/run/r1', linkKind: 'flow' }] }, positive: (v) => expect((v as unknown[]).length).toBe(1), mode: 'throws', on404: 'throws' },
  { name: 'fetchContractStages', call: () => sc.fetchContractStages('gitpulse'), path: '/api/studio/projects/gitpulse/contract-stages', okBody: { ok: true, stages: [{ stage: 'contract', status: 'present', source: 's', detail: [], bytes: null }] }, positive: (v) => expect((v as unknown[]).length).toBe(1), mode: 'throws', on404: 'throws' },
  { name: 'fetchRepoStatus', call: () => sc.fetchRepoStatus('p'), path: '/api/studio/projects/p/repo-status', okBody: { pending: true, branch: 'forge-studio' }, positive: (v) => expect((v as { pending: boolean }).pending).toBe(true), mode: 'throws', on404: 'throws' },
  { name: 'fetchProjectStarters', call: () => sc.fetchProjectStarters(), path: '/api/studio/projects/starters', okBody: { appTypes: ['next'] }, positive: (v) => expect(v).toEqual(['next']), mode: 'throws', on404: 'throws' },
  // ---- "no such object" reads: 404 → null, everything else THROWS ----
  { name: 'fetchRun', call: () => sc.fetchRun('run-1'), path: '/api/runs/run-1', okBody: { run: RUN }, positive: (v) => expect((v as { id: string }).id).toBe('run-1'), mode: 'throws', on404: 'null' },
  // W7-FIX-A3 (round-2 finding 2): the same read, with the bridge's per-run
  // existence fact attached. A 404 is a real answer ({run:null} + the body's
  // `onDisk`); every other failure still throws, so an outage can never read
  // as "no such run" (the class this whole table exists to prevent).
  { name: 'fetchRunLookup', call: () => sc.fetchRunLookup('run-1'), path: '/api/runs/run-1', okBody: { run: RUN }, positive: (v) => expect(v).toMatchObject({ run: { id: 'run-1' }, onDisk: true }), mode: 'throws', on404: 'run-lookup-absent' },
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
  // ---- W7-FIX-A1 A1-10: the three dispatch-status polls. A failed READ is
  // `{ok:false, state:'unknown', error}` — never a fabricated 'running' (fix
  // polls) or an `'unknown'` indistinguishable from the bridge's own honest
  // "no state recorded" (run poll); the poll wrappers in agent-dispatch.ts
  // keep watching on `ok:false` (bounded), so a blip is a visible read
  // failure, not a stopped run and not a phantom still-running.
  { name: 'getAgentFixStatus', call: () => sc.getAgentFixStatus('k', 'r'), path: '/api/studio/kbs/k/fix-agent/r', okBody: { ok: true, state: 'cleared', cleared: true }, positive: (v) => expect(v).toMatchObject({ ok: true, state: 'cleared', cleared: true }), mode: 'status-shaped', on404: 'status-shaped' },
  { name: 'getAgentRunStatus', call: () => sc.getAgentRunStatus('r'), path: '/api/agents/runs/r', okBody: { ok: true, state: 'done', costUsd: 0.25, events: 12 }, positive: (v) => expect(v).toMatchObject({ ok: true, state: 'done', costUsd: 0.25, events: 12 }), mode: 'status-shaped', on404: 'status-shaped' },
  { name: 'preflightFixStatus', call: () => sc.preflightFixStatus('p', 'r'), path: '/api/studio/projects/p/preflight/fix-agent/r', okBody: { ok: true, state: 'not-cleared', cleared: false }, positive: (v) => expect(v).toMatchObject({ ok: true, state: 'not-cleared', cleared: false }), mode: 'status-shaped', on404: 'status-shaped' },
];

// ---- drift guard (W7-FIX-A1 A1-04) ------------------------------------------
// The pre-fix guard asserted a COUNT over ROWS itself — a tautology w.r.t.
// additions: a new `studioGet`-backed export (or one that reintroduced the
// `studioGet(path, fallback)` empty-fallback shape) left it green. This
// enumerates studio-client.ts's REAL export surface and diffs it against the
// table, so a new bridge read with no row FAILS here.

const READ_HELPER_RE = /\b(studioGet|studioRead|studioReadOr404)\s*</;

/**
 * Every `export (async) function NAME` in `source` whose body performs a
 * bridge GET: through the typed helpers (`studioGet`/`studioRead`/
 * `studioReadOr404`) or a bare `bridgeFetch(path)` with no `method:` (a raw
 * GET). Writes (`studioSend`/`bridgeFetch(path, {method: …})`) and pure
 * exports are excluded. Top-level exports start at column 0, so the source
 * is chunked at every `\nexport ` boundary.
 */
export function enumerateBridgeReadExports(source: string): string[] {
  // Comments are stripped first: a chunk runs to the NEXT `export`, so it
  // would otherwise carry the next function's doc comment (which may name a
  // read) — matching must see code only.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  const fns: Array<{ name: string; body: string }> = [];
  for (const chunk of code.split(/\n(?=export )/)) {
    const m = /^export (?:async )?function (\w+)/.exec(chunk);
    if (m) fns.push({ name: m[1], body: chunk });
  }
  const isRawGet = (body: string): boolean => {
    let idx = body.indexOf('bridgeFetch(');
    while (idx !== -1) {
      const end = body.indexOf(');', idx);
      const call = body.slice(idx, end === -1 ? undefined : end);
      if (!/\bmethod\s*:/.test(call)) return true;
      idx = body.indexOf('bridgeFetch(', idx + 1);
    }
    return false;
  };
  const reads = new Set<string>(fns.filter((f) => READ_HELPER_RE.test(f.body) || isRawGet(f.body)).map((f) => f.name));
  // transitive: an export that delegates to a read (`fetchStudioAgents` →
  // `fetchStudioAgentsWithMeta`) is a read too — iterate to a fixpoint.
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of fns) {
      if (reads.has(f.name)) continue;
      for (const r of reads) {
        if (new RegExp(`\\b${r}\\(`).test(f.body)) { reads.add(f.name); grew = true; break; }
      }
    }
  }
  return fns.map((f) => f.name).filter((n) => reads.has(n));
}

test('enumerateBridgeReadExports (positive control): finds helper-backed AND raw-GET exports, skips writes and pure exports', () => {
  const synthetic = [
    'export async function fetchThings(): Promise<T[]> {',
    "  const body = await studioRead<{ things?: unknown[] }>('/api/things');",
    '  return body.things ?? [];',
    '}',
    'export async function pollThing(id: string): Promise<S> {',
    '  const res = await bridgeFetch(`/api/things/${id}`);',
    '  return res.json();',
    '}',
    'export async function saveThing(id: string, body: unknown) {',
    "  return studioSend('PUT', `/api/things/${id}`, body);",
    '}',
    'export async function postThing(id: string) {',
    "  const res = await bridgeFetch(`/api/things/${id}`, { method: 'POST', headers: { 'x-forge-csrf': '1' } });",
    '  return res.ok;',
    '}',
    'export async function fetchThingIds(): Promise<string[]> {',
    '  return (await fetchThings()).map((t) => t.id);',
    '}',
    'export function pureThing(x: number): number { return x + 1; }',
    'export type Thing = { id: string };',
  ].join('\n');
  expect(enumerateBridgeReadExports(synthetic)).toEqual(['fetchThings', 'pollThing', 'fetchThingIds']);
});

test('table covers EVERY bridge read exported by studio-client (a new studioGet/studioRead/studioReadOr404/raw-GET export with no row fails here)', () => {
  const source = readFileSync(resolve(__dirname, './studio-client.ts'), 'utf8');
  const enumerated = enumerateBridgeReadExports(source);
  const names = ROWS.map((r) => r.name);
  expect(names).toEqual([...new Set(names)]);
  const missingRows = enumerated.filter((n) => !names.includes(n));
  const staleRows = names.filter((n) => !enumerated.includes(n));
  expect({ missingRows, staleRows }).toEqual({ missingRows: [], staleRows: [] });
  // and every function the table names really is exported (a renamed export leaves a stale row)
  for (const n of names) expect(typeof (sc as Record<string, unknown>)[n]).toBe('function');
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
      case 'run-lookup-absent':
        // A 404 WITHOUT `onDisk` (any older/other 404 on this route) is the
        // conservative answer: nothing is known to exist for the id.
        await expect(row.call()).resolves.toEqual({ run: null, onDisk: false });
        break;
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

// ---------------------------------------------------------------------------
// W7-FIX-A3 (round-2 finding 2): `onDisk` is the BRIDGE's fact, read verbatim
// off the 404 body — the artifact page's not-found rule keys on it, so a
// fabricated or inferred value would put the shared NotFound over an orphan
// log dir's artifacts (or hide a genuinely unknown id behind an artifact page).
// ---------------------------------------------------------------------------

test('fetchRunLookup: a 404 carrying onDisk:true → {run:null,onDisk:true} (the orphan `_logs/<id>/` case)', async () => {
  mockBridgeFetch.mockImplementation(async () => jsonRes(404, { error: 'run not found', onDisk: true }));
  await expect(sc.fetchRunLookup('orphan-1')).resolves.toEqual({ run: null, onDisk: true });
});

test('fetchRunLookup: a 404 carrying onDisk:false → {run:null,onDisk:false} (`?run=nope` stays NotFound)', async () => {
  mockBridgeFetch.mockImplementation(async () => jsonRes(404, { error: 'run not found', onDisk: false }));
  await expect(sc.fetchRunLookup('nope')).resolves.toEqual({ run: null, onDisk: false });
});

test('fetchRunLookup: a non-boolean onDisk is NOT trusted (only a literal true means "something is there")', async () => {
  mockBridgeFetch.mockImplementation(async () => jsonRes(404, { error: 'run not found', onDisk: 'yes' }));
  await expect(sc.fetchRunLookup('weird')).resolves.toEqual({ run: null, onDisk: false });
});

test('fetchRunLookup: a 500 REJECTS — an outage is never "no such run, nothing on disk"', async () => {
  mockBridgeFetch.mockImplementation(async () => jsonRes(500, { error: 'boom' }));
  await expect(sc.fetchRunLookup('run-1')).rejects.toMatchObject({ name: 'BridgeReadError', status: 500 });
});

// ---- W7-FIX-A1 A1-10: the three polls' FAILED-read shape is `state:'unknown'` ----
// (the per-row loop above pins ok:false + the bridge's text; this pins the
// state token itself — the poll wrappers key on `ok:false`, the panels render
// `state`, so a failed read must never masquerade as 'running').
const POLLS: Array<{ name: string; call: () => Promise<{ ok: boolean; state: string; error?: string }> }> = [
  { name: 'getAgentFixStatus', call: () => sc.getAgentFixStatus('k', 'r') },
  { name: 'getAgentRunStatus', call: () => sc.getAgentRunStatus('r') },
  { name: 'preflightFixStatus', call: () => sc.preflightFixStatus('p', 'r') },
];
for (const poll of POLLS) {
  test(`${poll.name}: transport throw → {ok:false, state:'unknown', error} — never a fabricated 'running'`, async () => {
    mockBridgeFetch.mockImplementation(async () => { throw new TypeError('Failed to fetch'); });
    const v = await poll.call();
    expect(v).toMatchObject({ ok: false, state: 'unknown', error: 'bridge unreachable (Failed to fetch)' });
  });
  test(`${poll.name}: 500 → {ok:false, state:'unknown', error:<bridge text>, status:500}`, async () => {
    mockBridgeFetch.mockImplementation(async () => jsonRes(500, { error: 'log dir vanished' }));
    const v = await poll.call();
    expect(v).toMatchObject({ ok: false, state: 'unknown', error: 'log dir vanished', status: 500 });
  });
  test(`${poll.name}: 404 → {ok:false, state:'unknown', status:404} (the bridge ANSWERED — a definitive not-found the poll wrappers treat as terminal); a transport failure carries NO status`, async () => {
    mockBridgeFetch.mockImplementation(async () => jsonRes(404, { error: 'no run found' }));
    const v = await poll.call();
    expect(v).toMatchObject({ ok: false, state: 'unknown', error: 'no run found', status: 404 });
    mockBridgeFetch.mockImplementation(async () => { throw new TypeError('Failed to fetch'); });
    const t = (await poll.call()) as { status?: number };
    expect(t.status).toBeUndefined();
  });
  test(`${poll.name}: a 200 whose body has no state → {ok:true, state:'unknown'} with NO error (the bridge's own honest "no state recorded" stays distinguishable from a failed read)`, async () => {
    mockBridgeFetch.mockImplementation(async () => jsonRes(200, { ok: true }));
    const v = await poll.call();
    expect(v.ok).toBe(true);
    expect(v.state).toBe('unknown');
    expect(v.error).toBeUndefined();
  });
}
