/**
 * Unit suite — the project's quality gate (contract C1).
 *
 * Fast, deterministic, creds-free, < 1 s. Genuinely discriminating: each test
 * pins a behaviour the implementation must satisfy, so the suite fails before
 * the work exists and passes only when it is correct. Run: `npm test`.
 *
 * The analytics core (`summarize`) and the renderer (`renderSummary`) are pure,
 * so they are tested against hand-built Commit fixtures with no git involved.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Commit } from '../src/git.ts';
import { parseLog } from '../src/git.ts';
import { summarize } from '../src/stats.ts';
import { renderSummary } from '../src/format.ts';
import { runCli } from '../src/cli.ts';

// --- fixtures ---

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

// Alice: 3 commits, Bob: 1, Carol: 1 — Bob/Carol tie on count.
const FIXTURE: readonly Commit[] = [
  commit({ author: 'Alice', date: '2021-03-02' }),
  commit({ author: 'Bob', date: '2021-03-01' }),
  commit({ author: 'Alice', date: '2021-03-05' }),
  commit({ author: 'Carol', date: '2021-03-04' }),
  commit({ author: 'Alice', date: '2021-03-03' }),
];

// --- summarize ---

test('summarize counts total commits', () => {
  assert.equal(summarize(FIXTURE).totalCommits, 5);
});

test('summarize orders authors by descending commit count', () => {
  const top = summarize(FIXTURE).byAuthor[0];
  assert.deepEqual(top, { author: 'Alice', commits: 3 });
});

test('summarize breaks count ties by author name ascending', () => {
  // Bob and Carol both have 1 commit; Bob (B) must precede Carol (C).
  const order = summarize(FIXTURE).byAuthor.map((a) => a.author);
  assert.deepEqual(order, ['Alice', 'Bob', 'Carol']);
});

test('summarize computes the first/last date range', () => {
  const s = summarize(FIXTURE);
  assert.equal(s.firstDate, '2021-03-01');
  assert.equal(s.lastDate, '2021-03-05');
});

test('summarize returns null dates and empty authors for empty input', () => {
  const s = summarize([]);
  assert.equal(s.totalCommits, 0);
  assert.deepEqual(s.byAuthor, []);
  assert.equal(s.firstDate, null);
  assert.equal(s.lastDate, null);
});

test('summarize does not mutate its input', () => {
  const input = [...FIXTURE];
  summarize(input);
  assert.equal(input.length, 5);
  assert.equal(input[0].author, 'Alice');
});

test('summarize rejects a non-array input', () => {
  assert.throws(() => summarize(42 as unknown as Commit[]), TypeError);
});

// --- renderSummary ---

test('renderSummary emits the header line with the date range', () => {
  const out = renderSummary(summarize(FIXTURE));
  assert.match(out.split('\n')[0], /^gitpulse — 5 commits \(2021-03-01 → 2021-03-05\)$/);
});

test('renderSummary lists authors in summarize order, top author first', () => {
  const out = renderSummary(summarize(FIXTURE));
  const lines = out.split('\n');
  // Header(0), blank(1), column head(2), rule(3), then rows.
  assert.match(lines[4], /Alice$/);
  assert.match(lines[5], /Bob$/);
  assert.match(lines[6], /Carol$/);
});

test('renderSummary renders an empty summary with a (none) range and note', () => {
  const out = renderSummary(summarize([]));
  assert.match(out, /0 commits \(\(none\) → \(none\)\)/);
  assert.match(out, /No commits found\./);
});

// --- parseLog (git output parser) ---

test('parseLog parses headers + numstat into commit records', () => {
  const SHA_A = 'aaaaaaa1234567890abcdef1234567890abcdef1';
  const SHA_B = 'bbbbbbb1234567890abcdef1234567890abcdef1';
  const PARENT_A = 'ccccccc1234567890abcdef1234567890abcdef1';
  const raw = [
    `${SHA_A}\tAlice\t2021-03-02\t${PARENT_A}\talice@example.com`,
    '10\t2\tsrc/a.ts',
    '3\t0\tsrc/b.ts',
    '',
    `${SHA_B}\tBob\t2021-03-01\t${PARENT_A}\tbob@example.com`,
    '5\t1\tsrc/c.ts',
  ].join('\n');
  const commits = parseLog(raw);
  assert.equal(commits.length, 2);
  assert.deepEqual(commits[0], {
    hash: SHA_A,
    author: 'Alice',
    date: '2021-03-02',
    parentCount: 1,
    authorEmail: 'alice@example.com',
    filesChanged: 2,
    insertions: 13,
    deletions: 2,
    files: [
      { path: 'src/a.ts', insertions: 10, deletions: 2 },
      { path: 'src/b.ts', insertions: 3, deletions: 0 },
    ],
  });
});

test('parseLog counts binary "-" numstat markers as zero', () => {
  const SHA_C = 'ddddddd1234567890abcdef1234567890abcdef1';
  const PARENT_C = 'eeeeeee1234567890abcdef1234567890abcdef1';
  const raw = [`${SHA_C}\tCarol\t2021-03-04\t${PARENT_C}\tcarol@example.com`, '-\t-\tassets/logo.png'].join('\n');
  const [c] = parseLog(raw);
  assert.equal(c.filesChanged, 1);
  assert.equal(c.insertions, 0);
  assert.equal(c.deletions, 0);
});

// --- runCli (argv boundary) ---

const stubReader = (commits: readonly Commit[]) =>
  (() => [...commits]) as unknown as typeof import('../src/git.ts').readCommits;

test('runCli renders a summary for the given repo path', () => {
  const r = runCli(['/some/repo'], { readCommits: stubReader(FIXTURE) });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^gitpulse — 5 commits/);
});

test('runCli prints usage on --help with exit 0', () => {
  const r = runCli(['--help'], { readCommits: stubReader([]) });
  assert.equal(r.code, 0);
  assert.match(r.stderr, /Usage:/);
});

test('runCli reports a failing reader (non-repo) with exit 1', () => {
  const failing = (() => {
    throw new Error('gitpulse: "/nope" is not a git repository');
  }) as unknown as typeof import('../src/git.ts').readCommits;
  const r = runCli(['/nope'], { readCommits: failing });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /not a git repository/);
});

test('runCli rejects an unknown option with exit 2', () => {
  const r = runCli(['--frobnicate'], { readCommits: stubReader([]) });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown option/);
});
