/**
 * G3 (bead forge-8vfn.8.5.3) — split out of project-create-atomicity.test.ts
 * (which grew past the 800-line baseline cap — see scripts/baselines/file-size.json
 * / check-file-size.mjs) when these two cases landed. Same fixture shape as
 * the sibling file: an isolated temp forge root with the real templates
 * copied in, so the brain seed + preflight don't touch the live repo.
 *
 * The two `renameSync` calls in `scaffoldGreenfieldProject` land on SEPARATE
 * filesystem roots (`projectsRoot` and `brain/projects/`), so they are not one
 * transaction. A crash BETWEEN them (brain renamed into place, project never
 * renamed) leaves exactly the AT-B6-2 shape (project-create-atomicity.test.ts)
 * — a brain with no matching project — but from THIS create's own prior
 * attempt rather than a repo-tracked brain for an uncheckout project. The two
 * are told apart by SHAPE (`isUntouchedBrainSeedStub` / the fake's
 * `isUntouchedStub` mirror): a crash orphan is PROVABLY still the untouched
 * 3-file stub `seed` writes, because nothing has ever had a project here to
 * attach real knowledge to. AT-G3-1 pins the repair; AT-G3-2 pins that even
 * ONE extra file anywhere under the brain dir still refuses — the same
 * invariant AT-B6-2 already pins for a themes/ addition, here for a top-level
 * one.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  scaffoldGreenfieldProject as scaffoldGreenfieldProjectWithSeeder,
  projectStartersDir,
  type CreationManifest,
} from '../../project-create.ts';
import { FORGE_ROOT } from '@forge/kernel';
import { FAKE_BRAIN_SEEDER } from '../test-fixtures/fake-brain-seeder.ts';

/** Duplicated from project-create-atomicity.test.ts (small + self-contained —
 *  see that file's header for the split rationale). */
function scaffoldGreenfieldProject(
  input: Omit<Parameters<typeof scaffoldGreenfieldProjectWithSeeder>[0], 'brainSeeder'>,
): ReturnType<typeof scaffoldGreenfieldProjectWithSeeder> {
  return scaffoldGreenfieldProjectWithSeeder({ ...input, brainSeeder: FAKE_BRAIN_SEEDER });
}

function isolatedForgeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pcreate-'));
  const startersDest = join(root, 'studio', 'starters', 'projects');
  mkdirSync(startersDest, { recursive: true });
  cpSync(projectStartersDir(FORGE_ROOT), startersDest, { recursive: true });
  mkdirSync(join(root, 'brain', 'projects'), { recursive: true });
  mkdirSync(join(root, 'projects'), { recursive: true });
  return root;
}

function manifest(over: Partial<CreationManifest> = {}): CreationManifest {
  return { name: 'My Tool', appType: 'cli', language: 'typescript', northStar: 'ship the thing', ...over };
}

test('AT-G3-1 [G3] a pure-stub brain orphan left by a crash BETWEEN the two renames is repaired — the retry succeeds with exactly one project and one brain', () => {
  const forgeRoot = isolatedForgeRoot();
  const id = 'my-tool';
  const brainDir = join(forgeRoot, 'brain', 'projects', id);
  try {
    // Simulate the crash window directly: a completed brain rename produces
    // exactly the untouched 3-file stub at its FINAL location — which is
    // what seeding straight into `<id>` (no staging indirection) reproduces
    // byte-for-byte — while no project rename ever ran.
    FAKE_BRAIN_SEEDER.seed(forgeRoot, id, 'My Tool');
    assert.ok(existsSync(join(brainDir, 'kb.yaml')), 'precondition: the orphan brain stub is in place');
    assert.ok(!existsSync(join(forgeRoot, 'projects', id)), 'precondition: no project dir exists yet');

    const out = scaffoldGreenfieldProject({ manifest: manifest(), forgeRoot });

    assert.equal(out.id, id, 'the create must succeed once the orphan stub is repaired');
    assert.ok(existsSync(join(out.projectDir, '.forge', 'project.json')), 'the repaired create must produce a complete scaffold');
    assert.ok(existsSync(join(brainDir, 'kb.yaml')), 'a fresh brain must be seeded in place of the removed orphan');

    // Exactly one of each — no duplicate / leftover staging trees survive.
    assert.deepEqual(readdirSync(join(forgeRoot, 'projects')), [id], 'exactly one project dir must exist, no staging leftovers');
    assert.deepEqual(readdirSync(join(forgeRoot, 'brain', 'projects')), [id], 'exactly one brain dir must exist, no staging leftovers');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('AT-G3-2 [G3] a brain with the stub shape PLUS one extra file anywhere is refused and left byte-untouched, never repaired', () => {
  const forgeRoot = isolatedForgeRoot();
  const id = 'my-tool';
  const brainDir = join(forgeRoot, 'brain', 'projects', id);
  try {
    FAKE_BRAIN_SEEDER.seed(forgeRoot, id, 'My Tool');
    // ONE extra file OUTSIDE themes/ — a different shape than AT-B6-2's
    // themes/ addition, pinning that the check isn't themes-specific.
    writeFileSync(join(brainDir, 'NOTES.md'), 'an operator note — real content, not a stub\n', 'utf8');

    assert.throws(
      () => scaffoldGreenfieldProject({ manifest: manifest(), forgeRoot }),
      /brain/i,
      'a brain with ANY extra file (even outside themes/) must still refuse, never be swept',
    );
    assert.ok(existsSync(join(brainDir, 'NOTES.md')), 'the brain must be byte-untouched — the extra file must survive');
    assert.ok(!existsSync(join(forgeRoot, 'projects', id)), 'no project dir may appear on the refused path');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
