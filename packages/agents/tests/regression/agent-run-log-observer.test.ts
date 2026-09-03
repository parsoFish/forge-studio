/**
 * The log observer's own contract — beads **forge-q1z** and **forge-1im**.
 *
 * The subject is `tests/test-fixtures/interactive-runner-log-observer.ts`, and
 * these are the tests that made it a module rather than a copied block.
 *
 * **forge-q1z** — `assertNoInteractiveRunnerSkillEvent` must be SCOPED to a
 * baseline snapshot taken before the invocation under test, not a blanket walk
 * of every `_logs/` directory that happens to exist: pre-existing scratch
 * cannot false-fail it, while events written DURING the invocation — appended
 * to a known file or written to a brand-new one — must still throw. A file
 * that shrank below its snapshotted size is re-scanned in full rather than
 * clamped to empty, because a shrunken file's provenance is unknowable.
 *
 * **forge-1im** — the TOCTOU. The real repo `_logs/` is shared with every
 * sibling test process, so `existsSync` then `readFileSync` false-failed when
 * a sibling removed an entry between the two. The readers tolerate ONLY
 * ENOENT/ENOTDIR and rethrow everything else, and `readdirIfPresent` is
 * narrower still (ENOENT only) because a `_logs` that exists but is not a
 * directory is a real fault the pre-fix code threw on. These assert the
 * tolerance is exactly that wide and no wider — a swallow introduced by the
 * fix would be the defect, not the cure.
 *
 * SPLIT FROM a 1,226-line file. Its 268-line shared block became a real
 * fixture module, `tests/test-fixtures/interactive-runner-log-observer.ts`,
 * because all four of its clusters used it and one of them tests the log
 * walker as its subject — three duplicated copies of a 162-line walker is the
 * signal that a seam is wrong, not a smaller file (T1 ruling 94). The three
 * parts are `contract/agent-run-dispatch-fork` (this file's siblings:
 * AT-1..AT-7), `integration/agent-run-turnspec-paths` (where a turnSpec run's
 * paths resolve) and `regression/agent-run-log-observer` (forge-q1z /
 * forge-1im). The split retires the file's `scripts/baselines/file-size.json`
 * row rather than re-keying it: a move cannot retire an exemption, only a
 * split can.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  readIfPresent,
  readdirIfPresent,
  statSizeIfPresent,
  walkEventJsonLines,
  snapshotLogs,
  assertNoInteractiveRunnerSkillEvent,
} from '../test-fixtures/interactive-runner-log-observer.ts';

// ===========================================================================
// forge-q1z (T3, acceptance test) — assertNoInteractiveRunnerSkillEvent must
// be SCOPED to a baseline snapshot taken before the invocation under test,
// not a blanket walk of every _logs/ dir that happens to exist on disk.
//
// THE DEFECT: the four AT-2 cases above call assertNoInteractiveRunnerSkillEvent
// with ROOT = the real repo root (legacy fast-fail paths never touch the
// filesystem, so there is nothing to isolate into a tmp fixture). After a
// `npm run ui:journey` run, the real repo's _logs/ accumulates leftover
// interactive-runner event dirs (gitignored scratch, never cleaned up
// between runs). The CURRENT (unscoped) assertNoInteractiveRunnerSkillEvent
// walks EVERY directory under _logs/ regardless of when it was written, so
// it trips over that pre-existing scratch and false-fails all four AT-2
// cases — a false red with no code regression behind it (CI stays green
// because CI's own _logs/ is always empty). See bead forge-q1z.
//
// THE FIX (landed separately by the implementer, NOT by this test): a
// baseline snapshot taken before the invocation under test, so the assertion
// only inspects (a) _logs/ directories that did NOT exist at snapshot time,
// and (b) the bytes APPENDED to an existing events.jsonl after its
// snapshotted length. Pre-existing scratch becomes invisible; anything
// written DURING the invocation is still fully caught.
//
// PINNED SEAM (no design freedom on names/arity — the implementer must land
// exactly this):
//
//   function snapshotLogs(forgeRoot: string): LogBaseline
//   function assertNoInteractiveRunnerSkillEvent(
//     forgeRoot: string,
//     baseline: LogBaseline,
//     msg: string,
//   ): void
//
// `LogBaseline` itself is opaque to callers — internally it must be able to
// answer, per `_logs/<dir>/events.jsonl`, both "did this directory exist at
// snapshot time" and "how many bytes had it already written", so the scoped
// assertion can skip pre-existing bytes while still inspecting appended
// bytes and brand-new directories in full.
//
// RED-NOW: neither `snapshotLogs` nor the 3-arg
// `assertNoInteractiveRunnerSkillEvent` exist at this SHA (the function
// above still takes exactly `(forgeRoot, msg)`) — this test calls the NEW
// contract directly, so the file does not typecheck as written, and running
// it hits a ReferenceError on the undefined `snapshotLogs` call before any
// assertion below is ever reached. That is the intentional RED this WI
// pins; see the T3 report for the captured tsc + node --test output.
// ===========================================================================

/** One real-shaped `start`/interactive-runner JSONL line, mirroring EXACTLY
 *  the event shape `findInteractiveRunnerStartEvent` above parses
 *  (`event_type:'start'`, `skill:'interactive-runner'`,
 *  `metadata:{session_id,session_kind,phase,step}`) — not a hand-waved
 *  stand-in shape. */
function fakeInteractiveRunnerStartLine(sessionId: string, sessionKind: string): string {
  return JSON.stringify({
    event_type: 'start',
    skill: 'interactive-runner',
    metadata: { session_id: sessionId, session_kind: sessionKind, phase: 'p1', step: 'noop' },
  });
}

test('forge-q1z: assertNoInteractiveRunnerSkillEvent is scoped to a baseline snapshot — pre-existing _logs/ scratch cannot false-fail it, but events written during the invocation (appended OR brand-new) still throw', () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'q1z-scoped-logs-'));
  try {
    // --- arrange: PRE-EXISTING journey scratch, on disk BEFORE the baseline
    // is taken — mirrors a real repo _logs/ dir already carrying leftover
    // interactive-runner events from an earlier `ui:journey` run.
    const scratchDir = join(forgeRoot, '_logs', '_journeyscratch-preexisting');
    mkdirSync(scratchDir, { recursive: true });
    const scratchEventsPath = join(scratchDir, 'events.jsonl');
    writeFileSync(scratchEventsPath, fakeInteractiveRunnerStartLine('pre-existing-sid', 'pre-existing-kind') + '\n');

    // The baseline snapshot — taken exactly where the AT-2 loop must take
    // it: AFTER pre-existing scratch is already on disk, BEFORE the
    // invocation under test.
    const baseline = snapshotLogs(forgeRoot);

    // =========================================================================
    // Half 1 — the q1z fix: pre-existing scratch is invisible to the scoped
    // assertion. Kills the CURRENT (unscoped) implementation outright: it
    // walks every _logs/<dir>/events.jsonl regardless of write time, so it
    // would throw here on the pre-existing line planted above — exactly
    // forge-q1z's false-fail.
    // =========================================================================
    assert.doesNotThrow(
      () => assertNoInteractiveRunnerSkillEvent(forgeRoot, baseline, 'pre-existing scratch must not false-fail'),
      'a baseline taken after pre-existing _logs/ scratch already exists must make that scratch invisible to the scoped assertion',
    );

    // =========================================================================
    // Half 2 — positive control: the scoping must not neuter the assertion.
    // Two sub-cases, BOTH required — a wrong implementation can satisfy
    // either alone.
    // =========================================================================

    // 2a. Append a SECOND interactive-runner line to the SAME pre-existing
    // file, after the baseline. Kills a wrong implementation that scopes by
    // "is this _logs/<dir> new" alone (skip any directory that already
    // existed at snapshot time, wholesale) — that shape would pass 2b below
    // but silently miss a real event appended to an existing dir, which is
    // exactly what a second turn in an already-running session does.
    appendFileSync(scratchEventsPath, fakeInteractiveRunnerStartLine('appended-sid', 'appended-kind') + '\n');
    assert.throws(
      () => assertNoInteractiveRunnerSkillEvent(forgeRoot, baseline, 'appended event must still be caught'),
      /interactive-runner/,
      'bytes appended to a pre-existing events.jsonl AFTER the baseline snapshot must still be inspected and caught',
    );

    // 2b. A brand-new _logs/<dir> created after the baseline. Kills a wrong
    // implementation that only ever re-scans directories present at
    // snapshot time (an "existing dirs only" scope) — that shape would pass
    // 2a above but miss a directory freshly created during the invocation,
    // which is exactly what a NEW session's first turn does. Re-snapshots
    // on a fresh baseline so this sub-case is proven independently of 2a's
    // mutation.
    const baseline2 = snapshotLogs(forgeRoot);
    const newDir = join(forgeRoot, '_logs', '_brandnew-newlyspawned');
    mkdirSync(newDir, { recursive: true });
    writeFileSync(join(newDir, 'events.jsonl'), fakeInteractiveRunnerStartLine('new-sid', 'new-kind') + '\n');
    assert.throws(
      () => assertNoInteractiveRunnerSkillEvent(forgeRoot, baseline2, 'new dir event must still be caught'),
      /interactive-runner/,
      'a brand-new _logs/ directory created AFTER the baseline snapshot must still be fully inspected',
    );
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// forge-q1z shrink-guard (T3, MAJOR, adversarial review) — kills a
// `subarray(startByte)` that clamps to empty when the file shrank, silently
// hiding every event in it (Buffer.prototype.subarray clamps rather than
// throwing when start > length).
// ---------------------------------------------------------------------------

test('forge-q1z: a shrunken events.jsonl is re-scanned in full, not clamped to empty', () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'q1z-shrink-guard-'));
  try {
    const dir = join(forgeRoot, '_logs', '_journeyscratch-shrinkme');
    mkdirSync(dir, { recursive: true });
    const eventsPath = join(dir, 'events.jsonl');
    const bigLines = Array.from({ length: 20 }, (_, i) => fakeInteractiveRunnerStartLine(`sid-${i}`, `kind-${i}`)).join('\n') + '\n';
    writeFileSync(eventsPath, bigLines);
    const baseline = snapshotLogs(forgeRoot);

    // Shrink well below the snapshotted size — still a real event, fewer bytes.
    writeFileSync(eventsPath, fakeInteractiveRunnerStartLine('shrunk-sid', 'shrunk-kind') + '\n');
    assert.ok(statSync(eventsPath).size < baseline.get(eventsPath)!.size, 'fixture must actually shrink');

    assert.throws(
      () => assertNoInteractiveRunnerSkillEvent(forgeRoot, baseline, 'shrunken file must be re-scanned, not skipped'),
      /interactive-runner/,
      "a `subarray(startByte)` that clamps to empty when the file shrank, silently hiding every event in it",
    );
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});


// ===========================================================================
// forge-1im (W8-C2b, acceptance test) — the _logs/ read seam must EXCLUDE a
// path that is gone, and must still THROW on every other fault.
//
// THE DEFECT: AT-2 above walks the REAL repo root, whose `_logs/` is shared
// with every sibling test process `node --test` runs concurrently. The former
// `existsSync(p)` -> `readFileSync(p)` pair is a TOCTOU: a sibling that removes
// the entry inside that window makes the read throw ENOENT and false-fails a
// test with no regression behind it. That is bead forge-1im.
//
// HONEST LIMIT OF THIS TEST, stated rather than papered over. The real race
// needs `existsSync` to answer TRUE and the file to vanish before the read.
// That is not deterministically stageable: `existsSync` IS a stat, so any
// fixture that makes the read fail with ENOENT (a dangling symlink, an absent
// file) ALSO makes `existsSync` answer false, and the OLD code skipped it too.
// I verified exactly that before writing this — a dangling-symlink fixture does
// NOT reproduce the pre-fix throw. So this test does not stage the race (a
// concurrent deleter would just add the flake this lane exists to remove); it
// pins the CONTRACT of the seam the fix introduces, which is what makes the
// race harmless: gone -> excluded, everything else -> throw.
//
// Both halves are REQUIRED. Half 1 alone is satisfied by a catch-everything —
// precisely the "make it green by swallowing" failure this lane must not ship.
// ===========================================================================

test('forge-1im: the _logs/ read seam EXCLUDES a gone path (ENOENT) and still THROWS on any other fault — an exclusion, never a swallow', () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), '1im-read-seam-'));
  try {
    // --- Half 1: a GONE path is excluded, and callers get a usable empty. ---
    const missingFile = join(forgeRoot, '_logs', 'never-existed', 'events.jsonl');
    assert.equal(readIfPresent(missingFile), null, 'a missing events.jsonl must read as null (excluded), not throw');
    assert.equal(statSizeIfPresent(missingFile), null, 'a missing events.jsonl must stat as null (excluded), not throw');
    assert.deepEqual(readdirIfPresent(join(forgeRoot, '_logs')), [], 'a missing _logs/ must list as empty, not throw');

    // A dangling symlink — what a sibling's rmSync leaves for an instant.
    const goneDir = join(forgeRoot, '_logs', 'sibling-deleted-mid-walk');
    mkdirSync(goneDir, { recursive: true });
    symlinkSync(join(forgeRoot, '_logs', 'no-such-target.jsonl'), join(goneDir, 'events.jsonl'));
    assert.equal(readIfPresent(join(goneDir, 'events.jsonl')), null, 'a dangling events.jsonl symlink must read as null (excluded)');

    // ...and the WALK keeps going past it: a live neighbour is still inspected.
    const liveDir = join(forgeRoot, '_logs', 'live-neighbour');
    mkdirSync(liveDir, { recursive: true });
    writeFileSync(join(liveDir, 'events.jsonl'), fakeInteractiveRunnerStartLine('live-sid', 'live-kind') + '\n');
    const baseline = snapshotLogs(forgeRoot);
    assert.doesNotThrow(
      () => assertNoInteractiveRunnerSkillEvent(forgeRoot, baseline, 'pre-existing bytes stay invisible'),
      'the walk must complete across a gone entry, and pre-existing bytes stay baseline-invisible',
    );
    appendFileSync(join(liveDir, 'events.jsonl'), fakeInteractiveRunnerStartLine('appended-sid', 'appended-kind') + '\n');
    assert.throws(
      () => assertNoInteractiveRunnerSkillEvent(forgeRoot, baseline, 'appended event must still be caught'),
      /appended event must still be caught/,
      'excluding the gone entry must not abandon the walk — the neighbour\'s appended event must still fail the assertion',
    );

    // --- Half 2: every NON-gone fault must STILL throw. ---------------------
    // events.jsonl as a DIRECTORY yields EISDIR on read: a real, unexpected
    // fault that must never be tolerated.
    const eisdir = join(forgeRoot, '_logs', 'events-is-a-directory');
    mkdirSync(join(eisdir, 'events.jsonl'), { recursive: true });
    assert.throws(
      () => readIfPresent(join(eisdir, 'events.jsonl')),
      (err: NodeJS.ErrnoException) => err.code === 'EISDIR',
      'only a GONE path (ENOENT/ENOTDIR) may be tolerated — EISDIR must still throw',
    );
    assert.throws(
      () => [...walkEventJsonLines(forgeRoot)],
      (err: NodeJS.ErrnoException) => err.code === 'EISDIR',
      'the walk must surface a non-gone read fault, never swallow it',
    );
    // A FILE where a log directory is expected yields ENOTDIR on the inner
    // read — that IS a gone path (no such directory to hold events.jsonl) and
    // is correctly excluded, while readdir on a FILE still throws ENOTDIR.
    const notdir = join(forgeRoot, '_logs', 'plain-file');
    writeFileSync(notdir, 'not a directory\n');
    assert.equal(readIfPresent(join(notdir, 'events.jsonl')), null, 'ENOTDIR under a non-directory entry is a gone path — excluded');
    assert.throws(
      () => readdirIfPresent(notdir),
      (err: NodeJS.ErrnoException) => err.code === 'ENOTDIR',
      'readdirIfPresent tolerates a MISSING dir, but listing a plain FILE is a real fault and must throw',
    );
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
