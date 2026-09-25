/**
 * docs-fragment-placeholder-label.test.ts — a `data-*` value bound from a
 * story placeholder is labelled, not read as drift.
 *
 * forge-8vfn.2.27 (labelling half). The "what you should see" block renders
 * whatever `data-*` the run OBSERVED. A value the story declared as
 * `'<name>'` (see `PLACEHOLDER` in `beats-page-read.mjs`) is minted by the
 * product at run time — a project id, a session id — so it is expected to
 * differ on every run. Rendered as a bare fact ("`data-project-id` is
 * `gitweave-7f3a`"), a regenerated doc that shows a DIFFERENT id reads as an
 * undocumented change rather than the same story binding a fresh value.
 *
 * New file: `docs-fragment.test.ts` is one of the files this brief forbids
 * editing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDocFragment } from './docs-fragment.mjs';

const result = {
  story: { id: 'S1', docs: { kind: 'how-to', title: 'Create a project' } },
  beats: [
    {
      act: 'Create a project',
      say: 'A new project is onboarded and given an id.',
      status: 'green',
      failures: [],
      frame: 'frames/01-a.png',
      expect: { page: 'projects', 'project-id': '<projectId>' },
      data: { page: 'projects', 'project-id': 'gitweave-7f3a' },
    },
  ],
};

test('a data-* key declared as a placeholder is labelled as bound at run time', () => {
  const md = renderDocFragment(result);
  assert.match(
    md,
    /`data-project-id`.*<projectId>.*bound at run time.*gitweave-7f3a/,
    `expected a clearly-labelled placeholder entry, got:\n${md}`,
  );
});

test('a plain (non-placeholder) data-* key still renders as a bare fact, unlabelled', () => {
  const md = renderDocFragment(result);
  assert.match(md, /`data-page` is `projects`/);
  assert.doesNotMatch(md, /page.*bound at run time/);
});
