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
 *
 * ROUTE vs SEAM split (pin 6): most ATs here (AT-1..12, AT-16, AT-17) drive
 * the real HTTP ROUTE end-to-end (`fetch` against `startBridge`'s server) —
 * that's the only way to pin route-level concerns (status codes, body
 * shape, the `projectRepoPath`-is-inert claim, the configured-root
 * producer bug). AT-13/14/15/18 instead call `writeOnboardingSession`
 * (exported from `cli/ui-bridge.ts`) DIRECTLY, with an explicit, known
 * `sessionId`, bypassing the route entirely. That split exists because
 * `newArchitectSessionId()` (the id the route generates) gained real
 * entropy in the same fix round that added the three closes AT-13/14/15
 * pin — once the id is genuinely unguessable, no external caller (this
 * test included) can reliably pre-plant a colliding directory ahead of the
 * route creating it, so driving those three THROUGH the route would make
 * their REJECT assertions pass vacuously (the route simply never touches
 * the planted fixture, not because it was refused — see each test's own
 * comment for detail). Calling the seam directly with a chosen id restores
 * the ability to engineer the exact collision each test needs, independent
 * of guessability. AT-16 (second-run, real id) and AT-17 (entropy itself)
 * correctly keep driving the ROUTE — they are ABOUT the route's real id
 * generation, so replacing the route with a direct seam call there would
 * make them test nothing.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge, writeOnboardingSession } from './ui-bridge.ts';
import { cmdAgentDispatch } from './agent-run.ts';
import { SAFE_ID_RE } from './bridge-studio.ts';

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
//
// AMENDED (R6-04 D22, cross-initiative re-pin — test-writer of record for
// both R4-17 and R6-04 in this session): AT-6 previously asserted an exact
// `assert.equal(statusRes.status, 200)`. That assertion was stronger than
// AT-6's own stated rationale ever required, and it was passing for the
// WRONG reason. This file's `before()` runs the whole suite under
// FORGE_ARCHITECT_NO_SPAWN=1 — and `spawnAgentDispatch` (cli/ui-bridge.ts)
// returns BEFORE its `mkdirSync(logDir, ...)` call whenever NO_SPAWN (or
// dry-bridge) is set:
//
//   if (process.env.FORGE_ARCHITECT_NO_SPAWN === '1' || isDryBridge()) return;
//   ...
//   const logDir = join(forgeRoot, '_logs', runId);
//   mkdirSync(logDir, { recursive: true });   // <- never reached here
//
// So under THIS file's own harness, an onboarding-issued runId NEVER gets a
// `_logs/<runId>` directory — identically to a runId minted by the generic
// `POST /api/agents/:slug/run` route under the same suppression. Once
// `GET /api/agents/runs/:runId` distinguishes "no run directory at all"
// (404) from "directory exists, no events yet" (200/running) — R6-04 D22,
// the fix that makes RunView.tsx's `found` prop reachable — this exact
// runId now correctly 404s. The literal 200 was an artifact of the route's
// old always-200 behaviour, not of the property AT-6 actually set out to
// prove (its own assertion message, unchanged below, has always named the
// real failure mode as a 400 — "a parallel, incompatible runId scheme would
// 400 here" — never a 404).
//
// D22 did not break AT-6's intent; it exposed that the assertion was
// coupled to a permissiveness this codebase has since removed. Per ruling:
// leave R5-01-F1 (cli/ui-bridge-dry-spawn.test.ts, the shipped invariant
// that dry-bridge must NOT create that same directory) untouched — it is a
// correct, working detector for its OWN invariant — and amend AT-6 instead
// to test what its rationale actually claims:
//
//   1. the scheme is ACCEPTED by the shared surface (not 400 — the failure
//      mode AT-6's own message names);
//   2. EQUIVALENCE — an onboarding runId and a runId from the generic
//      POST /api/agents/:slug/run route, dispatched in the SAME harness
//      state, land on the SAME status on the shared surface. This is a
//      DIRECT proof of "identical plumbing, not a parallel one" — strictly
//      stronger than pinning either route's absolute status code, and it
//      stays true whatever that code is;
//   3. the body shape matches whatever status the equivalence establishes
//      (a 404 body carries `{error}`, never the old `{ok:true}`).
// ---------------------------------------------------------------------------

test('R4-17 AT-6 (D6, AMENDED — R6-04 D22): the onboarding runId is a REAL run identity on the SAME shared GET /api/agents/runs/<runId> status-poll surface the generic dispatch route uses — proved by STATUS EQUIVALENCE with a runId from POST /api/agents/:slug/run in the SAME harness state, not by either route\'s absolute status code', async () => {
  // A comparable fixture agent for the generic dispatch route — mirrors
  // cli/ui-bridge-agent-run.test.ts's own `studioAgent()` fixture shape.
  // This slug is used by NO other test in this file.
  const equivSlug = 'onboarding-at6-equivalence-agent';
  mkdirSync(join(forgeRoot, 'skills', equivSlug), { recursive: true });
  writeFileSync(join(forgeRoot, 'skills', equivSlug, 'SKILL.md'), `---
name: ${equivSlug}
description: AT-6 equivalence fixture
purpose: prove the onboarding route's runId behaves identically to the generic dispatch route's runId on the shared status-poll surface
brainAccess: advisory
interactivity: Autonomous once launched; asks no questions.
surface: unattended
composition:
  skills: []
  tools: []
  mcps: []
  guards: []
runtime:
  sdk: claude
  strategy: fixed
  model: claude-sonnet-4-6
allowed-tools: [Read]
disallowed-tools: [Bash]
---

Fixture body for ${equivSlug}.
`);

  const onboardingRes = await fetch(`${url}/api/studio/onboarding/start`, {
    method: 'POST', headers: CSRF, body: JSON.stringify({ project: 'demoproj' }),
  });
  const { runId: onboardingRunId } = (await onboardingRes.json()) as { runId: string };

  const genericRes = await fetch(`${url}/api/agents/${equivSlug}/run`, {
    method: 'POST', headers: CSRF, body: JSON.stringify({ project: 'demoproj' }),
  });
  const { runId: genericRunId } = (await genericRes.json()) as { runId: string };

  const [onboardingStatusRes, genericStatusRes] = await Promise.all([
    fetch(`${url}/api/agents/runs/${encodeURIComponent(onboardingRunId)}`),
    fetch(`${url}/api/agents/runs/${encodeURIComponent(genericRunId)}`),
  ]);

  // (1) accepted, not rejected as malformed — the failure mode AT-6's own
  // message has always named.
  assert.notEqual(
    onboardingStatusRes.status, 400,
    'the onboarding runId must never be rejected as a malformed/incompatible identity by the shared status-poll surface',
  );

  // (2) EQUIVALENCE — the direct proof of "identical plumbing, not a
  // parallel one".
  assert.equal(
    onboardingStatusRes.status, genericStatusRes.status,
    `onboarding runId (${onboardingRunId}) and generic-dispatch runId (${genericRunId}) must land on the SAME status on the shared surface — a parallel/incompatible runId scheme would diverge here even if neither alone were 400`,
  );

  // (3) body shape matches whatever status the equivalence establishes.
  const onboardingBody = (await onboardingStatusRes.json()) as Record<string, unknown>;
  if (onboardingStatusRes.status === 404) {
    assert.equal(typeof onboardingBody['error'], 'string', '404 body must carry an error string, not a fabricated run shape');
    assert.equal(onboardingBody['ok'], undefined, '404 body must not carry the old {ok:true} success shape');
  } else {
    assert.equal(onboardingBody['ok'], true);
  }
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
// ROUND-3 CORRECTION (pin 5): the paragraph above claimed the narrower
// `_onboarding/<sessionId>/{status.json,prompt.md}` leaf-write vector was
// "inherently flaky in CI, and not attempted here" for lack of a Date
// injection seam. That claim was WRONG — round-3 adversarial review
// reproduced it live with a 100% hit rate by pre-planting candidate
// session-id directories spanning the request's own wall-clock window (5
// candidates over a 4-second window), never needing to inject a fixed Date
// at all. AT-13/AT-14/AT-15 below pin the three independent closes (T2
// ruling): exclusive session-dir creation, exclusive ('wx') leaf-file
// writes, and session-id entropy. See those tests' own headers for the
// candidate-window technique and its one disclosed limitation: once entropy
// (AT-17) makes the id genuinely unguessable, AT-13/14/15's collision can no
// longer be engineered by ANY external caller (including this test) — they
// remain correct (their assertions stay true) but become unable to detect a
// future regression in the mkdir/write exclusivity alone. Disclosed, not
// silently assumed away — see the T3 pin-5 report for the full reasoning.
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

// ---------------------------------------------------------------------------
// PIN 5 — round-3 adversarial review, item 1 (BLOCKER): the leaf writes
// `<project>/_onboarding/<sessionId>/{status.json,prompt.md}` are unguarded.
// `sessionId` (`newArchitectSessionId()`, cli/ui-bridge.ts:1693-1696) has only
// ONE-SECOND granularity — zero entropy. A pre-planted `<sid>/` directory
// with `status.json`/`prompt.md` as SYMLINKS to an outside target captures
// both writes (`mkdirSync(..., {recursive:true})` silently reuses the
// pre-existing dir; `writeFileSync` with no exclusive flag follows the
// symlinks). Reproduced live with a 100% hit rate using 5 candidate
// directories spanning a 4-second window (the technique `candidateSessionIds`
// below mirrors, slightly widened for headroom).
//
// T2's ruling: THREE independent closes — (1) `mkdirSync(sessionDir)` with NO
// `recursive` (a pre-existing dir is refused, never reused), (2) both leaf
// writes use an exclusive create flag (`'wx'`, so an existing path —
// including a symlink — fails the write instead of being followed), (3) the
// session id gains entropy so it is not guessable at all.
//
// AT-13/AT-14 pin close (2) via the classic exploit shape (a pre-existing
// dir with a symlinked leaf file) — this ALSO happens to trip close (1)
// today (the dir pre-exists), which is fine: the assertion is OUTCOME-based
// (the outside sentinel is byte-unchanged), true whichever of the two closes
// is the one that actually stops the write, so the test keeps its value even
// if a future regression removes ONE of the two but not the other. AT-15
// pins close (1) alone via a directory that is REAL but EMPTY (no symlink at
// all) — if close (1) alone regressed to `recursive:true` while close (2)
// (the 'wx' flag) remained, this empty directory would be silently reused
// and populated with FRESH, non-colliding files (no EEXIST from 'wx' — there
// is nothing there to collide with), so this test's "stays empty" assertion
// depends on close (1) alone, not on close (2).
//
// PIN 6 RE-POINT (this round): the paragraph above predicted its own
// obsolescence, correctly. `newArchitectSessionId()` now carries real
// entropy (an 8-hex-char suffix, `cli/ui-bridge.ts:1700-1710`), so none of
// AT-13/14/15's candidate directories can coincide with the route's real
// target ever again — their assertions stayed TRUE but became VACUOUS
// (green for the wrong reason: the route simply never touches the planted
// fixture, not because it was refused). `writeOnboardingSession` was
// extracted as its own EXPORTED function specifically to be this follow-up
// seam (see its own docstring, `cli/ui-bridge.ts:2333-2369`, which names
// this exact test file as the place a fixed-id unit test would land).
// AT-13/AT-14/AT-15 below now call it DIRECTLY with an explicit, known
// `sessionId` instead of guessing at the route's — the three closes below
// are unchanged, only the calling surface moved from "HTTP request, guessed
// id" to "direct function call, known id":
//
// T2's ruling (unchanged): THREE independent closes — (1) `mkdirSync
// (sessionDir)` with NO `recursive` (a pre-existing dir is refused, never
// reused), (2) both leaf writes use an exclusive create flag (`'wx'`, so an
// existing path — including a symlink — fails the write instead of being
// followed), (3) the session id gains entropy so it is not guessable at all
// (pinned independently, via the ROUTE, by AT-17 — entropy is a property of
// `newArchitectSessionId()`, which only the route calls, so it cannot be
// pinned through the seam).
//
// AT-13/AT-14 pin close (2) via the classic exploit shape (a pre-existing
// dir with a symlinked leaf file) — this ALSO trips close (1) (the dir has
// to pre-exist for a leaf symlink to live inside it), which is fine and, with
// direct control over the id, now PROVEN rather than merely disclosed: the
// assertion is OUTCOME-based (the outside sentinel is byte-unchanged), true
// whichever of the two closes stops the write. Structurally, closes (1) and
// (2) cannot be independently discriminated by THIS attack shape — any
// pre-planted leaf content requires the session dir to already exist, so
// close (1) alone is always sufficient to refuse it before either leaf write
// is ever attempted; only a regression to BOTH closes at once lets the
// symlinked leaf get followed. AT-15 is what independently pins close (1)
// alone: a directory that is REAL but EMPTY (no symlink, no files) — if
// close (1) alone regressed to `recursive:true` while close (2) (the 'wx'
// flag) remained, this empty directory would be silently reused and
// populated with FRESH, non-colliding files (no EEXIST from 'wx' — there is
// nothing there to collide with), so this test's "stays empty" assertion
// depends on close (1) alone, not on close (2). AT-18 is the ACCEPT control
// this direct-seam surface didn't have before: a fresh, never-planted id
// under a real `_onboarding` parent must still succeed and write both files
// correctly — proving the three closes are real containment/exclusivity,
// not a blanket refusal (the "guard that cannot fail is not a guard" brief).
// ---------------------------------------------------------------------------

test('R4-17 AT-13 (BLOCKER, pin 5 item 1 / pin 6 re-point, REJECT — seam-level, explicit sessionId, real filesystem object, never a status code / thrown-or-not check alone): writeOnboardingSession is called DIRECTLY against a KNOWN session id whose directory already exists with status.json as a SYMLINK to an outside sentinel file; the call must never write through it', async () => {
  const project = 'symlinkstatusleafproj-seam';
  const onboardingDir = mkdtempSync(join(tmpdir(), 'onboarding-seam-status-parent-'));
  const sessionId = 'r4-17-seam-status-fixed-2026-08-06T00-00-00';
  const sessionDir = join(onboardingDir, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  const sentinelDir = mkdtempSync(join(tmpdir(), 'onboarding-status-sentinel-'));
  const sentinelPath = join(sentinelDir, 'outside-status.json');
  const sentinelContent = 'SENTINEL-STATUS-UNTOUCHED-7f3c91';
  writeFileSync(sentinelPath, sentinelContent, 'utf8');
  symlinkSync(sentinelPath, join(sessionDir, 'status.json'));
  try {
    try {
      writeOnboardingSession(onboardingDir, sessionId, project, '_agent-onboarding-seam-status-test', { northStar: 'symlinked status.json probe' });
    } catch { /* expected — refusal is asserted on the filesystem below, not on the throw itself */ }
    assert.equal(
      readFileSync(sentinelPath, 'utf8'), sentinelContent,
      `the outside sentinel target of a planted status.json symlink must be byte-unchanged for the KNOWN session id ${sessionId} — a write-through here means writeOnboardingSession reused a pre-existing session dir and/or wrote through a pre-existing symlink instead of refusing it`,
    );
  } finally {
    rmSync(onboardingDir, { recursive: true, force: true });
    rmSync(sentinelDir, { recursive: true, force: true });
  }
});

test('R4-17 AT-14 (BLOCKER, pin 5 item 1 / pin 6 re-point, REJECT — seam-level, explicit sessionId, real filesystem object, never a status code / thrown-or-not check alone): writeOnboardingSession is called DIRECTLY against a KNOWN session id whose directory already exists with prompt.md as a SYMLINK to an outside sentinel file; the call must never write through it', async () => {
  const project = 'symlinkpromptleafproj-seam';
  const onboardingDir = mkdtempSync(join(tmpdir(), 'onboarding-seam-prompt-parent-'));
  const sessionId = 'r4-17-seam-prompt-fixed-2026-08-06T00-00-00';
  const sessionDir = join(onboardingDir, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  const sentinelDir = mkdtempSync(join(tmpdir(), 'onboarding-prompt-sentinel-'));
  const sentinelPath = join(sentinelDir, 'outside-prompt.md');
  const sentinelContent = 'SENTINEL-PROMPT-UNTOUCHED-a82e4d';
  writeFileSync(sentinelPath, sentinelContent, 'utf8');
  symlinkSync(sentinelPath, join(sessionDir, 'prompt.md'));
  try {
    try {
      writeOnboardingSession(onboardingDir, sessionId, project, '_agent-onboarding-seam-prompt-test', { northStar: 'symlinked prompt.md probe' });
    } catch { /* expected — refusal is asserted on the filesystem below, not on the throw itself */ }
    assert.equal(
      readFileSync(sentinelPath, 'utf8'), sentinelContent,
      `the outside sentinel target of a planted prompt.md symlink must be byte-unchanged for the KNOWN session id ${sessionId} — a write-through here means writeOnboardingSession reused a pre-existing session dir and/or wrote through a pre-existing symlink instead of refusing it`,
    );
  } finally {
    rmSync(onboardingDir, { recursive: true, force: true });
    rmSync(sentinelDir, { recursive: true, force: true });
  }
});

test('R4-17 AT-15 (BLOCKER, pin 5 item 1 / pin 6 re-point, REJECT — seam-level, explicit sessionId, pins exclusive session-dir CREATION independently of any symlink): writeOnboardingSession is called DIRECTLY against a KNOWN session id whose directory already exists as a real, EMPTY directory (no symlinks, no files at all); the call must refuse rather than silently reuse and populate it', async () => {
  const onboardingDir = mkdtempSync(join(tmpdir(), 'onboarding-seam-emptydir-parent-'));
  const sessionId = 'r4-17-seam-emptydir-fixed-2026-08-06T00-00-00';
  const sessionDir = join(onboardingDir, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  try {
    try {
      writeOnboardingSession(onboardingDir, sessionId, 'preexistingemptydirproj-seam', '_agent-onboarding-seam-emptydir-test', { northStar: 'pre-existing empty dir probe' });
    } catch { /* expected — refusal is asserted on the filesystem below, not on the throw itself */ }
    assert.deepEqual(
      readdirSync(sessionDir), [],
      `pre-existing session dir ${sessionDir} must stay EMPTY (refused, not silently reused/populated) — this is the load-bearing assertion, never a thrown-or-not check alone: a call relying only on an exclusive WRITE flag but not an exclusive directory CREATE would happily populate this pre-staked empty directory and return normally`,
    );
  } finally {
    rmSync(onboardingDir, { recursive: true, force: true });
  }
});

test('R4-17 AT-18 (pin 6 — seam-level ACCEPT control, the counterpart to AT-13/14/15\'s REJECT pins): writeOnboardingSession called DIRECTLY with a fresh, never-before-planted session id under a real "_onboarding" parent succeeds, and writes BOTH status.json and prompt.md at the correct location with the correct shape — proving the three closes are real containment/exclusivity, not a blanket refusal that would break every legitimate onboarding start', async () => {
  const onboardingDir = mkdtempSync(join(tmpdir(), 'onboarding-seam-accept-parent-'));
  const sessionId = 'r4-17-seam-accept-fixed-2026-08-06T00-00-00';
  const runId = '_agent-onboarding-seam-accept-test';
  try {
    const { sessionDir } = writeOnboardingSession(onboardingDir, sessionId, 'acceptcontrolproj-seam', runId, { northStar: 'seam accept control probe 6f2a' });
    assert.equal(sessionDir, join(onboardingDir, sessionId), 'the returned sessionDir must be exactly onboardingParent/sessionId');
    const status = JSON.parse(readFileSync(join(sessionDir, 'status.json'), 'utf8')) as {
      phase: string; project: string; runId: string; startedAt: string;
    };
    assert.equal(status.phase, 'running');
    assert.equal(status.project, 'acceptcontrolproj-seam');
    assert.equal(status.runId, runId);
    assert.ok(typeof status.startedAt === 'string' && status.startedAt.length > 0);
    const prompt = readFileSync(join(sessionDir, 'prompt.md'), 'utf8');
    assert.ok(
      prompt.includes('seam accept control probe 6f2a'),
      `prompt.md must render the operator inputs verbatim, got: ${JSON.stringify(prompt)}`,
    );
  } finally {
    rmSync(onboardingDir, { recursive: true, force: true });
  }
});

test('R4-17 AT-16 (pin 5 item 1, ACCEPT control): a project with a REAL EARLIER onboarding session already inside "_onboarding" (the shape every SECOND run has) — a fresh start must still succeed, land in its OWN distinct session dir, and leave the earlier session completely untouched', async () => {
  const project = 'secondrunwithearliersession';
  const projectDir = join(forgeRoot, 'projects', project);
  const earlierSessionId = '2020-01-01T00-00-00'; // deliberately historical — never collides with "now"
  const earlierDir = join(projectDir, '_onboarding', earlierSessionId);
  mkdirSync(earlierDir, { recursive: true });
  const earlierStatus = JSON.stringify(
    { phase: 'done', project, runId: '_agent-onboarding-agent-earlier', startedAt: '2020-01-01T00:00:00.000Z' },
    null, 2,
  );
  writeFileSync(join(earlierDir, 'status.json'), earlierStatus, 'utf8');
  writeFileSync(join(earlierDir, 'prompt.md'), '# earlier prompt\n', 'utf8');
  try {
    const res = await fetch(`${url}/api/studio/onboarding/start`, {
      method: 'POST', headers: CSRF, body: JSON.stringify({ project, inputs: { northStar: 'second run probe' } }),
    });
    const text = await res.text();
    assert.equal(res.status, 200, `a second onboarding run on a project with an existing earlier session must succeed, got ${res.status}: ${text}`);
    const body = JSON.parse(text) as { sessionId: string };
    assert.notEqual(body.sessionId, earlierSessionId, 'the new session must land in its OWN distinct directory, not the earlier one');
    const newSessionDir = join(projectDir, '_onboarding', body.sessionId);
    assert.ok(existsSync(join(newSessionDir, 'status.json')), `expected the new session to land at ${newSessionDir}`);
    assert.equal(
      readFileSync(join(earlierDir, 'status.json'), 'utf8'), earlierStatus,
      'the earlier session\'s status.json must be completely untouched by the new run — a guard that breaks the second run is worse than the hole it closes',
    );
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('R4-17 AT-17 (BLOCKER, pin 5 item 1, id-entropy): two onboarding starts fired back-to-back for the SAME project — well within the same wall-clock second — produce DIFFERENT session ids, and each id still matches SAFE_ID_RE (the id-format contract the session-shell read route, cli/bridge-studio-sessions.ts, enforces)', async () => {
  const project = 'entropyprobeproj';
  const projectDir = join(forgeRoot, 'projects', project);
  mkdirSync(projectDir, { recursive: true });
  try {
    const res1 = await fetch(`${url}/api/studio/onboarding/start`, {
      method: 'POST', headers: CSRF, body: JSON.stringify({ project, inputs: { northStar: 'entropy probe A' } }),
    });
    const res2 = await fetch(`${url}/api/studio/onboarding/start`, {
      method: 'POST', headers: CSRF, body: JSON.stringify({ project, inputs: { northStar: 'entropy probe B' } }),
    });
    assert.equal(res1.status, 200);
    assert.equal(res2.status, 200);
    const body1 = (await res1.json()) as { sessionId: string };
    const body2 = (await res2.json()) as { sessionId: string };
    assert.notEqual(
      body1.sessionId, body2.sessionId,
      `two onboarding starts fired back-to-back (well within the SAME wall-clock second) must produce DIFFERENT session ids — a 1-second-granularity ISO timestamp alone is guessable/collidable; the fix must add entropy, got the SAME id "${body1.sessionId}" both times`,
    );
    for (const id of [body1.sessionId, body2.sessionId]) {
      assert.ok(SAFE_ID_RE.test(id), `session id "${id}" must still match SAFE_ID_RE (${SAFE_ID_RE}) — the session-shell read route (cli/bridge-studio-sessions.ts) rejects anything outside this charset`);
    }
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// W6-B14 — GET /api/studio/projects/:id/onboarding/active: reattach
// discovery for a client that lost its onboarding runId (nav-away, reload).
// `OnboardWithAgent` (forge-ui) only ever knew its dispatched runId from its
// OWN component state, with no way back to a still-running server-side
// dispatch — even though the session's own status.json already carries
// everything needed.
// ---------------------------------------------------------------------------

test('W6-B14: GET .../onboarding/active on a project that has never onboarded -> {ok:true, sessionId:null, runId:null, phase:null}, never a guess', async () => {
  const project = 'never-onboarded-proj';
  const projectDir = join(forgeRoot, 'projects', project);
  mkdirSync(projectDir, { recursive: true });
  try {
    const res = await fetch(`${url}/api/studio/projects/${project}/onboarding/active`);
    const body = await res.json() as { ok: boolean; sessionId: string | null; runId: string | null; phase: string | null };
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.ok, true);
    assert.equal(body.sessionId, null);
    assert.equal(body.runId, null);
    assert.equal(body.phase, null);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('W6-B14: GET .../onboarding/active rediscovers the sessionId/runId/phase of a just-started onboarding session — the exact runId POST returned', async () => {
  const project = 'reattach-probe-proj';
  const projectDir = join(forgeRoot, 'projects', project);
  mkdirSync(projectDir, { recursive: true });
  try {
    const start = await fetch(`${url}/api/studio/onboarding/start`, {
      method: 'POST', headers: CSRF, body: JSON.stringify({ project, inputs: { northStar: 'reattach probe' } }),
    });
    assert.equal(start.status, 200);
    const startBody = (await start.json()) as { sessionId: string; runId: string };

    const active = await fetch(`${url}/api/studio/projects/${project}/onboarding/active`);
    const activeBody = await active.json() as { ok: boolean; sessionId: string | null; runId: string | null; phase: string | null };
    assert.equal(active.status, 200, JSON.stringify(activeBody));
    assert.equal(activeBody.ok, true);
    assert.equal(activeBody.sessionId, startBody.sessionId);
    assert.equal(activeBody.runId, startBody.runId, 'active discovery must rediscover the SAME runId POST /start returned');
    assert.equal(activeBody.phase, 'running', 'a freshly-started session has not reached a terminal phase yet');
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('W6-B14: GET .../onboarding/active picks the MOST RECENT of two onboarding sessions for the same project', async () => {
  const project = 'reattach-latest-proj';
  const projectDir = join(forgeRoot, 'projects', project);
  mkdirSync(projectDir, { recursive: true });
  try {
    await fetch(`${url}/api/studio/onboarding/start`, {
      method: 'POST', headers: CSRF, body: JSON.stringify({ project, inputs: { northStar: 'first run' } }),
    });
    const second = await fetch(`${url}/api/studio/onboarding/start`, {
      method: 'POST', headers: CSRF, body: JSON.stringify({ project, inputs: { northStar: 'second run' } }),
    });
    const secondBody = (await second.json()) as { sessionId: string };

    const active = await fetch(`${url}/api/studio/projects/${project}/onboarding/active`);
    const activeBody = await active.json() as { sessionId: string | null };
    assert.equal(activeBody.sessionId, secondBody.sessionId, 'must pick the MOST RECENT session, not the first one found');
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('W6-B14: GET .../onboarding/active for an unknown project -> 404', async () => {
  const res = await fetch(`${url}/api/studio/projects/no-such-project-xyz/onboarding/active`);
  assert.equal(res.status, 404);
});

test('W6-B14: GET .../onboarding/active for a malformed project slug -> 400', async () => {
  const res = await fetch(`${url}/api/studio/projects/${encodeURIComponent('not a slug!')}/onboarding/active`);
  assert.equal(res.status, 400);
});
