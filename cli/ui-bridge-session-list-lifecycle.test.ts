/**
 * W8-A2 (ON-7 defect 1, WI-1a) — the four BESPOKE per-kind session-list
 * routes (`GET /api/architect/sessions`, `/api/instructions/sessions`,
 * `/api/demo-builder/sessions`, `/api/project-brain/sessions`) never called
 * `deriveSessionLifecycleFor` before this fix — `cli/ui-bridge.ts` imported
 * it once and called it once, from the GENERIC aggregate index's row
 * collector (`collectStudioSessionIndexRows`) alone. An operator who opens
 * one of the four DEDICATED screens (the ones a human actually visits) saw
 * a bare `phase` plus a hand-rolled `staleMs` — never the derived
 * `state`/`error` a crashed runner's own stderr.log carries.
 *
 * PINNED BEFORE THE FIX (RED at branch base — see the W8-A2 report for the
 * quoted failing output and the revert-and-rerun proof).
 *
 * Every case here drives the REAL route through a REAL `startBridge()` —
 * never the derivation called directly — so a route that forgets to wire
 * the helper in shows up here, exactly the discipline
 * `cli/ui-bridge-served-file-headers.test.ts` and
 * `cli/bridge-studio-lifecycle.test.ts` already established for this file.
 *
 * RUN: node --experimental-strip-types --test cli/ui-bridge-session-list-lifecycle.test.ts
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, copyFileSync, utimesSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { startBridge } from './ui-bridge.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

process.env.FORGE_ARCHITECT_NO_SPAWN = '1';

let forgeRoot: string;
let projectsRoot: string;
let logsRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

const NOW = Date.now();
const MIN = 60_000;

// The operator's real crashed-session shape (mirrors
// cli/bridge-studio-lifecycle.test.ts's KB_CLEANUP_STDERR — an
// InteractiveRunnerError, last non-stack line is the message
// `extractErrorMessage` must surface).
const ARCHITECT_STDERR = [
  'Error: InteractiveRunnerError: architect turn crashed while drafting',
  '    at runDraftStep (file:///x/architect-runner.ts:400:1)',
  '    at async runArchitectTurn (file:///x/architect-runner.ts:120:5)',
].join('\n');

const ARCH_SID = '2026-08-23T00-00-00-crash0001';
const ARCH_SID_WORKING = '2026-08-23T00-00-01-working1';
const INSTR_SID = '2026-08-23T00-00-02-working2';
const DEMO_SID = '2026-08-23T00-00-03-working3';
const PB_SID = '2026-08-23T00-00-04-working4';

function writeStatus(dir: string, status: Record<string, unknown>, mtimeMs?: number): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'status.json'), JSON.stringify(status, null, 2), 'utf8');
  if (mtimeMs !== undefined) utimesSync(join(dir, 'status.json'), mtimeMs / 1000, mtimeMs / 1000);
}

function writeLog(kind: string, sid: string, files: Record<string, string>, mtimeMs?: number): void {
  const dir = join(logsRoot, `_${kind}-${sid}`);
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), body, 'utf8');
    if (mtimeMs !== undefined) utimesSync(join(dir, name), mtimeMs / 1000, mtimeMs / 1000);
  }
}

async function expectJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  return JSON.parse(text) as T;
}

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-session-list-lifecycle-'));
  projectsRoot = join(forgeRoot, 'projects');
  logsRoot = join(forgeRoot, '_logs');
  for (const state of ['in-flight', 'done', 'failed', 'pending']) mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  mkdirSync(logsRoot, { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'flows'), { recursive: true });
  writeFileSync(join(forgeRoot, 'studio', 'catalog.yaml'), ['sdks: []', 'models: []', 'tools: []', 'mcps: []', 'guards: []', 'community-skills: []', ''].join('\n'));
  // The REAL registry — real kinds, real phase tables (the four routes now
  // call `loadSessionKinds(ctx.forgeRoot)`, same as the aggregate index).
  copyFileSync(join(REPO_ROOT, 'studio', 'session-kinds.yaml'), join(forgeRoot, 'studio', 'session-kinds.yaml'));

  // --- (1) A crashed architect session: real stderr.log NEWER than
  // status.json, no live turn pid at all. ---
  writeStatus(
    join(projectsRoot, 'proja', '_architect', ARCH_SID),
    { session_id: ARCH_SID, project: 'proja', project_repo_path: join(projectsRoot, 'proja'), phase: 'drafting', round: 1, idea: 'an idea', updated_at: new Date(NOW - 10 * MIN).toISOString() },
    NOW - 10 * MIN,
  );
  writeLog('architect', ARCH_SID, { 'stderr.log': ARCHITECT_STDERR }, NOW - 8 * MIN);

  // --- (2a) A second, WORKING (not crashed) architect session — proves the
  // route carries `lifecycle` on a non-crashed row too. ---
  writeStatus(
    join(projectsRoot, 'proja', '_architect', ARCH_SID_WORKING),
    { session_id: ARCH_SID_WORKING, project: 'proja', project_repo_path: join(projectsRoot, 'proja'), phase: 'drafting', round: 1, idea: 'a second idea', updated_at: new Date(NOW).toISOString() },
  );

  // --- (2b) instructions ---
  writeStatus(
    join(projectsRoot, 'proja', '_instructions', INSTR_SID),
    { session_id: INSTR_SID, project: 'proja', project_repo_path: join(projectsRoot, 'proja'), phase: 'drafting', round: 1, prompt: 'brief', updated_at: new Date(NOW).toISOString() },
  );

  // --- (2c) demo-builder ---
  writeStatus(
    join(projectsRoot, 'proja', '_demo', DEMO_SID),
    { session_id: DEMO_SID, project: 'proja', project_repo_path: join(projectsRoot, 'proja'), phase: 'generating', iteration: 0, prompt: 'demo it', updated_at: new Date(NOW).toISOString() },
  );

  // --- (2d) project-brain ---
  writeStatus(
    join(projectsRoot, 'proja', '_project-brain', PB_SID),
    { session_id: PB_SID, project: 'proja', project_repo_path: join(projectsRoot, 'proja'), phase: 'analyzing', prompt: 'focus', updated_at: new Date(NOW).toISOString() },
  );

  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeBridge = result.close;
});

after(async () => {
  await closeBridge();
  rmSync(forgeRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Required test 1 — a crashed architect session served by the REAL route
// carries state: 'crashed' AND the message from that stderr.log.
// ---------------------------------------------------------------------------

test('WI-1a-1: GET /api/architect/sessions carries state=crashed + the runner\'s own stderr message for a crashed session — never a bare phase', async () => {
  const body = await expectJson<{ sessions: Array<Record<string, unknown>> }>(await fetch(`${bridgeUrl}/api/architect/sessions`));
  const row = body.sessions.find((s) => s.sessionId === ARCH_SID);
  assert.ok(row, `expected a row for ${ARCH_SID}; got ${body.sessions.map((s) => s.sessionId).join(', ')}`);
  const lifecycle = row!.lifecycle as { state?: string; error?: string | null } | undefined;
  assert.ok(lifecycle, 'row must carry a "lifecycle" object — this is the wiring this WI adds');
  assert.equal(lifecycle!.state, 'crashed');
  assert.ok(typeof lifecycle!.error === 'string' && lifecycle!.error.includes('architect turn crashed while drafting'), `error must carry the runner's own message, got ${JSON.stringify(lifecycle!.error)}`);
  assert.ok(!lifecycle!.error!.includes('    at '), 'no stack frames on the wire');
});

// ---------------------------------------------------------------------------
// Required test 2 — per route, not once: all four bespoke routes carry the
// lifecycle. Four cases.
// ---------------------------------------------------------------------------

test('WI-1a-2 [architect]: GET /api/architect/sessions carries lifecycle on a WORKING (non-crashed) row too', async () => {
  const body = await expectJson<{ sessions: Array<Record<string, unknown>> }>(await fetch(`${bridgeUrl}/api/architect/sessions`));
  const row = body.sessions.find((s) => s.sessionId === ARCH_SID_WORKING);
  assert.ok(row, 'expected the working architect session row');
  const lifecycle = row!.lifecycle as { state?: string } | undefined;
  assert.ok(lifecycle, 'architect row must carry "lifecycle"');
  assert.equal(lifecycle!.state, 'working');
});

test('WI-1a-2 [instructions]: GET /api/instructions/sessions carries lifecycle', async () => {
  const body = await expectJson<{ sessions: Array<Record<string, unknown>> }>(await fetch(`${bridgeUrl}/api/instructions/sessions`));
  const row = body.sessions.find((s) => s.sessionId === INSTR_SID);
  assert.ok(row, 'expected the instructions session row');
  const lifecycle = row!.lifecycle as { state?: string } | undefined;
  assert.ok(lifecycle, 'instructions row must carry "lifecycle"');
  assert.equal(lifecycle!.state, 'working');
});

test('WI-1a-2 [demo-builder]: GET /api/demo-builder/sessions carries lifecycle', async () => {
  const body = await expectJson<{ sessions: Array<Record<string, unknown>> }>(await fetch(`${bridgeUrl}/api/demo-builder/sessions`));
  const row = body.sessions.find((s) => s.sessionId === DEMO_SID);
  assert.ok(row, 'expected the demo-builder session row');
  const lifecycle = row!.lifecycle as { state?: string } | undefined;
  assert.ok(lifecycle, 'demo-builder row must carry "lifecycle"');
  assert.equal(lifecycle!.state, 'working');
});

test('WI-1a-2 [project-brain]: GET /api/project-brain/sessions carries lifecycle — this route served `statuses` VERBATIM before the fix (no staleMs at all)', async () => {
  const body = await expectJson<{ sessions: Array<Record<string, unknown>> }>(await fetch(`${bridgeUrl}/api/project-brain/sessions`));
  const row = body.sessions.find((s) => s.session_id === PB_SID);
  assert.ok(row, 'expected the project-brain session row');
  const lifecycle = row!.lifecycle as { state?: string } | undefined;
  assert.ok(lifecycle, 'project-brain row must carry "lifecycle"');
  assert.equal(lifecycle!.state, 'working');
});

// ---------------------------------------------------------------------------
// staleMs collapse: derived from the SAME idleMs fact, not recomputed.
// ---------------------------------------------------------------------------

test('WI-1a: staleMs on the crashed architect row reflects the SAME idleMs the lifecycle derived (the three hand-written heartbeat-or-updated_at calcs collapse into one)', async () => {
  const body = await expectJson<{ sessions: Array<Record<string, unknown>> }>(await fetch(`${bridgeUrl}/api/architect/sessions`));
  const row = body.sessions.find((s) => s.sessionId === ARCH_SID)!;
  const lifecycle = row.lifecycle as { idleMs: number | null };
  assert.equal(row.staleMs, lifecycle.idleMs ?? 0);
});
