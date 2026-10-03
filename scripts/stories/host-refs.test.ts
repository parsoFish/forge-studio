/**
 * host-refs.test.ts — row 208 (bead `forge-8vfn.8.5.44`), the harness half of
 * the 2026-10-03 incident: `host-head.mjs` watches only the RUNNING tree's
 * own checked-out ref, and that was not enough.
 *
 * MEASURED. A story run from `/home/parso/forge-m7-e-docs` (a git WORKTREE of
 * `/home/parso/forge`, DETACHED HEAD) launched forge's onboarding agent,
 * which committed onto the docs tree's detached HEAD — invisible to
 * `host-head.mjs` by construction only until the run's own end-of-story
 * judgement (it caught the detached-HEAD commit only because the gate died
 * before that judgement ran) — and then ran `git update-ref refs/heads/main
 * 8be024930`. Because every worktree of one repository shares its refs
 * (`refs/heads/*`, `refs/tags/*`, `refs/stash`, `refs/notes/*` all live in the
 * ONE common `.git` dir; only `HEAD`, the index and a few per-worktree refs
 * are private to each checkout), that single `update-ref` moved the
 * OPERATOR's checked-out `main` in `/home/parso/forge` — a tree the story
 * never touched directly and `host-head.mjs` was never watching, because
 * `host-head.mjs` watches the one ref the RUNNING tree itself has checked
 * out, not every ref the repo holds.
 *
 * Every test below builds a REAL git repo in a tmpdir, adds a REAL worktree
 * with `git worktree add --detach`, and reproduces the exact incident shape
 * from inside that worktree — never a mock of `git`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { judgeHostRefs, recordHostRefs } from './host-refs.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const git = (root: string, ...args: string[]) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A bare-ish repo with one commit on `main`, shaped like the operator's own checkout. */
function hostRepo() {
  const root = mkdtempSync(join(tmpdir(), 'host-refs-'));
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'story@example.invalid');
  git(root, 'config', 'user.name', 'story');
  git(root, 'config', 'commit.gpgsign', 'false');
  execFileSync('bash', ['-c', `echo host > ${join(root, 'README.md')}`]);
  git(root, 'add', 'README.md');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}

/** A detached-HEAD worktree of `repoRoot` — the exact tree shape the incident ran from. */
function addDetachedWorktree(repoRoot: string) {
  const wt = mkdtempSync(join(tmpdir(), 'host-refs-wt-'));
  rmSync(wt, { recursive: true, force: true }); // `git worktree add` must create the dir itself
  git(repoRoot, 'worktree', 'add', '--detach', wt);
  return wt;
}

const evidenceRoot = () => mkdtempSync(join(tmpdir(), 'host-refs-evidence-'));

test('row 208 (the incident, reproduced): a worktree commits on its own detached HEAD, then runs `git update-ref refs/heads/main <newsha>` — judgeHostRefs reds, naming refs/heads/main with before/after SHAs', () => {
  const repoRoot = hostRepo();
  const mainBefore = git(repoRoot, 'rev-parse', 'refs/heads/main');
  const wt = addDetachedWorktree(repoRoot);

  const recorded = recordHostRefs(wt);
  assert.equal(recorded.error, null);

  // What the onboarding agent did: commit on the worktree's own detached HEAD...
  execFileSync('bash', ['-c', `echo changed > ${join(wt, 'README.md')}`]);
  git(wt, 'commit', '-q', '-a', '-m', 'docs(brain): fill story profile');
  const newSha = git(wt, 'rev-parse', 'HEAD');
  // ...then move `refs/heads/main` directly — the exact shape of the incident.
  git(wt, 'update-ref', 'refs/heads/main', newSha);

  const evidenceDir = join(evidenceRoot(), 'ev');
  const judged = judgeHostRefs({ root: wt, recorded, storyId: 'S1', evidenceDir });

  assert.equal(judged.red, true, 'a ref moved in the shared repo — this is CONTAINMENT FAILURE regardless of the running tree\'s own HEAD');
  assert.deepEqual(judged.moved, ['refs/heads/main']);
  assert.ok(
    judged.lines.some((l) => l.includes('refs/heads/main') && l.includes(mainBefore.slice(0, 12)) && l.includes(newSha.slice(0, 12))),
    `expected a line naming refs/heads/main with both before (${mainBefore.slice(0, 12)}) and after (${newSha.slice(0, 12)}) SHAs. Got:\n${judged.lines.join('\n')}`,
  );
  assert.match(judged.summary ?? '', /refs\/heads\/main|1 ref/);
});

test('unmoved: every ref exactly as the story found it reads clean', () => {
  const repoRoot = hostRepo();
  const recorded = recordHostRefs(repoRoot);
  const judged = judgeHostRefs({ root: repoRoot, recorded, storyId: 'S1', evidenceDir: join(evidenceRoot(), 'ev') });
  assert.equal(judged.red, false);
  assert.match(judged.lines[0], /^\[stories\] fence: refs unchanged/);
});

test('a refs/remotes/* move is EXCLUDED from the verdict (an operator fetch during the run is not this story\'s doing) but is still named as excluded', () => {
  const repoRoot = hostRepo();
  git(repoRoot, 'update-ref', 'refs/remotes/origin/main', git(repoRoot, 'rev-parse', 'HEAD'));
  const recorded = recordHostRefs(repoRoot);
  // Simulate a concurrent `git fetch` moving the remote-tracking ref during the
  // run — via `commit-tree`, which makes a new commit WITHOUT moving any local
  // branch (a real `fetch` never touches `refs/heads/*` either), so the only
  // ref this changes is the remote-tracking one itself.
  const tree = git(repoRoot, 'rev-parse', 'HEAD^{tree}');
  const fetchedSha = git(repoRoot, 'commit-tree', tree, '-p', 'HEAD', '-m', 'fetched');
  git(repoRoot, 'update-ref', 'refs/remotes/origin/main', fetchedSha);

  const judged = judgeHostRefs({ root: repoRoot, recorded, storyId: 'S1', evidenceDir: join(evidenceRoot(), 'ev') });
  assert.equal(judged.red, false, 'a refs/remotes/* move alone must never red the run');
  assert.deepEqual(judged.moved, []);
  assert.deepEqual(judged.excludedRemoteMoved, ['refs/remotes/origin/main']);
  assert.ok(
    judged.lines.some((l) => l.includes('refs/remotes/origin/main') && /EXCLUDED/.test(l)),
    `expected a line naming refs/remotes/origin/main as EXCLUDED. Got:\n${judged.lines.join('\n')}`,
  );
});

test('a ref CREATED during the run reds, named, with evidence kept', () => {
  const repoRoot = hostRepo();
  const recorded = recordHostRefs(repoRoot);
  git(repoRoot, 'branch', 'sneaked-in');
  const sha = git(repoRoot, 'rev-parse', 'refs/heads/sneaked-in');

  const evidenceDir = join(evidenceRoot(), 'ev');
  const judged = judgeHostRefs({ root: repoRoot, recorded, storyId: 'S1', evidenceDir });

  assert.equal(judged.red, true);
  assert.deepEqual(judged.created, ['refs/heads/sneaked-in']);
  assert.ok(judged.lines.some((l) => l.includes('refs/heads/sneaked-in') && /CREATED/.test(l) && l.includes(sha.slice(0, 12))));
  const files = readdirSync(evidenceDir);
  assert.ok(files.some((f) => f.includes('sneaked-in')), `expected evidence naming sneaked-in. Got: ${files.join(', ')}`);
});

test('a ref DELETED during the run reds, named, with its last SHA kept', () => {
  const repoRoot = hostRepo();
  git(repoRoot, 'tag', 'v1');
  const sha = git(repoRoot, 'rev-parse', 'refs/tags/v1');
  const recorded = recordHostRefs(repoRoot);
  git(repoRoot, 'tag', '-d', 'v1');

  const evidenceDir = join(evidenceRoot(), 'ev');
  const judged = judgeHostRefs({ root: repoRoot, recorded, storyId: 'S1', evidenceDir });

  assert.equal(judged.red, true);
  assert.deepEqual(judged.deleted, ['refs/tags/v1']);
  assert.ok(judged.lines.some((l) => l.includes('refs/tags/v1') && /DELETED/.test(l) && l.includes(sha.slice(0, 12))));
});

test('unreadable at story end (the root is no longer a git repo) is a named red, never clean', () => {
  const repoRoot = hostRepo();
  const recorded = recordHostRefs(repoRoot);
  assert.equal(recorded.error, null);
  rmSync(join(repoRoot, '.git'), { recursive: true, force: true });

  const judged = judgeHostRefs({ root: repoRoot, recorded, storyId: 'S1', evidenceDir: join(evidenceRoot(), 'ev') });
  assert.equal(judged.red, true);
  assert.match(judged.lines[0], /REFS UNKNOWN/);
  assert.match(judged.summary ?? '', /could not be read|unknown/i);
});

test('unreadable at story start is a named red, never silently trusted', () => {
  const notARepo = mkdtempSync(join(tmpdir(), 'host-refs-not-a-repo-'));
  const recorded = recordHostRefs(notARepo);
  assert.notEqual(recorded.error, null);
  const judged = judgeHostRefs({ root: notARepo, recorded, storyId: 'S1', evidenceDir: join(evidenceRoot(), 'ev') });
  assert.equal(judged.red, true);
  assert.match(judged.lines[0], /REFS UNKNOWN/);
});

// ── wiring: run-story.mjs records refs beside the porcelain baseline, judges
// them AFTER judgeHostHead (whose own clear runs first — a ref host-head put
// back must read unmoved here, never re-flagged), and hands the SAME
// `hostRefs` to `containmentVerdict`. Same idiom as `fixture-wiring.test.ts`'s
// source-order doors and `host-head.test.ts`'s own "row 188 wiring" test —
// `run-story.mjs`/`run.mjs` drive a real browser and cannot run inside
// `npm test`, so ordering is checked as a property of the SOURCE TEXT.
test('row 208 wiring: run-story records refs beside the porcelain baseline, judges them after judgeHostHead, and hands them to the verdict', () => {
  const s = readFileSync(join(HERE, 'run-story.mjs'), 'utf8');
  const baseline = s.indexOf('const treeBefore = readGitPorcelain(ROOT);');
  const record = s.indexOf('recordHostRefs(ROOT)');
  const headJudge = s.indexOf('judgeHostHead({');
  const refsJudge = s.indexOf('judgeHostRefs({');
  const handoff = s.indexOf('return containmentVerdict({');
  assert.ok(baseline !== -1 && record !== -1 && Math.abs(record - baseline) < 400, 'refs are recorded beside the porcelain baseline');
  assert.ok(headJudge !== -1 && refsJudge !== -1 && refsJudge > headJudge, 'refs are judged AFTER judgeHostHead — its own clear runs first, so a ref it put back reads unmoved here');
  assert.ok(handoff !== -1, 'run-story.mjs never hands off to containmentVerdict — this door\'s own anchor moved');
  assert.match(s.slice(handoff, handoff + 400), /(?<![.\w])hostRefs(?![.\w:])/, 'the SAME hostRefs must reach containmentVerdict');
  const v = readFileSync(join(HERE, 'run-story-verdict.mjs'), 'utf8');
  assert.match(v, /function containmentVerdict\(\{[^}]*\bhostRefs\b/s, 'containmentVerdict must declare a hostRefs parameter');
});
