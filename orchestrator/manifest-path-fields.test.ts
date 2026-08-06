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
  writeFileSync,
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

// ---------------------------------------------------------------------------
// ROUND 2, Finding 3 (MINOR, cwd-dependent resolution): `containedUnder`
// (cli/manifest-path-guard.ts) calls a bare `resolve(candidate)`, which
// resolves a RELATIVE candidate against `process.cwd()` rather than against
// `forgeRoot`. No live bypass was found (every production writer emits
// absolute paths), but it is an unstated invariant. The agreed fix: reject
// any non-absolute candidate outright (fail closed, and it removes the cwd
// dependence entirely).
// ---------------------------------------------------------------------------

test('[Finding 3] project_repo_path: a RELATIVE candidate ("projects/<dir>") is REJECTED regardless of process.cwd() — only the absolute equivalent is accepted', () => {
  const legitAbs = join(forgeRoot, 'projects', 'demo-relative-check');
  mkdirSync(legitAbs, { recursive: true });

  const relativeCandidate = 'projects/demo-relative-check';
  const relErrors = validateManifestPathFields(
    { initiative_id: 'INIT-2026-08-06-x14', project_repo_path: relativeCandidate },
    { forgeRoot },
  );
  assert.ok(
    relErrors.length > 0,
    `a relative project_repo_path must be rejected outright (fail closed — no dependence on process.cwd()) — got ${JSON.stringify(relErrors)}`,
  );
  assert.equal(isContainedProjectRepoPath(relativeCandidate, { forgeRoot }), false);

  const absErrors = validateManifestPathFields(
    { initiative_id: 'INIT-2026-08-06-x14b', project_repo_path: legitAbs },
    { forgeRoot },
  );
  assert.deepEqual(absErrors, [], `the absolute equivalent must remain accepted — got ${JSON.stringify(absErrors)}`);
  assert.equal(isContainedProjectRepoPath(legitAbs, { forgeRoot }), true);
});

test('[Finding 3] worktree_path: a RELATIVE candidate ("_worktrees/<id>") is REJECTED regardless of process.cwd() — only the absolute equivalent is accepted', () => {
  const id = 'INIT-2026-08-06-x15';
  const wtAbs = join(forgeRoot, '_worktrees', id);
  mkdirSync(wtAbs, { recursive: true });

  const relativeCandidate = `_worktrees/${id}`;
  const relErrors = validateManifestPathFields({ initiative_id: id, worktree_path: relativeCandidate }, { forgeRoot });
  assert.ok(
    relErrors.length > 0,
    `a relative worktree_path must be rejected outright (fail closed — no dependence on process.cwd()) — got ${JSON.stringify(relErrors)}`,
  );
  assert.equal(isContainedWorktreePath(relativeCandidate, { forgeRoot, initiativeId: id }), false);

  const absErrors = validateManifestPathFields({ initiative_id: id, worktree_path: wtAbs }, { forgeRoot });
  assert.deepEqual(absErrors, [], `the absolute equivalent must remain accepted — got ${JSON.stringify(absErrors)}`);
  assert.equal(isContainedWorktreePath(wtAbs, { forgeRoot, initiativeId: id }), true);
});

// The two tests above happen to pass even today — but for an ACCIDENTAL
// reason: this test file's own process.cwd() (the forge repo checkout) is
// structurally unrelated to the tmp `forgeRoot`, so `resolve(relativeCandidate)`
// lands somewhere with no relation to forgeRoot at all, and the EXISTING
// lexical ".."-segment pre-filter in `containedUnder` already rejects it —
// not because non-absolute candidates are refused on principle. The two
// tests below prove the cwd-dependence is a REAL, exploitable gap today (not
// hypothetical) by pointing `process.cwd()` AT forgeRoot, where the relative
// candidate resolves to a genuinely-contained real path and is wrongly
// ACCEPTED — this is the actual unstated invariant the agreed fix (reject
// any non-absolute candidate outright) closes.

test('[Finding 3, proof] project_repo_path: with process.cwd() pointed AT forgeRoot, a RELATIVE candidate must still be REJECTED', () => {
  const legitAbs = join(forgeRoot, 'projects', 'demo-relative-cwd-check');
  mkdirSync(legitAbs, { recursive: true });
  const relativeCandidate = 'projects/demo-relative-cwd-check';

  const originalCwd = process.cwd();
  process.chdir(forgeRoot);
  try {
    const errors = validateManifestPathFields(
      { initiative_id: 'INIT-2026-08-06-x16', project_repo_path: relativeCandidate },
      { forgeRoot },
    );
    assert.ok(
      errors.length > 0,
      `a relative candidate must be rejected regardless of process.cwd() — today, with cwd set to forgeRoot, the relative candidate resolves INSIDE forgeRoot and is wrongly ACCEPTED (errors=[]) — proving containedUnder's bare resolve(candidate) genuinely depends on process.cwd(), not a hypothetical concern.`,
    );
  } finally {
    process.chdir(originalCwd);
  }
});

test('[Finding 3, proof] worktree_path: with process.cwd() pointed AT forgeRoot, a RELATIVE candidate must still be REJECTED', () => {
  const id = 'INIT-2026-08-06-x17';
  const wtAbs = join(forgeRoot, '_worktrees', id);
  mkdirSync(wtAbs, { recursive: true });
  const relativeCandidate = `_worktrees/${id}`;

  const originalCwd = process.cwd();
  process.chdir(forgeRoot);
  try {
    const errors = validateManifestPathFields({ initiative_id: id, worktree_path: relativeCandidate }, { forgeRoot });
    assert.ok(
      errors.length > 0,
      `a relative worktree_path must be rejected regardless of process.cwd() — today, with cwd set to forgeRoot, it resolves INSIDE forgeRoot and is wrongly ACCEPTED (errors=[]) — got ${JSON.stringify(errors)}`,
    );
  } finally {
    process.chdir(originalCwd);
  }
});

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

// ---------------------------------------------------------------------------
// PIN 5 — round-3 adversarial review, item 2 (BLOCKER): `isContainedProjectRepoPath`
// (cli/manifest-path-guard.ts:170-173) hardcodes `join(opts.forgeRoot,
// 'projects')` as the projects root, never consulting `FORGE_PROJECTS_DIR` or
// `forge.config.json`'s `projectsDir` — unlike `resolveProjectsDir`
// (orchestrator/config.ts), which every OTHER projects-root resolution in
// this repo (`ctx.projectsRoot` in cli/ui-bridge.ts, `writeSessionTerminalPhase`
// in cli/agent-run.ts, etc.) already goes through. Under a configured
// projects root this function DISAGREES with the producers that correctly
// used `resolveProjectsDir` — reachable from the approve/finalize path
// (cli/bridge-studio-runs.ts:222/390, orchestrator/finalize-merged.ts:301,
// orchestrator/drain-fix-loop.ts:136, cli/bridge-recovery.ts), so a
// configured `projectsDir` could break cycle approval entirely.
//
// T2's ruling: one concept, one resolution — `isContainedProjectRepoPath`
// must resolve through `resolveProjectsDir`, and it must not depend on the
// calling PROCESS's cwd (`loadConfig()`'s default `path = 'forge.config.json'`
// is `resolve(path)` — cwd-relative — and fails soft to `{}` when not found
// at that cwd-relative location, so a caller started from a different cwd
// would silently get the DEFAULT root back even with a real
// `forge.config.json` sitting right there in `forgeRoot`).
//
// AT below (1) proves the configured root is honoured at all (both directions
// — accept under the NEW root, reject the stale hardcoded default once a
// different root is configured), (2) proves that resolution does NOT depend
// on process.cwd() (the finding this whole item is really about — the
// pattern mirrors this file's own Finding-3 cwd-dependence proof above), and
// (3) is the ACCEPT control: the DEFAULT configuration (no env, no config
// file) must resolve byte-identically to today.
// ---------------------------------------------------------------------------

test('R4-17 pin 5, item 2 (BLOCKER): isContainedProjectRepoPath honours a CONFIGURED projects root (FORGE_PROJECTS_DIR) — accepts a path under the CONFIGURED root, and REJECTS the same-named path under the now-stale hardcoded <forgeRoot>/projects default', () => {
  const customRoot = newOutsideDir('mpf-configured-projects-');
  const legitUnderConfigured = join(customRoot, 'configuredproj');
  mkdirSync(legitUnderConfigured, { recursive: true });
  // A REAL, on-disk directory at the OLD default location for the SAME
  // project name — not a hypothetical path.
  const staleUnderDefault = join(forgeRoot, 'projects', 'configuredproj-stale');
  mkdirSync(staleUnderDefault, { recursive: true });

  const priorEnv = process.env.FORGE_PROJECTS_DIR;
  process.env.FORGE_PROJECTS_DIR = customRoot;
  try {
    assert.equal(
      isContainedProjectRepoPath(legitUnderConfigured, { forgeRoot }), true,
      `a path under the CONFIGURED projects root (${customRoot}) must be accepted — isContainedProjectRepoPath hardcodes join(forgeRoot, 'projects') today and ignores FORGE_PROJECTS_DIR entirely`,
    );
    assert.equal(
      isContainedProjectRepoPath(staleUnderDefault, { forgeRoot }), false,
      `once a DIFFERENT root is configured, a path under the OLD hardcoded <forgeRoot>/projects default must be REJECTED — accepting it means this guard disagrees with every producer that correctly reads the configured root via resolveProjectsDir, reproducing the "a configured projectsDir could break cycle approval" class`,
    );
  } finally {
    if (priorEnv === undefined) delete process.env.FORGE_PROJECTS_DIR;
    else process.env.FORGE_PROJECTS_DIR = priorEnv;
    rmSync(staleUnderDefault, { recursive: true, force: true });
  }
});

test('R4-17 pin 5, item 2 (BLOCKER, cwd-independence — kills a config load that silently returns {} because the process happened to be started from another directory): isContainedProjectRepoPath resolves a forge.config.json-configured projects root the SAME WAY regardless of process.cwd()', () => {
  const customRoot = newOutsideDir('mpf-cwd-independent-projects-');
  const legitUnderConfigured = join(customRoot, 'cwdproj');
  mkdirSync(legitUnderConfigured, { recursive: true });
  const configPath = join(forgeRoot, 'forge.config.json');
  writeFileSync(configPath, JSON.stringify({ projectsDir: customRoot }), 'utf8');

  const elsewhereCwd = newOutsideDir('mpf-elsewhere-cwd-');
  const originalCwd = process.cwd();
  try {
    process.chdir(elsewhereCwd);
    const resultFromElsewhere = isContainedProjectRepoPath(legitUnderConfigured, { forgeRoot });
    process.chdir(forgeRoot);
    const resultFromForgeRootCwd = isContainedProjectRepoPath(legitUnderConfigured, { forgeRoot });

    assert.equal(
      resultFromElsewhere, true,
      `expected the configured root (forge.config.json inside forgeRoot, { projectsDir: "${customRoot}" }) to be honoured even when process.cwd() is somewhere else entirely (${elsewhereCwd}) — a bare loadConfig() call resolves its default 'forge.config.json' path against process.cwd(), finds nothing there, and silently falls back to {} (the untouched default root), wrongly rejecting this`,
    );
    assert.equal(
      resultFromElsewhere, resultFromForgeRootCwd,
      `isContainedProjectRepoPath must produce the SAME resolution regardless of process.cwd() — got ${resultFromElsewhere} from cwd=${elsewhereCwd} vs ${resultFromForgeRootCwd} from cwd=${forgeRoot}`,
    );
  } finally {
    process.chdir(originalCwd);
    rmSync(configPath, { force: true });
  }
});

test('R4-17 pin 5, item 2 (ACCEPT control — default configuration must stay byte-identical to today): with no FORGE_PROJECTS_DIR and no forge.config.json, isContainedProjectRepoPath still resolves the projects root as exactly <forgeRoot>/projects', () => {
  assert.equal(process.env.FORGE_PROJECTS_DIR, undefined, 'precondition: no FORGE_PROJECTS_DIR set for this control (a leaked env var from an earlier test would invalidate it)');
  assert.ok(!existsSync(join(forgeRoot, 'forge.config.json')), 'precondition: no forge.config.json for this control (a leaked fixture from an earlier test would invalidate it)');

  const legitDefault = join(forgeRoot, 'projects', 'default-control-proj');
  mkdirSync(legitDefault, { recursive: true });
  const outsideDefault = newOutsideDir('mpf-default-control-outside-');
  try {
    assert.equal(isContainedProjectRepoPath(legitDefault, { forgeRoot }), true);
    assert.equal(isContainedProjectRepoPath(outsideDefault, { forgeRoot }), false);
  } finally {
    rmSync(legitDefault, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// R4-17 pin 7 — round-4 adversarial review: `isContainedProjectRepoPath` /
// `isContainedWorktreePath` self-resolve the projects root by RE-READING
// `forge.config.json` from disk on EVERY call (`resolveConfiguredProjectsRoot`,
// cli/manifest-path-guard.ts:115-117), while `startBridge` (cli/ui-bridge.ts:241)
// snapshots `ctx.projectsRoot` ONCE at server start and every route handler
// uses that cached value for the process's lifetime. A live `forge.config.json`
// edit while the bridge is running — an ordinary action, and forge is
// explicitly designed to run unattended between human interaction points —
// makes the GUARD and the PRODUCER diverge, false-rejecting legitimate
// approve/finalize/requeue paths for the rest of that process's uptime. This
// is the identical "the guard resolves its root differently from the
// producer" failure mode round 2 (pin 2) and round 3 (pin 5, above) each
// fixed once — reintroduced one level deeper by the fix for it.
//
// T2's ruling: the root is PASSED, not re-derived. `isContainedProjectRepoPath`
// / `isContainedWorktreePath` accept an optional `projectsRoot` in their
// options; when a caller supplies it (every bridge caller has `ctx.projectsRoot`
// in hand) that value is used VERBATIM and no config is read; when absent they
// self-resolve exactly as they do today, so no existing caller changes
// behaviour.
//
// Neither function's options type declares `projectsRoot` yet (production
// code is out of scope for T3 — TESTS ONLY). These ATs build the options
// object through an intermediate, explicitly-typed local variable — never a
// fresh object literal directly at the call site — so TypeScript's ordinary
// structural assignability (a wider-typed variable assigned to a narrower
// parameter type) lets the extra field through with ZERO tsc error, while
// `--experimental-strip-types` still passes it through verbatim at runtime
// (type stripping removes annotations, not properties). That is what makes
// item 1 fail on VALUE (wrong boolean) rather than on a type or module error
// — the correct RED shape for a parameter the implementation does not read
// yet.
// ---------------------------------------------------------------------------

type ContainmentOptsWithRoot = { forgeRoot: string; projectsRoot?: string };

test('R4-17 pin 7, item 1 (RED — round-4 divergence defect): isContainedProjectRepoPath must ACCEPT a path contained under a projectsRoot the caller passed explicitly, even after forge.config.json on disk is mutated to name a DIFFERENT root — the startBridge shape: ctx.projectsRoot is resolved ONCE at server start and held for the process lifetime, so a config edit mid-run must not start rejecting paths genuinely contained under the root the caller actually resolved', () => {
  const originalProjectsRoot = join(forgeRoot, 'projects');
  const legitPath = join(originalProjectsRoot, 'pin7-divergence-legit');
  mkdirSync(legitPath, { recursive: true });

  assert.equal(
    isContainedProjectRepoPath(legitPath, { forgeRoot }),
    true,
    'precondition: legitPath must be accepted under the DEFAULT (unconfigured) root before any config mutation',
  );

  // Simulate a live config edit while a long-lived caller (e.g. startBridge)
  // is holding `originalProjectsRoot` as its own cached ctx.projectsRoot — an
  // ordinary, expected action against a daemon designed to run unattended.
  const newRoot = newOutsideDir('mpf-pin7-divergent-newroot-');
  const configPath = join(forgeRoot, 'forge.config.json');
  writeFileSync(configPath, JSON.stringify({ projectsDir: newRoot }), 'utf8');

  try {
    const opts: ContainmentOptsWithRoot = { forgeRoot, projectsRoot: originalProjectsRoot };
    assert.equal(
      isContainedProjectRepoPath(legitPath, opts),
      true,
      `a caller that explicitly passes the projectsRoot it resolved/snapshotted earlier (${originalProjectsRoot}) must have that root honoured VERBATIM — today isContainedProjectRepoPath ignores any passed projectsRoot and re-derives via resolveConfiguredProjectsRoot(forgeRoot) on EVERY call, which now reads the mutated forge.config.json and resolves to ${newRoot} instead, wrongly REJECTING this genuinely-contained path`,
    );
  } finally {
    rmSync(configPath, { force: true });
  }
});

test('R4-17 pin 7, item 1b (RED — same round-4 divergence defect, isContainedWorktreePath\'s in-place-worktree fallback branch, manifest-path-guard.ts:166-167): isContainedWorktreePath must ACCEPT an in-place worktree path contained under a projectsRoot the caller passed explicitly, even after forge.config.json is mutated to name a different root', () => {
  const initiativeId = 'INIT-2026-08-06-pin7-wt';
  const originalProjectsRoot = join(forgeRoot, 'projects');
  // An "in-place worktree" (H2) — genuinely contained under projects/, NOT
  // under _worktrees/<initiativeId> — exercises isContainedWorktreePath's
  // FALLBACK branch, which shares the exact same resolveConfiguredProjectsRoot()
  // re-derivation as isContainedProjectRepoPath. No existing test in this file
  // drives that fallback branch directly (the worktree_path tests above all
  // use the identity-bound _worktrees/<id> branch instead).
  const legitInPlaceWt = join(originalProjectsRoot, 'pin7-wt-project', 'worktrees', initiativeId);
  mkdirSync(legitInPlaceWt, { recursive: true });

  assert.equal(
    isContainedWorktreePath(legitInPlaceWt, { forgeRoot, initiativeId }),
    true,
    'precondition: an in-place worktree path must be accepted under the DEFAULT root before any config mutation',
  );

  const newRoot = newOutsideDir('mpf-pin7-wt-divergent-newroot-');
  const configPath = join(forgeRoot, 'forge.config.json');
  writeFileSync(configPath, JSON.stringify({ projectsDir: newRoot }), 'utf8');

  try {
    const opts: { forgeRoot: string; initiativeId: string; projectsRoot?: string } = {
      forgeRoot,
      initiativeId,
      projectsRoot: originalProjectsRoot,
    };
    assert.equal(
      isContainedWorktreePath(legitInPlaceWt, opts),
      true,
      `isContainedWorktreePath's in-place-worktree fallback branch must honour a passed projectsRoot VERBATIM too — today it ignores it and re-derives via resolveConfiguredProjectsRoot(forgeRoot), which now resolves to the mutated root ${newRoot}, wrongly REJECTING this genuinely-contained path`,
    );
  } finally {
    rmSync(configPath, { force: true });
  }
});

test('R4-17 pin 7, item 2 (REJECT control — GREEN, must stay green): a genuine symlink escape is still REJECTED when a projectsRoot is passed explicitly — the parameter must not become a way to widen the guard', (t) => {
  if (skipIfNoSymlinks(t)) return;
  const originalProjectsRoot = join(forgeRoot, 'projects');
  const outside = newOutsideDir('mpf-pin7-reject-outside-');
  const evilPath = join(originalProjectsRoot, 'pin7-evil-passedroot');
  symlinkSync(outside, evilPath, 'dir');

  const opts: ContainmentOptsWithRoot = { forgeRoot, projectsRoot: originalProjectsRoot };
  assert.equal(
    isContainedProjectRepoPath(evilPath, opts),
    false,
    'a real symlink escape must still be REJECTED when a projectsRoot is passed explicitly — the parameter exists to fix the caller/producer root-disagreement, not to bypass per-segment identity containment (containedUnder/resolveGuardedPath, shared by every caller regardless of which root value they supply)',
  );
});

test('R4-17 pin 7, item 3 (back-compat — GREEN, must stay green): with NO projectsRoot passed, isContainedProjectRepoPath keeps self-resolving through forge.config.json exactly as today, protecting every EXISTING call site (none of which passes projectsRoot)', () => {
  const customRoot = newOutsideDir('mpf-pin7-backcompat-configured-');
  const legitUnderConfigured = join(customRoot, 'pin7-backcompat-proj');
  mkdirSync(legitUnderConfigured, { recursive: true });
  const staleUnderDefault = join(forgeRoot, 'projects', 'pin7-backcompat-stale');
  mkdirSync(staleUnderDefault, { recursive: true });
  const configPath = join(forgeRoot, 'forge.config.json');
  writeFileSync(configPath, JSON.stringify({ projectsDir: customRoot }), 'utf8');

  try {
    // The exact `{ forgeRoot }`-only shape every current call site uses.
    assert.equal(
      isContainedProjectRepoPath(legitUnderConfigured, { forgeRoot }),
      true,
      "omitting projectsRoot must preserve self-resolution through the configured projects root (pin 5 behaviour) — a fix for pin 7 must not make projectsRoot mandatory or change default resolution",
    );
    assert.equal(
      isContainedProjectRepoPath(staleUnderDefault, { forgeRoot }),
      false,
      'omitting projectsRoot must still reject the stale hardcoded-default path once a different root is configured (pin 5 behaviour) — this must not regress',
    );
  } finally {
    rmSync(configPath, { force: true });
    rmSync(staleUnderDefault, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// R4-17 pin 7, item 4 — SEC-02/SEC-03 property preservation, explicitly.
// ---------------------------------------------------------------------------

test('R4-17 pin 7, item 4a (SEC-02 preservation, passed-root variant): escape-and-return "<forgeRoot>/projects/../projects/<dir>" resolves to a genuinely contained real path and is ACCEPTED even when projectsRoot is passed explicitly (the no-projectsRoot ACCEPT for this exact shape is already pinned above by "project_repo_path: \\"<forgeRoot>/projects/../projects/legit-escapereturn\\" ... MUST be ACCEPTED" — not duplicated here, only the passed-root variant is new)', () => {
  const projectsRoot = join(forgeRoot, 'projects');
  const legitPath = join(projectsRoot, 'pin7-escapereturn-passedroot');
  mkdirSync(legitPath, { recursive: true });
  const roundtrip = `${forgeRoot}/projects/../projects/pin7-escapereturn-passedroot`;

  const opts: ContainmentOptsWithRoot = { forgeRoot, projectsRoot };
  assert.equal(
    isContainedProjectRepoPath(roundtrip, opts),
    true,
    `escape-and-return must remain ACCEPTED with a passed projectsRoot too — got false for "${roundtrip}"`,
  );
});

test('R4-17 pin 7, item 4b (SEC-02/SEC-03 preservation — no existing test in this file covers this): a brand-new, NONEXISTENT directory under projects/ (create-mode — the project does not exist on disk yet, exactly the shape a project CREATE flow names) is ACCEPTED, both without and with a passed projectsRoot', () => {
  const projectsRoot = join(forgeRoot, 'projects');
  const brandNewPath = join(projectsRoot, 'pin7-brand-new-nonexistent-proj');
  assert.equal(existsSync(brandNewPath), false, 'precondition: this directory must not exist yet — this test pins CREATE-mode containment (resolveGuardedPath\'s literal-tail-reassembly path), not an existing-directory check');

  assert.equal(
    isContainedProjectRepoPath(brandNewPath, { forgeRoot }),
    true,
    `a brand-new, not-yet-created directory under <forgeRoot>/projects/ must be ACCEPTED — got false for "${brandNewPath}"`,
  );

  const opts: ContainmentOptsWithRoot = { forgeRoot, projectsRoot };
  assert.equal(
    isContainedProjectRepoPath(brandNewPath, opts),
    true,
    `the same brand-new directory must also be ACCEPTED when projectsRoot is passed explicitly — got false for "${brandNewPath}"`,
  );
});

test("R4-17 pin 7, item 4c (SEC-02/SEC-03 preservation — scripts/verify-cycle.mjs's exact shape): join(FORGE_ROOT, 'projects', PROJECT) (the real-capability harness's projectRepoPath(), scripts/verify-cycle.mjs:150) is ACCEPTED, both without and with a passed projectsRoot — a false rejection here breaks forge's real-capability regression harness", () => {
  const projectsRoot = join(forgeRoot, 'projects');
  // verify-cycle.mjs's --project flag defaults to 'mdtoc', but the harness
  // must ALWAYS be run with --project gitpulse (CLAUDE.md: mdtoc is
  // committed inside forge's own repo and must never be the harness ground)
  // — pinning the real operative value, not a placeholder.
  const PROJECT = 'gitpulse';
  const harnessRepoPath = join(forgeRoot, 'projects', PROJECT); // scripts/verify-cycle.mjs:150's exact `join(FORGE_ROOT, 'projects', PROJECT)` shape
  mkdirSync(harnessRepoPath, { recursive: true });

  assert.equal(
    isContainedProjectRepoPath(harnessRepoPath, { forgeRoot }),
    true,
    `verify-cycle.mjs's projectRepoPath() shape must be ACCEPTED — got false for "${harnessRepoPath}"`,
  );

  const opts: ContainmentOptsWithRoot = { forgeRoot, projectsRoot };
  assert.equal(
    isContainedProjectRepoPath(harnessRepoPath, opts),
    true,
    `the same harness shape must also be ACCEPTED when projectsRoot is passed explicitly — got false for "${harnessRepoPath}"`,
  );
});

// ---------------------------------------------------------------------------
// R4-17 pin 8 — round-5 adversarial review: pin 7's `projectsRootFor` helper
// (cli/manifest-path-guard.ts:167-172) REFUSES (returns `null`, so the
// containment predicate returns `false`) whenever a caller supplies a
// `projectsRoot` that is not a non-empty ABSOLUTE string, rather than
// silently falling back to config self-resolution — a deliberate,
// load-bearing "FAIL CLOSED, never silently" ruling documented on
// `ProjectsRootOpt` above `projectsRootFor`. Round 5 verified that refusal
// holds by direct execution but found NO acceptance test pinning it — an
// unpinned refusal branch is exactly "a guard that cannot fail is not a
// guard": a future refactor could turn `return null;` into
// `return resolveConfiguredProjectsRoot(opts.forgeRoot);` (the fallback
// pin 7 itself supplies for the `undefined` case, one branch up) and no
// test would go red.
//
// Every AT below plants a candidate that IS genuinely contained under the
// DEFAULT self-resolved root (<forgeRoot>/projects, no forge.config.json on
// disk at this point in the file — every earlier test that writes one
// cleans it up in a `finally`). That is what makes the falsification real:
// a fallback implementation would resolve that same default root and
// wrongly ACCEPT, so only an actual refusal returns `false`. A test that
// only asserts `false` for a nonsense candidate (one not contained under
// ANY plausible root) would pass under a fallback implementation too — that
// is characterization, not acceptance, and is deliberately avoided here.
//
// Covered on BOTH containment predicates: `isContainedProjectRepoPath`, and
// `isContainedWorktreePath`'s in-place-worktree FALLBACK branch (the branch
// pin 7 item 1b first named, manifest-path-guard.ts:228-230 — reached by a
// candidate genuinely contained under the projects root but NOT under
// `<forgeRoot>/_worktrees/<initiativeId>`, so it falls through the identity
// branch into the same `projectsRootFor` call project_repo_path uses).
// ---------------------------------------------------------------------------

type WorktreeOptsWithRoot = { forgeRoot: string; initiativeId: string; projectsRoot?: string };

test("R4-17 pin 8, item 1a (project_repo_path — falsifiable refusal, not mere nonsense-candidate rejection): isContainedProjectRepoPath REFUSES a supplied projectsRoot of '' and does NOT fall back to self-resolution", () => {
  const candidate = join(forgeRoot, 'projects', 'pin8-empty-root-candidate');
  mkdirSync(candidate, { recursive: true });

  // Precondition: self-resolution (no projectsRoot passed at all) genuinely
  // accepts this candidate today — proves the refusal below is false
  // DESPITE a legitimate path, not merely false because the candidate is
  // bogus.
  assert.equal(
    isContainedProjectRepoPath(candidate, { forgeRoot }),
    true,
    'precondition: candidate must be accepted under self-resolution (no projectsRoot) before testing the empty-string refusal',
  );

  const opts: ContainmentOptsWithRoot = { forgeRoot, projectsRoot: '' };
  assert.equal(
    isContainedProjectRepoPath(candidate, opts),
    false,
    "a supplied projectsRoot of '' must REFUSE outright — a fallback-to-self-resolution implementation would resolve the SAME default root (<forgeRoot>/projects) as the precondition above and wrongly ACCEPT this candidate; only an actual refusal returns false here",
  );
});

test("R4-17 pin 8, item 1b (isContainedWorktreePath in-place-worktree FALLBACK branch — falsifiable refusal): isContainedWorktreePath REFUSES a supplied projectsRoot of '' and does NOT fall back to self-resolution", () => {
  const initiativeId = 'INIT-2026-08-06-pin8-empty-wt';
  // Genuinely contained under projects/, NOT under _worktrees/<initiativeId>
  // — exercises the FALLBACK branch, same as pin 7 item 1b.
  const candidate = join(forgeRoot, 'projects', 'pin8-empty-wt-project', 'worktrees', initiativeId);
  mkdirSync(candidate, { recursive: true });

  assert.equal(
    isContainedWorktreePath(candidate, { forgeRoot, initiativeId }),
    true,
    'precondition: candidate must be accepted under self-resolution (no projectsRoot) before testing the empty-string refusal — this is the in-place-worktree FALLBACK branch, not the _worktrees/<id> identity branch',
  );

  const opts: WorktreeOptsWithRoot = { forgeRoot, initiativeId, projectsRoot: '' };
  assert.equal(
    isContainedWorktreePath(candidate, opts),
    false,
    "a supplied projectsRoot of '' must REFUSE outright on the fallback branch too — a fallback-to-self-resolution implementation would resolve the SAME default root and wrongly ACCEPT this candidate",
  );
});

test('R4-17 pin 8, item 2a (project_repo_path — falsifiable refusal): isContainedProjectRepoPath REFUSES a supplied RELATIVE projectsRoot ("projects") and does NOT fall back to self-resolution, using the same would-be-accepted-under-fallback shape as item 1a', () => {
  const candidate = join(forgeRoot, 'projects', 'pin8-relative-root-candidate');
  mkdirSync(candidate, { recursive: true });

  const opts: ContainmentOptsWithRoot = { forgeRoot, projectsRoot: 'projects' };
  assert.equal(
    isContainedProjectRepoPath(candidate, opts),
    false,
    'a supplied RELATIVE projectsRoot ("projects") must REFUSE outright, exactly like \'\' above — a fallback-to-self-resolution implementation would ignore the non-absolute value, resolve the DEFAULT root instead, and wrongly ACCEPT this candidate',
  );
});

test("R4-17 pin 8, item 2a-proof (cwd-independence — the shape that made a relative root LOOK correct before pin 5): with process.cwd() pointed AT forgeRoot, a supplied RELATIVE projectsRoot (\"projects\") that would resolve to the CORRECT default root under a naive cwd-relative resolve() still REFUSES — refusal must not depend on an accident of process.cwd()", () => {
  const candidate = join(forgeRoot, 'projects', 'pin8-relative-root-cwd-candidate');
  mkdirSync(candidate, { recursive: true });

  const originalCwd = process.cwd();
  process.chdir(forgeRoot);
  try {
    const opts: ContainmentOptsWithRoot = { forgeRoot, projectsRoot: 'projects' };
    assert.equal(
      isContainedProjectRepoPath(candidate, opts),
      false,
      "with process.cwd() === forgeRoot, resolve('projects') would coincidentally equal the correct default root — a naive implementation that resolved the passed value against cwd instead of refusing on the type/shape check alone would ACCEPT here by accident; the guard must refuse before any resolution, regardless of cwd",
    );
  } finally {
    process.chdir(originalCwd);
  }
});

test('R4-17 pin 8, item 2b (isContainedWorktreePath FALLBACK branch — falsifiable refusal): isContainedWorktreePath REFUSES a supplied RELATIVE projectsRoot ("projects") on the in-place-worktree fallback branch too — the cwd-independence proof above (item 2a-proof) exercises the same projectsRootFor() call this branch shares, so it is not duplicated per-branch here', () => {
  const initiativeId = 'INIT-2026-08-06-pin8-relative-wt';
  const candidate = join(forgeRoot, 'projects', 'pin8-relative-wt-project', 'worktrees', initiativeId);
  mkdirSync(candidate, { recursive: true });

  const opts: WorktreeOptsWithRoot = { forgeRoot, initiativeId, projectsRoot: 'projects' };
  assert.equal(
    isContainedWorktreePath(candidate, opts),
    false,
    'a supplied RELATIVE projectsRoot must REFUSE on the fallback branch too — a fallback implementation would ignore it and wrongly ACCEPT via self-resolution',
  );
});

test("R4-17 pin 8, item 3a (project_repo_path — runtime-reachable non-string values): isContainedProjectRepoPath REFUSES every runtime-reachable non-string projectsRoot (null, a number, an object, an array, boolean true) rather than throwing a raw TypeError or silently self-resolving — ProjectsRootOpt types projectsRoot as string | undefined, but this module compiles to plain JS at runtime and nothing enforces that boundary against a caller assembling opts from parsed JSON/request data", () => {
  const badValues: Array<{ label: string; value: unknown }> = [
    { label: 'null', value: null },
    { label: 'number', value: 42 },
    { label: 'object', value: {} },
    { label: 'array', value: [] },
    { label: 'boolean-true', value: true },
  ];

  for (const { label, value } of badValues) {
    const candidate = join(forgeRoot, 'projects', `pin8-nonstring-${label}`);
    mkdirSync(candidate, { recursive: true });

    // Cast through an explicitly-typed local so tsc stays clean (structural
    // assignability, same trick pin 7's header comment explains) while the
    // runtime value handed to isContainedProjectRepoPath is genuinely
    // non-string — `--experimental-strip-types` removes the annotation, not
    // the value.
    const badProjectsRoot = value as unknown as string;
    const opts: ContainmentOptsWithRoot = { forgeRoot, projectsRoot: badProjectsRoot };

    let result: boolean | undefined;
    assert.doesNotThrow(() => {
      result = isContainedProjectRepoPath(candidate, opts);
    }, `a non-string projectsRoot (${label}) must not throw a raw TypeError out of isContainedProjectRepoPath`);
    assert.equal(
      result,
      false,
      `a non-string projectsRoot (${label}) must REFUSE (false), not silently self-resolve and ACCEPT this otherwise-legitimate candidate`,
    );
  }
});

test("R4-17 pin 8, item 3b (isContainedWorktreePath FALLBACK branch — runtime-reachable non-string values): isContainedWorktreePath REFUSES every runtime-reachable non-string projectsRoot on the in-place-worktree fallback branch too, rather than throwing or silently self-resolving", () => {
  const badValues: Array<{ label: string; value: unknown }> = [
    { label: 'null', value: null },
    { label: 'number', value: 42 },
    { label: 'object', value: {} },
    { label: 'array', value: [] },
    { label: 'boolean-true', value: true },
  ];

  for (const { label, value } of badValues) {
    const initiativeId = `INIT-2026-08-06-pin8-nonstring-${label}`;
    const candidate = join(forgeRoot, 'projects', `pin8-nonstring-wt-${label}`, 'worktrees', initiativeId);
    mkdirSync(candidate, { recursive: true });

    const badProjectsRoot = value as unknown as string;
    const opts: WorktreeOptsWithRoot = { forgeRoot, initiativeId, projectsRoot: badProjectsRoot };

    let result: boolean | undefined;
    assert.doesNotThrow(() => {
      result = isContainedWorktreePath(candidate, opts);
    }, `a non-string projectsRoot (${label}) must not throw a raw TypeError out of isContainedWorktreePath's fallback branch`);
    assert.equal(
      result,
      false,
      `a non-string projectsRoot (${label}) must REFUSE (false) on the fallback branch too`,
    );
  }
});

// Item 4 — the back-compat control that stops a fix for items 1-3 from
// making the parameter mandatory. Pin 7 item 3 already pins the plainest
// shape of this for isContainedProjectRepoPath (projectsRoot KEY OMITTED
// entirely — the `{ forgeRoot }` literal every existing call site uses) and
// is deliberately NOT duplicated verbatim here. What is genuinely new below:
//   (a) the `projectsRoot` key explicitly PRESENT with value `undefined` —
//       the shape a caller assembling opts through a variable or object
//       spread (`{ forgeRoot, projectsRoot: possiblyUndefinedVar }`)
//       produces, distinct at the object-shape level from key-omission even
//       though `opts.projectsRoot` reads `undefined` either way in JS; and
//   (b) a DEDICATED control for isContainedWorktreePath's fallback branch —
//       pin 7 item 1b only asserts this as a PRECONDITION inside a test
//       whose real subject is the divergence defect, not as its own named
//       back-compat control.

test('R4-17 pin 8, item 4a (back-compat control, genuinely new vs pin 7 item 3 — key PRESENT with value undefined, not key-omitted): isContainedProjectRepoPath ACCEPTS when projectsRoot is explicitly present in the options object with value undefined', () => {
  const legitUnderDefault = join(forgeRoot, 'projects', 'pin8-undefined-backcompat');
  mkdirSync(legitUnderDefault, { recursive: true });

  const explicitUndefined: string | undefined = undefined;
  const opts: ContainmentOptsWithRoot = { forgeRoot, projectsRoot: explicitUndefined };
  assert.equal(
    isContainedProjectRepoPath(legitUnderDefault, opts),
    true,
    'projectsRoot explicitly present with value undefined must still self-resolve and ACCEPT — a fix for items 1-3 that checks falsy-ness generically (rather than `passed === undefined` specifically, ahead of the type/absoluteness check) would wrongly refuse this back-compat shape',
  );
});

test('R4-17 pin 8, item 4b (back-compat control, DEDICATED to the worktree fallback branch — no existing test names this as its own control; pin 7 item 1b only asserts it as a PRECONDITION inside a different test): isContainedWorktreePath\'s in-place-worktree fallback branch ACCEPTS when projectsRoot is explicitly present with value undefined', () => {
  const initiativeId = 'INIT-2026-08-06-pin8-undefined-wt';
  const legitInPlaceWt = join(forgeRoot, 'projects', 'pin8-undefined-wt-project', 'worktrees', initiativeId);
  mkdirSync(legitInPlaceWt, { recursive: true });

  const explicitUndefined: string | undefined = undefined;
  const opts: WorktreeOptsWithRoot = { forgeRoot, initiativeId, projectsRoot: explicitUndefined };
  assert.equal(
    isContainedWorktreePath(legitInPlaceWt, opts),
    true,
    'projectsRoot explicitly present with value undefined must still self-resolve and ACCEPT on the fallback branch too',
  );
});
