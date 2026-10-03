/**
 * Pins `decideForgeRepoGit` (forge-repo-git-fence.ts) against the 2026-10-03
 * incident transcript (bead forge-8vfn.8.5.44, row 208) — see that module's
 * header for the full ruling this enforces, and for WHY identity (not a path
 * prefix) decides whether a target is "the forge repo".
 *
 * `repoOf` is FAKED here — a plain lookup table from directory string to an
 * opaque identity string — so these tests pin the DECISION, never the real
 * filesystem walk (that is `packages/agents/studio/repo-identity.test.ts`,
 * against real temp repos). Two directories sharing the SAME fake identity
 * stands in for "the same repository" (a worktree pair); two different
 * identities stands in for genuinely different repositories.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decideForgeRepoGit, type ForgeRepoGitFenceInput } from './forge-repo-git-fence.ts';

const forgeRoot = '/home/parso/forge-m7-e-docs';
const workdir = '/home/parso/forge-m7-e-docs/projects/story-s1';
const FORGE_ID = 'forge-repo-identity';
const PROJECT_ID = 'project-repo-identity';

/** Builds a `repoOf` fake from an exact-path lookup table; any directory not
 *  named resolves to `null` (not inside any known repo — conservative). */
function repoOf(table: Record<string, string>): (dir: string) => string | null {
  return (dir) => table[dir] ?? null;
}

const baseTable = { [forgeRoot]: FORGE_ID, [workdir]: PROJECT_ID };

/** Every fixture below shares this `forgeRepoId`/`repoOf` pair unless a test
 *  overrides one to pin a DIFFERENT fact (ambiguity, cross-worktree identity). */
function decide(fields: Omit<ForgeRepoGitFenceInput, 'forgeRepoId' | 'repoOf'>, table: Record<string, string> = baseTable) {
  return decideForgeRepoGit({ ...fields, forgeRepoId: table[fields.forgeRoot] ?? null, repoOf: repoOf(table) });
}

/** The command each incident event log line actually ran (verbatim), paired
 *  with the `cwd` the agent's Bash tool call started from. */
const SEQ_46 = {
  cwd: workdir,
  command:
    'git add .gitignore CLAUDE.md roadmap.md scripts/gates/local.sh .forge/project.json && ' +
    'git commit -m "chore: onboard story-s1 to forge↔project contract (forge-8vfn.8.5.44)"',
};
const SEQ_47 = {
  cwd: workdir,
  command:
    'cd /home/parso/forge-m7-e-docs && git add brain/projects/story-s1/profile.md && ' +
    'git commit -m "chore(brain): flesh out story-s1 Brain 3 profile (forge-8vfn.8.5.44)"',
};
const SEQ_50 = {
  cwd: workdir,
  command:
    'cd /home/parso/forge-m7-e-docs && git branch forge-brain-story-s1-onboard 8be024930 && ' +
    'git checkout main && git merge --ff-only forge-brain-story-s1-onboard && ' +
    'git branch -d forge-brain-story-s1-onboard',
};
const SEQ_52 = {
  cwd: workdir,
  command:
    'cd /home/parso/forge-m7-e-docs && git update-ref refs/heads/main 8be024930 && ' +
    'git branch -d forge-brain-story-s1-onboard && git log --oneline main -3',
};

describe('decideForgeRepoGit — the 2026-10-03 incident transcript', () => {
  it('seq 46 — git add + commit inside the PROJECT\'s own (different-identity) repo: ALLOWED', () => {
    const d = decide({ ...SEQ_46, forgeRoot });
    assert.equal(d.allow, true, 'reason' in d ? d.reason : undefined);
  });

  it('seq 47 — cd to the forge root, then commit a forge-repo file: DENIED', () => {
    const d = decide({ ...SEQ_47, forgeRoot });
    assert.equal(d.allow, false);
    if (!d.allow) assert.match(d.reason, /git commit/);
  });

  it('seq 50 — branch/checkout/merge/branch -d at the forge root: DENIED on the first mutating verb', () => {
    const d = decide({ ...SEQ_50, forgeRoot });
    assert.equal(d.allow, false);
    if (!d.allow) assert.match(d.reason, /git branch/);
  });

  it('seq 52 — update-ref straight at refs/heads/main: DENIED', () => {
    const d = decide({ ...SEQ_52, forgeRoot });
    assert.equal(d.allow, false);
    if (!d.allow) assert.match(d.reason, /git update-ref/);
  });
});

describe('decideForgeRepoGit — REPO IDENTITY, not a path prefix (row 208 follow-up)', () => {
  const MAIN_CHECKOUT = '/home/parso/forge';
  const SIBLING_WORKTREE = '/home/parso/forge-m7-e-205';
  // The main checkout and a sibling worktree are LEXICALLY outside
  // `forgeRoot` (neither starts with it as a path prefix) but share the SAME
  // repo identity — the exact shape a prefix check misses.
  const sharedIdTable = { ...baseTable, [MAIN_CHECKOUT]: FORGE_ID, [SIBLING_WORKTREE]: FORGE_ID };

  it('`cd /home/parso/forge && git update-ref refs/heads/main <sha>` — the main checkout, outside forgeRoot lexically, SAME repo: DENIED', () => {
    const d = decide(
      { cwd: workdir, forgeRoot, command: `cd ${MAIN_CHECKOUT} && git update-ref refs/heads/main 8be024930` },
      sharedIdTable,
    );
    assert.equal(d.allow, false);
    if (!d.allow) assert.match(d.reason, /git update-ref/);
  });

  it('`git -C /home/parso/forge-m7-e-205 commit -m x` — a SIBLING worktree, SAME repo: DENIED', () => {
    const d = decide(
      { cwd: workdir, forgeRoot, command: `git -C ${SIBLING_WORKTREE} commit -m x` },
      sharedIdTable,
    );
    assert.equal(d.allow, false);
    if (!d.allow) assert.match(d.reason, /git commit/);
  });

  it('a genuinely different repo OUTSIDE forgeRoot (no shared identity) stays ALLOWED', () => {
    const OTHER_REPO = '/home/parso/some-other-checkout';
    const d = decide(
      { cwd: workdir, forgeRoot, command: `git -C ${OTHER_REPO} commit -m x` },
      { ...baseTable, [OTHER_REPO]: 'some-other-repo-identity' },
    );
    assert.equal(d.allow, true);
  });
});

describe('decideForgeRepoGit — relative escapes from the workdir', () => {
  it('`cd ../.. && git commit` walks up out of the nested repo into the forge root: DENIED', () => {
    const d = decide({ cwd: workdir, forgeRoot, command: 'cd ../.. && git commit -m x' });
    assert.equal(d.allow, false);
    if (!d.allow) assert.match(d.reason, /git commit/);
  });

  it('`git -C ../.. update-ref` resolves -C relative to the workdir: DENIED', () => {
    const d = decide({ cwd: workdir, forgeRoot, command: 'git -C ../.. update-ref refs/heads/main abc' });
    assert.equal(d.allow, false);
    if (!d.allow) assert.match(d.reason, /git update-ref/);
  });
});

describe('decideForgeRepoGit — read-only git in the forge root is never refused', () => {
  it('`cd <forgeRoot> && git log --oneline -3`: ALLOWED', () => {
    const d = decide({ cwd: workdir, forgeRoot, command: `cd ${forgeRoot} && git log --oneline -3` });
    assert.equal(d.allow, true);
  });

  it('`git status` run with cwd already at the forge root: ALLOWED', () => {
    const d = decide({ cwd: forgeRoot, forgeRoot, command: 'git status' });
    assert.equal(d.allow, true);
  });

  it('`git branch` with no args (a listing, not a create) at the forge root: ALLOWED', () => {
    const d = decide({ cwd: forgeRoot, forgeRoot, command: 'git branch' });
    assert.equal(d.allow, true);
  });
});

describe('decideForgeRepoGit — scope: this fence is about REF mutation, not every git write', () => {
  it('a bare `git add` at the forge root does not move a ref — not this fence\'s concern: ALLOWED', () => {
    const d = decide({ cwd: forgeRoot, forgeRoot, command: 'git add some-file.txt' });
    assert.equal(d.allow, true);
  });
});

describe('decideForgeRepoGit — conservative on ambiguity', () => {
  it('an unresolvable `cd` target (a shell expansion) makes a later mutating git call DENIED', () => {
    const d = decide({ cwd: workdir, forgeRoot, command: 'cd "$SOME_DIR" && git commit -m x' });
    assert.equal(d.allow, false);
  });

  it('a GIT_DIR= env override pointed at the forge repo is DENIED for a mutating verb', () => {
    const d = decide({ cwd: workdir, forgeRoot, command: `GIT_DIR=${forgeRoot}/.git git commit -m x` });
    assert.equal(d.allow, false);
  });

  it('command substitution hiding a git call is DENIED outright (not reasoned about)', () => {
    const d = decide({ cwd: workdir, forgeRoot, command: `echo $(cd ${forgeRoot} && git commit -m x)` });
    assert.equal(d.allow, false);
  });

  it('`git push` at the forge root is DENIED unconditionally (no safe form)', () => {
    const d = decide({ cwd: forgeRoot, forgeRoot, command: 'git push origin main' });
    assert.equal(d.allow, false);
  });

  it('`git --work-tree=<forgeRoot> commit` is DENIED — the CLI flag form, not just GIT_DIR=', () => {
    const d = decide({ cwd: workdir, forgeRoot, command: `git --work-tree=${forgeRoot} --git-dir=${forgeRoot}/.git commit -m x` });
    assert.equal(d.allow, false);
  });

  it('forgeRepoId itself unresolvable (null) denies a mutating verb even against a KNOWN different identity', () => {
    const d = decideForgeRepoGit({
      cwd: workdir,
      forgeRoot,
      command: 'git commit -m x',
      forgeRepoId: null,
      repoOf: repoOf({ ...baseTable, [workdir]: 'some-identity' }),
    });
    assert.equal(d.allow, false);
  });

  it('the target directory resolves to NO repo at all (repoOf → null): DENIED, never read as "safe, not the forge repo"', () => {
    const d = decide({ cwd: forgeRoot, forgeRoot, command: 'git commit -m x' }, { [forgeRoot]: FORGE_ID });
    assert.equal(d.allow, false);
  });
});

describe('decideForgeRepoGit — wrapped, subshell and indirect forms (row 208 follow-up)', () => {
  const cases: Array<[string, string]> = [
    ['parenthesised subshell', `(cd ${forgeRoot} && git commit -m x)`],
    ['brace group', `{ cd ${forgeRoot}; git commit -m x; }`],
    ['sh -c', `sh -c 'cd ${forgeRoot} && git commit -m x'`],
    ['bash -c', `bash -c "cd ${forgeRoot} && git commit -m x"`],
    ['eval', `eval "cd ${forgeRoot} && git commit -m x"`],
    ['env NAME=value prefix', `env FOO=bar git -C ${forgeRoot} commit -m x`],
    ['xargs', `xargs -I{} git -C ${forgeRoot} commit -m x`],
    ['command builtin', `command git -C ${forgeRoot} commit -m x`],
    ['exec', `exec git -C ${forgeRoot} commit -m x`],
    ['nice', `nice git -C ${forgeRoot} commit -m x`],
    ['timeout', `timeout 5 git -C ${forgeRoot} commit -m x`],
  ];
  for (const [label, command] of cases) {
    it(`${label}: DENIED conservatively (git invocation not provably at the head of a simple command)`, () => {
      const d = decide({ cwd: workdir, forgeRoot, command });
      assert.equal(d.allow, false, `expected DENY for: ${command}`);
    });
  }

  it('a wrapped form with NO mutating verb is unaffected (still passes through to ordinary read-only handling)', () => {
    const d = decide({ cwd: workdir, forgeRoot, command: `sh -c 'cd ${forgeRoot} && git status'` });
    assert.equal(d.allow, true);
  });

  it('grouping chars with no `git` anywhere are not this fence\'s concern: ALLOWED', () => {
    const d = decide({ cwd: workdir, forgeRoot, command: '(echo hello)' });
    assert.equal(d.allow, true);
  });

  it('a bare path CONTAINING "-git-" as a hyphen-delimited substring is NOT mistaken for a nested `git` word', () => {
    // Regression: `\bgit\b` against an UNQUOTED word matches inside
    // "/tmp/forge-repo-git-fence-wiring-XXXX" (hyphens are non-word chars,
    // so "git" there sits at a real regex word boundary) even though this
    // is an ordinary cd target with no nested invocation at all.
    const projectWithGitInName = `${workdir}/my-git-tool`;
    const d = decide({
      cwd: workdir,
      forgeRoot,
      command: `cd ${projectWithGitInName} && git commit -m x`,
    }, { ...baseTable, [projectWithGitInName]: PROJECT_ID });
    assert.equal(d.allow, true);
  });
});
