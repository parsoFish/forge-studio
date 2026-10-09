/**
 * forge-mfv5.1.12 — a Save never pushes a partial contract.
 *
 * Found on gitweave (capstone A, 2026-10-09): onboarding left `.forge/project.json`,
 * the `.gitignore` scratch lines and `roadmap.md` uncommitted in the ground while
 * the instructions approval committed AGENTS.md to `forge-studio`. `saveProjectRepo`
 * merges only forge-studio's commits, so a Save would have pushed main with
 * AGENTS.md and no contract. The Save now refuses, by name, before it touches a
 * branch.
 *
 * Refusal-path inputs cannot reach a real push (M7-COMMON §6.16): `origin` is a
 * bare repo under the OS tmp dir, so a broken refusal can only push there — and
 * the test reads that bare repo to prove it did not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { STUDIO_BRANCH, commitStudioChange, saveProjectRepo, uncommittedContractPaths } from '../../project-repo-tx.ts';

function g(dir: string, args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
}

/** A ground with one commit on main, pushed to a bare tmp `origin`. */
function groundWithOrigin(): { root: string; ground: string; origin: string } {
  const root = mkdtempSync(join(tmpdir(), 'save-refuse-'));
  const origin = join(root, 'origin.git');
  const ground = join(root, 'ground');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', ground]);
  g(ground, ['config', 'user.email', 't@forge.dev']);
  g(ground, ['config', 'user.name', 'Forge Test']);
  writeFileSync(join(ground, 'README.md'), '# ground\n');
  g(ground, ['add', 'README.md']);
  g(ground, ['commit', '-q', '-m', 'init']);
  g(ground, ['remote', 'add', 'origin', origin]);
  g(ground, ['push', '-q', 'origin', 'main']);
  return { root, ground, origin };
}

test('Save refuses, naming the file, when a contract file is uncommitted — and pushes nothing', () => {
  const { root, ground, origin } = groundWithOrigin();
  try {
    // The gitweave shape: one forge-studio commit (AGENTS.md) + an uncommitted contract.
    writeFileSync(join(ground, 'AGENTS.md'), '# Agents\n');
    assert.equal(commitStudioChange(ground, 'docs(agents): author AGENTS.md', ['AGENTS.md']), true);
    mkdirSync(join(ground, '.forge'));
    writeFileSync(join(ground, '.forge', 'project.json'), '{}\n');
    const originBefore = g(origin, ['rev-parse', 'main']);

    const r = saveProjectRepo(ground);

    assert.equal(r.merged, false);
    assert.equal(r.pushed, false);
    assert.deepEqual(r.refused, ['.forge/project.json']);
    assert.match(r.detail, /\.forge\/project\.json/);
    assert.equal(g(origin, ['rev-parse', 'main']), originBefore, 'origin main must not move');
    assert.equal(g(ground, ['rev-parse', '--abbrev-ref', 'HEAD']), STUDIO_BRANCH, 'the refusal touches no branch');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Save refuses even with nothing yet on forge-studio (an onboarded ground nobody committed)', () => {
  const { root, ground } = groundWithOrigin();
  try {
    writeFileSync(join(ground, 'roadmap.md'), '# Roadmap\n');
    writeFileSync(join(ground, '.gitignore'), '_scratch/\n');
    const r = saveProjectRepo(ground);
    assert.equal(r.merged, false);
    assert.deepEqual(r.refused, ['.gitignore', 'roadmap.md']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a dirty NON-contract file does not block a Save; the contract on forge-studio is merged and pushed', () => {
  const { root, ground, origin } = groundWithOrigin();
  try {
    mkdirSync(join(ground, '.forge'));
    writeFileSync(join(ground, '.forge', 'project.json'), '{}\n');
    assert.equal(commitStudioChange(ground, 'chore(forge): onboard ground contract', ['.forge/project.json']), true);
    writeFileSync(join(ground, 'notes.txt'), 'operator wip\n');

    const r = saveProjectRepo(ground);

    assert.equal(r.refused, undefined);
    assert.equal(r.merged, true);
    assert.equal(r.pushed, true);
    assert.match(g(origin, ['ls-tree', '-r', '--name-only', 'main']), /\.forge\/project\.json/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('uncommittedContractPaths expands an untracked .forge/ dir to the contract file inside it', () => {
  const { root, ground } = groundWithOrigin();
  try {
    mkdirSync(join(ground, '.forge'));
    writeFileSync(join(ground, '.forge', 'project.json'), '{}\n');
    writeFileSync(join(ground, '.forge', 'other.txt'), 'x\n');
    writeFileSync(join(ground, 'AGENTS.md'), '# a\n');
    assert.deepEqual(uncommittedContractPaths(ground), ['.forge/project.json', 'AGENTS.md']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Row 6 (ruling T1 1977a): the refusal OFFERS adopt — Studio commits the named
// contract files on forge-studio, then saves. Pinned shape: the gitweave ground
// after the pre-fix onboarding (AGENTS.md committed, three contract files loose).
test('Save with adopt commits the uncommitted contract files to forge-studio, then merges and pushes them', () => {
  const { root, ground, origin } = groundWithOrigin();
  try {
    writeFileSync(join(ground, 'AGENTS.md'), '# Agents\n');
    assert.equal(commitStudioChange(ground, 'docs(agents): author AGENTS.md', ['AGENTS.md']), true);
    mkdirSync(join(ground, '.forge'));
    writeFileSync(join(ground, '.forge', 'project.json'), '{}\n');
    writeFileSync(join(ground, '.gitignore'), '.forge/work-items/\n');
    writeFileSync(join(ground, 'roadmap.md'), '# Roadmap\n');

    const r = saveProjectRepo(ground, { adopt: true });

    assert.equal(r.refused, undefined);
    assert.deepEqual(r.adopted, ['.forge/project.json', '.gitignore', 'roadmap.md']);
    assert.equal(r.merged, true);
    assert.equal(r.pushed, true);
    assert.equal(g(ground, ['status', '--porcelain']), '', 'the ground is clean after an adopted Save');
    const onOrigin = g(origin, ['ls-tree', '-r', '--name-only', 'main']).split('\n');
    for (const f of ['.forge/project.json', '.gitignore', 'AGENTS.md', 'roadmap.md']) assert.ok(onOrigin.includes(f), `${f} on origin/main`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
