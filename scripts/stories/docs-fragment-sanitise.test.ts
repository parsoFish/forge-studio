/**
 * docs-fragment-sanitise.test.ts — a red beat's failure text is sanitised
 * before it is pasted into the generated doc's `> - ` blockquote.
 *
 * forge-8vfn.2.20. A playwright failure carries ANSI SGR escapes
 * (`\x1b[2m`…`\x1b[22m`) and a multi-line `Call log:` block. Pasted verbatim
 * into a markdown blockquote list item, both break the rendered page: the
 * escapes show up as literal control bytes and the `Call log:` block's own
 * newlines end the blockquote list item early, so the rest reads as loose
 * body text rather than the `> - ` line it was written as.
 *
 * New file: `docs-fragment.test.ts` is one of the files this brief forbids
 * editing, so this failure-text behaviour is pinned here instead.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDocFragment } from './docs-fragment.mjs';

const RED_FAILURE =
  'could not fill …: Timeout 5000ms exceeded.\nCall log:\n\x1b[2m  - waiting for locator\x1b[22m\n. The control is absent';

const result = {
  story: { id: 'S1', docs: { kind: 'how-to', title: 'A story' } },
  beats: [
    {
      act: 'Fill the field',
      say: 'Say',
      status: 'red',
      failures: [RED_FAILURE],
      frame: 'frames/01-a.png',
      data: {},
    },
  ],
};

test('a playwright failure with ANSI escapes and a Call log block renders as ONE clean blockquote line', () => {
  const md = renderDocFragment(result);
  // Global — not just the first physical line the naive verbatim paste
  // produces, which happens to precede both the escape and "Call log" simply
  // because they land on the LATER physical lines the embedded \n's create.
  assert.doesNotMatch(md, /\x1b/, 'no raw ANSI escape byte may reach the rendered doc');
  assert.doesNotMatch(md, /Call log/, 'the Call log block must be cut, not carried into the doc');

  const bulletLines = md.split('\n').filter((l) => l.startsWith('> - '));
  assert.equal(
    bulletLines.length,
    1,
    `expected exactly one blockquote failure line, got:\n${JSON.stringify(bulletLines)}`,
  );
  assert.match(bulletLines[0], /Timeout 5000ms exceeded/, 'the part of the message before Call log: is kept');

  // Nothing from inside the cut Call log block leaks onto a line of its own —
  // the naive paste puts "  - waiting for locator" and ". The control is
  // absent" on their own physical lines, outside any "> - " bullet.
  const leaked = md.split('\n').filter((l) => l.includes('waiting for locator') || l.includes('The control is absent'));
  assert.deepEqual(leaked, [], 'the cut portion must not surface anywhere in the doc');
});

test('a failure with no ANSI or Call log block renders unchanged', () => {
  const plain = { ...result, beats: [{ ...result.beats[0], failures: ['data-project-count: expected "3", absent from the page'] }] };
  const md = renderDocFragment(plain);
  assert.match(md, /> - data-project-count: expected "3", absent from the page/);
});
