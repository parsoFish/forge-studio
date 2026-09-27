/**
 * ground-merge-accounted.test.ts — bead `forge-8vfn.8.1.32`, T1 ruling 1694.
 *
 * S10 proof run 35: a legitimately merged PR's own diff came back as 18
 * UNDECLARED containment failures because the own-ground fence had no notion
 * of "this run's cycle log says it merged and aligned". These tests pin the
 * chain the reviewer's acceptance pass demands: the event is a POINTER, the
 * ground's live git is the PROOF, and anything the chain cannot confirm is a
 * NAMED containment failure, never a silent pass.
 *
 * Real git repos throughout (`fixture-ground-trees.test.ts`'s own `git`
 * helper, verbatim) — this is exactly the shape `groundTrackedDiff` /
 * `groundWorkingTreeStatus` run against in a live story.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import {
  safeRevParseHead,
  captureGroundPin,
  groundWorkingTreeStatus,
  groundTrackedDiff,
  mintedCycleLogNames,
  findMergeAlignment,
  findMergeAlignmentSince,
  verifyMergeAlignment,
  applyMergeAccounting,
} from './ground-merge-accounted.mjs';
import { readRunEvents } from './run-observe.mjs';
import { mintedSessionDirNames } from './ground-minted.mjs';
import { runnerSourceContaining } from './runner-source.mjs';

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', '-C', dir, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t.invalid' },
  }).trim();
}

/** A repo on `main` with one base commit — the caller's own `pin`. */
function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ground-merge-'));
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'README.md'), 'base\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

/** Write + commit `files` (path -> contents) on top of `dir`'s current HEAD; returns the new sha. */
function commit(dir: string, files: Record<string, string>, msg: string): string {
  for (const [rel, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), contents);
  }
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', msg);
  return git(dir, 'rev-parse', 'HEAD');
}

let mergeSeq = 0;

/**
 * A real `gh pr merge --merge` shape: a feature branch off `dir`'s CURRENT
 * HEAD carrying `files`, merged back with `--no-ff` — a two-parent commit
 * whose first parent is exactly the branch tip it started from. Returns the
 * merge commit's sha.
 */
function mergePR(dir: string, files: Record<string, string>, msg: string): string {
  const base = git(dir, 'rev-parse', 'HEAD');
  const branch = `feature-${(mergeSeq += 1)}`;
  git(dir, 'checkout', '-q', '-b', branch);
  for (const [rel, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), contents);
  }
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', `${msg} (feature)`);
  git(dir, 'checkout', '-q', 'main');
  git(dir, 'merge', '-q', '--no-ff', '-m', msg, branch);
  const head = git(dir, 'rev-parse', 'HEAD');
  assert.equal(git(dir, 'rev-parse', `${head}^1`), base, 'fixture sanity: first parent must be the pre-merge tip');
  return head;
}

const scratchLogs = () => mkdtempSync(join(tmpdir(), 'ground-merge-logs-'));

/** `_logs/<name>/events.jsonl` — one cycle's own event log, as `readRunEvents` reads it. */
function writeCycleLog(logsDir: string, name: string, events: object[]): void {
  const dir = join(logsDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

const alignEvent = (targetSha: string | null) => ({ message: 'closure.local-aligned-to-remote', metadata: { branch: 'x', target_sha: targetSha } });
const mergedEvent = { message: 'closure.manifest-moved-to-merged', metadata: { confirmed_merge: true } };
const ciEvent = (sha: string) => ({ message: 'cycle.post-merge-ci', metadata: { status: 'green', sha } });

// ─────────────────────────────────────────────────────────── safeRevParseHead / captureGroundPin

test('safeRevParseHead: the real HEAD of a git repo', () => {
  const dir = repo();
  try {
    assert.equal(safeRevParseHead(dir), git(dir, 'rev-parse', 'HEAD'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('safeRevParseHead: null for a non-repo dir — never throws', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ground-merge-norepo-'));
  try {
    assert.equal(safeRevParseHead(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('captureGroundPin: null when the story declares no ground project', () => {
  assert.equal(captureGroundPin('/anywhere', null), null);
});

// ───────────────────────────────────────────────────────────── groundWorkingTreeStatus

test('groundWorkingTreeStatus: clean repo reports both buckets empty', () => {
  const dir = repo();
  try {
    assert.deepEqual(groundWorkingTreeStatus(dir), { untracked: [], modified: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('groundWorkingTreeStatus: an untracked file lands in `untracked`, a staged one in `modified`', () => {
  const dir = repo();
  try {
    writeFileSync(join(dir, 'new.txt'), 'x\n');
    writeFileSync(join(dir, 'README.md'), 'changed\n');
    git(dir, 'add', 'README.md'); // staged, tracked-but-uncommitted — NOT `??`
    const status = groundWorkingTreeStatus(dir);
    assert.deepEqual(status.untracked, ['new.txt']);
    assert.deepEqual(status.modified, ['README.md']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('groundWorkingTreeStatus: null (never "clean") when the dir is not a git repo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ground-merge-norepo-'));
  try {
    assert.equal(groundWorkingTreeStatus(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ───────────────────────────────────────────────────────────────── groundTrackedDiff

test('groundTrackedDiff: added + modified between two commits, in groundChanges\' own vocabulary', () => {
  const dir = repo();
  try {
    const pin = git(dir, 'rev-parse', 'HEAD');
    const head = commit(dir, { 'README.md': 'changed\n', 'src/cli.ts': 'new\n' }, 'merge');
    const diff = groundTrackedDiff(dir, pin, head);
    assert.deepEqual(diff.sort((a, b) => a.path.localeCompare(b.path)), [
      { kind: 'modified', path: 'README.md' },
      { kind: 'added', path: 'src/cli.ts' },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('groundTrackedDiff: a rename splits into removed(old) + added(new)', () => {
  const dir = repo();
  try {
    const pin = git(dir, 'rev-parse', 'HEAD');
    git(dir, 'mv', 'README.md', 'README2.md');
    git(dir, 'commit', '-q', '-m', 'rename');
    const head = git(dir, 'rev-parse', 'HEAD');
    const diff = groundTrackedDiff(dir, pin, head);
    assert.deepEqual(diff.sort((a, b) => a.path.localeCompare(b.path)), [
      { kind: 'removed', path: 'README.md' },
      { kind: 'added', path: 'README2.md' },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('groundTrackedDiff: null on an unreadable ref, never an empty diff standing in for a failure', () => {
  const dir = repo();
  try {
    assert.equal(groundTrackedDiff(dir, 'deadbeef', 'HEAD'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ───────────────────────────────────────────────────────────────── findMergeAlignment

test('findMergeAlignment: null when no minted cycle log carries both events', () => {
  const logsDir = scratchLogs();
  try {
    writeCycleLog(logsDir, '_dev-1', [alignEvent('abc')]); // merged event missing
    writeCycleLog(logsDir, '_dev-2', [mergedEvent]); // align event missing
    assert.equal(findMergeAlignment(logsDir, ['_dev-1', '_dev-2'], readRunEvents), null);
  } finally {
    rmSync(logsDir, { recursive: true, force: true });
  }
});

test('findMergeAlignment: finds the co-occurring pair and its cross-check sha', () => {
  const logsDir = scratchLogs();
  try {
    writeCycleLog(logsDir, '_dev-3', [alignEvent('abc123'), mergedEvent, ciEvent('abc123')]);
    const found = findMergeAlignment(logsDir, ['_dev-3'], readRunEvents);
    assert.notEqual(found, null);
    assert.equal(found.align.metadata.target_sha, 'abc123');
    assert.equal(found.crossCheckSha, 'abc123');
  } finally {
    rmSync(logsDir, { recursive: true, force: true });
  }
});

// ───────────────────────────────────────────────────────────────── verifyMergeAlignment

test('verifyMergeAlignment (d): aligned to the merge commit, nothing else — PASSES, accounting exactly the merge diff', () => {
  const dir = repo();
  try {
    const pin = git(dir, 'rev-parse', 'HEAD');
    const head = mergePR(dir, { 'README.md': 'changed\n', 'src/cli.ts': 'new\n' }, 'merge #26');
    const v = verifyMergeAlignment({ groundDir: dir, pin, alignment: { align: alignEvent(head), crossCheckSha: null } });
    assert.equal(v.ok, true, v.ok ? '' : v.reason);
    assert.deepEqual(v.accounted.sort((a, b) => a.path.localeCompare(b.path)), [
      { kind: 'modified', path: 'README.md' },
      { kind: 'added', path: 'src/cli.ts' },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyMergeAlignment: a cross-check sha that AGREES with target_sha still passes', () => {
  const dir = repo();
  try {
    const pin = git(dir, 'rev-parse', 'HEAD');
    const head = mergePR(dir, { 'README.md': 'changed\n' }, 'merge');
    const v = verifyMergeAlignment({ groundDir: dir, pin, alignment: { align: alignEvent(head), crossCheckSha: head } });
    assert.equal(v.ok, true, v.ok ? '' : v.reason);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyMergeAlignment (a): aligned + one stray STAGED (tracked-but-uncommitted) file — fails on the stray only', () => {
  const dir = repo();
  try {
    const pin = git(dir, 'rev-parse', 'HEAD');
    const head = mergePR(dir, { 'README.md': 'changed\n' }, 'merge #26');
    writeFileSync(join(dir, 'stray.txt'), 'not part of the PR\n');
    git(dir, 'add', 'stray.txt'); // staged: TRACKED, never `??`
    const v = verifyMergeAlignment({ groundDir: dir, pin, alignment: { align: alignEvent(head), crossCheckSha: null } });
    assert.equal(v.ok, false);
    assert.match(v.reason, /stray\.txt/);
    assert.match(v.reason, /modified: stray\.txt/);
    assert.doesNotMatch(v.reason, /untracked: stray\.txt/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyMergeAlignment (b): aligned + one UNTRACKED file — fails on it', () => {
  const dir = repo();
  try {
    const pin = git(dir, 'rev-parse', 'HEAD');
    const head = mergePR(dir, { 'README.md': 'changed\n' }, 'merge #26');
    writeFileSync(join(dir, 'stray.txt'), 'never git add-ed\n');
    const v = verifyMergeAlignment({ groundDir: dir, pin, alignment: { align: alignEvent(head), crossCheckSha: null } });
    assert.equal(v.ok, false);
    assert.match(v.reason, /untracked: stray\.txt/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyMergeAlignment (c): event present but ground HEAD != the event\'s target — fails', () => {
  const dir = repo();
  try {
    const pin = git(dir, 'rev-parse', 'HEAD');
    const target = commit(dir, { 'README.md': 'changed\n' }, 'merge #26');
    commit(dir, { 'oops.txt': 'a later, unrelated commit\n' }, 'something after alignment');
    const v = verifyMergeAlignment({ groundDir: dir, pin, alignment: { align: alignEvent(target), crossCheckSha: null } });
    assert.equal(v.ok, false);
    assert.match(v.reason, /does not match the target_sha/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyMergeAlignment: aligned merge commit whose FIRST PARENT is NOT the pin — main moved in between — fails, named', () => {
  const dir = repo();
  try {
    const pin = git(dir, 'rev-parse', 'HEAD');
    // Something else committed straight to main between the pin and the PR's
    // own merge — this run never minted it, nothing declares it.
    const hotfix = commit(dir, { 'oops.txt': 'landed on main between the pin and the merge\n' }, 'hotfix directly to main');
    const head = mergePR(dir, { 'src/cli.ts': 'new\n' }, 'merge #26'); // branches off the hotfix, not off pin
    const v = verifyMergeAlignment({ groundDir: dir, pin, alignment: { align: alignEvent(head), crossCheckSha: null } });
    assert.equal(v.ok, false);
    assert.match(v.reason, new RegExp(`first parent ${hotfix} is not the pin ${pin}`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyMergeAlignment: aligned HEAD that is not a merge commit at all (single parent) — refused, named', () => {
  const dir = repo();
  try {
    const pin = git(dir, 'rev-parse', 'HEAD');
    const head = commit(dir, { 'README.md': 'changed\n' }, 'a plain (non-merge) commit'); // e.g. squash/rebase, never forge's own shape
    const v = verifyMergeAlignment({ groundDir: dir, pin, alignment: { align: alignEvent(head), crossCheckSha: null } });
    assert.equal(v.ok, false);
    assert.match(v.reason, /is not a merge commit \(1 parent\(s\)\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyMergeAlignment: no pin (no readable pre-run HEAD) — UNKNOWN, named, never a pass', () => {
  const dir = repo();
  try {
    const head = commit(dir, { 'README.md': 'changed\n' }, 'merge');
    const v = verifyMergeAlignment({ groundDir: dir, pin: null, alignment: { align: alignEvent(head), crossCheckSha: null } });
    assert.equal(v.ok, false);
    assert.match(v.reason, /no readable git HEAD before this run/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyMergeAlignment: no target_sha on the align event — UNKNOWN, never re-parsed from free text', () => {
  const dir = repo();
  try {
    const pin = git(dir, 'rev-parse', 'HEAD');
    const v = verifyMergeAlignment({ groundDir: dir, pin, alignment: { align: alignEvent(null), crossCheckSha: null } });
    assert.equal(v.ok, false);
    assert.match(v.reason, /carried no target_sha/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyMergeAlignment: a cross-check sha that DISAGREES with target_sha — UNKNOWN, the event alone is not trusted', () => {
  const dir = repo();
  try {
    const pin = git(dir, 'rev-parse', 'HEAD');
    const head = commit(dir, { 'README.md': 'changed\n' }, 'merge');
    const v = verifyMergeAlignment({ groundDir: dir, pin, alignment: { align: alignEvent(head), crossCheckSha: 'deadbeefdeadbeef' } });
    assert.equal(v.ok, false);
    assert.match(v.reason, /disagrees with the independently-reported merge commit/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ───────────────────────────────────────────────────────────────── applyMergeAccounting

test('applyMergeAccounting: no merge evidence at all — expectedChanges pass through unchanged, nothing red', () => {
  const dir = repo();
  try {
    const expectedChanges = [{ path: 'CLAUDE.md', change: 'added' }];
    const result = applyMergeAccounting({
      groundDir: dir,
      project: 'gitpulse',
      pin: git(dir, 'rev-parse', 'HEAD'),
      alignment: null,
      expectedChanges,
    });
    assert.deepEqual(result, { expectedChanges, lines: [], failureReason: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('applyMergeAccounting: run 35\'s shape — a verified merge widens expectedChanges and reports, never reds', () => {
  const dir = repo();
  const logsDir = scratchLogs();
  try {
    const pin = git(dir, 'rev-parse', 'HEAD');
    const head = mergePR(dir, { 'src/cli.ts': 'new\n' }, 'merge #26');
    writeCycleLog(logsDir, '_dev-INIT-x', [alignEvent(head), mergedEvent]);
    // T1 1736 — the caller resolves the alignment itself, ONCE, ahead of the
    // sweep, and hands the value to `applyMergeAccounting` — never a re-scan.
    const alignment = findMergeAlignment(logsDir, ['_dev-INIT-x'], readRunEvents);
    const result = applyMergeAccounting({
      groundDir: dir, project: 'gitpulse', pin, alignment, expectedChanges: [],
    });
    assert.equal(result.failureReason, null);
    assert.deepEqual(result.expectedChanges, [{ path: 'src/cli.ts', change: 'added' }]);
    assert.ok(result.lines.some((l) => l.includes('MERGE-ACCOUNTED 1 path')), result.lines.join('\n'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(logsDir, { recursive: true, force: true });
  }
});

test('applyMergeAccounting: an unverifiable claimed merge is a NAMED containment failure, expectedChanges untouched', () => {
  const dir = repo();
  const logsDir = scratchLogs();
  try {
    const pin = git(dir, 'rev-parse', 'HEAD');
    const target = commit(dir, { 'src/cli.ts': 'new\n' }, 'merge #26');
    commit(dir, { 'oops.txt': 'unaccounted\n' }, 'something after alignment');
    writeCycleLog(logsDir, '_dev-INIT-x', [alignEvent(target), mergedEvent]);
    const alignment = findMergeAlignment(logsDir, ['_dev-INIT-x'], readRunEvents);
    const expectedChanges = [];
    const result = applyMergeAccounting({
      groundDir: dir, project: 'gitpulse', pin, alignment, expectedChanges,
    });
    assert.equal(result.expectedChanges, expectedChanges);
    assert.match(result.failureReason, /CONTAINMENT FAILURE.*gitpulse.*could not be verified/s);
    assert.ok(result.lines.some((l) => l.includes('MERGE ALIGNMENT UNVERIFIABLE')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(logsDir, { recursive: true, force: true });
  }
});

// ──────────────────────────────────────────── mintedCycleLogNames / findMergeAlignmentSince
//
// Bead `forge-8vfn.8.1.32` follow-up, T1 ruling 1736. S10 proof run 36's own
// `_logs/2026-09-27T02-01-16_INIT-2026-09-27-exclude-author-filter` carried a
// real, verifiable merge and read back as 18 UNDECLARED containment failures
// because (1) `mintedSessionDirNames`'s `_<kind>-<id>` shape never matches a
// cycle dir (no leading underscore) and (2) the lookup ran AFTER
// `reapCensusAndSweep` had already removed that same directory. These tests
// pin the identity resolver that replaces the session-dir filter for this
// purpose, and the fact that it runs on evidence the sweep has not touched.

// A real corpus-shaped cycle dir is found; the old session-dir filter finds nothing.
test('mintedCycleLogNames / findMergeAlignmentSince: a real corpus-shaped cycle dir is found', () => {
  const logsDir = scratchLogs();
  try {
    const name = '2026-09-27T02-01-16_INIT-2026-09-27-exclude-author-filter';
    // The real merge commit sha from the corpus event lines below.
    const MERGE_SHA = 'e6c39105fd215bc2d2346f6ca096117ac6009151';
    // Real event lines, verbatim field shape (`message`, `metadata.target_sha`,
    // `metadata.sha`) — copied from a genuine S10 proof run's own cycle log,
    // not hand-invented. The product's own shape already matches what
    // `findMergeAlignment` reads; there is no mismatch to report here.
    writeCycleLog(logsDir, name, [
      {
        message: 'closure.local-aligned-to-remote',
        metadata: { target_sha: MERGE_SHA },
      },
      { message: 'closure.manifest-moved-to-merged', metadata: { confirmed_merge: true } },
      {
        message: 'cycle.post-merge-ci',
        metadata: { status: 'green', sha: MERGE_SHA },
      },
    ]);
    const sinceMs = Date.now() - 60_000;

    // THE OLD PATH — `mintedSessionDirNames` matches `_<kind>-<id>` only, and a
    // cycle dir carries no leading underscore, so it must find nothing at all.
    const oldNames = mintedSessionDirNames([], [name], logsDir);
    assert.deepEqual(oldNames, [], 'the session-dir shape must never match a cycle dir');
    const oldFound = findMergeAlignment(logsDir, oldNames, readRunEvents);
    assert.equal(oldFound, null, 'so the old path never finds this evidence');

    // THE IDENTITY RESOLVER — shaped like a cycle dir, born after sinceMs.
    const names = mintedCycleLogNames(logsDir, sinceMs);
    assert.deepEqual(names, [name]);
    const found = findMergeAlignmentSince(logsDir, sinceMs, readRunEvents);
    assert.notEqual(found, null);
    assert.equal((found as { unknown?: true }).unknown, undefined);
    const alignFound = found as { align: { metadata: { target_sha: string } } };
    assert.equal(alignFound.align.metadata.target_sha, MERGE_SHA);
    const crossCheckFound = found as { crossCheckSha: string | null };
    assert.equal(crossCheckFound.crossCheckSha, MERGE_SHA);
  } finally {
    rmSync(logsDir, { recursive: true, force: true });
  }
});

// A session dir never counts, and a cycle dir born before the anchor is excluded.
test('mintedCycleLogNames: a session dir never counts, birth time gates a cycle dir', () => {
  // `Date.now() +/- 1_000` rather than a fresh dir vs. an "aged" one — a
  // directory's birth time cannot be back-dated (`utimesSync` moves only
  // atime/mtime, never birthtime, `beats-cycle-terminal.test.ts`'s own
  // lesson), so the anchor moves instead, exactly like `newestChannelSince`'s
  // own tests (`beats-offsession-stall.test.ts:626`).
  const logsDir = scratchLogs();
  try {
    // shaped like a SESSION, never a cycle
    writeCycleLog(logsDir, '_dev-INIT-old-session', [alignEvent('abc')]);
    const cycleName = '2020-01-01T00-00-00_INIT-ancient';
    mkdirSync(join(logsDir, cycleName), { recursive: true });

    const afterBirth = mintedCycleLogNames(logsDir, Date.now() + 1_000);
    assert.deepEqual(afterBirth, [], 'an anchor after this dir was born sees nothing');
    assert.deepEqual(
      mintedCycleLogNames(logsDir, Date.now() - 60_000), [cycleName],
      'an anchor well before it sees exactly the cycle dir, never the session dir',
    );
  } finally {
    rmSync(logsDir, { recursive: true, force: true });
  }
});

test('mintedCycleLogNames: a genuinely absent _logs/ (ENOENT) reads as [], never unknown', () => {
  const missing = join(mkdtempSync(join(tmpdir(), 'ground-merge-missing-')), '_logs');
  const names = mintedCycleLogNames(missing, Date.now());
  assert.deepEqual(names, []);
  assert.equal(names.unknown, undefined);
});

// root reads mode-000 dirs, so this door cannot run as root — shared by both
// EACCES doors below.
const SKIP_AS_ROOT = { skip: process.getuid?.() === 0 ? 'root reads mode-000 dirs' : false };

// row 29/31's errno split — a persistently unreadable _logs/ is UNKNOWN, never "no cycle dirs".
test(
  'mintedCycleLogNames: a persistently unreadable _logs/ is UNKNOWN, never "no cycle dirs"',
  SKIP_AS_ROOT,
  () => {
    const logsDir = scratchLogs();
    chmodSync(logsDir, 0o000);
    try {
      const names = mintedCycleLogNames(logsDir, Date.now());
      assert.equal(names.length, 0, 'nothing readable was found');
      assert.notEqual(names.unknown, undefined, 'but the read failure must be NAMED, never silent');
      assert.match(names.unknown![0], /EACCES/);
    } finally {
      chmodSync(logsDir, 0o755);
      rmSync(logsDir, { recursive: true, force: true });
    }
  },
);

test(
  'findMergeAlignmentSince: an unreadable _logs/ surfaces as {unknown: true}, never silently "no merge"',
  SKIP_AS_ROOT,
  () => {
    const logsDir = scratchLogs();
    chmodSync(logsDir, 0o000);
    try {
      const found = findMergeAlignmentSince(logsDir, Date.now(), readRunEvents);
      assert.notEqual(found, null, 'unknown must never read the same as "nothing to account for"');
      assert.equal((found as { unknown: true }).unknown, true);
      assert.match((found as { detail: string }).detail, /EACCES/);
    } finally {
      chmodSync(logsDir, 0o755);
      rmSync(logsDir, { recursive: true, force: true });
    }
  },
);

// An {unknown: true} alignment is a NAMED containment failure, never a silent pass.
test('applyMergeAccounting: an {unknown: true} alignment is a NAMED containment failure', () => {
  const dir = repo();
  try {
    const expectedChanges = [{ path: 'CLAUDE.md', change: 'added' }];
    const result = applyMergeAccounting({
      groundDir: dir, project: 'gitpulse', pin: git(dir, 'rev-parse', 'HEAD'),
      alignment: { unknown: true, detail: 'could not read /fixture/_logs: EACCES' },
      expectedChanges,
    });
    assert.equal(result.expectedChanges, expectedChanges, 'never widened on unverifiable evidence');
    assert.match(result.failureReason!, /CONTAINMENT FAILURE.*gitpulse.*could not be verified/s);
    assert.match(result.failureReason!, /could not be enumerated/);
    assert.ok(result.lines.some((l) => l.includes('MERGE ALIGNMENT UNVERIFIABLE')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ───────────────────────────────────────────────────────────── T1 1736 wiring (ordering)
//
// THE MODULE IS DOORED; THE ORDERING IS THE UNTESTED PART. Bug 2 of the S10
// proof-run-35 incident was never a wrong predicate — it was `run-story.mjs`
// calling `reapCensusAndSweep` (which removes this run's own cycle dir)
// BEFORE the merge-alignment lookup ever ran. A door on `ground-merge-
// accounted.mjs` alone cannot see that; only the runner's own source order can.

// findMergeAlignmentSince runs BEFORE reapCensusAndSweep, and hands
// applyMergeAccounting the SAME binding.
test('T1 1736: findMergeAlignmentSince runs before the sweep, same binding reaches the fence', () => {
  const REAP_CALL = 'await reapCensusAndSweep({';
  const ALIGN_CALL = 'findMergeAlignmentSince(';
  const runner = runnerSourceContaining(REAP_CALL);

  const alignAt = runner.source.indexOf(ALIGN_CALL);
  const reapAt = runner.source.indexOf(REAP_CALL);
  assert.notEqual(alignAt, -1, 'the alignment must be resolved somewhere in the runner');
  assert.ok(
    alignAt < reapAt,
    'findMergeAlignmentSince must be called BEFORE reapCensusAndSweep — the sweep removes the cycle dir ' +
      'the alignment lookup depends on (forge-8vfn.8.1.32 follow-up, T1 1736)',
  );

  // THE BINDING MUST BE THE SAME ONE, never a second `_logs` read taken later.
  const bindingMatch = /const\s+(\w+)\s*=\s*findMergeAlignmentSince\(/.exec(runner.source);
  assert.notEqual(bindingMatch, null, 'findMergeAlignmentSince\'s result must be bound to a name');
  const binding = bindingMatch![1];

  const CALL = 'const merge = applyMergeAccounting({';
  const mergeCaller = runnerSourceContaining(CALL);
  const mergeAt = mergeCaller.source.indexOf(CALL);
  const mergeBlock = mergeCaller.source.slice(mergeAt, mergeCaller.source.indexOf('});', mergeAt));
  assert.match(
    mergeBlock,
    new RegExp(`alignment:\\s*${binding}\\b`),
    `applyMergeAccounting must receive the SAME ${binding} findMergeAlignmentSince produced, never a re-scan`,
  );
  assert.doesNotMatch(
    mergeBlock,
    /mintedLogNames|readEvents:/,
    'applyMergeAccounting must not be handed raw _logs-reading arguments — the alignment is already resolved',
  );
});
