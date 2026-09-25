/**
 * Author-churn test suite — quality gate for WI-2.
 *
 * Covers AC1–AC4:
 *   AC1: summarize() populates authorChurn with correct insertions/deletions per author.
 *   AC2: renderSummary() includes a churn column (lines added / lines removed) per author.
 *   AC3: empty Commit[] → authorChurn is [], renderSummary does not crash.
 *   AC4: authorChurn is ordered by total churn descending, ties broken by author name asc.
 *
 * Pure: no git spawning. All fixtures are hand-built Commit objects.
 * Run: node --import tsx --test test/author-churn.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Commit } from '../src/git.ts';
import { summarize } from '../src/stats.ts';
import { renderSummary } from '../src/format.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Minimal Commit builder. Defaults hash/filesChanged/files to sentinels;
 * requires author, date, insertions, deletions.
 */
const commit = (
  author: string,
  date: string,
  insertions: number,
  deletions: number,
): Commit => ({
  hash: 'aabbccdd',
  author,
  date,
  parentCount: 1,
  authorEmail: '',
  filesChanged: 1,
  insertions,
  deletions,
  files: [],
});

// AC1 fixture: Alice 10+5, Bob 3+1 (two authors, no ties).
const AC1_COMMITS: readonly Commit[] = [
  commit('Alice', '2024-01-01', 10, 5),
  commit('Bob', '2024-01-02', 3, 1),
];

// AC4 fixture: Carol 20+0=20, Dave 15+5=20 (equal total churn → name tie-break).
const AC4_COMMITS: readonly Commit[] = [
  commit('Dave', '2024-02-01', 15, 5),
  commit('Carol', '2024-02-02', 20, 0),
];

// ---------------------------------------------------------------------------
// AC1 — summarize populates authorChurn with correct per-author values
// ---------------------------------------------------------------------------

test('AC1: authorChurn entry for Alice has insertions=10 deletions=5', () => {
  const s = summarize(AC1_COMMITS);
  const alice = s.authorChurn.find((e) => e.author === 'Alice');
  assert.ok(alice, 'Alice must appear in authorChurn');
  assert.equal(alice.insertions, 10, 'Alice insertions');
  assert.equal(alice.deletions, 5, 'Alice deletions');
});

test('AC1: authorChurn entry for Bob has insertions=3 deletions=1', () => {
  const s = summarize(AC1_COMMITS);
  const bob = s.authorChurn.find((e) => e.author === 'Bob');
  assert.ok(bob, 'Bob must appear in authorChurn');
  assert.equal(bob.insertions, 3, 'Bob insertions');
  assert.equal(bob.deletions, 1, 'Bob deletions');
});

test('AC1: authorChurn has exactly 2 entries for a 2-author fixture', () => {
  const s = summarize(AC1_COMMITS);
  assert.equal(s.authorChurn.length, 2);
});

test('AC1: authorChurn accumulates insertions across multiple commits by the same author', () => {
  const multiCommit: readonly Commit[] = [
    commit('Alice', '2024-01-01', 4, 2),
    commit('Alice', '2024-01-02', 6, 3),
  ];
  const s = summarize(multiCommit);
  assert.equal(s.authorChurn.length, 1);
  const alice = s.authorChurn[0];
  assert.equal(alice.author, 'Alice');
  assert.equal(alice.insertions, 10, 'accumulated insertions');
  assert.equal(alice.deletions, 5, 'accumulated deletions');
});

// ---------------------------------------------------------------------------
// AC2 — renderSummary includes a churn column for each author
// ---------------------------------------------------------------------------

test('AC2: rendered output includes "churn (lines)" header', () => {
  const out = renderSummary(summarize(AC1_COMMITS));
  assert.match(out, /churn \(lines\)/i);
});

test('AC2: rendered output includes Alice churn value +10/-5', () => {
  const out = renderSummary(summarize(AC1_COMMITS));
  assert.match(out, /\+10\/-5/);
});

test('AC2: rendered output includes Bob churn value +3/-1', () => {
  const out = renderSummary(summarize(AC1_COMMITS));
  assert.match(out, /\+3\/-1/);
});

test('AC2: rendered output includes both author names in the churn section', () => {
  const out = renderSummary(summarize(AC1_COMMITS));
  // The churn section must mention Alice and Bob (the commit table also does,
  // so we just assert both appear — the important thing is the churn values
  // sit on the same line as an author name).
  const lines = out.split('\n');
  const aliceLine = lines.find((l) => l.includes('+10/-5'));
  const bobLine = lines.find((l) => l.includes('+3/-1'));
  assert.ok(aliceLine?.includes('Alice'), 'Alice appears on +10/-5 line');
  assert.ok(bobLine?.includes('Bob'), 'Bob appears on +3/-1 line');
});

test('AC2: churn section comes after commit-count table (lines 4-6 are still commit rows)', () => {
  const out = renderSummary(summarize(AC1_COMMITS));
  const lines = out.split('\n');
  // Header(0), blank(1), col-header(2), rule(3), rows start at 4.
  // Alice has total churn 15, Bob 4, so Alice is first in churn; but byAuthor
  // order (commit count) is Alice 1, Bob 1 → both have 1 commit → alpha: Alice, Bob.
  assert.match(lines[0], /gitpulse/);
  assert.match(lines[2], /commits/);   // commit-count column header
  assert.match(lines[3], /^-+/);       // rule row
  assert.match(lines[4], /Alice$/);    // first author row in commit table
});

// ---------------------------------------------------------------------------
// AC3 — empty input → no churn rows, no crash
// ---------------------------------------------------------------------------

test('AC3: summarize([]) returns authorChurn = []', () => {
  const s = summarize([]);
  assert.deepEqual(s.authorChurn, []);
});

test('AC3: renderSummary on empty summary does not throw', () => {
  assert.doesNotThrow(() => renderSummary(summarize([])));
});

test('AC3: renderSummary on empty summary contains "No commits found."', () => {
  const out = renderSummary(summarize([]));
  assert.match(out, /No commits found\./);
});

test('AC3: renderSummary on empty summary does not include "churn"', () => {
  const out = renderSummary(summarize([]));
  assert.doesNotMatch(out, /churn/i);
});

// ---------------------------------------------------------------------------
// AC4 — ordering: descending total churn, ties by author name ascending
// ---------------------------------------------------------------------------

test('AC4: Carol and Dave have equal total churn (20); Carol sorts before Dave', () => {
  const s = summarize(AC4_COMMITS);
  assert.equal(s.authorChurn.length, 2);
  assert.equal(s.authorChurn[0].author, 'Carol', 'Carol (C) before Dave (D) — name asc tie-break');
  assert.equal(s.authorChurn[1].author, 'Dave');
});

test('AC4: when no tie, higher total churn comes first', () => {
  // Alice 15 total, Bob 4 total — Alice must be first.
  const s = summarize(AC1_COMMITS);
  assert.equal(s.authorChurn[0].author, 'Alice', 'Alice (15 total) before Bob (4 total)');
  assert.equal(s.authorChurn[1].author, 'Bob');
});

test('AC4: authorChurn ordering is independent of byAuthor ordering', () => {
  // byAuthor sorts by commit count; authorChurn sorts by line churn.
  // Use a fixture where the orderings differ.
  const commits: readonly Commit[] = [
    commit('Zara', '2024-03-01', 100, 50), // 1 commit, 150 lines total
    commit('Aaron', '2024-03-01', 0, 0),   // 1 commit,   0 lines total
    commit('Aaron', '2024-03-02', 0, 0),   // 2nd commit for Aaron
  ];
  const s = summarize(commits);
  // byAuthor: Aaron (2 commits) first, Zara (1 commit) second.
  assert.equal(s.byAuthor[0].author, 'Aaron', 'byAuthor: Aaron first (more commits)');
  assert.equal(s.byAuthor[1].author, 'Zara');
  // authorChurn: Zara (150 lines) first, Aaron (0 lines) second.
  assert.equal(s.authorChurn[0].author, 'Zara', 'authorChurn: Zara first (more lines)');
  assert.equal(s.authorChurn[1].author, 'Aaron');
});

// ---------------------------------------------------------------------------
// Cross-check — byAuthor is unchanged (backwards compatibility)
// ---------------------------------------------------------------------------

test('cross-check: byAuthor still populated correctly alongside authorChurn', () => {
  const s = summarize(AC1_COMMITS);
  // Both Alice and Bob have 1 commit each — alpha order: Alice, Bob.
  assert.equal(s.byAuthor.length, 2);
  assert.equal(s.byAuthor[0].author, 'Alice');
  assert.equal(s.byAuthor[0].commits, 1);
  assert.equal(s.byAuthor[1].author, 'Bob');
  assert.equal(s.byAuthor[1].commits, 1);
});

test('cross-check: authorChurn.commits field matches byAuthor commits', () => {
  const commits: readonly Commit[] = [
    commit('Alice', '2024-01-01', 5, 2),
    commit('Alice', '2024-01-02', 3, 1),
    commit('Bob', '2024-01-03', 1, 0),
  ];
  const s = summarize(commits);
  const alice = s.authorChurn.find((e) => e.author === 'Alice');
  const byAlice = s.byAuthor.find((e) => e.author === 'Alice');
  assert.equal(alice?.commits, byAlice?.commits, 'commit count consistent between authorChurn and byAuthor');
});
