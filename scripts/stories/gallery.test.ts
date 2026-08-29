/**
 * gallery.test.ts — the demo gallery, DERIVED and never hand-edited.
 *
 * §3.1: "Gallery index derived, never hand-edited." The old harness's index
 * was regenerated wholesale by a full run, which is why a scoped run could
 * silently drop rows for stories it did not execute.
 *
 * Shape (operator ruling, 2026-08-29): each run writes its own
 * `demos/stories/<id>/story.json`, and the index is derived by reading every
 * `story.json` on disk. So `npm run stories -- --story smoke` updates one
 * story's data and still renders a complete index — a single-story run can
 * never invalidate another story's row.
 *
 * Pinned before implementation (`_1.0/gate-manifests/M1-B.txt`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderGalleryIndex, storyRowFrom } from './gallery.mjs';

const rows = [
  { id: 'S5', title: 'Create an agent', status: 'red', beats: 4, greenBeats: 2, clip: 'S5/story.webm' },
  { id: 'smoke', title: 'Find a project from Home', status: 'green', beats: 2, greenBeats: 2, clip: 'smoke/story.webm' },
];

test('the index lists every story it was given, in id order', () => {
  const html = renderGalleryIndex(rows);
  assert.ok(html.includes('S5'));
  assert.ok(html.includes('smoke'));
  assert.ok(html.indexOf('S5') < html.indexOf('smoke'), 'rows must be sorted by id, not by input order');
});

test('the index is stable under input order — it sorts, it does not trust the caller', () => {
  // Kills an index whose row order depends on filesystem enumeration order,
  // which would make every regeneration a spurious diff.
  assert.equal(renderGalleryIndex(rows), renderGalleryIndex([...rows].reverse()));
});

test("each row embeds that story's clip", () => {
  const html = renderGalleryIndex(rows);
  assert.match(html, /smoke\/story\.webm/);
  assert.match(html, /S5\/story\.webm/);
});

test('a red story is shown as red — the gallery is a verdict, not a brochure', () => {
  // The gallery is BOTH the demo and the regression report. A failing story
  // displayed as if it passed makes the demo a lie.
  const html = renderGalleryIndex(rows);
  assert.match(html, /red/);
});

test('the index says it is generated, so nobody hand-edits it', () => {
  assert.match(renderGalleryIndex(rows), /generated/i);
});

test('an empty gallery renders a page rather than throwing', () => {
  // The first-ever run derives the index before any story.json exists.
  const html = renderGalleryIndex([]);
  assert.ok(html.length > 0);
  assert.match(html, /<html|<!doctype|<body/i);
});

test('storyRowFrom derives the row from a run result — nothing is stored twice', () => {
  // `status` is DERIVED from the beats, never carried as its own field. That
  // is the campaign's standing cure for declared-data-fails-open: derive the
  // value from its source of truth and give the object no field to store a
  // stale copy in.
  const row = storyRowFrom({
    story: { id: 'smoke', docs: { title: 'Find a project from Home' } },
    beats: [{ status: 'green' }, { status: 'green' }],
  });
  assert.equal(row.id, 'smoke');
  assert.equal(row.status, 'green');
  assert.equal(row.beats, 2);
  assert.equal(row.greenBeats, 2);
});

test('one red beat makes the whole story red', () => {
  const row = storyRowFrom({
    story: { id: 'S5', docs: { title: 'Create an agent' } },
    beats: [{ status: 'green' }, { status: 'red' }, { status: 'green' }],
  });
  assert.equal(row.status, 'red');
  assert.equal(row.greenBeats, 2);
  assert.equal(row.beats, 3);
});

test('a story with no beats is not reported green', () => {
  // Kills `beats.every(green)`, which is vacuously true on an empty array —
  // a story that ran nothing would report as a passing story.
  const row = storyRowFrom({ story: { id: 'x', docs: { title: 't' } }, beats: [] });
  assert.notEqual(row.status, 'green');
});
