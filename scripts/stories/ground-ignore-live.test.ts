/**
 * The ground-ignore classification, composed against a REAL git ground —
 * `forge-8vfn.7.6.52`, A's ruling 797, T1 873, C's 612 ack.
 *
 * WHAT WAS ACTUALLY UNPROVEN. `classifyOwnGroundDrift` has doors and
 * `groundIgnoreFromGit` has doors, but they are never COMPOSED. Every
 * classification door passes a STUB — `isIgnored: (p) => p.startsWith('.venv/')`,
 * `isIgnored: () => true`, `isIgnored: () => false` — so the git-backed
 * classifier has never once produced a non-zero ignored count through the code
 * that consumes it. S1 run 9 printed `IGNORED-BY-GROUND 0 path(s)`: a TRUE zero
 * over an EMPTY case, because that run's demo builder happened not to invoke
 * pytest. Whether an agent runs a toolchain is the agent's choice, so buying
 * costed runs to reach the non-empty case is a coin flip.
 *
 * This file removes the coin flip. Every case below builds a real git
 * repository, sets real `.gitignore` rules, and calls the REAL
 * `groundIgnoreFromGit` — no stub anywhere.
 *
 * THE TWO BUCKETS MUST NOT BE CONFUSABLE, which is §15.435's containment hole
 * and the reason the deleted-tracked case is here. `git check-ignore` answers
 * about a PATH, not about a file's existence, and the only thing keeping a
 * DELETED TRACKED file out of the ignored bucket is that it is still in the
 * INDEX. Get that wrong and a run that destroyed a ground's real file reports
 * it as the ground's own toolchain noise and stays green — a containment
 * failure downgraded to a comment.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { groundIgnoreFromGit, classifyOwnGroundDrift } from './ground-hash.mjs';

/** A real git ground: real `.gitignore`, real index, real tracked files. */
function makeGround(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ground-ignore-live-'));
  const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 'door@example.invalid');
  git('config', 'user.name', 'door');
  writeFileSync(join(dir, '.gitignore'), '.venv/\n__pycache__/\n*.pyc\ndist/\n');
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'keep.py'), 'print("real source")\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'ground');
  return dir;
}

/** `classifyOwnGroundDrift`'s 2nd/3rd args: nothing minted, nobody wrote. */
const NOTHING_MINTED: string[] = [];
const NO_WRITES = new Map<string, string[]>();

describe('7.6.52 — the ground-ignore classification against a REAL git ground', () => {
  test('ignored-born paths land in the IGNORED bucket, with the rule source named', () => {
    const dir = makeGround();
    try {
      const ignore = groundIgnoreFromGit(dir);
      // The toolchain output a real run produces: born during the run, matching
      // the ground's OWN rules, attributable to nobody.
      const changes = {
        added: ['.venv/pyvenv.cfg', '__pycache__/mod.cpython-311.pyc', 'src/app.pyc', 'dist/wheel.whl'],
        removed: [],
        modified: [],
      };
      const r = classifyOwnGroundDrift(changes, NOTHING_MINTED, NO_WRITES, ignore);

      assert.equal(r.ignored.length, 4, `all four are the ground's own toolchain:\n${JSON.stringify(r, null, 2)}`);
      assert.equal(r.undeclared.length, 0, 'and none of them is a containment failure');
      // The count is worthless without the rule that produced it: `0 ignored`
      // and "no ignore check ran" must never render the same line (forge-e8dn).
      assert.match(String(r.ignoreSource), /\.gitignore/, `the source names the real rule file, got ${r.ignoreSource}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('§15.435: a DELETED TRACKED file is UNDECLARED — never downgraded to ignored', () => {
    const dir = makeGround();
    try {
      // THE FILE MUST MATCH AN IGNORE RULE, or this door proves nothing. The
      // first draft deleted `src/keep.py`, which matches NO rule in the
      // `.gitignore` above — so it would read un-ignored whether or not the
      // index was consulted, and the test would have passed against a
      // classifier with the hole still in it. The genuine §15.435 case is a
      // file that is tracked AND rule-matching at once: only index membership
      // keeps it out of the ignored bucket.
      const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
      mkdirSync(join(dir, 'dist'), { recursive: true });
      writeFileSync(join(dir, 'dist', 'real-artifact.txt'), 'tracked despite matching dist/\n');
      git('add', '-f', 'dist/real-artifact.txt');
      git('commit', '-q', '-m', 'a tracked file under an ignored directory');

      const ignore = groundIgnoreFromGit(dir);
      // Destroyed by the run. Still in the index, so still not ignorable.
      rmSync(join(dir, 'dist', 'real-artifact.txt'));
      const changes = { added: ['.venv/pyvenv.cfg'], removed: ['dist/real-artifact.txt'], modified: [] };
      const r = classifyOwnGroundDrift(changes, NOTHING_MINTED, NO_WRITES, ignore);

      assert.equal(r.undeclared.length, 1, `exactly one containment failure:\n${JSON.stringify(r, null, 2)}`);
      assert.match(r.undeclared[0] as string, /dist\/real-artifact\.txt/,
        `a destroyed tracked file is a containment failure:\n${JSON.stringify(r, null, 2)}`);
      assert.equal(r.ignored.length, 1, 'and the toolchain file beside it is still correctly ignored');
      assert.match(r.ignored[0] as string, /\.venv/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a path that merely LOOKS ignorable is not ignored while it is tracked', () => {
    // The discriminator, stated as its own case. If `groundIgnoreFromGit` ever
    // stops consulting the index, this is the door that reds — and it is the one
    // that matters, because the failure direction is silent: a real file lost
    // from a ground, reported as noise.
    const dir = makeGround();
    try {
      const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
      // Track a file whose own path matches an ignore rule. Git honours the
      // index over `.gitignore`, so this is tracked AND rule-matching at once.
      mkdirSync(join(dir, 'dist'), { recursive: true });
      writeFileSync(join(dir, 'dist', 'checked-in.txt'), 'deliberately tracked\n');
      git('add', '-f', 'dist/checked-in.txt');
      git('commit', '-q', '-m', 'track a rule-matching path on purpose');

      const ignore = groundIgnoreFromGit(dir);
      assert.equal(ignore.isIgnored('dist/checked-in.txt'), false,
        'tracked beats .gitignore — a file in the index is never the ground\'s disposable output');
      assert.equal(ignore.isIgnored('dist/never-added.txt'), true,
        'while an untracked sibling under the same rule IS disposable');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
