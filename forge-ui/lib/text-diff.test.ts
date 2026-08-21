/**
 * W7-C2 (sessions-kinds-30) — `lineDiff`, the small pure line-level diff
 * backing the AGENTS.md verdict screen's draft-vs-current view
 * (SessionArtifactPane's MarkdownDraftBody). LCS over lines; rows are
 * {type: 'same'|'add'|'del', text} in display order. Deliberately tiny —
 * a display aid, never a patch engine.
 *
 * RUN: npx vitest run lib/text-diff.test.ts   (from forge-ui/)
 */

import { test, expect, describe, it } from 'vitest';

import { lineDiff } from './text-diff';

test('C2-DIFF-1: identical texts -> all rows "same", none added/deleted', () => {
  const rows = lineDiff('a\nb\nc', 'a\nb\nc');
  // 3 lines is far under MAX_LCS_CELLS, so the fail-soft null branch
  // (C2-DIFF-8) is not a legal outcome here — fail on it explicitly
  // rather than as a TypeError, and narrow for the reads below.
  if (rows === null) throw new Error('lineDiff returned null well under the size cap');
  expect(rows.every((r) => r.type === 'same')).toBe(true);
  expect(rows.map((r) => r.text)).toEqual(['a', 'b', 'c']);
});

test('C2-DIFF-2: a pure addition shows up as "add" rows in position', () => {
  const rows = lineDiff('a\nc', 'a\nb\nc');
  expect(rows).toEqual([
    { type: 'same', text: 'a' },
    { type: 'add', text: 'b' },
    { type: 'same', text: 'c' },
  ]);
});

test('C2-DIFF-3: a pure deletion shows up as "del" rows in position', () => {
  const rows = lineDiff('a\nb\nc', 'a\nc');
  expect(rows).toEqual([
    { type: 'same', text: 'a' },
    { type: 'del', text: 'b' },
    { type: 'same', text: 'c' },
  ]);
});

test('C2-DIFF-4: a changed line renders as del + add (never silently merged)', () => {
  const rows = lineDiff('hello world', 'hello forge');
  expect(rows).toEqual([
    { type: 'del', text: 'hello world' },
    { type: 'add', text: 'hello forge' },
  ]);
});

test('C2-DIFF-5: empty old text -> every line is an "add" (the init-mode shape)', () => {
  const rows = lineDiff('', 'a\nb');
  expect(rows).toEqual([
    { type: 'add', text: 'a' },
    { type: 'add', text: 'b' },
  ]);
});

test('C2-DIFF-6: empty new text -> every line is a "del"', () => {
  const rows = lineDiff('a\nb', '');
  expect(rows).toEqual([
    { type: 'del', text: 'a' },
    { type: 'del', text: 'b' },
  ]);
});

test('C2-DIFF-7: both empty -> no rows (never a phantom empty-string row pair)', () => {
  expect(lineDiff('', '')).toEqual([]);
});

test('C2-DIFF-8: oversized inputs fail SOFT — null (caller renders an honest "too large to diff"), never a hung tab', () => {
  const big = Array.from({ length: 3000 }, (_, i) => `line ${i}`).join('\n');
  const alsoBig = Array.from({ length: 3000 }, (_, i) => `LINE ${i}`).join('\n');
  expect(lineDiff(big, alsoBig)).toBeNull();
});

// W7-C2 T1 review (A9) — the size cap had a hole at either extreme: it was
// measured against `n * m` while the allocation is `(n+1) * (m+1)`, so with
// one side EMPTY the product is 0 for any m and the cap never fired.
describe('W7-C2 T1 review — the size cap measures the ALLOCATION, not n*m', () => {
  it('C2-FIX-A9-1: an empty old side against a huge new side is capped (the n === 0 hole)', () => {
    const huge = 'x\n'.repeat(5_000_000);
    expect(lineDiff('', huge)).toBeNull();
  });

  it('C2-FIX-A9-2: a huge old side against an empty new side is capped too (the mirror hole)', () => {
    const huge = 'x\n'.repeat(5_000_000);
    expect(lineDiff(huge, '')).toBeNull();
  });

  it('C2-FIX-A9-3: ordinary AGENTS.md-scale inputs still diff (the cap did not become over-eager)', () => {
    const rows = lineDiff('a\nb\nc', 'a\nB\nc');
    expect(rows).not.toBeNull();
    expect(rows!.map((r) => r.type)).toEqual(['same', 'del', 'add', 'same']);
  });
});
