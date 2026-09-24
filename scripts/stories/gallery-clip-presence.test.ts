/**
 * gallery-clip-presence.test.ts — a row carries its clip only when the webm
 * actually exists, and the index never links to one that doesn't.
 *
 * forge-8vfn.2.34. `storyRowFrom` always emitted `clip: <id>/story.webm` and
 * `renderGalleryIndex` always rendered a `<video>` from it — but the webm is
 * gitignored (`.gitignore:191-195`), so a fresh clone (or CI) has none, and
 * every generated index links to a file nobody cloning the repo has.
 *
 * THE SEAM IS INJECTABLE, deliberately in the file's existing style (an
 * options object with a default — `bridge.mjs`'s
 * `bridgeGhToken({ exec = defaultGhTokenExec } = {})`, `lock-guard.mjs`'s
 * `whoRuns(absPath, { procRoot = '/proc', ... } = {})`). The DEFAULT keeps
 * every existing caller's behaviour byte-identical — `gallery.test.ts` (which
 * this brief forbids editing) calls `storyRowFrom(result)` with no options at
 * all and never asserts on `.clip`, and `gallery-index-agrees.test.ts`'s
 * "generator and check render identical bytes from one tree" pins
 * `committedGalleryRows` and `galleryRowsFrom` producing IDENTICAL html on a
 * clean tree — wiring the real filesystem check into either of those
 * call sites unilaterally would break that pinned invariant. So this fix adds
 * the capability and proves it here; wiring a real disk check into the
 * production regenerate path is a follow-up call that touches a second pinned
 * invariant and is out of this item's scope (see the PR report).
 *
 * New file: `gallery.test.ts` is one of the files this brief forbids editing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storyRowFrom, renderGalleryIndex } from './gallery.mjs';

const resultFor = (id) => ({
  story: { id, docs: { title: `Story ${id}` } },
  beats: [{ status: 'green', frame: 'frames/01-a.png' }],
});

test('storyRowFrom omits clip when the injected check says the webm is absent', () => {
  const row = storyRowFrom(resultFor('S9'), { root: '/fake/root', exists: () => false });
  assert.equal(row.clip, null);
});

test('storyRowFrom carries clip when the injected check says the webm is present', () => {
  const row = storyRowFrom(resultFor('S9'), { root: '/fake/root', exists: () => true });
  assert.equal(row.clip, 'S9/story.webm');
});

test('storyRowFrom checks the PATH it was actually asked about', () => {
  let seen = null;
  storyRowFrom(resultFor('S9'), { root: '/fake/root', exists: (p) => { seen = p; return true; } });
  assert.equal(seen, '/fake/root/demos/stories/S9/story.webm');
});

test('storyRowFrom with no options keeps every EXISTING caller behaving exactly as before', () => {
  // gallery.test.ts's own fixtures call it this way and never look at `.clip`
  // — this pins that the default does not regress the field either.
  const row = storyRowFrom(resultFor('S9'));
  assert.equal(row.clip, 'S9/story.webm');
});

test('storyRowFrom carries the first captured frame, for the clip-less fallback', () => {
  const row = storyRowFrom(resultFor('S9'), { root: '/fake/root', exists: () => false });
  assert.equal(row.firstFrame, 'S9/frames/01-a.png');
});

test('a row with no beats (and so no frame) has neither a clip nor a first frame', () => {
  const row = storyRowFrom({ story: { id: 'x', docs: { title: 't' } }, beats: [] }, { root: '/r', exists: () => false });
  assert.equal(row.clip, null);
  assert.equal(row.firstFrame, null);
});

test('the index renders NO <video> for a row whose clip is absent', () => {
  const rows = [{ id: 'S9', title: 'Story S9', status: 'green', beats: 1, greenBeats: 1, clip: null, firstFrame: null }];
  const html = renderGalleryIndex(rows);
  assert.doesNotMatch(html, /<video[^>]*src=/);
});

test('a clip-less row with a first frame renders that frame as an image', () => {
  const rows = [
    { id: 'S9', title: 'Story S9', status: 'green', beats: 1, greenBeats: 1, clip: null, firstFrame: 'S9/frames/01-a.png' },
  ];
  const html = renderGalleryIndex(rows);
  assert.match(html, /<img[^>]*src="S9\/frames\/01-a\.png"/);
  assert.doesNotMatch(html, /<video[^>]*src=/);
});

test('a clip-less, frame-less row renders a note instead of a broken player', () => {
  const rows = [{ id: 'S9', title: 'Story S9', status: 'green', beats: 1, greenBeats: 1, clip: null, firstFrame: null }];
  const html = renderGalleryIndex(rows);
  assert.match(html, /no clip recorded on this checkout/i);
});

test('a row WITH a clip still renders <video>, unchanged from today', () => {
  const rows = [{ id: 'S9', title: 'Story S9', status: 'green', beats: 1, greenBeats: 1, clip: 'S9/story.webm', firstFrame: 'S9/frames/01-a.png' }];
  const html = renderGalleryIndex(rows);
  assert.match(html, /<video src="S9\/story\.webm"/);
});
