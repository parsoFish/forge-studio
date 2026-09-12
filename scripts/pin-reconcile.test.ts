/**
 * `pin-reconcile.sh` must refuse a tree that is not AT the `<to-sha>`
 * (bead `forge-8vfn.6.9.2`, T1 ruling 258).
 *
 * §15.169 says to reconcile only from a tree asserted at the to-sha, and it
 * fired on its own author in M5-A: a confident `0 → 0` produced from the
 * MERGE'S PARENT for a merge that changed five pinned files. The rehash reads
 * `sha256sum` of the working tree, so a tree one commit behind hashes the OLD
 * bytes — and prints a clean verdict for a pin it has just made wrong. Same
 * shape as everything else this milestone has paid for: the check ran, and
 * answered about the wrong thing.
 *
 * A rule that lives only in prose is decoration. This puts it in the script.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const RECONCILE = join(
  import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts', 'pin-reconcile.sh',
);

const git = (repo: string, ...args: string[]) =>
  spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });

/** A repo with two commits, and a manifest pinning `pinned.txt` at commit 1's bytes. */
function plant() {
  const root = mkdtempSync(join(tmpdir(), 'pin-head-'));
  const repo = join(root, 'repo');
  const g = join(root, 'camp', 'gate-manifests');
  mkdirSync(repo, { recursive: true });
  mkdirSync(g, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 't@t');
  git(repo, 'config', 'user.name', 'T');
  writeFileSync(join(repo, 'pinned.txt'), 'one\n', 'utf8');
  git(repo, 'add', 'pinned.txt');
  git(repo, 'commit', '-qm', 'one');
  const first = git(repo, 'rev-parse', 'HEAD').stdout.trim();
  // Hash commit ONE's bytes HERE, while they are still on disk. Taking it after
  // the second commit pinned the NEW hash, so `sha256sum -c` read 0 FAILED and
  // the positive control asserted nothing — the same shape as the pin that let
  // seven files drift, reproduced in this file's own first draft.
  const h1 = spawnSync('sha256sum', ['pinned.txt'], { cwd: repo, encoding: 'utf8' }).stdout.split(' ')[0];
  writeFileSync(join(g, 'M5-B.sha256'), `${h1}  pinned.txt\n`, 'utf8');
  // A `.counts` WITH an owner, which is every live manifest's real state.
  // `forge-8vfn.7.6.30`(c) makes an ownerless create REFUSE rather than write a
  // record no lane is accountable for, so a fixture with no `.counts` at all now
  // exercises the refusal instead of the happy path — see the test that asserts it.
  writeFileSync(join(g, 'M5-B.counts'), 'paths=1 manifest=0000000000000000 head=deadbeef tree=/somewhere owner=M5-B\n', 'utf8');
  writeFileSync(join(repo, 'pinned.txt'), 'two\n', 'utf8');
  git(repo, 'add', 'pinned.txt');
  git(repo, 'commit', '-qm', 'two');
  const second = git(repo, 'rev-parse', 'HEAD').stdout.trim();
  return { root, repo, camp: join(root, 'camp'), g, first, second };
}

function reconcile(repo: string, camp: string, from: string, to: string) {
  const r = spawnSync('bash', [RECONCILE, repo, camp, 'M5-B', from, to, 'a label'], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

test('AT-6.9.2-1 (RED) a tree ONE COMMIT BEHIND the to-sha is refused, and both SHAs are named', () => {
  const { root, repo, camp, g, first, second } = plant();
  try {
    // The exact §15.169 shape: reconcile "to" the merge while standing on its parent.
    git(repo, 'checkout', '-q', first);
    const before = readFileSync(join(g, 'M5-B.sha256'), 'utf8');

    const { code, out } = reconcile(repo, camp, first, second);

    assert.notEqual(code, 0, `it must refuse, not reconcile. Output: ${out}`);
    assert.match(out, new RegExp(first.slice(0, 8)), `the tree's actual HEAD must be named. Output: ${out}`);
    assert.match(out, new RegExp(second.slice(0, 8)), `and the to-sha it was asked for. Output: ${out}`);
    assert.equal(
      readFileSync(join(g, 'M5-B.sha256'), 'utf8'),
      before,
      'a refused run must not have touched the manifest',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('AT-6.9.2-2 (positive control) a tree AT the to-sha reconciles as before', () => {
  const { root, repo, camp, g, first, second } = plant();
  try {
    // Standing on the to-sha, `pinned.txt` reads "two" while the manifest pins
    // "one" — exactly the stale entry a merge leaves, and the one this script
    // exists to rehash.
    const { code, out } = reconcile(repo, camp, first, second);
    assert.equal(code, 0, `Output: ${out}`);
    assert.match(out, /FAILED 1 → 0/, `it must rehash the touched entry and say so. Output: ${out}`);
    const h2 = spawnSync('sha256sum', ['pinned.txt'], { cwd: repo, encoding: 'utf8' }).stdout.split(' ')[0];
    assert.match(readFileSync(join(g, 'M5-B.sha256'), 'utf8'), new RegExp(h2), 'the new hash landed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('AT-6.9.2-3 the to-sha may be given SHORT — a prefix of the real HEAD is the same commit', () => {
  const { root, repo, camp, first, second } = plant();
  try {
    const { code, out } = reconcile(repo, camp, first, second.slice(0, 8));
    assert.equal(code, 0, `a short to-sha naming this very commit must not be refused. Output: ${out}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// T1 ruling 707 — a rehash that does not advance `head=` leaves the manifest
// describing a tree it does not describe.
//
// MEASURED: C's precheck named `agent-dispatch-containment.test.ts` as C's drift
// because `M6-D.counts` still read `head=c1a751ea` while `M6-D.sha256` pinned
// main's current bytes. Every lane's skew test reads that field, so a stale one
// turns one lane's correct re-pin into another lane's phantom drift.
//
// §15.400 — what else could make these pass? Writing `head=` unconditionally
// would satisfy the first two and quietly break the third and fourth, so the
// untouched-manifest and still-FAILED cases are asserted, not assumed.
// ---------------------------------------------------------------------------

test('707 as amended by 7.6.30(c): an ABSENT .counts is REFUSED, not created ownerless', () => {
  // 707 had this branch CREATE the file, and the script's own comment admitted
  // `owner` "is not knowable from this script and is left to the lane" — then
  // wrote it anyway. An ownerless `.counts` is a record nobody is accountable
  // for and it reads exactly like a complete one. T1 ruling 762 makes it refuse.
  //
  // The head= half of 707 is unchanged and is asserted by the test below; what
  // this test now pins is that the file is NOT invented.
  const { root, repo, camp, g, first, second } = plant();
  try {
    rmSync(join(g, 'M5-B.counts'));
    const r = reconcile(repo, camp, first, second);
    assert.notEqual(r.code, 0, `expected a refusal, got rc 0:\n${r.out}`);
    assert.match(r.out, /owner=/, 'the refusal names the missing field');
    assert.match(r.out, /M5-B\.counts/, 'and the path the lane must write');
    assert.equal(existsSync(join(g, 'M5-B.counts')), false, 'and no ownerless file is left behind');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('707: an EXISTING head= is advanced, not duplicated', () => {
  const { root, repo, camp, g, first, second } = plant();
  try {
    writeFileSync(join(g, 'M5-B.counts'), 'paths=1 head=deadbeef tree=/somewhere\n', 'utf8');
    const r = reconcile(repo, camp, first, second);
    assert.equal(r.code, 0, r.out);
    const counts = readFileSync(join(g, 'M5-B.counts'), 'utf8');
    assert.match(counts, new RegExp(`head=${second.slice(0, 8)}`));
    assert.equal(/deadbeef/.test(counts), false, 'the stale sha must be gone, not accompanied');
    assert.equal((counts.match(/head=/g) ?? []).length, 1, 'exactly one head= field, never two to disagree');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('707 as amended by 7.6.30(b): an untouched manifest that does NOT verify is still left alone', () => {
  // 707's REASON survives 762 intact and is the point of this test: `head=` must
  // never claim a verification the run did not perform. What changed is that the
  // run now PERFORMS one — an untouched manifest is verified rather than skipped,
  // because "nothing to rehash" and "not checked" were being recorded
  // identically (A's M6-A sat at head=106ca1c4 while verifying clean at
  // eabc0152). Here M5-C pins a hash that does NOT match, so it fails
  // verification and its head= must stay put.
  const { root, repo, camp, g, first, second } = plant();
  try {
    writeFileSync(join(g, 'M5-C.sha256'), `${'0'.repeat(64)}  untouched.txt\n`, 'utf8');
    writeFileSync(join(g, 'M5-C.counts'), 'paths=1 head=deadbeef tree=/somewhere owner=M5-C\n', 'utf8');
    writeFileSync(join(repo, 'untouched.txt'), 'stable\n', 'utf8');
    const r = spawnSync('bash', [RECONCILE, repo, camp, 'M5-*', first, second, 'a label'], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.match(
      readFileSync(join(g, 'M5-C.counts'), 'utf8'),
      /head=deadbeef/,
      'a manifest that failed verification must not have its head= advanced — that would claim a ' +
        'verification the run performed and FAILED',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('707: a manifest still FAILED after the rehash does NOT get a head naming this tree', () => {
  const { root, repo, camp, g, first, second } = plant();
  try {
    // Pin a second path the merge DELETES: the script leaves that entry in
    // place (the gate reads it as missing, which is honest), so the manifest is
    // still non-zero after the rehash.
    writeFileSync(join(repo, 'doomed.txt'), 'x\n', 'utf8');
    const gone = spawnSync('sha256sum', ['doomed.txt'], { cwd: repo, encoding: 'utf8' }).stdout.split(' ')[0];
    writeFileSync(join(g, 'M5-B.sha256'), `${readFileSync(join(g, 'M5-B.sha256'), 'utf8').trim()}\n${gone}  doomed.txt\n`, 'utf8');
    git(repo, 'add', 'doomed.txt');
    git(repo, 'commit', '-qm', 'add doomed');
    const withDoomed = git(repo, 'rev-parse', 'HEAD').stdout.trim();
    rmSync(join(repo, 'doomed.txt'));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'delete doomed');
    const afterDelete = git(repo, 'rev-parse', 'HEAD').stdout.trim();

    const r = reconcile(repo, camp, withDoomed, afterDelete);
    assert.equal(r.code, 0, r.out);
    const counts = readFileSync(join(g, 'M5-B.counts'), 'utf8');
    assert.equal(
      new RegExp(`head=${afterDelete.slice(0, 8)}`).test(counts),
      false,
      'head= records a tree the manifest VERIFIED against; naming one it still fails is the ' +
        'stale-head defect pointing the other way',
    );
    assert.match(counts, /still FAILED|not verified/i, 'and the .counts must say why it was not advanced');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


// ---------------------------------------------------------------------------
// forge-8vfn.7.6.30 (T1 rulings 762/764) — the four ways the record could
// disagree with itself. A second fixture, because these need TWO manifests (one
// the merge touched, one it did not) and `plant()` above builds one.
//
// The §15.169 refusal is NOT re-tested here: AT-6.9.2-1 above already pins it,
// and a second copy would be a door that agrees with another door rather than
// with the program.
// ---------------------------------------------------------------------------
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const digest16 = (file: string) => sha256(readFileSync(file, 'utf8')).slice(0, 16);

/** A repo with two commits, and a campaign dir whose manifest pins one file. */
function plantPair(opts: { counts?: string; extraManifest?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'pin-rec-'));
  const repo = join(root, 'repo');
  const camp = join(root, 'camp');
  const G = join(camp, 'gate-manifests');
  mkdirSync(repo, { recursive: true });
  mkdirSync(G, { recursive: true });

  const git = (...a: string[]) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
  git('init', '-q', '.');
  git('config', 'user.email', 'a@b');
  git('config', 'user.name', 'c');
  writeFileSync(join(repo, 'pinned.txt'), 'before\n');
  writeFileSync(join(repo, 'untouched.txt'), 'stable\n');
  git('add', 'pinned.txt', 'untouched.txt');
  git('commit', '-qm', 'one');
  const from = git('rev-parse', 'HEAD');
  writeFileSync(join(repo, 'pinned.txt'), 'after\n');
  git('add', 'pinned.txt');
  git('commit', '-qm', 'two');
  const to = git('rev-parse', 'HEAD');

  // TOUCHED: the manifest that names the file the merge changed.
  writeFileSync(join(G, 'M-T.sha256'), `${sha256('before\n')}  pinned.txt\n`);
  if (opts.counts !== undefined) writeFileSync(join(G, 'M-T.counts'), opts.counts);

  // UNTOUCHED: names only a file the merge did not change. Today the script
  // skips it entirely, so its `head=` never advances and "nothing to rewrite"
  // is recorded identically to "not checked".
  if (opts.extraManifest === true) {
    writeFileSync(join(G, 'M-U.sha256'), `${sha256('stable\n')}  untouched.txt\n`);
    writeFileSync(join(G, 'M-U.counts'), `paths=1 manifest=deadbeefdeadbeef head=00000000 tree=${repo} owner=M-U\n`);
  }
  return { root, repo, camp, G, from, to };
}

const runPair = (f: ReturnType<typeof plantPair>, glob = 'M-*') =>
  spawnSync('bash', [RECONCILE, f.repo, f.camp, glob, f.from.slice(0, 8), f.to.slice(0, 8), 'test label'],
    { encoding: 'utf8' });

test('7.6.30(a): a reconcile that rewrites the .sha256 rewrites manifest= to match it', () => {
  // 680 added `manifest=` to prove a `.counts` and its `.sha256` are ONE PAIR.
  // Nothing rewrote it, so A's audit at #666 found it stale on M6-A/M6-C/M6-T1
  // and absent on M1-C-S4..S8 and M6-D: the field certified a file that no
  // longer existed. It is the third of a family — `head=`, `pin=`, `manifest=`
  // — recorded claims that nothing recomputes.
  const f = plantPair({ counts: 'paths=1 manifest=0000000000000000 head=00000000 tree=/x owner=M-T\n' });
  const r = runPair(f);
  assert.equal(r.status, 0, r.stderr);
  const counts = readFileSync(join(f.G, 'M-T.counts'), 'utf8');
  const want = digest16(join(f.G, 'M-T.sha256'));
  assert.match(counts, new RegExp(`manifest=${want}\\b`), `manifest= must be the digest of the rewritten .sha256\n${counts}`);
  assert.doesNotMatch(counts, /manifest=0000000000000000/);
  assert.match(counts, new RegExp(`head=${f.to.slice(0, 8)}`), 'and head= still advances');
});

test('7.6.30(a): manifest= is WRITTEN when absent, not just refreshed when present', () => {
  // M1-C-S4..S8 and M6-D carry no `manifest=` at all. A fix that only refreshed
  // an existing field would leave six of fourteen manifests unprovable.
  const f = plantPair({ counts: `paths=1 head=00000000 tree=/x owner=M-T\n` });
  const r = runPair(f);
  assert.equal(r.status, 0, r.stderr);
  const counts = readFileSync(join(f.G, 'M-T.counts'), 'utf8');
  assert.match(counts, new RegExp(`manifest=${digest16(join(f.G, 'M-T.sha256'))}\\b`), counts);
});

test('7.6.30(b): a manifest verified clean WITHOUT a rehash still gets head= advanced', () => {
  // A's case at #668: `pin-reconcile` printed NOTHING and left M6-A at
  // `head=106ca1c4` while the manifest verified clean at `eabc0152`, because it
  // only advances the field on a manifest it actually rehashed. "Nothing to
  // rewrite" and "not checked" look identical in the record — and the skew test
  // every lane runs reads that field.
  const f = plantPair({ counts: 'paths=1 manifest=0000000000000000 head=00000000 tree=/x owner=M-T\n', extraManifest: true });
  const r = runPair(f);
  assert.equal(r.status, 0, r.stderr);
  const u = readFileSync(join(f.G, 'M-U.counts'), 'utf8');
  assert.match(u, new RegExp(`head=${f.to.slice(0, 8)}`), `an untouched but VERIFIED manifest advances too:\n${u}`);
  assert.match(u, new RegExp(`manifest=${digest16(join(f.G, 'M-U.sha256'))}\\b`), u);
  assert.match(r.stdout, /M-U/, 'and it says so — a silent advance is the defect pointing the other way');
});

test('7.6.30(b): a manifest that does NOT verify clean keeps its old head=', () => {
  // The converse, held beside it so the pair cannot drift: `head=` means "last
  // verified 0-FAILED against". Advancing it on a manifest nobody verified is
  // the same lie pointing the other way.
  const f = plantPair({ counts: 'paths=1 manifest=0000000000000000 head=00000000 tree=/x owner=M-T\n', extraManifest: true });
  writeFileSync(join(f.G, 'M-U.sha256'), `${sha256('SOMETHING ELSE\n')}  untouched.txt\n`);
  const r = runPair(f);
  assert.equal(r.status, 0, r.stderr);
  const u = readFileSync(join(f.G, 'M-U.counts'), 'utf8');
  assert.match(u, /head=00000000/, `a FAILING manifest must not advance:\n${u}`);
  assert.doesNotMatch(u, new RegExp(`head=${f.to.slice(0, 8)}`), u);
});

test('7.6.30(c): creating a .counts with no owner= REFUSES, and names the path and sha', () => {
  // The script's own comment said `owner` "is not knowable from this script and
  // is left to the lane" — and then wrote the file anyway, ownerless. An
  // ownerless `.counts` is a record nobody is accountable for, and it reads
  // exactly like a complete one.
  const f = plantPair(); // no .counts at all → the create branch
  const r = runPair(f);
  assert.notEqual(r.status, 0, `expected a refusal, got rc 0:\n${r.stdout}`);
  const out = r.stdout + r.stderr;
  assert.match(out, /owner=/, 'the refusal names the missing field');
  assert.match(out, /M-T\.counts/, 'and the path the lane must write');
  assert.match(out, new RegExp(digest16(join(f.G, 'M-T.sha256'))), 'and the manifest digest, so the lane need not recompute it');
  assert.ok(!existsSync(join(f.G, 'M-T.counts')), 'and it writes no ownerless file');
});

test('7.6.30(d): the amendment line lands in the NEWEST amend file, by version not by string', () => {
  // `ls … | tail -1` sorts lexically, so `amend-9.md` beats `amend-18.md`.
  // Measured on the live campaign before the fix: 40 reconcile amendment lines
  // had accumulated in `M6-A.amend-9.md` and 76 in `M6-C.amend-9.md` — every
  // amendment since the tenth, for both lanes. M6-B/M6-D/M6-T1 were unaffected
  // only because none had yet reached ten files.
  const f = plantPair({ counts: 'paths=1 manifest=0000000000000000 head=00000000 tree=/x owner=M-T\n' });
  for (const n of [1, 2, 9, 10, 18]) writeFileSync(join(f.G, `M-T.amend-${n}.md`), `# amendment ${n}\n`);
  const r = runPair(f);
  assert.equal(r.status, 0, r.stderr);
  const newest = readFileSync(join(f.G, 'M-T.amend-18.md'), 'utf8');
  const lexical = readFileSync(join(f.G, 'M-T.amend-9.md'), 'utf8');
  assert.match(newest, /Amendment \(at/, `the line belongs in amend-18:\n${newest}`);
  assert.doesNotMatch(lexical, /Amendment \(at/, `and NOT in amend-9:\n${lexical}`);
});
