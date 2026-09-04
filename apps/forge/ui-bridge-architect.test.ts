/**
 * Tests for the architect bridge routes (ADR 020).
 *
 * Starts a real bridge against a temp `forgeRoot` with a file-seeded session
 * dir (no SDK, no spawn — `FORGE_ARCHITECT_NO_SPAWN=1`), and exercises the
 * `/api/architect/*` + `/api/plan-verdict` surface over HTTP.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
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
  //
  // Both FORGE_ARCHITECT_NO_SPAWN (set at module scope, line 19) and
  // FORGE_DRY_BRIDGE are deliberately unset for the body of this test (saved
  // + restored below) — spawnAgentTurn's FIRST line short-circuits on either
  // one BEFORE the isSafeRunId traversal check on the next line is ever
  // reached, which would make this test's assertion pass vacuously
  // regardless of whether the guard works. See
  // ui-bridge-unsafe-sessionid.test.ts for the same reasoning in full.
  const priorNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  const priorDryBridge = process.env.FORGE_DRY_BRIDGE;
  delete process.env.FORGE_ARCHITECT_NO_SPAWN;
  delete process.env.FORGE_DRY_BRIDGE;
  try {
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
    // SEC-04 (bd forge-ebj): the `<real>/../<real>` sessionId is an
    // escape-and-return shape (adversarial-containment-review catalogue) — a
    // `/`-bearing, multi-segment id that round-trips in-root. It is now
    // REFUSED at the route boundary by the per-segment identity guard (4xx),
    // BEFORE spawnAgentTurn is ever reached, rather than accepted at 200 and
    // relying solely on isSafeRunId to block the spawn. The security outcome
    // this test asserts — no spawn log dir for an unsafe id — is preserved and
    // is now guaranteed by the earlier, stronger boundary rejection.
    assert.ok(res.status >= 400 && res.status < 500, `expected a 4xx boundary rejection, got ${res.status}: ${JSON.stringify(json)}`);
    const logsEntries = existsSync(join(forgeRoot, '_logs')) ? readdirSync(join(forgeRoot, '_logs')) : [];
    assert.ok(
      !logsEntries.some((e) => e.startsWith(`_architect-${realSid}`)),
      `expected no _architect-${realSid}* dir under _logs/ for an unsafe sessionId, found: ${JSON.stringify(logsEntries)}`,
    );
  } finally {
    if (priorNoSpawn === undefined) delete process.env.FORGE_ARCHITECT_NO_SPAWN;
    else process.env.FORGE_ARCHITECT_NO_SPAWN = priorNoSpawn;
    if (priorDryBridge === undefined) delete process.env.FORGE_DRY_BRIDGE;
    else process.env.FORGE_DRY_BRIDGE = priorDryBridge;
  }
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
  // GET sessions triggers ensureSessionTail; the 200ms tail then replays the log.
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
// ADR-043 §3 amendment (wave-6 kickoff model-tier seam) — architectAgentSpec
// is strategy:fixed (sonnet), so the only legal modelTier is "sonnet".
// ---------------------------------------------------------------------------

test('POST /api/architect/start with modelTier:"sonnet" (equal to the fixed tier) is persisted into status.json', async () => {
  const res = await fetch(`${url}/api/architect/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify({ project: 'demo', idea: 'A brand new idea.', modelTier: 'sonnet' }),
  });
  assert.equal(res.status, 200);
  const { sessionId } = (await res.json()) as { sessionId: string };
  const status = JSON.parse(readFileSync(join(sessionDir(sessionId), 'status.json'), 'utf8'));
  assert.equal(status.modelTier, 'sonnet');
});

test('POST /api/architect/start with an out-of-envelope modelTier ("opus") 400s naming the value and the allowed set — no session dir created', async () => {
  const before = listArchitectSessionIds();
  const res = await fetch(`${url}/api/architect/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify({ project: 'demo', idea: 'A brand new idea.', modelTier: 'opus' }),
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /requested model tier "opus".*allowed tier\(s\): sonnet/);
  assert.deepEqual(listArchitectSessionIds(), before, 'a rejected modelTier must not create a new session dir');
});

// ===========================================================================
// R4-16 PIN 4 — round-3 finding (BLOCKER), applies to /api/architect/start
// too: `project_repo_path: body.projectRepoPath ?? join(ctx.projectsRoot,
// body.project)` accepts the caller-supplied field with ZERO validation and
// persists it verbatim — the field every downstream architect/runner call
// (git ops, file writes under the "repo") trusts. Fix shape (binding): reuse
// `isContainedProjectRepoPath` (packages/flows/manifest-path-guard.ts, SEC-02) at this
// route too, per the brief's measurement that no legitimate caller
// (scripts/verify-cycle.mjs's driveArchitect sends
// join(FORGE_ROOT,'projects',PROJECT), which the guard accepts) is broken by
// doing so.
// ===========================================================================

async function postArchitectStart(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${url}/api/architect/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

/** Snapshot of session ids currently under `<forgeRoot>/projects/demo/_architect/`
 *  — used to prove a REJECTED /start creates NO new session dir (id-agnostic,
 *  since a 400 response carries no sessionId to look up directly). */
function listArchitectSessionIds(): string[] {
  const dir = join(forgeRoot, 'projects', 'demo', '_architect');
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

test('R4-16 PIN 4, AT-A1 (BLOCKER): POST /api/architect/start with projectRepoPath OUTSIDE forgeRoot/projects/ is rejected — 400 naming the offending path, and NO new session dir is created', async () => {
  const outsideDir = mkdtempSync(join(tmpdir(), 'architect-start-outside-repo-'));
  try {
    const before_ = listArchitectSessionIds();
    const { status, json } = await postArchitectStart({ project: 'demo', idea: 'Malicious idea.', projectRepoPath: outsideDir });
    assert.equal(status, 400, `projectRepoPath outside forgeRoot/projects/ must be rejected with 400, got ${status}: ${JSON.stringify(json)}`);
    assert.ok(String(json.error ?? '').includes(outsideDir), `error must name the offending path, got: ${JSON.stringify(json)}`);
    assert.deepEqual(listArchitectSessionIds(), before_, 'a rejected /start must create NO new session dir under _architect/');
  } finally {
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('R4-16 PIN 4, AT-A2 (BLOCKER): POST /api/architect/start with a projectRepoPath lexically under forgeRoot/projects/ but a SYMLINK resolving outside is rejected', async () => {
  const outsideDir = mkdtempSync(join(tmpdir(), 'architect-start-symlink-outside-'));
  const evilProjectDir = join(forgeRoot, 'projects', 'evil-project-r416pin4');
  try {
    symlinkSync(outsideDir, evilProjectDir);
    const before_ = listArchitectSessionIds();
    const { status } = await postArchitectStart({ project: 'demo', idea: 'Malicious idea.', projectRepoPath: evilProjectDir });
    assert.equal(status, 400, `a symlinked projectRepoPath must be rejected with 400, got ${status}`);
    assert.deepEqual(listArchitectSessionIds(), before_, 'a rejected /start must create NO new session dir under _architect/');
  } finally {
    rmSync(evilProjectDir, { force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('R4-16 PIN 4, AT-A3: POST /api/architect/start with a RELATIVE projectRepoPath is rejected — the guard requires absolute, never silently resolved against the server\'s cwd', async () => {
  const before_ = listArchitectSessionIds();
  const { status } = await postArchitectStart({ project: 'demo', idea: 'x', projectRepoPath: 'nonexistent-relative-dir-xyz-9931/demo' });
  assert.equal(status, 400, `a relative projectRepoPath must be rejected with 400, got ${status}`);
  assert.deepEqual(listArchitectSessionIds(), before_, 'a rejected /start must create NO new session dir under _architect/');
});

test('R4-16 PIN 4, AT-A4 (positive controls, green today): projectRepoPath ABSENT still defaults to join(projectsRoot, project); a genuinely-contained projectRepoPath is still accepted and persisted verbatim — this is the EXACT shape scripts/verify-cycle.mjs sends', async () => {
  const started1 = await postArchitectStart({ project: 'demo', idea: 'Absent projectRepoPath.' });
  assert.equal(started1.status, 200, `absent projectRepoPath must still succeed, got ${started1.status}: ${JSON.stringify(started1.json)}`);
  const sid1 = started1.json.sessionId as string;
  const status1 = JSON.parse(readFileSync(join(sessionDir(sid1), 'status.json'), 'utf8'));
  assert.equal(status1.project_repo_path, join(forgeRoot, 'projects', 'demo'), 'absent projectRepoPath must default to join(projectsRoot, project)');

  const containedPath = join(forgeRoot, 'projects', 'demo'); // the real shape scripts/verify-cycle.mjs's driveArchitect sends
  const started2 = await postArchitectStart({ project: 'demo', idea: 'Contained projectRepoPath.', projectRepoPath: containedPath });
  assert.equal(started2.status, 200, `a genuinely-contained projectRepoPath must still succeed, got ${started2.status}: ${JSON.stringify(started2.json)}`);
  const sid2 = started2.json.sessionId as string;
  const status2 = JSON.parse(readFileSync(join(sessionDir(sid2), 'status.json'), 'utf8'));
  assert.equal(status2.project_repo_path, containedPath, 'a genuinely-contained projectRepoPath must be persisted verbatim');
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

// ===========================================================================
// R4-16 PIN 5, Finding B (MEDIUM): `invalidProjectRepoPath` treats
// `undefined` AND `''` alike (return null / "not invalid" — matching
// manifest-path-guard.ts's own convention), but every call site defaults
// with `body.projectRepoPath ?? join(...)`, and `??` does NOT substitute for
// `''` — so the literal empty string sails past the guard and is what
// actually lands in status.json. Pins the PERSISTED VALUE (not just the
// 200), which is the only way to distinguish "correctly defaulted" from "the
// empty string got through". Ruling on the fix shape (binding): "" is
// treated as absent END TO END — never a 400.
// ===========================================================================

test('R4-16 PIN 5, AT-A5 (Finding B): POST /api/architect/start with projectRepoPath:"" is accepted, but the PERSISTED value is the default, never the literal ""', async () => {
  const started = await postArchitectStart({ project: 'demo', idea: 'Empty-string projectRepoPath.', projectRepoPath: '' });
  assert.equal(started.status, 200, `projectRepoPath:"" must still succeed (treated as absent), got ${started.status}: ${JSON.stringify(started.json)}`);
  const sid = started.json.sessionId as string;
  const status = JSON.parse(readFileSync(join(sessionDir(sid), 'status.json'), 'utf8'));
  assert.notEqual(status.project_repo_path, '', 'the literal empty string must never be what lands in project_repo_path');
  assert.equal(status.project_repo_path, join(forgeRoot, 'projects', 'demo'), 'projectRepoPath:"" must default to join(projectsRoot, project), exactly like an absent field');
});

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

// ===========================================================================
// W6-SW-3 reviewer HIGH finding: POST /api/runs/:id/gates/plan had NO test
// coverage at all (the route is documented at this file's own top-of-header
// comment, but never actually exercised here — /api/plan-verdict, the sibling
// alias route, has coverage above; this route did not). GateBar's fix maps
// verdict:'send-back' to an explicit kind:'revise' client-side (see
// apps/studio/lib/gate-verdict-body.ts) — these three tests pin the route's
// actual behaviour for both the direct-match ('revise') and GateBar's own
// wire shape ('send-back' + kind:'revise'), plus the negative case that
// proves the client-side kind mapping is load-bearing, not decorative.
// ===========================================================================

function postGatesPlan(sid: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${url}/api/runs/${encodeURIComponent(sid)}/gates/plan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify(body),
  });
}

test('POST /api/runs/:id/gates/plan verdict:"revise" + project + rationale → 200, phase→interviewing, round+1, feedback.md written', async () => {
  const sid6 = '2026-05-29T17-00-00';
  const dir6 = seedVerdictSession(sid6); // seeded at round:2, phase:'awaiting-verdict'

  const res = await postGatesPlan(sid6, { verdict: 'revise', project: 'demo', rationale: 'needs another pass' });
  assert.equal(res.status, 200, `revise must succeed (got ${res.status}: ${JSON.stringify(await res.json().catch(() => null))})`);

  const status = JSON.parse(readFileSync(join(dir6, 'status.json'), 'utf8'));
  assert.equal(status.phase, 'interviewing');
  assert.equal(status.round, 3);
  assert.equal(readFileSync(join(dir6, 'feedback.md'), 'utf8').trim(), 'needs another pass');
});

test('POST /api/runs/:id/gates/plan verdict:"send-back" + kind:"revise" (GateBar\'s own wire shape) + project + rationale → 200, same state change', async () => {
  const sid7 = '2026-05-29T18-00-00';
  const dir7 = seedVerdictSession(sid7);

  // This is EXACTLY the body apps/studio/lib/gate-verdict-body.ts's
  // buildGateVerdictBody produces for a plan-gate send-back — GateBar's
  // `notes` textarea state re-keyed to `rationale` on the wire.
  const res = await postGatesPlan(sid7, {
    verdict: 'send-back',
    kind: 'revise',
    project: 'demo',
    rationale: 'needs another pass',
  });
  assert.equal(
    res.status,
    200,
    `send-back must NOT 400 — GateBar's Send-back control must reach the route successfully (got ${res.status}: ${JSON.stringify(await res.json().catch(() => null))})`,
  );

  const status = JSON.parse(readFileSync(join(dir7, 'status.json'), 'utf8'));
  assert.equal(status.phase, 'interviewing');
  assert.equal(status.round, 3);
  assert.equal(readFileSync(join(dir7, 'feedback.md'), 'utf8').trim(), 'needs another pass');
});

test('POST /api/runs/:id/gates/plan verdict:"send-back" WITHOUT kind → 400 "unknown kind" (pins the bug the client-side kind mapping repairs; session state untouched)', async () => {
  const sid8 = '2026-05-29T19-00-00';
  const dir8 = seedVerdictSession(sid8);

  // The pre-fix GateBar body: verdict:'send-back' alone. The route maps
  // `kind` from `verdict` only for 'approve'|'revise'|'reject' — 'send-back'
  // matches none of those and falls through to body.kind (absent here), so
  // applyPlanVerdict receives kind:'' and rejects it before writing anything.
  const res = await postGatesPlan(sid8, { verdict: 'send-back', project: 'demo', rationale: 'needs another pass' });
  assert.equal(res.status, 400, 'a bare send-back (no kind) must still 400 — this is why the client-side mapping is required, not optional');

  const status = JSON.parse(readFileSync(join(dir8, 'status.json'), 'utf8'));
  assert.equal(status.phase, 'awaiting-verdict', 'a 400 must leave the session state untouched — no partial write');
  assert.ok(!existsSync(join(dir8, 'feedback.md')), 'a 400 must never write feedback.md');
});
