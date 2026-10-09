/**
 * forge-mfv5.1.22 — a Save against a protected default branch. On gitweave the
 * push of main was refused AFTER the local merge, forge-studio was deleted
 * anyway, and the result read as a save: local main sat "ahead 6" with no
 * Studio path back. Fixtures: tests/test-fixtures/save-origin.ts (real local git,
 * a protected bare origin, a stub gh). No network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { STUDIO_BRANCH } from '../../project-repo-tx.ts';
import { hasPendingStudioChanges, parseRecoverConfirmation, saveProjectRepo, studioPullRequestUrl } from '../../project-repo-save.ts';
import { PR_URL, fixture, g, ghState, githubMergesPr, hasRef, prRow, sha, stranded, stubGh, studioCommit } from '../test-fixtures/save-origin.ts';

test('(a) protected main → forge-studio pushed as a branch, PR opened with auto-merge, base untouched, still pending', () => {
  const f = fixture();
  try {
    studioCommit(f.work);
    const mainBefore = sha(f.work, 'main');
    const studio = sha(f.work, STUDIO_BRANCH);
    const gh = ghState();
    const r = saveProjectRepo(f.work, { gh: stubGh(gh) });
    assert.equal(r.merged, false);
    assert.equal(r.pushed, true);
    assert.equal(r.prUrl, PR_URL);
    assert.match(r.detail, /opened PR https:\/\/github\.com\/acme\/weave\/pull\/7 \(default branch protected\)/);
    assert.equal(sha(f.origin, 'refs/heads/forge-studio'), studio, 'forge-studio is on origin as a branch');
    assert.equal(sha(f.origin, 'main'), mainBefore, 'origin main untouched');
    assert.equal(sha(f.work, 'main'), mainBefore, 'local main untouched');
    assert.equal(sha(f.work, STUDIO_BRANCH), studio, 'forge-studio kept');
    assert.ok(gh.calls.some((c) => c.join(' ').startsWith(`pr merge ${PR_URL} --auto --merge`)), 'merge-on-green requested');
    assert.equal(hasPendingStudioChanges(f.work), true);
    assert.equal(studioPullRequestUrl(f.work, stubGh(gh)), PR_URL, 'repo-status serves the open PR');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('(a2) an already-open PR is reused; auto-merge not allowed leaves it open and says so — not an error', () => {
  const f = fixture();
  try {
    studioCommit(f.work);
    const gh = ghState({ open: [prRow(PR_URL)], autoMerge: false });
    const r = saveProjectRepo(f.work, { gh: stubGh(gh) });
    assert.equal(r.pushed, true);
    assert.equal(r.prUrl, PR_URL);
    assert.equal(gh.calls.some((c) => c[0] === 'pr' && c[1] === 'create'), false, 'no second PR');
    assert.match(r.detail, /auto-merge not enabled/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('(b) unprotected per probe but the push of main is refused → local merge undone, forge-studio kept, PR path', () => {
  const f = fixture();
  try {
    studioCommit(f.work);
    const mainBefore = sha(f.work, 'main');
    const studio = sha(f.work, STUDIO_BRANCH);
    const r = saveProjectRepo(f.work, { gh: stubGh(ghState({ protection: false })) });
    assert.equal(r.merged, false);
    assert.equal(sha(f.work, 'main'), mainBefore, 'the local merge is undone');
    assert.ok(hasRef(f.work, `refs/heads/${STUDIO_BRANCH}`), 'a refused push never deletes forge-studio');
    assert.equal(sha(f.work, STUDIO_BRANCH), studio);
    assert.equal(r.pushed, true);
    assert.equal(r.prUrl, PR_URL);
    assert.match(r.detail, /push of main refused/);
    assert.equal(sha(f.origin, 'refs/heads/forge-studio'), studio);
    assert.equal(hasPendingStudioChanges(f.work), true);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('(b2) unprotected and the push lands → merged + pushed, forge-studio deleted (today\'s path)', () => {
  const f = fixture({ hook: false });
  try {
    studioCommit(f.work);
    const r = saveProjectRepo(f.work, { gh: stubGh(ghState({ protection: false })) });
    assert.equal(r.merged, true);
    assert.equal(r.pushed, true);
    assert.equal(sha(f.origin, 'main'), sha(f.work, 'main'));
    assert.equal(hasRef(f.work, `refs/heads/${STUDIO_BRANCH}`), false);
    assert.equal(hasPendingStudioChanges(f.work), false);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('(c) probe UNKNOWN (gh fails) → treated as protected, says so, PR path', () => {
  const f = fixture();
  try {
    studioCommit(f.work);
    const mainBefore = sha(f.work, 'main');
    const r = saveProjectRepo(f.work, { gh: stubGh(ghState({ protection: 'fail' })) });
    assert.equal(r.merged, false);
    assert.equal(r.pushed, true);
    assert.equal(r.prUrl, PR_URL);
    assert.match(r.detail, /protection unknown.*HTTP 404.*treated as protected/);
    assert.equal(sha(f.work, 'main'), mainBefore);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('(c2) a non-GitHub origin that accepts the push → merged + pushed as today, gh never asked', () => {
  const f = fixture({ hook: false, githubUrl: false });
  try {
    studioCommit(f.work);
    const gh = ghState();
    const r = saveProjectRepo(f.work, { gh: stubGh(gh) });
    assert.equal(r.merged, true);
    assert.equal(r.pushed, true);
    assert.equal(sha(f.origin, 'main'), sha(f.work, 'main'));
    assert.equal(hasRef(f.work, `refs/heads/${STUDIO_BRANCH}`), false);
    assert.equal(gh.calls.length, 0);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('(c2b) a non-GitHub origin that refuses the push → named refusal, base restored, forge-studio kept, gh never asked', () => {
  const f = fixture({ hook: true, githubUrl: false });
  try {
    studioCommit(f.work);
    const mainBefore = sha(f.work, 'main');
    const studio = sha(f.work, STUDIO_BRANCH);
    const gh = ghState();
    const r = saveProjectRepo(f.work, { gh: stubGh(gh) });
    assert.equal(r.merged, false);
    assert.equal(r.pushed, false);
    assert.match(r.detail, /push to origin refused and no GitHub PR path for a non-GitHub origin — forge-studio kept, local main restored/);
    assert.equal(sha(f.work, 'main'), mainBefore, 'base restored to its pre-merge sha');
    assert.equal(sha(f.work, STUDIO_BRANCH), studio, 'forge-studio kept');
    assert.equal(hasRef(f.origin, 'refs/heads/forge-studio'), false);
    assert.equal(gh.calls.length, 0);
    assert.equal(hasPendingStudioChanges(f.work), true);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('(c3) gh pr create fails → not pushed, named reason, forge-studio and main untouched', () => {
  const f = fixture();
  try {
    studioCommit(f.work);
    const mainBefore = sha(f.work, 'main');
    const studio = sha(f.work, STUDIO_BRANCH);
    const r = saveProjectRepo(f.work, { gh: stubGh(ghState({ createFails: true })) });
    assert.equal(r.merged, false);
    assert.equal(r.pushed, false);
    assert.equal(r.prUrl, undefined);
    assert.match(r.detail, /gh pr create failed.*Resource not accessible/);
    assert.equal(sha(f.work, 'main'), mainBefore);
    assert.equal(sha(f.work, STUDIO_BRANCH), studio);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('(d) a later Save after the PR merged → base fast-forwarded to origin, forge-studio deleted', () => {
  const f = fixture();
  try {
    studioCommit(f.work);
    const gh = ghState();
    assert.equal(saveProjectRepo(f.work, { gh: stubGh(gh) }).prUrl, PR_URL);
    const merged = githubMergesPr(f);
    gh.open = []; gh.merged = [prRow(PR_URL, { headRefOid: sha(f.work, STUDIO_BRANCH) })];
    const r = saveProjectRepo(f.work, { gh: stubGh(gh) });
    assert.equal(r.merged, true);
    assert.equal(r.pushed, true);
    assert.match(r.detail, /PR https:\/\/github\.com\/acme\/weave\/pull\/7 merged/);
    assert.equal(sha(f.work, 'main'), merged, 'local main fast-forwarded to origin/main');
    assert.equal(hasRef(f.work, `refs/heads/${STUDIO_BRANCH}`), false);
    assert.equal(hasPendingStudioChanges(f.work), false);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('(e1) STRANDED → Save proposes the recovery and touches nothing; repo-status reads pending', () => {
  const f = fixture();
  try {
    const { head, originMain } = stranded(f);
    assert.equal(hasPendingStudioChanges(f.work), true, 'Studio offers Save again');
    const gh = ghState();
    const r = saveProjectRepo(f.work, { gh: stubGh(gh) });
    assert.equal(r.merged, false);
    assert.equal(r.pushed, false);
    assert.deepEqual(r.recovery, { commits: 2, subjects: ['forge-studio: two', 'forge-studio: one'], localHead: head, resetTo: originMain, base: 'main' });
    assert.match(r.detail, new RegExp(`2 commits move to forge-studio; local main resets to origin/main ${originMain.slice(0, 7)}`));
    assert.equal(sha(f.work, 'main'), head, 'main not moved');
    assert.equal(hasRef(f.work, `refs/heads/${STUDIO_BRANCH}`), false, 'no branch created');
    assert.equal(hasRef(f.origin, 'refs/heads/forge-studio'), false, 'nothing pushed');
    assert.equal(gh.calls.length, 0);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('(e2) STRANDED + confirmed with matching shas → forge-studio holds both commits, main == origin/main, PR path', () => {
  const f = fixture();
  try {
    const { head, originMain } = stranded(f);
    const r = saveProjectRepo(f.work, { gh: stubGh(ghState()), recover: { localHead: head, resetTo: originMain } });
    assert.equal(r.merged, false);
    assert.equal(r.pushed, true);
    assert.equal(r.prUrl, PR_URL);
    assert.equal(sha(f.work, STUDIO_BRANCH), head, 'forge-studio holds both commits');
    assert.equal(sha(f.work, 'main'), originMain, 'main reset to origin/main');
    assert.equal(sha(f.origin, 'refs/heads/forge-studio'), head);
    assert.equal(hasPendingStudioChanges(f.work), true);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('(e3) a stale confirmation (local main moved since the proposal) is refused by name; nothing moved', () => {
  const f = fixture();
  try {
    const { head, originMain } = stranded(f);
    writeFileSync(join(f.work, 'three.txt'), '3\n');
    g(f.work, ['add', 'three.txt']);
    g(f.work, ['commit', '-q', '-m', 'three']);
    const now = sha(f.work, 'main');
    const r = saveProjectRepo(f.work, { gh: stubGh(ghState()), recover: { localHead: head, resetTo: originMain } });
    assert.equal(r.pushed, false);
    assert.equal(r.recovery?.localHead, now, 'a fresh proposal comes back');
    assert.match(r.detail, /stale recovery confirmation/);
    assert.equal(sha(f.work, 'main'), now);
    assert.equal(hasRef(f.work, `refs/heads/${STUDIO_BRANCH}`), false);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('(f) a DIVERGED base (behind and ahead of origin) is refused by name on both steps; nothing moved', () => {
  const f = fixture();
  try {
    const { head, originMain } = stranded(f);
    const clone = join(f.root, 'other');
    execFileSync('git', ['clone', '-q', f.origin, clone]);
    g(clone, ['config', 'user.email', 'o@x']); g(clone, ['config', 'user.name', 'O']);
    writeFileSync(join(clone, 'other.txt'), 'o\n');
    g(clone, ['add', 'other.txt']); g(clone, ['commit', '-q', '-m', 'other']);
    writeFileSync(join(f.origin, 'ALLOW_MAIN'), '');
    g(clone, ['push', '-q', 'origin', 'main']);
    for (const recover of [undefined, { localHead: head, resetTo: originMain }]) {
      const r = saveProjectRepo(f.work, { gh: stubGh(ghState()), ...(recover ? { recover } : {}) });
      assert.equal(r.merged, false);
      assert.equal(r.pushed, false);
      assert.equal(r.recovery, undefined);
      assert.match(r.detail, /local main has diverged from origin\/main \(2 ahead, 1 behind\)/);
      assert.equal(sha(f.work, 'main'), head);
      assert.equal(hasRef(f.work, `refs/heads/${STUDIO_BRANCH}`), false);
    }
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('(e4) a stale confirmation (origin/main moved since the proposal) is refused by name; nothing moved', () => {
  const f = fixture();
  try {
    const { head, originMain } = stranded(f);
    writeFileSync(join(f.origin, 'ALLOW_MAIN'), '');
    g(f.work, ['push', '-q', 'origin', `${head}~1:refs/heads/main`]); // someone landed the first stranded commit
    const r = saveProjectRepo(f.work, { gh: stubGh(ghState()), recover: { localHead: head, resetTo: originMain } });
    assert.equal(r.pushed, false);
    assert.match(r.detail, /stale recovery confirmation/);
    assert.equal(r.recovery?.commits, 1);
    assert.equal(sha(f.work, 'main'), head);
    assert.equal(hasRef(f.work, `refs/heads/${STUDIO_BRANCH}`), false);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('a request body confirms a recovery only with two full shas', () => {
  const a = 'a'.repeat(40); const b = 'b'.repeat(40);
  assert.deepEqual(parseRecoverConfirmation({ localHead: a, resetTo: b }), { localHead: a, resetTo: b });
  for (const raw of [undefined, null, 'x', { localHead: a }, { localHead: 'HEAD', resetTo: b }, { localHead: a, resetTo: `${b};rm` }]) {
    assert.equal(parseRecoverConfirmation(raw), undefined);
  }
});
