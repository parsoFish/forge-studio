/**
 * `pin-reconcile.sh` must refuse a tree that is not AT the `<to-sha>`
 * (bead `forge-8vfn.6.9.2`, T1 ruling 258).
 *
 * §15.169 says to reconcile only from a tree asserted at the to-sha, and it
 * fired on its own author in M5-A: a confident `0 → 0` produced from the
 * MERGE'S PARENT for a merge that changed five pinned files. The rehash reads
 * `sha256sum` of the working tree, so a tree one commit behind hashes the OLD
 * bytes — and prints a clean verdict for a pin it has just made wrong. Same
 * shape as everything else this milestone has paid for: the check ran, and
 * answered about the wrong thing.
 *
 * A rule that lives only in prose is decoration. This puts it in the script.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RECONCILE = join(
  import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts', 'pin-reconcile.sh',
);

const git = (repo: string, ...args: string[]) =>
  spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });

/** A repo with two commits, and a manifest pinning `pinned.txt` at commit 1's bytes. */
function plant() {
  const root = mkdtempSync(join(tmpdir(), 'pin-head-'));
  const repo = join(root, 'repo');
  const g = join(root, 'camp', 'gate-manifests');
  mkdirSync(repo, { recursive: true });
  mkdirSync(g, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 't@t');
  git(repo, 'config', 'user.name', 'T');
  writeFileSync(join(repo, 'pinned.txt'), 'one\n', 'utf8');
  git(repo, 'add', 'pinned.txt');
  git(repo, 'commit', '-qm', 'one');
  const first = git(repo, 'rev-parse', 'HEAD').stdout.trim();
  // Hash commit ONE's bytes HERE, while they are still on disk. Taking it after
  // the second commit pinned the NEW hash, so `sha256sum -c` read 0 FAILED and
  // the positive control asserted nothing — the same shape as the pin that let
  // seven files drift, reproduced in this file's own first draft.
  const h1 = spawnSync('sha256sum', ['pinned.txt'], { cwd: repo, encoding: 'utf8' }).stdout.split(' ')[0];
  writeFileSync(join(g, 'M5-B.sha256'), `${h1}  pinned.txt\n`, 'utf8');
  writeFileSync(join(repo, 'pinned.txt'), 'two\n', 'utf8');
  git(repo, 'add', 'pinned.txt');
  git(repo, 'commit', '-qm', 'two');
  const second = git(repo, 'rev-parse', 'HEAD').stdout.trim();
  return { root, repo, camp: join(root, 'camp'), g, first, second };
}

function reconcile(repo: string, camp: string, from: string, to: string) {
  const r = spawnSync('bash', [RECONCILE, repo, camp, 'M5-B', from, to, 'a label'], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

test('AT-6.9.2-1 (RED) a tree ONE COMMIT BEHIND the to-sha is refused, and both SHAs are named', () => {
  const { root, repo, camp, g, first, second } = plant();
  try {
    // The exact §15.169 shape: reconcile "to" the merge while standing on its parent.
    git(repo, 'checkout', '-q', first);
    const before = readFileSync(join(g, 'M5-B.sha256'), 'utf8');

    const { code, out } = reconcile(repo, camp, first, second);

    assert.notEqual(code, 0, `it must refuse, not reconcile. Output: ${out}`);
    assert.match(out, new RegExp(first.slice(0, 8)), `the tree's actual HEAD must be named. Output: ${out}`);
    assert.match(out, new RegExp(second.slice(0, 8)), `and the to-sha it was asked for. Output: ${out}`);
    assert.equal(
      readFileSync(join(g, 'M5-B.sha256'), 'utf8'),
      before,
      'a refused run must not have touched the manifest',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('AT-6.9.2-2 (positive control) a tree AT the to-sha reconciles as before', () => {
  const { root, repo, camp, g, first, second } = plant();
  try {
    // Standing on the to-sha, `pinned.txt` reads "two" while the manifest pins
    // "one" — exactly the stale entry a merge leaves, and the one this script
    // exists to rehash.
    const { code, out } = reconcile(repo, camp, first, second);
    assert.equal(code, 0, `Output: ${out}`);
    assert.match(out, /FAILED 1 → 0/, `it must rehash the touched entry and say so. Output: ${out}`);
    const h2 = spawnSync('sha256sum', ['pinned.txt'], { cwd: repo, encoding: 'utf8' }).stdout.split(' ')[0];
    assert.match(readFileSync(join(g, 'M5-B.sha256'), 'utf8'), new RegExp(h2), 'the new hash landed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('AT-6.9.2-3 the to-sha may be given SHORT — a prefix of the real HEAD is the same commit', () => {
  const { root, repo, camp, first, second } = plant();
  try {
    const { code, out } = reconcile(repo, camp, first, second.slice(0, 8));
    assert.equal(code, 0, `a short to-sha naming this very commit must not be refused. Output: ${out}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// T1 ruling 707 — a rehash that does not advance `head=` leaves the manifest
// describing a tree it does not describe.
//
// MEASURED: C's precheck named `agent-dispatch-containment.test.ts` as C's drift
// because `M6-D.counts` still read `head=c1a751ea` while `M6-D.sha256` pinned
// main's current bytes. Every lane's skew test reads that field, so a stale one
// turns one lane's correct re-pin into another lane's phantom drift.
//
// §15.400 — what else could make these pass? Writing `head=` unconditionally
// would satisfy the first two and quietly break the third and fourth, so the
// untouched-manifest and still-FAILED cases are asserted, not assumed.
// ---------------------------------------------------------------------------

test('707: a rehashed manifest gains head=<to> in its .counts, created when absent', () => {
  const { root, repo, camp, g, first, second } = plant();
  try {
    // no .counts at all — the state four of M6-D's story manifests were in
    const r = reconcile(repo, camp, first, second);
    assert.equal(r.code, 0, r.out);
    const counts = readFileSync(join(g, 'M5-B.counts'), 'utf8');
    assert.match(counts, new RegExp(`head=${second.slice(0, 8)}`), `counts should name the to-sha — got ${counts}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('707: an EXISTING head= is advanced, not duplicated', () => {
  const { root, repo, camp, g, first, second } = plant();
  try {
    writeFileSync(join(g, 'M5-B.counts'), 'paths=1 head=deadbeef tree=/somewhere\n', 'utf8');
    const r = reconcile(repo, camp, first, second);
    assert.equal(r.code, 0, r.out);
    const counts = readFileSync(join(g, 'M5-B.counts'), 'utf8');
    assert.match(counts, new RegExp(`head=${second.slice(0, 8)}`));
    assert.equal(/deadbeef/.test(counts), false, 'the stale sha must be gone, not accompanied');
    assert.equal((counts.match(/head=/g) ?? []).length, 1, 'exactly one head= field, never two to disagree');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('707: a manifest the run did NOT rehash is left alone', () => {
  const { root, repo, camp, g, first, second } = plant();
  try {
    // M5-C pins a file the merge never touched, so the loop skips it entirely.
    writeFileSync(join(g, 'M5-C.sha256'), `${'0'.repeat(64)}  untouched.txt\n`, 'utf8');
    writeFileSync(join(g, 'M5-C.counts'), 'paths=1 head=deadbeef tree=/somewhere\n', 'utf8');
    const r = spawnSync('bash', [RECONCILE, repo, camp, 'M5-*', first, second, 'a label'], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.equal(
      readFileSync(join(g, 'M5-C.counts'), 'utf8'),
      'paths=1 head=deadbeef tree=/somewhere\n',
      'a manifest this run did not rehash must not have its head= advanced — that would claim a ' +
        'verification the run never performed',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('707: a manifest still FAILED after the rehash does NOT get a head naming this tree', () => {
  const { root, repo, camp, g, first, second } = plant();
  try {
    // Pin a second path the merge DELETES: the script leaves that entry in
    // place (the gate reads it as missing, which is honest), so the manifest is
    // still non-zero after the rehash.
    writeFileSync(join(repo, 'doomed.txt'), 'x\n', 'utf8');
    const gone = spawnSync('sha256sum', ['doomed.txt'], { cwd: repo, encoding: 'utf8' }).stdout.split(' ')[0];
    writeFileSync(join(g, 'M5-B.sha256'), `${readFileSync(join(g, 'M5-B.sha256'), 'utf8').trim()}\n${gone}  doomed.txt\n`, 'utf8');
    git(repo, 'add', 'doomed.txt');
    git(repo, 'commit', '-qm', 'add doomed');
    const withDoomed = git(repo, 'rev-parse', 'HEAD').stdout.trim();
    rmSync(join(repo, 'doomed.txt'));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'delete doomed');
    const afterDelete = git(repo, 'rev-parse', 'HEAD').stdout.trim();

    const r = reconcile(repo, camp, withDoomed, afterDelete);
    assert.equal(r.code, 0, r.out);
    const counts = readFileSync(join(g, 'M5-B.counts'), 'utf8');
    assert.equal(
      new RegExp(`head=${afterDelete.slice(0, 8)}`).test(counts),
      false,
      'head= records a tree the manifest VERIFIED against; naming one it still fails is the ' +
        'stale-head defect pointing the other way',
    );
    assert.match(counts, /still FAILED|not verified/i, 'and the .counts must say why it was not advanced');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
