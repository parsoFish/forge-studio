/**
 * ADR 051 decision 5 — the `git check-ignore` half, against a REAL repository.
 *
 * The pure rule lives in `validateCompiledWorkItemSet` and is tested there with
 * an injected predicate. What can only be tested here is whether the predicate
 * this module builds tells the truth about a real `.gitignore`, because that is
 * the half a stub cannot prove: a helper that always returned an empty set
 * would pass every test that injects its own answer.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitIgnoredPaths } from './gitignored-creates.ts';

function repoWithGitignore(body: string): { dir: string; guard: { forgeRoot: string; projectsRoot: string; initiativeId: string } } {
  // The guard accepts a worktree under the PROJECTS root, so the fixture builds
  // exactly that shape: <root>/projects/<name> with a real repository in it.
  const root = mkdtempSync(join(tmpdir(), 'forge-ignored-creates-'));
  const projectsRoot = join(root, 'projects');
  const dir = join(projectsRoot, 'demo');
  mkdirSync(dir, { recursive: true });
  execFileSync('git', ['-C', dir, 'init', '-q']);
  writeFileSync(join(dir, '.gitignore'), body);
  return { dir, guard: { forgeRoot: root, projectsRoot, initiativeId: 'INIT-2026-09-05-x' } };
}

test('ADR 051: a creates path under a gitignored directory is reported ignored — kills "the check-ignore call is decorative"', () => {
  const { dir, guard } = repoWithGitignore('_scratch/\n*.log\n');
  try {
    const ignored = gitIgnoredPaths(dir, ['_scratch/notes.md', 'src/index.ts', 'run.log'], guard);
    assert.deepEqual([...ignored].sort(), ['_scratch/notes.md', 'run.log']);
    assert.equal(ignored.has('src/index.ts'), false, 'a tracked path must not be reported ignored');
  } finally {
    rmSync(guard.forgeRoot, { recursive: true, force: true });
  }
});

test('ADR 051: the whole set costs ONE git call — the answer is the same for 1 path and for many', () => {
  const { dir, guard } = repoWithGitignore('build/\n');
  try {
    // Not an assertion about process count (which the test cannot see) but
    // about the batched call's CORRECTNESS: `--stdin` must answer per line, so
    // a batch and its singletons agree. A helper that read only the first line
    // would pass the singleton cases and fail here.
    const batch = gitIgnoredPaths(dir, ['build/out.js', 'src/a.ts', 'build/nested/deep.js'], guard);
    assert.deepEqual([...batch].sort(), ['build/nested/deep.js', 'build/out.js']);
    for (const p of ['build/out.js', 'build/nested/deep.js']) {
      assert.deepEqual([...gitIgnoredPaths(dir, [p], guard)], [p], `${p} alone must agree with the batch`);
    }
    assert.deepEqual([...gitIgnoredPaths(dir, ['src/a.ts'], guard)], []);
  } finally {
    rmSync(guard.forgeRoot, { recursive: true, force: true });
  }
});

test('ADR 051: inside the projects root but NOT a repository, the set is EMPTY — the rule declines rather than accusing', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-ignored-creates-norepo-'));
  const projectsRoot = join(root, 'projects');
  const dir = join(projectsRoot, 'demo');
  mkdirSync(join(dir, 'src'), { recursive: true });
  try {
    const guard = { forgeRoot: root, projectsRoot, initiativeId: 'INIT-2026-09-05-x' };
    assert.deepEqual([...gitIgnoredPaths(dir, ['src/index.ts', 'anything.md'], guard)], []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ADR 051: an UNCONTAINED worktree root spawns nothing — the containment guard decides whether git runs at all', () => {
  // The subject is the sink's own guard, not git: a root outside the projects
  // root (and outside <forgeRoot>/_worktrees/<initiativeId>) must yield the
  // empty set even though it IS a real repository whose .gitignore would
  // otherwise match. A caller-side-only check would pass this test by accident;
  // this one calls the module directly with a root the guard must refuse.
  const outside = mkdtempSync(join(tmpdir(), 'forge-ignored-creates-outside-'));
  const sanctioned = mkdtempSync(join(tmpdir(), 'forge-ignored-creates-root-'));
  try {
    execFileSync('git', ['-C', outside, 'init', '-q']);
    writeFileSync(join(outside, '.gitignore'), 'build/\n');
    const guard = { forgeRoot: sanctioned, projectsRoot: join(sanctioned, 'projects'), initiativeId: 'INIT-2026-09-05-x' };
    assert.deepEqual([...gitIgnoredPaths(outside, ['build/out.js'], guard)], [],
      'a repository outside the sanctioned roots must not be consulted');
  } finally {
    rmSync(outside, { recursive: true, force: true });
    rmSync(sanctioned, { recursive: true, force: true });
  }
});

test('ADR 051: an empty list asks git nothing and answers empty', () => {
  const { dir, guard } = repoWithGitignore('x\n');
  try {
    assert.deepEqual([...gitIgnoredPaths(dir, [], guard)], []);
    assert.deepEqual([...gitIgnoredPaths(dir, ['', ''], guard)], []);
  } finally {
    rmSync(guard.forgeRoot, { recursive: true, force: true });
  }
});
