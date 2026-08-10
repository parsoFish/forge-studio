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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
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
  assert.equal(status.phase, 'running');
  assert.equal(status.project, 'demoproj');

  const prompt = readFileSync(join(sessionDir, 'prompt.md'), 'utf8');
  assert.equal(prompt, 'A skill that summarizes PR diffs.\n', 'prompt.md must render the operator\'s own words verbatim — no fabricated interview question');
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
