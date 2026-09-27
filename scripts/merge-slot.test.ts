/**
 * merge-slot.sh — moved into the skill (M7 findings row 37, T1 ruling 1227 B / GO per 1282).
 *
 * This does NOT re-derive the door suite in TypeScript. The `.claude/skills/tiered-orchestration/
 * tests/merge-slot-doors-*.sh` files already prove the merge protocol against 37 real-trace
 * shapes, each with its own throwaway fixture world. Porting that into a second implementation
 * risks the exact failure this campaign's own files warn about elsewhere (§15.531): two checkers
 * on one question drift, and the drift is invisible until an edge nobody looks at disagrees. So
 * this wraps the door scripts VERBATIM.
 *
 * SPLIT BY CONCERN (forge-8vfn.8.1.29, T1 ruling 1649). The doors used to be one 847-line
 * `merge-slot-doors.sh` — over the 800-line cap `scripts/check-file-size.mjs` now also enforces
 * for `.sh` files. They are now nine files under `.claude/skills/tiered-orchestration/tests/`:
 * `merge-slot-doors-lib.sh` (the shared harness — world() fixture, the SUBJECT_SHA/MSP_SHA pins,
 * ok/bad counters — sourced by every concern file below, never duplicated) plus one file per
 * concern: `-main-at` (MAIN_AT capture, forge-8vfn.7.6.111), `-gate` (gate-log marker + ALONE-RERUN
 * waiver), `-update-branch` (update-branch conflicts + rename paths), `-out-guard` (the <out>
 * refusal), `-changed-set` (the List-files changed-set API), `-pin-since-gate` (pinned-path-
 * since-gate), `-exit-codes` (per-class exit codes), `-merge-state` (mergeStateStatus ordering,
 * forge-8vfn.8.1.26). Every door was preserved exactly — same 37 total, same assertions — only the
 * file boundaries and the (now-shared) harness changed. Each concern file still refuses on its own
 * (exit 2, UNKNOWN) if `merge-slot.sh` or `merge-state-precheck.sh` drifted, because each one
 * sources the lib and re-runs its pin checks independently.
 *
 * COMMITTED, NOT READ FROM `_1.0/` (fix to the first version of this move). `_1.0/` is
 * gitignored campaign state — CLAUDE.md: a permanent artifact "never cites a path inside it" —
 * so a test that shelled out to `_1.0/` would find nothing outside an in-flight M7-C checkout and
 * would SKIP in every other one, including CI. A door suite that always skips is a gate that never
 * runs, which is not the same thing as a green one. The doors were cp'd from the hash-verified
 * `_1.0` source and edited only to (a) resolve `merge-slot.sh` as their own sibling instead of
 * naming `_1.0`, (b) build a fixture campaign directory (incl. a fixture `known-flakes.md` carrying
 * the one line the ALONE-RERUN doors match against) instead of pointing at the real one, and (c)
 * zero the production sleep intervals `merge-slot.sh` now exposes as env vars, so 37 shapes run in
 * seconds instead of minutes. Every fixture shape, assertion and comment is otherwise untouched.
 *
 * Both the lib's own `MS` default and its `SUBJECT_SHA` pin name the SKILL COPY of `merge-slot.sh`
 * directly (sibling-resolved, no env override needed) — so this test needs no environment at all
 * beyond `PATH`; it is exercising exactly what `bash .claude/skills/tiered-orchestration/tests/
 * merge-slot-doors-<concern>.sh` does standalone, one spawnSync per concern file so every split
 * file actually runs and a failure names the concern that broke.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const DOORS_DIR = join(import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'tests');

// One file per concern (forge-8vfn.8.1.29) — every split file must run, so this is a loop over
// all of them rather than a single invocation of the (now-deleted) merge-slot-doors.sh.
const DOOR_FILES = [
  'merge-slot-doors-main-at.sh',
  'merge-slot-doors-gate.sh',
  'merge-slot-doors-update-branch.sh',
  'merge-slot-doors-out-guard.sh',
  'merge-slot-doors-changed-set.sh',
  'merge-slot-doors-pin-since-gate.sh',
  'merge-slot-doors-exit-codes.sh',
  'merge-slot-doors-merge-state.sh',
];

for (const file of DOOR_FILES) {
  test(`merge-slot.sh (skill copy) passes its ${file} door suite`, () => {
    const r = spawnSync('bash', [join(DOORS_DIR, file)], { encoding: 'utf8' });

    assert.equal(r.status, 0, `${file} failed:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout ?? '', /merge-slot-doors: \d+ ok, 0 FAILED/);
  });
}
