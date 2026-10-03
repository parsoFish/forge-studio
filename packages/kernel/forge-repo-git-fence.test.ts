/**
 * Pins `decideForgeRepoGit` (forge-repo-git-fence.ts) against the 2026-10-03
 * incident transcript (bead forge-8vfn.8.5.44, row 208) — see that module's
 * header for the full ruling this enforces.
 *
 * Fixtures use the incident's own paths so a reviewer can diff this file
 * against the event log directly: `forgeRoot` is the onboarding agent's own
 * forge root (`/home/parso/forge-m7-e-docs`, a worktree of the operator's
 * main checkout — branch refs are SHARED), `workdir` is the bound project's
 * own nested repo (`<forgeRoot>/projects/story-s1`).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decideForgeRepoGit } from './forge-repo-git-fence.ts';

const forgeRoot = '/home/parso/forge-m7-e-docs';
const workdir = '/home/parso/forge-m7-e-docs/projects/story-s1';

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
  it('seq 46 — git add + commit inside the PROJECT\'s own nested repo: ALLOWED', () => {
    const d = decideForgeRepoGit({ ...SEQ_46, forgeRoot, workdir });
    assert.equal(d.allow, true, 'reason' in d ? d.reason : undefined);
  });

  it('seq 47 — cd to the forge root, then commit a forge-repo file: DENIED', () => {
    const d = decideForgeRepoGit({ ...SEQ_47, forgeRoot, workdir });
    assert.equal(d.allow, false);
    if (!d.allow) assert.match(d.reason, /git commit/);
  });

  it('seq 50 — branch/checkout/merge/branch -d at the forge root: DENIED on the first mutating verb', () => {
    const d = decideForgeRepoGit({ ...SEQ_50, forgeRoot, workdir });
    assert.equal(d.allow, false);
    if (!d.allow) assert.match(d.reason, /git branch/);
  });

  it('seq 52 — update-ref straight at refs/heads/main: DENIED', () => {
    const d = decideForgeRepoGit({ ...SEQ_52, forgeRoot, workdir });
    assert.equal(d.allow, false);
    if (!d.allow) assert.match(d.reason, /git update-ref/);
  });
});

describe('decideForgeRepoGit — relative escapes from the workdir', () => {
  it('`cd ../.. && git commit` walks up out of the nested repo into the forge root: DENIED', () => {
    const d = decideForgeRepoGit({ cwd: workdir, forgeRoot, workdir, command: 'cd ../.. && git commit -m x' });
    assert.equal(d.allow, false);
    if (!d.allow) assert.match(d.reason, /git commit/);
  });

  it('`git -C ../.. update-ref` resolves -C relative to the workdir: DENIED', () => {
    const d = decideForgeRepoGit({
      cwd: workdir,
      forgeRoot,
      workdir,
      command: 'git -C ../.. update-ref refs/heads/main abc',
    });
    assert.equal(d.allow, false);
    if (!d.allow) assert.match(d.reason, /git update-ref/);
  });
});

describe('decideForgeRepoGit — read-only git in the forge root is never refused', () => {
  it('`cd <forgeRoot> && git log --oneline -3`: ALLOWED', () => {
    const d = decideForgeRepoGit({ cwd: workdir, forgeRoot, workdir, command: `cd ${forgeRoot} && git log --oneline -3` });
    assert.equal(d.allow, true);
  });

  it('`git status` run with cwd already at the forge root: ALLOWED', () => {
    const d = decideForgeRepoGit({ cwd: forgeRoot, forgeRoot, workdir, command: 'git status' });
    assert.equal(d.allow, true);
  });

  it('`git branch` with no args (a listing, not a create) at the forge root: ALLOWED', () => {
    const d = decideForgeRepoGit({ cwd: forgeRoot, forgeRoot, workdir, command: 'git branch' });
    assert.equal(d.allow, true);
  });
});

describe('decideForgeRepoGit — scope: this fence is about REF mutation, not every git write', () => {
  it('a bare `git add` at the forge root does not move a ref — not this fence\'s concern: ALLOWED', () => {
    const d = decideForgeRepoGit({ cwd: forgeRoot, forgeRoot, workdir, command: 'git add some-file.txt' });
    assert.equal(d.allow, true);
  });
});

describe('decideForgeRepoGit — conservative on ambiguity', () => {
  it('an unresolvable `cd` target (a shell expansion) makes a later mutating git call DENIED', () => {
    const d = decideForgeRepoGit({ cwd: workdir, forgeRoot, workdir, command: 'cd "$SOME_DIR" && git commit -m x' });
    assert.equal(d.allow, false);
  });

  it('a GIT_DIR= env override pointed at the forge repo is DENIED for a mutating verb', () => {
    const d = decideForgeRepoGit({
      cwd: workdir,
      forgeRoot,
      workdir,
      command: `GIT_DIR=${forgeRoot}/.git git commit -m x`,
    });
    assert.equal(d.allow, false);
  });

  it('command substitution hiding a git call is DENIED outright (not reasoned about)', () => {
    const d = decideForgeRepoGit({
      cwd: workdir,
      forgeRoot,
      workdir,
      command: `echo $(cd ${forgeRoot} && git commit -m x)`,
    });
    assert.equal(d.allow, false);
  });

  it('`git push` at the forge root is DENIED unconditionally (no safe form)', () => {
    const d = decideForgeRepoGit({ cwd: forgeRoot, forgeRoot, workdir, command: 'git push origin main' });
    assert.equal(d.allow, false);
  });

  it('`git --work-tree=<forgeRoot> commit` is DENIED — the CLI flag form, not just GIT_DIR=', () => {
    const d = decideForgeRepoGit({
      cwd: workdir,
      forgeRoot,
      workdir,
      command: `git --work-tree=${forgeRoot} --git-dir=${forgeRoot}/.git commit -m x`,
    });
    assert.equal(d.allow, false);
  });
});
