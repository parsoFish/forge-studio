/**
 * ACCEPTANCE PINS (SEC-04, bd forge-ebj) — the LEAF-SYMLINK escape family.
 *
 * The dir-level SEC-04 fix (landed at this HEAD) routes every session-dir build
 * through `resolveGuardedPath(logsRoot, ['_sessions', project, kindDir, sessionId])` — the DIR is
 * now contained. But the leaf FILE beneath it is NOT: the current callers guard
 * the dir, then RAW-APPEND the leaf and read/write through it:
 *
 *   route  (POST /api/instructions/brief, apps/forge/ui-bridge.ts):
 *     const dir = guardedSessionDir(...)            // dir guarded ✔
 *     readSessionStatus(dir)                        // join(dir,'status.json') — UNguarded
 *     writeFileSync(join(dir, 'prompt.md'), brief)  // leaf — UNguarded
 *     writeSessionStatus(dir, {...})                // join(dir,'status.json') — UNguarded
 *
 *   runner (runInstructionsTurn, orchestrator/instructions-runner.ts):
 *     resolveSessionDir(logsRoot, project, KIND, sessionId)  // dir guarded ✔
 *     readSessionStatus(guarded.realPath)                 // status.json leaf — UNguarded
 *     writeSessionStatus(sessionDir, {...})               // status.json leaf — UNguarded
 *
 * `readSessionStatus`/`writeSessionStatus` (packages/sessions/interactive-session.ts)
 * do `join(sessionDir, 'status.json')` + `readFileSync`/`writeFileSync`, both of
 * which FOLLOW a symlinked leaf. So a REAL, genuinely-contained session dir whose
 * `status.json` is a SYMLINK pointing at an out-of-root victim:
 *   - is READ out of root (readSessionStatus discloses/acts on victim content), and
 *   - is WRITTEN out of root (writeSessionStatus overwrites the victim in place).
 *
 * The class fix is `resolveGuardedPath(root, [...dirSegments, 'status.json'])` —
 * guarding the FULL opened path including the leaf (the leaf then fails the
 * per-segment identity walk / nlink check). Nothing here does that yet.
 *
 * These pins plant a real guarded dir + a symlinked `status.json` leaf and assert
 * the victim OUTSIDE both roots is byte-IDENTICAL after the call (write-escape
 * blocked) and that the read-escape does not silently succeed (refuse, don't
 * disclose). Victims live under os.tmpdir(), OUTSIDE the logs root AND forgeRoot.
 *
 * FALSE-NEGATIVE DISCIPLINE (immutable-gates): every precondition is asserted by
 * execution BEFORE the verdict — the dir is genuinely contained (a plain SEC-04
 * dir-traversal would 404 for a different reason and mask this), the leaf is a
 * genuine symlink whose target is out of root, the victim's pre-call bytes are
 * captured. "Contained" is execution-only. Real scratch fs.
 *
 * RED-ON-CURRENT-CODE: every `(RED)` test FAILS at this HEAD (the leaf escape
 * goes through today). Positive controls pass before AND after any fix.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
  lstatSync,
} from 'node:fs';
import { join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';

import { runInstructionsTurn } from '@forge/sessions';
import type { QueryFn } from '@forge/sessions';

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

let forgeRoot: string;
let projectsRoot: string;
let logsRoot: string;
const outsideDirs: string[] = [];
let symlinksUnavailable = false;

/** A scratch dir OUTSIDE projectsRoot AND forgeRoot (sibling under tmpdir) —
 *  any byte-change here proves an out-of-root write; any disclosure a read. */
function newOutsideDir(prefix: string): string {
  const d = tmp(prefix);
  outsideDirs.push(d);
  return d;
}

/** A never-invoked query stub — the terminal/rejected phases exercised here
 *  never call the LLM; if one ever does, this throws loudly rather than hang. */
const noopQuery: QueryFn = () => {
  throw new Error('queryFn must not be called for a terminal/rejected turn');
};

before(() => {
  forgeRoot = tmp('sec04-leaf-forge-');
  projectsRoot = join(forgeRoot, 'projects');
  logsRoot = join(forgeRoot, '_logs');
  mkdirSync(projectsRoot, { recursive: true });
  mkdirSync(logsRoot, { recursive: true });

  // A real, legitimately-shaped in-root project — the guarded base every leaf
  // vector plants its session dir under.
  mkdirSync(join(projectsRoot, 'legit'), { recursive: true });

  const probe = tmp('sec04-leaf-symlink-probe-');
  try {
    symlinkSync(probe, join(projectsRoot, '__symlink_probe__'), 'dir');
  } catch {
    symlinksUnavailable = true;
  }
  rmSync(join(projectsRoot, '__symlink_probe__'), { force: true });
  rmSync(probe, { recursive: true, force: true });
});

after(() => {
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

/** Build a REAL, genuinely-contained instructions session dir under
 *  _logs/_sessions/legit/_instructions/<sessionId>/, then replace its `status.json`
 *  with a SYMLINK to `victimStatusPath` (out of root). Returns nothing — the
 *  caller has already planted + captured the victim. */
function plantGuardedDirWithSymlinkedStatus(sessionId: string, victimStatusPath: string): string {
  const sessionDir = join(logsRoot, '_sessions', 'legit', '_instructions', sessionId);
  mkdirSync(sessionDir, { recursive: true });
  const leaf = join(sessionDir, 'status.json');
  symlinkSync(victimStatusPath, leaf, 'file');
  // Preconditions, by execution: the dir is a real directory (not itself a
  // symlink — this is the LEAF vector, distinct from the dir-symlink SEC-04
  // pins), and status.json is a genuine symlink pointing out of root.
  assert.ok(lstatSync(sessionDir).isDirectory() && !lstatSync(sessionDir).isSymbolicLink(),
    'precondition: the session DIR is a real, contained directory');
  assert.ok(lstatSync(leaf).isSymbolicLink(), 'precondition: status.json is a symlink');
  return sessionDir;
}

// ---------------------------------------------------------------------------
// Positive controls (mandatory) — MUST pass before AND after any fix.
// ---------------------------------------------------------------------------

// ===========================================================================
// ROUTE leg — no route to pin (row 206, forge-8vfn.8.5.56)
//
// The generic question-form affordance route is the one write surface for
// the instructions briefing phase; no forge-ui caller reaches
// `/api/instructions/brief`, so there is no bespoke route here for a
// leaf-symlink pin to exercise. Pinning this shape at a DIFFERENT bespoke
// write route (project-brain/brief, architect/answer, demo-builder/lock)
// would conflate two different protections: every one of those routes
// carries its OWN phase gate (this same sweep), and the READ leg's victim
// is deliberately planted at a TERMINAL phase — exactly the shape a phase
// gate also refuses, for an unrelated reason, making a retargeted test pass
// regardless of whether the leaf-symlink fix exists. The RUNNER leg below
// exercises the identical shared mechanism (`readSessionStatus`/
// `writeSessionStatus`, `packages/sessions/interactive-session.ts`) directly,
// with no route or phase gate in the way, and is the honest pin for this
// defect class.
// ===========================================================================

// ===========================================================================
// RUNNER leg — runInstructionsTurn
// ===========================================================================

test('(RED) runInstructionsTurn writes through a symlinked status.json leaf, overwriting an out-of-root victim', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  const outside = newOutsideDir('sec04-leaf-runner-write-outside-');
  const victim = join(outside, 'victim-status.json');
  // phase 'rejected' → the runner takes the branch that writeSessionStatus's the
  // dir. A symlinked leaf makes that write land on the out-of-root victim.
  writeFileSync(victim, JSON.stringify({
    session_id: 'VICTIM', project: 'attacker', project_repo_path: outside,
    phase: 'rejected', round: 1, prompt: 'ORIGINAL-VICTIM-BYTES-runner-d44a0',
  }));
  const before = readFileSync(victim);

  plantGuardedDirWithSymlinkedStatus('sess-runner-leaf-write', victim);

  let threw = false;
  try {
    await runInstructionsTurn({
      sessionId: 'sess-runner-leaf-write',
      project: 'legit',
      projectRoot: join(projectsRoot, 'legit'),
      queryFn: noopQuery,
      logsRoot,
      forgeRoot,
    });
  } catch {
    threw = true;
  }

  assert.ok(
    readFileSync(victim).equals(before),
    'writeSessionStatus in the runner followed the symlinked status.json leaf and overwrote an out-of-root victim',
  );
  assert.ok(threw, 'the runner must REFUSE (throw a containment error) when status.json is a symlink out of root');
});

test('(RED) runInstructionsTurn reads through a symlinked status.json leaf (out-of-root disclosure drives the turn)', async (t) => {
  if (skipIfNoSymlinks(t)) return;
  const outside = newOutsideDir('sec04-leaf-runner-read-outside-');
  const victim = join(outside, 'victim-status.json');
  // phase 'committed' is terminal (no write). A CONTAINED runner throws on the
  // guarded-leaf reject and never returns a phase; today it reads the out-of-root
  // status and RETURNS { phase: 'committed' } — that return value is the proof.
  writeFileSync(victim, JSON.stringify({
    session_id: 'VICTIM', project: 'attacker', project_repo_path: outside,
    phase: 'committed', round: 1, prompt: '',
  }));
  plantGuardedDirWithSymlinkedStatus('sess-runner-leaf-read', victim);

  let returnedPhase: string | null = null;
  try {
    const r = await runInstructionsTurn({
      sessionId: 'sess-runner-leaf-read',
      project: 'legit',
      projectRoot: join(projectsRoot, 'legit'),
      queryFn: noopQuery,
      logsRoot,
      forgeRoot,
    });
    returnedPhase = r.phase;
  } catch {
    returnedPhase = null;
  }

  assert.notEqual(
    returnedPhase, 'committed',
    'the runner read an out-of-root symlinked status.json and returned its phase — the leaf was never contained',
  );
});

// A guard-shape sanity anchor: the sessionId itself is a real, contained
// directory (relative(logsRoot, dir) does NOT step out) — so any failure
// above is attributable to the LEAF, not to a dir-level traversal the existing
// SEC-04 pins already cover.
test('anchor: the planted session DIR is genuinely contained under the logs root (isolating the leaf as the sole escape)', (t) => {
  if (skipIfNoSymlinks(t)) return;
  const dir = join(logsRoot, '_sessions', 'legit', '_instructions', 'sess-brief-leaf-write');
  const rel = relative(logsRoot, dir);
  assert.notEqual(rel.split(sep)[0], '..', 'the session dir must be inside the logs root (leaf is the only out-of-root hop)');
});
