/**
 * forge-mfv5.1.22 security review — the Save's GitHub path trusts only its own
 * PR, never hangs on a prompt, survives an origin with no default branch yet,
 * recognises a squash-merged PR, and leaves the operator on their own branch.
 * Real local git, a stub gh (tests/test-fixtures/save-origin.ts). No network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { STUDIO_BRANCH } from '../../project-repo-tx.ts';
import { saveProjectRepo, studioPullRequestUrl } from '../../project-repo-save.ts';
import { GH_URL, PR_URL, fixture, g, ghState, githubMergesPr, hasRef, prRow, sha, stubGh, studioCommit } from '../test-fixtures/save-origin.ts';

const withEnv = <T>(key: string, value: string, fn: () => T): T => {
  const before = process.env[key];
  process.env[key] = value;
  try { return fn(); } finally { if (before === undefined) delete process.env[key]; else process.env[key] = before; }
};

test('1. a fork\'s, another base\'s or another repo\'s PR named forge-studio is never reused or served', () => {
  const f = fixture();
  try {
    studioCommit(f.work);
    const foreign = [
      prRow('https://github.com/mallory/weave/pull/3', { isCrossRepository: true, headRepositoryOwner: { login: 'mallory' } }),
      prRow('https://github.com/acme/weave/pull/4', { baseRefName: 'release' }),
      prRow('https://github.com/evil/other/pull/5'),
      prRow('https://github.com/acme/weave/pull/6', { headRefName: 'forge-studio-x' }),
    ];
    const gh = ghState({ open: [...foreign] });
    const r = saveProjectRepo(f.work, { gh: stubGh(gh) });
    assert.equal(r.prUrl, PR_URL, 'a fresh PR, not a foreign one');
    assert.ok(gh.calls.some((c) => c[0] === 'pr' && c[1] === 'create'), 'pr create ran');
    const list = gh.calls.find((c) => c[0] === 'pr' && c[1] === 'list')!;
    assert.ok(list.includes('--base') && list[list.indexOf('--base') + 1] === 'main', 'the list asks for the base');
    assert.ok(!gh.calls.some((c) => c[1] === 'merge' && c[2] !== PR_URL), 'auto-merge only ever on our own PR');
    gh.open = [...foreign];
    assert.equal(studioPullRequestUrl(f.work, stubGh(gh)), undefined, 'repo-status serves no foreign PR');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

/** A work repo whose origin (via the github.com URL, or a plain path) is an EMPTY bare repo. */
function emptyOrigin(githubUrl: boolean): { root: string; work: string; origin: string } {
  const root = mkdtempSync(join(tmpdir(), 'save-empty-origin-'));
  const origin = join(root, 'origin.git');
  const work = join(root, 'work');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  g(work, ['config', 'user.email', 't@forge.dev']);
  g(work, ['config', 'user.name', 'Forge Test']);
  writeFileSync(join(work, 'README.md'), '# weave\n');
  g(work, ['add', 'README.md']);
  g(work, ['commit', '-q', '-m', 'init']);
  g(work, ['remote', 'add', 'origin', githubUrl ? GH_URL : origin]);
  if (githubUrl) g(work, ['config', `url.${origin}.insteadOf`, GH_URL]);
  return { root, work, origin };
}

for (const githubUrl of [true, false]) {
  test(`2. an origin with no main yet (${githubUrl ? 'GitHub' : 'non-GitHub'}) → the first Save merges and pushes main`, () => {
    const f = emptyOrigin(githubUrl);
    try {
      studioCommit(f.work);
      const gh = ghState();
      const r = saveProjectRepo(f.work, { gh: stubGh(gh) });
      assert.equal(r.merged, true, r.detail);
      assert.equal(r.pushed, true);
      assert.equal(sha(f.origin, 'main'), sha(f.work, 'main'));
      assert.equal(hasRef(f.work, `refs/heads/${STUDIO_BRANCH}`), false);
      assert.equal(gh.calls.length, 0, 'a branch that does not exist cannot be protected');
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
}

/** Point origin's github.com URL at a local `ext::` command (enabled for this repo only). */
function extOrigin(f: { work: string; origin: string }, script: string): void {
  g(f.work, ['config', 'protocol.ext.allow', 'always']);
  g(f.work, ['config', '--remove-section', `url.${f.origin}`]);
  g(f.work, ['config', `url.ext::sh ${script}.insteadOf`, GH_URL]);
}

test('3a. network git runs with no terminal prompt and batch-mode ssh', () => {
  const f = fixture();
  try {
    studioCommit(f.work);
    const envFile = join(f.root, 'env.txt');
    const script = join(f.root, 'dump-env.sh');
    writeFileSync(script, `#!/bin/sh\nenv > ${envFile}\nexit 1\n`);
    chmodSync(script, 0o755);
    extOrigin(f, script);
    const r = saveProjectRepo(f.work, { gh: stubGh(ghState()) });
    assert.equal(r.pushed, false);
    const env = readFileSync(envFile, 'utf8');
    assert.match(env, /^GIT_TERMINAL_PROMPT=0$/m);
    assert.match(env, /^GIT_SSH_COMMAND=ssh -o BatchMode=yes$/m);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('3b. a network git that hangs past the timeout is a named refusal; nothing moved', () => {
  const f = fixture();
  try {
    studioCommit(f.work);
    const mainBefore = sha(f.work, 'main');
    const script = join(f.root, 'hang.sh');
    writeFileSync(script, '#!/bin/sh\nexec sleep 5\n');
    chmodSync(script, 0o755);
    extOrigin(f, script);
    const r = withEnv('FORGE_GIT_TIMEOUT_MS', '700', () => saveProjectRepo(f.work, { gh: stubGh(ghState()) }));
    assert.equal(r.pushed, false);
    assert.match(r.detail, /timed out after 700 ms/);
    assert.equal(sha(f.work, 'main'), mainBefore);
    assert.ok(hasRef(f.work, `refs/heads/${STUDIO_BRANCH}`));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('3c. repo-status never asks gh under the dry bridge, nor once forge-studio is no longer ahead of origin/main', () => {
  const f = fixture();
  try {
    studioCommit(f.work);
    const gh = ghState();
    assert.equal(saveProjectRepo(f.work, { gh: stubGh(gh) }).prUrl, PR_URL);
    gh.calls.length = 0;
    assert.equal(withEnv('FORGE_DRY_BRIDGE', '1', () => studioPullRequestUrl(f.work, stubGh(gh))), undefined);
    assert.equal(gh.calls.length, 0, 'dry bridge: no gh');
    githubMergesPr(f);
    g(f.work, ['fetch', '-q', 'origin']);
    assert.equal(studioPullRequestUrl(f.work, stubGh(gh)), undefined);
    assert.equal(gh.calls.length, 0, 'merged tracking ref: no gh per poll');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

/** GitHub squash-merges the forge-studio PR: one new commit on origin/main, not containing the forge-studio commits. */
function githubSquashes(f: { root: string; origin: string }): string {
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

test('4a. a squash-merged PR whose head is our forge-studio tip → base fast-forwarded, forge-studio deleted', () => {
  const f = fixture();
  try {
    studioCommit(f.work);
    const gh = ghState();
    saveProjectRepo(f.work, { gh: stubGh(gh) });
    const squashed = githubSquashes(f);
    gh.open = []; gh.merged = [prRow(PR_URL, { headRefOid: sha(f.work, STUDIO_BRANCH) })];
    const r = saveProjectRepo(f.work, { gh: stubGh(gh) });
    assert.equal(r.merged, true, r.detail);
    assert.match(r.detail, /PR https:\/\/github\.com\/acme\/weave\/pull\/7 merged/);
    assert.equal(sha(f.work, 'main'), squashed);
    assert.equal(hasRef(f.work, `refs/heads/${STUDIO_BRANCH}`), false);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('4b. a merged PR for a DIFFERENT head, or a foreign one, finalises nothing', () => {
  const f = fixture();
  try {
    studioCommit(f.work);
    const gh = ghState();
    saveProjectRepo(f.work, { gh: stubGh(gh) });
    githubSquashes(f);
    const tip = sha(f.work, STUDIO_BRANCH);
    gh.merged = [prRow(PR_URL, { headRefOid: 'f'.repeat(40) }), prRow('https://github.com/mallory/weave/pull/3', { isCrossRepository: true, headRefOid: tip })];
    const r = saveProjectRepo(f.work, { gh: stubGh(gh) });
    assert.equal(r.merged, false);
    assert.equal(sha(f.work, STUDIO_BRANCH), tip, 'forge-studio kept');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('4c. a squash-merged PR while local main gained its own commit → refused by name, nothing moved', () => {
  const f = fixture();
  try {
    studioCommit(f.work);
    const gh = ghState();
    saveProjectRepo(f.work, { gh: stubGh(gh) });
    githubSquashes(f);
    const tip = sha(f.work, STUDIO_BRANCH);
    g(f.work, ['checkout', '-q', 'main']);
    writeFileSync(join(f.work, 'local.txt'), 'l\n');
    g(f.work, ['add', 'local.txt']);
    g(f.work, ['commit', '-q', '-m', 'local']);
    const mainBefore = sha(f.work, 'main');
    gh.open = []; gh.merged = [prRow(PR_URL, { headRefOid: tip })];
    const r = saveProjectRepo(f.work, { gh: stubGh(gh) });
    assert.equal(r.merged, false);
    assert.match(r.detail, /PR https:\/\/github\.com\/acme\/weave\/pull\/7 merged, but local main is not an ancestor of origin\/main/);
    assert.equal(sha(f.work, 'main'), mainBefore);
    assert.equal(sha(f.work, STUDIO_BRANCH), tip);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

for (const from of ['wip', 'main']) {
  test(`5. a refused push leaves the operator on the branch they were on (${from})`, () => {
    const f = fixture({ hook: true, githubUrl: false });
    try {
      studioCommit(f.work);
      if (from === 'wip') g(f.work, ['checkout', '-q', '-b', 'wip', 'main']);
      else g(f.work, ['checkout', '-q', 'main']);
      const mainBefore = sha(f.work, 'main');
      const r = saveProjectRepo(f.work, { gh: stubGh(ghState()) });
      assert.equal(r.pushed, false);
      assert.equal(g(f.work, ['rev-parse', '--abbrev-ref', 'HEAD']), from);
      assert.equal(sha(f.work, 'main'), mainBefore);
      assert.ok(hasRef(f.work, `refs/heads/${STUDIO_BRANCH}`));
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
}
