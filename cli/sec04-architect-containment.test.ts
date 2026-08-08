/**
 * SEC-04 COMPLETENESS PINS — the architect module was systematically MISSED by
 * the session-route-containment fix (commit 2d5b1ab9). That fix routed the
 * instructions / project-brain / demo session families (and their runner legs)
 * through the canonical per-segment guard `resolveGuardedPath`
 * (`cli/studio-path-guard.ts`: identity + charset + symlink, null on any
 * escape), but THREE architect consumers — each using architect's OWN
 * reader/builders — still construct a request-derived session dir with a bare
 * `join(...)` and read/mutate through it with no containment check:
 *
 *   (1) listArchitectSessions (orchestrator/architect-runner.ts:1421)
 *       bare `join(projectsRoot, project, '_architect')` + `readStatus(join(archDir, sid))`.
 *       Reached by GET /api/architect/sessions. THE reproduced escape: a
 *       symlinked `projects/<p>/_architect` dir (a plain 120000 blob in git)
 *       is enumerated with no guard and every out-of-root `status.json` under
 *       it — idea, session_id, project_repo_path — is disclosed in the listing.
 *
 *   (2) applyPlanVerdict (cli/bridge-studio-runs.ts:586, `_architectSessionDir`
 *       at :91 = bare join, `_readStatus` at :95). Reached by POST
 *       /api/plan-verdict (and POST /api/runs/:id/gates/plan). CHARSET-gated
 *       (SLUG_RE on project, SAFE_ID_RE on sessionId) — but charset does NOT
 *       catch a symlinked `_architect` DIR (AT-47): a valid-charset
 *       project+sessionId still resolves, through the symlink, to an
 *       out-of-root session, whose status.json is read AND mutated
 *       (reject -> phase:'rejected' rewritten out of root).
 *
 *   (3) runArchitectTurn (orchestrator/architect-runner.ts:208) —
 *       `sessionPaths(input.projectRoot, input.sessionId).sessionDir` (a bare
 *       `resolve(projectRoot,'_architect',sessionId)`) + `readStatus`. The
 *       RUNNER LEG: the other three runners were contained in the fix; the
 *       architect's runner was missed. A traversing sessionId, OR a symlinked
 *       `_architect`, reads an out-of-root status.json with no refusal.
 *
 * The canonical guard is `resolveGuardedPath(root, segments[])` from
 * cli/studio-path-guard.ts (orchestrator -> cli import is precedent, SEC-01).
 *
 * DISCIPLINE (mirrors the proven SEC-04 harness): real scratch fs; victims
 * planted OUTSIDE both projectsRoot AND forgeRoot (sibling tmp dirs — any
 * sentinel that surfaces proves an out-of-root escape); real
 * `startBridge(port:0)`; `x-forge-csrf:1`; preconditions asserted BEFORE the
 * verdict/turn; no bald sleeps. "Contained" is asserted by EXECUTION only.
 *
 * RED-ON-CURRENT-CODE: every `(RED)` test below FAILS on the unfixed worktree
 * (HEAD 2d5b1ab9 — the fix skipped the architect module). The positive
 * controls pass before AND after any fix.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  symlinkSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';
import { runArchitectTurn } from '../orchestrator/architect-runner.ts';

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
 *  any file/field that surfaces from here proves an out-of-root escape. */
function newOutsideDir(prefix: string): string {
  const d = tmp(prefix);
  outsideDirs.push(d);
  return d;
}

/** Plant a full architect `status.json` at `dir` (the victim's own on-disk
 *  location, wherever that is). */
function plantStatusJson(dir: string, status: Record<string, unknown>): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'status.json'),
    JSON.stringify({ updated_at: new Date().toISOString(), ...status }, null, 2),
  );
}

async function postJson(path: string, body: unknown): Promise<{ status: number; text: string }> {
  const res = await fetch(`${bridgeUrl}${path}`, {
    method: 'POST',
    headers: CSRF,
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

function is4xx(status: number): boolean {
  return status >= 400 && status < 500;
}

function skipIfNoSymlinks(t: { skip: (msg?: string) => void }): boolean {
  if (symlinksUnavailable) {
    t.skip('symlink creation unavailable in this environment');
    return true;
  }
  return false;
}

before(async () => {
  forgeRoot = tmp('sec04-arch-forge-');
  projectsRoot = join(forgeRoot, 'projects');
  mkdirSync(projectsRoot, { recursive: true });
  mkdirSync(join(forgeRoot, '_queue', 'pending'), { recursive: true });
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });

  // A real, legitimately-shaped in-root project — the base for the positive
  // controls and the sessionId-only traversal vector.
  mkdirSync(join(projectsRoot, 'legit', '_architect'), { recursive: true });

  // Probe symlink availability once (the symlinked-_architect vectors skip
  // cleanly where the fs cannot make one; the traversing-sessionId vector does
  // not need symlinks and always runs).
  const probe = tmp('sec04-arch-symlink-probe-');
  try {
    symlinkSync(probe, join(projectsRoot, '__symlink_probe__'), 'dir');
  } catch {
    symlinksUnavailable = true;
  }
  rmSync(join(projectsRoot, '__symlink_probe__'), { force: true });
  rmSync(probe, { recursive: true, force: true });

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeBridge = result.close;
});

after(async () => {
  if (closeBridge) await closeBridge();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
  for (const d of outsideDirs) rmSync(d, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Positive controls (mandatory) — MUST pass before AND after any fix, so the
// RED tests below are proven to fail for the ESCAPE, not for harness reasons.
// ---------------------------------------------------------------------------

test('positive control: GET /api/architect/sessions lists a legit in-root session and discloses its idea (that is the intended behaviour)', async () => {
  const sid = 'legit-ctrl-session';
  plantStatusJson(join(projectsRoot, 'legit', '_architect', sid), {
    session_id: sid,
    project: 'legit',
    project_repo_path: join(projectsRoot, 'legit'),
    phase: 'awaiting-verdict',
    round: 1,
    idea: 'LEGIT-IN-ROOT-IDEA',
  });
  const res = await fetch(`${bridgeUrl}/api/architect/sessions`);
  const text = await res.text();
  assert.equal(res.status, 200, `sessions listing should respond 200 — got ${res.status}: ${text}`);
  assert.ok(text.includes(sid), `a legit in-root session MUST be listed — body: ${text}`);
  assert.ok(text.includes('LEGIT-IN-ROOT-IDEA'), 'a legit in-root idea is disclosed by design');
});

test('positive control: runArchitectTurn on a legit in-root awaiting-verdict session returns cleanly (no throw)', async () => {
  const sid = 'legit-runner-ctrl';
  plantStatusJson(join(projectsRoot, 'legit', '_architect', sid), {
    session_id: sid,
    project: 'legit',
    project_repo_path: join(projectsRoot, 'legit'),
    phase: 'awaiting-verdict',
    round: 1,
    idea: 'legit',
  });
  const r = await runArchitectTurn({
    sessionId: sid,
    projectRoot: join(projectsRoot, 'legit'),
    logsRoot: join(forgeRoot, '_logs'),
    brainCwd: forgeRoot,
    queryFn: (() => {
      throw new Error('queryFn must NOT be called for a waiting phase');
    }) as never,
  });
  assert.equal(r.phase, 'awaiting-verdict', 'a waiting phase is returned unchanged, no LLM call');
});

// ===========================================================================
// Consumer (1): GET /api/architect/sessions -> listArchitectSessions
//   symlinked projects/<p>/_architect -> out-of-root victim disclosed
// ===========================================================================

test('(RED) GET /api/architect/sessions discloses an out-of-root architect session reached through a symlinked _architect dir', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  const outside = newOutsideDir('sec04-arch-sessions-symlink-outside-');
  const SENTINEL_ID = 'PWNED-ARCH-SESSIONS-SESSIONID-9f3ac';
  const SENTINEL_IDEA = 'PWNED-ARCH-SESSIONS-IDEA-9f3ac';

  // A victim architect session living entirely OUTSIDE projectsRoot/forgeRoot.
  plantStatusJson(join(outside, 'victim-session'), {
    session_id: SENTINEL_ID,
    project: 'attacker',
    project_repo_path: '/etc/PWNED-ARCH-SESSIONS-REPO',
    phase: 'awaiting-verdict',
    round: 1,
    idea: SENTINEL_IDEA,
  });

  // An ordinary in-root project whose `_architect` dir is a symlink to it —
  // plantable by a plain git commit (git tracks symlinks as 120000 blobs).
  mkdirSync(join(projectsRoot, 'attacker'), { recursive: true });
  symlinkSync(outside, join(projectsRoot, 'attacker', '_architect'), 'dir');

  const res = await fetch(`${bridgeUrl}/api/architect/sessions`);
  const text = await res.text();
  assert.equal(res.status, 200, `sessions listing should respond 200 — got ${res.status}: ${text}`);
  assert.ok(
    !text.includes(SENTINEL_ID) && !text.includes(SENTINEL_IDEA),
    `listArchitectSessions readdir's + readStatus's through a symlinked _architect with NO containment — an out-of-root session's session_id/idea are disclosed in the listing — body: ${text}`,
  );
});

// ===========================================================================
// Consumer (2): POST /api/plan-verdict -> applyPlanVerdict
//   VALID-charset project+sessionId, symlinked _architect DIR (AT-47) ->
//   out-of-root victim status.json read AND mutated
// ===========================================================================

test('(RED) POST /api/plan-verdict with a valid-charset project+sessionId but a symlinked _architect dir must REFUSE, and the out-of-root victim status.json must NOT be read or mutated', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  const outside = newOutsideDir('sec04-arch-verdict-symlink-outside-');
  const sid = 'victim-verdict-session'; // passes SAFE_ID_RE
  const project = 'attackertwo'; // passes SLUG_RE (lowercase, no leading digit)

  // Victim session OUTSIDE root, awaiting a verdict (so a reject WOULD act).
  const victimDir = join(outside, sid);
  plantStatusJson(victimDir, {
    session_id: sid,
    project,
    project_repo_path: '/etc/PWNED-ARCH-VERDICT-REPO',
    phase: 'awaiting-verdict',
    round: 1,
    idea: 'victim-verdict-idea',
  });
  const before = readFileSync(join(victimDir, 'status.json'), 'utf8');
  assert.ok(before.includes('"phase": "awaiting-verdict"'), 'precondition: victim awaits a verdict');
  assert.equal(existsSync(join(victimDir, 'feedback.md')), false, 'precondition: no feedback.md yet');

  // In-root project whose `_architect` is a symlink to the outside victim root.
  mkdirSync(join(projectsRoot, project), { recursive: true });
  symlinkSync(outside, join(projectsRoot, project, '_architect'), 'dir');

  const { status, text } = await postJson('/api/plan-verdict', { project, sessionId: sid, kind: 'reject' });

  // 1. The handler must refuse the escape (charset passed, but the symlinked
  //    _architect dir is an out-of-root resolution the guard must catch).
  assert.ok(
    is4xx(status),
    `plan-verdict through a symlinked _architect must be REFUSED (4xx) — a 200 means it read the out-of-root session and acted — status ${status}: ${text}`,
  );
  // 2. The out-of-root status.json must be neither read-into-action nor
  //    mutated: on a successful reject the handler rewrites phase:'rejected'.
  const after = readFileSync(join(victimDir, 'status.json'), 'utf8');
  assert.equal(
    after,
    before,
    'the out-of-root victim status.json MUST be byte-identical — a reject through the symlink rewrote it to phase:"rejected"',
  );
  assert.equal(
    existsSync(join(victimDir, 'feedback.md')),
    false,
    'no feedback.md may be written beside the out-of-root victim status.json',
  );
});

// ===========================================================================
// Consumer (3): runArchitectTurn (the RUNNER LEG) — no HTTP boundary
//   3a: symlinked _architect dir -> out-of-root read, must refuse
//   3b: traversing sessionId    -> out-of-root read, must refuse
// ===========================================================================

test('(RED) runArchitectTurn with a symlinked _architect dir must REFUSE (throw) rather than read the out-of-root status.json', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  const outside = newOutsideDir('sec04-arch-runner-symlink-outside-');
  const sid = 'victim-runner-session';
  const project = 'attackerthree';

  // Victim awaits a verdict -> a WAITING phase the runner returns unchanged,
  // so the ONLY way it throws is a containment refusal (no unrelated LLM path).
  plantStatusJson(join(outside, sid), {
    session_id: sid,
    project,
    project_repo_path: '/etc/PWNED-ARCH-RUNNER-REPO',
    phase: 'awaiting-verdict',
    round: 1,
    idea: 'victim-runner-idea',
  });

  const projectRoot = join(projectsRoot, project);
  mkdirSync(projectRoot, { recursive: true });
  symlinkSync(outside, join(projectRoot, '_architect'), 'dir');

  let threw = false;
  let result: unknown;
  try {
    result = await runArchitectTurn({
      sessionId: sid,
      projectRoot,
      logsRoot: join(forgeRoot, '_logs'),
      brainCwd: forgeRoot,
      queryFn: (() => {
        throw new Error('queryFn must NOT be reached');
      }) as never,
    });
  } catch {
    threw = true;
  }
  assert.ok(
    threw,
    `runArchitectTurn (the architect RUNNER LEG) resolved sessionPaths through a symlinked _architect and read the out-of-root status.json with no refusal — it returned ${JSON.stringify(result)} (the out-of-root phase) instead of throwing`,
  );
});

test('(RED) runArchitectTurn with a traversing sessionId must REFUSE (throw) rather than read an out-of-root status.json', async () => {
  const outside = newOutsideDir('sec04-arch-runner-traverse-outside-');
  const victimDir = join(outside, 'victim');
  plantStatusJson(victimDir, {
    session_id: 'x',
    project: 'legit',
    project_repo_path: '/etc/PWNED-ARCH-RUNNER-TRAVERSE-REPO',
    phase: 'awaiting-verdict',
    round: 1,
    idea: 'victim-traverse-idea',
  });

  const projectRoot = join(projectsRoot, 'legit');
  // sessionPaths does resolve(projectRoot, '_architect', sessionId); a `../`
  // sessionId escapes both projectsRoot and forgeRoot to the planted victim.
  const traversingSid = relative(join(projectRoot, '_architect'), victimDir);
  assert.ok(traversingSid.startsWith('..'), `precondition: sessionId traverses out — got "${traversingSid}"`);

  let threw = false;
  let result: unknown;
  try {
    result = await runArchitectTurn({
      sessionId: traversingSid,
      projectRoot,
      logsRoot: join(forgeRoot, '_logs'),
      brainCwd: forgeRoot,
      queryFn: (() => {
        throw new Error('queryFn must NOT be reached');
      }) as never,
    });
  } catch {
    threw = true;
  }
  assert.ok(
    threw,
    `runArchitectTurn resolved a "../"-traversing sessionId to an out-of-root session dir and read its status.json with no refusal — it returned ${JSON.stringify(result)} instead of throwing`,
  );
});
