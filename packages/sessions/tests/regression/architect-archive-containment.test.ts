/**
 * `archiveSessionDir` refuses an escaping session id ON ITS OWN.
 *
 * The defect this pins is not that an escape was reachable — it was not, in
 * production: every caller today goes through `runInteractiveTurn` /
 * `runArchitectTurn`, whose first act is `resolveGuardedPath(projectRoot,
 * [kindDir, sessionId])`. The defect is that the containment lived THREE CALL
 * FRAMES UP, in whichever runner happened to be on the stack, while this
 * exported function interpolated `sessionId` into two paths and drove
 * `existsSync`/`mkdirSync`/`renameSync` raw. A guarantee a function inherits
 * from its callers is not one it can rely on, and this one is exported.
 *
 * These cases call it DIRECTLY — no runner, no bridge, nothing above it — which
 * is the only way to assert the function contains its own input. Against the
 * pre-fix code every one of them passes the guard stage and reaches raw fs.
 *
 * Found by `check-raw-fs-guarded` the moment the M4 row-5 split took
 * `kinds/architect-plan.ts` from 862 to 348 lines and its sweep tier finished
 * analysing the file: eight unguarded sinks that had reported clean for the
 * whole campaign. The split un-blinded a scanner; it did not add a sink.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, existsSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { archiveSessionDir } from '../../kinds/architect-plan.ts';

/**
 * A project root with one real session, plus TWO victims that must not move:
 * one outside the project root entirely, and one inside the project root but
 * outside `_architect/`. The second is what makes these cases discriminate —
 * with only a non-existent target, the pre-fix code refuses by accident
 * ("session dir not found") and the control passes against the unfixed code,
 * which is not a control at all (§15.75). Every escaping id below therefore
 * points at something that EXISTS.
 */
function scratch(): { root: string; projectRoot: string; victim: string; inner: string } {
  const root = mkdtempSync(join(tmpdir(), 'architect-archive-'));
  const projectRoot = join(root, 'project');
  mkdirSync(join(projectRoot, '_architect', '2026-09-04T00-00-00'), { recursive: true });
  const victim = join(root, 'victim');
  mkdirSync(victim, { recursive: true });
  writeFileSync(join(victim, 'SECRET.md'), 'do not move me\n', 'utf8');
  // Inside projectRoot, outside _architect: `../victim` from _architect lands here.
  const inner = join(projectRoot, 'victim');
  mkdirSync(inner, { recursive: true });
  writeFileSync(join(inner, 'SECRET.md'), 'do not move me either\n', 'utf8');
  // `_architect/a/b` exists, so a separator smuggled into one segment names a
  // REAL directory rather than a missing one.
  mkdirSync(join(projectRoot, '_architect', 'a', 'b'), { recursive: true });
  return { root, projectRoot, victim, inner };
}

/** Absolute-path case: the id points at a PLANTED scratch dir, never at a real
 *  system path. Verifying this control means reverting the fix and re-running
 *  it, and against the pre-fix code an absolute id reaches
 *  `renameSync(<that path>, …)` — with `/etc` that destroys `/etc` when the
 *  suite runs as root. A planted victim discriminates identically with no blast
 *  radius. (Adversarial review of this PR, finding 2.) */
let absoluteVictim = '';

const ESCAPING_IDS = [
  ['..', 'the parent directory itself'],
  ['.', 'the containing directory itself'],
  ['../victim', 'a traversal out of the project root'],
  ['a/b', 'a separator smuggled inside one segment'],
  ['@ABSOLUTE@', 'an absolute path'],
] as const;

for (const [id, why] of ESCAPING_IDS) {
  test(`archiveSessionDir refuses ${JSON.stringify(id)} on its own — ${why}`, () => {
    const { root, projectRoot, victim, inner } = scratch();
    const useId = id === '@ABSOLUTE@' ? absoluteVictim || join(root, 'absolute-victim') : id;
    if (id === '@ABSOLUTE@') mkdirSync(useId, { recursive: true });
    try {
      assert.throws(
        () => archiveSessionDir(projectRoot, useId),
        /refusing to archive/,
        'an escaping id must be refused BY THE GUARD in this function — "session dir not found" is a refusal by accident, and the pre-fix code gives exactly that for the ids whose target happens not to exist',
      );
      assert.equal(existsSync(join(victim, 'SECRET.md')), true, 'nothing outside the project root may be moved');
      assert.equal(existsSync(join(inner, 'SECRET.md')), true, 'nothing outside _architect/ may be moved either');
      assert.equal(existsSync(join(projectRoot, '_architect', 'a', 'b')), true, 'a real dir named by a smuggled separator stays put');
      assert.equal(
        existsSync(resolve(projectRoot, '_architect', '_archived')),
        false,
        'a refused archive must not have created the archive root as a side effect',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test('a SYMLINKED archive root is refused — the escape with the worst outcome, and the one this fix most clearly buys', () => {
  const { root, projectRoot, victim } = scratch();
  try {
    // Pre-fix: existsSync follows the link, no mkdir runs, and renameSync
    // resolves the symlinked parent in the kernel — the session dir lands
    // OUTSIDE projectRoot. Post-fix the guard's per-segment identity walk
    // rejects `_archived` before anything moves. (Adversarial review, finding 1:
    // the original case list had no symlink at all, so the assertion that
    // nothing outside the project root moves was vacuous.)
    symlinkSync(victim, join(projectRoot, '_architect', '_archived'), 'dir');
    assert.throws(
      () => archiveSessionDir(projectRoot, '2026-09-04T00-00-00'),
      /refusing to archive/,
      'a symlinked archive root must be refused by the guard, not followed',
    );
    assert.equal(
      existsSync(join(victim, '2026-09-04T00-00-00')),
      false,
      'the session dir must NOT have been moved through the link and out of the project root',
    );
    assert.equal(
      existsSync(join(projectRoot, '_architect', '2026-09-04T00-00-00')),
      true,
      'the session dir stays exactly where it was',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('POSITIVE CONTROL: a well-formed session id still archives — the refusals above are not the function refusing everything', () => {
  const { root, projectRoot } = scratch();
  try {
    const archived = archiveSessionDir(projectRoot, '2026-09-04T00-00-00');
    assert.equal(existsSync(archived), true, 'the archived dir exists at the returned path');
    assert.equal(
      existsSync(join(projectRoot, '_architect', '2026-09-04T00-00-00')),
      false,
      'the source dir moved rather than being copied',
    );
    assert.match(archived, /_architect[/\\]_archived[/\\]2026-09-04T00-00-00$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
