/**
 * The repo's own `security-review` skill derives its range and REFUSES rather
 * than guessing — `forge-8vfn.7.6.69`, T1 ruling 926.
 *
 * WHAT WAS BROKEN, and it was not ours. The bundled skill shells
 * `git diff origin/HEAD...`; this repo's remote is `parsoFish`, so it aborted
 * for every lane on every invocation. Measured: the literal is compiled into
 * the Claude Code binary (18 occurrences of `origin/HEAD`) and appears in zero
 * editable files — every on-disk `security-review/SKILL.md`, the whole plugin
 * cache, the CLI's JS wrappers. So the fix could not be made there, and ruling
 * 926 refused the other route (adding an `origin` remote) because `.git/config`
 * is shared by every worktree and a second remote silently changes what a bare
 * `git push` resolves to for four lanes.
 *
 * WHY THIS FILE EXISTS RATHER THAN A CAREFUL SKILL ALONE. A replacement that
 * hardcodes `parsoFish` is the identical defect with a different string in it,
 * and nothing in a markdown file reds when that happens. So the door RUNS the
 * derivation the skill prescribes and asserts its OUTCOME (§15.459) — a usable
 * base, in this repo, as it is actually configured — and only then checks the
 * cheap textual property that no remote name is baked in.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SKILL_DIR = '.claude/skills/security-review';
const SCRIPT = `${SKILL_DIR}/scripts/review-base.sh`;

/** Run the script somewhere, returning its output and exit code. */
function runIn(cwd: string): { rc: number; out: string } {
  try {
    const out = execFileSync('bash', [join(process.cwd(), SCRIPT)], { cwd, encoding: 'utf8', stdio: 'pipe' });
    return { rc: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { rc: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

/** A real git repo with the remotes and refs a case needs — no stubs. */
function repoWith(remotes: Record<string, string>, refs: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'review-base-'));
  const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 'door@example.invalid');
  git('config', 'user.name', 'door');
  writeFileSync(join(dir, 'f.txt'), 'x\n');
  git('add', 'f.txt');
  git('commit', '-q', '-m', 'base');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  for (const [name, url] of Object.entries(remotes)) git('remote', 'add', name, url);
  // Plant remote-tracking refs by hand: a fixture must not need a live network.
  for (const ref of refs) {
    mkdirSync(join(dir, '.git', 'refs', 'remotes', ref.split('/')[0]!), { recursive: true });
    writeFileSync(join(dir, '.git', 'refs', 'remotes', ref), `${head}\n`);
  }
  return dir;
}

describe('7.6.69 — the review range is derived, and a failure to derive it REFUSES', () => {
  test('in THIS repo it resolves to a usable base — the outcome, not the path', () => {
    const { rc, out } = runIn(process.cwd());
    assert.equal(rc, 0, `the skill must work where it lives:\n${out}`);
    const got = Object.fromEntries(out.trim().split('\n').map((l) => l.split('=') as [string, string]));

    // The remote is whatever THIS repo has, read from git rather than asserted
    // by name — the door must not hardcode what the script must not hardcode.
    const remotes = execFileSync('git', ['remote'], { encoding: 'utf8' }).trim().split('\n');
    assert.ok(remotes.includes(got['REMOTE']!), `REMOTE=${got['REMOTE']} is not one of ${remotes.join(', ')}`);
    assert.match(got['BASE']!, /^[0-9a-f]{40}$/, `BASE must be a resolved commit, got ${got['BASE']}`);
    execFileSync('git', ['cat-file', '-e', `${got['BASE']}^{commit}`]); // throws if it is not a real commit
    assert.match(got['RANGE']!, /\.\.HEAD$/);
  });

  test('no remote name is baked in — the bundled skill\'s defect with a new string', () => {
    const script = readFileSync(SCRIPT, 'utf8');
    const skill = readFileSync(`${SKILL_DIR}/SKILL.md`, 'utf8');
    // COMMENTS ARE STRIPPED FIRST, and the first draft of this door not doing
    // that is why the line is here. It red on the script's own header, which
    // explains the defect by quoting `origin/HEAD` and `parsoFish` — a name in
    // a comment hardcodes nothing, and asserting over prose would have forced
    // the history out of the file that most needs to carry it. The claim is
    // about EXECUTABLE lines: nothing the script runs may name a remote.
    const code = script.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    assert.doesNotMatch(code, /origin\/(HEAD|main)/, 'the exact literal that broke the bundled skill');
    assert.doesNotMatch(code, /parsoFish/, 'and its replacement would be the same bug renamed');
    assert.match(skill, /review-base\.sh/, 'the skill must send the reader to the deriving script');
  });

  test('a change that is only STAGED is counted — the vacuous pass this nearly shipped', () => {
    // FOUND BY RUNNING THIS SKILL ON ITS OWN CHANGE. CLAUDE.md says to review
    // BEFORE committing, so on a freshly branched worktree `$base..HEAD` is
    // empty and the entire change is staged. The first cut counted only that
    // range and printed `FILES=0` — an empty checklist rendered over a real
    // change, called clean. Every other refusal in this script exists to stop
    // exactly that, and it was the default on the most common path.
    const dir = repoWith({ solo: 'https://example.invalid/a.git' }, ['solo/main']);
    try {
      const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
      writeFileSync(join(dir, 'staged.txt'), 'a change nobody has committed yet\n');
      git('add', 'staged.txt');
      writeFileSync(join(dir, 'f.txt'), 'and one nobody has staged\n');

      const { rc, out } = runIn(dir);
      assert.equal(rc, 0, out);
      const got = Object.fromEntries(out.trim().split('\n').map((l) => l.split('=') as [string, string]));
      assert.equal(got['COMMITTED'], '0', 'nothing is committed on this branch');
      assert.equal(got['STAGED'], '1', `the staged change must be seen:\n${out}`);
      assert.equal(got['UNSTAGED'], '1', `and so must the unstaged one:\n${out}`);
      assert.equal(got['FILES'], '2',
        'FILES is the total across all three, because a reviewer who reads only the committed range ' +
        'reviews nothing on the path this skill is actually used on');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('several remotes and no upstream: REFUSES, and says how to resolve it', () => {
    // The guess this must not make. Two remotes and a detached HEAD is a real
    // lane state, and picking one would be a guess wearing a derivation's
    // clothes — the review would then read a range nobody chose and report
    // "no findings" about code it never saw.
    const dir = repoWith({ one: 'https://example.invalid/a.git', two: 'https://example.invalid/b.git' },
      ['one/main', 'two/main']);
    try {
      const { rc, out } = runIn(dir);
      assert.equal(rc, 2, `must refuse, not choose:\n${out}`);
      assert.match(out, /REFUSING/);
      assert.match(out, /2 remotes/, 'it names what it found');
      assert.match(out, /name the base yourself/, 'and what the reader can do about it');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('a remote whose HEAD is unset still works — via main, and it SAYS so', () => {
    // `refs/remotes/<r>/HEAD` is written by `clone` or an explicit `set-head`
    // and is absent in plenty of worktrees, so its absence must not be an
    // error. But it must not silently become `main` either: the fallback is
    // checked to EXIST first, and which route was taken is printed, so a reader
    // of the review can tell a derivation from a default.
    const dir = repoWith({ solo: 'https://example.invalid/a.git' }, ['solo/main']);
    try {
      const { rc, out } = runIn(dir);
      assert.equal(rc, 0, out);
      assert.match(out, /BRANCH=main/);
      assert.match(out, /VIA=fallback: solo\/HEAD is unset, solo\/main exists/,
        `the route must be visible in the output, got:\n${out}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('a remote whose name contains `#` is stripped LITERALLY, not through sed', () => {
    // FOUND BY THIS SKILL'S OWN FIRST REVIEW OF ITSELF, and reachability was
    // tested before it was called a finding: `git remote add 'a#b' <url>` is
    // ACCEPTED — a remote name is a refname and refnames may contain `#`.
    //
    // The first cut stripped the prefix with `sed "s#^$remote/##"`, whose `#`
    // delimiters then fall in the wrong places. It does not error: it prints
    // `b/#b/main`. The script would then refuse two lines later with "is the
    // remote fetched?" — a true-looking answer to the wrong question, which
    // sends a reader to check the network for a quoting bug.
    const dir = repoWith({ 'a#b': 'https://example.invalid/a.git' }, ['a#b/main']);
    try {
      execFileSync('git', ['symbolic-ref', 'refs/remotes/a#b/HEAD', 'refs/remotes/a#b/main'],
        { cwd: dir, stdio: 'pipe' });
      const { rc, out } = runIn(dir);
      assert.equal(rc, 0, `a legal remote name must not break the deriver:\n${out}`);
      assert.match(out, /^BRANCH=main$/m, `the prefix must be stripped literally, got:\n${out}`);
      assert.match(out, /^VIA=remote HEAD$/m, 'and via the real HEAD, not a fallback that never happened');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('a git diff that FAILS is not reported as an empty diff', () => {
    // The fallback species inside the file whose purpose is refusing it: a
    // failing `git diff` prints nothing, `grep -c .` counts nothing, and a
    // broken range reads as "no change to review" — silence indistinguishable
    // from a clean tree.
    //
    // THE FIRST VERSION OF THIS DOOR PASSED FOR THE WRONG REASON, and the
    // mutation pass is what said so: it deleted `.git/objects` wholesale, which
    // makes `git merge-base` fail two lines EARLIER, so the script refused
    // without the diff ever running and the door was green against the
    // unguarded code. The fixture now removes ONLY the tip commit's TREE:
    // merge-base walks commits and still succeeds, `git diff` needs the tree
    // and cannot.
    const dir = repoWith({ solo: 'https://example.invalid/a.git' }, ['solo/main']);
    try {
      const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
      writeFileSync(join(dir, 'second.txt'), 'a second commit so base != HEAD\n');
      git('add', 'second.txt');
      git('commit', '-q', '-m', 'tip');
      const tree = git('rev-parse', 'HEAD^{tree}').trim();
      rmSync(join(dir, '.git', 'objects', tree.slice(0, 2), tree.slice(2)), { force: true });

      // The fixture must be proved to be the case it claims: merge-base still
      // works, the diff does not. Otherwise this door drifts back to passing
      // for the wrong reason the moment git changes what it reads.
      git('merge-base', 'solo/main', 'HEAD');
      assert.throws(() => git('diff', '--name-only', 'solo/main..HEAD'),
        'fixture check: the diff must actually be the thing that fails');

      const { rc, out } = runIn(dir);
      assert.notEqual(rc, 0, `a diff that cannot run must not report zero files:\n${out}`);
      assert.match(out, /REFUSING: .*git diff/, `and must name WHICH read failed:\n${out}`);
      assert.doesNotMatch(out, /^FILES=/m, 'never a count it could not measure');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('a remote with no default branch at all REFUSES rather than inventing one', () => {
    const dir = repoWith({ solo: 'https://example.invalid/a.git' }, []);
    try {
      const { rc, out } = runIn(dir);
      assert.equal(rc, 2, `nothing to diff against is a refusal, not a clean review:\n${out}`);
      assert.match(out, /neither solo\/main nor solo\/master exists/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('no remote at all REFUSES', () => {
    const dir = repoWith({}, []);
    try {
      const { rc, out } = runIn(dir);
      assert.equal(rc, 2, out);
      assert.match(out, /no remote/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
