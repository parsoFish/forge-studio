/**
 * forge-8vfn.8.5.2 — crash-safety for the two community-package installers.
 *
 * `installCommunityHookPackage` (community-install.ts) and
 * `installSkillPackage` (skill-install.ts) used to write a vendored package's
 * files ONE BY ONE straight into the final install directory, in sorted
 * path order, with no undo. A process crash (or any thrown error) after the
 * FIRST file landed but before the LAST left an install directory that is
 * genuinely incomplete, yet reads as fully installed forever after: both
 * installers' own idempotent-reinstall "already installed?" probe only
 * checks whether the MANIFEST file exists (hook.yaml / SKILL.md), and the
 * manifest is typically among the first files written.
 *
 * `vendorFetchedPackage` (community-fetch-package.ts) already gets this
 * right — stage every file in a sibling temp directory, then a single
 * `renameSync` into place — so a crash before that rename leaves NOTHING at
 * the real destination. This file pins that SAME guarantee for the other two
 * installers, which now follow the identical stage-then-rename discipline.
 *
 * CRASH SIMULATION: both installers accept an optional, TEST-ONLY `writeFile`
 * dependency (`InstallCommunityHookInput.writeFile` /
 * `InstallInput.writeFile`) that defaults to node:fs's own `writeFileSync` in
 * production. Each test below injects a `writeFile` that throws for one
 * specific file in the package (matched by a path substring, not by call
 * order — so the assertion holds regardless of which file a real filesystem
 * happens to enumerate first) and writes every other file for real, so the
 * scenario under test is exactly "some bytes landed, then the process died".
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync as realWriteFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';
import yaml from 'js-yaml';

import { installCommunityHookPackage } from '../../studio/community-install.ts';
import { hooksDir, hookDir, hookYamlPath } from '../../studio/hook-library.ts';
import { installSkillPackage } from '../../studio/skill-install.ts';
import { skillsDir, skillDir, skillPath } from '../../skill-path.ts';

const createdDirs: string[] = [];

function makeTmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
});

const INJECTED_CRASH = 'INJECTED_CRASH_forge-8vfn.8.5.2';

/** A `writeFile` that throws the moment it is asked to write a path matching
 *  `failOn`, and otherwise behaves exactly like the real `writeFileSync` —
 *  so every file ordered before the match genuinely lands on disk, the same
 *  shape a real mid-install crash leaves behind. */
function crashingWriteFile(failOn: string): (path: string, data: string, encoding: 'utf8') => void {
  return (path, data, encoding) => {
    if (path.includes(failOn)) throw new Error(INJECTED_CRASH);
    realWriteFileSync(path, data, encoding);
  };
}

// ---------------------------------------------------------------------------
// installCommunityHookPackage
// ---------------------------------------------------------------------------

function vendorHookPackage(root: string, id: string): void {
  const dir = join(root, 'studio', 'community', 'hooks', id);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  realWriteFileSync(
    join(dir, 'hook.yaml'),
    yaml.dump({ id, name: id, description: `${id} desc`, on: 'PreToolUse', script: 'scripts/run.sh', permissions: { env: [], read: [], network: false } }),
    'utf8',
  );
  realWriteFileSync(join(dir, 'scripts', 'run.sh'), '#!/usr/bin/env bash\nexit 0\n', 'utf8');
}

test('installCommunityHookPackage: a write failure partway through leaves no install directory and no staging directory behind', () => {
  const root = makeTmpDir('install-crash-hook-');
  const id = 'crash-mid-install-hook';
  vendorHookPackage(root, id);

  assert.throws(
    () => installCommunityHookPackage({ forgeRoot: root, id, writeFile: crashingWriteFile('run.sh') }),
    new RegExp(INJECTED_CRASH),
  );

  assert.equal(existsAfterCrash(hookYamlPath(id, root)), false, 'the final install directory must not read as installed (hook.yaml absent)');
  assert.equal(existsAfterCrash(hookDir(id, root)), false, 'the final install directory must not exist at all');

  const leftover = readdirSync(hooksDir(root));
  assert.deepEqual(leftover, [], `studio/hooks/ must hold nothing after the crash (found: ${JSON.stringify(leftover)}) — no partial install, no orphaned staging directory`);
});

test('installCommunityHookPackage: the SAME package installs cleanly when nothing injects a failure (the seam is inert in the ordinary path)', () => {
  const root = makeTmpDir('install-crash-hook-ok-');
  const id = 'ordinary-install-hook';
  vendorHookPackage(root, id);

  const result = installCommunityHookPackage({ forgeRoot: root, id });
  assert.equal(result.alreadyInstalled, false);
  assert.equal(existsAfterCrash(hookYamlPath(id, root)), true, 'an uninterrupted install must still land the manifest for real');

  const entries = readdirSync(hooksDir(root));
  assert.deepEqual(entries, [id], 'studio/hooks/ must hold exactly the real installed id, no staging leftovers');
});

// ---------------------------------------------------------------------------
// installSkillPackage
// ---------------------------------------------------------------------------

function makeSkillPackageDir(id: string): string {
  const dir = makeTmpDir('install-crash-skill-pkg-');
  realWriteFileSync(join(dir, 'SKILL.md'), matter.stringify(`\n# ${id}\n\nBody.\n`, { name: id, description: 'a vendored skill' }), 'utf8');
  realWriteFileSync(join(dir, 'reference.md'), 'reference content', 'utf8');
  return dir;
}

test('installSkillPackage: a write failure partway through leaves no install directory and no staging directory behind', () => {
  const root = makeTmpDir('install-crash-skill-');
  const id = 'crash-mid-install-skill';
  const packageDir = makeSkillPackageDir(id);

  assert.throws(
    () =>
      installSkillPackage({
        forgeRoot: root,
        id,
        packageDir,
        upstream: { source: 'https://github.com/example/crash-mid-install-skill' },
        writeFile: crashingWriteFile('reference.md'),
      }),
    new RegExp(INJECTED_CRASH),
  );

  assert.equal(existsAfterCrash(skillPath(id, root)), false, 'the final install directory must not read as installed (SKILL.md absent)');
  assert.equal(existsAfterCrash(skillDir(id, root)), false, 'the final install directory must not exist at all');

  const leftover = readdirSync(skillsDir(root));
  assert.deepEqual(leftover, [], `skills/ must hold nothing after the crash (found: ${JSON.stringify(leftover)}) — no partial install, no orphaned staging directory`);
});

test('installSkillPackage: the SAME package installs cleanly when nothing injects a failure (the seam is inert in the ordinary path)', () => {
  const root = makeTmpDir('install-crash-skill-ok-');
  const id = 'ordinary-install-skill';
  const packageDir = makeSkillPackageDir(id);

  const result = installSkillPackage({ forgeRoot: root, id, packageDir, upstream: { source: 'https://github.com/example/ordinary-install-skill' } });
  assert.equal(result.alreadyInstalled, false);
  assert.equal(existsAfterCrash(skillPath(id, root)), true, 'an uninterrupted install must still land the manifest for real');

  const entries = readdirSync(skillsDir(root));
  assert.deepEqual(entries, [id], 'skills/ must hold exactly the real installed id, no staging leftovers');
});

function existsAfterCrash(path: string): boolean {
  return existsSync(path);
}
