/**
 * docs-site.test.ts — the docs site flags a page older than its freshness
 * window: 120 days for guides and how-tos, 180 for reference and explanation.
 *
 * The build-level refusals (a page missing a required field, a broken internal
 * link) need a real `astro build` of a copy of the site, which writes a
 * directory tree; they run in the CI `docs` job, not here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStale, windowDays } from '../apps/docs/src/freshness.mjs';

const DAY = 24 * 60 * 60 * 1000;

test('freshness windows: 120 days for guides, how-tos and the landing page, 180 for reference and explanation', () => {
  assert.equal(windowDays('guide'), 120);
  assert.equal(windowDays('how-to'), 120);
  assert.equal(windowDays('reference'), 180);
  assert.equal(windowDays('explanation'), 180);
  assert.equal(windowDays('landing'), 120);
  assert.throws(() => windowDays('tutorial'), /unknown page type/);
});

test('a page is stale only past its window', () => {
  const now = new Date('2026-10-05T00:00:00Z');
  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  assert.equal(isStale('guide', ago(120), now), false);
  assert.equal(isStale('guide', ago(121), now), true);
  assert.equal(isStale('reference', ago(180), now), false);
  assert.equal(isStale('reference', ago(181), now), true);
  assert.throws(() => isStale('guide', new Date('nope'), now), /not a valid date/);
});
