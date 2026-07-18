/**
 * Tests for the architect bridge routes (ADR 020).
 *
 * Starts a real bridge against a temp `forgeRoot` with a file-seeded session
 * dir (no SDK, no spawn — `FORGE_ARCHITECT_NO_SPAWN=1`), and exercises the
 * `/api/architect/*` + `/api/plan-verdict` surface over HTTP.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { WebSocket } from 'ws';

import { startBridge } from './ui-bridge.ts';

process.env.FORGE_ARCHITECT_NO_SPAWN = '1';

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;
const sid = '2026-05-29T12-00-00';

function sessionDir(s = sid): string {
  return join(forgeRoot, 'projects', 'demo', '_architect', s);
}

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-arch-'));
  const dir = sessionDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'status.json'),
    JSON.stringify({
      session_id: sid,
      project: 'demo',
      project_repo_path: join(forgeRoot, 'projects', 'demo'),
      phase: 'awaiting-verdict',
      round: 2,
      idea: 'Add a dark-mode toggle.',
      updated_at: new Date().toISOString(),
    }),
  );
  writeFileSync(join(dir, 'PLAN.html'), '<!doctype html><title>PLAN</title><h1>dark mode</h1>');
  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

test('GET /api/architect/sessions lists the session with planUrl (no escalations field)', async () => {
  const body = (await (await fetch(`${url}/api/architect/sessions`)).json()) as {
    sessions: Array<{
      sessionId: string;
      phase: string;
      escalations?: unknown;
      planUrl: string | null;
      completenessCritic: unknown;
    }>;
  };
  const s = body.sessions.find((x) => x.sessionId === sid);
  assert.ok(s, 'session present');
  assert.equal(s!.phase, 'awaiting-verdict');
  assert.ok(!('escalations' in s!), 'escalations field must be absent from session summary');
  assert.ok(s!.planUrl);
  assert.equal(s!.completenessCritic, null, 'critic has not run yet for this fixture session');
});

test('GET /api/architect/file serves PLAN.html as text/html with a path-escape guard', async () => {
  const planRes = await fetch(
    `${url}/api/architect/file/demo/${encodeURIComponent(sid)}/PLAN.html`,
  );
  assert.equal(planRes.status, 200);
  assert.match(planRes.headers.get('content-type') ?? '', /text\/html/);

  const escape = await fetch(
    `${url}/api/architect/file/demo/${encodeURIComponent(sid)}/..%2F..%2Fstatus.json`,
  );
  assert.equal(escape.status, 400);
});

test('POST /api/plan-verdict approve advances to finalizing (no selections.json written)', async () => {
  const res = await fetch(`${url}/api/plan-verdict`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify({ project: 'demo', sessionId: sid, kind: 'approve' }),
  });
  assert.equal(res.status, 200);
  const dir = sessionDir();
  assert.ok(!existsSync(join(dir, 'selections.json')), 'selections.json must NOT be written');
  const status = JSON.parse(readFileSync(join(dir, 'status.json'), 'utf8'));
  assert.equal(status.phase, 'finalizing');
});

test('POST /api/architect/answer appends an interview round', async () => {
  const sid2 = '2026-05-29T13-00-00';
  const dir2 = sessionDir(sid2);
  mkdirSync(dir2, { recursive: true });
  writeFileSync(
    join(dir2, 'status.json'),
    JSON.stringify({
      session_id: sid2,
      project: 'demo',
      project_repo_path: dir2,
      phase: 'awaiting-answers',
      round: 1,
      idea: 'x',
      updated_at: '',
    }),
  );
  const res = await fetch(`${url}/api/architect/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify({ project: 'demo', sessionId: sid2, answers: [{ question: 'Q', answer: 'A' }] }),
  });
  assert.equal(res.status, 200);
  const ans = JSON.parse(readFileSync(join(dir2, 'answers.json'), 'utf8'));
  assert.equal(ans[0].answers[0].answer, 'A');
  const status = JSON.parse(readFileSync(join(dir2, 'status.json'), 'utf8'));
  assert.equal(status.phase, 'interviewing');
  assert.equal(status.round, 2);
});

// ---------------------------------------------------------------------------
// R4-11-T5: POST /api/architect/rerun — the StuckWarning one-click re-spawn.
// Unlike /api/architect/answer, this never appends a round or writes
// answers.json — it re-invokes the existing session's turn as-is.
// ---------------------------------------------------------------------------

test('POST /api/architect/rerun re-spawns the existing session WITHOUT mutating round/answers', async () => {
  const sid3 = '2026-05-29T17-00-00';
  const dir3 = sessionDir(sid3);
  mkdirSync(dir3, { recursive: true });
  writeFileSync(
    join(dir3, 'status.json'),
    JSON.stringify({
      session_id: sid3,
      project: 'demo',
      project_repo_path: dir3,
      phase: 'drafting',
      round: 2,
      idea: 'stalled idea',
      updated_at: new Date(Date.now() - 200_000).toISOString(),
    }),
  );
  const res = await fetch(`${url}/api/architect/rerun`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify({ project: 'demo', sessionId: sid3 }),
  });
  assert.equal(res.status, 200);
  assert.ok(!existsSync(join(dir3, 'answers.json')), 'rerun must NOT write answers.json');
  const status = JSON.parse(readFileSync(join(dir3, 'status.json'), 'utf8'));
  assert.equal(status.phase, 'drafting', 'rerun must not mutate phase');
  assert.equal(status.round, 2, 'rerun must not mutate round');
});

test('POST /api/architect/rerun on an unknown session → 404', async () => {
  const res = await fetch(`${url}/api/architect/rerun`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify({ project: 'demo', sessionId: 'no-such-session' }),
  });
  assert.equal(res.status, 404);
});

test('POST /api/architect/rerun: FORGE_DRY_BRIDGE=1 alone suppresses the spawn (explicit marker, no log dir)', async () => {
  const priorNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  const priorDryBridge = process.env.FORGE_DRY_BRIDGE;
  delete process.env.FORGE_ARCHITECT_NO_SPAWN;
  process.env.FORGE_DRY_BRIDGE = '1';
  try {
    const sid4 = '2026-05-29T18-00-00';
    const dir4 = sessionDir(sid4);
    mkdirSync(dir4, { recursive: true });
    writeFileSync(
      join(dir4, 'status.json'),
      JSON.stringify({
        session_id: sid4,
        project: 'demo',
        project_repo_path: dir4,
        phase: 'drafting',
        round: 1,
        idea: 'x',
        updated_at: new Date(Date.now() - 200_000).toISOString(),
      }),
    );
    const res = await fetch(`${url}/api/architect/rerun`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
      body: JSON.stringify({ project: 'demo', sessionId: sid4 }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.deepEqual(body.dryBridge, { skipped: ['agent-turn'] }, 'the skipped agent turn must be explicit in the response');
    assert.ok(
      !existsSync(join(forgeRoot, '_logs', `_architect-${sid4}`)),
      'dry-bridge must not create the architect spawn log dir',
    );
  } finally {
    if (priorNoSpawn === undefined) delete process.env.FORGE_ARCHITECT_NO_SPAWN;
    else process.env.FORGE_ARCHITECT_NO_SPAWN = priorNoSpawn;
    if (priorDryBridge === undefined) delete process.env.FORGE_DRY_BRIDGE;
    else process.env.FORGE_DRY_BRIDGE = priorDryBridge;
  }
});

test('POST /api/architect/rerun: an unsafe (path-traversal) sessionId is refused by spawnAgentTurn (no spawn log dir)', async () => {
  // Collapses via path.join's string-level `..` resolution to the SAME real
  // session dir (so the route's upstream readStatus check passes) while
  // itself being a `/`-bearing, multi-segment id `isSafeRunId` must reject —
  // mirrors ui-bridge-unsafe-sessionid.test.ts's fixture shape.
  const realSid = '2026-05-29T19-00-00';
  const dir5 = sessionDir(realSid);
  mkdirSync(dir5, { recursive: true });
  writeFileSync(
    join(dir5, 'status.json'),
    JSON.stringify({
      session_id: realSid,
      project: 'demo',
      project_repo_path: dir5,
      phase: 'drafting',
      round: 1,
      idea: 'x',
      updated_at: new Date(Date.now() - 200_000).toISOString(),
    }),
  );
  const unsafeSessionId = `${realSid}/../${realSid}`;
  const res = await fetch(`${url}/api/architect/rerun`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify({ project: 'demo', sessionId: unsafeSessionId }),
  });
  const json = await res.json();
  // Best-effort: session bookkeeping (the 200 + read) still succeeds even
  // though the spawn itself was refused (spawnAgentTurn's fire-and-forget
  // contract), mirroring the other spawn routes' documented behaviour.
  assert.equal(res.status, 200, JSON.stringify(json));
  const logsEntries = existsSync(join(forgeRoot, '_logs')) ? readdirSync(join(forgeRoot, '_logs')) : [];
  assert.ok(
    !logsEntries.some((e) => e.startsWith(`_architect-${realSid}`)),
    `expected no _architect-${realSid}* dir under _logs/ for an unsafe sessionId, found: ${JSON.stringify(logsEntries)}`,
  );
});

test('GET /api/architect/sessions live-tails the session log → WS event stream (hex bursts)', async () => {
  // Seed the runner's event log for the awaiting-verdict session.
  const logDir = join(forgeRoot, '_logs', `_architect-${sid}`);
  mkdirSync(logDir, { recursive: true });
  writeFileSync(
    join(logDir, 'events.jsonl'),
    JSON.stringify({
      event_id: 'EV_tool_1',
      cycle_id: `_architect-${sid}`,
      initiative_id: `architect-session-${sid}`,
      phase: 'architect',
      skill: 'architect-runner',
      event_type: 'tool_use',
      started_at: new Date().toISOString(),
      input_refs: [],
      output_refs: [],
      message: 'tool.Grep',
      metadata: { tool: 'Grep' },
    }) + '\n',
  );

  const ws = new WebSocket(`${url.replace(/^http/, 'ws')}/ws`);
  const got = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 4000);
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as { type?: string; cycleId?: string; event?: { event_type?: string } };
        if (msg.type === 'event' && msg.cycleId === `_architect-${sid}` && msg.event?.event_type === 'tool_use') {
          clearTimeout(timer);
          resolve(true);
        }
      } catch { /* ignore */ }
    });
  });
  await new Promise<void>((r) => ws.on('open', () => r()));
  // GET sessions triggers ensureArchitectTail; the 200ms tail then replays the log.
  await fetch(`${url}/api/architect/sessions`);
  const received = await got;
  ws.close();
  assert.ok(received, 'expected a tool_use event over the WS for the architect session');
});

test('POST /api/architect/start creates a session dir + status', async () => {
  const res = await fetch(`${url}/api/architect/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify({ project: 'demo', idea: 'A brand new idea.' }),
  });
  assert.equal(res.status, 200);
  const { sessionId } = (await res.json()) as { sessionId: string };
  const dir = sessionDir(sessionId);
  assert.ok(existsSync(join(dir, 'status.json')));
  assert.ok(existsSync(join(dir, 'idea.md')));
  const status = JSON.parse(readFileSync(join(dir, 'status.json'), 'utf8'));
  assert.equal(status.phase, 'interviewing');
});

// ---------------------------------------------------------------------------
// Double-finalize guard (completeness-critic hardening): plan verdicts are
// serialized by a status.json lock and rejected once the session has left
// `awaiting-verdict`.
// ---------------------------------------------------------------------------

function seedVerdictSession(sid: string): string {
  const dir = sessionDir(sid);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'status.json'),
    JSON.stringify({
      session_id: sid,
      project: 'demo',
      project_repo_path: dir,
      phase: 'awaiting-verdict',
      round: 2,
      idea: 'guarded idea',
      updated_at: new Date().toISOString(),
    }),
  );
  return dir;
}

function postApprove(sid: string): Promise<Response> {
  return fetch(`${url}/api/plan-verdict`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify({ project: 'demo', sessionId: sid, kind: 'approve' }),
  });
}

test('POST /api/plan-verdict on a session no longer awaiting a verdict → 409 (double-finalize guard)', async () => {
  const sid3 = '2026-05-29T14-00-00';
  const dir3 = seedVerdictSession(sid3);

  const first = await postApprove(sid3);
  assert.equal(first.status, 200);
  const afterFirst = JSON.parse(readFileSync(join(dir3, 'status.json'), 'utf8'));
  assert.equal(afterFirst.phase, 'finalizing');

  // Second approve while the first finalize is in flight → conflict; the
  // status must NOT be re-written (no second spawn / critic run / promotion).
  const second = await postApprove(sid3);
  assert.equal(second.status, 409);
  const body = (await second.json()) as { error?: string };
  assert.match(body.error ?? '', /not awaiting a verdict/);
  const afterSecond = JSON.parse(readFileSync(join(dir3, 'status.json'), 'utf8'));
  assert.equal(afterSecond.phase, 'finalizing', 'the rejected verdict must not touch session status');
});

test('POST /api/plan-verdict concurrent double-approve → exactly one 200 (status lock serializes)', async () => {
  const sid4 = '2026-05-29T15-00-00';
  seedVerdictSession(sid4);

  const [a, b] = await Promise.all([postApprove(sid4), postApprove(sid4)]);
  const codes = [a.status, b.status];
  assert.equal(codes.filter((c) => c === 200).length, 1, `exactly one approve wins (got ${codes})`);
  assert.ok(
    codes.every((c) => c === 200 || c === 409 || c === 503),
    `loser must get a conflict-shaped rejection (got ${codes})`,
  );
});

// ---------------------------------------------------------------------------
// R5-01-F1: FORGE_DRY_BRIDGE alone (without FORGE_ARCHITECT_NO_SPAWN) must
// suppress the already-NO_SPAWN-guarded spawn helper — but never silently:
// the spawn routes are classified stub-actions, so the 200 body carries an
// explicit `dryBridge: { skipped: ['agent-turn'] }` marker. This module sets
// FORGE_ARCHITECT_NO_SPAWN=1 at load time (top of file) for every other test
// here; this one test deliberately unsets it to prove the dry-bridge seam is
// an orthogonal, independently-sufficient guard — not a rename of NO_SPAWN.
// The per-family table lives in ui-bridge-dry-spawn.test.ts.
// ---------------------------------------------------------------------------

test('R5-01-F1: FORGE_DRY_BRIDGE=1 alone suppresses the architect spawn (local state progresses + explicit marker)', async () => {
  const priorNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  const priorDryBridge = process.env.FORGE_DRY_BRIDGE;
  delete process.env.FORGE_ARCHITECT_NO_SPAWN;
  process.env.FORGE_DRY_BRIDGE = '1';
  try {
    const sid5 = '2026-05-29T16-00-00';
    const dir5 = seedVerdictSession(sid5);
    const res = await postApprove(sid5);
    // The route is stub-actions (never a 409) — approve still succeeds and
    // local state still advances; only the spawn underneath is suppressed,
    // and the response says so.
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.deepEqual(body.dryBridge, { skipped: ['agent-turn'] }, 'the skipped agent turn must be explicit in the response');
    const status = JSON.parse(readFileSync(join(dir5, 'status.json'), 'utf8'));
    assert.equal(status.phase, 'finalizing', 'local state must still progress under dry-bridge');
    // Task A-finalfix FIX 3: the marker/event alone aren't red-on-regression —
    // assert the actual spawn side effect (the log dir spawnArchitectTurn
    // mkdirs right before spawning) never happened.
    assert.ok(
      !existsSync(join(forgeRoot, '_logs', `_architect-${sid5}`)),
      'dry-bridge must not create the architect spawn log dir',
    );
  } finally {
    if (priorNoSpawn === undefined) delete process.env.FORGE_ARCHITECT_NO_SPAWN;
    else process.env.FORGE_ARCHITECT_NO_SPAWN = priorNoSpawn;
    if (priorDryBridge === undefined) delete process.env.FORGE_DRY_BRIDGE;
    else process.env.FORGE_DRY_BRIDGE = priorDryBridge;
  }
});
