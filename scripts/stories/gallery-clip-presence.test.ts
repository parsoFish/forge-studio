/**
 * gallery-clip-presence.test.ts — a fresh clone without the gitignored webm
 * still shows something real: the first captured frame as the video's poster.
 *
 * forge-8vfn.2.34, REVISED (coordinator review of the first pass). The first
 * pass made `clip` existence-checked against the DISK, which fixed the
 * fresh-clone problem only for whichever row path opted in — and the
 * COMMITTED `demos/stories/index.html` (what a fresh clone actually sees)
 * never opted in, so it kept linking to a webm nobody has. The fix must not
 * depend on what happens to be on disk at generation time: `clip` is always
 * `<id>/story.webm` again (frames ARE tracked, the clip never is), and the
 * `<video>` always renders — it just carries a `poster` of the first frame
 * when one was captured, so the empty-player case a fresh clone would
 * otherwise show has a real picture instead.
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

test('storyRowFrom always carries clip — no disk check, no option to omit it', () => {
  const row = storyRowFrom(resultFor('S9'));
  assert.equal(row.clip, 'S9/story.webm');
});

test('storyRowFrom carries the first captured frame', () => {
  const row = storyRowFrom(resultFor('S9'));
  assert.equal(row.firstFrame, 'S9/frames/01-a.png');
});

test('a row with no beats (and so no frame) still carries its clip, but no first frame', () => {
  const row = storyRowFrom({ story: { id: 'x', docs: { title: 't' } }, beats: [] });
  assert.equal(row.clip, 'x/story.webm');
  assert.equal(row.firstFrame, null);
});

test('a row with a known first frame renders a video carrying that frame as its poster', () => {
  const rows = [{ id: 'S9', title: 'Story S9', status: 'green', beats: 1, greenBeats: 1, clip: 'S9/story.webm', firstFrame: 'S9/frames/01-a.png' }];
  const html = renderGalleryIndex(rows);
  assert.match(html, /<video src="S9\/story\.webm" poster="S9\/frames\/01-a\.png"/);
});

test('a row with no first frame renders a video with no poster attribute at all', () => {
  const rows = [{ id: 'S9', title: 'Story S9', status: 'green', beats: 1, greenBeats: 1, clip: 'S9/story.webm', firstFrame: null }];
  const html = renderGalleryIndex(rows);
  assert.match(html, /<video src="S9\/story\.webm" autoplay/);
  assert.doesNotMatch(html, /poster=/);
});

test('the index never falls back to <img> or a note — the video always renders', () => {
  const rows = [{ id: 'S9', title: 'Story S9', status: 'green', beats: 1, greenBeats: 1, clip: 'S9/story.webm', firstFrame: 'S9/frames/01-a.png' }];
  const html = renderGalleryIndex(rows);
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /no clip recorded/i);
});
