/**
 * SEC-07 acceptance pins: the bridge route `POST /api/agents/<slug>/run`
 * (`cli/ui-bridge.ts`) must validate an untrusted `body.project` by realpath
 * IDENTITY, not merely by shape (`SAFE_PROJECT_NAME_RE`) + existence
 * (`existsSync(join(projectsRoot, body.project))`). An in-root project NAME
 * whose real location resolves OUTSIDE the projects root (a symlink) passes
 * both current checks today; the fix routes the value through
 * `resolveGuardedPath(ctx.projectsRoot, [body.project])` (requiring
 * `ok && exists`), so such a name is refused before any dispatch.
 *
 * `FORGE_ARCHITECT_NO_SPAWN=1` keeps the route from launching a real agent
 * process (see `spawnAgentDispatch`) — the pin is the PRE-spawn refusal.
 *
 * Fixture mirrors `cli/ui-bridge-agent-run.test.ts` (its `studioAgent`
 * generator, `test-runnable` unattended slug, and CSRF headers) and the
 * per-test `startBridge({ forgeRoot, port: 0 })` shape used by the last test
 * in `cli/legacy-dispatch-project-guard.test.ts`.
 *
 * PUBLIC-REPO NOTE: neutral naming — these describe what the route REJECTS (a
 * project name whose directory identity does not match its expected in-root
 * location), not any onward path.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';

process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
// ctx.projectsRoot is resolveProjectsDir(...)-derived; FORGE_PROJECTS_DIR would
// override it away from the fixture's own `projects/`. Clear it.
delete process.env.FORGE_PROJECTS_DIR;

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };

/** A non-interactive (dispatchable) roster agent — mirrors the `test-runnable`
 *  fixture the sibling `cli/ui-bridge-agent-run.test.ts` dispatches successfully
 *  (surface: unattended, empty composition ⇒ no unready connections). */
function studioAgent(slug: string, surface: string): string {
  return `---
name: ${slug}
description: fixture agent for the SEC-07 project-identity route test
purpose: exercise the dispatch route
brainAccess: advisory
interactivity: Autonomous once launched; asks no questions.
surface: ${surface}
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

Fixture body for ${slug}.
`;
}

/** A forgeRoot with the dirs `startBridge` expects plus one dispatchable
 *  roster agent (`test-runnable`) under `skills/`. */
function setupBridgeRoot(): string {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'sec07-bridge-identity-'));
  for (const state of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'flows'), { recursive: true });
  mkdirSync(join(forgeRoot, 'projects'), { recursive: true });
  mkdirSync(join(forgeRoot, 'skills', 'test-runnable'), { recursive: true });
  writeFileSync(join(forgeRoot, 'skills', 'test-runnable', 'SKILL.md'), studioAgent('test-runnable', 'unattended'));
  return forgeRoot;
}

async function postRun(url: string, body: unknown): Promise<{ status: number; text: string }> {
  const res = await fetch(`${url}/api/agents/test-runnable/run`, {
    method: 'POST',
    headers: CSRF,
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

test('rejects a project name whose directory identity resolves outside the projects root (symlinked project)', async (t) => {
  const forgeRoot = setupBridgeRoot();
  const outside = mkdtempSync(join(tmpdir(), 'sec07-bridge-outside-'));
  const SENTINEL_CONTENT = 'sec07-bridge-sentinel-untouched';
  const sentinelPath = join(outside, 'sentinel.txt');
  writeFileSync(sentinelPath, SENTINEL_CONTENT);
  const symlinkPath = join(forgeRoot, 'projects', 'evil');
  try {
    try {
      symlinkSync(outside, symlinkPath, 'dir');
    } catch {
      t.skip('symlink creation unavailable in this environment');
      rmSync(forgeRoot, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
      return;
    }
    // Fixture preconditions, asserted before reading any verdict.
    assert.equal(readFileSync(sentinelPath, 'utf8'), SENTINEL_CONTENT, 'fixture precondition: sentinel content as planted');
    assert.deepEqual(readdirSync(outside), ['sentinel.txt'], 'fixture precondition: only the sentinel exists at the escape target');

    const { url, close } = await startBridge({ forgeRoot, port: 0 });
    try {
      const { status, text } = await postRun(url, { project: 'evil' });
      // Red now: the symlinked name passes SAFE_PROJECT_NAME_RE + existsSync,
      // so the route accepts it (200) and it reaches dispatch.
      assert.ok(status >= 400 && status < 500, `a symlinked project whose identity is out of root must be refused 4xx — got ${status}: ${text}`);
      // Artifact-level: nothing was created at the escape target.
      assert.equal(readFileSync(sentinelPath, 'utf8'), SENTINEL_CONTENT, 'the sentinel must be byte-unchanged after a refused call');
      assert.deepEqual(readdirSync(outside), ['sentinel.txt'], 'no run/output dir may appear at the symlink target after a refused call');
    } finally {
      await close();
    }
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

// Regression lock — GREEN before AND after the fix: an ordinary real project
// name must still be accepted (200). Kills an over-strict identity check that
// rejects genuine projects.
test('regression lock: an ordinary real project name is accepted (kills an over-strict identity check)', async () => {
  const forgeRoot = setupBridgeRoot();
  mkdirSync(join(forgeRoot, 'projects', 'realproj'), { recursive: true });
  try {
    const { url, close } = await startBridge({ forgeRoot, port: 0 });
    try {
      const { status, text } = await postRun(url, { project: 'realproj' });
      assert.equal(status, 200, `an ordinary real project name must be accepted (200) — got ${status}: ${text}`);
      const body = JSON.parse(text) as { ok?: boolean; runId?: string };
      assert.equal(body.ok, true, 'an accepted run must report ok:true');
    } finally {
      await close();
    }
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// Regression lock — GREEN before AND after the fix: a genuinely absent project
// name still 404s (unchanged behaviour — the fix requires `ok && exists`, so a
// non-existent in-root name resolves cleanly but does not exist ⇒ 404).
test('regression lock: a genuinely absent project name still 404s (unchanged)', async () => {
  const forgeRoot = setupBridgeRoot();
  try {
    const { url, close } = await startBridge({ forgeRoot, port: 0 });
    try {
      const { status, text } = await postRun(url, { project: 'ghostproject' });
      assert.equal(status, 404, `an absent project must 404 — got ${status}: ${text}`);
    } finally {
      await close();
    }
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
