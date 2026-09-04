/**
 * ACCEPTANCE PINS (SEC-04, bd forge-ebj) — the INSTRUCTIONS + ARCHITECT route
 * families build their session dir straight from request-supplied `project` /
 * `sessionId` via an unguarded `join()`:
 *
 *   architectSessionDir(projectsRoot, project, sessionId)
 *     = join(projectsRoot, project, '_architect', sessionId)
 *   instructionsSessionDir(join(projectsRoot, project), sessionId)
 *     = join(projectsRoot, project, '_instructions', sessionId)
 *
 * Neither goes through the fixed `resolveSafeSessionDir`
 * (cli/bridge-studio-sessions.ts → resolveGuardedPath, per-segment
 * identity+charset+symlink). So a `..`-laden `project` OR `sessionId` escapes
 * `projectsRoot` entirely, and the two GET `/file/` routes' only check —
 *   base     = <sessionDir> + sep
 *   requested = join(<sessionDir>, filename)
 *   requested.startsWith(base)
 * — is SELF-DEFEATING: `base` and `requested` are both built from the SAME
 * untrusted project/sessionId, so a traversal in either is invisible to it
 * (`join()` only normalises `..` inside `filename`, which is a different
 * component). A traversed project/sid lands `base` OUTSIDE the root and any
 * `filename` under it is served.
 *
 * TWO WRITE SHAPES:
 *   - `/start` (architect + instructions) is an UNCONDITIONED mkdir+write: no
 *     read-precondition, no pre-existing victim needed. A traversal `project`
 *     with a fresh, empty target still creates `<outside>/_architect/<sid>/`
 *     (idea.md + status.json) or `<outside>/_instructions/<sid>/` (status.json).
 *     Pinned as "no out-of-root directory or file is created AT ALL".
 *   - brief/answer/verdict/rerun read status.json first (readStatus /
 *     readSessionStatus → null ⇒ 404), so the pin plants a victim status.json
 *     at the exact traversed location OUTSIDE the root; today the route reads
 *     it (read-escape) and writes its own artifact (answers.json / prompt.md /
 *     feedback.md) beside it (write-escape). Pinned as: 4xx AND that artifact
 *     is never created out of root.
 *
 * WIRE MECHANICS: the traversal for the POST routes rides in the JSON BODY, so
 * a plain `fetch()` with the shipped `x-forge-csrf: 1` header carries it
 * verbatim (CSRF is presence-only and NOT a mitigation — the payload is
 * same-origin-shaped). The two GET `/file/` routes read the traversal from the
 * URL path, `split('/')`-then-`decodeURIComponent`, so a literal `/` in
 * `project` must be `%2F`-smuggled and issued RAW via `node:http` (fetch would
 * normalise it away) — mirroring the R4-16 demo-builder containment file.
 *
 * FALSE-NEGATIVE DISCIPLINE (immutable-gates): every fixture precondition is
 * asserted BEFORE the verdict is read (victim status.json present; the
 * to-be-written artifact ABSENT; the outside dir a genuine step outside
 * projectsRoot). "Contained" is execution-only. Real scratch fs only; victims
 * planted OUTSIDE both projectsRoot AND forgeRoot (siblings under os.tmpdir()).
 *
 * RED-ON-CURRENT-CODE: every `(RED)` test below FAILS on the unfixed worktree
 * (the escape goes through today). The positive controls pass before AND after
 * any fix.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  symlinkSync,
} from 'node:fs';
import { join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { request as httpRequest } from 'node:http';
import { URL } from 'node:url';

import { startBridge } from './ui-bridge.ts';

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

let forgeRoot: string;
let projectsRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;
const outsideDirs: string[] = [];
let symlinksUnavailable = false;

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' } as const;

/** A scratch dir OUTSIDE projectsRoot AND forgeRoot (sibling under tmpdir) —
 *  any file that appears here proves an out-of-root escape. */
function newOutsideDir(prefix: string): string {
  const d = tmp(prefix);
  outsideDirs.push(d);
  return d;
}

/** Percent-encode every literal "/" as "%2F": the file routes `split('/')` the
 *  RAW url before `decodeURIComponent`, so this keeps a multi-segment `..`
 *  traversal as a SINGLE `project` component that only decodes after the split. */
function encodeSlashes(p: string): string {
  return p.split('/').map(encodeURIComponent).join('%2F');
}

/** Raw HTTP GET issuing EXACTLY `rawPath` on the wire (no URL-parser
 *  normalisation), unlike `fetch()` — the only way the `%2F` shapes reach the
 *  server encoded rather than folded client-side. */
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

async function postJson(path: string, body: unknown): Promise<{ status: number; text: string }> {
  const res = await fetch(`${bridgeUrl}${path}`, { method: 'POST', headers: CSRF, body: JSON.stringify(body) });
  return { status: res.status, text: await res.text() };
}

function plantStatusJson(dir: string, status: Record<string, unknown>): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'status.json'), JSON.stringify({ ...status, updated_at: new Date().toISOString() }, null, 2));
}

function is4xx(status: number): boolean {
  return status >= 400 && status < 500;
}

before(async () => {
  forgeRoot = tmp('sec04-forge-');
  projectsRoot = join(forgeRoot, 'projects');
  mkdirSync(projectsRoot, { recursive: true });
  mkdirSync(join(forgeRoot, '_queue', 'pending'), { recursive: true });
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'flows'), { recursive: true });
  mkdirSync(join(forgeRoot, 'skills'), { recursive: true });

  // A real, legitimately-shaped in-root project — the base for the
  // sessionId-only traversal vectors and the positive controls.
  mkdirSync(join(projectsRoot, 'legit'), { recursive: true });

  // Probe symlink availability once (the sessions-enumeration + symlink-fold
  // pins skip cleanly where the fs cannot make one).
  const probe = tmp('sec04-symlink-probe-');
  try {
    symlinkSync(probe, join(projectsRoot, '__symlink_probe__'), 'dir');
  } catch {
    symlinksUnavailable = true;
  }
  rmSync(join(projectsRoot, '__symlink_probe__'), { force: true });
  rmSync(probe, { recursive: true, force: true });

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
});

function skipIfNoSymlinks(t: { skip: (msg?: string) => void }): boolean {
  if (symlinksUnavailable) {
    t.skip('symlink creation unavailable in this environment');
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Positive controls (mandatory) — MUST pass before AND after any fix.
// ---------------------------------------------------------------------------

test('positive control: POST /api/instructions/start with an in-root project creates the session UNDER projectsRoot and returns 200', async () => {
  const { status, text } = await postJson('/api/instructions/start', { project: 'legit' });
  assert.equal(status, 200, `legit instructions/start must succeed — got ${status}: ${text}`);
  const sid = (JSON.parse(text) as { sessionId?: string }).sessionId;
  assert.ok(sid, `expected a sessionId — got: ${text}`);
  assert.ok(
    existsSync(join(projectsRoot, 'legit', '_instructions', sid!)),
    'the legit session dir must be created inside projectsRoot',
  );
});

test('positive control: POST /api/architect/start with an in-root project creates the session UNDER projectsRoot and returns 200', async () => {
  const { status, text } = await postJson('/api/architect/start', { project: 'legit', idea: 'a real idea' });
  assert.equal(status, 200, `legit architect/start must succeed — got ${status}: ${text}`);
  const sid = (JSON.parse(text) as { sessionId?: string }).sessionId;
  assert.ok(sid, `expected a sessionId — got: ${text}`);
  assert.ok(
    existsSync(join(projectsRoot, 'legit', '_architect', sid!)),
    'the legit architect session dir must be created inside projectsRoot',
  );
});

// ===========================================================================
// ARCHITECT family
// ===========================================================================

// --- /start : UNCONDITIONED write, project traversal, NO victim needed ------

test('(RED) POST /api/architect/start with a "../.." project writes idea.md/status.json OUTSIDE projectsRoot with no pre-existing victim', async () => {
  const outside = newOutsideDir('sec04-arch-start-outside-');
  const rel = relative(projectsRoot, outside);
  assert.equal(rel.split(sep)[0], '..', 'sanity: the traversal string must genuinely step outside projectsRoot');
  // Precondition: nothing exists at the escape target yet.
  assert.equal(existsSync(join(outside, '_architect')), false, 'precondition: no _architect subtree out of root yet');

  const { status, text } = await postJson('/api/architect/start', { project: rel, idea: 'PWNED-ARCH-START-IDEA-a11ce' });

  assert.equal(
    existsSync(join(outside, '_architect')),
    false,
    `architect/start is an UNCONDITIONED mkdir+write — a "../.." project must NOT create an out-of-root _architect session (it writes idea.md=body.idea today) — status ${status}: ${text}`,
  );
  assert.ok(is4xx(status), `a traversal project must be rejected 4xx — got ${status}: ${text}`);
});

// --- answer : project traversal (planted victim, phase awaiting-answers) ----

test('(RED) POST /api/architect/answer with a "../.." project reads+writes a victim session OUTSIDE projectsRoot', async () => {
  const outside = newOutsideDir('sec04-arch-answer-project-outside-');
  const rel = relative(projectsRoot, outside);
  const victimDir = join(outside, '_architect', 'sess-arch-answer-a');
  plantStatusJson(victimDir, { session_id: 'sess-arch-answer-a', project: 'irrelevant', phase: 'awaiting-answers', round: 1 });
  assert.ok(existsSync(join(victimDir, 'status.json')), 'precondition: victim status.json planted');
  assert.equal(existsSync(join(victimDir, 'answers.json')), false, 'precondition: no answers.json yet');

  const { status, text } = await postJson('/api/architect/answer', {
    project: rel,
    sessionId: 'sess-arch-answer-a',
    answers: [{ question: 'q', answer: 'PWNED-ARCH-ANSWER-b22df' }],
  });

  assert.equal(
    existsSync(join(victimDir, 'answers.json')),
    false,
    `a "../.." project must NOT let architect/answer write answers.json beside an out-of-root status.json — status ${status}: ${text}`,
  );
  assert.ok(is4xx(status), `a traversal project must be rejected 4xx — got ${status}: ${text}`);
});

// --- answer : sessionId traversal (valid in-root project) -------------------

test('(RED) POST /api/architect/answer with a valid project but "../.." sessionId escapes projectsRoot', async () => {
  const outside = newOutsideDir('sec04-arch-answer-sid-outside-');
  const victimDir = join(outside, 'sess-arch-answer-sid');
  plantStatusJson(victimDir, { session_id: 'x', project: 'legit', phase: 'awaiting-answers', round: 1 });
  const sid = relative(join(projectsRoot, 'legit', '_architect'), victimDir);
  assert.equal(sid.split(sep)[0], '..', 'sanity: sessionId must step outside');
  assert.ok(existsSync(join(victimDir, 'status.json')), 'precondition: victim status.json planted');
  assert.equal(existsSync(join(victimDir, 'answers.json')), false, 'precondition: no answers.json yet');

  const { status, text } = await postJson('/api/architect/answer', {
    project: 'legit',
    sessionId: sid,
    answers: [{ question: 'q', answer: 'PWNED-ARCH-ANSWER-SID-c33ef' }],
  });

  assert.equal(
    existsSync(join(victimDir, 'answers.json')),
    false,
    `a "../.." sessionId (real project) must NOT let architect/answer write out of root — status ${status}: ${text}`,
  );
  assert.ok(is4xx(status), `a traversal sessionId must be rejected 4xx — got ${status}: ${text}`);
});

// --- rerun : read-escape (200-with-planted-outside-victim == it read out of root) ---

test('(RED) POST /api/architect/rerun with a "../.." project resolves+reads a victim session OUTSIDE projectsRoot (returns 200 instead of rejecting)', async () => {
  const outside = newOutsideDir('sec04-arch-rerun-outside-');
  const rel = relative(projectsRoot, outside);
  const victimDir = join(outside, '_architect', 'sess-arch-rerun');
  plantStatusJson(victimDir, { session_id: 'sess-arch-rerun', project: 'irrelevant', phase: 'interviewing', round: 1 });
  assert.ok(existsSync(join(victimDir, 'status.json')), 'precondition: victim status.json planted');

  const { status, text } = await postJson('/api/architect/rerun', { project: rel, sessionId: 'sess-arch-rerun' });

  // Read-only route: no artifact/disclosure, so the containment signal is the
  // verdict. Today it 200s BECAUSE it read the out-of-root status.json (a
  // contained route can't find the session and must 4xx).
  assert.ok(
    is4xx(status),
    `rerun must not resolve a "../.." project to an out-of-root session — a 200 proves it read the escaped status.json — status ${status}: ${text}`,
  );
});

// --- file GET : self-defeating startsWith, arbitrary filename under a traversed project ---

test('(RED) GET /api/architect/file with a %2F-smuggled "../.." project serves an arbitrary file OUTSIDE projectsRoot', async () => {
  const outside = newOutsideDir('sec04-arch-file-outside-');
  const rel = relative(projectsRoot, outside);
  const escapedSessionDir = join(outside, '_architect', 'sess-arch-file');
  mkdirSync(escapedSessionDir, { recursive: true });
  writeFileSync(join(escapedSessionDir, 'SECRET-ARCH.txt'), 'PWNED-ARCH-FILE-CONTENT-d44a0');
  assert.ok(existsSync(join(escapedSessionDir, 'SECRET-ARCH.txt')), 'precondition: out-of-root secret planted');

  const rawPath = `/api/architect/file/${encodeSlashes(rel)}/sess-arch-file/SECRET-ARCH.txt`;
  const { status, body } = await rawGet(bridgeUrl, rawPath);

  assert.ok(
    !body.includes('PWNED-ARCH-FILE-CONTENT-d44a0'),
    `the startsWith(base) check is tautological when project/sid are traversed (base and requested share them) — an arbitrary out-of-root file is served — status ${status}: ${body}`,
  );
  assert.ok(is4xx(status), `a traversed project/sid file read must be rejected 4xx — got ${status}: ${body}`);
});

// ===========================================================================
// INSTRUCTIONS family
// ===========================================================================

// --- /start : UNCONDITIONED write, project traversal, NO victim needed ------

test('(RED) POST /api/instructions/start with a "../.." project writes status.json OUTSIDE projectsRoot with no pre-existing victim', async () => {
  const outside = newOutsideDir('sec04-instr-start-outside-');
  const rel = relative(projectsRoot, outside);
  assert.equal(rel.split(sep)[0], '..', 'sanity: the traversal string must genuinely step outside projectsRoot');
  assert.equal(existsSync(join(outside, '_instructions')), false, 'precondition: no _instructions subtree out of root yet');

  const { status, text } = await postJson('/api/instructions/start', { project: rel });

  assert.equal(
    existsSync(join(outside, '_instructions')),
    false,
    `instructions/start is an UNCONDITIONED mkdir+write — a "../.." project must NOT create an out-of-root _instructions session — status ${status}: ${text}`,
  );
  assert.ok(is4xx(status), `a traversal project must be rejected 4xx — got ${status}: ${text}`);
});

// --- brief : project traversal + sessionId traversal ------------------------

test('(RED) POST /api/instructions/brief with a "../.." project writes prompt.md OUTSIDE projectsRoot', async () => {
  const outside = newOutsideDir('sec04-instr-brief-project-outside-');
  const rel = relative(projectsRoot, outside);
  const victimDir = join(outside, '_instructions', 'sess-instr-brief');
  plantStatusJson(victimDir, { session_id: 'sess-instr-brief', project: 'irrelevant', project_repo_path: victimDir, phase: 'briefing', round: 1, prompt: '' });
  assert.ok(existsSync(join(victimDir, 'status.json')), 'precondition: victim status.json planted');
  assert.equal(existsSync(join(victimDir, 'prompt.md')), false, 'precondition: no prompt.md yet');

  const { status, text } = await postJson('/api/instructions/brief', {
    project: rel,
    sessionId: 'sess-instr-brief',
    brief: 'PWNED-INSTR-BRIEF-e55b1',
  });

  assert.equal(
    existsSync(join(victimDir, 'prompt.md')),
    false,
    `a "../.." project must NOT let instructions/brief write prompt.md out of root — status ${status}: ${text}`,
  );
  assert.ok(is4xx(status), `a traversal project must be rejected 4xx — got ${status}: ${text}`);
});

test('(RED) POST /api/instructions/brief with a valid project but "../.." sessionId writes prompt.md OUTSIDE projectsRoot', async () => {
  const outside = newOutsideDir('sec04-instr-brief-sid-outside-');
  const victimDir = join(outside, 'sess-instr-brief-sid');
  plantStatusJson(victimDir, { session_id: 'x', project: 'legit', project_repo_path: victimDir, phase: 'briefing', round: 1, prompt: '' });
  const sid = relative(join(projectsRoot, 'legit', '_instructions'), victimDir);
  assert.equal(sid.split(sep)[0], '..', 'sanity: sessionId must step outside');
  assert.ok(existsSync(join(victimDir, 'status.json')), 'precondition: victim status.json planted');
  assert.equal(existsSync(join(victimDir, 'prompt.md')), false, 'precondition: no prompt.md yet');

  const { status, text } = await postJson('/api/instructions/brief', {
    project: 'legit',
    sessionId: sid,
    brief: 'PWNED-INSTR-BRIEF-SID-f66c2',
  });

  assert.equal(
    existsSync(join(victimDir, 'prompt.md')),
    false,
    `a "../.." sessionId (real project) must NOT let instructions/brief write out of root — status ${status}: ${text}`,
  );
  assert.ok(is4xx(status), `a traversal sessionId must be rejected 4xx — got ${status}: ${text}`);
});

// --- answer : project traversal + sessionId traversal -----------------------

test('(RED) POST /api/instructions/answer with a "../.." project writes answers.json OUTSIDE projectsRoot', async () => {
  const outside = newOutsideDir('sec04-instr-answer-project-outside-');
  const rel = relative(projectsRoot, outside);
  const victimDir = join(outside, '_instructions', 'sess-instr-answer');
  plantStatusJson(victimDir, { session_id: 'sess-instr-answer', project: 'irrelevant', project_repo_path: victimDir, phase: 'awaiting-answers', round: 1, prompt: '' });
  assert.ok(existsSync(join(victimDir, 'status.json')), 'precondition: victim status.json planted');
  assert.equal(existsSync(join(victimDir, 'answers.json')), false, 'precondition: no answers.json yet');

  const { status, text } = await postJson('/api/instructions/answer', {
    project: rel,
    sessionId: 'sess-instr-answer',
    answers: [{ question: 'q', answer: 'PWNED-INSTR-ANSWER-a77d3' }],
  });

  assert.equal(
    existsSync(join(victimDir, 'answers.json')),
    false,
    `a "../.." project must NOT let instructions/answer write answers.json out of root — status ${status}: ${text}`,
  );
  assert.ok(is4xx(status), `a traversal project must be rejected 4xx — got ${status}: ${text}`);
});

test('(RED) POST /api/instructions/answer with a valid project but "../.." sessionId writes answers.json OUTSIDE projectsRoot', async () => {
  const outside = newOutsideDir('sec04-instr-answer-sid-outside-');
  const victimDir = join(outside, 'sess-instr-answer-sid');
  plantStatusJson(victimDir, { session_id: 'x', project: 'legit', project_repo_path: victimDir, phase: 'awaiting-answers', round: 1, prompt: '' });
  const sid = relative(join(projectsRoot, 'legit', '_instructions'), victimDir);
  assert.equal(sid.split(sep)[0], '..', 'sanity: sessionId must step outside');
  assert.ok(existsSync(join(victimDir, 'status.json')), 'precondition: victim status.json planted');
  assert.equal(existsSync(join(victimDir, 'answers.json')), false, 'precondition: no answers.json yet');

  const { status, text } = await postJson('/api/instructions/answer', {
    project: 'legit',
    sessionId: sid,
    answers: [{ question: 'q', answer: 'PWNED-INSTR-ANSWER-SID-b88e4' }],
  });

  assert.equal(
    existsSync(join(victimDir, 'answers.json')),
    false,
    `a "../.." sessionId (real project) must NOT let instructions/answer write out of root — status ${status}: ${text}`,
  );
  assert.ok(is4xx(status), `a traversal sessionId must be rejected 4xx — got ${status}: ${text}`);
});

// --- verdict (revise → feedback.md) : project traversal + sessionId traversal ---

test('(RED) POST /api/instructions/verdict (revise) with a "../.." project writes feedback.md OUTSIDE projectsRoot', async () => {
  const outside = newOutsideDir('sec04-instr-verdict-project-outside-');
  const rel = relative(projectsRoot, outside);
  const victimDir = join(outside, '_instructions', 'sess-instr-verdict');
  plantStatusJson(victimDir, { session_id: 'sess-instr-verdict', project: 'irrelevant', project_repo_path: victimDir, phase: 'awaiting-verdict', round: 1, prompt: '' });
  assert.ok(existsSync(join(victimDir, 'status.json')), 'precondition: victim status.json planted');
  assert.equal(existsSync(join(victimDir, 'feedback.md')), false, 'precondition: no feedback.md yet');

  const { status, text } = await postJson('/api/instructions/verdict', {
    project: rel,
    sessionId: 'sess-instr-verdict',
    kind: 'revise',
    feedback: 'PWNED-INSTR-VERDICT-c99f5',
  });

  assert.equal(
    existsSync(join(victimDir, 'feedback.md')),
    false,
    `a "../.." project must NOT let instructions/verdict write feedback.md out of root — status ${status}: ${text}`,
  );
  assert.ok(is4xx(status), `a traversal project must be rejected 4xx — got ${status}: ${text}`);
});

test('(RED) POST /api/instructions/verdict (revise) with a valid project but "../.." sessionId writes feedback.md OUTSIDE projectsRoot', async () => {
  const outside = newOutsideDir('sec04-instr-verdict-sid-outside-');
  const victimDir = join(outside, 'sess-instr-verdict-sid');
  plantStatusJson(victimDir, { session_id: 'x', project: 'legit', project_repo_path: victimDir, phase: 'awaiting-verdict', round: 1, prompt: '' });
  const sid = relative(join(projectsRoot, 'legit', '_instructions'), victimDir);
  assert.equal(sid.split(sep)[0], '..', 'sanity: sessionId must step outside');
  assert.ok(existsSync(join(victimDir, 'status.json')), 'precondition: victim status.json planted');
  assert.equal(existsSync(join(victimDir, 'feedback.md')), false, 'precondition: no feedback.md yet');

  const { status, text } = await postJson('/api/instructions/verdict', {
    project: 'legit',
    sessionId: sid,
    kind: 'revise',
    feedback: 'PWNED-INSTR-VERDICT-SID-d00a6',
  });

  assert.equal(
    existsSync(join(victimDir, 'feedback.md')),
    false,
    `a "../.." sessionId (real project) must NOT let instructions/verdict write out of root — status ${status}: ${text}`,
  );
  assert.ok(is4xx(status), `a traversal sessionId must be rejected 4xx — got ${status}: ${text}`);
});

// --- file GET : self-defeating startsWith, arbitrary filename ---------------

test('(RED) GET /api/instructions/file with a %2F-smuggled "../.." project serves an arbitrary file OUTSIDE projectsRoot', async () => {
  const outside = newOutsideDir('sec04-instr-file-outside-');
  const rel = relative(projectsRoot, outside);
  const escapedSessionDir = join(outside, '_instructions', 'sess-instr-file');
  mkdirSync(escapedSessionDir, { recursive: true });
  writeFileSync(join(escapedSessionDir, 'SECRET-INSTR.txt'), 'PWNED-INSTR-FILE-CONTENT-e11b7');
  assert.ok(existsSync(join(escapedSessionDir, 'SECRET-INSTR.txt')), 'precondition: out-of-root secret planted');

  const rawPath = `/api/instructions/file/${encodeSlashes(rel)}/sess-instr-file/SECRET-INSTR.txt`;
  const { status, body } = await rawGet(bridgeUrl, rawPath);

  assert.ok(
    !body.includes('PWNED-INSTR-FILE-CONTENT-e11b7'),
    `the startsWith(base) check is tautological when project/sid are traversed — an arbitrary out-of-root file is served — status ${status}: ${body}`,
  );
  assert.ok(is4xx(status), `a traversed project/sid file read must be rejected 4xx — got ${status}: ${body}`);
});

// --- listInstructionsSessions : symlinked _instructions folds to out-of-root ---

test('(RED) GET /api/instructions/sessions discloses an out-of-root status.json reached through a symlinked _instructions dir', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  const outside = newOutsideDir('sec04-instr-sessions-symlink-outside-');
  const SENTINEL = 'PWNED-INSTR-SESSIONS-SYMLINK-f22c8';
  // A victim instructions session living entirely OUTSIDE projectsRoot.
  plantStatusJson(join(outside, 'sess-victim'), {
    session_id: SENTINEL,
    project: 'attacker',
    project_repo_path: SENTINEL,
    phase: 'committed',
    round: 1,
    prompt: '',
  });
  // An ordinary in-root project whose _instructions dir is a symlink to it —
  // plantable by a plain git commit (git tracks symlinks as 120000 blobs).
  mkdirSync(join(projectsRoot, 'attacker'), { recursive: true });
  symlinkSync(outside, join(projectsRoot, 'attacker', '_instructions'), 'dir');

  const res = await fetch(`${bridgeUrl}/api/instructions/sessions`);
  const text = await res.text();
  assert.equal(res.status, 200, `sessions listing should respond 200 — got ${res.status}: ${text}`);
  assert.ok(
    !text.includes(SENTINEL),
    `listInstructionsSessions readdir's + readSessionStatus's through a symlinked _instructions with no containment — an out-of-root session's fields are disclosed in the listing — body: ${text}`,
  );
});
