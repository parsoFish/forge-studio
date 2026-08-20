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
 *
 * W7-B6 review F4: init-unless-own-repo overcorrected — a subdirectory of an
 * operator's REAL cloned repo (monorepo package onboarded as repoPath) got a
 * fresh empty repo nested inside their checkout, repointing every forge git
 * operation at a history-less repo. The rule is three-way: own repo → skip;
 * inside FORGE's own work tree (the gitignored projects/ case) → init;
 * inside any OTHER repo → skip (the operator's repo governs); no repo → init.
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

    // `enclosing` plays FORGE's own work tree here — the one enclosing repo
    // a fresh project must NOT inherit (projects/ is gitignored inside it).
    const created = scaffoldContractArtifacts(projectRoot, 'w7 throwaway', enclosing);

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

    const created = scaffoldContractArtifacts(projectRoot, 'already repo', root);
    assert.ok(!created.includes('.git/'), 'an already-own-repo project must not report a fresh .git/');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('AT-B6-19 (RED, review F4) a subdirectory of an operator\'s REAL cloned repo is NOT git-inited — the enclosing (non-forge) repo governs', () => {
  const base = mkdtempSync(join(tmpdir(), 'onboard-gitinit-foreign-'));
  try {
    // The forge root: its own repo, entirely separate from the clone below.
    const forgeRoot = join(base, 'forge');
    mkdirSync(forgeRoot, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: forgeRoot, stdio: 'ignore' });
    // The operator's real monorepo clone, with the onboarded repoPath a
    // package INSIDE it (isContainedProjectRepoPath accepts any contained
    // dir — this is a legitimate onboard shape, not an attack).
    const clone = join(base, 'mono');
    mkdirSync(join(clone, 'packages', 'app'), { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: clone, stdio: 'ignore' });
    const projectRoot = join(clone, 'packages', 'app');

    const created = scaffoldContractArtifacts(projectRoot, 'mono app', forgeRoot);

    assert.ok(!existsSync(join(projectRoot, '.git')), 'a nested .git inside the operator\'s real clone repoints every forge git op at a history-less repo — must NOT be created');
    assert.ok(!created.includes('.git/'), 'the created-paths report must not claim a .git/ that would corrupt the clone');
    const toplevel = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: projectRoot, encoding: 'utf8' }).trim();
    assert.equal(realpathSync(toplevel), realpathSync(clone), 'the enclosing operator repo must still govern the onboarded dir');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('AT-B6-20 (green-lock, review F4) a dir in NO repo at all still gets git-inited', () => {
  const base = mkdtempSync(join(tmpdir(), 'onboard-gitinit-none-'));
  try {
    const forgeRoot = join(base, 'forge'); // not a repo — like every test forgeRoot
    const projectRoot = join(base, 'projects', 'fresh');
    mkdirSync(forgeRoot, { recursive: true });
    mkdirSync(projectRoot, { recursive: true });
    // NOTE: mkdtemp under the system tmpdir is outside any work tree on CI
    // and dev machines alike; if a machine ever git-inits its tmpdir this
    // test would need a containment tweak, not the production rule.
    const created = scaffoldContractArtifacts(projectRoot, 'fresh', forgeRoot);
    assert.ok(existsSync(join(projectRoot, '.git')), 'no enclosing repo → the project must get its own');
    assert.ok(created.includes('.git/'));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
