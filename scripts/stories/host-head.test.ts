/**
 * Row 188 (bead forge-8vfn.8.5.25), T1 ruling 1973dz — a commit the story run
 * makes onto the HOST tree's own branch is an escape, and the clear undoes it.
 *
 * MEASURED: S1's onboarding agent committed 72ed93fa2 ("docs(brain): fill
 * story-s1 Brain 3 profile") onto the branch of the forge checkout running
 * the stories, and the fence printed `fence: clean` — it diffs porcelain, and
 * a committed write leaves porcelain clean. Every test below builds a REAL git
 * repo in a tmpdir and commits in it exactly the way the agent did.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { judgeHostHead, recordHostHead } from './host-head.mjs';
import { describeFence, fenceBreaches, readGitPorcelain } from './sweep.mjs';
import { containmentVerdict } from './run-story-verdict.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const git = (root: string, ...args: string[]) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A host tree with one commit, on branch `work`, as a lane's checkout is. */
function hostTree() {
  const root = mkdtempSync(join(tmpdir(), 'host-head-'));
  git(root, 'init', '-q', '-b', 'work');
  git(root, 'config', 'user.email', 'story@example.invalid');
  git(root, 'config', 'user.name', 'story');
  git(root, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(root, 'README.md'), 'host\n');
  git(root, 'add', 'README.md');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}

/** What the onboarding agent did: write the story's Brain 3 profile and commit it. */
function agentCommits(root: string, files: Record<string, string>, subject = 'docs(brain): fill story-s1 Brain 3 profile') {
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), body);
    git(root, 'add', '--', p);
  }
  git(root, 'commit', '-q', '-m', subject);
}

const evidenceRoot = () => mkdtempSync(join(tmpdir(), 'host-head-evidence-'));

const PROFILE = 'brain/projects/story-s1/profile.md';

test('row 188 (the defect, reproduced): the porcelain fence calls a COMMITTED escape clean', () => {
  const root = hostTree();
  const before = readGitPorcelain(root);
  agentCommits(root, { [PROFILE]: '# profile\n' });
  const breaches = fenceBreaches(before, readGitPorcelain(root), 'S1', 'story-s1', { root });
  const fence = { ...breaches, restored: [], removed: [], failed: [], escapes: [] };
  assert.deepEqual(describeFence(fence), ['[stories] fence: clean — the run wrote nothing outside its own artifacts']);
});

test('row 188: a story-owned commit reds the fence, is soft-reset to the recorded HEAD, cleared, and its diff kept', () => {
  const root = hostTree();
  const recorded = recordHostHead(root);
  assert.equal(recorded.error, null);
  agentCommits(root, { [PROFILE]: '# profile\nreal facts\n' });
  const evidenceDir = join(evidenceRoot(), 'S1', 'stamp'); // `_logs/` is ignored in the real tree; outside the tmp repo here

  const judged = judgeHostHead({ root, recorded, storyId: 'S1', groundProject: 'story-s1', evidenceDir });

  assert.equal(judged.red, true, 'HEAD moved during the story — the fence reds');
  assert.equal(judged.moved, true);
  assert.equal(judged.reset, true);
  assert.equal(git(root, 'rev-parse', 'HEAD'), recorded.sha, 'the branch is back where the story found it');
  assert.equal(git(root, 'symbolic-ref', 'HEAD'), 'refs/heads/work');
  assert.deepEqual(readGitPorcelain(root), [], 'the soft reset is followed through — the tree ends as it started');
  assert.equal(existsSync(join(root, PROFILE)), false);
  assert.deepEqual(judged.cleared, [PROFILE]);
  assert.deepEqual(judged.foreign, []);
  const patch = readFileSync(join(evidenceDir, 'HOST-HEAD-MOVED.patch'), 'utf8');
  assert.match(patch, /Subject: \[PATCH\] docs\(brain\): fill story-s1 Brain 3 profile/);
  assert.match(patch, /\+real facts/);
  assert.ok(judged.lines.some((l) => /^\[stories\] fence: HEAD MOVED .* on refs\/heads\/work — 1 commit\(s\)/.test(l)), judged.lines.join('\n'));
  assert.ok(judged.lines.some((l) => l.startsWith(`[stories] fence: CLEARED ${PROFILE}`)));
});

test('row 188: the clear follows a sweep that already removed the file (AD in the index) back to a clean tree', () => {
  const root = hostTree();
  const recorded = recordHostHead(root);
  agentCommits(root, { [PROFILE]: '# profile\n' });
  rmSync(join(root, 'brain'), { recursive: true, force: true }); // the trailing sweep's own removal, as S1 run 6 logged it
  const judged = judgeHostHead({ root, recorded, storyId: 'S1', groundProject: 'story-s1', evidenceDir: join(evidenceRoot(), 'ev') });
  assert.equal(judged.red, true);
  assert.equal(git(root, 'rev-parse', 'HEAD'), recorded.sha);
  assert.deepEqual(readGitPorcelain(root), []);
});

test('row 188: a committed path that is NOT the story\'s own stays, staged, and is named', () => {
  const root = hostTree();
  const recorded = recordHostHead(root);
  agentCommits(root, { [PROFILE]: '# profile\n', 'packages/kernel/stray.ts': 'export {};\n' });
  const judged = judgeHostHead({ root, recorded, storyId: 'S1', groundProject: 'story-s1', evidenceDir: join(evidenceRoot(), 'ev') });
  assert.equal(judged.red, true);
  assert.equal(git(root, 'rev-parse', 'HEAD'), recorded.sha);
  assert.deepEqual(judged.cleared, [PROFILE]);
  assert.deepEqual(judged.foreign, ['packages/kernel/stray.ts']);
  assert.deepEqual(readGitPorcelain(root), [{ xy: 'A ', path: 'packages/kernel/stray.ts' }], 'foreign work is never removed');
  assert.ok(judged.lines.some((l) => l.startsWith('[stories] fence: STAGED packages/kernel/stray.ts — committed during the run and NOT the story\'s own')));
});

test('row 188: a branch REWRITTEN (not descended from the recorded HEAD) reds and is touched not at all', () => {
  const root = hostTree();
  const recorded = recordHostHead(root);
  writeFileSync(join(root, 'README.md'), 'rewritten\n');
  git(root, 'commit', '-q', '-a', '--amend', '-m', 'init, rewritten');
  const rewritten = git(root, 'rev-parse', 'HEAD');
  const evidenceDir = join(evidenceRoot(), 'ev');
  const judged = judgeHostHead({ root, recorded, storyId: 'S1', groundProject: 'story-s1', evidenceDir });
  assert.equal(judged.red, true);
  assert.equal(judged.reset, false);
  assert.equal(git(root, 'rev-parse', 'HEAD'), rewritten, 'nothing was reset');
  assert.equal(existsSync(evidenceDir), false);
  assert.match(judged.lines.join('\n'), /is not an ancestor of .*NOTHING was reset/);
});

test('row 188: a run that ends on ANOTHER ref reds and never moves either ref', () => {
  const root = hostTree();
  const recorded = recordHostHead(root);
  git(root, 'switch', '-q', '-c', 'elsewhere');
  agentCommits(root, { [PROFILE]: '# profile\n' });
  const tip = git(root, 'rev-parse', 'HEAD');
  const judged = judgeHostHead({ root, recorded, storyId: 'S1', groundProject: 'story-s1', evidenceDir: join(evidenceRoot(), 'ev') });
  assert.equal(judged.red, true);
  assert.equal(judged.reset, false);
  assert.equal(git(root, 'rev-parse', 'HEAD'), tip);
  assert.equal(git(root, 'rev-parse', 'work'), recorded.sha);
});

test('row 188: an unmoved HEAD is clean and says so; an unreadable one is never clean', () => {
  const root = hostTree();
  const recorded = recordHostHead(root);
  const judged = judgeHostHead({ root, recorded, storyId: 'S1', groundProject: 'story-s1', evidenceDir: join(evidenceRoot(), 'ev') });
  assert.equal(judged.red, false);
  assert.match(judged.lines[0], /^\[stories\] fence: HEAD unchanged — /);
  const unread = recordHostHead(mkdtempSync(join(tmpdir(), 'host-head-not-a-repo-')));
  assert.notEqual(unread.error, null);
  const blind = judgeHostHead({ root, recorded: unread, storyId: 'S1', evidenceDir: join(evidenceRoot(), 'ev') });
  assert.equal(blind.red, true);
  assert.match(blind.lines[0], /HEAD UNKNOWN/);
});

test('row 188: containmentVerdict reds a moved HEAD regardless of a green beat score', () => {
  const quiet = {
    story: { id: 'S1', ground: { project: 'story-s1' } },
    ownGroundDrift: { mergeAlignmentFailure: null, undeclared: [], unmatchedDeclarations: [], clear: { unremoved: [] } },
    trailing: { census: { empty: true }, reappearedArtefacts: [] },
    fence: { reappeared: [], groundEscapes: [], escapes: [] },
    realFence: { ok: true },
    forkGrounds: { redReason: null },
    row: { status: 'green' },
    spendHalt: null,
    galleryRegenFailure: null,
  };
  assert.equal(containmentVerdict({ ...quiet, hostHead: { red: false } }), 0);
  assert.equal(containmentVerdict({ ...quiet, hostHead: { red: true, summary: 'HEAD moved a..b on refs/heads/work' } }), 1);
});

test('row 188 wiring: run-story records HEAD beside the porcelain baseline, judges it after the fence, and hands it to the verdict', () => {
  const s = readFileSync(join(HERE, 'run-story.mjs'), 'utf8');
  const baseline = s.indexOf('const treeBefore = readGitPorcelain(ROOT);');
  const record = s.indexOf('recordHostHead(ROOT)');
  const fence = s.indexOf('const fence = applyFence(');
  const judge = s.indexOf('judgeHostHead({');
  const handoff = s.indexOf('return containmentVerdict({');
  assert.ok(baseline !== -1 && record !== -1 && Math.abs(record - baseline) < 400, 'HEAD is recorded beside the porcelain baseline');
  assert.ok(fence !== -1 && judge > fence, 'HEAD is judged AFTER the porcelain fence (its foreign paths must stay staged)');
  assert.match(s.slice(handoff, handoff + 400), /(?<![.\w])hostHead(?![.\w:])/, 'the SAME hostHead reaches containmentVerdict');
  const v = readFileSync(join(HERE, 'run-story-verdict.mjs'), 'utf8');
  assert.match(v, /function containmentVerdict\(\{[^}]*\bhostHead\b/s);
});
