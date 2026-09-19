/**
 * `pin-reconcile.sh` must be the ONE writer of `tree=`, refusing rather than
 * silently overwriting when two worktrees disagree — bead `forge-8vfn.7.6.141`.
 *
 * `tree=` used to be "REPAIRED" (silently rewritten) whenever `owner=` matched
 * the invoking lane, on the theory that a rewrite from the owner's own rehash
 * is always safe. Measured wrong on `M6-A.counts`: the SAME owner reconciles
 * from two different worktrees in ordinary operation — this script's own
 * invocation from a shared checkout, and the lane's post-merge `§762` stamp
 * from its own `$TREE` — so the "repair" one call performs is exactly the
 * oscillation the next call undoes. Two writers, opposite opinions, no
 * conflict detected — until now: any `tree=` naming a different repo than the
 * one THIS run rehashes refuses, owner included, and the operator moves it by
 * hand with an amendment.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RECONCILE = join(
  import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts', 'pin-reconcile.sh',
);

const git = (repo: string, ...args: string[]) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
const sha256 = (repo: string, file: string) =>
  spawnSync('sha256sum', [file], { cwd: repo, encoding: 'utf8' }).stdout.split(' ')[0];

function reconcile(repo: string, camp: string, from: string, to: string) {
  const r = spawnSync('bash', [RECONCILE, repo, camp, 'M-TEST', from, to, 'a label'], {
    encoding: 'utf8',
    env: { ...process.env, FORGE_LANE: 'M-TEST' },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

test('AT-7.6.141-1 (RED) a second worktree, same owner, different tree=: refused, not overwritten', () => {
  const root = mkdtempSync(join(tmpdir(), 'pin-tree-'));
  const repoA = join(root, 'repoA');
  const g = join(root, 'camp', 'gate-manifests');
  const camp = join(root, 'camp');
  try {
    mkdirSync(repoA, { recursive: true });
    mkdirSync(g, { recursive: true });
    git(repoA, 'init', '-q', '-b', 'main');
    git(repoA, 'config', 'user.email', 't@t');
    git(repoA, 'config', 'user.name', 'T');
    writeFileSync(join(repoA, 'pinned.txt'), 'one\n', 'utf8');
    git(repoA, 'add', 'pinned.txt');
    git(repoA, 'commit', '-qm', 'one');
    const first = git(repoA, 'rev-parse', 'HEAD').stdout.trim();
    const h1 = sha256(repoA, 'pinned.txt');
    writeFileSync(join(g, 'M-TEST.sha256'), `${h1}  pinned.txt\n`, 'utf8');
    // No tree= yet — the first reconcile from repoA is the one that plants it.
    writeFileSync(join(g, 'M-TEST.counts'), `owner=M-TEST\n`, 'utf8');

    const plant = reconcile(repoA, camp, first, first);
    assert.equal(plant.code, 0, `planting tree=repoA must succeed. Output: ${plant.out}`);
    assert.match(readFileSync(join(g, 'M-TEST.counts'), 'utf8'), new RegExp(`tree=${repoA}(\\s|$)`));

    // A SECOND worktree for the SAME lane — the shape of the post-merge §762
    // stamp's own $TREE versus this script's shared-checkout invocation — at
    // the SAME commit, a different path.
    const repoB = join(root, 'repoB');
    cpSync(repoA, repoB, { recursive: true });
    writeFileSync(join(repoA, 'pinned.txt'), 'two\n', 'utf8');
    git(repoA, 'add', 'pinned.txt');
    git(repoA, 'commit', '-qm', 'two');
    const second = git(repoA, 'rev-parse', 'HEAD').stdout.trim();
    // repoB lands the same merge too (a second worktree pulling the same commit).
    rmSync(repoB, { recursive: true, force: true });
    cpSync(repoA, repoB, { recursive: true });

    const beforeSha = readFileSync(join(g, 'M-TEST.sha256'), 'utf8');
    const beforeCounts = readFileSync(join(g, 'M-TEST.counts'), 'utf8');

    const { code, out } = reconcile(repoB, camp, first, second);

    assert.notEqual(code, 0, `a tree= naming a DIFFERENT worktree of the SAME owner must refuse, not repair: ${out}`);
    assert.match(out, new RegExp(repoA.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `must name the tree= it found: ${out}`);
    assert.match(out, new RegExp(repoB.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `must name the tree it refused to write: ${out}`);
    assert.equal(readFileSync(join(g, 'M-TEST.sha256'), 'utf8'), beforeSha, 'the .sha256 must not be overwritten to repoB\'s bytes');
    assert.equal(readFileSync(join(g, 'M-TEST.counts'), 'utf8'), beforeCounts, 'tree= must not oscillate to repoB — this is the silent overwrite the bead closes');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('positive control: the SAME worktree that planted tree= keeps reconciling normally', () => {
  const root = mkdtempSync(join(tmpdir(), 'pin-tree-ctrl-'));
  const repoA = join(root, 'repoA');
  const g = join(root, 'camp', 'gate-manifests');
  const camp = join(root, 'camp');
  try {
    mkdirSync(repoA, { recursive: true });
    mkdirSync(g, { recursive: true });
    git(repoA, 'init', '-q', '-b', 'main');
    git(repoA, 'config', 'user.email', 't@t');
    git(repoA, 'config', 'user.name', 'T');
    writeFileSync(join(repoA, 'pinned.txt'), 'one\n', 'utf8');
    git(repoA, 'add', 'pinned.txt');
    git(repoA, 'commit', '-qm', 'one');
    const first = git(repoA, 'rev-parse', 'HEAD').stdout.trim();
    const h1 = sha256(repoA, 'pinned.txt');
    writeFileSync(join(g, 'M-TEST.sha256'), `${h1}  pinned.txt\n`, 'utf8');
    writeFileSync(join(g, 'M-TEST.counts'), `owner=M-TEST\n`, 'utf8');
    assert.equal(reconcile(repoA, camp, first, first).code, 0);

    writeFileSync(join(repoA, 'pinned.txt'), 'two\n', 'utf8');
    git(repoA, 'add', 'pinned.txt');
    git(repoA, 'commit', '-qm', 'two');
    const second = git(repoA, 'rev-parse', 'HEAD').stdout.trim();

    const { code, out } = reconcile(repoA, camp, first, second);

    assert.equal(code, 0, `the same worktree that already owns tree= must not be refused by this fix: ${out}`);
    assert.match(out, /FAILED 1 → 0/, `Output: ${out}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
