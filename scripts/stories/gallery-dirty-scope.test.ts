/**
 * gallery-dirty-scope.test.ts — `git.dirty` ignores the run's OWN generated
 * artifacts.
 *
 * Coordinator review of the provenance fix: `git status --porcelain` with no
 * pathspec sees every file the run's OWN prior beats already rewrote —
 * `demos/stories/<id>/story.json`, its frames, and the generated docs under
 * `docs/tutorials/` and `docs/how-to/` — so on any multi-story run, every
 * story after the first records `dirty: true` even though nothing an
 * OPERATOR touched changed. Scoping the status to exclude those three
 * generated trees answers the question `git.dirty` exists to answer: did the
 * checkout have uncommitted SOURCE changes, not "did an earlier beat in this
 * same run write its own output yet".
 *
 * New file: `gallery-artifact-provenance.test.ts` already pins git.sha/dirty
 * against a real repo; this is the seam-level and generated-tree-specific
 * half, kept separate per "new tests go in new test files".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeStoryJson, defaultGitDirty } from './gallery.mjs';

test('the dirty check excludes demos/stories, docs/tutorials and docs/how-to from its pathspec', () => {
  let seenArgs = null;
  const run = (_cmd, args) => {
    seenArgs = args;
    return { error: undefined, status: 0, stdout: '' };
  };
  defaultGitDirty('/some/root', { run });
  assert.ok(seenArgs.includes('--'), `expected a "--" pathspec separator, got: ${JSON.stringify(seenArgs)}`);
  for (const excluded of [':!demos/stories', ':!docs/tutorials', ':!docs/how-to']) {
    assert.ok(seenArgs.includes(excluded), `expected ${excluded} in the pathspec, got: ${JSON.stringify(seenArgs)}`);
  }
});

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'gallery-dirty-scope-'));
  const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'd@e');
  git('config', 'user.name', 'd');
  mkdirSync(join(root, 'tests', 'stories'), { recursive: true });
  writeFileSync(join(root, 'tests', 'stories', 'SX.story.mjs'), 'export default {};\n');
  writeFileSync(join(root, 'README'), 'seed\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'seed');
  return root;
}

const resultFor = (id) => ({ story: { id, docs: { title: `Story ${id}` } }, beats: [{ status: 'green' }] });

test('an EARLIER beat\'s own generated artifact does not make a LATER beat\'s write see the tree as dirty', () => {
  const root = repo();
  try {
    // The shape a real multi-story run produces: one story's write lands its
    // own tracked story.json before the next story writes its own.
    writeStoryJson(resultFor('SX'), root);
    execFileSync('git', ['-C', root, 'add', '-A'], { encoding: 'utf8' });
    execFileSync('git', ['-C', root, 'commit', '-qm', 'first story landed'], { encoding: 'utf8' });

    // Now mutate ONLY the generated artifact tree, uncommitted — exactly what
    // this run's own next beat would have done before this check runs again.
    writeFileSync(join(root, 'demos', 'stories', 'SX', 'story.json'), '{"changed": true}');

    const dirty = defaultGitDirty(root);
    assert.equal(dirty, false, 'a change confined to demos/stories must not count as dirty');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a SOURCE change outside the generated trees still counts as dirty', () => {
  const root = repo();
  try {
    writeFileSync(join(root, 'README'), 'seed, modified\n');
    assert.equal(defaultGitDirty(root), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('writeStoryJson still records dirty: true for a real source change (regression guard)', () => {
  const root = repo();
  try {
    writeFileSync(join(root, 'README'), 'seed, modified\n');
    writeStoryJson(resultFor('SX'), root);
    const written = JSON.parse(readFileSync(join(root, 'demos', 'stories', 'SX', 'story.json'), 'utf8'));
    assert.equal(written.git.dirty, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
