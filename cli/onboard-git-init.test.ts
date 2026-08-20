/**
 * W7-B6 WI-1 — onboarding git-init pin (projects-11).
 *
 * `scaffoldContractArtifacts` probed `git rev-parse --is-inside-work-tree`
 * with cwd=projectRoot. Because `projects/` lives INSIDE the forge work tree
 * that probe succeeds, `git init` is skipped, and the freshly onboarded
 * project silently inherits FORGE's own git repo — preflight C2/C6 then
 * evaluate against the wrong repo and any dev-loop branch/commit for the
 * project would land in forge's history (projects-11, live-reproduced with
 * "w7 throwaway").
 *
 * Killed implementation: the is-inside-work-tree probe. The fix compares
 * `git rev-parse --show-toplevel` (cwd=projectRoot) against
 * realpath(projectRoot) and inits unless they are equal.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { scaffoldContractArtifacts } from './bridge-studio-writes.ts';

test('AT-B6-5 (RED, projects-11) onboarding a dir INSIDE an enclosing git work tree still git-inits the project itself', () => {
  const enclosing = mkdtempSync(join(tmpdir(), 'onboard-gitinit-'));
  try {
    // The forge-repo shape: an enclosing work tree with the project dir under
    // a gitignored-style subpath.
    execFileSync('git', ['init', '-q'], { cwd: enclosing, stdio: 'ignore' });
    const projectRoot = join(enclosing, 'projects', 'w7-throwaway');
    mkdirSync(projectRoot, { recursive: true });

    const created = scaffoldContractArtifacts(projectRoot, 'w7 throwaway');

    assert.ok(existsSync(join(projectRoot, '.git')), 'the onboarded project must get its OWN .git (not inherit the enclosing repo)');
    const toplevel = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: projectRoot, encoding: 'utf8' }).trim();
    assert.equal(realpathSync(toplevel), realpathSync(projectRoot), 'git must resolve the project dir as its own work-tree root');
    assert.ok(created.includes('.git/'), 'the created-paths report must include .git/');
  } finally {
    rmSync(enclosing, { recursive: true, force: true });
  }
});

test('AT-B6-6 (green-lock) a project that already IS its own repo is not re-inited', () => {
  const root = mkdtempSync(join(tmpdir(), 'onboard-gitinit-own-'));
  try {
    const projectRoot = join(root, 'already-repo');
    mkdirSync(projectRoot, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: projectRoot, stdio: 'ignore' });

    const created = scaffoldContractArtifacts(projectRoot, 'already repo');
    assert.ok(!created.includes('.git/'), 'an already-own-repo project must not report a fresh .git/');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
