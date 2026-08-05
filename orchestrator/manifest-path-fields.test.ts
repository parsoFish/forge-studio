/**
 * ACCEPTANCE TESTS (must be RED until SEC-02 lands) — validator + escape-shape
 * catalog for `cli/manifest-path-guard.ts` (does not exist yet as of this
 * writing; every import below is expected to fail module resolution until
 * the implementer lands it — that is the correct RED reason for this whole
 * file, not a typo).
 *
 * Pins the containment semantics derived from REAL on-disk manifest values
 * (verified by T2):
 *   - `worktree_path` legitimate iff EITHER (a) identity-bound to exactly
 *     `<forgeRoot>/_worktrees/<initiative_id>`, OR (b) genuinely contained
 *     under `<forgeRoot>/projects/` (in-place worktrees, H2).
 *   - `project_repo_path` legitimate iff genuinely contained under
 *     `<forgeRoot>/projects/` at depth >= 1.
 *   - `cycle_id` legitimate iff a single safe path segment.
 *   - `project` legitimate iff a safe single path segment.
 *   - empty string / undefined mean ABSENT and must be accepted.
 *
 * "Genuinely contained" means real per-segment realpath IDENTITY containment
 * (`resolveGuardedPath`, `cli/studio-path-guard.ts`), never a lexical
 * `resolve().startsWith()` check on an unresolved path. Every escape shape
 * below creates a REAL on-disk symlink/hardlink/directory — no string-only
 * assertions, no mocking of `fs`.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  existsSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  validateManifestPathFields,
  assertManifestPathFields,
  isContainedWorktreePath,
  isContainedProjectRepoPath,
  isSafeCycleId,
  isSafeProjectName,
} from '../cli/manifest-path-guard.ts';
import {
  writeManifest,
  type InitiativeManifest,
} from './manifest.ts';

let forgeRoot: string;
let symlinksUnavailable = false;

function skipIfNoSymlinks(t: { skip: (msg?: string) => void }): boolean {
  if (symlinksUnavailable) {
    t.skip('symlink creation unavailable in this environment');
    return true;
  }
  return false;
}

before(() => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'manifest-path-fields-'));
  mkdirSync(join(forgeRoot, 'projects'), { recursive: true });
  mkdirSync(join(forgeRoot, '_worktrees'), { recursive: true });
  mkdirSync(join(forgeRoot, '_queue', 'pending'), { recursive: true });

  // Probe symlink availability once (some sandboxes disallow it).
  try {
    const probeDir = join(forgeRoot, '.symlink-probe-target');
    const probeLink = join(forgeRoot, '.symlink-probe-link');
    mkdirSync(probeDir, { recursive: true });
    symlinkSync(probeDir, probeLink, 'dir');
  } catch {
    symlinksUnavailable = true;
  }
});

after(() => {
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

const outsideDirs: string[] = [];
function newOutsideDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  outsideDirs.push(d);
  return d;
}
after(() => {
  for (const d of outsideDirs) rmSync(d, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Escape shape 1: dir symlink at projects/<x> pointing entirely outside root.
// ---------------------------------------------------------------------------

test('project_repo_path: a dir symlink at projects/evil pointing entirely outside the root is REJECTED', (t) => {
  if (skipIfNoSymlinks(t)) return;
  const outside = newOutsideDir('mpf-dirsymlink-outside-');
  const evilPath = join(forgeRoot, 'projects', 'evil-dirsym');
  symlinkSync(outside, evilPath, 'dir');

  const errors = validateManifestPathFields(
    { initiative_id: 'INIT-2026-08-06-x1', project_repo_path: evilPath },
    { forgeRoot },
  );
  assert.ok(errors.some((e) => /project_repo_path/.test(e)), `expected a project_repo_path violation — got ${JSON.stringify(errors)}`);
  assert.equal(isContainedProjectRepoPath(evilPath, { forgeRoot }), false);
});

// ---------------------------------------------------------------------------
// Escape shape 2: cross-object alias — projects/evil -> projects/legit (a
// DIFFERENT real object under the SAME root). "Somewhere under root" must
// NOT be the guarantee; "this path's own identity" must be.
// ---------------------------------------------------------------------------

test('project_repo_path: projects/evil symlinked to projects/legit (same root, DIFFERENT real object) is REJECTED, while the real legit path is accepted', (t) => {
  if (skipIfNoSymlinks(t)) return;
  const legitPath = join(forgeRoot, 'projects', 'legit-crossobj');
  mkdirSync(legitPath, { recursive: true });
  const evilPath = join(forgeRoot, 'projects', 'evil-crossobj');
  symlinkSync(legitPath, evilPath, 'dir');

  const errors = validateManifestPathFields(
    { initiative_id: 'INIT-2026-08-06-x2', project_repo_path: evilPath },
    { forgeRoot },
  );
  assert.ok(errors.length > 0, `a cross-object alias must be rejected — a bare "somewhere under root" check would wrongly accept this — got ${JSON.stringify(errors)}`);
  assert.equal(isContainedProjectRepoPath(evilPath, { forgeRoot }), false);
  assert.equal(isContainedProjectRepoPath(legitPath, { forgeRoot }), true, 'the REAL legit path itself must still be accepted');
});

// ---------------------------------------------------------------------------
// Escape shape 3: nested-segment symlink — projects/real is genuine, but a
// segment BELOW it (real/sub) is a symlink escaping outside.
// ---------------------------------------------------------------------------

test('project_repo_path: projects/real-nested/sub symlinked outside is REJECTED even though projects/real-nested itself is genuine', (t) => {
  if (skipIfNoSymlinks(t)) return;
  const outside = newOutsideDir('mpf-nested-outside-');
  const realDir = join(forgeRoot, 'projects', 'real-nested');
  mkdirSync(realDir, { recursive: true });
  const subPath = join(realDir, 'sub');
  symlinkSync(outside, subPath, 'dir');

  const errors = validateManifestPathFields(
    { initiative_id: 'INIT-2026-08-06-x3', project_repo_path: subPath },
    { forgeRoot },
  );
  assert.ok(errors.length > 0, `a nested-segment symlink escape must be rejected — got ${JSON.stringify(errors)}`);
  assert.equal(isContainedProjectRepoPath(subPath, { forgeRoot }), false);
});

// ---------------------------------------------------------------------------
// Escape shape 4: ".."-normalization — a LITERAL ".." in the string (not
// pre-collapsed by path.join before it ever reaches the guard).
// ---------------------------------------------------------------------------

test('project_repo_path: a literal "<forgeRoot>/projects/../../etc" (raw ".." segments) is REJECTED', () => {
  // Built via string concatenation, NOT path.join — path.join would collapse
  // the ".." segments away before the guard ever saw them, which would test
  // path.join's normalization instead of the guard's own containment logic.
  const escapePath = `${forgeRoot}/projects/../../etc`;
  const errors = validateManifestPathFields(
    { initiative_id: 'INIT-2026-08-06-x4', project_repo_path: escapePath },
    { forgeRoot },
  );
  assert.ok(errors.length > 0, `a ".."-normalization escape must be rejected — got ${JSON.stringify(errors)}`);
});

// ---------------------------------------------------------------------------
// Escape shape 5 (companion, NOT an escape): "escape-and-return" resolves to
// a genuinely contained real path and MUST be accepted — pinning correct
// behaviour, not the R2-09 false-positive superstition.
// ---------------------------------------------------------------------------

test('project_repo_path: "<forgeRoot>/projects/../projects/legit-escapereturn" resolves to a genuinely contained real path — MUST be ACCEPTED', () => {
  const legitPath = join(forgeRoot, 'projects', 'legit-escapereturn');
  mkdirSync(legitPath, { recursive: true });
  // Raw string with a literal ".." — same reasoning as escape shape 4.
  const roundtrip = `${forgeRoot}/projects/../projects/legit-escapereturn`;

  const errors = validateManifestPathFields(
    { initiative_id: 'INIT-2026-08-06-x5', project_repo_path: roundtrip },
    { forgeRoot },
  );
  assert.deepEqual(errors, [], `escape-and-return never actually leaves the root and must be ACCEPTED — got ${JSON.stringify(errors)}`);
  assert.equal(isContainedProjectRepoPath(roundtrip, { forgeRoot }), true);
});

// ---------------------------------------------------------------------------
// Escape shape 6 (companion, NOT an escape): "..foo" is a perfectly legal
// directory name that never leaves the root — R2-09's backstop wrongly
// rejected exactly this.
// ---------------------------------------------------------------------------

test('project_repo_path: "<forgeRoot>/projects/..foo" (a real dir literally named "..foo") must be ACCEPTED', () => {
  const dotDir = join(forgeRoot, 'projects', '..foo');
  mkdirSync(dotDir, { recursive: true });

  const errors = validateManifestPathFields(
    { initiative_id: 'INIT-2026-08-06-x6', project_repo_path: dotDir },
    { forgeRoot },
  );
  assert.deepEqual(errors, [], `a literally-named "..foo" directory never leaves the root and must be ACCEPTED — got ${JSON.stringify(errors)}`);
  assert.equal(isContainedProjectRepoPath(dotDir, { forgeRoot }), true);
});

// ---------------------------------------------------------------------------
// Escape shape 7: dangling symlink at the leaf.
// ---------------------------------------------------------------------------

test('project_repo_path: a dangling symlink at the leaf is REJECTED (not mistaken for a free-to-create slot)', (t) => {
  if (skipIfNoSymlinks(t)) return;
  const danglingPath = join(forgeRoot, 'projects', 'dangling-target');
  symlinkSync(join(forgeRoot, 'projects', 'nonexistent-target-xyz'), danglingPath, 'dir');

  const errors = validateManifestPathFields(
    { initiative_id: 'INIT-2026-08-06-x7', project_repo_path: danglingPath },
    { forgeRoot },
  );
  assert.ok(errors.length > 0, `a dangling symlink must be rejected — got ${JSON.stringify(errors)}`);
  assert.equal(isContainedProjectRepoPath(danglingPath, { forgeRoot }), false);
});

// ---------------------------------------------------------------------------
// worktree_path IDENTITY — bound to THIS initiative's own dir, not merely
// "somewhere under _worktrees".
// ---------------------------------------------------------------------------

test('worktree_path: _worktrees/<other-id> is REJECTED when the manifest names a DIFFERENT initiative_id (identity-bound); the OWN id is ACCEPTED', () => {
  const otherId = 'INIT-2026-08-06-x8-other';
  const ownId = 'INIT-2026-08-06-x8-own';
  mkdirSync(join(forgeRoot, '_worktrees', otherId), { recursive: true });
  mkdirSync(join(forgeRoot, '_worktrees', ownId), { recursive: true });

  const wrongWt = join(forgeRoot, '_worktrees', otherId);
  const wrongErrors = validateManifestPathFields(
    { initiative_id: ownId, worktree_path: wrongWt },
    { forgeRoot },
  );
  assert.ok(wrongErrors.some((e) => /worktree_path/.test(e)), `a worktree_path naming a DIFFERENT initiative's dir must be rejected — got ${JSON.stringify(wrongErrors)}`);
  assert.equal(isContainedWorktreePath(wrongWt, { forgeRoot, initiativeId: ownId }), false);

  const rightWt = join(forgeRoot, '_worktrees', ownId);
  const rightErrors = validateManifestPathFields(
    { initiative_id: ownId, worktree_path: rightWt },
    { forgeRoot },
  );
  assert.deepEqual(rightErrors, [], `the OWN initiative's worktree dir must be accepted — got ${JSON.stringify(rightErrors)}`);
  assert.equal(isContainedWorktreePath(rightWt, { forgeRoot, initiativeId: ownId }), true);
});

// ---------------------------------------------------------------------------
// Absent / empty path fields must be accepted (empty string means absent).
// ---------------------------------------------------------------------------

test('absent/empty worktree_path, project_repo_path, cycle_id are ALL accepted (empty string means absent)', () => {
  const errorsEmpty = validateManifestPathFields(
    { initiative_id: 'INIT-2026-08-06-x9', worktree_path: '', project_repo_path: '', cycle_id: '' },
    { forgeRoot },
  );
  assert.deepEqual(errorsEmpty, [], `empty-string path fields must be treated as absent, not rejected — got ${JSON.stringify(errorsEmpty)}. parseManifest defaults project_repo_path to '' and serializeManifest always emits the key — a fix that rejects '' would break every legitimate manifest.`);

  const errorsUndefined = validateManifestPathFields({ initiative_id: 'INIT-2026-08-06-x9b' }, { forgeRoot });
  assert.deepEqual(errorsUndefined, [], `undefined (key entirely omitted) path fields must be accepted — got ${JSON.stringify(errorsUndefined)}`);
});

// ---------------------------------------------------------------------------
// isSafeCycleId
// ---------------------------------------------------------------------------

test('isSafeCycleId: true for a real cycle-id shape, false for traversal/empty/separator/leading-dot shapes', () => {
  assert.equal(isSafeCycleId('2026-06-07T22-31-02_INIT-2026-05-30-x'), true, 'a real on-disk cycle_id shape must be safe');
  assert.equal(isSafeCycleId('..'), false);
  assert.equal(isSafeCycleId('../x'), false);
  assert.equal(isSafeCycleId('a/b'), false);
  assert.equal(isSafeCycleId('a\\b'), false);
  assert.equal(isSafeCycleId(''), false);
  assert.equal(isSafeCycleId('.hidden'), false, 'the leading character must be alnum');
});

// ---------------------------------------------------------------------------
// isSafeProjectName (companion coverage for the exported API surface).
// ---------------------------------------------------------------------------

test('isSafeProjectName: true for a plain slug, false for traversal/separator/dot/empty shapes', () => {
  assert.equal(isSafeProjectName('demo'), true);
  assert.equal(isSafeProjectName('gitpulse'), true);
  assert.equal(isSafeProjectName('.'), false);
  assert.equal(isSafeProjectName('..'), false);
  assert.equal(isSafeProjectName('../etc'), false);
  assert.equal(isSafeProjectName('a/b'), false);
  assert.equal(isSafeProjectName('a\\b'), false);
  assert.equal(isSafeProjectName(''), false);
});

test('validateManifestPathFields: project traversal ("../../../../tmp") is REJECTED', () => {
  const errors = validateManifestPathFields(
    { initiative_id: 'INIT-2026-08-06-x10', project: '../../../../tmp' },
    { forgeRoot },
  );
  assert.ok(errors.some((e) => /project/.test(e)), `expected a project-field violation — got ${JSON.stringify(errors)}`);
});

// ---------------------------------------------------------------------------
// assertManifestPathFields — the throwing form used at destructive call
// sites.
// ---------------------------------------------------------------------------

test('assertManifestPathFields: THROWS on a violating field, does NOT throw on a clean manifest', (t) => {
  if (skipIfNoSymlinks(t)) return;
  const outside = newOutsideDir('mpf-assert-outside-');
  const evilPath = join(forgeRoot, 'projects', 'evil-assert');
  symlinkSync(outside, evilPath, 'dir');

  assert.throws(
    () => assertManifestPathFields({ initiative_id: 'INIT-2026-08-06-x11', project_repo_path: evilPath }, { forgeRoot }),
    Error,
    'expected assertManifestPathFields to throw for a violating project_repo_path',
  );
  assert.doesNotThrow(() =>
    assertManifestPathFields(
      { initiative_id: 'INIT-2026-08-06-x11b', project_repo_path: '', worktree_path: '', cycle_id: '' },
      { forgeRoot },
    ),
    'assertManifestPathFields must not throw on an entirely clean/absent manifest',
  );
});

// ---------------------------------------------------------------------------
// writeManifest refuses — the choke point. Its only two production callers
// (orchestrator/promote-manifests.ts:71, cli/bridge-recovery.ts:213) are both
// ingest paths.
// ---------------------------------------------------------------------------

test('writeManifest: refuses a manifest with an out-of-root worktree_path AND creates no file', () => {
  const outside = newOutsideDir('mpf-writemanifest-outside-');
  const id = 'INIT-2026-08-06-x12-writemanifest-refuse';
  const m: InitiativeManifest = {
    initiative_id: id,
    project: 'test-project',
    project_repo_path: '',
    created_at: '2026-08-06T00:00:00.000Z',
    iteration_budget: 5,
    cost_budget_usd: 2.0,
    phase: 'pending',
    origin: 'architect',
    body: 'body',
    worktree_path: outside,
  };

  assert.throws(
    () => writeManifest(m, { queueRoot: join(forgeRoot, '_queue') }),
    Error,
    'writeManifest must throw for an out-of-root worktree_path',
  );
  assert.equal(
    existsSync(join(forgeRoot, '_queue', 'pending', `${id}.md`)),
    false,
    'no file may be created on disk when the path guard rejects the manifest',
  );
});

// ---------------------------------------------------------------------------
// Root-folding negative control — the untrusted value MUST be decomposed
// into segments, never folded whole into a trusted `root` before calling
// resolveGuardedPath (see studio-path-guard.ts's CONTRACT section: folding
// the candidate into `root` makes `realpathSync(root)` silently resolve a
// symlink at the candidate's OWN first segment, bypassing containment
// entirely). The cross-object test above already proves this generally;
// this test names the FIRST-SEGMENT variant specifically.
// ---------------------------------------------------------------------------

test('root-folding negative control: a candidate whose FIRST segment under the root is a symlink pointing outside is REJECTED', (t) => {
  if (skipIfNoSymlinks(t)) return;
  const outside = newOutsideDir('mpf-rootfold-outside-');
  const firstSegmentSymlink = join(forgeRoot, 'projects', 'rootfold-evil');
  symlinkSync(outside, firstSegmentSymlink, 'dir');
  const nestedCandidate = join(firstSegmentSymlink, 'sub', 'deeper');

  const errors = validateManifestPathFields(
    { initiative_id: 'INIT-2026-08-06-x13', project_repo_path: nestedCandidate },
    { forgeRoot },
  );
  assert.ok(
    errors.length > 0,
    `a candidate whose FIRST segment under the root is a symlink pointing outside must be rejected — root-folding (candidate folded whole into a trusted "root" before calling resolveGuardedPath) would let realpathSync(root) silently resolve it away — got ${JSON.stringify(errors)}`,
  );
});
