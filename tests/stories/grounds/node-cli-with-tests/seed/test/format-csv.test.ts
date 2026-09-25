/**
 * Unit tests for CSV renderers in src/format.ts (WI-2).
 *
 * Gate: node --test --experimental-strip-types test/format-csv.test.ts
 *
 * Covers:
 *   - csvEscape (WI-1 baseline)
 *   - renderAuthorsCsv   (AC1, AC8, AC9)
 *   - renderChurnFileCsv (AC2, AC8, AC9)
 *   - renderChurnAuthorCsv (AC3, AC8, AC9)
 *   - renderOwnershipCsv (AC4, AC8)
 *   - renderHotspotsCsv  (AC5, AC8)
 *   - renderCompareCsv   (AC6, AC8)
 *   - renderSummaryCsv   (AC7)
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  csvEscape,
  renderAuthorsCsv,
  renderChurnFileCsv,
  renderChurnAuthorCsv,
  renderOwnershipCsv,
  renderHotspotsCsv,
  renderCompareCsv,
  renderSummaryCsv,
} from '../src/format.ts';

import type { Summary } from '../src/stats.ts';
import type { CompareResult } from '../src/compare.ts';
import type { FileOwnership } from '../src/ownership.ts';
import type { HotspotEntry } from '../src/hotspot.ts';
import type { FileChurn } from '../src/churn.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Split a CSV string into lines. */
function lines(csv: string): string[] {
  return csv.split('\n');
}

/** Split a CSV line into raw fields (no unquoting — just splitting by comma). */
function rawFields(line: string): string[] {
  return line.split(',');
}

/** Count columns on every data row (non-header) and assert they match expected. */
function assertColumnCount(csv: string, expected: number, label: string): void {
  const ls = lines(csv);
  for (let i = 1; i < ls.length; i++) {
    const row = ls[i];
    if (row.trim() === '') continue; // blank separator rows are OK
    // Count commas not inside quotes (simple heuristic sufficient for our test data).
    let count = 1;
    let inQuote = false;
    for (const ch of row) {
      if (ch === '"') inQuote = !inQuote;
      if (ch === ',' && !inQuote) count++;
    }
    assert.equal(count, expected, `${label}: row ${i} has ${count} columns, expected ${expected}: "${row}"`);
  }
}

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

/** Minimal Summary with two sentinel authors and file-churn data. */
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
    fileChurn: [
      { file: 'src/engine.ts', insertions: 20, deletions: 5, commits: 3 },
      { file: 'src/compiler.ts', insertions: 10, deletions: 3, commits: 2 },
    ],
    ownershipEntries: [
      { file: 'src/engine.ts', owner: 'Ada Lovelace', ownerLines: 80, busFactor: 2 },
      { file: 'src/compiler.ts', owner: 'Grace Hopper', ownerLines: 50, busFactor: 1 },
    ],
    hotspotEntries: [
      { file: 'src/engine.ts', score: 3.0, commits: 3, lastDate: '2024-03-01' },
      { file: 'src/compiler.ts', score: 1.5, commits: 2, lastDate: '2024-02-01' },
    ],
    ...overrides,
  };
}

/** A CompareResult with sentinel values for two authors. */
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

// ---------------------------------------------------------------------------
// csvEscape (WI-1 baseline)
// ---------------------------------------------------------------------------

describe('csvEscape', () => {
  it('AC1: plain value with no special characters is returned unchanged', () => {
    assert.strictEqual(csvEscape('hello'), 'hello');
  });

  it('AC2: value containing a comma is wrapped in double-quotes', () => {
    assert.strictEqual(csvEscape('hello,world'), '"hello,world"');
  });

  it('AC3: value containing a double-quote has inner quotes doubled and is wrapped', () => {
    assert.strictEqual(csvEscape('say "hi"'), '"say ""hi"""');
  });

  it('AC4: value containing a newline is wrapped in double-quotes', () => {
    assert.strictEqual(csvEscape('line\nbreak'), '"line\nbreak"');
  });

  it('AC5: unicode string is returned unchanged without corruption or quoting', () => {
    assert.strictEqual(csvEscape('café'), 'café');
  });
});

// ---------------------------------------------------------------------------
// AC1: renderAuthorsCsv
// ---------------------------------------------------------------------------

describe('renderAuthorsCsv', () => {
  it('AC1: header row is "Author,Commits,Lines Added,Lines Deleted"', () => {
    const csv = renderAuthorsCsv(makeSummary());
    assert.strictEqual(lines(csv)[0], 'Author,Commits,Lines Added,Lines Deleted');
  });

  it('AC1: one data row per author', () => {
    const s = makeSummary();
    const csv = renderAuthorsCsv(s);
    const ls = lines(csv);
    assert.strictEqual(ls.length - 1, s.byAuthor.length);
  });

  it('AC1: sentinel author appears in output', () => {
    const csv = renderAuthorsCsv(makeSummary());
    assert.match(csv, /Ada Lovelace/);
    assert.match(csv, /Grace Hopper/);
  });

  it('AC1: commit count is byte-identical to byAuthor value (AC9)', () => {
    const s = makeSummary();
    const csv = renderAuthorsCsv(s);
    const ls = lines(csv);
    // Ada Lovelace: 3 commits
    assert.match(ls[1], /,3,/);
  });

  it('AC1: insertions and deletions are byte-identical to authorChurn values (AC9)', () => {
    const s = makeSummary();
    const csv = renderAuthorsCsv(s);
    const ls = lines(csv);
    // Ada Lovelace: insertions=30, deletions=10 → row ends in ,30,10
    assert.match(ls[1], /,30,10$/);
  });

  it('AC1: 4 columns on every data row', () => {
    assertColumnCount(renderAuthorsCsv(makeSummary()), 4, 'renderAuthorsCsv');
  });

  it('AC8: author name with comma is RFC-4180 quoted', () => {
    const s = makeSummary({
      byAuthor: [{ author: 'Smith, John', commits: 1 }],
      authorChurn: [{ author: 'Smith, John', commits: 1, insertions: 5, deletions: 2 }],
    });
    const csv = renderAuthorsCsv(s);
    assert.match(csv, /"Smith, John"/);
  });
});

// ---------------------------------------------------------------------------
// AC2: renderChurnFileCsv
// ---------------------------------------------------------------------------

describe('renderChurnFileCsv', () => {
  it('AC2: header row is "File,Churn Score,Commits,Lines Added,Lines Deleted"', () => {
    const csv = renderChurnFileCsv(makeSummary());
    assert.strictEqual(lines(csv)[0], 'File,Churn Score,Commits,Lines Added,Lines Deleted');
  });

  it('AC2: one data row per file', () => {
    const s = makeSummary();
    const csv = renderChurnFileCsv(s);
    const ls = lines(csv);
    assert.strictEqual(ls.length - 1, s.fileChurn.length);
  });

  it('AC2: sentinel file paths appear in output', () => {
    const csv = renderChurnFileCsv(makeSummary());
    assert.match(csv, /src\/engine\.ts/);
    assert.match(csv, /src\/compiler\.ts/);
  });

  it('AC2: churn score = insertions + deletions (AC9)', () => {
    const s = makeSummary();
    const csv = renderChurnFileCsv(s);
    const ls = lines(csv);
    // src/engine.ts: insertions=20, deletions=5 → churn score=25, commits=3, ins=20, del=5
    assert.match(ls[1], /,25,3,20,5$/);
  });

  it('AC2: 5 columns on every data row', () => {
    assertColumnCount(renderChurnFileCsv(makeSummary()), 5, 'renderChurnFileCsv');
  });

  it('AC8: file path with comma is RFC-4180 quoted', () => {
    const s = makeSummary({
      fileChurn: [
        { file: 'src/old,new.ts', insertions: 5, deletions: 2, commits: 1 },
      ] as FileChurn[],
    });
    const csv = renderChurnFileCsv(s);
    assert.match(csv, /"src\/old,new\.ts"/);
  });
});

// ---------------------------------------------------------------------------
// AC3: renderChurnAuthorCsv
// ---------------------------------------------------------------------------

describe('renderChurnAuthorCsv', () => {
  it('AC3: header row is "Author,Churn Score,Commits,Lines Added,Lines Deleted"', () => {
    const csv = renderChurnAuthorCsv(makeSummary());
    assert.strictEqual(lines(csv)[0], 'Author,Churn Score,Commits,Lines Added,Lines Deleted');
  });

  it('AC3: one data row per author-churn entry', () => {
    const s = makeSummary();
    const csv = renderChurnAuthorCsv(s);
    const ls = lines(csv);
    assert.strictEqual(ls.length - 1, s.authorChurn.length);
  });

  it('AC3: sentinel authors appear in output', () => {
    const csv = renderChurnAuthorCsv(makeSummary());
    assert.match(csv, /Ada Lovelace/);
    assert.match(csv, /Grace Hopper/);
  });

  it('AC3: churn score = insertions + deletions, and values byte-identical to authorChurn (AC9)', () => {
    const s = makeSummary();
    const csv = renderChurnAuthorCsv(s);
    const ls = lines(csv);
    // Ada: churn=40, commits=3, ins=30, del=10
    assert.match(ls[1], /,40,3,30,10$/);
  });

  it('AC3: 5 columns on every data row', () => {
    assertColumnCount(renderChurnAuthorCsv(makeSummary()), 5, 'renderChurnAuthorCsv');
  });

  it('AC8: author name with comma is RFC-4180 quoted', () => {
    const s = makeSummary({
      authorChurn: [
        { author: 'Smith, Jane', commits: 2, insertions: 10, deletions: 3 },
      ],
    });
    const csv = renderChurnAuthorCsv(s);
    assert.match(csv, /"Smith, Jane"/);
  });
});

// ---------------------------------------------------------------------------
// AC4: renderOwnershipCsv
// ---------------------------------------------------------------------------

describe('renderOwnershipCsv', () => {
  it('AC4: header row is "File,Owner,Ownership %,Commits"', () => {
    const csv = renderOwnershipCsv(makeSummary());
    assert.strictEqual(lines(csv)[0], 'File,Owner,Ownership %,Commits');
  });

  it('AC4: one data row per ownership entry', () => {
    const s = makeSummary();
    const csv = renderOwnershipCsv(s);
    const ls = lines(csv);
    assert.strictEqual(ls.length - 1, s.ownershipEntries.length);
  });

  it('AC4: sentinel file and owner appear in output', () => {
    const csv = renderOwnershipCsv(makeSummary());
    assert.match(csv, /src\/engine\.ts/);
    assert.match(csv, /Ada Lovelace/);
  });

  it('AC4: ownerLines and busFactor are byte-identical to ownershipEntries values (AC9)', () => {
    const s = makeSummary();
    const csv = renderOwnershipCsv(s);
    const ls = lines(csv);
    // src/engine.ts, Ada Lovelace, ownerLines=80, busFactor=2
    assert.match(ls[1], /,80,2$/);
  });

  it('AC4: 4 columns on every data row', () => {
    assertColumnCount(renderOwnershipCsv(makeSummary()), 4, 'renderOwnershipCsv');
  });

  it('AC4: empty ownershipEntries → header-only output', () => {
    const s = makeSummary({ ownershipEntries: [] });
    const csv = renderOwnershipCsv(s);
    assert.strictEqual(csv, 'File,Owner,Ownership %,Commits');
  });

  it('AC8: file path with comma is RFC-4180 quoted', () => {
    const s = makeSummary({
      ownershipEntries: [
        { file: 'src/a,b.ts', owner: 'Ada Lovelace', ownerLines: 10, busFactor: 1 },
      ] as FileOwnership[],
    });
    const csv = renderOwnershipCsv(s);
    assert.match(csv, /"src\/a,b\.ts"/);
  });

  it('AC8: owner name with comma is RFC-4180 quoted', () => {
    const s = makeSummary({
      ownershipEntries: [
        { file: 'src/a.ts', owner: 'Smith, John', ownerLines: 10, busFactor: 1 },
      ] as FileOwnership[],
    });
    const csv = renderOwnershipCsv(s);
    assert.match(csv, /"Smith, John"/);
  });
});

// ---------------------------------------------------------------------------
// AC5: renderHotspotsCsv
// ---------------------------------------------------------------------------

describe('renderHotspotsCsv', () => {
  it('AC5: header row is "File,Score,Commits,Authors"', () => {
    const csv = renderHotspotsCsv(makeSummary());
    assert.strictEqual(lines(csv)[0], 'File,Score,Commits,Authors');
  });

  it('AC5: one data row per hotspot entry', () => {
    const s = makeSummary();
    const csv = renderHotspotsCsv(s);
    const ls = lines(csv);
    assert.strictEqual(ls.length - 1, s.hotspotEntries.length);
  });

  it('AC5: sentinel file paths appear in output', () => {
    const csv = renderHotspotsCsv(makeSummary());
    assert.match(csv, /src\/engine\.ts/);
    assert.match(csv, /src\/compiler\.ts/);
  });

  it('AC5: score is formatted to 2 decimal places and byte-identical to hotspotEntries (AC9)', () => {
    const s = makeSummary();
    const csv = renderHotspotsCsv(s);
    const ls = lines(csv);
    // src/engine.ts: score=3.00, commits=3
    assert.match(ls[1], /,3\.00,3,/);
  });

  it('AC5: commits count is byte-identical to hotspotEntries value (AC9)', () => {
    const s = makeSummary();
    const csv = renderHotspotsCsv(s);
    const ls = lines(csv);
    // src/compiler.ts: score=1.50, commits=2
    assert.match(ls[2], /,1\.50,2,/);
  });

  it('AC5: 4 columns on every data row', () => {
    assertColumnCount(renderHotspotsCsv(makeSummary()), 4, 'renderHotspotsCsv');
  });

  it('AC8: file path with comma is RFC-4180 quoted', () => {
    const s = makeSummary({
      hotspotEntries: [
        { file: 'src/a,b.ts', score: 2.5, commits: 3, lastDate: '2024-01-01' },
      ] as HotspotEntry[],
    });
    const csv = renderHotspotsCsv(s);
    assert.match(csv, /"src\/a,b\.ts"/);
  });
});

// ---------------------------------------------------------------------------
// AC6: renderCompareCsv
// ---------------------------------------------------------------------------

describe('renderCompareCsv', () => {
  it('AC6: first section header is "Metric,Head,Base,Delta"', () => {
    const csv = renderCompareCsv(makeCompareResult());
    assert.strictEqual(lines(csv)[0], 'Metric,Head,Base,Delta');
  });

  it('AC6: per-author section header is "Author,Delta Commits,Delta Lines"', () => {
    const csv = renderCompareCsv(makeCompareResult());
    const ls = lines(csv);
    // Headline section: 1 header + 3 data rows = 4 lines. Then blank. Then author header at index 5.
    const authorHeaderIdx = ls.indexOf('Author,Delta Commits,Delta Lines');
    assert.ok(authorHeaderIdx > 0, 'Author section header not found');
  });

  it('AC6: headline section contains sentinel commit counts', () => {
    const r = makeCompareResult();
    const csv = renderCompareCsv(r);
    // commits row: commits,7,5,2
    assert.match(csv, /^commits,7,5,2$/m);
  });

  it('AC6: headline section contains lines added row', () => {
    const r = makeCompareResult();
    const csv = renderCompareCsv(r);
    assert.match(csv, /^lines added,100,70,30$/m);
  });

  it('AC6: headline section contains lines removed row', () => {
    const r = makeCompareResult();
    const csv = renderCompareCsv(r);
    assert.match(csv, /^lines removed,40,30,10$/m);
  });

  it('AC6: per-author row has sentinel deltaCommits and deltaChurn (AC9)', () => {
    const r = makeCompareResult();
    const csv = renderCompareCsv(r);
    // Ada Lovelace: deltaCommits=2, deltaChurn=30
    assert.match(csv, /Ada Lovelace,2,30/);
  });

  it('AC6: sections separated by a blank row', () => {
    const csv = renderCompareCsv(makeCompareResult());
    const ls = lines(csv);
    // Must contain an empty line between the two sections.
    assert.ok(ls.includes(''), 'Expected blank separator row between sections');
  });

  it('AC6: headline section has 4 columns on data rows', () => {
    const csv = renderCompareCsv(makeCompareResult());
    const ls = lines(csv);
    // Rows 1..3 are headline data rows.
    for (let i = 1; i <= 3; i++) {
      const cols = rawFields(ls[i]);
      assert.strictEqual(cols.length, 4, `Headline row ${i} must have 4 columns`);
    }
  });

  it('AC6: per-author section has 3 columns on data rows', () => {
    const csv = renderCompareCsv(makeCompareResult());
    const ls = lines(csv);
    const authorHeaderIdx = ls.indexOf('Author,Delta Commits,Delta Lines');
    for (let i = authorHeaderIdx + 1; i < ls.length; i++) {
      if (ls[i].trim() === '') continue;
      const cols = rawFields(ls[i]);
      assert.strictEqual(cols.length, 3, `Author row ${i} must have 3 columns`);
    }
  });

  it('AC8: author name with comma is RFC-4180 quoted', () => {
    const r: CompareResult = {
      ...makeCompareResult(),
      authorDeltas: [
        {
          author: 'Smith, Jane',
          baseCommits: 1, headCommits: 2, deltaCommits: 1,
          baseChurn: 5, headChurn: 10, deltaChurn: 5,
        },
      ],
    };
    const csv = renderCompareCsv(r);
    assert.match(csv, /"Smith, Jane"/);
  });
});

// ---------------------------------------------------------------------------
// AC7: renderSummaryCsv
// ---------------------------------------------------------------------------

describe('renderSummaryCsv', () => {
  it('AC7: output contains Author section header', () => {
    const csv = renderSummaryCsv(makeSummary());
    assert.match(csv, /Author,Commits,Lines Added,Lines Deleted/);
  });

  it('AC7: output contains Author churn section header', () => {
    const csv = renderSummaryCsv(makeSummary());
    assert.match(csv, /Author,Churn Score,Commits,Lines Added,Lines Deleted/);
  });

  it('AC7: output contains File churn section header when fileChurn populated', () => {
    const csv = renderSummaryCsv(makeSummary());
    assert.match(csv, /File,Churn Score,Commits,Lines Added,Lines Deleted/);
  });

  it('AC7: output contains Ownership section header when ownershipEntries populated', () => {
    const csv = renderSummaryCsv(makeSummary());
    assert.match(csv, /File,Owner,Ownership %,Commits/);
  });

  it('AC7: output contains Hotspots section header when hotspotEntries populated', () => {
    const csv = renderSummaryCsv(makeSummary());
    assert.match(csv, /File,Score,Commits,Authors/);
  });

  it('AC7: sections are separated by blank rows', () => {
    const csv = renderSummaryCsv(makeSummary());
    const ls = lines(csv);
    assert.ok(ls.includes(''), 'Expected blank separator rows between sections');
  });

  it('AC7: file-churn section is omitted when fileChurn is empty', () => {
    const s = makeSummary({ fileChurn: [] });
    const csv = renderSummaryCsv(s);
    assert.doesNotMatch(csv, /File,Churn Score,Commits,Lines Added,Lines Deleted/);
  });

  it('AC7: ownership section is omitted when ownershipEntries is empty', () => {
    const s = makeSummary({ ownershipEntries: [] });
    const csv = renderSummaryCsv(s);
    assert.doesNotMatch(csv, /File,Owner,Ownership %,Commits/);
  });

  it('AC7: hotspots section is omitted when hotspotEntries is empty', () => {
    const s = makeSummary({ hotspotEntries: [] });
    const csv = renderSummaryCsv(s);
    assert.doesNotMatch(csv, /File,Score,Commits,Authors/);
  });

  it('AC7: sections appear in order: authors, authorChurn, fileChurn, ownership, hotspots', () => {
    const csv = renderSummaryCsv(makeSummary());
    const authorIdx = csv.indexOf('Author,Commits,Lines Added,Lines Deleted');
    const churnAuthorIdx = csv.indexOf('Author,Churn Score,Commits,Lines Added,Lines Deleted');
    const fileChurnIdx = csv.indexOf('File,Churn Score,Commits,Lines Added,Lines Deleted');
    const ownershipIdx = csv.indexOf('File,Owner,Ownership %,Commits');
    const hotspotIdx = csv.indexOf('File,Score,Commits,Authors');

    assert.ok(authorIdx < churnAuthorIdx, 'authors section must come before churn-author section');
    assert.ok(churnAuthorIdx < fileChurnIdx, 'churn-author section must come before file-churn section');
    assert.ok(fileChurnIdx < ownershipIdx, 'file-churn section must come before ownership section');
    assert.ok(ownershipIdx < hotspotIdx, 'ownership section must come before hotspots section');
  });

  it('AC7: sentinel author data appears in output (AC9)', () => {
    const csv = renderSummaryCsv(makeSummary());
    assert.match(csv, /Ada Lovelace/);
    assert.match(csv, /Grace Hopper/);
  });
});
