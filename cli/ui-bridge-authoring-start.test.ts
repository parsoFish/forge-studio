/**
 * Acceptance tests for `POST /api/studio/authoring/start` (R4-21 T3,
 * BLOCKER-2 fix — the authoring session's kickoff route, `cli/ui-bridge.ts`).
 *
 * Byte-for-byte the SAME shape as `POST /api/studio/onboarding/start`
 * (`cli/ui-bridge-onboarding-start.test.ts`, R4-17) — `project` is
 * `SLUG_RE`+length-cap validated BEFORE any fs call, resolved through the
 * SAME `resolveContainedProjectDir`, and the session dir is created via the
 * SAME two-level containment shape (`_authoring` parent created +
 * realpath-re-verified BEFORE the session dir beneath it). This file is a
 * deliberately SMALLER set than the onboarding sibling's 18-AT suite — it
 * pins the core contract (validation-before-fs-call, happy path, real
 * session-dir shape, and one containment escape) rather than re-deriving
 * every AT that route's own security history already earned; the SHARED
 * primitives (`resolveContainedProjectDir`, `SAFE_ID_RE`,
 * `resolveGuardedPath`-adjacent guards) already carry their own exhaustive
 * coverage elsewhere and are not re-litigated per caller.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-authoring-start-'));
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

function start(body: unknown): Promise<Response> {
  return fetch(`${url}/api/studio/authoring/start`, { method: 'POST', headers: CSRF, body: JSON.stringify(body) });
}

// ---------------------------------------------------------------------------
// Validation — BEFORE any fs call
// ---------------------------------------------------------------------------

test('AT-1: malformed project slug -> 400, no _authoring dir created anywhere', async () => {
  const res = await start({ project: '../../etc', prompt: 'a skill that does x' });
  assert.equal(res.status, 400);
  assert.ok(!existsSync(join(forgeRoot, 'projects', 'demoproj', '_authoring')), 'a rejected request must create nothing on disk');
});

test('AT-2: missing project -> 400', async () => {
  const res = await start({ prompt: 'a skill that does x' });
  assert.equal(res.status, 400);
});

test('AT-3: missing prompt -> 400, no _authoring dir created', async () => {
  const res = await start({ project: 'demoproj' });
  assert.equal(res.status, 400);
  assert.ok(!existsSync(join(forgeRoot, 'projects', 'demoproj', '_authoring')), 'a rejected request must create nothing on disk');
});

test('AT-4: empty/whitespace-only prompt -> 400', async () => {
  const res = await start({ project: 'demoproj', prompt: '   ' });
  assert.equal(res.status, 400);
});

test('AT-5: prompt exceeding the length cap -> 400, no _authoring dir created', async () => {
  const res = await start({ project: 'demoproj', prompt: 'x'.repeat(5000) });
  assert.equal(res.status, 400);
  assert.ok(!existsSync(join(forgeRoot, 'projects', 'demoproj', '_authoring')), 'a rejected request must create nothing on disk');
});

test('AT-6: unknown project -> 404, no _authoring dir created', async () => {
  const res = await start({ project: 'no-such-project', prompt: 'a skill that does x' });
  assert.equal(res.status, 404);
});

// ---------------------------------------------------------------------------
// Happy path — the real, on-disk session shape
// ---------------------------------------------------------------------------

// UPDATED (R4-21 phase 2, WI-1, D3 — _wave5/unit-specs/R4-21-phase2.md):
// `writeAuthoringSession` used to seed `phase:'running'`, a token that is
// not a row in the authoring turnSpec's phase table (ADR-043 §1: analyzing ->
// awaiting-review -> committing -> committed) — `runInteractiveTurn` fails
// loud on an unrecognised phase BY DESIGN (the declared-data-fails-open
// antipattern this campaign guards against), so a session seeded at
// "running" would brick the very first real turn once WI-1 lands.
// OLD assertion: status.phase === 'running'.
// NEW assertion: status.phase === 'analyzing' (the turnSpec's own first row).
// Why this is a CONTRACT CHANGE, not a weakening: "running" was never a real
// phase ANY turnSpec row recognised — this corrects the seed to the phase
// the state machine actually starts at, closing a session-bricking defect
// rather than loosening a check.
test('AT-7: a valid start writes a real session dir (status.json + prompt.md) under <project>/_authoring/<sessionId>, prompt.md carries the operator text verbatim', async () => {
  const res = await start({ project: 'demoproj', prompt: 'A skill that summarizes PR diffs.' });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  const body = JSON.parse(text) as { ok: boolean; sessionId: string; project: string };
  assert.equal(body.ok, true);
  assert.equal(body.project, 'demoproj');
  assert.ok(body.sessionId, 'sessionId must be present on a successful start');

  const sessionDir = join(forgeRoot, 'projects', 'demoproj', '_authoring', body.sessionId);
  const status = JSON.parse(readFileSync(join(sessionDir, 'status.json'), 'utf8')) as { phase: string; project: string };
  assert.equal(status.phase, 'analyzing', 'D3: the seeded phase must be "analyzing" (the authoring turnSpec\'s first row) — "running" is not a row in ADR-043 §1\'s phase table and would brick the first real turn');
  assert.equal(status.project, 'demoproj');

  const prompt = readFileSync(join(sessionDir, 'prompt.md'), 'utf8');
  assert.equal(prompt, 'A skill that summarizes PR diffs.\n', 'prompt.md must render the operator\'s own words verbatim — no fabricated interview question');
});

// R4-21 phase 2, pin round 3 (T3, adversarial-review round 3) — P4
// (_wave5/unit-specs/R4-21-phase2.md): `buildTurnPrompt`
// (orchestrator/interactive-runner.ts) composes the turn prompt from
// SKILL.md + the phase row + a JSON dump of status.json — it never reads
// prompt.md. So the operator's free-text description of what to build,
// written verbatim to prompt.md by this route, is silently dropped from
// every real agent turn. The intended production fix: `writeAuthoringSession`
// ALSO persists the prompt into status.json (as an ADDITION, not a
// replacement of the existing prompt.md write) so `buildTurnPrompt`'s
// existing whole-status JSON dump threads it through for free (see the
// OTHER half of this pin, orchestrator/interactive-runner.test.ts's own
// "P4" test, which proves that half of the contract against the real
// runner). RED today: `writeAuthoringSession` (cli/ui-bridge.ts) seeds
// status.json with only {phase, project, runId, startedAt} — no prompt key.
test('AT-11 (P4): a valid start seeds status.json with the operator\'s prompt verbatim, alongside phase:"analyzing" — prompt.md is still written too (an addition, not a replacement)', async () => {
  const promptText = 'A skill that reviews PR titles for conventional-commit compliance.';
  const res = await start({ project: 'demoproj', prompt: promptText });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  const body = JSON.parse(text) as { sessionId: string };

  const sessionDir = join(forgeRoot, 'projects', 'demoproj', '_authoring', body.sessionId);
  const status = JSON.parse(readFileSync(join(sessionDir, 'status.json'), 'utf8')) as { phase: string; prompt?: string };
  assert.equal(status.phase, 'analyzing', 'positive control: phase must still be "analyzing" (D3) — unaffected by this fix');
  assert.equal(
    status.prompt,
    promptText,
    'status.json must carry the operator\'s prompt verbatim — buildTurnPrompt (orchestrator/interactive-runner.ts) ' +
      'composes the turn prompt from a JSON dump of status.json, so a prompt absent here is silently dropped from ' +
      'every future real agent turn',
  );

  const promptMd = readFileSync(join(sessionDir, 'prompt.md'), 'utf8');
  assert.equal(promptMd, `${promptText}\n`, 'prompt.md must STILL be written verbatim — this fix is an addition, not a replacement of the existing contract');
});

// ---------------------------------------------------------------------------
// ADR-043 §3 amendment (wave-6 kickoff model-tier seam) — creation-agent is
// now strategy:range [sonnet, opus].
// ---------------------------------------------------------------------------

test('AT-12: a valid modelTier ("opus", within the widened range) is persisted into status.json', async () => {
  const res = await start({ project: 'demoproj', prompt: 'A skill that summarizes PR diffs.', modelTier: 'opus' });
  const body = (await res.json()) as { sessionId: string };
  assert.equal(res.status, 200);
  const sessionDir = join(forgeRoot, 'projects', 'demoproj', '_authoring', body.sessionId);
  const status = JSON.parse(readFileSync(join(sessionDir, 'status.json'), 'utf8')) as { modelTier?: string };
  assert.equal(status.modelTier, 'opus');
});

test('AT-13: an out-of-envelope modelTier ("haiku") 400s naming the value and the allowed set, no _authoring session dir created', async () => {
  const before = existsSync(join(forgeRoot, 'projects', 'demoproj', '_authoring'))
    ? readdirSync(join(forgeRoot, 'projects', 'demoproj', '_authoring'))
    : [];
  const res = await start({ project: 'demoproj', prompt: 'A skill that summarizes PR diffs.', modelTier: 'haiku' });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /requested model tier "haiku".*allowed tier\(s\): sonnet, opus/);
  const after = existsSync(join(forgeRoot, 'projects', 'demoproj', '_authoring'))
    ? readdirSync(join(forgeRoot, 'projects', 'demoproj', '_authoring'))
    : [];
  assert.deepEqual(after, before, 'a rejected modelTier must not create a new session dir');
});

test('AT-8: two starts against the same project mint two distinct session dirs', async () => {
  const r1 = await start({ project: 'demoproj', prompt: 'first draft' });
  const r2 = await start({ project: 'demoproj', prompt: 'second draft' });
  const b1 = (await r1.json()) as { sessionId: string };
  const b2 = (await r2.json()) as { sessionId: string };
  assert.notEqual(b1.sessionId, b2.sessionId);
  assert.ok(existsSync(join(forgeRoot, 'projects', 'demoproj', '_authoring', b1.sessionId)));
  assert.ok(existsSync(join(forgeRoot, 'projects', 'demoproj', '_authoring', b2.sessionId)));
});

// ---------------------------------------------------------------------------
// Containment
// ---------------------------------------------------------------------------

test('AT-9 (containment): a project repo carrying a symlinked "_authoring" pointing outside the project is refused — nothing is written through it', async () => {
  const outsideDir = mkdtempSync(join(tmpdir(), 'authoring-start-outside-'));
  const linkPath = join(forgeRoot, 'projects', 'demoproj', '_authoring');
  try {
    symlinkSync(outsideDir, linkPath, 'dir');
  } catch {
    rmSync(outsideDir, { recursive: true, force: true });
    return; // symlinks unsupported on this filesystem/platform — skip
  }
  try {
    const res = await start({ project: 'demoproj', prompt: 'escape attempt' });
    assert.equal(res.status, 400, 'a symlinked _authoring parent escaping the project dir must be refused');
    const outsideEntries = existsSync(outsideDir) ? readdirSync(outsideDir) : [];
    assert.deepEqual(outsideEntries, [], 'nothing may be written into the out-of-tree directory the symlink points at');
  } finally {
    rmSync(linkPath, { force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

// ===========================================================================
// R4-21 phase 2, WI-2 (D-7 in this file's numbering — the unit-spec's own
// bullet: "spawnAgentTurn is invoked with ('authoring', project, sessionId)
// from the start route ... and the argv it builds is `agent run authoring
// <sid> --project <p>`"). CALL-RECORD assertion, not just the outcome.
//
// WHY THIS TECHNIQUE (a documented T3 design call): `spawnAgentTurn` /
// `SPAWN_AGENT_SPECS` are private, non-exported symbols of cli/ui-bridge.ts,
// and `spawn` is imported there as a named ESM binding
// (`import { spawn } from 'node:child_process'`) — empirically verified
// BEFORE choosing this approach that Node's `t.mock.method()` cannot
// intercept it two different ways (`mock.method(nsImport, 'spawn', ...)` ->
// "Cannot redefine property: spawn"; `mock.method(createRequire(...)('node:
// child_process'), 'spawn', ...)` -> silently never called — the CJS/ESM
// interop for this Node version does not share a live binding). There is
// also no existing pure-argv-builder export for spawnAgentTurn to test
// directly (unlike `spawnAgentDispatch`'s own `buildAgentDispatchArgs`,
// exported specifically for this reason) — adding one is a production
// change, out of this T3 pass's scope.
//
// Instead: `spawnAgentTurn` spawns `process.execPath` with argv resolved
// AGAINST `cwd: forgeRoot` (`orchestrator/cli.ts` is a RELATIVE path in that
// argv) — a fact this test controls completely. This fixture's `forgeRoot`
// is an isolated tmp dir whose `orchestrator/cli.ts` is a THIN STUB (never
// the real forge CLI, no node_modules needed) that captures its OWN
// `process.argv.slice(2)` to a file and exits immediately. This proves the
// REAL, OS-level argv the REAL (unmodified) start route passes to a REAL
// `spawn()` call — the actual external contract — without presuming ANY
// particular internal refactor shape for how the implementer gets there.
// ===========================================================================

const ARGV_CAPTURE_FILENAME = 'captured-argv.json';

/** A minimal `apps/forge/cli.ts` stand-in: writes its own argv (everything
 *  after the two node flags `spawnAgentTurn` always prepends) to a fixed
 *  file next to itself, then exits. Pure node:fs/node:path — no build step,
 *  no node_modules required, so `cwd: forgeRoot` need not be a real forge
 *  checkout for this ONE test. */
function writeStubCli(forgeRoot: string): void {
  mkdirSync(join(forgeRoot, 'apps', 'forge'), { recursive: true });
  writeFileSync(
    join(forgeRoot, 'apps', 'forge', 'cli.ts'),
    [
      "import { writeFileSync } from 'node:fs';",
      "import { join } from 'node:path';",
      `writeFileSync(join(import.meta.dirname, '..', '..', '${ARGV_CAPTURE_FILENAME}'), JSON.stringify(process.argv.slice(2)));`,
      '',
    ].join('\n'),
  );
}

/** Bounded poll for the stub CLI's captured-argv file — the real spawn is
 *  detached and fire-and-forget, so the parent request returns before the
 *  child has necessarily run; this does not retry a FAILING check to paper
 *  over flakiness, it waits for a genuinely async, already-in-flight
 *  artifact with a hard ceiling. */
async function waitForFile(path: string, timeoutMs = 5000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(path)) return readFileSync(path, 'utf8');
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${path} to appear — the child process never ran (or never reached the stub CLI at all)`);
}

test('AT-10 (CALL RECORD): a REAL (non-suppressed) start spawns argv exactly ["agent","run","authoring",<sid>,"--project","demoproj"] — proves spawnAgentTurn(forgeRoot,"authoring",project,sessionId) is reached, NOT spawnAgentDispatch', async () => {
  const realForgeRoot = mkdtempSync(join(tmpdir(), 'authoring-start-realspawn-'));
  const savedNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  const savedDryBridge = process.env.FORGE_DRY_BRIDGE;
  let realClose: (() => Promise<void>) | undefined;
  try {
    for (const state of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
      mkdirSync(join(realForgeRoot, '_queue', state), { recursive: true });
    }
    mkdirSync(join(realForgeRoot, '_logs'), { recursive: true });
    mkdirSync(join(realForgeRoot, 'projects', 'demoproj'), { recursive: true });
    writeStubCli(realForgeRoot);

    // Real spawn path — the whole point of this test.
    delete process.env.FORGE_ARCHITECT_NO_SPAWN;
    delete process.env.FORGE_DRY_BRIDGE;

    const real = await startBridge({ forgeRoot: realForgeRoot, port: 0 });
    realClose = real.close;

    const startRes = await fetch(`${real.url}/api/studio/authoring/start`, {
      method: 'POST',
      headers: CSRF,
      body: JSON.stringify({ project: 'demoproj', prompt: 'a skill that does x' }),
    });
    const startText = await startRes.text();
    assert.equal(startRes.status, 200, `expected the real (non-suppressed) start to still 200, got ${startRes.status}: ${startText}`);
    const startBody = JSON.parse(startText) as { sessionId: string };
    assert.ok(startBody.sessionId, 'a real start must still return a sessionId');

    const argvPath = join(realForgeRoot, ARGV_CAPTURE_FILENAME);
    const raw = await waitForFile(argvPath);
    const argv = JSON.parse(raw) as string[];
    assert.deepEqual(
      argv,
      ['agent', 'run', 'authoring', startBody.sessionId, '--project', 'demoproj'],
      `spawnAgentTurn's real argv must be exactly this — got: ${JSON.stringify(argv)}`,
    );
  } finally {
    if (realClose) await realClose();
    if (savedNoSpawn !== undefined) process.env.FORGE_ARCHITECT_NO_SPAWN = savedNoSpawn; else delete process.env.FORGE_ARCHITECT_NO_SPAWN;
    if (savedDryBridge !== undefined) process.env.FORGE_DRY_BRIDGE = savedDryBridge; else delete process.env.FORGE_DRY_BRIDGE;
    rmSync(realForgeRoot, { recursive: true, force: true });
  }
});
