/**
 * Bead forge-8vfn.6.6 items 2+4 — `FinalizerId`/`FINALIZERS` widened from
 * `copyStagingToLibrary` alone to also cover `writeToRepoRoot` (the real
 * finalizer instructions' own `runFinalizeStep`, kinds/instructions.ts,
 * performs today: write the approved draft under a project's repo root,
 * committed on the studio branch), and `FinalizerContext` widened with
 * `status`/`project_repo_path`/`project` — the fields that finalizer needs
 * and `copyStagingToLibrary` never did. RED-NOW: `writeToRepoRoot` does not
 * exist, `FinalizerId`/`FINALIZERS` carry only `copyStagingToLibrary`, and
 * `FinalizerContext` has no `project_repo_path`/`project`/`status` fields.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { FINALIZERS, resolveFinalizer, writeToRepoRoot } from '../../interactive-finalizers.ts';

function scratch(prefix: string) {
  const base = mkdtempSync(join(tmpdir(), prefix));
  const sessionDir = join(base, '_instructions', 'sess-001');
  const stagingDir = join(sessionDir, 'staging');
  const projectRepoPath = join(base, 'project-repo');
  mkdirSync(stagingDir, { recursive: true });
  mkdirSync(projectRepoPath, { recursive: true });
  return { base, sessionDir, stagingDir, projectRepoPath };
}

/**
 * The shipped `isContainedProjectRepoPath` guard's contract, stubbed —
 * mirrors `bridge-studio-session-helpers.test.ts`'s own `contained` stub
 * exactly (naming it even in type position would mint a boundary row; see
 * that file's own "the containment check is INJECTED" test). Resolves
 * before comparing, same reason as that file's own doc: a lexical
 * `startsWith` would call `<root>/../../etc` contained.
 */
function containedUnder(allowedRoot: string): (candidate: string, opts: { forgeRoot: string; projectsRoot?: string }) => boolean {
  return (candidate: string) => {
    const real = resolve(candidate);
    return real === allowedRoot || real.startsWith(`${allowedRoot}${sep}`);
  };
}

test('resolveFinalizer("writeToRepoRoot") resolves to the exported writeToRepoRoot function', () => {
  assert.equal(resolveFinalizer('writeToRepoRoot'), writeToRepoRoot);
  assert.ok(FINALIZERS.some((row) => row.id === 'writeToRepoRoot'), 'FINALIZERS must carry a writeToRepoRoot row');
});

test('writeToRepoRoot copies the session\'s staged tree into FinalizerContext.project_repo_path', async () => {
  const { sessionDir, stagingDir, projectRepoPath } = scratch('finalizer-write-repo-root-');
  writeFileSync(join(stagingDir, 'AGENTS.draft.md'), '# Fixture AGENTS.md\ncontent-marker-b7e2\n');

  const wrote = await writeToRepoRoot({
    sessionDir,
    forgeRoot: projectRepoPath,
    libraryRoot: projectRepoPath,
    project_repo_path: projectRepoPath,
    project: 'fixture-project',
    isContainedProjectRepoPath: containedUnder(projectRepoPath),
  });

  assert.ok(Array.isArray(wrote) && wrote.length > 0, 'must report at least one written path');
  const dest = join(projectRepoPath, 'AGENTS.draft.md');
  assert.ok(existsSync(dest), 'the staged file must land under project_repo_path');
  assert.equal(readFileSync(dest, 'utf8'), '# Fixture AGENTS.md\ncontent-marker-b7e2\n');
});

test('writeToRepoRoot OVERWRITES an existing regular file at the destination (AGENTS.md edit-mode re-run) — truncate mode, not exclusive', async () => {
  const { sessionDir, stagingDir, projectRepoPath } = scratch('finalizer-write-repo-root-overwrite-');
  writeFileSync(join(projectRepoPath, 'AGENTS.md'), '# STALE — must be replaced\n');
  writeFileSync(join(stagingDir, 'AGENTS.md'), '# FRESH CONTENT content-marker-4d91\n');

  const wrote = await writeToRepoRoot({
    sessionDir,
    forgeRoot: projectRepoPath,
    libraryRoot: projectRepoPath,
    project_repo_path: projectRepoPath,
    project: 'fixture-project',
    isContainedProjectRepoPath: containedUnder(projectRepoPath),
  });

  assert.ok(wrote.length > 0);
  assert.equal(readFileSync(join(projectRepoPath, 'AGENTS.md'), 'utf8'), '# FRESH CONTENT content-marker-4d91\n');
});

test('writeToRepoRoot refuses loudly when FinalizerContext.isContainedProjectRepoPath is absent (no silent trust)', async () => {
  const { sessionDir, projectRepoPath } = scratch('finalizer-write-repo-root-noport-');
  let error: Error | null = null;
  try {
    await writeToRepoRoot({ sessionDir, forgeRoot: projectRepoPath, libraryRoot: projectRepoPath, project_repo_path: projectRepoPath });
  } catch (err) {
    error = err as Error;
  }
  assert.ok(error, 'must throw, not silently trust an unvalidated project_repo_path');
  assert.equal(error!.name, 'InteractiveFinalizerError');
  assert.ok(error!.message.includes('isContainedProjectRepoPath'), 'message must name the missing port');
});

test('SEC-03/path-guard CONTRACT: writeToRepoRoot refuses a FORGED project_repo_path outside the allowed roots — nothing written, no git branch op', async () => {
  const { sessionDir, stagingDir } = scratch('finalizer-write-repo-root-forged-');
  writeFileSync(join(stagingDir, 'AGENTS.draft.md'), 'ATTACKER PAYLOAD');
  const allowedRoot = mkdtempSync(join(tmpdir(), 'finalizer-write-repo-root-allowed-'));
  const outsideRepo = mkdtempSync(join(tmpdir(), 'finalizer-write-repo-root-OUTSIDE-'));
  // Arrange precondition: outsideRepo starts empty.
  assert.deepEqual(readdirSync(outsideRepo), [], 'arrange: the forged target must start empty');

  let error: Error | null = null;
  try {
    await writeToRepoRoot({
      sessionDir,
      forgeRoot: allowedRoot,
      libraryRoot: allowedRoot,
      project_repo_path: outsideRepo, // NOT under allowedRoot — the forged value
      project: 'fixture-project',
      isContainedProjectRepoPath: containedUnder(allowedRoot),
    });
  } catch (err) {
    error = err as Error;
  }

  assert.ok(error, 'must refuse a project_repo_path outside the allowed roots');
  assert.equal(error!.name, 'InteractiveFinalizerError');
  assert.ok(error!.message.includes(outsideRepo), 'message must name the offending path');
  assert.deepEqual(
    readdirSync(outsideRepo),
    [],
    'the forged target must be byte-for-byte untouched — no staged content written, no .git created by ' +
      'withStudioWrite\'s checkout -b (the containment check must run BEFORE withStudioWrite is ever called)',
  );
});

test('writeToRepoRoot refuses loudly when FinalizerContext.project_repo_path is absent', async () => {
  const { sessionDir } = scratch('finalizer-write-repo-root-missing-');
  // writeToRepoRoot is SYNCHRONOUS (its precondition guard throws before any
  // await — matches copyStagingToLibrary's own documented "Synchronous"
  // contract; the runner's `await finalizerFn(ctx)` call site works either
  // way). `() => Promise.resolve(writeToRepoRoot(...))` evaluates
  // `writeToRepoRoot(...)` BEFORE `Promise.resolve` ever runs, so its throw
  // propagates as a plain synchronous exception — confirmed directly against
  // node:assert, `assert.rejects` does NOT catch that shape; it re-threw the
  // original error uncaught rather than validating it against the pattern
  // (the "not ok" failure this test produced on the branch, `error:
  // 'writeToRepoRoot: FinalizerContext.project_repo_path is required.'`,
  // was this bug, not the finalizer). `async () => writeToRepoRoot(...)`
  // wraps the SAME synchronous throw inside an async function body, which
  // converts it into a rejected promise the way assert.rejects expects.
  await assert.rejects(
    async () => writeToRepoRoot({ sessionDir, forgeRoot: '/tmp', libraryRoot: '/tmp' }),
    /project_repo_path/,
  );
});
