/**
 * owner-census.sh — the door for M7 findings row 33.
 *
 * "The multi-owner census (files listed in >1 gate manifest
 * `<campaign>/gate-manifests/*.txt`) is true only by hand" — the census
 * behind M7-C findings pass3 row 33 (47 files) and the M7 brief row 33
 * ("41 of 559 pinned files have more than one owning manifest") was re-
 * derived by a human reading `*.txt` files each time. This tool derives it
 * mechanically instead.
 *
 * It is a REPORT, not a gate (a file may legitimately have several owners
 * when every owning manifest's gate reads it — SKILL.md's rule; deciding
 * that is not this script's job) — it always exits 0.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(
  import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts', 'owner-census.sh',
);

function campaign() {
  const d = mkdtempSync(join(tmpdir(), 'owner-census-'));
  mkdirSync(join(d, 'gate-manifests'), { recursive: true });
  return d;
}
function manifest(camp: string, name: string, files: string[]) {
  writeFileSync(join(camp, 'gate-manifests', `${name}.txt`), files.join('\n') + '\n');
}
const run = (camp: string, ...extra: string[]) =>
  spawnSync('bash', [SCRIPT, camp, ...extra], { encoding: 'utf8' });

describe('owner-census.sh — every file owned by more than one manifest (M7 row 33)', () => {
  test('a fixture campaign with two overlapping files reports both, exits 0', () => {
    const d = campaign();
    try {
      manifest(d, 'M7-A', ['scripts/ci.yml', 'scripts/only-a.ts']);
      manifest(d, 'M7-B', ['scripts/ci.yml', 'scripts/only-b.ts']);
      manifest(d, 'M7-C', ['scripts/ci.yml', 'scripts/shared-ac.ts']);
      manifest(d, 'M7-D', ['scripts/only-d.ts', 'scripts/shared-ac.ts']);
      const r = run(d);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      // scripts/ci.yml: owned by A, B, C (3 owners)
      assert.match(r.stdout, /scripts\/ci\.yml.*\bM7-A\b/);
      assert.match(r.stdout, /scripts\/ci\.yml.*\bM7-B\b/);
      assert.match(r.stdout, /scripts\/ci\.yml.*\bM7-C\b/);
      // scripts/shared-ac.ts: owned by C, D
      assert.match(r.stdout, /scripts\/shared-ac\.ts.*\bM7-C\b/);
      assert.match(r.stdout, /scripts\/shared-ac\.ts.*\bM7-D\b/);
      // single-owner files must NOT be reported
      assert.doesNotMatch(r.stdout, /scripts\/only-a\.ts/);
      assert.doesNotMatch(r.stdout, /scripts\/only-b\.ts/);
      assert.doesNotMatch(r.stdout, /scripts\/only-d\.ts/);
      assert.match(r.stdout, /MULTI_OWNER_COUNT=2/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('a campaign with no overlap reports MULTI_OWNER_COUNT=0 and exits 0', () => {
    const d = campaign();
    try {
      manifest(d, 'M7-A', ['scripts/only-a.ts']);
      manifest(d, 'M7-B', ['scripts/only-b.ts']);
      const r = run(d);
      assert.equal(r.status, 0);
      assert.match(r.stdout, /MULTI_OWNER_COUNT=0/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('refuses a non-existent campaign dir, non-zero exit', () => {
    const r = run('/nope/not/a/campaign');
    assert.notEqual(r.status, 0);
  });

  test('a campaign with no gate-manifests dir refuses, non-zero exit', () => {
    const d = mkdtempSync(join(tmpdir(), 'owner-census-nogm-'));
    try {
      const r = run(d);
      assert.notEqual(r.status, 0);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('a campaign with an empty gate-manifests dir reports zero and exits 0 (still a report)', () => {
    const d = campaign();
    try {
      const r = run(d);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, /MULTI_OWNER_COUNT=0/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('refuses an unexpected extra argument', () => {
    const d = campaign();
    try {
      const r = run(d, 'extra');
      assert.notEqual(r.status, 0);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});
