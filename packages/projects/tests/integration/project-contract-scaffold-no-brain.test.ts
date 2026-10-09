/**
 * project-contract-scaffold-no-brain.test.ts — bead forge-mfv5.1.10.
 *
 * Brain 3 is CENTRAL (SPEC.md §4): the profile lives at
 * `brain/projects/<id>/profile.md` under forgeRoot, seeded by `seedProjectBrain`
 * and checked by preflight C4. The onboarding scaffold used to write a SECOND,
 * in-ground `brain/` profile TODO stub inside the project root beside it — two
 * stubs that drift apart. The scaffold now writes NO `brain/` directory inside the managed
 * project repo, on a fresh dir and on an existing repo alike.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { scaffoldContractArtifacts } from '../../project-contract-scaffold.ts';

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function assertNoBrain(projectRoot: string, created: readonly string[]): void {
  assert.equal(existsSync(join(projectRoot, 'brain')), false, 'no brain/ directory may exist inside the project repo');
  assert.deepEqual(
    created.filter((p) => p === 'brain' || p.startsWith('brain/') || p.includes('/brain/')),
    [],
    `the created-list must name no brain path — got ${JSON.stringify(created)}`,
  );
}

test('[forge-mfv5.1.10] a fresh dir: the scaffold writes roadmap.md but no brain/ directory', () => {
  const projectRoot = tmp('scaffold-nobrain-fresh-');
  try {
    const created = scaffoldContractArtifacts(projectRoot, 'demo', projectRoot);
    assert.ok(created.includes('roadmap.md'), 'roadmap.md is still scaffolded');
    assertNoBrain(projectRoot, created);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('[forge-mfv5.1.10] an existing git repo: the scaffold writes roadmap.md but no brain/ directory', () => {
  const projectRoot = tmp('scaffold-nobrain-repo-');
  try {
    execFileSync('git', ['init', '-q'], { cwd: projectRoot });
    writeFileSync(join(projectRoot, 'README.md'), '# existing\n');
    execFileSync('git', ['add', 'README.md'], { cwd: projectRoot });
    execFileSync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@localhost', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init'],
      { cwd: projectRoot },
    );
    const created = scaffoldContractArtifacts(projectRoot, 'demo', projectRoot);
    assert.ok(created.includes('roadmap.md'), 'roadmap.md is still scaffolded');
    assertNoBrain(projectRoot, created);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
