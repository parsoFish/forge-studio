/**
 * Acceptance tests for `POST /api/studio/onboarding/start` (R4-17 — the
 * onboarding session's kickoff route, `cli/ui-bridge.ts`). The route DOES NOT
 * EXIST YET — this file is RED at branch base (every 200/created-dir
 * assertion below fails against a 404 fallthrough on the un-added route;
 * `startBridge` itself exists today so this is NOT a module-not-found red,
 * see the RED-proof report for exact per-test failure reasons).
 *
 * D5 (BINDING, the headline finding this route's whole shape answers): the
 * campaign's recurring defect family is a route that accepts a
 * caller-supplied repo-path field and never re-validates it before using it
 * as a write/spawn target (SEC-02, SEC-03, the `/start`-family
 * `projectRepoPath` enumeration in `cli/ui-bridge.ts`'s own header). This
 * route's answer is to have NO such field to guard at all: body is
 * `{project, inputs?}` — `project` is a slug resolved strictly against
 * `projectsRoot`, nothing else. AT-3 proves this isn't merely "undocumented"
 * but genuinely inert — a caller-supplied `projectRepoPath` pointing outside
 * the forge tree has ZERO effect on where anything lands.
 *
 * D6: spawns the IDENTICAL `spawnAgentDispatch(forgeRoot, 'onboarding-agent',
 * runId, project, inputs)` the generic `POST /api/agents/:slug/run` route
 * spawns — verified end-to-end via the SHARED `GET /api/agents/runs/<runId>`
 * status-poll surface (the real client path both routes' runIds are
 * interchangeable on), not by reflecting on the private spawn helper.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';
import { cmdAgentDispatch } from './agent-run.ts';

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-onboarding-start-'));
  for (const state of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'projects', 'demoproj'), { recursive: true });

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Validation — BEFORE any fs call (AT-1, AT-2)
// ---------------------------------------------------------------------------

test('R4-17 AT-1: POST /api/studio/onboarding/start — malformed project slug → 400, no _onboarding dir created anywhere', async () => {
  const res = await fetch(`${url}/api/studio/onboarding/start`, {
    method: 'POST', headers: CSRF, body: JSON.stringify({ project: '../../etc' }),
  });
  assert.equal(res.status, 400);
  assert.ok(!existsSync(join(forgeRoot, 'projects', 'demoproj', '_onboarding')), 'a rejected request must create nothing on disk');
});

test('R4-17 AT-2: POST /api/studio/onboarding/start — unknown project (valid slug, no such directory under projectsRoot) → 404', async () => {
  const res = await fetch(`${url}/api/studio/onboarding/start`, {
    method: 'POST', headers: CSRF, body: JSON.stringify({ project: 'no-such-project-at-all' }),
  });
  assert.equal(res.status, 404);
});

// ---------------------------------------------------------------------------
// D5 — no caller-supplied repo path field is accepted, period (AT-3)
// ---------------------------------------------------------------------------

test('R4-17 AT-3 (D5, load-bearing): a caller-supplied "projectRepoPath" pointing OUTSIDE the forge tree has ZERO effect — the session lands strictly under <projectsRoot>/<project>/_onboarding/, never at the injected path, and nothing is created at the injected path', async () => {
  const outsideDir = mkdtempSync(join(tmpdir(), 'onboarding-start-escape-target-'));
  try {
    const res = await fetch(`${url}/api/studio/onboarding/start`, {
      method: 'POST',
      headers: CSRF,
      body: JSON.stringify({ project: 'demoproj', projectRepoPath: outsideDir, inputs: { northStar: 'ship it' } }),
    });
    const text = await res.text();
    assert.equal(res.status, 200, text);
    const body = JSON.parse(text) as { ok: boolean; sessionId: string; runId: string; project: string };
    assert.equal(body.ok, true);
    assert.equal(body.project, 'demoproj');

    // The session dir must be exactly <projectsRoot>/demoproj/_onboarding/<sid>/.
    const sessionDir = join(forgeRoot, 'projects', 'demoproj', '_onboarding', body.sessionId);
    assert.ok(existsSync(join(sessionDir, 'status.json')), `expected the session to land at ${sessionDir} regardless of the injected projectRepoPath`);

    // Nothing whatsoever was written into the caller-supplied outside dir.
    assert.ok(!existsSync(join(outsideDir, '_onboarding')), 'the injected projectRepoPath must never be used as a write target');
  } finally {
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Happy path — real session artifacts on disk (AT-4, AT-5)
// ---------------------------------------------------------------------------

test('R4-17 AT-4: POST /api/studio/onboarding/start — valid project + inputs → 200 {ok:true, sessionId, runId, project}, and status.json/prompt.md are REAL files with the declared shape', async () => {
  const res = await fetch(`${url}/api/studio/onboarding/start`, {
    method: 'POST',
    headers: CSRF,
    body: JSON.stringify({ project: 'demoproj', inputs: { northStar: 'ship the sentinel feature 91a2', repo: 'projects/demoproj' } }),
  });
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as { ok: boolean; sessionId: string; runId: string; project: string };
  assert.equal(body.ok, true);
  assert.equal(body.project, 'demoproj');
  assert.ok(body.sessionId.length > 0);
  assert.ok(body.runId.length > 0);

  const sessionDir = join(forgeRoot, 'projects', 'demoproj', '_onboarding', body.sessionId);
  const status = JSON.parse(readFileSync(join(sessionDir, 'status.json'), 'utf8')) as {
    phase: string; project: string; runId: string; startedAt: string;
  };
  assert.equal(status.phase, 'running', 'the start route writes phase:"running" — the terminal phase is the DISPATCH process\'s job (D7), not this route\'s');
  assert.equal(status.project, 'demoproj');
  assert.equal(status.runId, body.runId);
  assert.ok(typeof status.startedAt === 'string' && status.startedAt.length > 0);

  const prompt = readFileSync(join(sessionDir, 'prompt.md'), 'utf8');
  assert.ok(prompt.includes('ship the sentinel feature 91a2'), `prompt.md must render the real operator inputs verbatim (D8 — never fabricated), got: ${JSON.stringify(prompt)}`);
});

test('R4-17 AT-5: POST /api/studio/onboarding/start — no "inputs" field at all → still 200, prompt.md is still written (empty/omitted inputs is legal, never a 400)', async () => {
  const res = await fetch(`${url}/api/studio/onboarding/start`, {
    method: 'POST', headers: CSRF, body: JSON.stringify({ project: 'demoproj' }),
  });
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as { sessionId: string };
  const sessionDir = join(forgeRoot, 'projects', 'demoproj', '_onboarding', body.sessionId);
  assert.ok(existsSync(join(sessionDir, 'prompt.md')));
});

// ---------------------------------------------------------------------------
// D6 — identical dispatch, verified end-to-end via the SHARED run-status
// surface (real client path, not reflection on a private helper) (AT-6)
// ---------------------------------------------------------------------------

test('R4-17 AT-6 (D6): the returned runId is a REAL run identity usable on the SAME shared GET /api/agents/runs/<runId> status-poll surface the generic dispatch route uses — proves this route rides the identical dispatch plumbing, not a parallel one', async () => {
  const res = await fetch(`${url}/api/studio/onboarding/start`, {
    method: 'POST', headers: CSRF, body: JSON.stringify({ project: 'demoproj' }),
  });
  const { runId } = (await res.json()) as { runId: string };

  const statusRes = await fetch(`${url}/api/agents/runs/${encodeURIComponent(runId)}`);
  assert.equal(statusRes.status, 200, 'the runId this route hands back must be a valid identity on the SAME shared run-status route the generic /api/agents/:slug/run dispatch uses — a parallel, incompatible runId scheme would 400 here');
  const statusBody = (await statusRes.json()) as { ok: boolean; state: string };
  assert.equal(statusBody.ok, true);
});

// ---------------------------------------------------------------------------
// PIN 2 — round-1 BLOCKER: `realProjectDir = realpathSync(join(ctx.
// projectsRoot, project))` (cli/ui-bridge.ts:~2750) resolves symlinks but
// NEVER checks the result lands inside `projectsRoot` — unlike the sibling
// `resolveContainedProjectDir` (cli/contract-stages.ts:94), which the GET
// /api/studio/projects/:id/contract-stages route DOES call and which
// correctly rejects this exact shape. AT-7/AT-8/AT-9 pin the fix: a real
// symlink escape is refused (AT-7, RED now — the route currently 200s and
// writes outside projectsRoot), a symlink that resolves back INSIDE
// projectsRoot is still accepted (AT-8, the false-rejection control — a
// guard that rejects every symlink is over-strict, not containment), and the
// downstream write sink (`writeSessionTerminalPhase`, cli/agent-run.ts) is
// guarded independently of this route (AT-9, RED now — that function has no
// projectsRoot-containment check at all today; see the T3 report for why).
// ---------------------------------------------------------------------------

test('R4-17 AT-7 (BLOCKER, REJECT — real filesystem object, never a lexical string test): a project slug that is a symlink resolving OUTSIDE projectsRoot must be refused — non-2xx, AND nothing is written at the symlink target. Status code alone cannot prove this: a broken-but-unguarded implementation could 200 (current behaviour) or could 500 AFTER already writing — only checking the filesystem distinguishes "rejected" from "wrote it anyway and then errored"', async () => {
  const outsideDir = mkdtempSync(join(tmpdir(), 'onboarding-start-escape-target-'));
  const evilLink = join(forgeRoot, 'projects', 'evilproj');
  try {
    symlinkSync(outsideDir, evilLink, 'dir');
    const res = await fetch(`${url}/api/studio/onboarding/start`, {
      method: 'POST',
      headers: CSRF,
      body: JSON.stringify({ project: 'evilproj', inputs: { northStar: 'escape the projects root' } }),
    });
    assert.ok(
      res.status < 200 || res.status >= 300,
      `a project slug resolving via a symlink OUTSIDE projectsRoot must be refused (non-2xx), got ${res.status} — kills the implementation this campaign keeps finding: a caller-controlled path field (here, a symlinked slug) reaching a write/spawn sink with only a lexical/charset check and no containment`,
    );
    assert.ok(
      !existsSync(join(outsideDir, '_onboarding')),
      `the write must land NOWHERE inside the escaped target ${outsideDir} — this is the load-bearing assertion: a status code cannot distinguish "rejected before any fs call" from "wrote it anyway"`,
    );
  } finally {
    rmSync(evilLink, { force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('R4-17 AT-8 (BLOCKER, ACCEPT / false-rejection control — mirrors cli/contract-stages.test.ts AT-28): a project slug that is a RELATIVE symlink resolving back INSIDE projectsRoot must still succeed and write into the real target. A guard that rejects every symlink outright, escaping or not, is over-strict — not a real containment check — and would false-reject every real operator whose project dir happens to be a symlink (a common shape: a bind mount, a monorepo package link, …)', async () => {
  const projectsRoot = join(forgeRoot, 'projects');
  const realTargetName = 'real-onboarding-target';
  mkdirSync(join(projectsRoot, realTargetName), { recursive: true });
  const aliasLink = join(projectsRoot, 'alias-back-inside');
  symlinkSync(realTargetName, aliasLink, 'dir');
  try {
    const res = await fetch(`${url}/api/studio/onboarding/start`, {
      method: 'POST', headers: CSRF, body: JSON.stringify({ project: 'alias-back-inside' }),
    });
    const text = await res.text();
    assert.equal(res.status, 200, `a symlink resolving back inside projectsRoot must be ACCEPTED, got ${res.status}: ${text}`);
    const body = JSON.parse(text) as { sessionId: string };
    const realSessionDir = join(projectsRoot, realTargetName, '_onboarding', body.sessionId);
    assert.ok(
      existsSync(join(realSessionDir, 'status.json')),
      `expected the session to land at the REAL target ${realSessionDir} (reached via the accepted symlink), proving the guard resolves+re-checks containment rather than rejecting every symlink`,
    );
  } finally {
    rmSync(aliasLink, { force: true });
    rmSync(join(projectsRoot, realTargetName), { recursive: true, force: true });
  }
});

test('R4-17 AT-9 (BLOCKER, consequence path — "one sink, many entry points"): `forge agent dispatch --session-dir` (writeSessionTerminalPhase, cli/agent-run.ts) writes into WHATEVER directory it is handed, with no containment check of its own — a --session-dir OUTSIDE projectsRoot must be refused at THIS sink too, so the terminal-phase write does not depend solely on the route above it (POST /api/studio/onboarding/start) having validated the dir. RED now: writeSessionTerminalPhase has no projectsRoot parameter at all today and unconditionally overwrites status.json wherever it is pointed', async () => {
  const outsideSessionDir = mkdtempSync(join(tmpdir(), 'onboarding-sessiondir-outside-'));
  const statusPath = join(outsideSessionDir, 'status.json');
  writeFileSync(statusPath, JSON.stringify({ phase: 'running' }), 'utf8');
  const before = readFileSync(statusPath, 'utf8');
  const runId = '_agent-onboarding-outside-sessiondir-test';

  const origExit = process.exit;
  const origErr = console.error;
  const origLog = console.log;
  process.exit = ((code?: number) => { throw new Error(`__exit__${code ?? 0}`); }) as typeof process.exit;
  console.error = () => { /* silence expected failure output */ };
  console.log = () => { /* silence expected output */ };
  try {
    try {
      await cmdAgentDispatch(['totally-unknown-slug-does-not-exist', '--run-id', runId, '--session-dir', outsideSessionDir], forgeRoot);
    } catch (e) {
      if (!/^__exit__/.test((e as Error).message)) throw e;
    }
    const after = readFileSync(statusPath, 'utf8');
    assert.equal(
      after, before,
      `a --session-dir OUTSIDE projectsRoot must be refused by the write sink itself — got status.json overwritten to: ${after}. The BLOCKER fix on the /start route alone is not sufficient defense-in-depth: any OTHER caller of writeSessionTerminalPhase with an unvalidated --session-dir (present or future) must be refused at the sink, not merely at this one route`,
    );
  } finally {
    process.exit = origExit;
    console.error = origErr;
    console.log = origLog;
    rmSync(outsideSessionDir, { recursive: true, force: true });
    // The failure path logs a terminal marker via createLogger(runId,
    // '_logs') — hardcoded CWD-relative in cli/agent-run.ts, not threaded
    // through the (temp) forgeRoot used elsewhere in this file — so it lands
    // under the REAL repo's _logs/, exactly as cli/agent-run-dispatch.
    // test.ts's own AT-D7-2 fixture already has to clean up.
    rmSync(join(process.cwd(), '_logs', runId), { recursive: true, force: true });
  }
});
