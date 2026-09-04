/**
 * Acceptance tests for cli/bridge-studio-affordances.ts (W6-B4 — the generic
 * session-affordance WRITE endpoint, ADR-043 2026-08-15 amendment §1):
 *
 *   POST /api/studio/sessions/:kind/:sessionId/:affordance
 *
 * Drives the REAL bridge (`startBridge`) against real on-disk session
 * fixtures seeded directly (never through a route) — mirrors
 * `cli/bridge-studio-sessions.test.ts` / `cli/bridge-studio-authoring.test.ts`
 * / `cli/ui-bridge-kb-cleanup.test.ts`'s own idioms, reusing their fixture
 * shapes exactly (real, checked-in `studio/session-kinds.yaml`; real
 * `brain/<kb>/kb.yaml` for kb-cleanup's drain).
 *
 * Coverage map (task brief §4 "security tests" + the table-test brief):
 *   - traversal sessionIds (literal .., percent-encoded, absolute-shaped) -> 404, no echo
 *   - unknown session kind -> 404, naming the allowed set
 *   - unknown affordance id -> 409, naming the affordance + the currently-available set
 *   - wrong-phase affordance (a real id from a DIFFERENT phase) -> 409
 *   - oversized / malformed body -> 400
 *   - onboarding / architect derive NO writable affordances -> 409 on any affordance id
 *   - (adversarial-review round) a symlinked session dir (the [project,
 *     kindDir, sessionId] leaf itself) -> 404, no write, no leak
 *   - (adversarial-review round) two CONCURRENT verdict-approve POSTs
 *     against the SAME kb-cleanup session -> exactly one 200 + one 409,
 *     exactly one _brainfix-<runId> log dir (the atomic-claim fix)
 *   - (adversarial-review round) answers[] count/size caps -> 400
 *   - (adversarial-review round) a structural pin that this file makes zero
 *     raw fs sink calls (kind/affordanceId never reach one directly)
 *   - per-kind table: instructions (answer + verdict), demo (verdict), kb-cleanup
 *     (verdict approve), authoring (verdict approve -> finalize)
 *   - parity: the generic verdict write reaches the IDENTICAL phase the bespoke
 *     per-kind route reaches, for instructions / demo / kb-cleanup
 *   - noop-phase discipline: a rejected call (409/422) never advances phase —
 *     a noop phase only ever advances via the accepted verdict write
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { request as httpRequest } from 'node:http';
import matter from 'gray-matter';

// STRUCT-1 (the zero-raw-fs structural lock) moved with the dispatch to
// `packages/sessions/tests/contract/affordance-no-raw-fs.test.ts` — it reads
// package SOURCE, so it belongs beside the source, and it now covers all six
// modules the carve spread that code across rather than the one file it used to.
import { startBridge } from './ui-bridge.ts';
import { KB_SEEDING_ANCHOR_PREFIX } from '@forge/knowledge/bridge-studio-kbs.ts';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-studio-affordances-'));
  for (const state of ['in-flight', 'done', 'failed', 'pending', 'ready-for-review']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'skills'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'hooks'), { recursive: true });
  // W8-B4 FIX-1 — TBL-authoring-7/8's template control needs these two
  // single-file template categories to exist as real finalize targets
  // (mirrors cli/bridge-studio-authoring-finalize.test.ts's own before()).
  mkdirSync(join(forgeRoot, 'studio', 'artifact-templates'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'demo-elements'), { recursive: true });
  mkdirSync(join(forgeRoot, 'projects'), { recursive: true });
  writeFileSync(
    join(forgeRoot, 'studio', 'catalog.yaml'),
    ['sdks: []', 'models: []', 'tools: []', 'mcps: []', 'guards: []', 'community-skills: []', ''].join('\n'),
  );
  // The REAL, checked-in session-kinds.yaml — byte-for-byte, mirrors
  // bridge-studio-authoring.test.ts's own "design call #1".
  const realSessionKindsYaml = readFileSync(join(REPO_ROOT, 'studio', 'session-kinds.yaml'), 'utf8');
  writeFileSync(join(forgeRoot, 'studio', 'session-kinds.yaml'), realSessionKindsYaml);

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  process.env.FORGE_DRY_BRIDGE = '1';
  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeBridge = result.close;
});

after(async () => {
  if (closeBridge) await closeBridge();
  delete process.env.FORGE_DRY_BRIDGE;
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let sessionCounter = 0;
function freshSessionId(): string {
  sessionCounter += 1;
  return `2026-08-15T00-00-${String(sessionCounter).padStart(3, '0')}-fx`;
}

function seedSession(project: string, kindDir: string, sessionId: string, status: Record<string, unknown>): string {
  const dir = join(forgeRoot, 'projects', project, kindDir, sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'status.json'), JSON.stringify(status, null, 2), 'utf8');
  return dir;
}

function readPhase(sessionDir: string): string {
  return (JSON.parse(readFileSync(join(sessionDir, 'status.json'), 'utf8')) as { phase: string }).phase;
}

function readStatus(sessionDir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(sessionDir, 'status.json'), 'utf8')) as Record<string, unknown>;
}

function writeKb(id: string, bindingYaml: string): void {
  const dir = join(forgeRoot, 'brain', id);
  mkdirSync(join(dir, 'themes'), { recursive: true });
  mkdirSync(join(dir, '_raw'), { recursive: true });
  writeFileSync(join(dir, 'kb.yaml'), `id: ${id}\nname: Fixture KB ${id}\nbinding: ${bindingYaml}\ndesc: A fixture KB for W6-B4 affordance tests.\n`, 'utf8');
}

function affordanceUrl(kind: string, sessionId: string, affordance: string): string {
  return `${bridgeUrl}/api/studio/sessions/${encodeURIComponent(kind)}/${encodeURIComponent(sessionId)}/${encodeURIComponent(affordance)}`;
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, { method: 'POST', headers: CSRF, body: JSON.stringify(body) });
}

/** RAW-request variant — a normal client (fetch/WHATWG URL) normalizes a
 *  literal ".." path segment away BEFORE the request ever leaves the
 *  process, so the server-side guard for that shape can only be exercised
 *  via a client that performs NO normalization. Node's low-level
 *  `http.request({ path })` places `path` directly on the request line —
 *  mirrors `cli/ui-bridge-kb-cleanup.test.ts`'s own `rawPost` exactly. */
function rawPost(rawPath: string, bodyText = '{}'): Promise<{ status: number; text: string }> {
  return new Promise((resolvePromise, reject) => {
    const u = new URL(bridgeUrl);
    const req = httpRequest(
      {
        hostname: u.hostname,
        port: u.port,
        path: rawPath,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forge-csrf': '1', 'content-length': Buffer.byteLength(bodyText) },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString('utf8'); });
        res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, text: data }));
      },
    );
    req.on('error', reject);
    req.end(bodyText);
  });
}

// ===========================================================================
// SECURITY — traversal sessionIds
// ===========================================================================

test('SEC-1: a literal ".." sessionId (raw wire, un-normalized by any client) -> 404, error body never echoes the id', async () => {
  const project = 'secproj1';
  seedSession(project, '_instructions', 'realvictim', { session_id: 'realvictim', project, phase: 'awaiting-verdict', round: 1, prompt: '' });
  const res = await rawPost(`/api/studio/sessions/instructions/../${encodeURIComponent('realvictim-awaiting-verdict-verdict')}`, JSON.stringify({ project, verdict: 'approve' }));
  // The route regex requires exactly 3 segments after /sessions/ — a raw ".."
  // either fails to match this route (falls through, 404 default) or is
  // rejected by isSafeRunId; either way it must never 200 or echo the id.
  assert.notEqual(res.status, 200, `traversal sessionId must never succeed, got ${res.status}: ${res.text}`);
  assert.doesNotMatch(res.text, /realvictim/, 'response must never echo the resolved/attempted session id');
});

test('SEC-2: an isSafeRunId-rejecting sessionId (embedded "..") -> 404 {error:"session not found"}, no path echoed', async () => {
  const project = 'secproj2';
  const res = await postJson(affordanceUrl('instructions', 'foo..bar', 'anything'), { project, verdict: 'approve' });
  const text = await res.text();
  assert.equal(res.status, 404, `expected 404, got ${res.status}: ${text}`);
  const body = JSON.parse(text) as { error: string };
  assert.equal(body.error, 'session not found');
  assert.doesNotMatch(text, /projects[/\\]/, 'error body must never echo a filesystem path');
});

test('SEC-3: an absolute-path-shaped sessionId ("/etc/passwd", percent-encoded) -> 404, never a 200', async () => {
  const project = 'secproj3';
  const res = await postJson(affordanceUrl('instructions', encodeURIComponent('/etc/passwd'), 'anything'), { project, verdict: 'approve' });
  assert.notEqual(res.status, 200, `absolute-path sessionId must never succeed, got ${res.status}`);
});

test('SEC-4: a well-formed but non-existent sessionId under a REAL project -> 404 {error:"session not found"}', async () => {
  const project = 'secproj4';
  mkdirSync(join(forgeRoot, 'projects', project, '_instructions'), { recursive: true });
  const res = await postJson(affordanceUrl('instructions', 'no-such-session-2026', 'anything'), { project, verdict: 'approve' });
  const body = (await res.json()) as { error: string };
  assert.equal(res.status, 404);
  assert.equal(body.error, 'session not found');
});

// ===========================================================================
// SECURITY — unknown session kind
// ===========================================================================

test('SEC-5: an unknown session kind -> 404, naming the offending value + the allowed set', async () => {
  const res = await postJson(affordanceUrl('not-a-real-kind', 'whatever', 'whatever'), { project: 'p' });
  const body = (await res.json()) as { error: string };
  assert.equal(res.status, 404);
  assert.match(body.error, /not-a-real-kind/);
  assert.match(body.error, /instructions/); // the allowed set is enumerated
});

// ===========================================================================
// SECURITY — unknown / wrong-phase affordance
// ===========================================================================

test('SEC-6: an unknown affordance id on a real, live session -> 409 naming the affordance + the currently-available set', async () => {
  const project = 'secproj6';
  const sessionId = freshSessionId();
  seedSession(project, '_instructions', sessionId, { session_id: sessionId, project, phase: 'awaiting-verdict', round: 1, prompt: '' });
  const res = await postJson(affordanceUrl('instructions', sessionId, 'totally-made-up-affordance'), { project, verdict: 'approve' });
  const body = (await res.json()) as { error: string };
  assert.equal(res.status, 409);
  assert.match(body.error, /totally-made-up-affordance/);
  assert.match(body.error, /awaiting-verdict-verdict/, `expected the CURRENTLY-available affordance id in the message, got: ${body.error}`);
});

test('SEC-7: a real affordance id, but VALID ONLY IN A DIFFERENT PHASE (a stale client) -> 409, and phase is left UNCHANGED (noop-phase discipline: no auto-advance on a rejected call)', async () => {
  const project = 'secproj7';
  const sessionId = freshSessionId();
  // Seeded at "interviewing" — "awaiting-verdict-verdict" is a REAL affordance
  // id in the registry, just not for THIS session's current phase.
  const sessionDir = seedSession(project, '_instructions', sessionId, { session_id: sessionId, project, phase: 'interviewing', round: 1, prompt: '' });
  const res = await postJson(affordanceUrl('instructions', sessionId, 'awaiting-verdict-verdict'), { project, verdict: 'approve' });
  const body = (await res.json()) as { error: string };
  assert.equal(res.status, 409);
  assert.match(body.error, /awaiting-verdict-verdict/);
  assert.match(body.error, /interviewing/, `409 body must name the ACTUAL current phase, got: ${body.error}`);
  assert.equal(readPhase(sessionDir), 'interviewing', 'a rejected (409) call must never advance status.json phase');
});

// ===========================================================================
// SECURITY — oversized / malformed body
// ===========================================================================

test('SEC-8: malformed (non-JSON) body -> 400, session untouched', async () => {
  const project = 'secproj8';
  const sessionId = freshSessionId();
  const sessionDir = seedSession(project, '_instructions', sessionId, { session_id: sessionId, project, phase: 'awaiting-verdict', round: 1, prompt: '' });
  const res = await fetch(affordanceUrl('instructions', sessionId, 'awaiting-verdict-verdict'), {
    method: 'POST',
    headers: CSRF,
    body: 'not valid json {{{',
  });
  assert.equal(res.status, 400);
  assert.equal(readPhase(sessionDir), 'awaiting-verdict', 'malformed body must never mutate session state');
});

test('SEC-9: oversized body (> 1 MiB) -> rejected (never 200); session untouched', async () => {
  // Mirrors cli/bridge-studio-write.test.ts's "PUT with oversized body ->
  // rejected (not 200)": the bridge destroys the socket when readJson's
  // MAX_BODY_BYTES cap is hit — undici may surface this as a thrown
  // TypeError ('fetch failed') OR as a 4xx response depending on how far the
  // server got before destroying the connection. Either is acceptable; a 200
  // is not.
  const project = 'secproj9';
  const sessionId = freshSessionId();
  const sessionDir = seedSession(project, '_instructions', sessionId, { session_id: sessionId, project, phase: 'awaiting-verdict', round: 1, prompt: '' });
  const huge = 'x'.repeat(2 * 1024 * 1024);
  try {
    const res = await fetch(affordanceUrl('instructions', sessionId, 'awaiting-verdict-verdict'), {
      method: 'POST',
      headers: CSRF,
      body: JSON.stringify({ project, verdict: 'approve', junk: huge }),
    });
    assert.notEqual(res.status, 200, `expected a non-200 for an oversized body, got ${res.status}`);
  } catch (err) {
    assert.ok(
      String(err).includes('fetch failed') || String(err).includes('ECONNRESET'),
      `expected a connection error for an oversized body, got: ${String(err)}`,
    );
  }
  assert.equal(readPhase(sessionDir), 'awaiting-verdict', 'an oversized/refused body must never mutate session state');
});

test('SEC-10: a non-object JSON body (array) -> 400', async () => {
  const project = 'secproj10';
  const sessionId = freshSessionId();
  seedSession(project, '_instructions', sessionId, { session_id: sessionId, project, phase: 'awaiting-verdict', round: 1, prompt: '' });
  const res = await postJson(affordanceUrl('instructions', sessionId, 'awaiting-verdict-verdict'), [1, 2, 3]);
  assert.equal(res.status, 400);
});

test('SEC-11: verdict body missing/invalid "verdict" field -> 400, naming the allowed values', async () => {
  const project = 'secproj11';
  const sessionId = freshSessionId();
  seedSession(project, '_instructions', sessionId, { session_id: sessionId, project, phase: 'awaiting-verdict', round: 1, prompt: '' });
  const res = await postJson(affordanceUrl('instructions', sessionId, 'awaiting-verdict-verdict'), { project, verdict: 'maybe' });
  const body = (await res.json()) as { error: string };
  assert.equal(res.status, 400);
  assert.match(body.error, /approve/);
  assert.match(body.error, /reject/);
});

// ===========================================================================
// onboarding / architect derive NO writable affordances
// ===========================================================================

test('NOAFF-1: architect (no turnSpec/panel) derives zero affordances -> any affordance id is 409, never routed to any write', async () => {
  const project = 'noaffproj1';
  const sessionId = freshSessionId();
  const sessionDir = seedSession(project, '_architect', sessionId, { session_id: sessionId, project, phase: 'awaiting-verdict' });
  const res = await postJson(affordanceUrl('architect', sessionId, 'anything-at-all'), { project, verdict: 'approve' });
  const body = (await res.json()) as { error: string };
  assert.equal(res.status, 409);
  assert.match(body.error, /\(none\)/, `expected the currently-available set to read "(none)", got: ${body.error}`);
  assert.equal(readPhase(sessionDir), 'awaiting-verdict', 'a 409-rejected call must never mutate session state');
});

test('NOAFF-2: onboarding (panel with zero noop/writes/next rows) derives zero affordances -> any affordance id is 409', async () => {
  const project = 'noaffproj2';
  const sessionId = freshSessionId();
  seedSession(project, '_onboarding', sessionId, { session_id: sessionId, project, phase: 'running' });
  const res = await postJson(affordanceUrl('onboarding', sessionId, 'anything-at-all'), { project, verdict: 'approve' });
  const body = (await res.json()) as { error: string };
  assert.equal(res.status, 409);
  assert.match(body.error, /\(none\)/);
});

// ===========================================================================
// TABLE TEST — instructions (question-form + verdict)
// ===========================================================================

test('TBL-instructions-1: question-form (answer) at awaiting-answers -> 200, answers.json written, phase -> interviewing, round advances', async () => {
  const project = 'tblinstr1';
  const sessionId = freshSessionId();
  const sessionDir = seedSession(project, '_instructions', sessionId, { session_id: sessionId, project, phase: 'awaiting-answers', round: 3, prompt: 'brief' });
  const res = await postJson(affordanceUrl('instructions', sessionId, 'awaiting-answers-question-form'), {
    project,
    answers: [{ question: 'What is the goal?', answer: 'Ship it.' }],
  });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  const body = JSON.parse(text) as { ok: boolean; round: number };
  assert.equal(body.ok, true);
  assert.equal(body.round, 1, 'first answers.json round for a fresh session is round 1');
  assert.equal(readPhase(sessionDir), 'interviewing');
  assert.ok(existsSync(join(sessionDir, 'answers.json')), 'answers.json must be written');
  const answers = JSON.parse(readFileSync(join(sessionDir, 'answers.json'), 'utf8')) as { round: number; answers: unknown[] }[];
  assert.equal(answers.length, 1);
  assert.deepEqual(answers[0].answers, [{ question: 'What is the goal?', answer: 'Ship it.' }]);
});

test('TBL-instructions-2: question-form with malformed answers[] shape -> 400, nothing written', async () => {
  const project = 'tblinstr2';
  const sessionId = freshSessionId();
  const sessionDir = seedSession(project, '_instructions', sessionId, { session_id: sessionId, project, phase: 'awaiting-answers', round: 1, prompt: '' });
  const res = await postJson(affordanceUrl('instructions', sessionId, 'awaiting-answers-question-form'), { project, answers: [{ question: 'Q?' }] });
  assert.equal(res.status, 400);
  assert.equal(existsSync(join(sessionDir, 'answers.json')), false);
  assert.equal(readPhase(sessionDir), 'awaiting-answers');
});

test('TBL-instructions-3: verdict approve at awaiting-verdict -> 200, phase -> finalizing', async () => {
  const project = 'tblinstr3';
  const sessionId = freshSessionId();
  const sessionDir = seedSession(project, '_instructions', sessionId, { session_id: sessionId, project, phase: 'awaiting-verdict', round: 2, prompt: '' });
  const res = await postJson(affordanceUrl('instructions', sessionId, 'awaiting-verdict-verdict'), { project, verdict: 'approve' });
  assert.equal(res.status, 200);
  assert.equal(readPhase(sessionDir), 'finalizing');
});

test('TBL-instructions-4: verdict reject at awaiting-verdict -> 200, phase -> rejected', async () => {
  const project = 'tblinstr4';
  const sessionId = freshSessionId();
  const sessionDir = seedSession(project, '_instructions', sessionId, { session_id: sessionId, project, phase: 'awaiting-verdict', round: 2, prompt: '' });
  const res = await postJson(affordanceUrl('instructions', sessionId, 'awaiting-verdict-verdict'), { project, verdict: 'reject' });
  assert.equal(res.status, 200);
  assert.equal(readPhase(sessionDir), 'rejected');
});

// ===========================================================================
// TABLE TEST — instructions (W6-B9: the 'briefing' question-form row)
// ===========================================================================

test("TBL-instructions-brief-1: question-form (brief) at 'briefing' -> 200, prompt.md written, phase -> interviewing, round -> 1", async () => {
  const project = 'tblinstrbrief1';
  const sessionId = freshSessionId();
  const sessionDir = seedSession(project, '_instructions', sessionId, { session_id: sessionId, project, phase: 'briefing', mode: 'init', round: 1, prompt: '' });
  const res = await postJson(affordanceUrl('instructions', sessionId, 'briefing-question-form'), {
    project,
    answers: [{ question: 'Operator response', answer: 'Use targeted package builds.' }],
  });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  const body = JSON.parse(text) as { ok: boolean; phase: string };
  assert.equal(body.ok, true);
  assert.equal(body.phase, 'interviewing');
  assert.equal(readPhase(sessionDir), 'interviewing');
  assert.ok(existsSync(join(sessionDir, 'prompt.md')), 'prompt.md must be written');
  assert.equal(readFileSync(join(sessionDir, 'prompt.md'), 'utf8'), 'Use targeted package builds.');
  const status = readStatus(sessionDir);
  assert.equal(status.round, 1);
  assert.equal(status.prompt, 'Use targeted package builds.');
  // The briefing checkpoint must NOT touch answers.json — a different
  // on-disk target from the awaiting-answers question-form.
  assert.equal(existsSync(join(sessionDir, 'answers.json')), false);
});

test("TBL-instructions-brief-2: question-form (brief) at 'briefing' with an EMPTY answer -> 200 (an empty brief is a legal 'no notes' submission)", async () => {
  const project = 'tblinstrbrief2';
  const sessionId = freshSessionId();
  const sessionDir = seedSession(project, '_instructions', sessionId, { session_id: sessionId, project, phase: 'briefing', mode: 'init', round: 1, prompt: '' });
  const res = await postJson(affordanceUrl('instructions', sessionId, 'briefing-question-form'), {
    project,
    answers: [{ question: 'Operator response', answer: '' }],
  });
  assert.equal(res.status, 200);
  assert.equal(readPhase(sessionDir), 'interviewing');
  assert.equal(readFileSync(join(sessionDir, 'prompt.md'), 'utf8'), '');
});

test("TBL-instructions-brief-3: question-form (brief) with a malformed answers[] shape -> 400, nothing written, phase unchanged", async () => {
  const project = 'tblinstrbrief3';
  const sessionId = freshSessionId();
  const sessionDir = seedSession(project, '_instructions', sessionId, { session_id: sessionId, project, phase: 'briefing', mode: 'init', round: 1, prompt: '' });
  const res = await postJson(affordanceUrl('instructions', sessionId, 'briefing-question-form'), { project, answers: [{ question: 'Operator response' }] });
  assert.equal(res.status, 400);
  assert.equal(existsSync(join(sessionDir, 'prompt.md')), false);
  assert.equal(readPhase(sessionDir), 'briefing');
});

test("TBL-instructions-brief-4: question-form (brief) with an over-8KB answer -> 400 naming the cap, nothing written", async () => {
  const project = 'tblinstrbrief4';
  const sessionId = freshSessionId();
  const sessionDir = seedSession(project, '_instructions', sessionId, { session_id: sessionId, project, phase: 'briefing', mode: 'init', round: 1, prompt: '' });
  const huge = 'x'.repeat(9 * 1024);
  const res = await postJson(affordanceUrl('instructions', sessionId, 'briefing-question-form'), { project, answers: [{ question: 'Operator response', answer: huge }] });
  const body = (await res.json()) as { error: string };
  assert.equal(res.status, 400);
  assert.match(body.error, /8192|8\s*KB|byte/i);
  assert.equal(existsSync(join(sessionDir, 'prompt.md')), false);
  assert.equal(readPhase(sessionDir), 'briefing');
});

test("PARITY-instructions-brief: generic question-form at 'briefing' and the bespoke /api/instructions/brief route reach the SAME phase + prompt.md content", async () => {
  const project = 'parityinstrbrief';
  const bespokeId = freshSessionId();
  const genericId = freshSessionId();
  const bespokeDir = seedSession(project, '_instructions', bespokeId, { session_id: bespokeId, project, phase: 'briefing', mode: 'init', round: 1, prompt: '' });
  const genericDir = seedSession(project, '_instructions', genericId, { session_id: genericId, project, phase: 'briefing', mode: 'init', round: 1, prompt: '' });

  const bespokeRes = await postJson(`${bridgeUrl}/api/instructions/brief`, { project, sessionId: bespokeId, brief: 'Keep commits conventional.' });
  assert.equal(bespokeRes.status, 200);
  const genericRes = await postJson(affordanceUrl('instructions', genericId, 'briefing-question-form'), {
    project,
    answers: [{ question: 'Operator response', answer: 'Keep commits conventional.' }],
  });
  assert.equal(genericRes.status, 200);

  assert.equal(readPhase(bespokeDir), readPhase(genericDir));
  assert.equal(readPhase(genericDir), 'interviewing');
  assert.equal(readFileSync(join(bespokeDir, 'prompt.md'), 'utf8'), readFileSync(join(genericDir, 'prompt.md'), 'utf8'));
});

// ===========================================================================
// TABLE TEST — demo (question-form: brief; verdict: lock/abandon)
// ===========================================================================

test('TBL-demo-0: question-form (brief) at briefing -> 200, prompt.md written, phase -> generating', async () => {
  const project = 'tbldemo0';
  const sessionId = freshSessionId();
  const sessionDir = seedSession(project, '_demo', sessionId, { session_id: sessionId, project, project_repo_path: '', phase: 'briefing', mode: 'create', iteration: 1, prompt: '' });
  const res = await postJson(affordanceUrl('demo', sessionId, 'briefing-question-form'), {
    project,
    answers: [{ question: 'Operator response', answer: 'Give the CLI capture more contrast.' }],
  });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  assert.equal(readPhase(sessionDir), 'generating');
  assert.equal(readStatus(sessionDir).prompt, 'Give the CLI capture more contrast.');
  assert.ok(existsSync(join(sessionDir, 'prompt.md')), 'prompt.md must be written');
  assert.equal(readFileSync(join(sessionDir, 'prompt.md'), 'utf8'), 'Give the CLI capture more contrast.');
});

test('TBL-demo-0b: question-form with malformed answers[] shape at briefing -> 400, nothing written, phase unchanged', async () => {
  const project = 'tbldemo0b';
  const sessionId = freshSessionId();
  const sessionDir = seedSession(project, '_demo', sessionId, { session_id: sessionId, project, project_repo_path: '', phase: 'briefing', mode: 'create', iteration: 1, prompt: '' });
  const res = await postJson(affordanceUrl('demo', sessionId, 'briefing-question-form'), { project, answers: [{ question: 'Operator response' }] });
  assert.equal(res.status, 400);
  assert.equal(existsSync(join(sessionDir, 'prompt.md')), false);
  assert.equal(readPhase(sessionDir), 'briefing');
});

test('TBL-demo-0c: question-form (brief) with an EMPTY answers[] at briefing -> 400, nothing written', async () => {
  const project = 'tbldemo0c';
  const sessionId = freshSessionId();
  const sessionDir = seedSession(project, '_demo', sessionId, { session_id: sessionId, project, project_repo_path: '', phase: 'briefing', mode: 'create', iteration: 1, prompt: '' });
  const res = await postJson(affordanceUrl('demo', sessionId, 'briefing-question-form'), { project, answers: [] });
  assert.equal(res.status, 400);
  assert.equal(existsSync(join(sessionDir, 'prompt.md')), false);
  assert.equal(readPhase(sessionDir), 'briefing');
});

test('TBL-demo-1: verdict approve at awaiting-review -> 200, phase -> locking (lock)', async () => {
  const project = 'tbldemo1';
  const sessionId = freshSessionId();
  const sessionDir = seedSession(project, '_demo', sessionId, { session_id: sessionId, project, project_repo_path: '', phase: 'awaiting-review', iteration: 1 });
  const res = await postJson(affordanceUrl('demo', sessionId, 'awaiting-review-verdict'), { project, verdict: 'approve', generation: 2 });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  assert.equal(readPhase(sessionDir), 'locking');
  const status = readStatus(sessionDir);
  assert.equal(status.selectedGeneration, 2);
});

test('TBL-demo-2: verdict approve with a bad "generation" (not an integer >= 1) -> 400, nothing mutated', async () => {
  const project = 'tbldemo2';
  const sessionId = freshSessionId();
  const sessionDir = seedSession(project, '_demo', sessionId, { session_id: sessionId, project, project_repo_path: '', phase: 'awaiting-review', iteration: 1 });
  const res = await postJson(affordanceUrl('demo', sessionId, 'awaiting-review-verdict'), { project, verdict: 'approve', generation: 0 });
  assert.equal(res.status, 400);
  assert.equal(readPhase(sessionDir), 'awaiting-review');
});

test('TBL-demo-3: verdict reject at awaiting-review -> 200, phase -> abandoned', async () => {
  const project = 'tbldemo3';
  const sessionId = freshSessionId();
  const sessionDir = seedSession(project, '_demo', sessionId, { session_id: sessionId, project, project_repo_path: '', phase: 'awaiting-review', iteration: 1 });
  const res = await postJson(affordanceUrl('demo', sessionId, 'awaiting-review-verdict'), { project, verdict: 'reject' });
  assert.equal(res.status, 200);
  assert.equal(readPhase(sessionDir), 'abandoned');
});

// ===========================================================================
// TABLE TEST — kb-cleanup (verdict: approve -> apply; reject unsupported)
// ===========================================================================

test('TBL-kbcleanup-1: verdict approve at awaiting-approval -> 200, phase -> applied, runId returned', async () => {
  const kbId = 'w6b4-cleanup-kb-1';
  writeKb(kbId, '{ kind: unique }');
  const project = `${KB_SEEDING_ANCHOR_PREFIX}${kbId}`;
  const sessionId = freshSessionId();
  const sessionDir = seedSession(project, '_kb-cleanup', sessionId, {
    session_id: sessionId, project, phase: 'awaiting-approval', kb_id: kbId, kb_binding: { kind: 'unique' }, findings: [],
  });
  const res = await postJson(affordanceUrl('kb-cleanup', sessionId, 'awaiting-approval-verdict'), { project, verdict: 'approve' });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  const body = JSON.parse(text) as { ok: boolean; runId: string };
  assert.equal(body.ok, true);
  assert.ok(body.runId && body.runId.startsWith(kbId), `expected runId to start with the kbId, got: ${body.runId}`);
  assert.equal(readPhase(sessionDir), 'applied');
});

test('TBL-kbcleanup-2: verdict reject at awaiting-approval -> 200, phase -> rejected (W7-C2: the yaml row now declares the three-way gate; the old approve-only 422 is gone)', async () => {
  const kbId = 'w6b4-cleanup-kb-2';
  writeKb(kbId, '{ kind: unique }');
  const project = `${KB_SEEDING_ANCHOR_PREFIX}${kbId}`;
  const sessionId = freshSessionId();
  const sessionDir = seedSession(project, '_kb-cleanup', sessionId, {
    session_id: sessionId, project, phase: 'awaiting-approval', kb_id: kbId, kb_binding: { kind: 'unique' }, findings: [],
  });
  const res = await postJson(affordanceUrl('kb-cleanup', sessionId, 'awaiting-approval-verdict'), { project, verdict: 'reject' });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  // W6-B6 post-merge review discipline unchanged: the gate is still driven
  // by the SAME derived meta.verdicts the yaml row declares — the row itself
  // now says [approve, revise, reject] (sessions-kinds-23: a plan the
  // operator does not want needs an exit), so reject lands on the terminal
  // `rejected` row rather than 422ing.
  assert.equal(readPhase(sessionDir), 'rejected');
});

test('TBL-kbcleanup-3: verdict approve when status.json carries no string kb_id -> 500, named', async () => {
  const project = 'tblkbcleanup3';
  const sessionId = freshSessionId();
  const sessionDir = seedSession(project, '_kb-cleanup', sessionId, { session_id: sessionId, project, phase: 'awaiting-approval', findings: [] });
  const res = await postJson(affordanceUrl('kb-cleanup', sessionId, 'awaiting-approval-verdict'), { project, verdict: 'approve' });
  const body = (await res.json()) as { error: string };
  assert.equal(res.status, 500);
  assert.match(body.error, /kb_id/);
  assert.equal(readPhase(sessionDir), 'awaiting-approval');
});

// ===========================================================================
// TABLE TEST — authoring (verdict: approve -> finalize; reject unsupported)
// ===========================================================================

test('TBL-authoring-1: verdict approve (kind:skill) at awaiting-review -> 200, delegates to runFinalize (landed + installed), phase -> committed', async () => {
  const project = 'tblauthoring1';
  const sessionId = freshSessionId();
  const sessionDir = join(forgeRoot, 'projects', project, '_authoring', sessionId);
  mkdirSync(join(sessionDir, 'staging'), { recursive: true });
  writeFileSync(join(sessionDir, 'staging', 'SKILL.md'), '---\nname: W6B4 Authored Skill\ndescription: fixture\n---\n\nBody.\n', 'utf8');
  writeFileSync(join(sessionDir, 'status.json'), JSON.stringify({ session_id: sessionId, project, phase: 'awaiting-review' }, null, 2), 'utf8');

  const res = await postJson(affordanceUrl('authoring', sessionId, 'awaiting-review-verdict'), {
    project, verdict: 'approve', kind: 'skill', id: 'w6b4-authored-skill',
  });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  const body = JSON.parse(text) as { ok: boolean; kind: string; id: string };
  assert.equal(body.ok, true);
  assert.equal(body.kind, 'skill');
  assert.equal(readPhase(sessionDir), 'committed');
  assert.ok(existsSync(join(forgeRoot, 'skills', 'w6b4-authored-skill', 'SKILL.md')), 'the finalized skill must be installed for real, via runFinalize');
});

test('TBL-authoring-2: verdict reject at awaiting-review -> 200, phase -> rejected, nothing landed (W7-C2: the yaml row now declares the three-way gate)', async () => {
  const project = 'tblauthoring2';
  const sessionId = freshSessionId();
  const sessionDir = join(forgeRoot, 'projects', project, '_authoring', sessionId);
  mkdirSync(join(sessionDir, 'staging'), { recursive: true });
  writeFileSync(join(sessionDir, 'staging', 'SKILL.md'), '---\nname: Untouched\ndescription: fixture\n---\n\nBody.\n', 'utf8');
  writeFileSync(join(sessionDir, 'status.json'), JSON.stringify({ session_id: sessionId, project, phase: 'awaiting-review' }, null, 2), 'utf8');

  const res = await postJson(affordanceUrl('authoring', sessionId, 'awaiting-review-verdict'), { project, verdict: 'reject' });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  // W6-B6 post-merge review discipline unchanged: the gate reads the SAME
  // derived meta.verdicts the yaml row declares — the row now says
  // [approve, revise, reject] (sessions-kinds-23 / library-24: a drafted
  // package the operator does not want needs an exit). Reject terminates;
  // it must never land anything in either library.
  assert.equal(readPhase(sessionDir), 'rejected');
  assert.equal(existsSync(join(forgeRoot, 'skills', 'untouched')), false);
});

test('TBL-authoring-3: verdict approve with missing "id" -> 400, nothing landed/installed', async () => {
  const project = 'tblauthoring3';
  const sessionId = freshSessionId();
  const sessionDir = join(forgeRoot, 'projects', project, '_authoring', sessionId);
  mkdirSync(join(sessionDir, 'staging'), { recursive: true });
  writeFileSync(join(sessionDir, 'staging', 'SKILL.md'), '---\nname: Untitled\ndescription: fixture\n---\n\nBody.\n', 'utf8');
  writeFileSync(join(sessionDir, 'status.json'), JSON.stringify({ session_id: sessionId, project, phase: 'awaiting-review' }, null, 2), 'utf8');

  const res = await postJson(affordanceUrl('authoring', sessionId, 'awaiting-review-verdict'), { project, verdict: 'approve', kind: 'skill', id: '' });
  assert.equal(res.status, 400);
  assert.equal(readPhase(sessionDir), 'awaiting-review');
});

test('W6-B9 (reviewer finding on W6-B8) TBL-authoring-4: the GENERIC meta.requires check names the missing field — body.id absent entirely (not just empty) still 400s naming "id", nothing landed/installed', async () => {
  const project = 'tblauthoring4';
  const sessionId = freshSessionId();
  const sessionDir = join(forgeRoot, 'projects', project, '_authoring', sessionId);
  mkdirSync(join(sessionDir, 'staging'), { recursive: true });
  writeFileSync(join(sessionDir, 'staging', 'SKILL.md'), '---\nname: Untitled\ndescription: fixture\n---\n\nBody.\n', 'utf8');
  writeFileSync(join(sessionDir, 'status.json'), JSON.stringify({ session_id: sessionId, project, phase: 'awaiting-review' }, null, 2), 'utf8');

  // No "id" key at all in the body — the generic requires check (studio/
  // session-kinds.yaml's authoring row: requires: [id]) must still 400,
  // BEFORE handleAuthoringVerdict is ever reached.
  const res = await postJson(affordanceUrl('authoring', sessionId, 'awaiting-review-verdict'), { project, verdict: 'approve' });
  const text = await res.text();
  assert.equal(res.status, 400, text);
  const body = JSON.parse(text) as { error: string };
  assert.match(body.error, /\bid\b/, `expected the 400 to NAME the missing field "id", got: ${body.error}`);
  assert.equal(readPhase(sessionDir), 'awaiting-review');
});

test('W6-B9 (reviewer finding on W6-B8) TBL-authoring-5: "kind" is DERIVED from the REAL staged files, never trusted from the request body — a body claiming kind:"hook" over a staged SKILL.md still installs as a skill', async () => {
  const project = 'tblauthoring5';
  const sessionId = freshSessionId();
  const sessionDir = join(forgeRoot, 'projects', project, '_authoring', sessionId);
  mkdirSync(join(sessionDir, 'staging'), { recursive: true });
  writeFileSync(join(sessionDir, 'staging', 'SKILL.md'), '---\nname: W6B9 Kind Derivation\ndescription: fixture\n---\n\nBody.\n', 'utf8');
  writeFileSync(join(sessionDir, 'status.json'), JSON.stringify({ session_id: sessionId, project, phase: 'awaiting-review' }, null, 2), 'utf8');

  // The body LIES about kind — the route must ignore it and derive 'skill'
  // from the real staged file instead.
  const res = await postJson(affordanceUrl('authoring', sessionId, 'awaiting-review-verdict'), {
    project, verdict: 'approve', kind: 'hook', id: 'w6b9-kind-derivation',
  });
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as { ok: boolean; kind: string; id: string };
  assert.equal(body.kind, 'skill', `expected the DERIVED kind "skill" (from the real staged SKILL.md), never the body's claimed "hook", got: ${body.kind}`);
  assert.equal(readPhase(sessionDir), 'committed');
  assert.ok(existsSync(join(forgeRoot, 'skills', 'w6b9-kind-derivation', 'SKILL.md')), 'the finalized package must land in the SKILL library, not the hook one');
  assert.equal(existsSync(join(forgeRoot, 'studio', 'hooks', 'w6b9-kind-derivation')), false, 'must NOT land in the hook library — the body\'s claimed kind is ignored entirely');
});

test('W6-B9 (reviewer finding on W6-B8) TBL-authoring-6: neither SKILL.md nor hook.yaml staged yet -> 409, honest ("still drafting"), never a guessed kind', async () => {
  const project = 'tblauthoring6';
  const sessionId = freshSessionId();
  const sessionDir = join(forgeRoot, 'projects', project, '_authoring', sessionId);
  mkdirSync(join(sessionDir, 'staging'), { recursive: true });
  writeFileSync(join(sessionDir, 'staging', 'README.md'), 'not a package marker file', 'utf8');
  writeFileSync(join(sessionDir, 'status.json'), JSON.stringify({ session_id: sessionId, project, phase: 'awaiting-review' }, null, 2), 'utf8');

  const res = await postJson(affordanceUrl('authoring', sessionId, 'awaiting-review-verdict'), { project, verdict: 'approve', id: 'w6b9-unknown-shape' });
  const text = await res.text();
  assert.equal(res.status, 409, text);
  assert.equal(readPhase(sessionDir), 'awaiting-review');
});

// ===========================================================================
// W8-B4 FIX-1 — the adversarial-review repro (S1, blocks merge): drafting a
// template works, but approving it through the REAL operator surface (this
// generic verdict route, POST /api/studio/sessions/authoring/<id>/
// awaiting-review-verdict — the ONLY route the UI's Approve button calls)
// 409'd forever, because `deriveAuthoringPackageKind` only ever recognised
// two of the three drafted-package shapes. The dedicated
// `POST /api/studio/authoring/finalize` route (bridge-studio-authoring.ts)
// already understood `kind:'template'` — WI3's own suite there is green —
// which is exactly why the gap was invisible: nothing exercised the SAME
// claim through the route the operator actually uses.
// ===========================================================================

test('TBL-authoring-7 (W8-B4 FIX-1, reviewer repro): verdict approve with a staged template.md (no SKILL.md/hook.yaml) at awaiting-review -> 200 via the SAME generic verdict route the Approve button calls, never 409; installs into studio/artifact-templates/<id>.md', async () => {
  const project = 'tblauthoring7';
  const sessionId = freshSessionId();
  const sessionDir = join(forgeRoot, 'projects', project, '_authoring', sessionId);
  mkdirSync(join(sessionDir, 'staging'), { recursive: true });
  const draft = matter.stringify('\nDescribe the artifact this template defines.\n', {
    category: 'planning',
    id: 'tblauthoring7-template',
    name: 'TBL Authoring 7 Template',
    kind: 'file',
  });
  writeFileSync(join(sessionDir, 'staging', 'template.md'), draft, 'utf8');
  writeFileSync(join(sessionDir, 'status.json'), JSON.stringify({ session_id: sessionId, project, phase: 'awaiting-review' }, null, 2), 'utf8');

  const res = await postJson(affordanceUrl('authoring', sessionId, 'awaiting-review-verdict'), {
    project, verdict: 'approve', id: 'tblauthoring7-template',
  });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200 (not the reviewer's reproduced 409), got ${res.status}: ${text}`);
  const body = JSON.parse(text) as { ok: boolean; kind: string; id: string };
  assert.equal(body.ok, true);
  assert.equal(body.kind, 'template');
  assert.equal(readPhase(sessionDir), 'committed');
  assert.ok(
    existsSync(join(forgeRoot, 'studio', 'artifact-templates', 'tblauthoring7-template.md')),
    'the finalized template must be installed for real, via runFinalize',
  );
});

test('TBL-authoring-8 (control): verdict approve with a staged hook.yaml + scripts/run.sh (no SKILL.md/template.md) at awaiting-review -> 200 via the same generic verdict route; installs studio/hooks/<id>', async () => {
  const project = 'tblauthoring8';
  const sessionId = freshSessionId();
  const sessionDir = join(forgeRoot, 'projects', project, '_authoring', sessionId);
  mkdirSync(join(sessionDir, 'staging', 'scripts'), { recursive: true });
  writeFileSync(
    join(sessionDir, 'staging', 'hook.yaml'),
    'name: TBL Authoring 8 Hook\ndescription: control fixture\non: PreToolUse\n',
    'utf8',
  );
  writeFileSync(join(sessionDir, 'staging', 'scripts', 'run.sh'), '#!/usr/bin/env bash\necho x\n', 'utf8');
  writeFileSync(join(sessionDir, 'status.json'), JSON.stringify({ session_id: sessionId, project, phase: 'awaiting-review' }, null, 2), 'utf8');

  const res = await postJson(affordanceUrl('authoring', sessionId, 'awaiting-review-verdict'), {
    project, verdict: 'approve', id: 'tblauthoring8-hook',
  });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  const body = JSON.parse(text) as { ok: boolean; kind: string; id: string };
  assert.equal(body.kind, 'hook');
  assert.equal(readPhase(sessionDir), 'committed');
  assert.ok(existsSync(join(forgeRoot, 'studio', 'hooks', 'tblauthoring8-hook', 'hook.yaml')), 'the finalized hook must be installed for real, via runFinalize');
});

test('TBL-authoring-9 (enumeration message): none of the three marker files staged -> 409 whose message NAMES every shape it looked for (SKILL.md, hook.yaml, template.md), not the stale two-item phrasing', async () => {
  const project = 'tblauthoring9';
  const sessionId = freshSessionId();
  const sessionDir = join(forgeRoot, 'projects', project, '_authoring', sessionId);
  mkdirSync(join(sessionDir, 'staging'), { recursive: true });
  writeFileSync(join(sessionDir, 'staging', 'README.md'), 'not a package marker file', 'utf8');
  writeFileSync(join(sessionDir, 'status.json'), JSON.stringify({ session_id: sessionId, project, phase: 'awaiting-review' }, null, 2), 'utf8');

  const res = await postJson(affordanceUrl('authoring', sessionId, 'awaiting-review-verdict'), { project, verdict: 'approve', id: 'w8b4-unknown-shape' });
  const text = await res.text();
  assert.equal(res.status, 409, text);
  const body = JSON.parse(text) as { error: string };
  for (const filename of ['SKILL.md', 'hook.yaml', 'template.md']) {
    assert.ok(body.error.includes(filename), `409 message must name "${filename}" among what it looked for, got: ${body.error}`);
  }
  assert.equal(readPhase(sessionDir), 'awaiting-review');
});

// ===========================================================================
// staged-review / next-turn — display-only, no write handler wired
// ===========================================================================

test('UNHANDLED-1: a valid, currently-derived staged-review affordance -> 501 UnhandledAffordanceBody naming its kind, never a silent 200', async () => {
  const project = 'unhandled1';
  const sessionId = freshSessionId();
  // authoring's "analyzing" phase yields BOTH staged-review (writes:[staging])
  // and next-turn (next:awaiting-review) — real, derived, currently-available
  // affordances with genuinely no write action.
  const sessionDir = join(forgeRoot, 'projects', project, '_authoring', sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, 'status.json'), JSON.stringify({ session_id: sessionId, project, phase: 'analyzing' }, null, 2), 'utf8');

  const res = await postJson(affordanceUrl('authoring', sessionId, 'analyzing-staged-review'), { project });
  const text = await res.text();
  assert.equal(res.status, 501, `expected 501, got ${res.status}: ${text}`);
  const body = JSON.parse(text) as { ok: boolean; kind: string; error: string };
  assert.equal(body.ok, false);
  assert.equal(body.kind, 'staged-review');
  assert.match(body.error, /staged-review/);
});

test('UNHANDLED-2: a valid, currently-derived next-turn affordance -> 501 UnhandledAffordanceBody naming its kind', async () => {
  const project = 'unhandled2';
  const sessionId = freshSessionId();
  const sessionDir = join(forgeRoot, 'projects', project, '_authoring', sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, 'status.json'), JSON.stringify({ session_id: sessionId, project, phase: 'analyzing' }, null, 2), 'utf8');

  const res = await postJson(affordanceUrl('authoring', sessionId, 'analyzing-next-turn'), { project });
  const body = (await res.json()) as { ok: boolean; kind: string };
  assert.equal(res.status, 501);
  assert.equal(body.kind, 'next-turn');
});

// ===========================================================================
// PARITY — the generic verdict write reaches the SAME phase the bespoke
// per-kind route reaches, for an equivalent sibling session
// ===========================================================================

test('PARITY-instructions: generic verdict-approve and the bespoke /api/instructions/verdict route reach the SAME phase', async () => {
  const project = 'parityinstr';
  const bespokeId = freshSessionId();
  const genericId = freshSessionId();
  const bespokeDir = seedSession(project, '_instructions', bespokeId, { session_id: bespokeId, project, phase: 'awaiting-verdict', round: 1, prompt: '' });
  const genericDir = seedSession(project, '_instructions', genericId, { session_id: genericId, project, phase: 'awaiting-verdict', round: 1, prompt: '' });

  const bespokeRes = await postJson(`${bridgeUrl}/api/instructions/verdict`, { project, sessionId: bespokeId, kind: 'approve' });
  assert.equal(bespokeRes.status, 200);
  const genericRes = await postJson(affordanceUrl('instructions', genericId, 'awaiting-verdict-verdict'), { project, verdict: 'approve' });
  assert.equal(genericRes.status, 200);

  assert.equal(readPhase(bespokeDir), readPhase(genericDir));
  assert.equal(readPhase(genericDir), 'finalizing');
});

test('PARITY-demo-brief: generic question-form (brief) and the bespoke /api/demo-builder/brief route reach the SAME phase', async () => {
  const project = 'paritydemobrief';
  const bespokeId = freshSessionId();
  const genericId = freshSessionId();
  const bespokeDir = seedSession(project, '_demo', bespokeId, { session_id: bespokeId, project, project_repo_path: '', phase: 'briefing', mode: 'create', iteration: 1, prompt: '' });
  const genericDir = seedSession(project, '_demo', genericId, { session_id: genericId, project, project_repo_path: '', phase: 'briefing', mode: 'create', iteration: 1, prompt: '' });

  const bespokeRes = await postJson(`${bridgeUrl}/api/demo-builder/brief`, { project, sessionId: bespokeId, brief: 'match the bespoke route' });
  assert.equal(bespokeRes.status, 200);
  const genericRes = await postJson(affordanceUrl('demo', genericId, 'briefing-question-form'), {
    project,
    answers: [{ question: 'Operator response', answer: 'match the bespoke route' }],
  });
  assert.equal(genericRes.status, 200, `generic question-form expected 200, got ${genericRes.status}: ${await genericRes.text()}`);

  assert.equal(readPhase(bespokeDir), readPhase(genericDir));
  assert.equal(readPhase(genericDir), 'generating');
  assert.equal(readStatus(bespokeDir).prompt, readStatus(genericDir).prompt);
});

test('PARITY-demo: generic verdict-approve and the bespoke /api/demo-builder/lock route reach the SAME phase', async () => {
  const project = 'paritydemo';
  const bespokeId = freshSessionId();
  const genericId = freshSessionId();
  const bespokeDir = seedSession(project, '_demo', bespokeId, { session_id: bespokeId, project, project_repo_path: '', phase: 'awaiting-review', iteration: 1 });
  const genericDir = seedSession(project, '_demo', genericId, { session_id: genericId, project, project_repo_path: '', phase: 'awaiting-review', iteration: 1 });

  const bespokeRes = await postJson(`${bridgeUrl}/api/demo-builder/lock`, { project, sessionId: bespokeId });
  assert.equal(bespokeRes.status, 200);
  const genericRes = await postJson(affordanceUrl('demo', genericId, 'awaiting-review-verdict'), { project, verdict: 'approve' });
  assert.equal(genericRes.status, 200);

  assert.equal(readPhase(bespokeDir), readPhase(genericDir));
  assert.equal(readPhase(genericDir), 'locking');
});

// ===========================================================================
// noop-phase discipline — an approve on a noop row advances EXACTLY like the
// bespoke route did; nothing else ever advances it
// ===========================================================================

test('NOOP-1: a session at a noop phase (awaiting-approval) stays there under repeated GETs — the phase only ever advances via the accepted verdict write', async () => {
  const kbId = 'w6b4-noop-kb';
  writeKb(kbId, '{ kind: unique }');
  const project = `${KB_SEEDING_ANCHOR_PREFIX}${kbId}`;
  const sessionId = freshSessionId();
  const sessionDir = seedSession(project, '_kb-cleanup', sessionId, { session_id: sessionId, project, phase: 'awaiting-approval', kb_id: kbId, kb_binding: { kind: 'unique' }, findings: [] });

  for (let i = 0; i < 3; i++) {
    const getRes = await fetch(`${bridgeUrl}/api/studio/sessions/kb-cleanup/${sessionId}?project=${encodeURIComponent(project)}`);
    assert.equal(getRes.status, 200);
    assert.equal(readPhase(sessionDir), 'awaiting-approval', 'a read-only GET must never advance a noop phase');
  }

  const res = await postJson(affordanceUrl('kb-cleanup', sessionId, 'awaiting-approval-verdict'), { project, verdict: 'approve' });
  assert.equal(res.status, 200);
  assert.equal(readPhase(sessionDir), 'applied', 'only the accepted verdict write advances a noop phase');
});

// ===========================================================================
// ADVERSARIAL-REVIEW ROUND (W6-B4) — live symlink escape, concurrency race,
// answers[] hardening cap, and a structural sink-freedom pin.
// ===========================================================================

test('SEC-SYMLINK: the session dir itself is a SYMLINK (not a real directory) pointing at a victim session outside the project -> 404, no path/content echoed, victim byte-unchanged (no write, no spawn)', async () => {
  const project = 'symlinkescapeproj';
  const sessionId = freshSessionId();
  const SECRET = 'W6B4-SYMLINK-ESCAPE-SECRET-9911';

  // The victim: a REAL session, entirely outside this project's own
  // containment root, carrying a secret in a field this route could only
  // ever echo if the guard were bypassed.
  const victimDir = join(forgeRoot, '_symlink-escape-outside', sessionId);
  mkdirSync(victimDir, { recursive: true });
  writeFileSync(
    join(victimDir, 'status.json'),
    JSON.stringify({ session_id: sessionId, project: 'victim-project', phase: 'awaiting-verdict', round: 1, prompt: SECRET }, null, 2),
    'utf8',
  );

  // The attack: `<projectsRoot>/<project>/_instructions/<sessionId>` is
  // ITSELF a symlink to the victim dir — the exact AT-47 shape
  // cli/bridge-studio-sessions.ts's own header documents (a symlink whose
  // OWN path is safely inside the requested parent but which resolves to a
  // DIFFERENT session entirely). `resolveGuardedPath`'s per-segment identity
  // walk must catch this at the `sessionId` segment.
  const kindDir = join(forgeRoot, 'projects', project, '_instructions');
  mkdirSync(kindDir, { recursive: true });
  symlinkSync(victimDir, join(kindDir, sessionId));

  const res = await postJson(affordanceUrl('instructions', sessionId, 'awaiting-verdict-verdict'), { project, verdict: 'approve' });
  const text = await res.text();
  assert.equal(res.status, 404, `expected 404 for a symlinked session dir, got ${res.status}: ${text}`);
  assert.doesNotMatch(text, new RegExp(SECRET), 'response must never leak content read through an escaping symlink');
  assert.doesNotMatch(text, /_symlink-escape-outside/, 'response must never echo the escaped filesystem path');

  // No write: the victim's OWN status.json — read/written THROUGH the
  // symlink target if the guard were bypassed — must be byte-unchanged. A
  // bypassed guard would have advanced its phase to "finalizing"/"rejected".
  const victimStatus = JSON.parse(readFileSync(join(victimDir, 'status.json'), 'utf8')) as { phase: string; prompt: string };
  assert.equal(victimStatus.phase, 'awaiting-verdict', 'a blocked symlink escape must never write through to the victim session');
  assert.equal(victimStatus.prompt, SECRET, 'the victim session content must be byte-unchanged');
});

test('RACE-1 (W6-B4 adversarial-review fix): two CONCURRENT verdict-approve POSTs against the SAME kb-cleanup session -> exactly one 200 + one 409, exactly one _brainfix-<runId> log dir, phase ends at "applied" (never stuck at "applying")', async () => {
  const kbId = 'w6b4-race-kb';
  writeKb(kbId, '{ kind: unique }');
  const project = `${KB_SEEDING_ANCHOR_PREFIX}${kbId}`;
  const sessionId = freshSessionId();
  const sessionDir = seedSession(project, '_kb-cleanup', sessionId, {
    session_id: sessionId, project, phase: 'awaiting-approval', kb_id: kbId, kb_binding: { kind: 'unique' }, findings: [],
  });

  const [resA, resB] = await Promise.all([
    postJson(affordanceUrl('kb-cleanup', sessionId, 'awaiting-approval-verdict'), { project, verdict: 'approve' }),
    postJson(affordanceUrl('kb-cleanup', sessionId, 'awaiting-approval-verdict'), { project, verdict: 'approve' }),
  ]);
  const [textA, textB] = await Promise.all([resA.text(), resB.text()]);
  const statuses = [resA.status, resB.status].sort((a, b) => a - b);
  assert.deepEqual(
    statuses,
    [200, 409],
    `expected exactly ONE 200 and ONE 409 for two concurrent approves against the SAME session, got ${JSON.stringify([resA.status, resB.status])} (bodies: ${textA} / ${textB})`,
  );
  assert.equal(readPhase(sessionDir), 'applied', 'the session must end at "applied" — never left stuck at the transient "applying" claim phase');

  // Exactly ONE drain actually ran — the pre-fix repro produced two
  // independent runBrainConsolidateNow runs (two distinct runIds, two
  // _brainfix-<runId> log dirs) for what should be ONE approved action.
  const logsDir = join(forgeRoot, '_logs');
  const brainfixDirs = existsSync(logsDir)
    ? readdirSync(logsDir).filter((d) => d.startsWith(`_brainfix-${kbId}-consolidate-`))
    : [];
  assert.equal(
    brainfixDirs.length,
    1,
    `expected exactly ONE _brainfix-<runId> log dir for two concurrent approves against the same session, got ${brainfixDirs.length}: ${JSON.stringify(brainfixDirs)}`,
  );
});

test('HARDEN-1: answers[] with more than 64 entries -> 400 naming the cap, nothing written', async () => {
  const project = 'hardenanswers1';
  const sessionId = freshSessionId();
  const sessionDir = seedSession(project, '_instructions', sessionId, { session_id: sessionId, project, phase: 'awaiting-answers', round: 1, prompt: '' });
  const answers = Array.from({ length: 65 }, (_, i) => ({ question: `Q${i}?`, answer: 'A.' }));
  const res = await postJson(affordanceUrl('instructions', sessionId, 'awaiting-answers-question-form'), { project, answers });
  const body = (await res.json()) as { error: string };
  assert.equal(res.status, 400);
  assert.match(body.error, /64/);
  assert.equal(existsSync(join(sessionDir, 'answers.json')), false);
  assert.equal(readPhase(sessionDir), 'awaiting-answers');
});

test('HARDEN-2: an answers[] entry with a question/answer over 8KB -> 400 naming the cap, nothing written', async () => {
  const project = 'hardenanswers2';
  const sessionId = freshSessionId();
  const sessionDir = seedSession(project, '_instructions', sessionId, { session_id: sessionId, project, phase: 'awaiting-answers', round: 1, prompt: '' });
  const huge = 'x'.repeat(9 * 1024);
  const res = await postJson(affordanceUrl('instructions', sessionId, 'awaiting-answers-question-form'), {
    project,
    answers: [{ question: 'Q?', answer: huge }],
  });
  const body = (await res.json()) as { error: string };
  assert.equal(res.status, 400);
  assert.match(body.error, /8192|8\s*KB|byte/i);
  assert.equal(existsSync(join(sessionDir, 'answers.json')), false);
  assert.equal(readPhase(sessionDir), 'awaiting-answers');
});

test('HARDEN-3: exactly at the caps (64 entries, 8KB fields) still succeeds — the cap must not false-reject a legitimate boundary value', async () => {
  const project = 'hardenanswers3';
  const sessionId = freshSessionId();
  const sessionDir = seedSession(project, '_instructions', sessionId, { session_id: sessionId, project, phase: 'awaiting-answers', round: 1, prompt: '' });
  const exactly8kb = 'x'.repeat(8 * 1024);
  const answers = Array.from({ length: 64 }, (_, i) => ({ question: `Q${i}?`, answer: i === 0 ? exactly8kb : 'A.' }));
  const res = await postJson(affordanceUrl('instructions', sessionId, 'awaiting-answers-question-form'), { project, answers });
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200 at the exact cap boundary, got ${res.status}: ${text}`);
  assert.equal(readPhase(sessionDir), 'interviewing');
});

// ===========================================================================
// W6-B9 reviewer fix — every spawn-triggering handler in this file
// (answer/brief/verdict-instructions/verdict-demo) spreads
// dryBridgeAgentTurnMarker into its 200 body, exactly like every bespoke
// per-kind spawn route already does. This whole file runs under
// FORGE_DRY_BRIDGE=1 (see `before()`, above), so every 200 in every OTHER
// test in this file already implicitly carries this marker too — these
// tests just assert it explicitly, once per handler.
// ===========================================================================

test('DRYBRIDGE-1: question-form (answer) at awaiting-answers — the 200 body carries dryBridge:{skipped:["agent-turn"]}', async () => {
  const project = 'drybridge1';
  const sessionId = freshSessionId();
  seedSession(project, '_instructions', sessionId, { session_id: sessionId, project, phase: 'awaiting-answers', round: 1, prompt: '' });
  const res = await postJson(affordanceUrl('instructions', sessionId, 'awaiting-answers-question-form'), {
    project,
    answers: [{ question: 'Q?', answer: 'A.' }],
  });
  const body = (await res.json()) as { dryBridge?: { skipped: string[] } };
  assert.deepEqual(body.dryBridge, { skipped: ['agent-turn'] });
});

test('DRYBRIDGE-2: question-form (brief) at briefing — the 200 body carries dryBridge:{skipped:["agent-turn"]}', async () => {
  const project = 'drybridge2';
  const sessionId = freshSessionId();
  seedSession(project, '_instructions', sessionId, { session_id: sessionId, project, phase: 'briefing', mode: 'init', round: 1, prompt: '' });
  const res = await postJson(affordanceUrl('instructions', sessionId, 'briefing-question-form'), {
    project,
    answers: [{ question: 'Operator response', answer: 'notes' }],
  });
  const body = (await res.json()) as { dryBridge?: { skipped: string[] } };
  assert.deepEqual(body.dryBridge, { skipped: ['agent-turn'] });
});

test('DRYBRIDGE-3: verdict approve at awaiting-verdict (instructions) — the 200 body carries dryBridge:{skipped:["agent-turn"]}', async () => {
  const project = 'drybridge3';
  const sessionId = freshSessionId();
  seedSession(project, '_instructions', sessionId, { session_id: sessionId, project, phase: 'awaiting-verdict', round: 1, prompt: '' });
  const res = await postJson(affordanceUrl('instructions', sessionId, 'awaiting-verdict-verdict'), { project, verdict: 'approve' });
  const body = (await res.json()) as { dryBridge?: { skipped: string[] } };
  assert.deepEqual(body.dryBridge, { skipped: ['agent-turn'] });
});

test('DRYBRIDGE-4: verdict approve at awaiting-review (demo, lock path) — the 200 body carries dryBridge:{skipped:["agent-turn"]}', async () => {
  const project = 'drybridge4';
  const sessionId = freshSessionId();
  seedSession(project, '_demo', sessionId, { session_id: sessionId, project, project_repo_path: '', phase: 'awaiting-review', iteration: 1 });
  const res = await postJson(affordanceUrl('demo', sessionId, 'awaiting-review-verdict'), { project, verdict: 'approve' });
  const body = (await res.json()) as { dryBridge?: { skipped: string[] } };
  assert.deepEqual(body.dryBridge, { skipped: ['agent-turn'] });
});

test('DRYBRIDGE-5: verdict reject at awaiting-review (demo, abandon path) — the 200 body carries dryBridge:{skipped:["agent-turn"]}', async () => {
  const project = 'drybridge5';
  const sessionId = freshSessionId();
  seedSession(project, '_demo', sessionId, { session_id: sessionId, project, project_repo_path: '', phase: 'awaiting-review', iteration: 1 });
  const res = await postJson(affordanceUrl('demo', sessionId, 'awaiting-review-verdict'), { project, verdict: 'reject' });
  const body = (await res.json()) as { dryBridge?: { skipped: string[] } };
  assert.deepEqual(body.dryBridge, { skipped: ['agent-turn'] });
});

