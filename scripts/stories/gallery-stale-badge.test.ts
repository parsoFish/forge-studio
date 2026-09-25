/**
 * gallery-stale-badge.test.ts — a row's staleness rides on the ROW, so both
 * row paths agree by construction.
 *
 * Findings row 56 + row 14, T1 ruling 1283 (option B), REVISED per
 * coordinator review of the first pass. `renderGalleryIndex` took a second
 * `stale` list as an argument, and only `regenerateGallery` (the disk path)
 * passed one — the pinned repo-door check (`gallery-index-agrees.test.ts`)
 * renders `renderGalleryIndex(committedGalleryRows(root).rows)` with no
 * staleness list at all, so the FIRST real story run would write badges into
 * the disk-generated index and the committed comparison would red against it
 * forever. The fix: `stale` lives on each row (`row.stale: <reason> | null`),
 * computed identically by BOTH `galleryRowsFrom` and `committedGalleryRows`,
 * and `renderGalleryIndex` takes only `rows` again.
 *
 * New file: `gallery.test.ts` is one of the files this brief forbids editing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { renderGalleryIndex, galleryRowsFrom, committedGalleryRows } from './gallery.mjs';
import { shortDigest } from './artifact-staleness.mjs';

const row = (id, stale = null) =>
  ({ id, title: `Story ${id}`, status: 'green', beats: 1, greenBeats: 1, clip: `${id}/story.webm`, firstFrame: null, stale });

test('a row carrying a stale reason renders a visible badge naming it', () => {
  const html = renderGalleryIndex([row('SX', 'stale since abc1234')]);
  assert.match(html, /stale since abc1234/);
});

test('the "no digest" reason is also rendered as a visible badge', () => {
  const html = renderGalleryIndex([row('SX', 'no digest — recorded before provenance')]);
  assert.match(html, /no digest — recorded before provenance/);
});

test('a row with stale: null carries no badge', () => {
  const html = renderGalleryIndex([row('SX', null)]);
  assert.doesNotMatch(html, /<p class="stale-badge"/);
});

test('a row with no .stale field at all (every other existing caller\'s shape) renders, badge-free', () => {
  const bare = { id: 'SX', title: 'Story SX', status: 'green', beats: 1, greenBeats: 1, clip: 'SX/story.webm', firstFrame: null };
  const html = renderGalleryIndex([bare]);
  assert.doesNotMatch(html, /<p class="stale-badge"/);
});

function repoWithStory(id, storyBytes, artifactExtra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'gallery-stale-attach-'));
  const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'd@e');
  git('config', 'user.name', 'd');
  mkdirSync(join(root, 'tests', 'stories'), { recursive: true });
  writeFileSync(join(root, 'tests', 'stories', `${id}.story.mjs`), storyBytes);
  mkdirSync(join(root, 'demos', 'stories', id), { recursive: true });
  writeFileSync(
    join(root, 'demos', 'stories', id, 'story.json'),
    JSON.stringify({ story: { id, docs: { title: `Story ${id}` } }, beats: [{ status: 'green' }], ...artifactExtra }),
  );
  git('add', '-A');
  git('commit', '-q', '-m', 'seed');
  return root;
}

test('galleryRowsFrom (the disk path) attaches the staleness reason to the matching row', () => {
  const root = repoWithStory('SX', 'export default {};\n'); // artifact has no storyDigest
  try {
    assert.equal(galleryRowsFrom(root).rows[0].stale, 'no digest — recorded before provenance');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('committedGalleryRows (the HEAD path) attaches the SAME reason, on a clean tree — agreement BY CONSTRUCTION', () => {
  const root = repoWithStory('SX', 'export default {};\n');
  try {
    const disk = galleryRowsFrom(root).rows[0];
    const head = committedGalleryRows(root).rows[0];
    assert.equal(head.stale, disk.stale);
    assert.equal(head.stale, 'no digest — recorded before provenance');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a row whose artifact digest matches its story file carries stale: null on BOTH paths', () => {
  const bytes = 'export default { id: "SX" };\n';
  const root = repoWithStory('SX', bytes, { storyDigest: shortDigest(bytes) });
  try {
    assert.equal(galleryRowsFrom(root).rows[0].stale, null);
    assert.equal(committedGalleryRows(root).rows[0].stale, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
