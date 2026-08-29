/**
 * docs-fragment.test.ts — the usage doc, generated from the same run that
 * produced the verdict and the clip.
 *
 * This is the point of the whole harness (1.0.md §3): "One script yields three
 * artifacts: the e2e verdict, the demo clip and frames, and the usage-doc
 * fragment — so the tests, the demos and the docs cannot drift from each
 * other." A doc written by hand beside a test is a doc that goes stale
 * silently; a doc derived from the run that just passed cannot.
 *
 * Shape (operator ruling, 2026-08-29): beat = numbered step.
 *
 * Pinned before implementation (`_1.0/gate-manifests/M1-B.txt`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDocFragment, docPathFor } from './docs-fragment.mjs';

const result = {
  story: { id: 'smoke', docs: { kind: 'how-to', title: 'Find a project from Home' } },
  beats: [
    {
      act: 'Open Studio on Home',
      say: 'Studio opens on Home — the operator pulse across every project.',
      status: 'green',
      failures: [],
      frame: 'frames/01-home.png',
      data: { 'page-ready': 'true' },
    },
    {
      act: 'Click through to the Projects pillar',
      say: 'The Projects pillar lists every project forge manages.',
      status: 'green',
      failures: [],
      frame: 'frames/02-projects.png',
      data: { 'page-ready': 'true', 'project-count': '3' },
    },
  ],
};

test('a how-to lands under docs/how-to/, a tutorial under docs/tutorials/', () => {
  assert.equal(docPathFor(result.story, '/r'), '/r/docs/how-to/smoke.md');
  assert.equal(
    docPathFor({ id: 'S1', docs: { kind: 'tutorial', title: 't' } }, '/r'),
    '/r/docs/tutorials/S1.md',
  );
});

test('every beat becomes one numbered step, in order', () => {
  const md = renderDocFragment(result);
  assert.match(md, /## 1\. Open Studio on Home/);
  assert.match(md, /## 2\. Click through to the Projects pillar/);
  assert.ok(
    md.indexOf('## 1.') < md.indexOf('## 2.'),
    'steps must appear in beat order, not sorted or reversed',
  );
});

test("each step carries the beat's narration as its prose", () => {
  // Kills a renderer that emits only acts: `say` is the explanation, and a
  // how-to step without it is a bare instruction with no reason.
  const md = renderDocFragment(result);
  assert.match(md, /Studio opens on Home/);
  assert.match(md, /lists every project forge manages/);
});

test('each step embeds the frame captured for that beat', () => {
  const md = renderDocFragment(result);
  assert.match(md, /frames\/01-home\.png/);
  assert.match(md, /frames\/02-projects\.png/);
});

test('the asserted data-* state appears, so the doc says what to look for', () => {
  const md = renderDocFragment(result);
  assert.match(md, /project-count/);
});

test('the fragment declares it is generated and names its source story', () => {
  // Kills the drift this whole design exists to prevent: a reader (or an
  // agent) must be told not to hand-edit, and told which file to edit instead.
  const md = renderDocFragment(result);
  assert.match(md, /generated/i);
  assert.match(md, /tests\/stories\/smoke\.story\.mjs/);
});

test('the title from the story header becomes the document title', () => {
  assert.match(renderDocFragment(result), /Find a project from Home/);
});

test('a red beat is rendered as red, never quietly presented as working usage', () => {
  // The gravest failure mode of a generated doc: a story that FAILED emitting
  // a confident how-to telling operators to do something that does not work.
  const red = {
    ...result,
    beats: [{ ...result.beats[0], status: 'red', failures: ['data-project-count: expected "3", absent from the page'] }],
  };
  const md = renderDocFragment(red);
  assert.match(md, /project-count/);
  assert.match(md, /\bred\b|\bFAILED\b|\bnot verified\b/i);
});
