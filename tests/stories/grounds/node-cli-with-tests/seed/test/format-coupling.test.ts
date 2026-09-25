/**
 * Tests for coupling renderers in src/format.ts
 *
 * Covers:
 *   AC1 — renderCoupling with non-empty rows: plain-text table, sorted, footer
 *   AC2 — couplingToJson: valid JSON, float couplingPct, excluded field
 *   AC3 — couplingToCSV: header row, comma-containing path quoted, CSV format
 *   AC4 — renderCoupling with empty rows: returns sentinel string
 *
 * All tests use node:test and node:assert (no external dependencies).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderCoupling, couplingToJson, couplingToCSV } from '../src/format.ts';
import type { CouplingRow } from '../src/coupling.ts';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const ROW_ENGINE_ROUTER: CouplingRow = {
  fileA: 'engine.ts',
  fileB: 'router.ts',
  coChanges: 5,
  couplingPct: 83.3,
};

const ROW_DB_CACHE: CouplingRow = {
  fileA: 'db.ts',
  fileB: 'cache.ts',
  coChanges: 2,
  couplingPct: 40.0,
};

const SAMPLE_ROWS: CouplingRow[] = [ROW_ENGINE_ROUTER, ROW_DB_CACHE];

// ---------------------------------------------------------------------------
// AC1 — renderCoupling with non-empty rows
// ---------------------------------------------------------------------------

describe('renderCoupling', () => {
  it('AC1: returns a plain-text table with header, separator, data rows, and footer', () => {
    const output = renderCoupling(SAMPLE_ROWS, {});
    const lines = output.split('\n');

    // Header row is line 0
    assert.ok(lines[0].includes('fileA'),       'header should contain fileA');
    assert.ok(lines[0].includes('fileB'),       'header should contain fileB');
    assert.ok(lines[0].includes('co-changes'),  'header should contain co-changes');
    assert.ok(lines[0].includes('coupling%'),   'header should contain coupling%');

    // Separator line (line 1) has only dashes and spaces
    assert.match(lines[1], /^[-\s]+$/, 'separator should be dashes');

    // Data rows include the % sign for couplingPct
    const dataSection = lines.slice(2).join('\n');
    assert.ok(dataSection.includes('%'), 'data rows should contain % for couplingPct');
    assert.ok(dataSection.includes('engine.ts'), 'first row should include engine.ts');
    assert.ok(dataSection.includes('router.ts'),  'first row should include router.ts');

    // Footer includes pair count
    assert.ok(output.includes('2 coupled pairs'), 'footer should show 2 coupled pairs');
  });

  it('AC1: sorts rows strongest-first (preserves already-sorted order)', () => {
    // engine/router has coChanges=5 (strongest), db/cache has coChanges=2
    const output = renderCoupling(SAMPLE_ROWS, {});
    const idxEngine = output.indexOf('engine.ts');
    const idxDb     = output.indexOf('db.ts');
    assert.ok(idxEngine < idxDb, 'engine.ts (stronger) should appear before db.ts');
  });

  it('AC1: couplingPct column accommodates 100.0%', () => {
    // Create a row with exactly 100% coupling
    const rows: CouplingRow[] = [
      { fileA: 'a.ts', fileB: 'b.ts', coChanges: 10, couplingPct: 100.0 },
    ];
    const output = renderCoupling(rows, {});
    // Should render without error and include 100.0%
    assert.ok(output.includes('100.0%'), 'should render 100.0%');
  });

  it('AC1: footer shows exclusion count when excludedCount > 0', () => {
    const output = renderCoupling(SAMPLE_ROWS, { excludedCount: 3 });
    assert.ok(output.includes('(3 paths excluded)'), 'footer should include exclusion count');
  });

  it('top: 1 — only the top row appears', () => {
    const output = renderCoupling(SAMPLE_ROWS, { top: 1 });
    assert.ok(output.includes('engine.ts'),  'top row (engine.ts) should be present');
    assert.ok(!output.includes('db.ts'),     'second row (db.ts) should be absent');
    assert.ok(output.includes('1 coupled pairs'), 'footer should show 1 coupled pair');
  });

  // AC4 — empty rows
  it('AC4: returns sentinel string for empty rows', () => {
    const output = renderCoupling([], {});
    assert.equal(output, 'no coupled file pairs found');
  });

  it('AC4: returns sentinel string when top: 0 produces empty slice', () => {
    const output = renderCoupling(SAMPLE_ROWS, { top: 0 });
    assert.equal(output, 'no coupled file pairs found');
  });
});

// ---------------------------------------------------------------------------
// AC2 — couplingToJson
// ---------------------------------------------------------------------------

describe('couplingToJson', () => {
  it('AC2: produces valid JSON with correct schema', () => {
    const jsonStr = couplingToJson(SAMPLE_ROWS, 0);
    // Must parse without throwing
    const parsed = JSON.parse(jsonStr) as { rows: CouplingRow[]; excluded: number };

    assert.equal(typeof parsed, 'object', 'top level should be object');
    assert.ok(Array.isArray(parsed.rows),    'should have rows array');
    assert.equal(parsed.excluded, 0,         'excluded should be 0');
  });

  it('AC2: couplingPct is a float (number), not a string', () => {
    const jsonStr = couplingToJson(SAMPLE_ROWS, 2);
    const parsed = JSON.parse(jsonStr) as { rows: CouplingRow[]; excluded: number };

    for (const row of parsed.rows) {
      assert.equal(typeof row.couplingPct, 'number',
        `couplingPct should be a number, got ${typeof row.couplingPct}`);
    }
    assert.equal(parsed.excluded, 2, 'excluded should match excludedCount argument');
  });

  it('AC2: rows carry all required fields', () => {
    const jsonStr = couplingToJson([ROW_ENGINE_ROUTER], 0);
    const parsed = JSON.parse(jsonStr) as { rows: CouplingRow[]; excluded: number };

    const row = parsed.rows[0];
    assert.ok('fileA'       in row, 'row should have fileA');
    assert.ok('fileB'       in row, 'row should have fileB');
    assert.ok('coChanges'   in row, 'row should have coChanges');
    assert.ok('couplingPct' in row, 'row should have couplingPct');
    assert.equal(row.fileA, 'engine.ts');
    assert.equal(row.fileB, 'router.ts');
    assert.equal(row.coChanges, 5);
    assert.equal(row.couplingPct, 83.3);
  });
});

// ---------------------------------------------------------------------------
// AC3 — couplingToCSV
// ---------------------------------------------------------------------------

describe('couplingToCSV', () => {
  it('AC3: starts with header row fileA,fileB,coChanges,couplingPct', () => {
    const csvStr = couplingToCSV(SAMPLE_ROWS);
    const firstLine = csvStr.split('\n')[0];
    assert.equal(firstLine, 'fileA,fileB,coChanges,couplingPct');
  });

  it('AC3: comma-containing path is quoted per CSV rules', () => {
    const commaRow: CouplingRow = {
      fileA: 'src/foo,bar.ts',
      fileB: 'src/baz.ts',
      coChanges: 3,
      couplingPct: 75.0,
    };
    const csvStr = couplingToCSV([commaRow]);
    const lines = csvStr.split('\n');
    // Line 1 (after header) should have the comma-path quoted
    assert.ok(lines[1].startsWith('"src/foo,bar.ts"'),
      `fileA with comma should be quoted; got: ${lines[1]}`);
  });

  it('AC3: standard rows follow standard CSV format (no extra quotes)', () => {
    const csvStr = couplingToCSV(SAMPLE_ROWS);
    const lines = csvStr.split('\n');
    // Row count = 1 header + SAMPLE_ROWS.length data rows
    assert.equal(lines.length, 1 + SAMPLE_ROWS.length, 'line count should match');
    // engine.ts row: no quotes needed
    assert.ok(lines[1].startsWith('engine.ts'), 'plain path should not be quoted');
  });

  it('AC3: couplingPct in CSV is numeric (no % sign)', () => {
    const csvStr = couplingToCSV([ROW_ENGINE_ROUTER]);
    const dataLine = csvStr.split('\n')[1];
    // Should not contain % sign
    assert.ok(!dataLine.includes('%'), 'CSV couplingPct should not contain %');
    // Should end with the numeric value
    assert.ok(dataLine.endsWith('83.3'), 'couplingPct should be 83.3 with one decimal');
  });

  it('AC3: empty rows produces only header', () => {
    const csvStr = couplingToCSV([]);
    assert.equal(csvStr, 'fileA,fileB,coChanges,couplingPct');
  });
});
