/**
 * Unit tests for applyInclusions — include-path filter logic.
 *
 * Quality gate for WI-1 (INIT-2026-09-04-include-path-filter-flag).
 * Covers AC1–AC5.
 *
 * Run:
 *   node --test --experimental-strip-types test/include-filter.test.ts
 *
 * No real git is spawned — applyInclusions is a pure function tested
 * against in-memory fixtures.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Commit } from '../src/git.ts';
import { applyInclusions } from '../src/cli.ts';
import { matchGlob } from '../src/glob.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Build a minimal Commit for use in tests. */
const makeCommit = (over: Partial<Commit> & { author: string; date: string }): Commit => ({
  hash: 'deadbeef',
  parentCount: 1,
  authorEmail: '',
  filesChanged: 1,
  insertions: 5,
  deletions: 1,
  files: [],
  ...over,
});

/**
 * Mixed commits: some files under src/, some under test/, and one with only a
 * test/ file (to verify commit-drop behaviour).
 */
function mixedCommits(): Commit[] {
  return [
    makeCommit({
      author: 'Alice',
      date: '2024-01-01',
      files: [
        { path: 'src/cli.ts', insertions: 10, deletions: 2 },
        { path: 'test/cli.test.ts', insertions: 5, deletions: 1 },
      ],
    }),
    makeCommit({
      author: 'Bob',
      date: '2024-01-02',
      files: [
        { path: 'src/glob.ts', insertions: 8, deletions: 0 },
        { path: 'test/glob.test.ts', insertions: 3, deletions: 0 },
      ],
    }),
    makeCommit({
      author: 'Carol',
      date: '2024-01-03',
      // Commit entirely outside src/ — should be dropped by src/** filter.
      files: [
        { path: 'test/only.test.ts', insertions: 7, deletions: 1 },
      ],
    }),
  ];
}

// ---------------------------------------------------------------------------
// AC2: empty patterns list → no-op (byte-identical to input)
// ---------------------------------------------------------------------------

test('AC2: applyInclusions(commits, []) returns the exact same array reference', () => {
  const commits = mixedCommits();
  const result = applyInclusions(commits, []);
  // Fast-path: same reference, not a copy.
  assert.strictEqual(result, commits, 'expected the exact same array reference on empty patterns');
});

test('AC2: applyInclusions(commits, []) does not mutate or drop any commits', () => {
  const commits = mixedCommits();
  const result = applyInclusions(commits, []);
  assert.equal(result.length, commits.length, 'all commits must be retained');
});

// ---------------------------------------------------------------------------
// AC3: pattern '**' → byte-identical to input (matches everything)
// ---------------------------------------------------------------------------

test('AC3: applyInclusions(commits, ["**"]) retains all commits', () => {
  const commits = mixedCommits();
  const result = applyInclusions(commits, ['**']);
  assert.equal(result.length, commits.length, 'all commits must be retained with ** pattern');
});

test('AC3: applyInclusions(commits, ["**"]) retains all files in each commit', () => {
  const commits = mixedCommits();
  const result = applyInclusions(commits, ['**']);
  for (let i = 0; i < commits.length; i++) {
    assert.equal(
      result[i].files.length,
      commits[i].files.length,
      `commit ${i}: all files must be retained`,
    );
  }
});

// ---------------------------------------------------------------------------
// AC1: pattern 'src/**' retains only src/ files; drops all-excluded commits
// ---------------------------------------------------------------------------

test('AC1: applyInclusions(commits, ["src/**"]) keeps only src/ files in retained commits', () => {
  const result = applyInclusions(mixedCommits(), ['src/**']);
  for (const commit of result) {
    for (const file of commit.files) {
      assert.ok(
        file.path.startsWith('src/'),
        `unexpected non-src file retained: ${file.path}`,
      );
    }
  }
});

test('AC1: applyInclusions(commits, ["src/**"]) drops commits with no src/ files', () => {
  const commits = mixedCommits();
  const result = applyInclusions(commits, ['src/**']);
  // Carol's commit (only test/only.test.ts) must be gone.
  const carolCommit = result.find((c) => c.author === 'Carol');
  assert.equal(carolCommit, undefined, 'commit with only non-src file must be dropped');
});

test('AC1: applyInclusions(commits, ["src/**"]) retains commits that have at least one src/ file', () => {
  const result = applyInclusions(mixedCommits(), ['src/**']);
  // Alice and Bob each had an src/ file — they must appear.
  assert.equal(result.length, 2, `expected 2 commits, got ${result.length}`);
  const authors = result.map((c) => c.author).sort();
  assert.deepEqual(authors, ['Alice', 'Bob']);
});

test('AC1: applyInclusions(commits, ["src/**"]) strips test/ files from retained commits', () => {
  const result = applyInclusions(mixedCommits(), ['src/**']);
  for (const commit of result) {
    const testFiles = commit.files.filter((f) => f.path.startsWith('test/'));
    assert.equal(
      testFiles.length,
      0,
      `commit by ${commit.author} should have no test/ files; found: ${testFiles.map((f) => f.path).join(', ')}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Multiple patterns → OR semantics
// ---------------------------------------------------------------------------

test('applyInclusions with ["src/**", "lib/**"] retains files in either directory', () => {
  const commits = [
    makeCommit({
      author: 'Alice',
      date: '2024-01-01',
      files: [
        { path: 'src/cli.ts', insertions: 5, deletions: 0 },
        { path: 'lib/util.ts', insertions: 3, deletions: 0 },
        { path: 'test/x.test.ts', insertions: 2, deletions: 0 },
      ],
    }),
  ];
  const result = applyInclusions(commits, ['src/**', 'lib/**']);
  assert.equal(result.length, 1, 'commit must be retained');
  const paths = result[0].files.map((f) => f.path);
  assert.ok(paths.includes('src/cli.ts'), 'src/cli.ts must be retained');
  assert.ok(paths.includes('lib/util.ts'), 'lib/util.ts must be retained');
  assert.ok(!paths.includes('test/x.test.ts'), 'test/x.test.ts must be dropped');
});

// ---------------------------------------------------------------------------
// AC4: empty-string pattern matches nothing
// ---------------------------------------------------------------------------

test('AC4: applyInclusions(commits, [""]) drops all commits (empty string matches nothing)', () => {
  const commits = mixedCommits();
  const result = applyInclusions(commits, ['']);
  assert.equal(result.length, 0, `expected 0 commits with empty-string pattern, got ${result.length}`);
});

test('AC4: applyInclusions([commitWithOneFile], [""]) drops the commit entirely', () => {
  const commits = [
    makeCommit({
      author: 'Alice',
      date: '2024-01-01',
      files: [{ path: 'src/foo.ts', insertions: 1, deletions: 0 }],
    }),
  ];
  const result = applyInclusions(commits, ['']);
  assert.equal(result.length, 0, 'commit whose only file is unmatched must be dropped');
});

// ---------------------------------------------------------------------------
// AC5: matchGlob('package-lock.json', 'package-lock.json') pinned regression
// ---------------------------------------------------------------------------

test('AC5: matchGlob("package-lock.json", "package-lock.json") — pinned hyphen-normalisation regression', () => {
  // The matchSegment function normalises hyphens in the path segment to dots
  // only when the pattern contains a wildcard (`*`). For a plain literal
  // pattern with no `*`, it falls through to an exact-string comparison
  // (`pattern === segment`), so 'package-lock.json' equals 'package-lock.json'.
  // This test pins that behaviour so future changes to matchSegment are caught.
  const result = matchGlob('package-lock.json', 'package-lock.json');
  assert.equal(result, true, 'matchGlob("package-lock.json", "package-lock.json") must be true');
});
