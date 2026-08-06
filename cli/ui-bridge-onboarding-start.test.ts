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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

// ---------------------------------------------------------------------------
// PIN 4 — round-2 adversarial review, item 1 (BLOCKER): `ctx.projectsRoot`
// here is computed as `resolve(forgeRoot, 'projects')` (cli/ui-bridge.ts:222)
// — a hardcoded literal that NEVER consults `FORGE_PROJECTS_DIR` or
// `forge.config.json`'s `projectsDir`, unlike `writeSessionTerminalPhase`
// (cli/agent-run.ts:201, the sink AT-9 above guards), which resolves the
// SAME concept via `resolveProjectsDir(resolve(forgeRoot), loadConfig())` —
// the config-aware helper 23 OTHER call sites in this repo already use
// (cli/ui-bridge.ts:222 is the one outlier). When an operator configures a
// custom projects root, the producer here keeps building sessions under the
// OLD hardcoded literal while the guard checks containment against the
// CONFIGURED root — the two disagree, and a legitimately-produced session's
// terminal-phase write is silently refused (a finished run reads
// phase:"running" forever).
//
// AT-10 pins the PRODUCER half directly: this route must find/create the
// session under WHATEVER root is configured, not the hardcoded literal — RED
// now (the route can't even find a project that only exists under the
// configured root, so it 404s instead of placing the session there). The
// CONSUMER half (writeSessionTerminalPhase already being config-aware, and
// staying refuse-outside-the-configured-root even once this producer bug is
// fixed) is pinned separately, in `cli/agent-run-dispatch.test.ts`'s new
// AT-D7-6..9 — that function was never the broken half; this route is.
// ---------------------------------------------------------------------------

test('R4-17 AT-10 (BLOCKER, pin 4 item 1): POST /api/studio/onboarding/start honours a CONFIGURED projects root (FORGE_PROJECTS_DIR) — the session must land under the CONFIGURED root, not the hardcoded <forgeRoot>/projects literal', async () => {
  const priorProjectsDir = process.env.FORGE_PROJECTS_DIR;
  const scopedForgeRoot = mkdtempSync(join(tmpdir(), 'bridge-onboarding-start-configuredroot-forgeroot-'));
  const customProjectsRoot = mkdtempSync(join(tmpdir(), 'bridge-onboarding-start-configuredroot-projects-'));
  for (const state of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(scopedForgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(scopedForgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(customProjectsRoot, 'configuredproj'), { recursive: true });
  process.env.FORGE_PROJECTS_DIR = customProjectsRoot;
  let scopedUrl = '';
  let scopedClose: (() => Promise<void>) | undefined;
  try {
    ({ url: scopedUrl, close: scopedClose } = await startBridge({ forgeRoot: scopedForgeRoot, port: 0 }));
    const res = await fetch(`${scopedUrl}/api/studio/onboarding/start`, {
      method: 'POST', headers: CSRF, body: JSON.stringify({ project: 'configuredproj' }),
    });
    const text = await res.text();
    assert.equal(
      res.status, 200,
      `expected the route to find "configuredproj" under the CONFIGURED root ${customProjectsRoot} and succeed, got ${res.status}: ${text} — this route only ever looks under the hardcoded <forgeRoot>/projects literal today, regardless of FORGE_PROJECTS_DIR`,
    );
    const body = JSON.parse(text) as { sessionId: string };
    const correctSessionDir = join(customProjectsRoot, 'configuredproj', '_onboarding', body.sessionId);
    const wrongSessionDir = join(scopedForgeRoot, 'projects', 'configuredproj', '_onboarding', body.sessionId);
    assert.ok(
      existsSync(join(correctSessionDir, 'status.json')),
      `the session must land at ${correctSessionDir} (under the CONFIGURED projects root) — a route that ignores FORGE_PROJECTS_DIR would instead try (and fail, or write to the wrong place) at ${wrongSessionDir}`,
    );
  } finally {
    if (scopedClose) await scopedClose();
    if (priorProjectsDir === undefined) delete process.env.FORGE_PROJECTS_DIR;
    else process.env.FORGE_PROJECTS_DIR = priorProjectsDir;
    rmSync(scopedForgeRoot, { recursive: true, force: true });
    rmSync(customProjectsRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// PIN 4 — round-2 adversarial review, item 2 (BLOCKER): the route correctly
// contains the PROJECT dir (`resolveContainedProjectDir`, AT-7/AT-8 above)
// but then does `join(realProjectDir, '_onboarding', sessionId)` followed by
// `mkdirSync(sessionDir, {recursive:true})` WITHOUT verifying `_onboarding`
// itself isn't a symlink escaping `projectsRoot`. `mkdirSync(recursive:
// true)` follows a symlinked INTERMEDIATE path segment (standard POSIX
// `mkdir -p` semantics — the OS resolves each existing prefix, including
// symlinks, before creating the next one), so a project whose `_onboarding`
// entry is a symlink to an outside directory redirects BOTH `status.json`
// and `prompt.md` writes there. Reachable: a managed project is a checked-
// out repo, so a commit containing a symlink named `_onboarding` is
// attacker-supplied content — the same class of bug already proven (and
// fixed) for other session-dir producers in this campaign (R2-09's
// containment ATs for flows/projects). "Validating a root does not validate
// what you write beneath it", one level deeper, in the very round that fixed
// it one level up (AT-7/AT-8's `realProjectDir` containment).
//
// AT-11 is the reject pin (RED now — a status-code-only check cannot tell
// "refused before any fs call" from "wrote it and then errored", so the
// load-bearing assertion is that NOTHING landed at the symlink target).
// AT-12 is the accept control for a REAL, pre-existing (non-symlink)
// `_onboarding` directory — the shape every SECOND onboarding run on the
// same project has; a guard that refuses every symlink AND every pre-
// existing real directory would break re-running onboarding on any project
// more than once. The THIRD control ("no `_onboarding` at all") is not
// duplicated here — AT-4 above already exercises it: `demoproj`'s fixture
// project (created in this file's `before()`) has no `_onboarding` directory
// until the route creates one.
//
// Reachability check for a NARROWER, separate vector — a symlink planted at
// the exact `_onboarding/<sessionId>` path itself, or at `status.json`/
// `prompt.md` inside it: `sessionId` comes from `newArchitectSessionId()`
// (cli/ui-bridge.ts:1681-1684), which is `new Date().toISOString()`
// truncated to ONE-SECOND granularity, not a cryptographically random value
// — so it is not immune to prediction in principle. But there is no seam to
// inject a fixed `Date` into the route under test, so pinning that narrower
// vector deterministically would mean racing wall-clock time (predict the
// current second, plant a symlink under that exact name, fire the request
// within the same second) — inherently flaky in CI, and not attempted here.
// This is a real, distinct, narrower follow-up, not silently dropped: the
// `_onboarding`-symlink vector below is the reliably-reproducible one the
// review actually named, and the one this file pins.
// ---------------------------------------------------------------------------

test('R4-17 AT-11 (BLOCKER, pin 4 item 2, REJECT — real filesystem objects, not a lexical string test): a project whose "_onboarding" entry is a SYMLINK to an outside directory must be refused — non-2xx, AND nothing written at the symlink target', async () => {
  const project = 'symlinkonboardproj';
  const projectDir = join(forgeRoot, 'projects', project);
  mkdirSync(projectDir, { recursive: true });
  const outsideDir = mkdtempSync(join(tmpdir(), 'onboarding-start-onboarding-escape-target-'));
  const onboardingLink = join(projectDir, '_onboarding');
  try {
    symlinkSync(outsideDir, onboardingLink, 'dir');
    const res = await fetch(`${url}/api/studio/onboarding/start`, {
      method: 'POST',
      headers: CSRF,
      body: JSON.stringify({ project, inputs: { northStar: 'escape via a symlinked _onboarding' } }),
    });
    assert.ok(
      res.status < 200 || res.status >= 300,
      `a project whose "_onboarding" entry is a symlink escaping projectsRoot must be refused (non-2xx), got ${res.status} — kills a guard that verifies the PROJECT dir's containment but never re-checks the "_onboarding" segment joined onto it before mkdirSync/writeFileSync follow it`,
    );
    assert.equal(
      readdirSync(outsideDir).length, 0,
      `nothing must be written at the symlink target ${outsideDir} — this is the load-bearing assertion: a status code alone cannot distinguish "refused before any fs call" from "wrote it anyway and then errored"`,
    );
  } finally {
    rmSync(onboardingLink, { force: true });
    rmSync(outsideDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('R4-17 AT-12 (pin 4 item 2, ACCEPT control — mirrors AT-8\'s false-rejection-control shape): a project with a REAL, pre-existing (non-symlink) "_onboarding" directory — the shape every SECOND onboarding run on the same project has — must still succeed and write into it. A guard that refuses every pre-existing "_onboarding" dir, symlinked or not, would break re-running onboarding on any project more than once', async () => {
  const project = 'realonboardingdirproj';
  const projectDir = join(forgeRoot, 'projects', project);
  mkdirSync(join(projectDir, '_onboarding'), { recursive: true });
  try {
    const res = await fetch(`${url}/api/studio/onboarding/start`, {
      method: 'POST', headers: CSRF, body: JSON.stringify({ project }),
    });
    const text = await res.text();
    assert.equal(
      res.status, 200,
      `a REAL pre-existing "_onboarding" directory must be accepted, got ${res.status}: ${text}`,
    );
    const body = JSON.parse(text) as { sessionId: string };
    assert.ok(
      existsSync(join(projectDir, '_onboarding', body.sessionId, 'status.json')),
      `expected the session to land inside the REAL pre-existing "_onboarding" directory at ${join(projectDir, '_onboarding', body.sessionId)}`,
    );
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});
