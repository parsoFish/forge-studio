/**
 * Tests for packages/knowledge/kb-drain-routes.ts's HTTP layer — Part B of
 * `bridge-studio-kb-drain.test.ts`, split out here (M4-style carve, same
 * reason the production module itself was already split) once the two files
 * together crossed the 800-line cap.
 *
 * Against a real bridge + isolated forge-root, using KBs that carry ZERO real
 * findings (so the DEFAULT fix-turn path never needs to spawn — no real SDK
 * call in this suite either way; FORGE_ARCHITECT_NO_SPAWN is additionally set
 * as belt-and-suspenders, mirroring the drain loop's own noSpawn guard).
 *
 * Drives the CARVED HANDLERS directly — no bridge (COMMON §5). Same seam as
 * `tests/integration/routes-dispatch.test.ts`; the `{status, json}` shape is
 * preserved so every assertion below is byte-for-byte what it was over HTTP.
 *
 * The two `Promise.all` concurrency tests keep their meaning: the per-kb
 * active-job lock they exercise is a check-then-write that is ENTIRELY
 * synchronous (`findActiveKbDrainRun` -> `writeKbDrainStatus`, no `await`
 * between), so under run-to-completion the first caller into that span wins
 * outright — over sockets or over a direct dispatch alike.
 *
 * Not tested here: origin/CSRF/404-fallthrough, which are the host's policy
 * and live in `cli/*.test.ts`; the state-machine termination matrix, which
 * lives in the sibling `bridge-studio-kb-drain.test.ts` (Part A).
 */

import { refusingSessionStatusIo } from '../test-fixtures/session-status-io.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { dispatchRoute } from '@forge/kernel';
import { knowledgeRoutes, type KnowledgeRouteContext } from '../../routes.ts';
import { writeKbDrainStatus } from '../../bridge-studio-kb-drain.ts';

const routes = knowledgeRoutes({
  sessionStatusIo: refusingSessionStatusIo,
  listFlowIds: () => ['forge-develop'],
  listFlowBandIds: () => ['review-band', 'integrate-band'],
  // M4 ruling 86: the real fix turn is injected by the assembly, so route
  // tests declare one. It THROWS: no assertion in this file expects a fix turn
  // to be dispatched, and a stub that returned a plausible result would let a
  // future change dispatch one here unnoticed.
  runFixTurn: async () => {
    throw new Error('unexpected brain-fix dispatch in this test');
  },
  // M7-C U8 (bead forge-u8y2): REQUIRED, same shape as `runFixTurn` above.
  // Every KB this base table's tests dispatch against is clean (0 findings,
  // perFinding always []) — the probe is never reached through it.
  sessionIsReadable: () => {
    throw new Error('unexpected session-readability probe call in this test');
  },
});

const mockReq = () => ({ headers: {} }) as unknown as IncomingMessage;

function mockRes(): { res: ServerResponse; captured: { status: number | null; body: string } } {
  const captured: { status: number | null; body: string } = { status: null, body: '' };
  const res = {
    writeHead(status: number) { captured.status = status; return res; },
    end(payload?: string) { if (payload !== undefined) captured.body = payload; return res; },
  } as unknown as ServerResponse;
  return { res, captured };
}

async function dispatch(root: string, path: string, method: string, body: unknown = {}): Promise<{ status: number; json: Record<string, unknown> }> {
  const { res, captured } = mockRes();
  const ctx: KnowledgeRouteContext = {
    forgeRoot: root,
    logsRoot: join(root, '_logs'),
    // T1 ruling 30: the HOST parses the body and hands the RESULT down, so a
    // handler-level test supplies the result rather than faking a request
    // stream — which would re-test the host's body policy from inside a package.
    readBody: async () => body,
  };
  const matched = await dispatchRoute(routes, mockReq(), res, ctx, path, method);
  assert.ok(matched, `no carved route claimed ${method} ${path}`);
  return { status: captured.status ?? 0, json: JSON.parse(captured.body || '{}') as Record<string, unknown> };
}

function makeIsolatedBridge(): { root: string } {
  const root = mkdtempSync(join(tmpdir(), 'kb-drain-http-'));
  for (const state of ['in-flight', 'done', 'failed', 'pending']) {
    mkdirSync(join(root, '_queue', state), { recursive: true });
  }
  mkdirSync(join(root, '_logs'), { recursive: true });
  return { root };
}

/** A clean (zero-finding) KB — the default fix-turn path never needs to spawn
 *  regardless of env, since there is never an agent-tier residual to dispatch. */
function seedCleanKb(root: string, kbId: string): void {
  const dir = join(root, 'brain', kbId);
  mkdirSync(join(dir, 'themes'), { recursive: true });
  writeFileSync(join(dir, 'kb.yaml'), `id: ${kbId}\nname: ${kbId}\nbinding: { kind: unique }\ndesc: clean http-route fixture.\n`);
}

const postJson = (root: string, path: string) => dispatch(root, path, 'POST');
const getJson = (root: string, path: string) => dispatch(root, path, 'GET');

async function pollDrainTerminal(base: string, kbId: string, runId: string, maxAttempts = 60): Promise<Record<string, unknown>> {
  for (let i = 0; i < maxAttempts; i++) {
    const { json } = await getJson(base, `/api/studio/kbs/${kbId}/drain/${runId}`);
    if (json['state'] && json['state'] !== 'running') return json;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`drain run ${runId} never reached a terminal state within budget`);
}

test('POST /api/studio/kbs/:id/drain — dispatches (200 + runId) and reaches GREEN for a clean kb', async () => {
  const iso = makeIsolatedBridge();
  const prevNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  try {
    seedCleanKb(iso.root, 'clean-alpha');
    const dispatch = await postJson(iso.root, '/api/studio/kbs/clean-alpha/drain');
    assert.equal(dispatch.status, 200, JSON.stringify(dispatch.json));
    assert.equal(dispatch.json['ok'], true);
    const runId = dispatch.json['runId'] as string;
    assert.ok(runId.startsWith('clean-alpha-drain-'), runId);

    const terminal = await pollDrainTerminal(iso.root, 'clean-alpha', runId);
    assert.equal(terminal['state'], 'green', JSON.stringify(terminal));
    assert.equal(terminal['kbId'], 'clean-alpha');
    assert.deepEqual(terminal['counts'], { auto: 0, agent: 0, user: 0 });
  } finally {
    process.env.FORGE_ARCHITECT_NO_SPAWN = prevNoSpawn;
    rmSync(iso.root, { recursive: true, force: true });
  }
});

test('POST /api/studio/kbs/:id/drain — genuine concurrent dispatch: exactly one 200 + one 409, both naming the SAME runId, exactly one status dir', async () => {
  // Reviewer LOW finding: fire both requests via Promise.all (not sequential
  // await-then-await) so this actually exercises the race, not just ordering.
  // Reliable-by-construction, not merely "usually passes": the 409-check +
  // the initial status write are FULLY SYNCHRONOUS (no `await` between them)
  // inside the route handler, so once ONE request's execution enters that
  // section it runs to completion before the other's can — Node's
  // single-threaded event loop cannot interleave mid-synchronous-section.
  // Exactly one request is therefore guaranteed to see "no active run" and
  // win; the other always sees the winner's freshly-written status and 409s.
  const iso = makeIsolatedBridge();
  const prevNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  try {
    seedCleanKb(iso.root, 'clean-concurrent');
    const [a, b] = await Promise.all([
      postJson(iso.root, '/api/studio/kbs/clean-concurrent/drain'),
      postJson(iso.root, '/api/studio/kbs/clean-concurrent/drain'),
    ]);
    const statuses = [a.status, b.status].sort((x, y) => x - y);
    assert.deepEqual(
      statuses,
      [200, 409],
      `expected exactly one 200 and one 409, got ${JSON.stringify(statuses)} — responses: ${JSON.stringify([a.json, b.json])}`,
    );
    const winner = a.status === 200 ? a : b;
    const loser = a.status === 200 ? b : a;
    assert.equal(loser.json['runId'], winner.json['runId'], 'the 409 must report the SAME runId as the winning dispatch');

    // Exactly one status dir on disk — no split-brain double-dispatch.
    const dirs = readdirSync(join(iso.root, '_logs')).filter((d) => d.startsWith('_kb-drain-clean-concurrent-drain-'));
    assert.equal(dirs.length, 1, `expected exactly one drain log dir, got ${JSON.stringify(dirs)}`);

    await pollDrainTerminal(iso.root, 'clean-concurrent', winner.json['runId'] as string);
  } finally {
    process.env.FORGE_ARCHITECT_NO_SPAWN = prevNoSpawn;
    rmSync(iso.root, { recursive: true, force: true });
  }
});

test('GET /api/studio/kbs/:id/drain/:runId — a corrupted status.json is read null-safe (404, not a 500 crash)', async () => {
  const iso = makeIsolatedBridge();
  try {
    seedCleanKb(iso.root, 'corrupt-kb');
    const runId = 'corrupt-kb-drain-deadbeef';
    const dir = join(iso.root, '_logs', `_kb-drain-${runId}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'status.json'), '{ this is not valid json,,, ', 'utf8');
    const res = await getJson(iso.root, `/api/studio/kbs/corrupt-kb/drain/${runId}`);
    assert.equal(res.status, 404, JSON.stringify(res.json));
  } finally {
    rmSync(iso.root, { recursive: true, force: true });
  }
});

test('POST /api/studio/kbs/:id/drain — 404 for an unknown kb', async () => {
  const iso = makeIsolatedBridge();
  try {
    const res = await postJson(iso.root, '/api/studio/kbs/does-not-exist/drain');
    assert.equal(res.status, 404, JSON.stringify(res.json));
  } finally {
    rmSync(iso.root, { recursive: true, force: true });
  }
});

test('GET /api/studio/kbs/:id/drain/:runId — 404 for a traversal-shaped runId', async () => {
  const iso = makeIsolatedBridge();
  try {
    seedCleanKb(iso.root, 'clean-gamma');
    const traversal = encodeURIComponent('../../etc/passwd');
    const res = await getJson(iso.root, `/api/studio/kbs/clean-gamma/drain/${traversal}`);
    assert.equal(res.status, 404, JSON.stringify(res.json));
  } finally {
    rmSync(iso.root, { recursive: true, force: true });
  }
});

test('GET /api/studio/kbs/:id/drain/:runId — 404 for a charset-safe but wrong-kb-prefixed runId', async () => {
  const iso = makeIsolatedBridge();
  try {
    seedCleanKb(iso.root, 'clean-delta');
    const foreign = 'some-other-kb-drain-abc123';
    const res = await getJson(iso.root, `/api/studio/kbs/clean-delta/drain/${foreign}`);
    assert.equal(res.status, 404, JSON.stringify(res.json));
  } finally {
    rmSync(iso.root, { recursive: true, force: true });
  }
});

test('GET /api/studio/kbs/:id/drain — active-or-latest reattach: running immediately after dispatch, terminal after completion', async () => {
  const iso = makeIsolatedBridge();
  const prevNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  try {
    seedCleanKb(iso.root, 'clean-epsilon');
    const dispatch = await postJson(iso.root, '/api/studio/kbs/clean-epsilon/drain');
    const runId = dispatch.json['runId'] as string;

    // Immediately after dispatch — the route wrote the initial snapshot
    // synchronously, so a same-turn reattach must see it (no navigation gap).
    const immediate = await getJson(iso.root, '/api/studio/kbs/clean-epsilon/drain');
    assert.equal(immediate.json['runId'], runId, JSON.stringify(immediate.json));

    await pollDrainTerminal(iso.root, 'clean-epsilon', runId);

    const after = await getJson(iso.root, '/api/studio/kbs/clean-epsilon/drain');
    assert.equal(after.json['runId'], runId, JSON.stringify(after.json));
    assert.equal(after.json['state'], 'green', JSON.stringify(after.json));
  } finally {
    process.env.FORGE_ARCHITECT_NO_SPAWN = prevNoSpawn;
    rmSync(iso.root, { recursive: true, force: true });
  }
});

test('GET /api/studio/kbs/:id/drain — no runs yet returns runId:null, not an error', async () => {
  const iso = makeIsolatedBridge();
  try {
    seedCleanKb(iso.root, 'clean-zeta');
    const res = await getJson(iso.root, '/api/studio/kbs/clean-zeta/drain');
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json['runId'], null);
  } finally {
    rmSync(iso.root, { recursive: true, force: true });
  }
});

test('drain vs consolidate are mutually GATED per kb (W7-B2, knowledge-05): concurrent dispatch = one 200 + one 409 naming the active job', async () => {
  // Pre-W7 both dispatches were accepted and silently serialized through the
  // shared per-kbId queue — a Consolidate clicked during a drain read
  // "Consolidating…" for however long the drain took, with no signal that it
  // was queued. The contract now: the SECOND mutating dispatch is refused
  // with a 409 carrying the activeJobReason text the UI shows.
  const iso = makeIsolatedBridge();
  const prevNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  try {
    seedCleanKb(iso.root, 'clean-shared');

    const [drainDispatch, consolidateDispatch] = await Promise.all([
      postJson(iso.root, '/api/studio/kbs/clean-shared/drain'),
      dispatch(iso.root, '/api/studio/kbs/clean-shared/maintenance', 'POST', { op: 'consolidate' }),
    ]);

    const statuses = [drainDispatch.status, consolidateDispatch.status].sort((a, b) => a - b);
    assert.deepEqual(
      statuses,
      [200, 409],
      `expected exactly one accepted dispatch and one 409, got ${JSON.stringify([drainDispatch, consolidateDispatch])}`,
    );
    const loser = drainDispatch.status === 409 ? drainDispatch : consolidateDispatch;
    assert.match(String(loser.json['error']), /active for this kb/, JSON.stringify(loser.json));

    // The winner still reaches a real terminal state.
    if (drainDispatch.status === 200) {
      const drainTerminal = await pollDrainTerminal(iso.root, 'clean-shared', drainDispatch.json['runId'] as string);
      assert.equal(drainTerminal['state'], 'green', JSON.stringify(drainTerminal));
    } else {
      const consolidateRunId = consolidateDispatch.json['runId'] as string;
      let consolidateState = 'running';
      for (let i = 0; i < 60 && consolidateState === 'running'; i++) {
        const { json } = await getJson(iso.root, `/api/studio/kbs/clean-shared/fix-agent/${consolidateRunId}`);
        consolidateState = json['state'] as string;
        if (consolidateState === 'running') await new Promise((r) => setTimeout(r, 100));
      }
      assert.notEqual(consolidateState, 'running', 'consolidate run never reached a terminal state within budget');
    }
  } finally {
    process.env.FORGE_ARCHITECT_NO_SPAWN = prevNoSpawn;
    rmSync(iso.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// knowledge-01 (forge-6gv.6.1) — the WS tail is armed for a live drain's
// cycle, so an already-open activity drawer actually streams instead of
// freezing at whatever `events.jsonl` held on first mount. `ensureAgentRunTail`
// / `releaseAgentRunTail` are OPTIONAL on `KnowledgeRouteDeps` — every OTHER
// `knowledgeRoutes({...})` call in this file (this file's own shared `routes`
// above included) supplies neither and is completely unaffected; these tests
// build their OWN routes table with spies to observe the calls.
// ---------------------------------------------------------------------------

/** A local dispatch helper parameterised on the routes table — the shared
 *  `dispatch`/`postJson`/`getJson` above are closed over the file's ONE
 *  shared `routes` const, which carries no tail deps. */
async function dispatchTo(
  tailRoutes: ReturnType<typeof knowledgeRoutes>,
  root: string,
  path: string,
  method: string,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const { res, captured } = mockRes();
  const ctx: KnowledgeRouteContext = { forgeRoot: root, logsRoot: join(root, '_logs'), readBody: async () => ({}) };
  const matched = await dispatchRoute(tailRoutes, mockReq(), res, ctx, path, method);
  assert.ok(matched, `no carved route claimed ${method} ${path}`);
  return { status: captured.status ?? 0, json: JSON.parse(captured.body || '{}') as Record<string, unknown> };
}

test('knowledge-01: POST /drain arms the live tail for the cycle the instant the run exists — before the panel\'s own first poll', async () => {
  const armed: string[] = [];
  const tailRoutes = knowledgeRoutes({
    sessionStatusIo: refusingSessionStatusIo,
    listFlowIds: () => ['forge-develop'],
    listFlowBandIds: () => ['review-band', 'integrate-band'],
    runFixTurn: async () => { throw new Error('unexpected brain-fix dispatch in this test'); },
    // M7-C U8 (bead forge-u8y2): REQUIRED. This test drives the LIVE polling
    // path a real bridge would — `() => true` (never actually invoked: the
    // clean kb's perFinding is always []) rather than a throw, since this is
    // exactly the production path the predicate legitimately gates.
    sessionIsReadable: () => true,
    ensureAgentRunTail: (cycleId) => armed.push(cycleId),
    releaseAgentRunTail: () => {},
  });
  const iso = makeIsolatedBridge();
  const prevNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  try {
    seedCleanKb(iso.root, 'clean-tail-start');
    const dispatch = await dispatchTo(tailRoutes, iso.root, '/api/studio/kbs/clean-tail-start/drain', 'POST');
    assert.equal(dispatch.status, 200, JSON.stringify(dispatch.json));
    const runId = dispatch.json['runId'] as string;
    assert.deepEqual(armed, [`_kb-drain-${runId}`],
      'expected exactly one ensureAgentRunTail call, for this run\'s own cycle id');
  } finally {
    process.env.FORGE_ARCHITECT_NO_SPAWN = prevNoSpawn;
    rmSync(iso.root, { recursive: true, force: true });
  }
});

test('knowledge-01: GET /drain/:runId re-arms the tail on every poll while running, then RELEASES it once the run reaches a terminal state', async () => {
  const armed: string[] = [];
  const released: string[] = [];
  const tailRoutes = knowledgeRoutes({
    sessionStatusIo: refusingSessionStatusIo,
    listFlowIds: () => ['forge-develop'],
    listFlowBandIds: () => ['review-band', 'integrate-band'],
    runFixTurn: async () => { throw new Error('unexpected brain-fix dispatch in this test'); },
    // M7-C U8 (bead forge-u8y2): REQUIRED — same reasoning as the sibling
    // tailRoutes above (live polling path, clean kb, never actually invoked).
    sessionIsReadable: () => true,
    ensureAgentRunTail: (cycleId) => armed.push(cycleId),
    releaseAgentRunTail: (cycleId) => released.push(cycleId),
  });
  const iso = makeIsolatedBridge();
  const prevNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  try {
    seedCleanKb(iso.root, 'clean-tail-poll');
    const dispatch = await dispatchTo(tailRoutes, iso.root, '/api/studio/kbs/clean-tail-poll/drain', 'POST');
    const runId = dispatch.json['runId'] as string;
    const cycleId = `_kb-drain-${runId}`;

    // Immediately after dispatch the run is still 'running' (enqueueConsolidate
    // defers its real work by CONSOLIDATE_DISPATCH_DEFER_MS = 50ms — reliable
    // by construction, the same reasoning the concurrent-dispatch test above
    // relies on for its own synchronous check-then-write window).
    armed.length = 0; // the START dispatch above already armed once — isolate the POLL's own arm.
    const firstPoll = await dispatchTo(tailRoutes, iso.root, `/api/studio/kbs/clean-tail-poll/drain/${runId}`, 'GET');
    assert.equal(firstPoll.json['state'], 'running', JSON.stringify(firstPoll.json));
    assert.deepEqual(armed, [cycleId], 'a poll against a RUNNING drain must re-arm the tail');
    // Not `assert.deepEqual(released, [], …)`: @types/node types deepEqual as
    // an assertion function (`asserts actual is T`), so it would narrow
    // `released` itself to `never[]` for the rest of this scope, breaking the
    // `.includes(cycleId)` check below with a real (if confusing) type error.
    assert.equal(released.length, 0, 'must not release a tail that is still live');

    let terminalJson: Record<string, unknown> | null = null;
    for (let i = 0; i < 60; i++) {
      const poll = await dispatchTo(tailRoutes, iso.root, `/api/studio/kbs/clean-tail-poll/drain/${runId}`, 'GET');
      if (poll.json['state'] !== 'running') { terminalJson = poll.json; break; }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(terminalJson, 'drain run never reached a terminal state within budget');
    assert.equal(terminalJson!['state'], 'green', JSON.stringify(terminalJson));
    assert.ok(released.includes(cycleId), 'the poll that FIRST observed the terminal state must release the tail');
  } finally {
    process.env.FORGE_ARCHITECT_NO_SPAWN = prevNoSpawn;
    rmSync(iso.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// M7-C U8 (bead forge-u8y2, W8-F6 follow-up) — a stored `/sessions/kb-cleanup/
// <id>` pointer never reaches the wire when the injected `sessionIsReadable`
// port says it resolves nowhere. `dispatchTo` above (built for the tail
// tests) is reused here for a routes table wired with a stub probe instead.
// ---------------------------------------------------------------------------

function routesWithProbe(sessionIsReadable: (args: { kind: string; sessionId: string; project?: string | null }) => boolean) {
  return knowledgeRoutes({
    sessionStatusIo: refusingSessionStatusIo,
    listFlowIds: () => ['forge-develop'],
    listFlowBandIds: () => ['review-band', 'integrate-band'],
    runFixTurn: async () => { throw new Error('unexpected brain-fix dispatch in this test'); },
    sessionIsReadable,
  });
}

test('M7-C U8: GET /api/studio/kbs/:id/runs drops a cleanup row the probe calls unreadable, keeps it when readable', async () => {
  const iso = makeIsolatedBridge();
  try {
    seedCleanKb(iso.root, 'ledger-kb');
    const sid = '2026-08-20T09-00-00-ab12';
    const anchorDir = join(iso.root, 'projects', '.kb-ledger-kb', '_kb-cleanup', sid);
    mkdirSync(anchorDir, { recursive: true });
    writeFileSync(join(anchorDir, 'status.json'), JSON.stringify({ phase: 'awaiting-approval', kb_id: 'ledger-kb' }), 'utf8');

    const seen: Array<{ kind: string; sessionId: string; project?: string | null }> = [];
    const dropped = await dispatchTo(routesWithProbe((a) => { seen.push(a); return false; }), iso.root, '/api/studio/kbs/ledger-kb/runs', 'GET');
    assert.equal(dropped.status, 200, JSON.stringify(dropped.json));
    const droppedRuns = dropped.json['runs'] as Array<Record<string, unknown>>;
    assert.equal(droppedRuns.some((r) => r['kind'] === 'cleanup'), false, `expected no cleanup row on the wire, got ${JSON.stringify(droppedRuns)}`);
    assert.ok(seen.some((a) => a.kind === 'kb-cleanup' && a.sessionId === sid && a.project === '.kb-ledger-kb'), `probe must see the stored pointer, got ${JSON.stringify(seen)}`);

    const kept = await dispatchTo(routesWithProbe(() => true), iso.root, '/api/studio/kbs/ledger-kb/runs', 'GET');
    const keptRuns = kept.json['runs'] as Array<Record<string, unknown>>;
    assert.ok(keptRuns.some((r) => r['kind'] === 'cleanup' && r['id'] === sid), `expected the cleanup row kept, got ${JSON.stringify(keptRuns)}`);
  } finally {
    rmSync(iso.root, { recursive: true, force: true });
  }
});

function seedDrainStatusWithDraft(root: string, runId: string, kbId: string, draftSessionId: string, draftProject: string): void {
  writeKbDrainStatus(root, runId, {
    state: 'needs-you', round: 1, counts: { auto: 0, agent: 0, user: 1 },
    perFinding: [{
      key: 'f1', check: 'some-check', kind: 'prose', file: 'brain/x/themes/y.md', message: 'msg',
      tier: 'agent', outcome: 'needs-you', round: 1,
      draftSession: { id: draftSessionId, project: draftProject },
    }],
    costUsd: 0.01, updatedAt: new Date().toISOString(), kbId, startedAt: new Date().toISOString(),
    maxRounds: 5, maxCostUsd: 2,
  });
}

test('M7-C U8: GET /api/studio/kbs/:id/drain/:runId and GET .../drain drop draftSession the probe calls unreadable, keep it when readable', async () => {
  const iso = makeIsolatedBridge();
  try {
    seedCleanKb(iso.root, 'draft-kb');
    const runId = 'draft-kb-drain-abc123';
    seedDrainStatusWithDraft(iso.root, runId, 'draft-kb', '2026-08-20T09-00-00-cd34', '.kb-draft-kb');

    const droppingRoutes = routesWithProbe(() => false);
    const droppedRun = await dispatchTo(droppingRoutes, iso.root, `/api/studio/kbs/draft-kb/drain/${runId}`, 'GET');
    assert.equal(droppedRun.status, 200, JSON.stringify(droppedRun.json));
    const droppedRunFindings = droppedRun.json['perFinding'] as Array<Record<string, unknown>>;
    assert.equal(droppedRunFindings[0]['draftSession'], undefined, `expected draftSession dropped, got ${JSON.stringify(droppedRunFindings)}`);

    const droppedStatus = await dispatchTo(droppingRoutes, iso.root, '/api/studio/kbs/draft-kb/drain', 'GET');
    const droppedStatusFindings = droppedStatus.json['perFinding'] as Array<Record<string, unknown>>;
    assert.equal(droppedStatusFindings[0]['draftSession'], undefined, `expected draftSession dropped on the reattach path too, got ${JSON.stringify(droppedStatusFindings)}`);

    const keepingRoutes = routesWithProbe(() => true);
    const keptRun = await dispatchTo(keepingRoutes, iso.root, `/api/studio/kbs/draft-kb/drain/${runId}`, 'GET');
    const keptRunFindings = keptRun.json['perFinding'] as Array<Record<string, unknown>>;
    assert.deepEqual(keptRunFindings[0]['draftSession'], { id: '2026-08-20T09-00-00-cd34', project: '.kb-draft-kb' });
  } finally {
    rmSync(iso.root, { recursive: true, force: true });
  }
});
