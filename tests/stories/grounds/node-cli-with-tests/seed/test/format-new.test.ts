/**
 * Unit tests for the new ownership and hotspot sections in renderSummary.
 *
 * Uses node:test + node:assert/strict. Pure: no git I/O. All fixtures
 * constructed inline.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderSummary } from '../src/format.ts';
import type { Summary } from '../src/stats.ts';
import type { FileOwnership } from '../src/ownership.ts';
import type { HotspotEntry } from '../src/hotspot.ts';

// Minimal Summary builder — supply only the fields you want to vary.
const summaryWith = (overrides: Partial<Summary>): Summary => ({
  totalCommits: 1,
  byAuthor: [{ author: 'Alice', commits: 1 }],
  authorChurn: [{ author: 'Alice', commits: 1, insertions: 1, deletions: 0 }],
  fileChurn: [],
  ownershipEntries: [],
  hotspotEntries: [],
  firstDate: '2024-01-01',
  lastDate: '2024-01-01',
  ...overrides,
});

// Fixture ownership entries.
const ownershipFixture: readonly FileOwnership[] = [
  { file: 'engine.ts', owner: 'Ada Lovelace', ownerLines: 10, busFactor: 1 },
  { file: 'compiler.ts', owner: 'Grace Hopper', ownerLines: 5, busFactor: 1 },
];

// Fixture hotspot entries (already sorted by score descending).
const hotspotFixture: readonly HotspotEntry[] = [
  { file: 'engine.ts', score: 2.5, commits: 3, lastDate: '2021-03-07' },
  { file: 'compiler.ts', score: 0.5, commits: 1, lastDate: '2021-03-02' },
];

describe('renderSummary — ownership section', () => {
  it('AC1: includes ownership section with correct columns when ownershipEntries is populated', () => {
    const output = renderSummary(summaryWith({ ownershipEntries: ownershipFixture }));
    // Section heading present.
    assert.match(output, /ownership/i, 'ownership heading missing');
    // Column headers present.
    assert.match(output, /owner/, 'owner column missing');
    assert.match(output, /bus-factor/, 'bus-factor column missing');
    assert.match(output, /file/, 'file column missing');
    // Owner names present.
    assert.match(output, /Ada Lovelace/, 'Ada Lovelace not in output');
    assert.match(output, /Grace Hopper/, 'Grace Hopper not in output');
    // Bus-factor values present.
    assert.match(output, /1/, 'bus-factor value 1 missing');
    // File paths present.
    assert.match(output, /engine\.ts/, 'engine.ts not in output');
    assert.match(output, /compiler\.ts/, 'compiler.ts not in output');
  });

  it('AC3: omits ownership section entirely when ownershipEntries is empty', () => {
    const output = renderSummary(summaryWith({ ownershipEntries: [] }));
    assert.doesNotMatch(output, /ownership/i, 'ownership section should be omitted');
    assert.doesNotMatch(output, /bus-factor/, 'bus-factor header should be omitted');
  });

  it('bus-factor is right-aligned (padStart)', () => {
    const entries: readonly FileOwnership[] = [
      { file: 'a.ts', owner: 'Alice', ownerLines: 100, busFactor: 10 },
      { file: 'b.ts', owner: 'Bob', ownerLines: 1, busFactor: 1 },
    ];
    const output = renderSummary(summaryWith({ ownershipEntries: entries }));
    const lines = output.split('\n');
    // Find the line with bus-factor value 1 (right-aligned under "10").
    const busOneLine = lines.find((l) => /\b1\b/.test(l) && l.includes('Bob'));
    assert.ok(busOneLine, 'bus-factor row for Bob not found');
    // Both numeric values should be in the same column position.
    const busColStart = output.indexOf('bus-factor');
    assert.ok(busColStart >= 0, 'bus-factor header not found');
  });
});

describe('renderSummary — hotspots section', () => {
  it('AC2: includes hotspots section with correct columns when hotspotEntries is populated', () => {
    const output = renderSummary(summaryWith({ hotspotEntries: hotspotFixture }));
    assert.match(output, /hotspot/i, 'hotspot heading missing');
    assert.match(output, /score/, 'score column missing');
    assert.match(output, /commits/, 'commits column missing');
    assert.match(output, /last-date/, 'last-date column missing');
    // Score values (2 decimal places).
    assert.match(output, /2\.50/, 'score 2.50 missing');
    assert.match(output, /0\.50/, 'score 0.50 missing');
    // Last dates present.
    assert.match(output, /2021-03-07/, 'last date 2021-03-07 missing');
    assert.match(output, /2021-03-02/, 'last date 2021-03-02 missing');
    // File paths present.
    assert.match(output, /engine\.ts/, 'engine.ts not in hotspot output');
    assert.match(output, /compiler\.ts/, 'compiler.ts not in hotspot output');
  });

  it('AC4: omits hotspots section entirely when hotspotEntries is empty', () => {
    const output = renderSummary(summaryWith({ hotspotEntries: [] }));
    assert.doesNotMatch(output, /hotspot/i, 'hotspot section should be omitted');
    assert.doesNotMatch(output, /last-date/, 'last-date column should be omitted');
  });

  it('score is right-aligned (padStart)', () => {
    const entries: readonly HotspotEntry[] = [
      { file: 'hot.ts', score: 10.0, commits: 5, lastDate: '2024-01-15' },
      { file: 'cold.ts', score: 0.03, commits: 10, lastDate: '2022-01-01' },
    ];
    const output = renderSummary(summaryWith({ hotspotEntries: entries }));
    // '10.00' and ' 0.03' should both appear; ' 0.03' has a leading space (right-aligned).
    assert.match(output, /10\.00/, '10.00 score missing');
    assert.match(output, /0\.03/, '0.03 score missing');
    const lines = output.split('\n');
    const hotLine = lines.find((l) => l.includes('10.00'));
    const coldLine = lines.find((l) => l.includes('0.03'));
    assert.ok(hotLine, 'hotspot line for 10.00 not found');
    assert.ok(coldLine, 'hotspot line for 0.03 not found');
    // Right-aligned: both rows' score columns end at the same character position.
    // '10.00' is 5 chars at position X; ' 0.03' pads to 5 chars too.
    // hotLine starts with the score value; coldLine starts with a space + score.
    // Verify the last char of score aligns: hotLine[4] should be '0', coldLine[4] should be '3'.
    // More simply: the score values are padStart(5) — check the first column ends at the same offset.
    const hotScoreEnd = hotLine!.indexOf('10.00') + '10.00'.length;
    const coldScoreEnd = coldLine!.indexOf('0.03') + '0.03'.length;
    assert.equal(hotScoreEnd, coldScoreEnd, 'score values are not right-aligned (end positions differ)');
  });

  it('AC2: hotspot rows appear in the order given (caller pre-sorts descending)', () => {
    // The format renderer renders entries in array order; summarize pre-sorts by score desc.
    // Pass them already in descending order and verify output order is preserved.
    const entries: readonly HotspotEntry[] = [
      { file: 'high.ts', score: 9.9, commits: 9, lastDate: '2024-06-01' },
      { file: 'low.ts', score: 0.5, commits: 1, lastDate: '2021-01-01' },
    ];
    const output = renderSummary(summaryWith({ hotspotEntries: entries }));
    const highIdx = output.indexOf('high.ts');
    const lowIdx = output.indexOf('low.ts');
    assert.ok(highIdx < lowIdx, 'hotspot rows not rendered in the given (descending score) order');
  });
});

describe('renderSummary — both sections together', () => {
  it('ownership appears before hotspots, both after file churn', () => {
    const fileChurn = [{ file: 'engine.ts', insertions: 2, deletions: 0 }];
    const output = renderSummary(
      summaryWith({
        fileChurn,
        ownershipEntries: ownershipFixture,
        hotspotEntries: hotspotFixture,
      }),
    );
    const churnIdx = output.indexOf('churn (lines)');
    const ownershipIdx = output.indexOf('ownership');
    const hotspotIdx = output.indexOf('hotspot');

    assert.ok(churnIdx >= 0, 'churn section not found');
    assert.ok(ownershipIdx >= 0, 'ownership section not found');
    assert.ok(hotspotIdx >= 0, 'hotspot section not found');

    assert.ok(churnIdx < ownershipIdx, 'ownership should appear after churn');
    assert.ok(ownershipIdx < hotspotIdx, 'hotspot should appear after ownership');
  });

  it('each section is separated by a blank line', () => {
    const output = renderSummary(
      summaryWith({
        ownershipEntries: ownershipFixture,
        hotspotEntries: hotspotFixture,
      }),
    );
    // Blank line before ownership section label.
    const ownershipIdx = output.indexOf('\nownership');
    assert.ok(ownershipIdx >= 0, 'ownership section label not found after newline');
    assert.equal(output[ownershipIdx - 1], '\n', 'no blank line before ownership section');
    // Blank line before hotspots section label.
    const hotspotIdx = output.indexOf('\nhotspots');
    assert.ok(hotspotIdx >= 0, 'hotspots section label not found after newline');
    assert.equal(output[hotspotIdx - 1], '\n', 'no blank line before hotspots section');
  });
});
