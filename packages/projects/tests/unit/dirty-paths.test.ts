/**
 * forge-8vfn.6.11.31 — dirtyPaths must return real paths, so a preflight-fix edit is committed.
 *
 * Found by the bead's real C1b dispatch: the agent's edit to `.forge/project.json`
 * cleared the clause but was never committed to `forge-studio`, because the
 * porcelain line ` M .forge/project.json` lost its leading status space to a
 * trim and came back as `forge/project.json` — a path `git add` cannot stage.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { commitStudioChange, dirtyPaths } from '../../project-repo-tx.ts';

function repo(): string {
  const d = mkdtempSync(join(tmpdir(), 'dirty-paths-'));
  const g = (...a: string[]) => execFileSync('git', ['-C', d, ...a], { stdio: 'ignore' });
  g('init', '-q', '-b', 'main');
  mkdirSync(join(d, '.forge'));
  writeFileSync(join(d, '.forge', 'project.json'), '{}\n');
  writeFileSync(join(d, 'a.txt'), 'a\n');
  g('add', '.');
  g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'base');
  return d;
}

test('an unstaged modification listed FIRST keeps its full path', () => {
  const d = repo();
  try {
    writeFileSync(join(d, '.forge', 'project.json'), '{"x":1}\n');
    assert.deepEqual(dirtyPaths(d), ['.forge/project.json']);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('a rename entry yields the new path only, never its source as a second entry', () => {
  const d = repo();
  try {
    execFileSync('git', ['-C', d, 'mv', 'a.txt', 'b.txt']);
    assert.deepEqual(dirtyPaths(d), ['b.txt']);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('the preflight-fix commit path lands a dot-path edit on forge-studio', () => {
  const d = repo();
  try {
    writeFileSync(join(d, '.forge', 'project.json'), '{"x":1}\n');
    assert.equal(commitStudioChange(d, 'probe', dirtyPaths(d)), true);
    assert.equal(execFileSync('git', ['-C', d, 'status', '--porcelain'], { encoding: 'utf8' }), '');
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
