/**
 * fence-containment-unverified.test.ts — ROW 102b finding 15 (M7-COMMON
 * §6.15, T1 1512): a sibling worktree `git worktree list` REGISTERS, still
 * present, whose OWN `git status` could not just be read must never
 * disappear from `snapshotSiblingWorktrees`'s map the way a genuinely
 * PRUNED sibling (its directory actually gone) correctly does — the fence
 * would then print clean over a tree it never actually checked.
 *
 * SPLIT OUT of `fence-containment.test.ts` at the 800-line cap (SPLIT, NEVER
 * BASELINE — T1 ruling 492): that file's "two blind spots" (308, 309(b)) is a
 * closed pair; this is a third, later finding against the same
 * `snapshotSiblingWorktrees`/`siblingWorktreeEscapes` pair, so it gets its own
 * file rather than growing that one past the ceiling.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { siblingWorktreeEscapes, snapshotSiblingWorktrees } from './sweep.mjs';

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'fence-wt-unverified-'));
  const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  writeFileSync(join(dir, 'README.md'), '# r\n');
  git('add', 'README.md');
  git('commit', '-qm', 'init');
  return dir;
}

test('ROW 102b (RED) finding 15: a sibling whose CURRENT status could not be read is reported UNVERIFIED, never omitted', () => {
  const main = makeRepo();
  const sibling = join(mkdtempSync(join(tmpdir(), 'fence-wt-unverified-')), 'lane');
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'lane', sibling], { cwd: main, stdio: 'pipe' });

  const baseline = snapshotSiblingWorktrees(sibling);
  assert.ok(baseline.has(main), 'sanity: the main tree is a tracked sibling before it is corrupted');

  // Corrupt the MAIN tree's index so `git status` fails INSIDE it — measured:
  // `git worktree list --porcelain` (read from `sibling`, needs only the
  // admin files under `.git/worktrees/`) still enumerates `main` fine after
  // this; only `git status` in `main` itself fails ("index file smaller than
  // expected", rc 128) — a real git error, not the directory being gone.
  const indexFile = join(main, '.git', 'index');
  const goodIndex = readFileSync(indexFile);
  writeFileSync(indexFile, 'not a real index\n');
  try {
    const after = snapshotSiblingWorktrees(sibling);
    assert.ok(after.has(main), 'the sibling must still be present in the map, never dropped like a pruned one');

    const escapes = siblingWorktreeEscapes(sibling, baseline);
    const mine = escapes.find((e) => e.root === main);
    assert.ok(mine, `expected an UNVERIFIED escape entry for ${main}, got: ${JSON.stringify(escapes)}`);
    assert.equal(mine.unverified, true);
    assert.equal(mine.live, null, 'unverified must never read as "somebody else is working there"');
  } finally {
    writeFileSync(indexFile, goodIndex);
  }
});

test('control: a sibling worktree that was genuinely PRUNED (its directory removed) is still silently skipped, as before', () => {
  const main = makeRepo();
  const sibling = join(mkdtempSync(join(tmpdir(), 'fence-wt-unverified-')), 'lane');
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'lane', sibling], { cwd: main, stdio: 'pipe' });
  const doomed = join(mkdtempSync(join(tmpdir(), 'fence-wt-unverified-')), 'doomed');
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'doomed', doomed], { cwd: main, stdio: 'pipe' });

  const baseline = snapshotSiblingWorktrees(sibling);
  assert.ok(baseline.has(doomed));
  rmSync(doomed, { recursive: true, force: true }); // pruned without `git worktree remove` — the dir is just gone

  const after = snapshotSiblingWorktrees(sibling);
  assert.equal(after.has(doomed), false, 'a genuinely gone worktree directory is not reported as unverified — it is not this run\'s finding');
});
