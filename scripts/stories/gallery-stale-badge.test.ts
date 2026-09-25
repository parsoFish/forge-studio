/**
 * gallery-stale-badge.test.ts — the gallery index marks a stale row with a
 * visible badge.
 *
 * Findings row 56 + row 14, T1 ruling 1283 (option B). `renderGalleryIndex`
 * takes the staleness list `artifact-staleness.mjs`'s `staleArtifacts` produces
 * as an input, so a card whose story has moved on since its artifact was
 * committed is visibly marked rather than silently presented as current.
 *
 * New file: `gallery.test.ts` is one of the files this brief forbids editing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderGalleryIndex } from './gallery.mjs';

const row = (id) => ({ id, title: `Story ${id}`, status: 'green', beats: 1, greenBeats: 1, clip: `${id}/story.webm` });

test('a row named in the staleness list carries a visible badge naming the reason', () => {
  const html = renderGalleryIndex([row('SX')], [{ id: 'SX', reason: 'stale since abc1234' }]);
  assert.match(html, /stale since abc1234/);
});

test('the "no digest" reason is also rendered as a visible badge', () => {
  const html = renderGalleryIndex([row('SX')], [{ id: 'SX', reason: 'no digest — recorded before provenance' }]);
  assert.match(html, /no digest — recorded before provenance/);
});

test('a row absent from the staleness list carries no badge', () => {
  const html = renderGalleryIndex([row('SX')], [{ id: 'OTHER', reason: 'stale since abc1234' }]);
  assert.doesNotMatch(html, /stale since/);
});

test('calling renderGalleryIndex with no staleness list at all still renders, badge-free', () => {
  const html = renderGalleryIndex([row('SX')]);
  // NOT a bare `/stale-badge/` — the stylesheet declares that class's rule on
  // every render, badge or none, so that substring alone is a false positive.
  // The finding is a USED badge element, or the "stale since" text it carries.
  assert.doesNotMatch(html, /<p class="stale-badge"/);
  assert.doesNotMatch(html, /stale since/i);
});
