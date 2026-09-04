/**
 * ACCEPTANCE PINS (SEC-04, T1) — the PROJECT-BRAIN route family + the DEMO
 * first-segment symlink fold + the AT-47 symlink LIST shape.
 *
 * These are RED-on-current-code containment pins. The accepted SEC-04 fix
 * routes EVERY session-dir construction through the already-fixed
 * `resolveSafeSessionDir(projectsRoot, project, kindDirName, sessionId)`
 * (cli/bridge-studio-sessions.ts → resolveGuardedPath: per-segment
 * identity+charset+symlink, returns null on escape). The surfaces pinned here
 * bypass that guard TODAY:
 *
 *   1. POST /api/project-brain/{start,brief,approve,abandon} build the session
 *      dir as `projectBrainSessionDir(join(projectsRoot, body.project),
 *      body.sessionId)` = `join(projectsRoot, body.project, '_project-brain',
 *      body.sessionId)` with ZERO guard on `project`/`sessionId`. A body value
 *      is a plain JSON string (never URL-normalised), so a literal ".." in it
 *      is folded straight through by `join()`.
 *        - /start: unconditioned mkdir+write (no read-precondition) — assert NO
 *          out-of-root directory or file is created at all.
 *        - /brief,/approve,/abandon: read status.json first (404 if absent),
 *          then WRITE — plant a victim status.json at the traversal target and
 *          assert it is byte-unchanged and no sibling file (prompt.md) appears.
 *
 *   2. GET /api/project-brain/themes/:project/:sessionId has ZERO validation
 *      and `decodeURIComponent`s BOTH segments, then feeds them to
 *      `readStagedThemes` which `join()`s and reads+returns every `*.md`'s
 *      CONTENT. The route regex captures `[^/]+` per segment, so a `%2F`-
 *      encoded traversal (`..%2F..%2FX`) survives the split-on-real-slash and
 *      only becomes `/` at `decodeURIComponent` time — decode-then-join
 *      re-opens the escape. Issued as a RAW request (node:http sends the path
 *      verbatim; `fetch()`'s URL parser is not trusted to preserve `%2F`).
 *
 *   3. listProjectBrainSessions / listDemoSessions (the OBSERVING surfaces,
 *      AT-47): each `readdirSync`s `projects/<p>/_project-brain` (resp.
 *      `_demo`) then `readSessionStatus`es each child. A symlinked `_<kind>`
 *      entry pointing at a victim dir makes the LIST enumerate + disclose a
 *      victim's session status. The guarded resolver must refuse a symlinked
 *      segment; assert the victim's session never appears in the JSON.
 *
 *   4. DEMO first-segment symlink fold: `resolveDemoSessionDir` (the SEC-03
 *      choke point) computes its containment baseline as
 *      `realProjectDir = realpathSync(join(projectsRoot, project))`
 *      (cli/ui-bridge.ts:2256-2259) and then only checks
 *      `realAncestor.startsWith(realProjectDir + sep)`. When `projects/<attacker>`
 *      is itself a SYMLINK to a victim dir, `realProjectDir` IS the victim, so
 *      the comparison is tautological (root-folding, verbatim from the
 *      adversarial-containment-review catalogue). The demo route's CHARSET
 *      shape is already guarded (SEC-03) — the SYMLINK first-segment shape is
 *      the one proven RED here. Reached through the REAL
 *      GET /api/demo-builder/demo/:project/:sid route; the victim's status.json
 *      points `project_repo_path` at a legitimately-contained project holding a
 *      sentinel DEMO.html, so a successful fold serves that sentinel (a clean
 *      200+bytes RED); a contained resolver rejects the symlinked project.
 *
 * Binding rules applied: property/artifact assertions (bytes on disk, sentinel
 * bytes in the body), not bare status codes; every fixture precondition is
 * asserted BEFORE the verdict is read; each escape target is planted OUTSIDE
 * both projectsRoot AND forgeRoot; a "contained" claim is established by
 * execution only. Positive controls (must pass before AND after any fix) fix
 * the legitimate baseline so a fix cannot pass by disabling the routes.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  symlinkSync,
} from 'node:fs';
import { join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { request as httpRequest } from 'node:http';
import { URL } from 'node:url';

import { startBridge } from './ui-bridge.ts';
import { projectBrainSessionDir } from '../../packages/sessions/kinds/project-brain.ts';
import type { ProjectBrainStatus } from '../../packages/sessions/kinds/project-brain.ts';
import { demoSessionDir } from '@forge/sessions/kinds/demo-builder.ts';
import type { DemoBuilderStatus } from '@forge/sessions/kinds/demo-builder.ts';

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' } as const;

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

let forgeRoot: string;
let projectsRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;
const outsideDirs: string[] = [];
let symlinksUnavailable = false;

/** A scratch dir OUTSIDE both projectsRoot AND forgeRoot (sibling of forgeRoot
 *  under the OS temp root) — an out-of-root artifact under it is unambiguously
 *  an escape. */
function newOutsideDir(prefix: string): string {
  const d = tmp(prefix);
  outsideDirs.push(d);
  return d;
}

/** Percent-encode every literal "/" as "%2F": the smuggling shape for a route
 *  whose regex captures `[^/]+` per segment — the real-slash split never sees
 *  these, only `decodeURIComponent` (which runs AFTER) reveals them. */
function encodeSlashes(p: string): string {
  return p.split('/').map(encodeURIComponent).join('%2F');
}

/** Raw HTTP GET issuing EXACTLY `rawPath` as the request-target — node:http
 *  sends `path` verbatim on the wire (no URL-parser normalisation), unlike
 *  `fetch()`. This is how the `%2F` themes shapes are proven to reach the
 *  server still-encoded rather than decoded client-side. */
function rawGet(base: string, rawPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolvePromise, reject) => {
    const u = new URL(base);
    const req = httpRequest(
      { host: u.hostname, port: u.port, path: rawPath, method: 'GET' },
      (r) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => resolvePromise({ status: r.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${bridgeUrl}${path}`, { method: 'POST', headers: CSRF, body: JSON.stringify(body) });
}

function plantBrainStatus(sessionDir: string, overrides: Partial<ProjectBrainStatus> & { session_id: string; project: string }): void {
  mkdirSync(sessionDir, { recursive: true });
  const status: ProjectBrainStatus = {
    project_repo_path: '',
    phase: 'awaiting-review',
    prompt: '',
    updated_at: new Date().toISOString(),
    ...overrides,
  };
  writeFileSync(join(sessionDir, 'status.json'), JSON.stringify(status, null, 2));
}

function plantDemoStatus(sessionDir: string, overrides: Partial<DemoBuilderStatus> & { session_id: string; project: string; project_repo_path: string }): void {
  mkdirSync(sessionDir, { recursive: true });
  const status: DemoBuilderStatus = {
    phase: 'awaiting-review',
    iteration: 1,
    prompt: '',
    updated_at: new Date().toISOString(),
    ...overrides,
  };
  writeFileSync(join(sessionDir, 'status.json'), JSON.stringify(status, null, 2));
}

function skipIfNoSymlinks(t: { skip: (msg?: string) => void }): boolean {
  if (symlinksUnavailable) {
    t.skip('symlink creation unavailable in this environment');
    return true;
  }
  return false;
}

before(async () => {
  forgeRoot = tmp('sec04-pb-demo-containment-');
  projectsRoot = join(forgeRoot, 'projects');
  mkdirSync(projectsRoot, { recursive: true });
  mkdirSync(join(forgeRoot, '_queue', 'pending'), { recursive: true });
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'flows'), { recursive: true });
  mkdirSync(join(forgeRoot, 'skills'), { recursive: true });

  // --- Legitimate baselines used by the positive controls. ---
  // A real project-brain session under a real project.
  plantBrainStatus(
    projectBrainSessionDir(join(projectsRoot, 'pb-legit'), 'legit-pb-session'),
    { session_id: 'legit-pb-session', project: 'pb-legit', phase: 'awaiting-review' },
  );
  // Its staged themes (so the /themes/ positive control has content to return).
  const legitThemes = join(projectBrainSessionDir(join(projectsRoot, 'pb-legit'), 'legit-pb-session'), 'themes');
  mkdirSync(legitThemes, { recursive: true });
  writeFileSync(join(legitThemes, 'auth.md'), 'REAL-THEME-CONTENT-9f21a');

  // A real, contained demo project + its session (positive control for the
  // demo route, AND the innocent project the symlink-fold victim points at).
  mkdirSync(join(projectsRoot, 'legit-demo-project', '.forge', 'demo'), { recursive: true });
  writeFileSync(join(projectsRoot, 'legit-demo-project', '.forge', 'demo', 'DEMO.html'), 'REAL-DEMO-CONTENT-3c88e');
  plantDemoStatus(
    demoSessionDir(join(projectsRoot, 'legit-demo-project'), 'legit-demo-session'),
    { session_id: 'legit-demo-session', project: 'legit-demo-project', project_repo_path: join(projectsRoot, 'legit-demo-project') },
  );

  // Probe symlink availability once.
  const probeDir = tmp('sec04-symlink-probe-');
  try {
    symlinkSync(probeDir, join(projectsRoot, '__symlink_probe__'), 'dir');
  } catch {
    symlinksUnavailable = true;
  }
  rmSync(join(projectsRoot, '__symlink_probe__'), { force: true });
  rmSync(probeDir, { recursive: true, force: true });

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  process.env.FORGE_DRY_BRIDGE = '1';
  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeBridge = result.close;
});

after(async () => {
  if (closeBridge) await closeBridge();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
  for (const d of outsideDirs) rmSync(d, { recursive: true, force: true });
  delete process.env.FORGE_DRY_BRIDGE;
});

// ===========================================================================
// Positive controls (mandatory) — MUST pass before AND after any fix.
// ===========================================================================

test('positive control (before AND after any fix): GET /api/project-brain/sessions lists a legitimately-planted session', async () => {
  const res = await fetch(`${bridgeUrl}/api/project-brain/sessions`);
  const json = (await res.json()) as { sessions: ProjectBrainStatus[] };
  assert.equal(res.status, 200);
  assert.ok(
    json.sessions.some((s) => s.session_id === 'legit-pb-session'),
    `the legit session must be enumerated by the real list route — got ${JSON.stringify(json.sessions.map((s) => s.session_id))}`,
  );
});

test('positive control (before AND after any fix): GET /api/project-brain/themes/<legit>/<legit> returns the staged theme content', async () => {
  const res = await fetch(`${bridgeUrl}/api/project-brain/themes/pb-legit/legit-pb-session`);
  const json = (await res.json()) as { themes: Array<{ name: string; content: string }> };
  assert.equal(res.status, 200);
  assert.ok(
    json.themes.some((t) => t.content.includes('REAL-THEME-CONTENT-9f21a')),
    `the legit staged theme must be returned — got ${JSON.stringify(json.themes)}`,
  );
});

test('positive control (before AND after any fix): GET /api/demo-builder/demo/<legit>/<legit> serves the real DEMO.html', async () => {
  const res = await fetch(`${bridgeUrl}/api/demo-builder/demo/legit-demo-project/legit-demo-session`);
  const text = await res.text();
  assert.equal(res.status, 200, `expected the legit demo route to succeed — got ${res.status}: ${text}`);
  assert.equal(text, 'REAL-DEMO-CONTENT-3c88e');
});

// ===========================================================================
// PROJECT-BRAIN: POST /start — unconditioned mkdir+write, NO read-precondition.
// Assert NO out-of-root directory/file is created at all.
// ===========================================================================

test('(RED) POST /api/project-brain/start with a traversing body.project creates NO directory outside projectsRoot', async () => {
  const outside = newOutsideDir('sec04-pb-start-outside-');
  // Precondition: the escape target is genuinely empty before the request.
  assert.deepEqual(readdirSync(outside), [], 'fixture precondition: the outside dir must start empty');
  const project = relative(projectsRoot, outside); // e.g. "../../../<tmp>/<outside>"
  assert.equal(join(projectsRoot, project), outside, 'sanity: join(projectsRoot, project) must fold back onto the outside dir');

  const res = await post('/api/project-brain/start', { project });
  // Primary assertion is the artifact, not the status: the route must not have
  // created `_project-brain/<generatedId>/status.json` under the outside dir.
  const escaped = join(outside, '_project-brain');
  assert.equal(
    existsSync(escaped),
    false,
    `POST /start must not fold a traversing "project" through join() into a mkdir outside projectsRoot — found created dir at ${escaped} (status ${res.status})`,
  );
});

// ===========================================================================
// PROJECT-BRAIN: POST /brief,/approve,/abandon — read status.json, then WRITE.
// Plant a victim status.json at the traversal target; assert it is byte-
// unchanged and no sibling file appears.
// ===========================================================================

test('(RED) POST /api/project-brain/brief with a traversing body.project does not write into a victim session dir outside projectsRoot', async () => {
  const outside = newOutsideDir('sec04-pb-brief-project-outside-');
  const victimSession = join(outside, '_project-brain', 'vsess');
  plantBrainStatus(victimSession, { session_id: 'vsess', project: 'victim', phase: 'awaiting-review' });
  const statusPath = join(victimSession, 'status.json');
  assert.ok(existsSync(statusPath), 'fixture precondition: victim status.json must exist');
  const before = readFileSync(statusPath);

  const project = relative(projectsRoot, outside);
  assert.equal(join(projectsRoot, project, '_project-brain', 'vsess'), victimSession, 'sanity: traversal must land on the victim session');

  const res = await post('/api/project-brain/brief', { project, sessionId: 'vsess', brief: 'PWNED-BRIEF-CONTENT-a01' });

  assert.equal(
    existsSync(join(victimSession, 'prompt.md')),
    false,
    `/brief must not write prompt.md into a session dir reached by folding a traversing "project" outside projectsRoot (status ${res.status})`,
  );
  assert.deepEqual(
    readFileSync(statusPath),
    before,
    `/brief must not rewrite a victim status.json outside projectsRoot (status ${res.status})`,
  );
});

test('(RED) POST /api/project-brain/brief with a real project but a traversing body.sessionId does not write into a victim dir outside projectsRoot', async () => {
  const outside = newOutsideDir('sec04-pb-brief-session-outside-');
  const victimSession = join(outside, 'victim-sess');
  plantBrainStatus(victimSession, { session_id: 'victim-sess', project: 'pb-legit', phase: 'awaiting-review' });
  const statusPath = join(victimSession, 'status.json');
  assert.ok(existsSync(statusPath), 'fixture precondition: victim status.json must exist');
  const before = readFileSync(statusPath);

  // join(projectsRoot,'pb-legit','_project-brain', sessionId) must land on victimSession.
  const base = join(projectsRoot, 'pb-legit', '_project-brain');
  const sessionId = relative(base, victimSession);
  assert.equal(join(base, sessionId), victimSession, 'sanity: traversal must land on the victim session');

  const res = await post('/api/project-brain/brief', { project: 'pb-legit', sessionId, brief: 'PWNED-BRIEF-CONTENT-b02' });

  assert.equal(existsSync(join(victimSession, 'prompt.md')), false, `/brief must not write prompt.md via a traversing sessionId (status ${res.status})`);
  assert.deepEqual(readFileSync(statusPath), before, `/brief must not rewrite the victim status.json via a traversing sessionId (status ${res.status})`);
});

test('(RED) POST /api/project-brain/approve with a traversing body.project does not overwrite a victim status.json outside projectsRoot', async () => {
  const outside = newOutsideDir('sec04-pb-approve-outside-');
  const victimSession = join(outside, '_project-brain', 'vsess');
  plantBrainStatus(victimSession, { session_id: 'vsess', project: 'victim', phase: 'awaiting-review' });
  const statusPath = join(victimSession, 'status.json');
  assert.ok(existsSync(statusPath), 'fixture precondition: victim status.json must exist');
  const before = readFileSync(statusPath);

  const project = relative(projectsRoot, outside);
  const res = await post('/api/project-brain/approve', { project, sessionId: 'vsess' });

  assert.deepEqual(
    readFileSync(statusPath),
    before,
    `/approve must not flip a victim status.json's phase (it writes phase="committing") outside projectsRoot (status ${res.status})`,
  );
});

test('(RED) POST /api/project-brain/abandon with a traversing body.project does not overwrite a victim status.json outside projectsRoot', async () => {
  const outside = newOutsideDir('sec04-pb-abandon-outside-');
  const victimSession = join(outside, '_project-brain', 'vsess');
  plantBrainStatus(victimSession, { session_id: 'vsess', project: 'victim', phase: 'awaiting-review' });
  const statusPath = join(victimSession, 'status.json');
  assert.ok(existsSync(statusPath), 'fixture precondition: victim status.json must exist');
  const before = readFileSync(statusPath);

  const project = relative(projectsRoot, outside);
  const res = await post('/api/project-brain/abandon', { project, sessionId: 'vsess' });

  assert.deepEqual(
    readFileSync(statusPath),
    before,
    `/abandon must not flip a victim status.json's phase (it writes phase="abandoned") outside projectsRoot (status ${res.status})`,
  );
});

// ===========================================================================
// PROJECT-BRAIN: GET /themes/:project/:sessionId — %2F-encoded traversal.
// Zero validation + decodeURIComponent + join + read+return .md CONTENT.
// ===========================================================================

test('(RED) GET /api/project-brain/themes with a %2F-encoded traversing project must not disclose staged themes from outside projectsRoot', async () => {
  const outside = newOutsideDir('sec04-pb-themes-project-outside-');
  // readStagedThemes reads join(projectsRoot, project, '_project-brain', sessionId, 'themes').
  const victimThemes = join(outside, '_project-brain', 'vsess', 'themes');
  mkdirSync(victimThemes, { recursive: true });
  writeFileSync(join(victimThemes, 'secret.md'), 'PWNED-THEME-CONTENT-c03d');
  assert.ok(existsSync(join(victimThemes, 'secret.md')), 'fixture precondition: victim theme file must exist');

  const projDecoded = relative(projectsRoot, outside);
  assert.equal(join(projectsRoot, projDecoded, '_project-brain', 'vsess', 'themes'), victimThemes, 'sanity: decode-then-join must land on the victim themes dir');
  // Encode the project segment so it survives the route regex's real-slash
  // boundary and is only revealed by decodeURIComponent.
  const rawPath = `/api/project-brain/themes/${encodeSlashes(projDecoded)}/vsess`;

  const { status, body } = await rawGet(bridgeUrl, rawPath);
  assert.ok(
    !body.includes('PWNED-THEME-CONTENT-c03d'),
    `a %2F-smuggled ".." in the themes "project" segment must not disclose an out-of-root staged theme's content — status ${status}: ${body}`,
  );
});

test('(RED) GET /api/project-brain/themes with a real project but a %2F-encoded traversing sessionId must not disclose themes from outside projectsRoot', async () => {
  const outside = newOutsideDir('sec04-pb-themes-session-outside-');
  const victimThemes = join(outside, 'themes');
  mkdirSync(victimThemes, { recursive: true });
  writeFileSync(join(victimThemes, 'secret.md'), 'PWNED-THEME-CONTENT-d04e');
  assert.ok(existsSync(join(victimThemes, 'secret.md')), 'fixture precondition: victim theme file must exist');

  // readStagedThemes: join(join(projectsRoot,'pb-legit','_project-brain', sessionId), 'themes') == victimThemes.
  const sessionBase = join(projectsRoot, 'pb-legit', '_project-brain');
  const sessDecoded = relative(sessionBase, outside);
  assert.equal(join(sessionBase, sessDecoded, 'themes'), victimThemes, 'sanity: decode-then-join must land on the victim themes dir');
  const rawPath = `/api/project-brain/themes/pb-legit/${encodeSlashes(sessDecoded)}`;

  const { status, body } = await rawGet(bridgeUrl, rawPath);
  assert.ok(
    !body.includes('PWNED-THEME-CONTENT-d04e'),
    `a %2F-smuggled ".." in the themes "sessionId" segment must not disclose an out-of-root staged theme's content — status ${status}: ${body}`,
  );
});

// ===========================================================================
// AT-47 symlink LIST shape — the OBSERVING surfaces enumerate a victim dir
// reached through a symlinked _<kind> entry.
// ===========================================================================

test('(RED) GET /api/project-brain/sessions must not enumerate sessions reached through a symlinked _project-brain entry', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  const outside = newOutsideDir('sec04-pb-list-symlink-outside-');
  // The victim dir holds a session whose status.json must never be disclosed.
  plantBrainStatus(join(outside, 'victim-pb-sess'), { session_id: 'PWNED-PB-LIST-SESSION-e05f', project: 'victim', phase: 'awaiting-review' });
  assert.ok(existsSync(join(outside, 'victim-pb-sess', 'status.json')), 'fixture precondition: victim session status must exist');

  // Plant projects/attacker-pb/_project-brain as a SYMLINK to the victim dir.
  mkdirSync(join(projectsRoot, 'attacker-pb'), { recursive: true });
  symlinkSync(outside, join(projectsRoot, 'attacker-pb', '_project-brain'), 'dir');

  const res = await fetch(`${bridgeUrl}/api/project-brain/sessions`);
  const json = (await res.json()) as { sessions: ProjectBrainStatus[] };
  assert.ok(
    !json.sessions.some((s) => s.session_id === 'PWNED-PB-LIST-SESSION-e05f'),
    `listProjectBrainSessions must not follow a symlinked _project-brain into a victim dir and disclose its session — got ${JSON.stringify(json.sessions.map((s) => s.session_id))}`,
  );
});

test('(RED) GET /api/demo-builder/sessions must not enumerate sessions reached through a symlinked _demo entry', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  const outside = newOutsideDir('sec04-demo-list-symlink-outside-');
  plantDemoStatus(join(outside, 'victim-demo-sess'), {
    session_id: 'PWNED-DEMO-LIST-SESSION-f06a',
    project: 'victim',
    project_repo_path: join(projectsRoot, 'legit-demo-project'),
  });
  assert.ok(existsSync(join(outside, 'victim-demo-sess', 'status.json')), 'fixture precondition: victim demo session status must exist');

  mkdirSync(join(projectsRoot, 'attacker-demo-list'), { recursive: true });
  symlinkSync(outside, join(projectsRoot, 'attacker-demo-list', '_demo'), 'dir');

  const res = await fetch(`${bridgeUrl}/api/demo-builder/sessions`);
  const json = (await res.json()) as { sessions: Array<{ sessionId: string }> };
  assert.ok(
    !json.sessions.some((s) => s.sessionId === 'PWNED-DEMO-LIST-SESSION-f06a'),
    `listDemoSessions must not follow a symlinked _demo into a victim dir and disclose its session — got ${JSON.stringify(json.sessions.map((s) => s.sessionId))}`,
  );
});

// ===========================================================================
// DEMO first-segment symlink fold — resolveDemoSessionDir root-folds the
// untrusted `project` segment into its own realpath baseline. The CHARSET
// shape is already guarded (SEC-03); the SYMLINK first-segment shape is proven
// RED here through the REAL /demo/ route.
// ===========================================================================

test('(RED) GET /api/demo-builder/demo/<project>/<sid> must not traverse a project that is a SYMLINK to a victim dir outside projectsRoot', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  const outside = newOutsideDir('sec04-demo-symlink-fold-outside-');
  // Victim session outside projectsRoot; its project_repo_path points at a
  // legitimately-contained project holding a sentinel DEMO.html, so a
  // successful fold serves that sentinel (clean 200+bytes signal). Reaching
  // this status.json AT ALL already required following the symlinked project.
  plantDemoStatus(join(outside, '_demo', 'vsess'), {
    session_id: 'vsess',
    project: 'x',
    project_repo_path: join(projectsRoot, 'legit-demo-project'),
  });
  assert.ok(existsSync(join(outside, '_demo', 'vsess', 'status.json')), 'fixture precondition: victim demo status must exist');
  // Independent proof the served bytes could only come from the folded read:
  assert.equal(readFileSync(join(projectsRoot, 'legit-demo-project', '.forge', 'demo', 'DEMO.html'), 'utf8'), 'REAL-DEMO-CONTENT-3c88e');

  // projects/attacker-fold is a SYMLINK to the outside victim project dir.
  symlinkSync(outside, join(projectsRoot, 'attacker-fold'), 'dir');
  // Sanity: the symlinked project's realpath is genuinely outside projectsRoot.
  assert.ok(relative(projectsRoot, outside).split(sep)[0] === '..', 'sanity: the symlink target must be outside projectsRoot');

  const res = await fetch(`${bridgeUrl}/api/demo-builder/demo/attacker-fold/vsess`);
  const text = await res.text();
  assert.ok(
    !text.includes('REAL-DEMO-CONTENT-3c88e'),
    `resolveDemoSessionDir realpaths join(projectsRoot, project) as its baseline, so a symlinked "project" makes the containment check tautological — the route must refuse a symlinked first segment, not fold it and serve the session it points at — status ${res.status}: ${text}`,
  );
});
