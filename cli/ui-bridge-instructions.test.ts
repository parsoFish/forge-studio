/**
 * Tests for the instructions + demo-builder bridge routes (briefing-flow UX).
 *
 * Starts a real bridge against a temp forgeRoot (no SDK / no spawn —
 * `FORGE_ARCHITECT_NO_SPAWN=1`) and exercises the `/start` (no prompt → briefing,
 * no spawn), `/brief` (kick off), and mode-defaulting behaviour over HTTP. This
 * pins the operator-reported regression: the edit button must NOT 400 because a
 * prompt is missing.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, readdirSync } from 'node:fs';
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

async function post(path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

function readInstrStatus(sid: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(repoDir(), '_instructions', sid, 'status.json'), 'utf8'));
}
function readDemoStatus(sid: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(repoDir(), '_demo', sid, 'status.json'), 'utf8'));
}

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-instr-'));
  mkdirSync(repoDir(), { recursive: true });
  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

// --- instructions ----------------------------------------------------------

test('POST /api/instructions/start succeeds WITHOUT a prompt → briefing, no spawn (the edit-button bug)', async () => {
  const { status, json } = await post('/api/instructions/start', { project: 'demo' });
  assert.equal(status, 200, 'start must not 400 when no prompt is given');
  assert.ok(json.sessionId, 'returns a sessionId');
  assert.equal(json.mode, 'init', 'no AGENTS.md → init mode');
  const st = readInstrStatus(json.sessionId as string);
  assert.equal(st.phase, 'briefing', 'session opens in briefing (agent not kicked off)');
  assert.equal(st.prompt, '', 'no prompt yet');
});

test('POST /api/instructions/start defaults mode=edit when an AGENTS.md exists', async () => {
  writeFileSync(join(repoDir(), 'AGENTS.md'), '# AGENTS\n\nBuild: npm run build');
  try {
    const { json } = await post('/api/instructions/start', { project: 'demo' });
    assert.equal(json.mode, 'edit');
    // GET sessions surfaces the current file content for the briefing screen.
    const sessions = (await (await fetch(`${url}/api/instructions/sessions`)).json()) as {
      sessions: Array<{ sessionId: string; mode: string; currentInstructions: string | null; currentInstructionsFile: string | null }>;
    };
    const s = sessions.sessions.find((x) => x.sessionId === json.sessionId);
    assert.equal(s!.mode, 'edit');
    assert.match(s!.currentInstructions ?? '', /Build: npm run build/);
    assert.equal(s!.currentInstructionsFile, 'AGENTS.md');
  } finally {
    rmSync(join(repoDir(), 'AGENTS.md'), { force: true });
  }
});

test('POST /api/instructions/brief records notes + transitions briefing → interviewing', async () => {
  const started = await post('/api/instructions/start', { project: 'demo' });
  const sid = started.json.sessionId as string;
  const { status } = await post('/api/instructions/brief', { project: 'demo', sessionId: sid, brief: 'Keep it short; document the lint gate.' });
  assert.equal(status, 200);
  const st = readInstrStatus(sid);
  assert.equal(st.phase, 'interviewing', 'agent is now kicked off');
  assert.equal(st.prompt, 'Keep it short; document the lint gate.');
});

// --- demo-builder ----------------------------------------------------------

test('POST /api/demo-builder/start succeeds without a prompt → briefing, mode=create', async () => {
  const { status, json } = await post('/api/demo-builder/start', { project: 'demo' });
  assert.equal(status, 200);
  assert.ok(json.sessionId);
  assert.equal(json.mode, 'create', 'no locked demo → create mode');
  assert.equal(readDemoStatus(json.sessionId as string).phase, 'briefing');
});

test('POST /api/demo-builder/start defaults mode=update when a demo is locked', async () => {
  mkdirSync(join(repoDir(), '.forge', 'demo'), { recursive: true });
  writeFileSync(join(repoDir(), '.forge', 'demo', 'demo.lock.json'), JSON.stringify({ demo_html: '.forge/demo/DEMO.html' }));
  try {
    const { json } = await post('/api/demo-builder/start', { project: 'demo' });
    assert.equal(json.mode, 'update');
  } finally {
    rmSync(join(repoDir(), '.forge', 'demo', 'demo.lock.json'), { force: true });
  }
});

test('demo sessions surface per-element fragments + the fragment endpoint serves them', async () => {
  const started = await post('/api/demo-builder/start', { project: 'demo' });
  const sid = started.json.sessionId as string;
  // The agent would write per-element fragments here; simulate one.
  mkdirSync(join(repoDir(), '.forge', 'demo', 'fragments'), { recursive: true });
  writeFileSync(join(repoDir(), '.forge', 'demo', 'fragments', 'cli-capture.html'), '<section>cli fragment</section>');

  const sessions = (await (await fetch(`${url}/api/demo-builder/sessions`)).json()) as {
    sessions: Array<{ sessionId: string; fragments: string[] }>;
  };
  const s = sessions.sessions.find((x) => x.sessionId === sid);
  assert.deepEqual(s!.fragments, ['cli-capture'], 'session surfaces the element fragment ids');

  const frag = await fetch(`${url}/api/demo-builder/fragment/demo/${encodeURIComponent(sid)}/cli-capture`);
  assert.equal(frag.status, 200);
  const fragHtml = await frag.text();
  assert.match(fragHtml, /cli fragment/, 'serves the fragment content');
  // The bare <section> fragment is wrapped into a styled, self-contained HTML doc
  // so a single component renders as a styled slice of the full demo.
  assert.match(fragHtml, /^\s*<!doctype html>/i, 'wrapped in a full HTML doc');
  assert.match(fragHtml, /<style>/, 'carries the Forge demo stylesheet');
  // A path-escape / missing fragment 404s.
  const missing = await fetch(`${url}/api/demo-builder/fragment/demo/${encodeURIComponent(sid)}/nope`);
  assert.equal(missing.status, 404);
});

test('POST /api/demo-builder/brief transitions briefing → generating', async () => {
  const started = await post('/api/demo-builder/start', { project: 'demo' });
  const sid = started.json.sessionId as string;
  const { status } = await post('/api/demo-builder/brief', { project: 'demo', sessionId: sid, brief: 'Dark, minimal, show the diff prominently.' });
  assert.equal(status, 200);
  const st = readDemoStatus(sid);
  assert.equal(st.phase, 'generating');
  assert.equal(st.prompt, 'Dark, minimal, show the diff prominently.');
});

test('start does not 400 on a missing project (only project is required)', async () => {
  const { status } = await post('/api/instructions/start', {});
  assert.equal(status, 400, 'project is still required');
  assert.ok(existsSync(repoDir()));
});

// ===========================================================================
// R4-16 PIN 4 — round-3 finding (BLOCKER), applies to /api/instructions/start
// too: `const repoPath = body.projectRepoPath ?? join(ctx.projectsRoot,
// body.project);` accepts the caller-supplied field with ZERO validation.
// This route additionally READS through it immediately
// (`readAgentInstructionsFile(repoPath)`, to default `mode`) before ever
// persisting — an unvalidated read, not just an unvalidated write target.
// Fix shape (binding): reuse `isContainedProjectRepoPath`
// (cli/manifest-path-guard.ts, SEC-02) at this route too. No natural home
// exists for a dedicated architect-route test FILE separate from
// ui-bridge-architect.test.ts (which already carries a real "POST
// /api/architect/start" test and gets its own ATs there) — but this file
// already carries both the /instructions AND /demo-builder route tests
// side-by-side (see the "--- demo-builder ---" section above), so these
// /instructions ATs have a natural home right here, alongside the
// /instructions/start tests they extend.
// ===========================================================================

/** Snapshot of session ids currently under `<repoDir()>/_instructions/` —
 *  used to prove a REJECTED /start creates NO new session dir (id-agnostic,
 *  since a 400 response carries no sessionId to look up directly). */
function listInstructionsSessionIds(): string[] {
  const dir = join(repoDir(), '_instructions');
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

test('R4-16 PIN 4, AT-I1 (BLOCKER): POST /api/instructions/start with projectRepoPath OUTSIDE forgeRoot/projects/ is rejected — 400 naming the offending path, and NO new session dir is created', async () => {
  const outsideDir = mkdtempSync(join(tmpdir(), 'instr-start-outside-repo-'));
  try {
    const before_ = listInstructionsSessionIds();
    const { status, json } = await post('/api/instructions/start', { project: 'demo', projectRepoPath: outsideDir });
    assert.equal(status, 400, `projectRepoPath outside forgeRoot/projects/ must be rejected with 400, got ${status}: ${JSON.stringify(json)}`);
    assert.ok(String(json.error ?? '').includes(outsideDir), `error must name the offending path, got: ${JSON.stringify(json)}`);
    assert.deepEqual(listInstructionsSessionIds(), before_, 'a rejected /start must create NO new session dir under _instructions/');
  } finally {
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('R4-16 PIN 4, AT-I2 (BLOCKER): POST /api/instructions/start with a projectRepoPath lexically under forgeRoot/projects/ but a SYMLINK resolving outside is rejected', async () => {
  const outsideDir = mkdtempSync(join(tmpdir(), 'instr-start-symlink-outside-'));
  const evilProjectDir = join(forgeRoot, 'projects', 'evil-project-r416pin4');
  try {
    symlinkSync(outsideDir, evilProjectDir);
    const before_ = listInstructionsSessionIds();
    const { status } = await post('/api/instructions/start', { project: 'demo', projectRepoPath: evilProjectDir });
    assert.equal(status, 400, `a symlinked projectRepoPath must be rejected with 400, got ${status}`);
    assert.deepEqual(listInstructionsSessionIds(), before_, 'a rejected /start must create NO new session dir under _instructions/');
  } finally {
    rmSync(evilProjectDir, { force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('R4-16 PIN 4, AT-I3: POST /api/instructions/start with a RELATIVE projectRepoPath is rejected — the guard requires absolute, never silently resolved against the server\'s cwd', async () => {
  const before_ = listInstructionsSessionIds();
  const { status } = await post('/api/instructions/start', { project: 'demo', projectRepoPath: 'nonexistent-relative-dir-xyz-9931/demo' });
  assert.equal(status, 400, `a relative projectRepoPath must be rejected with 400, got ${status}`);
  assert.deepEqual(listInstructionsSessionIds(), before_, 'a rejected /start must create NO new session dir under _instructions/');
});

test('R4-16 PIN 4, AT-I4 (positive controls, green today): projectRepoPath ABSENT still defaults to join(projectsRoot, project); a genuinely-contained projectRepoPath is still accepted and persisted verbatim', async () => {
  const started1 = await post('/api/instructions/start', { project: 'demo' });
  assert.equal(started1.status, 200, `absent projectRepoPath must still succeed, got ${started1.status}: ${JSON.stringify(started1.json)}`);
  const sid1 = started1.json.sessionId as string;
  const status1 = readInstrStatus(sid1);
  assert.equal(status1.project_repo_path, repoDir(), 'absent projectRepoPath must default to join(projectsRoot, project)');

  const containedPath = repoDir(); // join(projectsRoot, 'demo') — genuinely contained
  const started2 = await post('/api/instructions/start', { project: 'demo', projectRepoPath: containedPath });
  assert.equal(started2.status, 200, `a genuinely-contained projectRepoPath must still succeed, got ${started2.status}: ${JSON.stringify(started2.json)}`);
  const sid2 = started2.json.sessionId as string;
  const status2 = readInstrStatus(sid2);
  assert.equal(status2.project_repo_path, containedPath, 'a genuinely-contained projectRepoPath must be persisted verbatim');
});
