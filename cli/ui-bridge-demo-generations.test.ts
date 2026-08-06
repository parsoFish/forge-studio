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
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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
