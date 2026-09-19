/**
 * `sessionPaths` refuses an escaping/malicious session id, or a poisoned
 * `_architect` dir, ON ITS OWN — the same shape ruling 102 already fixed for
 * `archiveSessionDir` in this same file (`kinds/architect-plan.ts`).
 *
 * Pre-fix, `sessionPaths` builds `sessionDir` with a bare
 * `resolve(projectRoot, '_architect', sessionId)` — a LEXICAL join that never
 * touches the filesystem and never refuses anything. It silently returns a
 * path outside the intended session dir (or through a symlinked `_architect`)
 * for every case below instead of refusing, and every raw-fs consumer of
 * `paths.sessionDir` / `paths.manifestsDir` downstream
 * (`kinds/architect.ts`'s finalize step, `architect-steps.ts`'s draft step)
 * then reads/writes through that unverified path.
 *
 * `sessionPaths` is a pure path-builder — it performs no fs write of its own
 * — so unlike `archiveSessionDir`'s tests, no victim files are needed to
 * prove "nothing moved"; the assertion is simply that the function refuses
 * to hand back an unverified path at all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { sessionPaths } from '../../kinds/architect-plan.ts';
import { PathGuardContainmentError } from '@forge/kernel';

function scratch(): { root: string; projectRoot: string } {
  const root = mkdtempSync(join(tmpdir(), 'session-paths-containment-'));
  const projectRoot = join(root, 'project');
  mkdirSync(join(projectRoot, '_architect'), { recursive: true });
  return { root, projectRoot };
}

const ESCAPING_IDS = [
  ['../victim', 'a traversal out of the _architect dir'],
  ['.', 'the containing directory itself'],
  ['a/b', 'a separator smuggled inside one segment'],
] as const;

for (const [id, why] of ESCAPING_IDS) {
  test(`sessionPaths refuses ${JSON.stringify(id)} on its own — ${why}`, () => {
    const { root, projectRoot } = scratch();
    try {
      assert.throws(
        () => sessionPaths(projectRoot, id),
        PathGuardContainmentError,
        'an escaping id must be refused by the guard, not silently resolved into an unverified path',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test('sessionPaths refuses an absolute-path session id — a PLANTED scratch dir, never a real system path', () => {
  const { root, projectRoot } = scratch();
  const absoluteVictim = join(root, 'absolute-victim');
  mkdirSync(absoluteVictim, { recursive: true });
  try {
    assert.throws(
      () => sessionPaths(projectRoot, absoluteVictim),
      PathGuardContainmentError,
      'an absolute id must be refused, not resolved verbatim as the session dir',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sessionPaths refuses a SYMLINKED _architect dir pointing outside projectRoot', () => {
  const root = mkdtempSync(join(tmpdir(), 'session-paths-containment-symlink-'));
  const projectRoot = join(root, 'project');
  mkdirSync(projectRoot, { recursive: true });
  const victim = join(root, 'victim');
  mkdirSync(victim, { recursive: true });
  symlinkSync(victim, join(projectRoot, '_architect'), 'dir');
  try {
    assert.throws(
      () => sessionPaths(projectRoot, '2026-09-04T00-00-00'),
      PathGuardContainmentError,
      'a symlinked _architect dir must be refused by the identity walk, not followed',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('POSITIVE CONTROL: a well-formed session id still resolves — the refusals above are not the function refusing everything', () => {
  const { root, projectRoot } = scratch();
  try {
    const paths = sessionPaths(projectRoot, '2026-09-04T00-00-00');
    assert.match(paths.sessionDir, /_architect[/\\]2026-09-04T00-00-00$/);
    assert.equal(paths.planPath, join(paths.sessionDir, 'PLAN.md'));
    assert.equal(paths.feedbackPath, join(paths.sessionDir, 'feedback.md'));
    assert.equal(paths.manifestsDir, join(paths.sessionDir, 'manifests'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
