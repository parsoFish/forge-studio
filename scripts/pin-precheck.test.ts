/**
 * pin-precheck.sh — moved into the skill (M7 findings row 37, T1 ruling 1227 B / GO per 1282).
 *
 * Byte-identical to the pinned `_1.0/pin-precheck.sh` (sha256 prefix `ef994c98cc82ac7c`):
 * unlike `merge-slot.sh`, it never hardcodes a path to itself, `_1.0`, or any sibling — every
 * input already arrives as an argument (`<gate-log> <repo> <campaign>`) or an env-derived flag
 * (`--changed-paths-file`). So the move needed no path surgery here; this test exists to prove
 * that claim against the door suite rather than assert it in prose.
 *
 * COMMITTED, NOT READ FROM `_1.0/` (fix to the first version of this move). `_1.0/` is
 * gitignored campaign state, so a test that shelled out to `_1.0/tests/precheck-doors.sh` would
 * find nothing outside an in-flight M7-C checkout and would skip everywhere else, including CI
 * — a gate that never runs, not a green one. The doors now live at `.claude/skills/
 * tiered-orchestration/tests/precheck-doors.sh` — cp'd from the hash-verified `_1.0` source and
 * edited only to resolve `pin-precheck.sh` as its own sibling instead of naming `_1.0`. Every
 * fixture shape, assertion and comment is otherwise untouched. Unlike the merge-slot doors, this
 * suite carries no subject-hash pin and no production sleeps — `pin-precheck.sh` had neither to
 * begin with, so there is nothing here to zero or reconcile.
 *
 * The doors' own `PP` default now names the SKILL COPY directly (sibling-resolved) — so this
 * test needs no environment at all beyond `PATH`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const DOORS = join(import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'tests', 'precheck-doors.sh');

test('pin-precheck.sh (skill copy) passes its committed door suite', () => {
  const r = spawnSync('bash', [DOORS], { encoding: 'utf8' });

  assert.equal(r.status, 0, `precheck-doors.sh failed:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout ?? '', /precheck-doors: \d+ ok, 0 FAILED/);
});
