/**
 * W8-B5 WI-2(b) (exit row E4, community-28) — the comment layer js-yaml
 * cannot round-trip.
 *
 * `serializeCommunityRegistry` is a bare `yaml.dump` of a freshly built plain
 * object, so EVERY registry write (CRUD add/edit/remove, the agent commit
 * finalizer, and now the refresh) destroys the file's curation comments.
 * These are the two pure text functions that close it:
 *
 *   - `extractLeadingCommentBlock` captures the header block so the serializer
 *     can re-emit it verbatim (the fix, in the ONE shared serializer);
 *   - `findCommentLinesInBlock` finds comments the serializer CANNOT preserve,
 *     so `forge studio lint` refuses them (closing the class: you cannot lose
 *     what the linter will not accept).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractLeadingCommentBlock, findCommentLinesInBlock } from './yaml-comments.ts';

// ---------------------------------------------------------------------------
// extractLeadingCommentBlock
// ---------------------------------------------------------------------------

test('extractLeadingCommentBlock captures every line above the first content line, verbatim', () => {
  const text = ['# one', '#', '# three', 'meta:', '  schemaVersion: 2', ''].join('\n');
  assert.equal(extractLeadingCommentBlock(text), '# one\n#\n# three\n');
});

test('extractLeadingCommentBlock keeps blank lines INSIDE the header but stops at the first content line', () => {
  const text = ['# a', '', '# b', 'meta:', '# not-a-header-comment'].join('\n');
  assert.equal(extractLeadingCommentBlock(text), '# a\n\n# b\n');
});

test('extractLeadingCommentBlock returns "" for a file with no header at all (never invents one)', () => {
  assert.equal(extractLeadingCommentBlock('meta:\n  schemaVersion: 2\n'), '');
  assert.equal(extractLeadingCommentBlock(''), '');
});

test('extractLeadingCommentBlock never swallows the whole file when it is comments only', () => {
  assert.equal(extractLeadingCommentBlock('# only\n# comments\n'), '# only\n# comments\n');
});

test('extractLeadingCommentBlock is idempotent: header + dump re-parses to the same header', () => {
  const header = '# curated\n# rationale\n';
  const round = extractLeadingCommentBlock(`${header}meta:\n  schemaVersion: 2\n`);
  assert.equal(extractLeadingCommentBlock(`${round}items: []\n`), header);
});

// ---------------------------------------------------------------------------
// findCommentLinesInBlock — the lint half
// ---------------------------------------------------------------------------

test('findCommentLinesInBlock reports a FULL-LINE comment inside the named block, by 1-based line number', () => {
  const text = [
    '# header',        // 1
    'meta:',           // 2
    '  schemaVersion: 2', // 3
    'items:',          // 4
    '  - id: a',       // 5
    '    # this one dies on the next write', // 6
    '    name: A',     // 7
  ].join('\n');
  assert.deepEqual(findCommentLinesInBlock(text, 'items'), [6]);
});

test('findCommentLinesInBlock reports a TRAILING inline comment inside the named block', () => {
  const text = ['items:', '  - id: a', '    stars: null # not a star count', ''].join('\n');
  assert.deepEqual(findCommentLinesInBlock(text, 'items'), [3]);
});

test('findCommentLinesInBlock reports the REAL seed shape: the two inline comments at registry.yaml:53-54', () => {
  const text = [
    'items:',                                                       // 1
    '  - id: pre-impl-interview',                                   // 2
    '    signals:',                                                 // 3
    '      # "156k installs" names a DIFFERENT unit (installs, not stars) — not a', // 4
    '      # pure k-notation star count, so left unparsed rather than fabricated.', // 5
    '      stars: null',                                            // 6
  ].join('\n');
  assert.deepEqual(findCommentLinesInBlock(text, 'items'), [4, 5]);
});

test('findCommentLinesInBlock does NOT report a "#" inside a quoted scalar (kills: a naive indexOf("#"))', () => {
  const text = [
    'items:',
    '  - id: a',
    '    sourceUrl: "https://github.com/o/r#readme"',
    "    desc: 'a # b'",
    '    name: plain#nospace',
    '',
  ].join('\n');
  assert.deepEqual(findCommentLinesInBlock(text, 'items'), []);
});

test('findCommentLinesInBlock ignores comments OUTSIDE the named block (the header is preserved, so it is legal)', () => {
  const text = [
    '# header comment',   // 1
    'meta:',              // 2
    '  # a meta comment', // 3
    'items:',             // 4
    '  - id: a',          // 5
    'sources: {}',        // 6
    '# trailing',         // 7
  ].join('\n');
  assert.deepEqual(findCommentLinesInBlock(text, 'items'), []);
});

test('findCommentLinesInBlock returns [] when the block is absent entirely', () => {
  assert.deepEqual(findCommentLinesInBlock('meta:\n  schemaVersion: 2\n', 'items'), []);
});
