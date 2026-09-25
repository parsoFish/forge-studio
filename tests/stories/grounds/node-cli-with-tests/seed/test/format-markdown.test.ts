/**
 * Unit tests for GFM markdown renderers in src/format.ts (WI-1).
 *
 * Gate: node --test --experimental-strip-types test/format-markdown.test.ts
 *
 * Covers:
 *   - markdownEscape (AC1, AC2)
 *   - renderSummaryMarkdown (AC3, AC4)
 *   - renderDeltaMarkdown (AC5)
 *   - renderTagsMarkdown (AC6, AC7)
 *   - renderCouplingMarkdown (AC8, AC9)
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  markdownEscape,
  renderSummaryMarkdown,
  renderDeltaMarkdown,
  renderTagsMarkdown,
  renderCouplingMarkdown,
} from '../src/format.ts';

import type { Summary } from '../src/stats.ts';
import type { CompareResult } from '../src/compare.ts';
import type { TagSpan } from '../src/tags.ts';
import type { CouplingRow } from '../src/coupling.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Split output into lines. */
function lines(s: string): string[] {
  return s.split('\n');
}

/**
 * Return the lines of the first GFM table found in the output
 * (starting at the first line that begins with '|').
 */
function firstTableLines(output: string): string[] {
  const ls = lines(output);
  const start = ls.findIndex((l) => l.startsWith('|'));
  if (start === -1) return [];
  // Collect contiguous table lines (starting with '|')
  const result: string[] = [];
  for (let i = start; i < ls.length; i++) {
    if (ls[i].startsWith('|')) result.push(ls[i]);
    else break;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSummary(overrides?: Partial<Summary>): Summary {
  return {
    totalCommits: 5,
    firstDate: '2024-01-01',
    lastDate: '2024-03-01',
    byAuthor: [
      { author: 'Ada Lovelace', commits: 3 },
      { author: 'Grace Hopper', commits: 2 },
    ],
    authorChurn: [
      { author: 'Ada Lovelace', commits: 3, insertions: 30, deletions: 10 },
      { author: 'Grace Hopper', commits: 2, insertions: 15, deletions: 5 },
    ],
    fileChurn: [],
    ownershipEntries: [],
    hotspotEntries: [],
    ...overrides,
  };
}

function makeCompareResult(): CompareResult {
  return {
    ref: 'v0.1',
    head: { commits: 7, linesAdded: 100, linesRemoved: 40 },
    base: { commits: 5, linesAdded: 70, linesRemoved: 30 },
    delta: { commits: 2, linesAdded: 30, linesRemoved: 10 },
    authorDeltas: [
      {
        author: 'Ada Lovelace',
        baseCommits: 3, headCommits: 5, deltaCommits: 2,
        baseChurn: 20, headChurn: 50, deltaChurn: 30,
      },
      {
        author: 'Grace Hopper',
        baseCommits: 2, headCommits: 2, deltaCommits: 0,
        baseChurn: 10, headChurn: 10, deltaChurn: 0,
      },
    ],
  };
}

function makeTagSpans(): TagSpan[] {
  return [
    { name: 'v0.3', date: '2021-04-03', commitsSince: 2, uniqueAuthors: 2, daysSince: 19 },
    { name: 'v0.2', date: '2021-03-15', commitsSince: 2, uniqueAuthors: 2, daysSince: 13 },
    { name: 'v0.1', date: '2021-03-02', commitsSince: 2, uniqueAuthors: 2, daysSince: null },
  ];
}

function makeCouplingRows(): CouplingRow[] {
  return [
    { fileA: 'src/a.ts', fileB: 'src/b.ts', coChanges: 5, couplingPct: 83.3 },
    { fileA: 'src/c.ts', fileB: 'src/d.ts', coChanges: 3, couplingPct: 60.0 },
  ];
}

// ---------------------------------------------------------------------------
// AC1 + AC2: markdownEscape
// ---------------------------------------------------------------------------

describe('markdownEscape', () => {
  it('AC1: plain string with no pipe characters is returned unchanged', () => {
    assert.strictEqual(markdownEscape('hello world'), 'hello world');
  });

  it('AC1: empty string is returned unchanged', () => {
    assert.strictEqual(markdownEscape(''), '');
  });

  it('AC1: string with commas but no pipes is returned unchanged', () => {
    // markdownEscape only escapes pipes — commas are fine
    assert.strictEqual(markdownEscape('a,b,c'), 'a,b,c');
  });

  it('AC2: single pipe is replaced by \\|', () => {
    assert.strictEqual(markdownEscape('a|b'), 'a\\|b');
  });

  it('AC2: multiple pipes are all replaced by \\|', () => {
    assert.strictEqual(markdownEscape('x|y|z'), 'x\\|y\\|z');
  });

  it('AC2: result does NOT use double-quote RFC-4180 wrapping', () => {
    const result = markdownEscape('a|b');
    assert.ok(!result.startsWith('"'), 'must not be RFC-4180 quoted');
  });

  it('AC2: mixed text and pipes — only pipes are escaped', () => {
    assert.strictEqual(markdownEscape('file|a.ts'), 'file\\|a.ts');
  });
});

// ---------------------------------------------------------------------------
// AC3 + AC4: renderSummaryMarkdown
// ---------------------------------------------------------------------------

describe('renderSummaryMarkdown', () => {
  it('AC3: with authors — first table line (line 0 of first table) starts with |', () => {
    const output = renderSummaryMarkdown(makeSummary());
    const tableLines = firstTableLines(output);
    assert.ok(tableLines.length >= 1, 'Expected at least one table line');
    assert.ok(tableLines[0].startsWith('|'), 'First table line must start with |');
  });

  it('AC3: with authors — line 1 of first table is a delimiter row matching /^\\|[ :-]+\\|/', () => {
    const output = renderSummaryMarkdown(makeSummary());
    const tableLines = firstTableLines(output);
    assert.ok(tableLines.length >= 2, 'Expected at least header + delimiter rows');
    assert.match(tableLines[1], /^\|[ :-]+\|/, 'Line 1 must be a GFM delimiter row');
  });

  it('AC3: with authors — header row contains "Author" column', () => {
    const output = renderSummaryMarkdown(makeSummary());
    const tableLines = firstTableLines(output);
    assert.ok(tableLines[0].includes('Author'), 'Header must contain "Author"');
  });

  it('AC3: with authors — data rows contain sentinel author names', () => {
    const output = renderSummaryMarkdown(makeSummary());
    assert.match(output, /Ada Lovelace/);
    assert.match(output, /Grace Hopper/);
  });

  it('AC3: with authors — delimiter row uses ---: for numeric columns (Commits)', () => {
    const output = renderSummaryMarkdown(makeSummary());
    const tableLines = firstTableLines(output);
    assert.ok(tableLines[1].includes('---:'), 'Numeric column must be right-aligned (---:)');
  });

  it('AC4: zero byAuthor — output contains header row starting with |', () => {
    const s = makeSummary({ byAuthor: [], authorChurn: [] });
    const output = renderSummaryMarkdown(s);
    const tableLines = firstTableLines(output);
    assert.ok(tableLines.length >= 1, 'Expected header row even with zero authors');
    assert.ok(tableLines[0].startsWith('|'), 'Header row must start with |');
  });

  it('AC4: zero byAuthor — output contains delimiter row', () => {
    const s = makeSummary({ byAuthor: [], authorChurn: [] });
    const output = renderSummaryMarkdown(s);
    const tableLines = firstTableLines(output);
    assert.ok(tableLines.length >= 2, 'Expected header + delimiter row');
    assert.match(tableLines[1], /^\|[ :-]+\|/);
  });

  it('AC4: zero byAuthor — zero data rows in commits table', () => {
    const s = makeSummary({ byAuthor: [], authorChurn: [] });
    const output = renderSummaryMarkdown(s);
    const tableLines = firstTableLines(output);
    // Only header (index 0) + delimiter (index 1) — no data rows
    assert.strictEqual(tableLines.length, 2, 'Zero authors must produce header + delimiter only');
  });

  it('AC4: zero byAuthor — output is not empty string', () => {
    const s = makeSummary({ byAuthor: [], authorChurn: [] });
    const output = renderSummaryMarkdown(s);
    assert.ok(output.length > 0, 'Output must not be empty string');
  });
});

// ---------------------------------------------------------------------------
// AC5: renderDeltaMarkdown
// ---------------------------------------------------------------------------

describe('renderDeltaMarkdown', () => {
  it('AC5: output contains two GFM tables', () => {
    const output = renderDeltaMarkdown(makeCompareResult());
    // Count lines starting with '|' that are table headers (contain '---' in next line)
    const ls = lines(output);
    const tablePipes = ls.filter((l) => l.startsWith('|'));
    // Minimum: 2 headers + 2 delimiters + data rows
    assert.ok(tablePipes.length >= 4, 'Expected at least 2 header rows + 2 delimiter rows');
  });

  it('AC5: first table (headline) has header row starting with |', () => {
    const output = renderDeltaMarkdown(makeCompareResult());
    const ls = lines(output);
    const firstPipeIdx = ls.findIndex((l) => l.startsWith('|'));
    assert.ok(firstPipeIdx >= 0, 'Expected at least one table line');
    assert.ok(ls[firstPipeIdx].startsWith('|'));
  });

  it('AC5: first table (headline) has delimiter row at line+1 matching /^\\|[ :-]+\\|/', () => {
    const output = renderDeltaMarkdown(makeCompareResult());
    const ls = lines(output);
    const firstPipeIdx = ls.findIndex((l) => l.startsWith('|'));
    assert.ok(firstPipeIdx + 1 < ls.length, 'Expected delimiter after header');
    assert.match(ls[firstPipeIdx + 1], /^\|[ :-]+\|/);
  });

  it('AC5: second table (per-author delta) has header row starting with |', () => {
    const output = renderDeltaMarkdown(makeCompareResult());
    const ls = lines(output);
    // Find the second group of pipe lines
    let firstGroupEnded = false;
    let secondTableStart = -1;
    let inPipes = false;
    for (let i = 0; i < ls.length; i++) {
      if (ls[i].startsWith('|')) {
        if (!inPipes) {
          if (firstGroupEnded) {
            secondTableStart = i;
            break;
          }
          inPipes = true;
        }
      } else {
        if (inPipes) {
          firstGroupEnded = true;
          inPipes = false;
        }
      }
    }
    assert.ok(secondTableStart >= 0, 'Expected a second GFM table');
    assert.ok(ls[secondTableStart].startsWith('|'));
  });

  it('AC5: second table (per-author delta) has delimiter row', () => {
    const output = renderDeltaMarkdown(makeCompareResult());
    const ls = lines(output);
    // Find start of second table group
    let firstGroupEnded = false;
    let secondTableStart = -1;
    let inPipes = false;
    for (let i = 0; i < ls.length; i++) {
      if (ls[i].startsWith('|')) {
        if (!inPipes) {
          if (firstGroupEnded) { secondTableStart = i; break; }
          inPipes = true;
        }
      } else {
        if (inPipes) { firstGroupEnded = true; inPipes = false; }
      }
    }
    assert.ok(secondTableStart >= 0 && secondTableStart + 1 < ls.length);
    assert.match(ls[secondTableStart + 1], /^\|[ :-]+\|/);
  });

  it('AC5: headline table contains sentinel commit counts', () => {
    const output = renderDeltaMarkdown(makeCompareResult());
    // head.commits=7, base.commits=5, delta=+2
    assert.match(output, /7/);
    assert.match(output, /5/);
    assert.match(output, /\+2/);
  });

  it('AC5: per-author table contains sentinel author names', () => {
    const output = renderDeltaMarkdown(makeCompareResult());
    assert.match(output, /Ada Lovelace/);
    assert.match(output, /Grace Hopper/);
  });
});

// ---------------------------------------------------------------------------
// AC6 + AC7: renderTagsMarkdown
// ---------------------------------------------------------------------------

describe('renderTagsMarkdown', () => {
  it('AC6: with spans — line 0 of output is the header row starting with |', () => {
    const output = renderTagsMarkdown(makeTagSpans(), 16);
    const ls = lines(output);
    assert.ok(ls[0].startsWith('|'), 'First line must start with |');
  });

  it('AC6: with spans — line 1 is a delimiter row matching /^\\|[ :-]+\\|/', () => {
    const output = renderTagsMarkdown(makeTagSpans(), 16);
    const ls = lines(output);
    assert.match(ls[1], /^\|[ :-]+\|/);
  });

  it('AC6: numeric columns (Commits, Authors, Days since prev) are right-aligned (---:)', () => {
    const output = renderTagsMarkdown(makeTagSpans(), 16);
    const ls = lines(output);
    const delim = ls[1];
    // Count ---: occurrences — there must be at least 3 (Commits, Authors, Days since prev)
    const rightAlignCount = (delim.match(/---:/g) ?? []).length;
    assert.ok(rightAlignCount >= 3, `Expected ≥3 right-aligned (---:) columns, got ${rightAlignCount}: "${delim}"`);
  });

  it('AC6: text columns (Tag, Date) are left-aligned (---)', () => {
    const output = renderTagsMarkdown(makeTagSpans(), 16);
    const ls = lines(output);
    const delim = ls[1];
    // --- without trailing : indicates left alignment
    const leftAlignCount = (delim.match(/---(?!:)/g) ?? []).length;
    assert.ok(leftAlignCount >= 2, `Expected ≥2 left-aligned (---) columns, got ${leftAlignCount}: "${delim}"`);
  });

  it('AC6: data rows contain sentinel tag names', () => {
    const output = renderTagsMarkdown(makeTagSpans(), 16);
    assert.match(output, /v0\.3/);
    assert.match(output, /v0\.2/);
    assert.match(output, /v0\.1/);
  });

  it('AC6: appends median gap line after the table', () => {
    const output = renderTagsMarkdown(makeTagSpans(), 16);
    assert.match(output, /Median inter-tag gap: 16 days/);
  });

  it('AC7: empty TagSpan[] — line 0 is header row starting with |', () => {
    const output = renderTagsMarkdown([], null);
    const ls = lines(output);
    assert.ok(ls[0].startsWith('|'), 'First line must be header row starting with |');
  });

  it('AC7: empty TagSpan[] — line 1 is delimiter row', () => {
    const output = renderTagsMarkdown([], null);
    const ls = lines(output);
    assert.match(ls[1], /^\|[ :-]+\|/);
  });

  it('AC7: empty TagSpan[] — no data rows (only header + delimiter before blank)', () => {
    const output = renderTagsMarkdown([], null);
    const ls = lines(output);
    // Lines starting with | should only be header (0) and delimiter (1)
    const pipeLines = ls.filter((l) => l.startsWith('|'));
    assert.strictEqual(pipeLines.length, 2, 'Empty spans must produce header + delimiter only');
  });

  it('AC7: empty TagSpan[] — median gap appended', () => {
    const output = renderTagsMarkdown([], null);
    assert.match(output, /Median inter-tag gap: N\/A/);
  });
});

// ---------------------------------------------------------------------------
// AC8 + AC9: renderCouplingMarkdown
// ---------------------------------------------------------------------------

describe('renderCouplingMarkdown', () => {
  it('AC8: with rows — line 0 is header row starting with |', () => {
    const output = renderCouplingMarkdown(makeCouplingRows());
    const ls = lines(output);
    assert.ok(ls[0].startsWith('|'), 'First line must be header row starting with |');
  });

  it('AC8: with rows — line 1 is delimiter row matching /^\\|[ :-]+\\|/', () => {
    const output = renderCouplingMarkdown(makeCouplingRows());
    const ls = lines(output);
    assert.match(ls[1], /^\|[ :-]+\|/);
  });

  it('AC8: with rows — data rows contain sentinel file paths', () => {
    const output = renderCouplingMarkdown(makeCouplingRows());
    assert.match(output, /src\/a\.ts/);
    assert.match(output, /src\/b\.ts/);
  });

  it('AC8: file path containing | is escaped as \\| in output', () => {
    const rows: CouplingRow[] = [
      { fileA: 'src/a|b.ts', fileB: 'src/c.ts', coChanges: 2, couplingPct: 50.0 },
    ];
    const output = renderCouplingMarkdown(rows);
    assert.match(output, /src\/a\\|b\.ts/, 'Pipe in fileA must be escaped as \\|');
  });

  it('AC8: escaped cell does NOT use double-quote wrapping', () => {
    const rows: CouplingRow[] = [
      { fileA: 'src/a|b.ts', fileB: 'src/c.ts', coChanges: 2, couplingPct: 50.0 },
    ];
    const output = renderCouplingMarkdown(rows);
    assert.ok(!output.includes('"src/a|b.ts"'), 'Must not use RFC-4180 double-quote wrapping');
  });

  it('AC8: coupling% column is right-aligned (---:)', () => {
    const output = renderCouplingMarkdown(makeCouplingRows());
    const ls = lines(output);
    assert.ok(ls[1].includes('---:'), 'Numeric coupling% column must use ---:');
  });

  it('AC9: empty CouplingRow[] — line 0 is header row starting with |', () => {
    const output = renderCouplingMarkdown([]);
    const ls = lines(output);
    assert.ok(ls[0].startsWith('|'), 'First line must be header row starting with |');
  });

  it('AC9: empty CouplingRow[] — line 1 is delimiter row', () => {
    const output = renderCouplingMarkdown([]);
    const ls = lines(output);
    assert.match(ls[1], /^\|[ :-]+\|/);
  });

  it('AC9: empty CouplingRow[] — zero data rows', () => {
    const output = renderCouplingMarkdown([]);
    const ls = lines(output);
    const pipeLines = ls.filter((l) => l.startsWith('|'));
    assert.strictEqual(pipeLines.length, 2, 'Empty rows must produce header + delimiter only');
  });

  it('AC9: empty CouplingRow[] — does NOT contain "no coupled file pairs found" text', () => {
    const output = renderCouplingMarkdown([]);
    assert.doesNotMatch(output, /no coupled file pairs found/);
  });
});
