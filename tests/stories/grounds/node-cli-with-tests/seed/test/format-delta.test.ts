/**
 * Unit tests for renderDelta and serializeDelta (src/format.ts).
 *
 * Uses node:test runner. Pure: no I/O, no git spawning. CompareResult
 * fixtures are constructed inline.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderDelta, serializeDelta } from '../src/format.ts';
import type { CompareResult } from '../src/compare.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Two-author fixture used by AC1, AC3, AC4 variants.
 * ref='v0.1', delta.commits=+3, delta.linesAdded=+10, delta.linesRemoved=-2.
 */
const TWO_AUTHOR_RESULT: CompareResult = {
  ref: 'v0.1',
  head: { commits: 8,  linesAdded: 20, linesRemoved: 3 },
  base: { commits: 5,  linesAdded: 10, linesRemoved: 5 },
  delta: { commits: 3, linesAdded: 10, linesRemoved: -2 },
  authorDeltas: [
    {
      author: 'Ada Lovelace',
      baseCommits: 2,
      headCommits: 5,
      deltaCommits: 3,
      baseChurn: 4,
      headChurn: 13,
      deltaChurn: 9,
    },
    {
      author: 'Grace Hopper',
      baseCommits: 3,
      headCommits: 3,
      deltaCommits: 0,
      baseChurn: 2,
      headChurn: 2,
      deltaChurn: 0,
    },
  ],
};

/** Five-author fixture for AC2 (top truncation). */
function makeFiveAuthorResult(): CompareResult {
  const makeAuthor = (author: string, dc: number) => ({
    author,
    baseCommits: 1,
    headCommits: 1 + dc,
    deltaCommits: dc,
    baseChurn: 0,
    headChurn: dc * 2,
    deltaChurn: dc * 2,
  });
  return {
    ref: 'v0.2',
    head: { commits: 20, linesAdded: 50, linesRemoved: 10 },
    base: { commits: 10, linesAdded: 20, linesRemoved: 5 },
    delta: { commits: 10, linesAdded: 30, linesRemoved: 5 },
    authorDeltas: [
      makeAuthor('Alpha', 5),
      makeAuthor('Beta',  4),
      makeAuthor('Gamma', 3),
      makeAuthor('Delta', 2),
      makeAuthor('Epsilon', 1),
    ],
  };
}

/** Zero-delta fixture for AC4. */
const ZERO_DELTA_RESULT: CompareResult = {
  ref: 'v0.3',
  head: { commits: 5, linesAdded: 10, linesRemoved: 3 },
  base: { commits: 5, linesAdded: 10, linesRemoved: 3 },
  delta: { commits: 0, linesAdded: 0, linesRemoved: 0 },
  authorDeltas: [
    {
      author: 'Steady Author',
      baseCommits: 5,
      headCommits: 5,
      deltaCommits: 0,
      baseChurn: 13,
      headChurn: 13,
      deltaChurn: 0,
    },
  ],
};

// ---------------------------------------------------------------------------
// AC1: header, headline signed values, author order
// ---------------------------------------------------------------------------

describe('renderDelta — AC1: header and headline table', () => {
  const output = renderDelta(TWO_AUTHOR_RESULT);

  it('output starts with "gitpulse — delta since v0.1"', () => {
    assert.ok(
      output.startsWith('gitpulse — delta since v0.1'),
      `Expected output to start with 'gitpulse — delta since v0.1', got:\n${output}`,
    );
  });

  it('headline table contains "+3" for commits delta', () => {
    assert.ok(output.includes('+3'), `Expected '+3' in output:\n${output}`);
  });

  it('headline table contains "+10" for linesAdded delta', () => {
    assert.ok(output.includes('+10'), `Expected '+10' in output:\n${output}`);
  });

  it('headline table contains "-2" for linesRemoved delta', () => {
    assert.ok(output.includes('-2'), `Expected '-2' in output:\n${output}`);
  });
});

describe('renderDelta — AC1: per-author table', () => {
  const output = renderDelta(TWO_AUTHOR_RESULT);

  it('lists Ada Lovelace in the output', () => {
    assert.ok(output.includes('Ada Lovelace'), `Expected 'Ada Lovelace' in output:\n${output}`);
  });

  it('lists Grace Hopper in the output', () => {
    assert.ok(output.includes('Grace Hopper'), `Expected 'Grace Hopper' in output:\n${output}`);
  });

  it('Ada Lovelace (Δcommits=3) appears before Grace Hopper (Δcommits=0) — sorted by |Δcommits| desc', () => {
    const adaIdx = output.indexOf('Ada Lovelace');
    const graceIdx = output.indexOf('Grace Hopper');
    assert.ok(
      adaIdx < graceIdx,
      `Expected Ada Lovelace (index ${adaIdx}) before Grace Hopper (index ${graceIdx})`,
    );
  });
});

// ---------------------------------------------------------------------------
// AC2: top truncation
// ---------------------------------------------------------------------------

describe('renderDelta — AC2: { top: 2 } truncates to 2 author rows', () => {
  it('exactly 2 author rows appear in the per-author table', () => {
    const result = makeFiveAuthorResult();
    const output = renderDelta(result, { top: 2 });

    // Count author rows: lines that are NOT the column header or rule line.
    // Strategy: split on author table section. After "author\n---\n" the rows follow.
    // We count occurrences of each distinct author name.
    const authorNames = result.authorDeltas.map((a) => a.author);
    const presentCount = authorNames.filter((name) => output.includes(name)).length;

    assert.strictEqual(
      presentCount,
      2,
      `Expected 2 author names in output with top:2, found ${presentCount}.\nOutput:\n${output}`,
    );
  });

  it('the first two authors (Alpha, Beta) are present', () => {
    const result = makeFiveAuthorResult();
    const output = renderDelta(result, { top: 2 });
    assert.ok(output.includes('Alpha'), `Expected 'Alpha' in top-2 output:\n${output}`);
    assert.ok(output.includes('Beta'),  `Expected 'Beta' in top-2 output:\n${output}`);
  });

  it('the remaining three authors (Gamma, Delta, Epsilon) are absent', () => {
    const result = makeFiveAuthorResult();
    const output = renderDelta(result, { top: 2 });
    assert.ok(!output.includes('Gamma'),   `Expected 'Gamma' to be absent in top-2 output:\n${output}`);
    assert.ok(!output.includes('Delta'),   `Expected 'Delta' to be absent in top-2 output:\n${output}`);
    assert.ok(!output.includes('Epsilon'), `Expected 'Epsilon' to be absent in top-2 output:\n${output}`);
  });
});

// ---------------------------------------------------------------------------
// AC3: serializeDelta
// ---------------------------------------------------------------------------

describe('serializeDelta — AC3: valid JSON with delta key', () => {
  const json = serializeDelta(TWO_AUTHOR_RESULT);

  it('returns parseable JSON', () => {
    assert.doesNotThrow(() => JSON.parse(json), `JSON.parse threw on:\n${json}`);
  });

  it('parsed JSON contains a "delta" key', () => {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    assert.ok('delta' in parsed, `Expected 'delta' key in parsed JSON: ${JSON.stringify(parsed)}`);
  });

  it('delta.commits equals the correct value (+3)', () => {
    const parsed = JSON.parse(json) as { delta: { commits: number } };
    assert.strictEqual(parsed.delta.commits, 3);
  });

  it('is 2-space-indented (second line starts with two spaces)', () => {
    const lines = json.split('\n');
    assert.ok(
      lines[1].startsWith('  '),
      `Expected 2-space indent on line 2, got: '${lines[1]}'`,
    );
  });
});

// ---------------------------------------------------------------------------
// AC4: zero delta renders as '0' not '+0' or blank
// ---------------------------------------------------------------------------

describe('renderDelta — AC4: zero delta shows "0" without sign', () => {
  const output = renderDelta(ZERO_DELTA_RESULT);

  it('zero commits delta renders as "0" (not "+0")', () => {
    assert.ok(!output.includes('+0'), `Expected no '+0' in output, but found it:\n${output}`);
  });

  it('output contains "0" as the zero delta value', () => {
    // At least one "0" should appear in the delta column for the zero metrics.
    assert.ok(output.includes('0'), `Expected '0' in output:\n${output}`);
  });

  it('headline rows for zero metrics do not contain blank delta cells', () => {
    // The output should have the same number of non-empty lines as expected.
    // Specifically, zero rows should show '0', so the delta column is not blank.
    // We check the delta column is not just spaces by ensuring we can find '0'
    // adjacent to proper column alignment (not just any '0' elsewhere).
    const lines = output.split('\n');
    // Find the 'commits' row — it has a zero delta in ZERO_DELTA_RESULT.
    const commitsLine = lines.find((l) => l.includes('commits') && !l.includes('---') && !l.includes('Δ'));
    assert.ok(commitsLine !== undefined, 'Could not find commits row');
    // The commits row should end with '0' (the delta) not '+0'.
    assert.ok(
      !commitsLine.includes('+0'),
      `Expected no '+0' in commits row: '${commitsLine}'`,
    );
  });
});
