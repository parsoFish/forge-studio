/**
 * story-selection.test.ts — `npm run stories -- --story A --story B` runs BOTH
 * (bead forge-8vfn.30.7). The runner used to read only the first `--story` and
 * drop the rest without a word, so a one-invocation batch ran one story.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectedStoryIds, selectStories } from './story-file.mjs';

const S = (id: string) => ({ id });

test('every --story value is collected, in argv order', () => {
  assert.deepEqual(
    selectedStoryIds(['--story', 'smoke', '--story', 'proof', '--approve-spend', '--story', 'S8']),
    ['smoke', 'proof', 'S8'],
  );
});

test('no --story selects nothing explicitly (null = the whole suite)', () => {
  assert.equal(selectedStoryIds(['--approve-spend']), null);
});

test('a --story with no value is refused, never read as "no selection"', () => {
  assert.throws(() => selectedStoryIds(['--story']), /--story needs a story id/);
  assert.throws(() => selectedStoryIds(['--story', '--approve-spend']), /--story needs a story id/);
});

test('selectStories keeps every selected story, in suite order', () => {
  const all = [S('S1'), S('S8'), S('proof'), S('smoke')];
  assert.deepEqual(selectStories(all, ['smoke', 'S8', 'proof']).map((s) => s.id), ['S8', 'proof', 'smoke']);
});

test('selectStories refuses naming EVERY id that matched nothing', () => {
  assert.throws(() => selectStories([S('smoke')], ['smoke', 'nope', 'S99']), /"nope", "S99" matched nothing/);
});

test('selectStories with null returns the suite unchanged', () => {
  const all = [S('S1'), S('smoke')];
  assert.deepEqual(selectStories(all, null), all);
});
