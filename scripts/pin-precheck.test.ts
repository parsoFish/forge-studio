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

// ---- zero manifests is a named OK, never inferred from absence ----------------------------
// The campaign's manifests were legitimately frozen and moved out, so a campaign with ZERO
// `*.sha256` is a valid state. gate-pins.sh must STATE the zero (`PIN_MANIFEST_COUNT=0`) and
// pin-precheck.sh must accept it only when the log AND the campaign now agree.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const SKILL_SCRIPTS = join(import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts');
const PRECHECK = join(SKILL_SCRIPTS, 'pin-precheck.sh');
const GATE_PINS = join(SKILL_SCRIPTS, 'gate-pins.sh');
const FP = '0123456789abcdef';

interface Fixture { root: string; log: string; repo: string; camp: string }

function fixture(logLines: string[], manifests: string[]): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'pin-zero-'));
  const repo = join(root, 'repo');
  const camp = join(root, 'camp');
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(camp, 'gate-manifests'), { recursive: true });
  for (const m of manifests) {
    writeFileSync(join(camp, 'gate-manifests', `${m}.sha256`), '');
    writeFileSync(join(camp, 'gate-manifests', `${m}.counts`), `paths=0 head=deadbeef owner=${m}\n`);
  }
  const log = join(root, 'gate.log');
  writeFileSync(log, ['== pins ==', `PIN_MANIFESTS=${FP}`, ...logLines, ''].join('\n'));
  return { root, log, repo, camp };
}

function precheck(f: Fixture): { rc: number | null; out: string } {
  const changed = join(f.root, 'changed.txt');
  writeFileSync(changed, 'README.md\n');
  const r = spawnSync('bash', [PRECHECK, f.log, f.repo, f.camp, '--changed-paths-file', changed], { encoding: 'utf8' });
  return { rc: r.status, out: `${r.stdout}${r.stderr}` };
}

test('zero manifests: log COUNT=0 and campaign holds none -> named OK, rc 0', () => {
  const f = fixture(['PIN_MANIFEST_COUNT=0'], []);
  try {
    const r = precheck(f);
    assert.equal(r.rc, 0, r.out);
    assert.match(r.out, /^PIN_PRECHECK_OK: zero manifests \(gate log and campaign both report 0\)$/m);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('zero manifests: a log with NO count line still refuses (kills: treating absence as zero)', () => {
  const f = fixture([], []);
  try {
    const r = precheck(f);
    assert.equal(r.rc, 2, r.out);
    assert.match(r.out, /PIN_PRECHECK_REFUSED: .*carries no per-manifest PIN_MANIFEST lines/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('zero manifests: COUNT=0 but a manifest appeared since the gate -> distinct named refusal (kills: trusting the log alone)', () => {
  const f = fixture(['PIN_MANIFEST_COUNT=0'], ['LATE']);
  try {
    const r = precheck(f);
    assert.equal(r.rc, 2, r.out);
    assert.match(r.out, /PIN_PRECHECK_REFUSED: .*PIN_MANIFEST_COUNT=0.*1 manifest/);
    assert.doesNotMatch(r.out, /carries no per-manifest PIN_MANIFEST lines/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('zero manifests: COUNT=2 with one PIN_MANIFEST line is a truncated log -> named refusal (kills: accepting any non-empty subset)', () => {
  const f = fixture(['PIN_MANIFEST_COUNT=2', `PIN_MANIFEST A=${FP}`], ['A', 'B']);
  try {
    const r = precheck(f);
    assert.equal(r.rc, 2, r.out);
    assert.match(r.out, /PIN_PRECHECK_REFUSED: .*PIN_MANIFEST_COUNT=2 but carries only 1 .*truncated/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('zero manifests: COUNT=3 with zero PIN_MANIFEST lines is truncated, not zero (kills: reading count>0 and no lines as zero)', () => {
  const f = fixture(['PIN_MANIFEST_COUNT=3'], []);
  try {
    const r = precheck(f);
    assert.equal(r.rc, 2, r.out);
    assert.match(r.out, /PIN_PRECHECK_REFUSED: .*truncated/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

function gatePinsOut(manifests: string[]): string {
  const f = fixture([], manifests);
  try {
    const script = `CAMP="$1"; R="$2"; EXPECTED_PIN_FAILS=""; fail=0; refused=0; gate_main=""; source "$3"`;
    const r = spawnSync('bash', ['-c', script, 'x', f.camp, f.repo, GATE_PINS], { encoding: 'utf8' });
    return `${r.stdout}${r.stderr}`;
  } finally { rmSync(f.root, { recursive: true, force: true }); }
}

test('gate-pins.sh states PIN_MANIFEST_COUNT=0 for an empty gate-manifests dir (kills: omitting the line when n=0)', () => {
  assert.match(gatePinsOut([]), /^PIN_MANIFEST_COUNT=0$/m);
});

test('gate-pins.sh states PIN_MANIFEST_COUNT=2 and keeps the per-manifest lines for n>0', () => {
  const out = gatePinsOut(['A', 'B']);
  assert.match(out, /^PIN_MANIFEST_COUNT=2$/m);
  assert.match(out, /^PIN_MANIFEST A=[0-9a-f]{16}$/m);
  assert.match(out, /^PIN_MANIFEST B=[0-9a-f]{16}$/m);
});
