/**
 * forge-mfv5.1.33 — after a Save PR is confirmed merged, Save deletes origin's forge-studio, so the
 * next Save's fresh forge-studio can be pushed. gitweave (2026-10-10): Save #1's PR was squash-merged,
 * origin/forge-studio stayed, and every later Save was refused as a non-fast-forward with no Studio
 * path out. A remote forge-studio that is already merged (an ancestor of origin/<base>, or the head of
 * our merged PR) is deleted and recreated; one carrying unmerged commits is still refused by name —
 * forge never force-pushes content. Real local git, a stub gh. No network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { STUDIO_BRANCH } from '../../project-repo-tx.ts';
import { saveProjectRepo } from '../../project-repo-save.ts';
import { PR_URL, fixture, g, ghState, githubMergesPr, hasRef, prRow, sha, stubGh, studioCommit, type Fixture } from '../test-fixtures/save-origin.ts';

const REMOTE = `refs/heads/${STUDIO_BRANCH}`;

/** GitHub squash-merges the forge-studio PR: one new commit on origin/main, forge-studio's commits not in it. */
function githubSquashes(f: Fixture): string {
  const clone = join(f.root, 'gh-squash');
  execFileSync('git', ['clone', '-q', f.origin, clone]);
  g(clone, ['config', 'user.email', 'gh@github.com']);
  g(clone, ['config', 'user.name', 'GitHub']);
  g(clone, ['merge', '-q', '--squash', 'origin/forge-studio']);
  g(clone, ['commit', '-q', '-m', 'forge-studio: apply project configuration (#7)']);
  writeFileSync(join(f.origin, 'ALLOW_MAIN'), '');
  g(clone, ['push', '-q', 'origin', 'main']);
  rmSync(join(f.origin, 'ALLOW_MAIN'));
  return sha(clone, 'HEAD');
}

/** Someone pushes a commit to origin's forge-studio that no PR merged. */
function foreignCommitOnRemote(f: Fixture): string {
  const clone = join(f.root, 'gh-foreign');
  execFileSync('git', ['clone', '-q', '-b', STUDIO_BRANCH, f.origin, clone]);
  g(clone, ['config', 'user.email', 'x@x.dev']);
  g(clone, ['config', 'user.name', 'X']);
  writeFileSync(join(clone, 'theirs.txt'), 'theirs\n');
  g(clone, ['add', 'theirs.txt']);
  g(clone, ['commit', '-q', '-m', 'unmerged work']);
  g(clone, ['push', '-q', 'origin', STUDIO_BRANCH]);
  return sha(clone, 'HEAD');
}

for (const how of ['squash', 'merge-commit'] as const) {
  test(`after a ${how} merge is confirmed, Save deletes origin/forge-studio and the next Save opens a fresh PR`, () => {
    const f = fixture();
    try {
      studioCommit(f.work);
      const gh = ghState();
      assert.equal(saveProjectRepo(f.work, { gh: stubGh(gh) }).prUrl, PR_URL);
      const tip = sha(f.work, STUDIO_BRANCH);
      if (how === 'squash') githubSquashes(f); else githubMergesPr(f);
      gh.open = []; gh.merged = [prRow(PR_URL, { headRefOid: tip })];
      const finished = saveProjectRepo(f.work, { gh: stubGh(gh) });
      assert.equal(finished.merged, true, finished.detail);
      assert.equal(hasRef(f.origin, REMOTE), false, 'origin/forge-studio deleted after the confirmed merge');
      assert.deepEqual(finished.remoteBranch, { action: 'deleted', sha: tip, reason: `PR ${PR_URL} merged` });
      // The next Save: a fresh forge-studio from the new main.
      studioCommit(f.work, 'CONTRIBUTING.md');
      gh.merged = [];
      const next = saveProjectRepo(f.work, { gh: stubGh(gh) });
      assert.equal(next.prUrl, PR_URL, next.detail);
      assert.equal(sha(f.origin, REMOTE), sha(f.work, STUDIO_BRANCH), 'the new forge-studio is on origin');
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
}

/** Another change lands on origin/main after the squash, so origin's tree no longer equals the old forge-studio's. */
function githubCommitsToMain(f: Fixture): void {
  const clone = join(f.root, 'gh-later');
  execFileSync('git', ['clone', '-q', f.origin, clone]);
  g(clone, ['config', 'user.email', 'gh@github.com']);
  g(clone, ['config', 'user.name', 'GitHub']);
  writeFileSync(join(clone, 'LATER.md'), 'later\n');
  g(clone, ['add', 'LATER.md']);
  g(clone, ['commit', '-q', '-m', 'later change']);
  writeFileSync(join(f.origin, 'ALLOW_MAIN'), '');
  g(clone, ['push', '-q', 'origin', 'main']);
  rmSync(join(f.origin, 'ALLOW_MAIN'));
}

for (const later of [true, false]) {
  test(`a squash-merged forge-studio left on origin by a merge outside forge is deleted and recreated (${later ? 'its PR merged' : 'its tree equals main'})`, () => {
    const f = fixture();
    try {
      studioCommit(f.work);
      const gh = ghState();
      saveProjectRepo(f.work, { gh: stubGh(gh) });
      const stale = sha(f.work, STUDIO_BRANCH);
      githubSquashes(f);
      if (later) githubCommitsToMain(f);
      // The operator merged on GitHub and dropped the local branch by hand: forge never saw the merge.
      g(f.work, ['checkout', '-q', 'main']);
      g(f.work, ['branch', '-D', STUDIO_BRANCH]);
      g(f.work, ['pull', '-q', '--ff-only', 'origin', 'main']);
      studioCommit(f.work, 'CONTRIBUTING.md');
      gh.open = []; gh.merged = later ? [prRow(PR_URL, { headRefOid: stale })] : [];
      const r = saveProjectRepo(f.work, { gh: stubGh(gh) });
      assert.equal(r.pushed, true, r.detail);
      assert.equal(r.prUrl, PR_URL);
      assert.equal(sha(f.origin, REMOTE), sha(f.work, STUDIO_BRANCH));
      assert.deepEqual(r.remoteBranch, { action: 'recreated', sha: stale, reason: later ? `PR ${PR_URL} merged` : 'its tree equals origin/main' });
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
}

test('a merge-committed forge-studio left on origin (an ancestor of origin/main) is deleted and recreated', () => {
  const f = fixture();
  try {
    studioCommit(f.work);
    const gh = ghState();
    saveProjectRepo(f.work, { gh: stubGh(gh) });
    const stale = sha(f.work, STUDIO_BRANCH);
    githubMergesPr(f);
    // Merged on GitHub with a merge commit; the local branch dropped by hand, local main not yet pulled:
    // the next forge-studio does not contain the old tip, so its push is not a fast-forward.
    g(f.work, ['checkout', '-q', 'main']);
    g(f.work, ['branch', '-D', STUDIO_BRANCH]);
    studioCommit(f.work, 'CONTRIBUTING.md');
    gh.open = []; gh.merged = [];
    const r = saveProjectRepo(f.work, { gh: stubGh(gh) });
    assert.equal(r.pushed, true, r.detail);
    assert.equal(sha(f.origin, REMOTE), sha(f.work, STUDIO_BRANCH));
    assert.deepEqual(r.remoteBranch, { action: 'recreated', sha: stale, reason: 'already in origin/main' });
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('refusal: origin/forge-studio carrying unmerged commits is refused by name and left untouched (never force-pushed)', () => {
  const f = fixture();
  try {
    studioCommit(f.work);
    const gh = ghState();
    saveProjectRepo(f.work, { gh: stubGh(gh) });
    const theirs = foreignCommitOnRemote(f);
    studioCommit(f.work, 'CONTRIBUTING.md');
    const r = saveProjectRepo(f.work, { gh: stubGh(gh) });
    assert.equal(r.pushed, false);
    assert.match(r.detail, /origin has commits this one lacks \(not a fast-forward; forge never force-pushes\)/);
    assert.equal(sha(f.origin, REMOTE), theirs, 'their commit is still on origin');
    assert.equal(r.remoteBranch?.action, 'kept');
    assert.match(r.remoteBranch?.reason ?? "", /not merged/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('refusal: a merged PR whose remote forge-studio has since moved keeps the remote branch, named', () => {
  const f = fixture();
  try {
    studioCommit(f.work);
    const gh = ghState();
    saveProjectRepo(f.work, { gh: stubGh(gh) });
    const tip = sha(f.work, STUDIO_BRANCH);
    githubSquashes(f);
    const theirs = foreignCommitOnRemote(f);
    gh.open = []; gh.merged = [prRow(PR_URL, { headRefOid: tip })];
    const r = saveProjectRepo(f.work, { gh: stubGh(gh) });
    assert.equal(r.merged, true, r.detail);
    assert.equal(sha(f.origin, REMOTE), theirs, 'a moved remote branch is never deleted');
    assert.equal(r.remoteBranch?.action, 'kept');
    assert.match(r.remoteBranch?.reason ?? '', /moved/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('refusal: origin refusing the delete keeps forge-studio, named — the merge still finishes', () => {
  const f = fixture();
  try {
    studioCommit(f.work);
    const gh = ghState();
    saveProjectRepo(f.work, { gh: stubGh(gh) });
    const tip = sha(f.work, STUDIO_BRANCH);
    githubSquashes(f);
    // origin rejects deleting forge-studio (a ruleset, say), on top of the protected main.
    const hook = join(f.origin, 'hooks', 'pre-receive');
    writeFileSync(hook, `#!/bin/sh\nwhile read old new ref; do\n  if [ "$ref" = "${REMOTE}" ] && [ "$new" = "0000000000000000000000000000000000000000" ]; then echo "error: deletion refused" >&2; exit 1; fi\ndone\nexit 0\n`);
    gh.open = []; gh.merged = [prRow(PR_URL, { headRefOid: tip })];
    const r = saveProjectRepo(f.work, { gh: stubGh(gh) });
    assert.equal(r.merged, true, r.detail);
    assert.equal(sha(f.origin, REMOTE), tip);
    assert.equal(r.remoteBranch?.action, 'kept');
    assert.match(r.remoteBranch?.reason ?? '', /delete refused/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('refusal: origin/forge-studio moving while Save judges it is never deleted (the delete is leased to the judged tip)', () => {
  const f = fixture();
  try {
    studioCommit(f.work);
    const gh = ghState();
    saveProjectRepo(f.work, { gh: stubGh(gh) });
    const stale = sha(f.work, STUDIO_BRANCH);
    githubSquashes(f);
    githubCommitsToMain(f);
    g(f.work, ['checkout', '-q', 'main']);
    g(f.work, ['branch', '-D', STUDIO_BRANCH]);
    g(f.work, ['pull', '-q', '--ff-only', 'origin', 'main']);
    studioCommit(f.work, 'CONTRIBUTING.md');
    gh.open = []; gh.merged = [prRow(PR_URL, { headRefOid: stale })];
    // Someone pushes to origin's forge-studio between Save's fetch and its delete (during the merged-PR read).
    // The first merged-PR read is the squash check on the local tip; the second judges the remote tip.
    let theirs = '';
    let mergedReads = 0;
    const inner = stubGh(gh);
    const racing: typeof inner = (args, cwd) => {
      if (args.includes('merged') && ++mergedReads === 2) theirs = foreignCommitOnRemote(f);
      return inner(args, cwd);
    };
    const r = saveProjectRepo(f.work, { gh: racing });
    assert.ok(theirs, 'the race ran');
    assert.equal(r.pushed, false, r.detail);
    assert.equal(sha(f.origin, REMOTE), theirs, 'the moved branch is still on origin');
    assert.equal(r.remoteBranch?.action, 'kept');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
