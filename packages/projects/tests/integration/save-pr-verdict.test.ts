/**
 * forge-mfv5.1.23 — Save owns the merge of its forge-studio PR, and never merges on
 * absence of red. On GitWeave PR #41 `--auto` was refused (allow_auto_merge=false)
 * and the ruleset required no checks, so an auto-merge would have landed before CI.
 * Real local git + a protected bare origin + a stub gh (test-fixtures/save-origin.ts). No network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

import { STUDIO_BRANCH } from '../../project-repo-tx.ts';
import { NO_REQUIRED_CHECK } from '../../project-pr-verdict.ts';
import { saveProjectRepo, studioPullRequest } from '../../project-repo-save.ts';
import { PR_URL, checkRun, fixture, ghState, githubMergesPr, hasRef, sha, statusContext, stubGh, studioCommit, type Fixture, type GhState } from '../test-fixtures/save-origin.ts';

const merges = (gh: GhState): string[][] => gh.calls.filter((c) => c[0] === 'pr' && c[1] === 'merge');
const autoMerges = (gh: GhState): string[][] => merges(gh).filter((c) => c.includes('--auto'));
const directMerges = (gh: GhState): string[][] => merges(gh).filter((c) => !c.includes('--auto'));

function withSave(over: Partial<GhState>, body: (f: Fixture, gh: GhState, r: ReturnType<typeof saveProjectRepo>) => void): void {
  const f = fixture();
  try {
    studioCommit(f.work);
    const gh = ghState({ originDir: f.origin, ...over });
    const r = saveProjectRepo(f.work, { gh: stubGh(gh) });
    body(f, gh, r);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
}

const PENDING = [checkRun('build', 'IN_PROGRESS', null), checkRun('lint', 'COMPLETED', 'SUCCESS')];
const GREEN = [checkRun('build', 'COMPLETED', 'SUCCESS'), statusContext('ci/legacy', 'SUCCESS')];

test('pending + allow_auto_merge=true → --auto requested, no direct merge, state pending names the check', () => {
  withSave({ checks: PENDING, allowAutoMerge: true }, (f, gh, r) => {
    assert.equal(r.prState, 'pending');
    assert.equal(r.pushed, true);
    assert.equal(r.merged, false);
    assert.match(r.detail, /pending: build/);
    assert.match(r.detail, /auto-merge requested/);
    assert.deepEqual(autoMerges(gh), [['pr', 'merge', PR_URL, '--auto', '--merge', '--repo', 'acme/weave']]);
    assert.equal(directMerges(gh).length, 0);
    assert.ok(hasRef(f.work, `refs/heads/${STUDIO_BRANCH}`));
  });
});

test('pending + allow_auto_merge=false → no --auto, the detail says auto-merge is off', () => {
  withSave({ checks: PENDING, allowAutoMerge: false }, (_f, gh, r) => {
    assert.equal(r.prState, 'pending');
    assert.match(r.detail, /auto-merge is off/);
    assert.equal(merges(gh).length, 0);
  });
});

test('pending + allow_auto_merge missing → no --auto, "auto-merge setting not reported"', () => {
  withSave({ checks: PENDING, allowAutoMerge: 'missing' }, (_f, gh, r) => {
    assert.equal(r.prState, 'pending');
    assert.match(r.detail, /auto-merge setting not reported/);
    assert.equal(merges(gh).length, 0);
  });
});

test('failing → named, no merge of any kind (even with allow_auto_merge=true)', () => {
  withSave({ checks: [checkRun('build', 'COMPLETED', 'FAILURE'), checkRun('slow', 'QUEUED', null)], allowAutoMerge: true }, (f, gh, r) => {
    assert.equal(r.prState, 'failing');
    assert.match(r.detail, /failing: build/);
    assert.equal(merges(gh).length, 0);
    assert.equal(sha(f.work, 'main'), sha(f.origin, 'main'));
  });
});

test('green → gh pr merge --merge --match-head-commit <pushed oid>, then the base fast-forwards and forge-studio drops', () => {
  const f = fixture();
  try {
    studioCommit(f.work);
    const pushed = sha(f.work, STUDIO_BRANCH);
    const gh = ghState({ originDir: f.origin, checks: GREEN, allowAutoMerge: true });
    gh.onMerge = () => { githubMergesPr(f); };
    const r = saveProjectRepo(f.work, { gh: stubGh(gh) });
    assert.deepEqual(directMerges(gh), [['pr', 'merge', PR_URL, '--merge', '--match-head-commit', pushed, '--repo', 'acme/weave']]);
    assert.equal(autoMerges(gh).length, 0);
    assert.equal(r.merged, true, r.detail);
    assert.equal(r.prState, 'merged');
    assert.equal(sha(f.work, 'main'), sha(f.origin, 'main'), 'local main fast-forwarded to the merged origin/main');
    assert.notEqual(sha(f.work, 'main'), pushed);
    assert.equal(hasRef(f.work, `refs/heads/${STUDIO_BRANCH}`), false);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('a later Save evaluates again: pending first, then green → merged', () => {
  const f = fixture();
  try {
    studioCommit(f.work);
    const gh = ghState({ originDir: f.origin, checks: PENDING });
    gh.onMerge = () => { githubMergesPr(f); };
    assert.equal(saveProjectRepo(f.work, { gh: stubGh(gh) }).prState, 'pending');
    assert.equal(merges(gh).length, 0);
    gh.checks = GREEN;
    const r = saveProjectRepo(f.work, { gh: stubGh(gh) });
    assert.equal(r.merged, true, r.detail);
    assert.equal(directMerges(gh).length, 1);
    assert.equal(sha(f.work, 'main'), sha(f.origin, 'main'));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('no required checks → refused with the exact hand-off text; neither merge nor --auto, even with allow_auto_merge=true', () => {
  withSave({ checks: [checkRun('lint', 'COMPLETED', 'SUCCESS', false)], allowAutoMerge: true }, (_f, gh, r) => {
    assert.equal(r.prState, 'blocked-no-required-check');
    assert.ok(r.detail.includes(NO_REQUIRED_CHECK), r.detail);
    assert.equal(merges(gh).length, 0);
  });
});

test('the ruleset refuses the merge → blocked-by-ruleset, gh\'s first stderr line named, base untouched', () => {
  const refusal = 'GraphQL: Repository rule violations found\n\nAt least 1 approving review is required by reviewers with write access.';
  withSave({ checks: GREEN, mergeRefused: refusal }, (f, gh, r) => {
    assert.equal(r.prState, 'blocked-by-ruleset');
    assert.equal(r.merged, false);
    assert.match(r.detail, /GraphQL: Repository rule violations found/);
    assert.doesNotMatch(r.detail, /approving review/);
    assert.match(r.detail, /merge on GitHub yourself/);
    assert.equal(directMerges(gh).length, 1);
    assert.equal(sha(f.work, 'main'), sha(f.origin, 'main'));
    assert.ok(hasRef(f.work, `refs/heads/${STUDIO_BRANCH}`));
  });
});

test('a PR head other than the pushed commit → stale-head, no merge', () => {
  withSave({ checks: GREEN, allowAutoMerge: true, headOid: 'f'.repeat(40) }, (_f, gh, r) => {
    assert.equal(r.prState, 'stale-head');
    assert.match(r.detail, /fffffff/);
    assert.equal(merges(gh).length, 0);
  });
});

test('an unreadable PR read (gh fails, or prints garbage) → unreadable, named, no merge', () => {
  for (const graphql of [{ fail: true as const }, { raw: '<html>oops</html>' }]) {
    withSave({ checks: GREEN, allowAutoMerge: true, graphql }, (_f, gh, r) => {
      assert.equal(r.prState, 'unreadable');
      assert.match(r.detail, 'fail' in graphql ? /HTTP 502/ : /unparseable/);
      assert.equal(merges(gh).length, 0);
    });
  }
});

test('repo-status reports the PR state by name and never merges or requests --auto', () => {
  withSave({ checks: PENDING, allowAutoMerge: true }, (f, gh) => {
    gh.calls.length = 0;
    assert.deepEqual(studioPullRequest(f.work, stubGh(gh)), { prUrl: PR_URL, prState: 'pending', prDetail: 'checks pending: build' });
    gh.checks = GREEN;
    assert.equal(studioPullRequest(f.work, stubGh(gh))?.prState, 'green');
    gh.checks = [checkRun('build', 'COMPLETED', 'FAILURE')];
    assert.equal(studioPullRequest(f.work, stubGh(gh))?.prState, 'failing');
    assert.equal(merges(gh).length, 0, 'a GET never merges');
    assert.ok(gh.calls.every((c) => !(c[0] === 'api' && c[1] === 'repos/acme/weave')), 'nor reads allow_auto_merge');
  });
});
