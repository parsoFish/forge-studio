/**
 * Tests for the R4-16 demo-builder generation-gallery bridge routes:
 *
 *   - POST /api/demo-builder/lock gains an optional `generation` field,
 *     structurally validated (integer ≥ 1) BEFORE any write happens.
 *   - NEW GET /api/demo-builder/generation/<project>/<sid>/<n>/<filename>
 *     serves one snapshot file out of `<sessionDir>/generations/<n>/`.
 *
 * TEST-FIRST PIN: neither exists at branch base. `POST /lock` today never
 * reads `body.generation` at all (it unconditionally flips phase→'locking'
 * and 200s); the GET route doesn't exist, so every request to it falls
 * through to the generic unmatched-route handler (`res.writeHead(404);
 * res.end();` — cli/ui-bridge.ts:1298 — an EMPTY body, no JSON). That empty
 * body is exploited deliberately below: every rejection-probe test calls
 * `res.json()` on the response, which THROWS on today's empty 404 body —
 * this is what makes "malformed input → 400/404" tests genuinely RED right
 * now instead of coincidentally green because the route doesn't exist yet.
 *
 * Harness mirrors cli/ui-bridge-instructions.test.ts's pattern exactly (a
 * real bridge via `startBridge`, no SDK spawn — `FORGE_ARCHITECT_NO_SPAWN=1`).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request as httpRequest } from 'node:http';

import { startBridge } from './ui-bridge.ts';

process.env.FORGE_ARCHITECT_NO_SPAWN = '1';

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;

function repoDir(): string {
  return join(forgeRoot, 'projects', 'demo');
}

function demoSessionDirFor(sid: string): string {
  return join(repoDir(), '_demo', sid);
}

async function post(path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

function readDemoStatusRaw(sid: string): string {
  return readFileSync(join(demoSessionDirFor(sid), 'status.json'), 'utf8');
}

function readDemoStatus(sid: string): Record<string, unknown> {
  return JSON.parse(readDemoStatusRaw(sid));
}

/** Starts a real demo-builder session via the real /start route (so
 *  status.json + project_repo_path are exactly what a real session carries),
 *  then advances its phase directly via fs (mirrors the sibling file's plain
 *  fs read/patch idiom — no runner import needed for these HTTP-level tests). */
async function startSession(): Promise<string> {
  const { json } = await post('/api/demo-builder/start', { project: 'demo' });
  return json.sessionId as string;
}

function patchDemoStatus(sid: string, patch: Record<string, unknown>): void {
  const dir = demoSessionDirFor(sid);
  const current = readDemoStatus(sid);
  writeFileSync(join(dir, 'status.json'), JSON.stringify({ ...current, ...patch }, null, 2));
}

/** Writes one `generations/<n>/` snapshot fixture directly onto a session's
 *  on-disk dir (the R4-16 shape demo-builder-runner.ts's runGenerateStep
 *  produces) — bypasses the real agent turn entirely, matching this file's
 *  scope (bridge routes only, not the runner). */
function writeGenerationFixture(sid: string, n: number | string, files: Record<string, string>): void {
  const dir = join(demoSessionDirFor(sid), 'generations', String(n));
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body, 'utf8');
}

/** Sends a raw HTTP GET with the EXACT path bytes given — no WHATWG URL /
 *  undici `fetch()` involved, so client-side dot-segment normalisation never
 *  runs (Node's low-level `http.request` puts the `path` option straight onto
 *  the request line, unmodified). This is the ONLY way to actually deliver a
 *  literal `%2E%2E` percent-encoded traversal segment to the server: the
 *  WHATWG URL spec treats `%2e`/`%2E` as equivalent to a literal `.` for
 *  dot-segment detection specifically to close this exact bypass, so a real
 *  `fetch()` call collapses it away before the request is ever sent (the same
 *  class of problem documented in cli/bridge-studio-sessions.test.ts's header,
 *  which resorts to direct handler invocation instead — unavailable here
 *  because `handleDemoBuilder` is not exported from ui-bridge.ts). */
function rawGet(rawPath: string): Promise<{ status: number; text: string }> {
  return new Promise((resolvePromise, reject) => {
    const u = new URL(url);
    const req = httpRequest({ hostname: u.hostname, port: u.port, path: rawPath, method: 'GET' }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString('utf8'); });
      res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, text: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-demo-gen-'));
  mkdirSync(repoDir(), { recursive: true });
  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

// ===========================================================================
// POST /api/demo-builder/lock — generation validation (mandatory adversarial
// AT — bridge lock validation)
// ===========================================================================

// R4-16 AT-24 (also covers what was separately AT-26): a well-formed
// generation is accepted AND actually persisted to status.json as
// selectedGeneration — kills an implementation that validates the shape but
// never writes it (both today's unmodified code AND a "validates but never
// persists" implementation would 200 here; only the selectedGeneration
// assertion tells them apart, which is the genuinely-red part). The second
// half proves the sibling contract: omitting "generation" entirely must
// never invent a selectedGeneration key — kills an implementation that
// defaults it (e.g. to null or 0) instead of leaving it truly absent.
test('R4-16 AT-24: POST /lock persists a well-formed "generation" to status.json as selectedGeneration; omitting it leaves NO selectedGeneration key at all', async () => {
  const sid1 = await startSession();
  patchDemoStatus(sid1, { phase: 'awaiting-review' });
  writeGenerationFixture(sid1, 1, { 'DEMO.html': '<html>g1</html>', 'SKILL.md': '# s1' });
  const { status, json } = await post('/api/demo-builder/lock', { project: 'demo', sessionId: sid1, generation: 1 });
  assert.equal(status, 200, `a well-formed generation must be accepted, got ${status}: ${JSON.stringify(json)}`);
  assert.equal(
    readDemoStatus(sid1).selectedGeneration,
    1,
    'a well-formed "generation" must be persisted to status.json as selectedGeneration — today\'s code never writes this field at all',
  );

  const sid2 = await startSession();
  patchDemoStatus(sid2, { phase: 'awaiting-review' });
  writeGenerationFixture(sid2, 1, { 'DEMO.html': '<html>g1</html>', 'SKILL.md': '# s1' });
  const { status: status2 } = await post('/api/demo-builder/lock', { project: 'demo', sessionId: sid2 });
  assert.equal(status2, 200);
  assert.ok(!('selectedGeneration' in readDemoStatus(sid2)), 'omitting "generation" must never invent a selectedGeneration on status.json');
});

for (const bad of [0, -1, 1.5, '1']) {
  test(`R4-16 AT-25: POST /lock with generation=${JSON.stringify(bad)} → 400, naming the offending value, and status.json is NOT mutated`, async () => {
    const sid = await startSession();
    patchDemoStatus(sid, { phase: 'awaiting-review' });
    const before_ = readDemoStatusRaw(sid);

    const { status, json } = await post('/api/demo-builder/lock', { project: 'demo', sessionId: sid, generation: bad });
    assert.equal(status, 400, `generation=${JSON.stringify(bad)} must be rejected with 400, got ${status}: ${JSON.stringify(json)}`);
    assert.ok(String(json.error ?? '').toLowerCase().includes('generation'), `error must reference "generation", got: ${JSON.stringify(json)}`);
    assert.ok(String(json.error ?? '').includes(JSON.stringify(bad)), `error must name the offending value ${JSON.stringify(bad)}, got: ${JSON.stringify(json)}`);

    const after_ = readDemoStatusRaw(sid);
    assert.equal(after_, before_, 'status.json must be byte-identical after a rejected lock request — never mutated on a rejected request');
    assert.equal(JSON.parse(after_).phase, 'awaiting-review', 'phase must NOT flip to "locking" on a rejected request');
  });
}

// ===========================================================================
// GET /api/demo-builder/generation/<project>/<sid>/<n>/<filename> (mandatory
// adversarial AT — bridge serve route)
// ===========================================================================

test('R4-16 AT-27: a real snapshot serves its EXACT bytes with the correct content-type, for both an .html and a .md member', async () => {
  const sid = await startSession();
  writeGenerationFixture(sid, 1, {
    'DEMO.html': '<html><body>REAL-GENERATION-BYTES-4471</body></html>',
    'SKILL.md': '# REAL-SKILL-BYTES-4471',
  });

  const htmlRes = await fetch(`${url}/api/demo-builder/generation/demo/${encodeURIComponent(sid)}/1/DEMO.html`);
  assert.equal(htmlRes.status, 200, `expected 200 for a real snapshot file, got ${htmlRes.status}`);
  assert.equal(await htmlRes.text(), '<html><body>REAL-GENERATION-BYTES-4471</body></html>');
  assert.match(htmlRes.headers.get('content-type') ?? '', /text\/html/);

  const mdRes = await fetch(`${url}/api/demo-builder/generation/demo/${encodeURIComponent(sid)}/1/SKILL.md`);
  assert.equal(mdRes.status, 200);
  assert.equal(await mdRes.text(), '# REAL-SKILL-BYTES-4471');
});

test('R4-16 AT-28: n = "1x" (fails ^[0-9]{1,6}$) → 400, naming the offending value', async () => {
  const sid = await startSession();
  writeGenerationFixture(sid, 1, { 'DEMO.html': '<html/>' });
  const res = await fetch(`${url}/api/demo-builder/generation/demo/${encodeURIComponent(sid)}/1x/DEMO.html`);
  assert.equal(res.status, 400, `expected 400 for a malformed "n", got ${res.status}`);
  const body = await res.json() as Record<string, unknown>; // throws on today's empty 404 fallback body — the RED
  assert.ok(String(body.error ?? '').includes('1x'), `error must name the offending "n" value, got: ${JSON.stringify(body)}`);
});

test('R4-16 AT-29: n with more than 6 digits (fails the length cap) → 400, naming the offending value', async () => {
  const sid = await startSession();
  writeGenerationFixture(sid, 1, { 'DEMO.html': '<html/>' });
  const overLong = '1234567';
  const res = await fetch(`${url}/api/demo-builder/generation/demo/${encodeURIComponent(sid)}/${overLong}/DEMO.html`);
  assert.equal(res.status, 400, `expected 400 for an over-length "n", got ${res.status}`);
  const body = await res.json() as Record<string, unknown>;
  assert.ok(String(body.error ?? '').includes(overLong), `error must name the offending "n" value, got: ${JSON.stringify(body)}`);
});

test('R4-16 AT-30: filename containing an escape attempt ("../../../etc/passwd", sent as one opaque encoded segment so the client never collapses it) → 400, naming the offending value, and no outside content in the body', async () => {
  const sid = await startSession();
  writeGenerationFixture(sid, 1, { 'DEMO.html': '<html/>' });
  const maliciousFilename = '../../../etc/passwd';
  const res = await fetch(`${url}/api/demo-builder/generation/demo/${encodeURIComponent(sid)}/1/${encodeURIComponent(maliciousFilename)}`);
  assert.equal(res.status, 400, `a filename containing "/" must fail the ^[A-Za-z0-9._-]+$ regex and be rejected with 400, got ${res.status}`);
  const body = await res.json() as Record<string, unknown>;
  assert.ok(String(body.error ?? '').includes(maliciousFilename), `error must name the offending filename, got: ${JSON.stringify(body)}`);
  assert.ok(!JSON.stringify(body).includes('root:'), 'no outside file content (e.g. /etc/passwd\'s real content) must ever appear in the body');
});

test('R4-16 AT-31: filename containing a nested escape attempt ("meta.json/../../status.json") → 400, naming the offending value', async () => {
  const sid = await startSession();
  writeGenerationFixture(sid, 1, { 'DEMO.html': '<html/>' });
  const maliciousFilename = 'meta.json/../../status.json';
  const res = await fetch(`${url}/api/demo-builder/generation/demo/${encodeURIComponent(sid)}/1/${encodeURIComponent(maliciousFilename)}`);
  assert.equal(res.status, 400, `a filename containing "/" must fail the ^[A-Za-z0-9._-]+$ regex and be rejected with 400, got ${res.status}`);
  const body = await res.json() as Record<string, unknown>;
  assert.ok(String(body.error ?? '').includes(maliciousFilename), `error must name the offending filename, got: ${JSON.stringify(body)}`);
});

test('R4-16 AT-32: a well-formed n/filename naming a generation that does not exist on disk → 404', async () => {
  const sid = await startSession();
  writeGenerationFixture(sid, 1, { 'DEMO.html': '<html/>' });
  const res = await fetch(`${url}/api/demo-builder/generation/demo/${encodeURIComponent(sid)}/42/DEMO.html`);
  assert.equal(res.status, 404, `a well-formed but nonexistent generation must 404, got ${res.status}`);
  const body = await res.json() as Record<string, unknown>; // throws on today's empty body — the RED
  assert.ok(body.error, `404 must carry a JSON error body, got: ${JSON.stringify(body)}`);
});

test('R4-16 AT-33: a well-formed generation dir but a nonexistent filename within it → 404', async () => {
  const sid = await startSession();
  writeGenerationFixture(sid, 1, { 'DEMO.html': '<html/>' });
  const res = await fetch(`${url}/api/demo-builder/generation/demo/${encodeURIComponent(sid)}/1/nope.html`);
  assert.equal(res.status, 404, `a nonexistent filename inside a real generation must 404, got ${res.status}`);
  const body = await res.json() as Record<string, unknown>;
  assert.ok(body.error, `404 must carry a JSON error body, got: ${JSON.stringify(body)}`);
});

test('R4-16 AT-34 (mandatory adversarial AT — proves realpath containment, not a lexical startsWith check): a symlinked file inside a real generation dir, pointing OUTSIDE the session dir → 404, and the secret content never appears in the body', async () => {
  const sid = await startSession();
  const outsideDir = mkdtempSync(join(tmpdir(), 'bridge-demo-gen-outside-'));
  const SECRET_MARKER = 'TOP-SECRET-GENERATION-SNAPSHOT-MARKER-7731';
  const secretPath = join(outsideDir, 'secret.html');
  writeFileSync(secretPath, `<html>${SECRET_MARKER}</html>`, 'utf8');
  try {
    writeGenerationFixture(sid, 1, { 'DEMO.html': '<html>real, non-escaped content</html>' });
    // The symlink's OWN path is inside the generation dir — a lexical
    // `startsWith(base)` check on the JOINED path string would pass; only
    // realpathSync (safeReadFileInSession's choke point) reveals the escape.
    symlinkSync(secretPath, join(demoSessionDirFor(sid), 'generations', '1', 'evil.html'));

    const res = await fetch(`${url}/api/demo-builder/generation/demo/${encodeURIComponent(sid)}/1/evil.html`);
    assert.equal(res.status, 404, `a symlink escaping the session dir must be treated as absent (404), got ${res.status}`);
    const body = await res.json() as Record<string, unknown>; // throws on today's empty body — the RED
    const serialized = JSON.stringify(body);
    assert.ok(!serialized.includes(SECRET_MARKER), 'the escaped file\'s content must never appear in the response body');

    // Positive control: the REAL, non-symlinked sibling in the SAME
    // generation still serves correctly — proves the guard discriminates.
    const realRes = await fetch(`${url}/api/demo-builder/generation/demo/${encodeURIComponent(sid)}/1/DEMO.html`);
    assert.equal(realRes.status, 200);
    assert.equal(await realRes.text(), '<html>real, non-escaped content</html>');
  } finally {
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('R4-16 AT-35: an unknown project/sessionId pair on the generation route → 404 (never a crash, never leaks a filesystem error)', async () => {
  const res = await fetch(`${url}/api/demo-builder/generation/demo/2099-01-01T00-00-00/1/DEMO.html`);
  assert.equal(res.status, 404, `expected 404 for a nonexistent session, got ${res.status}`);
  const body = await res.json() as Record<string, unknown>;
  assert.ok(body.error, `404 must carry a JSON error body, got: ${JSON.stringify(body)}`);
});

// ===========================================================================
// R4-16 PIN 2 — round-2 adversarial findings against HEAD b1f59575, where the
// R4-16 backend (a374805c) and forge-ui (b1f59575) implementations already
// landed. `n`/`filename` ARE guarded (GENERATION_NUMBER_RE/GENERATION_FILENAME_RE
// + safeReadFileInSession's realpath), but `project`/`sessionId` are RAW
// decodeURIComponent output fed straight into demoSessionDir(...) with NO
// SLUG_RE/SAFE_ID_RE/length-cap validation at all — the exact declared-data-
// fails-open shape this campaign keeps finding, just on a sibling field.
// ===========================================================================

// Finding A (BLOCKER) — reproduced live: with project=".." and
// sessionId="../OUTSIDE" (both whole-segment ".."-shaped, only reachable past
// client-side URL normalisation via a raw request — see rawGet's header),
// demoSessionDir(join(projectsRoot, '..'), '../OUTSIDE') resolves to
// <forgeRoot>/OUTSIDE — an attacker-chosen directory ENTIRELY of the
// attacker's choosing, which safeReadFileInSession then trivially "contains"
// (it only proves containment relative to whatever sessionDir it's handed).
// Kills the current implementation, which returns 200 with the outside
// file's real content for this exact request.
test('R4-16 AT-36 (BLOCKER, live exploit reproduction): project=".." + sessionId="../OUTSIDE" escapes projectsRoot entirely — must be 400, and the outside marker must never appear in the body', async () => {
  // demoSessionDir(join(projectsRoot, '..'), '../OUTSIDE') === join(forgeRoot, '_demo', '../OUTSIDE') === join(forgeRoot, 'OUTSIDE').
  const OUTSIDE_MARKER = 'TOP-SECRET-PROJECT-SESSIONID-ESCAPE-MARKER-3390';
  const outsideGenDir = join(forgeRoot, 'OUTSIDE', 'generations', '1');
  mkdirSync(outsideGenDir, { recursive: true });
  writeFileSync(join(outsideGenDir, 'secret.html'), `<html>${OUTSIDE_MARKER}</html>`, 'utf8');
  try {
    // %2E%2E / %2E%2E%2FOUTSIDE — literal percent-encoded dots. A real
    // fetch() would collapse the whole-segment ".." variant client-side
    // before the request is ever sent (WHATWG URL treats %2e as a literal
    // dot for exactly this detection) — rawGet bypasses that entirely.
    const res = await rawGet('/api/demo-builder/generation/%2E%2E/%2E%2E%2FOUTSIDE/1/secret.html');
    assert.equal(res.status, 400, `project/sessionId escaping projectsRoot must be rejected with 400, got ${res.status}: ${res.text}`);
    assert.ok(!res.text.includes(OUTSIDE_MARKER), `the outside file's content must NEVER appear in the body, got: ${res.text}`);
  } finally {
    rmSync(join(forgeRoot, 'OUTSIDE'), { recursive: true, force: true });
  }
});

test('R4-16 AT-37: project failing SLUG_RE (e.g. "Bad_Project", uppercase + underscore) → 400, naming the offending value', async () => {
  const sid = await startSession();
  writeGenerationFixture(sid, 1, { 'DEMO.html': '<html/>' });
  const res = await fetch(`${url}/api/demo-builder/generation/${encodeURIComponent('Bad_Project')}/${encodeURIComponent(sid)}/1/DEMO.html`);
  assert.equal(res.status, 400, `an invalid-slug project must be rejected with 400, got ${res.status}`);
  const body = await res.json() as Record<string, unknown>;
  assert.ok(String(body.error ?? '').includes('Bad_Project'), `error must name the offending project value, got: ${JSON.stringify(body)}`);
});

test('R4-16 AT-38: sessionId failing SAFE_ID_RE (embedded "/"/".." via one opaque encoded segment, matching AT-30/31\'s technique) → 400, naming the offending value', async () => {
  const maliciousSessionId = 'sid/../x';
  const res = await fetch(`${url}/api/demo-builder/generation/demo/${encodeURIComponent(maliciousSessionId)}/1/DEMO.html`);
  assert.equal(res.status, 400, `a sessionId containing "/" must be rejected with 400, got ${res.status}`);
  const body = await res.json() as Record<string, unknown>;
  assert.ok(String(body.error ?? '').includes(maliciousSessionId), `error must name the offending sessionId value, got: ${JSON.stringify(body)}`);
});

test('R4-16 AT-39: an over-length project (past the MAX_SKILL_ID_LENGTH cap the sibling route uses) → 400', async () => {
  const overLongProject = 'a'.repeat(101); // charset-valid (all lowercase), only the LENGTH is the violation
  const res = await fetch(`${url}/api/demo-builder/generation/${overLongProject}/some-sid/1/DEMO.html`);
  assert.equal(res.status, 400, `an over-length project must be rejected with 400, got ${res.status}`);
});

test('R4-16 AT-40: an over-length sessionId (past the MAX_SKILL_ID_LENGTH cap the sibling route uses) → 400', async () => {
  const overLongSessionId = 'a'.repeat(101); // charset-valid, only the LENGTH is the violation
  const res = await fetch(`${url}/api/demo-builder/generation/demo/${overLongSessionId}/1/DEMO.html`);
  assert.equal(res.status, 400, `an over-length sessionId must be rejected with 400, got ${res.status}`);
});

// Finding E (MINOR) — GENERATION_FILENAME_RE's character class
// (`[A-Za-z0-9._-]+`) accepts a bare "." or ".." as a WHOLE filename (only
// harmless today by coincidence, because it happens to resolve to a
// directory downstream and 404 for an unrelated reason — EISDIR/ENOENT — not
// because the filename was actually rejected). Kills an implementation that
// leaves this structural gap open (e.g. after a future refactor stops
// resolving "." /".." to a directory read failure).
// A literal "." or ".." as the LAST raw path segment is exactly the shape
// WHATWG URL's client-side dot-segment removal rewrites BEFORE the request
// is ever sent (a trailing ".." strips the preceding "1" segment too,
// changing the route's segment count entirely and missing the 4-group
// generation regex altogether) — so, same as AT-36, these two must go
// through rawGet with the percent-encoded form (%2E / %2E%2E), never a plain
// fetch()+encodeURIComponent (encodeURIComponent does not escape ".").
test('R4-16 AT-41: filename="." (raw %2E, bypassing client-side dot-segment collapse) → structurally rejected (400), not merely a coincidental 404', async () => {
  const sid = await startSession();
  writeGenerationFixture(sid, 1, { 'DEMO.html': '<html/>' });
  const res = await rawGet(`/api/demo-builder/generation/demo/${encodeURIComponent(sid)}/1/%2E`);
  assert.equal(res.status, 400, `filename="." must be structurally rejected with 400, got ${res.status}: ${res.text}`);
});

test('R4-16 AT-42: filename=".." (raw %2E%2E, bypassing client-side dot-segment collapse) → structurally rejected (400), not merely a coincidental 404', async () => {
  const sid = await startSession();
  writeGenerationFixture(sid, 1, { 'DEMO.html': '<html/>' });
  const res = await rawGet(`/api/demo-builder/generation/demo/${encodeURIComponent(sid)}/1/%2E%2E`);
  assert.equal(res.status, 400, `filename=".." must be structurally rejected with 400, got ${res.status}: ${res.text}`);
});

// ===========================================================================
// R4-16 PIN 3 — round-2 adversarial findings against HEAD edb0cfcb, where the
// round-1 fix (edb0cfcb) landed containment for the GET generation route only
// (pin 2's Finding A). Round 2's verdict: that closed the one ROUTE round 1
// named, not the vulnerability CLASS — the four sibling demo-builder POST
// routes (and /start) build `demoSessionDir(join(ctx.projectsRoot,
// body.project), body.sessionId)` from client fields validated for
// NON-EMPTINESS ONLY, then read/write through readSessionStatus/
// writeSessionStatus, which have no containment at all.
//
// Body fields (project/sessionId) are JSON payload content, not URL path
// segments — no WHATWG URL dot-segment normalisation applies here, so a
// plain fetch()-based POST (this file's `post()` helper) delivers ".."
// verbatim; no raw-HTTP trick is needed for Finding A (unlike the GET route's
// path-segment probes above).
// ===========================================================================

// Finding A (BLOCKER) — the four mutating routes (+ /start) reach the same
// unguarded sink. `demoSessionDir(join(projectsRoot, '..'), '../OUTSIDE')`
// resolves to `<forgeRoot>/OUTSIDE` (verified in pin 2's AT-36 against the
// GET route; the SAME `demoSessionDir` call is used here). Reproduced live
// per the brief: POST /lock with this body → 200 {"ok":true}, and
// <forgeRoot>/OUTSIDE/status.json was MUTATED.
//
// NOTE on the spawn-marker ask: `dryBridgeAgentTurnMarker` is a no-op unless
// `FORGE_DRY_BRIDGE=1` is set (dry-bridge.test.ts's own header) — this file
// only sets `FORGE_ARCHITECT_NO_SPAWN=1` (which makes the real `spawnAgentTurn`
// call itself a no-op, matching every other test in this file). Under that
// env, `body.dryBridge` is ALWAYS absent from the response regardless of
// whether validation passed or failed, so there is no side effect to observe
// distinguishing "spawnAgentTurn was never reached" from "it was reached and
// no-opped" — I could not find an observable signal for this from outside
// the module (`spawnAgentTurn` itself is not exported), so per the brief's
// own instruction this assertion is OMITTED rather than invented; the file
// content assertion below is the real, observable proof of the fix.
const DEMO_MUTATING_ROUTES: Array<{ path: string; extraBody?: Record<string, unknown> }> = [
  { path: '/api/demo-builder/brief', extraBody: { brief: 'Malicious brief.' } },
  { path: '/api/demo-builder/feedback', extraBody: { feedback: 'Malicious feedback.' } },
  { path: '/api/demo-builder/lock', extraBody: { generation: 1 } },
  { path: '/api/demo-builder/abandon' },
];

function outsideDirForTraversal(): string {
  // demoSessionDir(join(projectsRoot, '..'), '../OUTSIDE') === join(forgeRoot, '_demo', '../OUTSIDE') === join(forgeRoot, 'OUTSIDE').
  return join(forgeRoot, 'OUTSIDE');
}

for (const { path, extraBody } of DEMO_MUTATING_ROUTES) {
  test(`R4-16 AT-43 (Finding A, BLOCKER): POST ${path} with project=".." + sessionId="../OUTSIDE" is rejected — 400, and a pre-existing outside status.json is left byte-for-byte UNCHANGED`, async () => {
    const outsideDir = outsideDirForTraversal();
    rmSync(outsideDir, { recursive: true, force: true });
    mkdirSync(outsideDir, { recursive: true });
    const plantedStatus = JSON.stringify(
      { session_id: 'attacker-planted', project: 'not-a-real-project', project_repo_path: '/tmp/attacker-repo', phase: 'awaiting-review', iteration: 1, prompt: '', updated_at: '2020-01-01T00:00:00.000Z' },
      null,
      2,
    );
    writeFileSync(join(outsideDir, 'status.json'), plantedStatus);

    try {
      const { status, json } = await post(path, { project: '..', sessionId: '../OUTSIDE', ...extraBody });
      assert.equal(status, 400, `${path} with an escaping project/sessionId must be rejected with 400, got ${status}: ${JSON.stringify(json)}`);
      assert.ok(String(json.error ?? '').length > 0, `error must be present, got: ${JSON.stringify(json)}`);
      const after = readFileSync(join(outsideDir, 'status.json'), 'utf8');
      assert.equal(after, plantedStatus, "the outside status.json must be left byte-for-byte UNCHANGED — a 200-with-mutation and a 400-with-no-write must be distinguishable, and today's code mutates it");
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });
}

// /start is the CREATE-from-scratch case: it never calls readSessionStatus
// first (no pre-planted file needed to observe the defect) — it is an
// unconditional `mkdirSync` + `writeSessionStatus`. Only `project` is
// attacker-controlled here (sessionId is server-generated), so the
// reproduction shape is narrower: `demoSessionDir(join(projectsRoot, '..'),
// <realSessionId>) === join(forgeRoot, '_demo', <realSessionId>)` — still
// entirely outside `projectsRoot`.
test('R4-16 AT-44 (Finding A, /start): POST /start with project=".." is rejected — 400, and no forgeRoot/_demo/ directory is ever created', async () => {
  const outsideParent = join(forgeRoot, '_demo');
  rmSync(outsideParent, { recursive: true, force: true });
  const { status, json } = await post('/api/demo-builder/start', { project: '..' });
  assert.equal(status, 400, `/start with project=".." must be rejected with 400, got ${status}: ${JSON.stringify(json)}`);
  assert.ok(!existsSync(outsideParent), 'no forgeRoot/_demo/ directory may ever be created — /start must never write outside projectsRoot');
});

test('R4-16 AT-45: charset rejection — POST /lock with project failing SLUG_RE (e.g. "Bad_Project") → 400, naming the offending value', async () => {
  const sid = await startSession();
  const { status, json } = await post('/api/demo-builder/lock', { project: 'Bad_Project', sessionId: sid, generation: 1 });
  assert.equal(status, 400, `an invalid-slug project must be rejected with 400, got ${status}`);
  assert.ok(String(json.error ?? '').includes('Bad_Project'), `error must name the offending project value, got: ${JSON.stringify(json)}`);
});

test('R4-16 AT-46: charset rejection — POST /brief with sessionId failing SAFE_ID_RE (embedded "/") → 400, naming the offending value', async () => {
  const maliciousSessionId = 'sid/with/slashes';
  const { status, json } = await post('/api/demo-builder/brief', { project: 'demo', sessionId: maliciousSessionId, brief: 'x' });
  assert.equal(status, 400, `a sessionId containing "/" must be rejected with 400, got ${status}`);
  assert.ok(String(json.error ?? '').includes(maliciousSessionId), `error must name the offending sessionId value, got: ${JSON.stringify(json)}`);
});

// Positive control — GREEN today, not a defect pin (mirrors AT-24/AT-46's
// precedent in the sibling pins): the fix must reject the escaping/invalid
// shapes above WITHOUT breaking the legitimate flow. Exercises all 5 routes
// end-to-end (start → brief → feedback → lock, plus a second session for
// abandon) with valid project/sessionId throughout.
test('R4-16 AT-47 (positive control, green today): all 5 demo-builder routes still succeed end-to-end with a valid project + sessionId', async () => {
  const started = await post('/api/demo-builder/start', { project: 'demo' });
  assert.equal(started.status, 200);
  const sid = started.json.sessionId as string;
  assert.equal((await post('/api/demo-builder/brief', { project: 'demo', sessionId: sid, brief: 'Dark and minimal.' })).status, 200);
  assert.equal((await post('/api/demo-builder/feedback', { project: 'demo', sessionId: sid, feedback: 'Bigger diff.' })).status, 200);
  assert.equal((await post('/api/demo-builder/lock', { project: 'demo', sessionId: sid })).status, 200);

  const started2 = await post('/api/demo-builder/start', { project: 'demo' });
  const sid2 = started2.json.sessionId as string;
  assert.equal((await post('/api/demo-builder/abandon', { project: 'demo', sessionId: sid2 })).status, 200);
});

// ---------------------------------------------------------------------------
// Finding B (BLOCKER) — a symlinked SESSION DIR defeats string validation
// (SLUG_RE/SAFE_ID_RE say nothing about what `<project>/_demo/<sessionId>`
// resolves to) AND the realpath check in safeReadFileInSession (which
// computes containment RELATIVE TO whatever sessionDir it is handed — if the
// session dir itself is the symlink, containment passes trivially against
// the attacker's own target). `cli/bridge-studio-sessions.ts`'s
// `resolveSafeSessionDir` already solves exactly this, scoped to the
// `<project>/_<kind>/` parent (its own AT-47) — the fix mirrors that shape,
// not a projectsRoot-wide check (which would miss a symlink into ANOTHER
// project's session dir).
// ---------------------------------------------------------------------------

test('R4-16 AT-48 (Finding B, BLOCKER): GET generation route — a symlinked session dir (a NAME that legitimately passes SAFE_ID_RE) pointing outside the project is rejected, and the outside content never appears in the body', async () => {
  const outsideDir = mkdtempSync(join(tmpdir(), 'symlinked-session-outside-'));
  const OUTSIDE_MARKER = 'TOP-SECRET-SYMLINKED-SESSION-DIR-MARKER-6642';
  try {
    mkdirSync(join(outsideDir, 'generations', '1'), { recursive: true });
    writeFileSync(join(outsideDir, 'generations', '1', 'DEMO.html'), `<html>${OUTSIDE_MARKER}</html>`, 'utf8');
    const attackerSessionId = 'attackerSession123'; // a legitimate-looking id — passes SAFE_ID_RE
    mkdirSync(join(repoDir(), '_demo'), { recursive: true });
    symlinkSync(outsideDir, join(demoSessionDirFor(attackerSessionId)));

    const res = await fetch(`${url}/api/demo-builder/generation/demo/${attackerSessionId}/1/DEMO.html`);
    // Either 400 or 404 satisfies "rejected" — resolveSafeSessionDir's own
    // sibling convention collapses "missing" and "escaping symlink" into the
    // SAME outcome (never distinguishable to an attacker), which is 404-shaped.
    assert.ok(res.status === 400 || res.status === 404, `a symlinked session dir must be rejected (400 or 404), got ${res.status}`);
    const text = await res.text();
    assert.ok(!text.includes(OUTSIDE_MARKER), `the outside content must never appear in the body, got: ${text}`);
  } finally {
    rmSync(demoSessionDirFor('attackerSession123'), { force: true }); // remove the symlink itself, not its target
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('R4-16 AT-49 (Finding B, BLOCKER): POST /lock — a symlinked session dir is rejected, and a pre-existing outside status.json is left byte-for-byte UNCHANGED', async () => {
  const outsideDir = mkdtempSync(join(tmpdir(), 'symlinked-session-outside-post-'));
  try {
    const attackerSessionId = 'attackerLockSession456';
    mkdirSync(join(repoDir(), '_demo'), { recursive: true });
    symlinkSync(outsideDir, join(demoSessionDirFor(attackerSessionId)));

    // A status.json must exist at the symlink TARGET for this AT to mean
    // anything — otherwise readSessionStatus 404s regardless of whether the
    // symlink escape is blocked (a false negative that proves nothing).
    const plantedStatus = JSON.stringify(
      { session_id: attackerSessionId, project: 'demo', project_repo_path: '/tmp/attacker-repo', phase: 'awaiting-review', iteration: 1, prompt: '', updated_at: '2020-01-01T00:00:00.000Z' },
      null,
      2,
    );
    writeFileSync(join(outsideDir, 'status.json'), plantedStatus);

    const { status } = await post('/api/demo-builder/lock', { project: 'demo', sessionId: attackerSessionId, generation: 1 });
    assert.ok(status === 400 || status === 404, `a symlinked session dir must be rejected (400 or 404), got ${status}`);
    const after = readFileSync(join(outsideDir, 'status.json'), 'utf8');
    assert.equal(after, plantedStatus, 'the outside status.json (reached through the symlinked session dir) must be left byte-for-byte UNCHANGED');
  } finally {
    rmSync(demoSessionDirFor('attackerLockSession456'), { force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

// ===========================================================================
// R4-16 PIN 4 — round-3 finding (BLOCKER): POST /api/demo-builder/start
// accepts a caller-supplied `projectRepoPath` with ZERO validation
// (`const repoPath = body.projectRepoPath ?? join(ctx.projectsRoot,
// body.project);`) and persists it verbatim as status.json.project_repo_path
// — the field the runner then trusts as cwd, as the target of a REAL git
// branch-create + commit, and as the base for every DEMO.html/SKILL.md/
// demo.lock.json write. Pins 2/3's containment (the skillRelPath allowlist,
// the session-dir choke point) say nothing about THIS field — this makes
// that earlier work decorative for exactly this route.
//
// Fix shape (binding, per the brief): reuse `isContainedProjectRepoPath`
// (cli/manifest-path-guard.ts, SEC-02) — already hardened over four review
// rounds — rather than a new check. That function is a pure boolean; the
// route itself must still construct the 400 + message naming the offending
// value, which is what these ATs pin at the ROUTE level (the function's own
// containment edge cases are already covered by
// orchestrator/manifest-path-fields.test.ts — not re-litigated here).
// ===========================================================================

/** Snapshot of session ids currently under `<repoDir()>/_demo/` — used to
 *  prove a REJECTED /start call creates NO new session dir at all (an
 *  id-agnostic filesystem check, since a 400 response carries no sessionId
 *  to look up directly). */
function listDemoSessionIds(): string[] {
  const dir = join(repoDir(), '_demo');
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

test('R4-16 AT-50 (PIN 4, BLOCKER): POST /api/demo-builder/start with projectRepoPath OUTSIDE forgeRoot/projects/ is rejected — 400 naming the offending path, and NO new session dir is created', async () => {
  const outsideDir = mkdtempSync(join(tmpdir(), 'demo-start-outside-repo-'));
  try {
    const before_ = listDemoSessionIds();
    const { status, json } = await post('/api/demo-builder/start', { project: 'demo', projectRepoPath: outsideDir });
    assert.equal(status, 400, `projectRepoPath outside forgeRoot/projects/ must be rejected with 400, got ${status}: ${JSON.stringify(json)}`);
    assert.ok(String(json.error ?? '').includes(outsideDir), `error must name the offending path, got: ${JSON.stringify(json)}`);
    assert.deepEqual(listDemoSessionIds(), before_, 'a rejected /start must create NO new session dir under _demo/');
  } finally {
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('R4-16 AT-51 (PIN 4, BLOCKER): POST /api/demo-builder/start with a projectRepoPath lexically under forgeRoot/projects/ but a SYMLINK resolving outside is rejected', async () => {
  const outsideDir = mkdtempSync(join(tmpdir(), 'demo-start-symlink-outside-'));
  const evilProjectDir = join(forgeRoot, 'projects', 'evil-project-r416pin4');
  try {
    symlinkSync(outsideDir, evilProjectDir);
    const before_ = listDemoSessionIds();
    const { status, json } = await post('/api/demo-builder/start', { project: 'demo', projectRepoPath: evilProjectDir });
    assert.equal(status, 400, `a symlinked projectRepoPath must be rejected with 400, got ${status}: ${JSON.stringify(json)}`);
    assert.deepEqual(listDemoSessionIds(), before_, 'a rejected /start must create NO new session dir under _demo/');
  } finally {
    rmSync(evilProjectDir, { force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('R4-16 AT-52 (PIN 4): POST /api/demo-builder/start with a RELATIVE projectRepoPath is rejected — the guard requires absolute, never silently resolved against the server\'s cwd', async () => {
  const before_ = listDemoSessionIds();
  const { status, json } = await post('/api/demo-builder/start', { project: 'demo', projectRepoPath: 'nonexistent-relative-dir-xyz-9931/demo' });
  assert.equal(status, 400, `a relative projectRepoPath must be rejected with 400, got ${status}: ${JSON.stringify(json)}`);
  assert.deepEqual(listDemoSessionIds(), before_, 'a rejected /start must create NO new session dir under _demo/');
});

test('R4-16 AT-53 (PIN 4, positive controls, green today): projectRepoPath ABSENT still defaults to join(projectsRoot, project); a genuinely-contained projectRepoPath is still accepted and persisted verbatim', async () => {
  const started1 = await post('/api/demo-builder/start', { project: 'demo' });
  assert.equal(started1.status, 200, `absent projectRepoPath must still succeed, got ${started1.status}: ${JSON.stringify(started1.json)}`);
  const sid1 = started1.json.sessionId as string;
  const status1 = readDemoStatus(sid1);
  assert.equal(status1.project_repo_path, repoDir(), 'absent projectRepoPath must default to join(projectsRoot, project)');

  const containedPath = repoDir(); // join(projectsRoot, 'demo') — genuinely contained, the real shape scripts/verify-cycle.mjs sends
  const started2 = await post('/api/demo-builder/start', { project: 'demo', projectRepoPath: containedPath });
  assert.equal(started2.status, 200, `a genuinely-contained projectRepoPath must still succeed, got ${started2.status}: ${JSON.stringify(started2.json)}`);
  const sid2 = started2.json.sessionId as string;
  const status2 = readDemoStatus(sid2);
  assert.equal(status2.project_repo_path, containedPath, 'a genuinely-contained projectRepoPath must be persisted verbatim');
});
