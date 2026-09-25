/**
 * merge-slot.sh — moved into the skill (M7 findings row 37, T1 ruling 1227 B / GO per 1282).
 *
 * This does NOT re-derive the door suite in TypeScript. `.claude/skills/tiered-orchestration/
 * tests/merge-slot-doors.sh` already proves the merge protocol against 31 real-trace shapes,
 * each with its own throwaway fixture world. Porting 780-odd lines of that into a second
 * implementation risks the exact failure this campaign's own files warn about elsewhere
 * (§15.531): two checkers on one question drift, and the drift is invisible until an edge
 * nobody looks at disagrees. So this wraps the door script VERBATIM.
 *
 * COMMITTED, NOT READ FROM `_1.0/` (fix to the first version of this move). `_1.0/` is
 * gitignored campaign state — CLAUDE.md: a permanent artifact "never cites a path inside it" —
 * so a test that shelled out to `_1.0/tests/merge-slot-doors.sh` would find nothing outside an
 * in-flight M7-C checkout and would SKIP in every other one, including CI. A door suite that
 * always skips is a gate that never runs, which is not the same thing as a green one. The doors
 * now live at `.claude/skills/tiered-orchestration/tests/merge-slot-doors.sh` — cp'd from the
 * hash-verified `_1.0` source and edited only to (a) resolve `merge-slot.sh` as its own sibling
 * instead of naming `_1.0`, (b) build a fixture campaign directory (incl. a fixture
 * `known-flakes.md` carrying the one line the ALONE-RERUN doors match against) instead of
 * pointing at the real one, and (c) zero the production sleep intervals `merge-slot.sh` now
 * exposes as env vars, so 31 shapes run in ~12s instead of ~320s. Every fixture shape, assertion
 * and comment is otherwise untouched.
 *
 * Both the doors' own `MS` default and their `SUBJECT_SHA` pin now name the SKILL COPY of
 * `merge-slot.sh` directly (sibling-resolved, no env override needed) — so this test needs no
 * environment at all beyond `PATH`; it is exercising exactly what `bash
 * .claude/skills/tiered-orchestration/tests/merge-slot-doors.sh` does standalone.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const DOORS = join(import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'tests', 'merge-slot-doors.sh');

test('merge-slot.sh (skill copy) passes its committed door suite', () => {
  const r = spawnSync('bash', [DOORS], { encoding: 'utf8' });

  assert.equal(r.status, 0, `merge-slot-doors.sh failed:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout ?? '', /merge-slot-doors: \d+ ok, 0 FAILED/);
});
