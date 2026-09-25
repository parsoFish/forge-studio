/**
 * gallery-artifact-provenance.test.ts — the written story.json records where
 * it came from: the checkout's git state, whatever spend figure reached this
 * writer, and a digest of the story file that produced it.
 *
 * Findings row 56 + row 14 (T1 ruling 1283, option B). Without this, a
 * `demos/stories/<id>/story.json` on disk cannot be told apart from one
 * recorded against a DIFFERENT version of `tests/stories/<id>.story.mjs` —
 * exactly the drift `artifact-staleness.mjs` (this brief's next item) exists
 * to name.
 *
 * New file: `writeStoryJson` has no existing test file to extend.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { writeStoryJson } from './gallery.mjs';

function repoWithStory(id, bytes) {
  const root = mkdtempSync(join(tmpdir(), 'gallery-provenance-'));
  const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'd@e');
  git('config', 'user.name', 'd');
  mkdirSync(join(root, 'tests', 'stories'), { recursive: true });
  writeFileSync(join(root, 'tests', 'stories', `${id}.story.mjs`), bytes);
  writeFileSync(join(root, 'README'), 'seed\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'seed');
  return root;
}

const shortDigest = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 16);

const resultFor = (id) => ({ story: { id, docs: { title: `Story ${id}` } }, beats: [{ status: 'green' }] });

test('the written artifact records the checkout HEAD sha and a clean tree', () => {
  const root = repoWithStory('SX', 'export default { id: "SX" };\n');
  try {
    writeStoryJson(resultFor('SX'), root);
    const written = JSON.parse(readFileSync(join(root, 'demos', 'stories', 'SX', 'story.json'), 'utf8'));
    const sha = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    assert.equal(written.git.sha, sha);
    assert.equal(written.git.dirty, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a dirty working tree is recorded as dirty', () => {
  const root = repoWithStory('SX', 'export default { id: "SX" };\n');
  try {
    writeFileSync(join(root, 'README'), 'seed, modified\n');
    writeStoryJson(resultFor('SX'), root);
    const written = JSON.parse(readFileSync(join(root, 'demos', 'stories', 'SX', 'story.json'), 'utf8'));
    assert.equal(written.git.dirty, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('spend is recorded as the honest gap when the run result carries none — never a silent $0', () => {
  // Measured: today's `result` from run-story.mjs is `{ story, beats, reap,
  // sweep, fence }` — no spend field reaches this writer without editing
  // run-story.mjs, which this brief forbids. A $0 here would read as "nothing
  // was spent" when nobody looked, which is the exact defect class
  // `summariseRunSpend`'s own UNMEASURED case exists to prevent.
  const root = repoWithStory('SX', 'export default { id: "SX" };\n');
  try {
    writeStoryJson(resultFor('SX'), root);
    const written = JSON.parse(readFileSync(join(root, 'demos', 'stories', 'SX', 'story.json'), 'utf8'));
    assert.equal(written.spend.usd, null);
    assert.equal(written.spend.unmeasured, 'not passed to the artifact writer');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('storyDigest is the sha256 (hex, first 16) of the story file that produced this run', () => {
  const bytes = 'export default { id: "SX", beats: [] };\n';
  const root = repoWithStory('SX', bytes);
  try {
    writeStoryJson(resultFor('SX'), root);
    const written = JSON.parse(readFileSync(join(root, 'demos', 'stories', 'SX', 'story.json'), 'utf8'));
    assert.equal(written.storyDigest, shortDigest(bytes));
    assert.equal(written.storyDigest.length, 16);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
