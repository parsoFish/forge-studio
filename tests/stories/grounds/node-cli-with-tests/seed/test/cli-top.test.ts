/**
 * Unit tests for --top flag parsing in runCli and top-cap in summarize.
 *
 * Quality gate for WI-3. Must fail before the --top flag exists and pass only
 * when the flag is correctly implemented.
 *
 * Uses node:test + node:assert/strict. Run:
 *   node --import tsx --test test/cli-top.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Commit } from '../src/git.ts';
import { summarize } from '../src/stats.ts';
import { runCli } from '../src/cli.ts';

// --- fixtures ---

/** Build a minimal Commit for use in tests. */
const commit = (over: Partial<Commit> & { author: string; date: string }): Commit => ({
  hash: 'deadbeef',
  parentCount: 1,
  authorEmail: '',
  filesChanged: 1,
  insertions: 1,
  deletions: 0,
  files: [],
  ...over,
});

/**
 * Fake io that returns commits without touching disk / git.
 * Throws if a non-'/repo' path is used (safety check).
 */
const fakeIo = (commits: readonly Commit[]) => ({
  readCommits: (_path: string): Commit[] => [...commits],
});

/** Builds a 5-author fixture (5 distinct authors, commit counts 5/4/3/2/1). */
function fiveAuthorCommits(): Commit[] {
  const out: Commit[] = [];
  const authors = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'];
  for (let i = 0; i < authors.length; i++) {
    for (let j = 0; j <= i; j++) {
      out.push(commit({ author: authors[i], date: '2023-01-01' }));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// CLI flag parsing — success paths
// ---------------------------------------------------------------------------

test('--top 3: exit 0 when flag is valid', () => {
  const result = runCli(['--top', '3', '/repo'], fakeIo([]));
  assert.equal(result.code, 0);
  assert.equal(result.stderr, '');
});

test('--top 2 --since 2021-01-01: exit 0 (combined flags)', () => {
  const result = runCli(['--top', '2', '--since', '2021-01-01', '/repo'], fakeIo([]));
  assert.equal(result.code, 0);
  assert.equal(result.stderr, '');
});

test('--top 1: exit 0 (boundary — minimum valid value)', () => {
  const result = runCli(['--top', '1', '/repo'], fakeIo([]));
  assert.equal(result.code, 0);
});

// ---------------------------------------------------------------------------
// CLI flag parsing — validation / error paths
// ---------------------------------------------------------------------------

test('--top 0: exit 2 with "--top must be" in stderr', () => {
  const result = runCli(['--top', '0', '/repo'], fakeIo([]));
  assert.equal(result.code, 2);
  assert.match(result.stderr, /--top must be/);
});

test('--top (missing value): exit 2 with "--top requires" in stderr', () => {
  const result = runCli(['--top'], fakeIo([]));
  assert.equal(result.code, 2);
  assert.match(result.stderr, /--top requires/);
});

test('--top foo (non-integer string): exit 2', () => {
  const result = runCli(['--top', 'foo', '/repo'], fakeIo([]));
  assert.equal(result.code, 2);
});

test('--top 1.5 (non-integer float): exit 2', () => {
  const result = runCli(['--top', '1.5', '/repo'], fakeIo([]));
  assert.equal(result.code, 2);
});

test('--top -1 (negative value): exit 2', () => {
  // '--top' sees '-1' but '-1'.startsWith('-') is true → "requires a value" path
  const result = runCli(['--top', '-1', '/repo'], fakeIo([]));
  assert.equal(result.code, 2);
});

// ---------------------------------------------------------------------------
// summarize() — top cap applied to ranked lists
// ---------------------------------------------------------------------------

test('summarize top:2 with 5-author fixture caps byAuthor to 2', () => {
  const commits = fiveAuthorCommits();
  const summary = summarize(commits, { top: 2 });
  assert.equal(summary.byAuthor.length, 2, 'byAuthor must have 2 entries');
});

test('summarize top:2 with 5-author fixture caps authorChurn to 2', () => {
  const commits = fiveAuthorCommits();
  const summary = summarize(commits, { top: 2 });
  assert.equal(summary.authorChurn.length, 2, 'authorChurn must have 2 entries');
});

test('summarize top:2 with 5-author fixture caps fileChurn to 2 (or fewer if fewer files)', () => {
  // Each commit has files:[], so fileChurn will be empty — still length <= 2.
  const commits = fiveAuthorCommits();
  const summary = summarize(commits, { top: 2 });
  assert.ok(summary.fileChurn.length <= 2, 'fileChurn must have at most 2 entries');
});

test('summarize top:2 — byAuthor is ranked (highest commit-count first)', () => {
  const commits = fiveAuthorCommits();
  // fiveAuthorCommits() produces Epsilon=5, Delta=4, Gamma=3, Beta=2, Alpha=1.
  const summary = summarize(commits, { top: 2 });
  assert.equal(summary.byAuthor[0].author, 'Epsilon');
  assert.equal(summary.byAuthor[1].author, 'Delta');
});

// ---------------------------------------------------------------------------
// summarize() — no top: all entries returned (backward-compat)
// ---------------------------------------------------------------------------

test('summarize without top returns all 5 authors in byAuthor', () => {
  const commits = fiveAuthorCommits();
  const summary = summarize(commits);
  assert.equal(summary.byAuthor.length, 5, 'byAuthor must have all 5 entries without top');
});

test('summarize without top returns all 5 authors in authorChurn', () => {
  const commits = fiveAuthorCommits();
  const summary = summarize(commits);
  assert.equal(summary.authorChurn.length, 5);
});

test('summarize top:undefined behaves same as no options (no cap)', () => {
  const commits = fiveAuthorCommits();
  const s1 = summarize(commits);
  const s2 = summarize(commits, { top: undefined });
  assert.equal(s1.byAuthor.length, s2.byAuthor.length);
});

// ---------------------------------------------------------------------------
// summarize() — new fields always present
// ---------------------------------------------------------------------------

test('summarize returns ownershipEntries array (empty without repoPath)', () => {
  const commits = fiveAuthorCommits();
  const summary = summarize(commits);
  assert.ok(Array.isArray(summary.ownershipEntries));
  assert.equal(summary.ownershipEntries.length, 0);
});

test('summarize returns hotspotEntries array (empty when commits have no files)', () => {
  const commits = fiveAuthorCommits(); // files:[] on each commit
  const summary = summarize(commits);
  assert.ok(Array.isArray(summary.hotspotEntries));
  // commits have no file entries → hotspot map is empty
  assert.equal(summary.hotspotEntries.length, 0);
});

test('summarize returns hotspotEntries when commits have files', () => {
  const c = commit({
    author: 'Alice',
    date: '2023-01-01',
    files: [{ path: 'foo.ts', insertions: 5, deletions: 0 }],
  });
  const summary = summarize([c]);
  assert.equal(summary.hotspotEntries.length, 1);
  assert.equal(summary.hotspotEntries[0].file, 'foo.ts');
});

test('summarize top:1 caps hotspotEntries to 1 when commits have multiple files', () => {
  const c1 = commit({
    author: 'Alice',
    date: '2023-01-01',
    files: [
      { path: 'a.ts', insertions: 1, deletions: 0 },
      { path: 'b.ts', insertions: 1, deletions: 0 },
    ],
  });
  const c2 = commit({
    author: 'Alice',
    date: '2023-01-02',
    files: [{ path: 'a.ts', insertions: 1, deletions: 0 }],
  });
  const summary = summarize([c1, c2], { top: 1 });
  assert.equal(summary.hotspotEntries.length, 1);
});
