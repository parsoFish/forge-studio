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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
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
  // `untouched.txt` is TRACKED from the first commit as of 7.6.85. It used to be
  // written by one test and never added, so it was `??` — and 7.6.85 refuses a
  // pinned path that is dirty, untracked included, because hashing one records a
  // hash for bytes NO COMMIT holds. Tracking it here keeps that test's subject
  // (does an untouched manifest that fails verification keep its `head=`?)
  // isolated from a tracking question it never meant to ask, and keeps HEAD at
  // `second` so the §15.169 refusal is not tripped either.
  writeFileSync(join(repo, 'untouched.txt'), 'stable\n', 'utf8');
  git(repo, 'add', 'pinned.txt', 'untouched.txt');
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
  // 793: `tree=` must name the repo that verifies it, or the write is refused —
  // a `.counts` asserting a checkout that never performed the verification is
  // the defect that ruling refuses.
  writeFileSync(join(g, 'M5-B.counts'), `paths=1 manifest=0000000000000000 head=deadbeef tree=${repo} owner=M5-B\n`, 'utf8');
  writeFileSync(join(repo, 'pinned.txt'), 'two\n', 'utf8');
  git(repo, 'add', 'pinned.txt');
  git(repo, 'commit', '-qm', 'two');
  const second = git(repo, 'rev-parse', 'HEAD').stdout.trim();
  return { root, repo, camp: join(root, 'camp'), g, first, second };
}

function reconcile(repo: string, camp: string, from: string, to: string) {
  // 7.6.49: FORGE_LANE is required and bounds WRITES to that lane's manifests.
  // `plant()` owns M5-B, so these reconcile as M5-B.
  const r = spawnSync('bash', [RECONCILE, repo, camp, 'M5-B', from, to, 'a label'],
    { encoding: 'utf8', env: { ...process.env, FORGE_LANE: 'M5-B' } });
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
    writeFileSync(join(g, 'M5-B.counts'), `paths=1 head=deadbeef tree=${repo} owner=M5-B\n`, 'utf8');
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
    // Same owner as M5-B: this test is about whether an UNTOUCHED manifest is
    // verified, not about the 7.6.49 ownership bound, which has its own doors.
    writeFileSync(join(g, 'M5-C.counts'), `paths=1 head=deadbeef tree=${repo} owner=M5-B\n`, 'utf8');
    writeFileSync(join(repo, 'untouched.txt'), 'stable\n', 'utf8');
    // Same bytes `plant()` committed, so the path is clean (7.6.85's refusal).
    const r = spawnSync('bash', [RECONCILE, repo, camp, 'M5-*', first, second, 'a label'],
      { encoding: 'utf8', env: { ...process.env, FORGE_LANE: 'M5-B' } });
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
function plantPair(opts: { counts?: string; extraManifest?: boolean; staleTree?: boolean } = {}) {
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
  // 793: whatever the test asks for, `tree=` names the repo that will verify it —
  // otherwise every fixture trips the cross-checkout refusal rather than the
  // behaviour under test.
  // `staleTree` opts OUT of that normalisation — 7.6.57's whole subject is a
  // `.counts` whose `tree=` names a checkout that is not the one rehashing.
  if (opts.counts !== undefined) {
    writeFileSync(join(G, 'M-T.counts'),
      opts.staleTree === true ? opts.counts : opts.counts.replace(/tree=\S+/, `tree=${repo}`));
  }

  // UNTOUCHED: names only a file the merge did not change. Today the script
  // skips it entirely, so its `head=` never advances and "nothing to rewrite"
  // is recorded identically to "not checked".
  if (opts.extraManifest === true) {
    writeFileSync(join(G, 'M-U.sha256'), `${sha256('stable\n')}  untouched.txt\n`);
    // owner=M-T deliberately: this manifest exists to test UNTOUCHED-manifest
    // verification (7.6.30(b)), and 7.6.49's ownership bound has its own doors.
    // A fixture that trips a different rule tests that rule, not the one named.
    writeFileSync(join(G, 'M-U.counts'), `paths=1 manifest=deadbeefdeadbeef head=00000000 tree=${repo} owner=M-T\n`);
  }
  return { root, repo, camp, G, from, to };
}

const runPair = (f: ReturnType<typeof plantPair>, glob = 'M-*') =>
  spawnSync('bash', [RECONCILE, f.repo, f.camp, glob, f.from.slice(0, 8), f.to.slice(0, 8), 'test label'],
    { encoding: 'utf8', env: { ...process.env, FORGE_LANE: 'M-T' } });

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
  // AMENDED by 992: this line used to assert the digest of `M-T.sha256` was
  // printed "so the lane need not recompute it" — but the digest it printed was
  // of a file the tool had ALREADY rehashed without an owner, and once the
  // refusal moved ahead of the rehash the file's digest is the one about to
  // change. A digest of bytes the owner's own run will replace is not what the
  // lane needs; the message now says manifest= is recomputed by that run.
  assert.match(out, /manifest= is recomputed/, 'and says the digest comes from the owner\'s own run');
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

// ---------------------------------------------------------------------------
// forge-8vfn.7.6.49 (rulings 781/792/793) — WRITES are bounded to the invoking
// lane; detection stays wide. 745 ruled this; 7.6.30 shipped only its
// prerequisite (refuse to CREATE an ownerless `.counts`), and the glob argument
// quietly became a WRITE scope that three lanes each reached for out of habit.
// ---------------------------------------------------------------------------

const runAs = (f: ReturnType<typeof plantPair>, lane: string | undefined, glob = 'M-*') =>
  spawnSync('bash', [RECONCILE, f.repo, f.camp, glob, f.from.slice(0, 8), f.to.slice(0, 8), 'test label'],
    { encoding: 'utf8', env: lane === undefined ? { ...process.env, FORGE_LANE: '' } : { ...process.env, FORGE_LANE: lane } });

/** Two manifests with DIFFERENT owners, both touched by the merge. */
function plantTwoOwners() {
  const f = plantPair({ counts: `paths=1 manifest=0000000000000000 head=00000000 tree=REPO owner=M-T\n` });
  writeFileSync(join(f.G, 'M-T.counts'), `paths=1 manifest=0000000000000000 head=00000000 tree=${f.repo} owner=M-T\n`);
  // A second manifest owned by somebody else, pinning the same changed file.
  writeFileSync(join(f.G, 'M-OTHER.sha256'), `${sha256('before\n')}  pinned.txt\n`);
  writeFileSync(join(f.G, 'M-OTHER.counts'), `paths=1 manifest=0000000000000000 head=00000000 tree=${f.repo} owner=M-OTHER\n`);
  return f;
}

test('7.6.49: a manifest owned by ANOTHER lane is printed and REFUSED, not written', () => {
  const f = plantTwoOwners();
  const r = runAs(f, 'M-T');
  const mine = readFileSync(join(f.G, 'M-T.counts'), 'utf8');
  const theirs = readFileSync(join(f.G, 'M-OTHER.counts'), 'utf8');

  assert.match(mine, new RegExp(`head=${f.to.slice(0, 8)}`), `my own manifest IS written:\n${mine}`);
  assert.match(theirs, /head=00000000/, `another lane's manifest must be untouched:\n${theirs}`);
  assert.match(r.stdout + r.stderr, /M-OTHER/, 'and it is NAMED, not silently skipped');
  assert.match(r.stdout + r.stderr, /owner=M-OTHER|not.*M-T|refus/i, 'with the reason');
  assert.notEqual(r.status, 0, 'the run exits non-zero so a refusal cannot pass for a clean sweep');
});

test('7.6.49: detection stays WIDE — the refused manifest is still VERIFIED and reported', () => {
  // 745's shape: wide detection, narrow writes. A lane must still learn that a
  // sibling's manifest went stale at its merge (§15.105) — it just may not fix it.
  const f = plantTwoOwners();
  const out = runAs(f, 'M-T').stdout + runAs(f, 'M-T').stderr;
  assert.match(out, /M-OTHER/, 'the sibling manifest appears in the report');
});

test('7.6.49: FORGE_LANE is REQUIRED — no lane, no writes at all', () => {
  // Same reasoning as the writes-by-session map and the ignore classifier: a
  // caller that did not say who it is cannot be checked against owner=, and an
  // unchecked write is the defect this bead exists for.
  const f = plantTwoOwners();
  const r = runAs(f, undefined);
  assert.notEqual(r.status, 0, `expected a refusal, got rc 0:\n${r.stdout}`);
  assert.match(r.stdout + r.stderr, /FORGE_LANE/, 'the refusal names the variable');
  assert.match(readFileSync(join(f.G, 'M-T.counts'), 'utf8'), /head=00000000/, 'and nothing is written');
});

test('7.6.57 (AMENDS 7.6.49/793): the OWNER repairs its own stale tree= — it is no longer refused', () => {
  // WHAT 793 ESTABLISHED, unchanged: the tool writes `head=` from the repo it
  // runs in and used to leave `tree=` as it was, so a cross-lane reconcile
  // produced `tree=/home/parso/forge-m6-d head=da33ac5b` — asserting D's tree
  // was clean at a sha it never held. My own M6-A read TRUE under the same
  // broken step because the named checkout happened to be at that sha: the
  // defect produces true and false records indistinguishably.
  //
  // WHAT 806 CHANGED, and why this door's assertion INVERTED. 793's refusal is
  // right about a stranger's tree and wrong about your own. Dogfooding 7.6.49 a
  // minute after it went live, `M6-A.counts` still carried
  // `tree=/home/parso/forge` from the wrapper era (730), so A's own reconcile
  // from A's own worktree was blocked and the only route left was a hand edit of
  // the field this tool exists to own. Every `.counts` written in that era
  // carries the same latent block.
  //
  // Repairing is safe HERE precisely because the rehash happened in this repo:
  // the owner records the verification it just performed rather than asserting
  // someone else's. The cross-lane half of 793 is untouched and has its own
  // door below.
  const f = plantTwoOwners();
  writeFileSync(join(f.G, 'M-T.counts'),
    `paths=1 manifest=0000000000000000 head=00000000 tree=/somewhere/else owner=M-T\n`);
  const r = runAs(f, 'M-T');
  // NOT `status === 0`: `plantTwoOwners` also plants `M-OTHER`, which this run
  // correctly refuses, so the exit code is a fact about THAT manifest and not
  // about the one under test. Asserting it here would bind this door to the
  // fixture's other half — the refusal named below is the precise claim.
  assert.match(r.stdout, /tree= REPAIRED/, `the owner's own repair must proceed:\n${r.stdout}${r.stderr}`);
  assert.doesNotMatch(r.stderr, /M-T: REFUSED/, `M-T's own manifest must not be among the refusals:\n${r.stderr}`);
  assert.match(r.stderr, /M-OTHER: REFUSED/, 'while the foreign one still is');
  assert.match(r.stdout, /\/somewhere\/else/, 'naming the tree it replaced');
  const counts = readFileSync(join(f.G, 'M-T.counts'), 'utf8');
  assert.match(counts, new RegExp(`tree=${f.repo}(\\s|$)`), `tree= now names the repo that rehashed:\n${counts}`);
  assert.doesNotMatch(counts, /somewhere\/else/, 'the stale value is gone, not appended beside it');
  assert.match(counts, new RegExp(`head=${f.to.slice(0, 8)}`), 'and the write it was blocking went through');
});

test('7.6.49/793: when it DOES write, tree= and head= are set together from the same checkout', () => {
  const f = plantTwoOwners();
  const r = runAs(f, 'M-T');
  const mine = readFileSync(join(f.G, 'M-T.counts'), 'utf8');
  assert.match(mine, new RegExp(`head=${f.to.slice(0, 8)}`));
  assert.match(mine, new RegExp(`tree=${f.repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    `tree= must name the repo that produced the head:\n${mine}`);
  assert.equal((mine.match(/tree=/g) ?? []).length, 1, 'exactly one tree= field');
  assert.ok(r.status !== undefined);
});

test('7.6.49 (D 796): a .counts is BACKED UP, so its prior value is a read and not a reconstruction', () => {
  // The script has always written `<manifest>.sha256.pre-<to>` and never a
  // `.counts` backup, so two lanes reconstructed a prior `head=` from a stale
  // gate log and a command's stdout, and one got it wrong.
  const f = plantTwoOwners();
  runAs(f, 'M-T');
  const backups = readdirSync(f.G).filter((n) => n.startsWith('M-T.counts.pre-'));
  assert.equal(backups.length, 1, `expected one .counts backup, saw: ${backups.join(', ')}`);
  assert.match(readFileSync(join(f.G, backups[0]), 'utf8'), /head=00000000/, 'holding the PRIOR value');
});

test('7.6.49/793: a .counts with NO tree= gains one naming the verifying repo', () => {
  // The load-bearing half of the tree= write. A `.counts` that HAS a `tree=`
  // can only be written when it already equals the running repo — the 793
  // refusal guarantees it — so rewriting it is a no-op, proved by mutation.
  // A `.counts` with NO `tree=` passes the refusal (nothing to contradict) and
  // would otherwise carry a `head=` with no record of which checkout verified it.
  const f = plantPair({ counts: 'paths=1 manifest=0000000000000000 head=00000000 owner=M-T\n' });
  writeFileSync(join(f.G, 'M-T.counts'), 'paths=1 manifest=0000000000000000 head=00000000 owner=M-T\n');
  const r = runPair(f);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const mine = readFileSync(join(f.G, 'M-T.counts'), 'utf8');
  assert.match(mine, new RegExp(`tree=${f.repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), mine);
  assert.equal((mine.match(/tree=/g) ?? []).length, 1, 'exactly one tree= field');
});

test('7.6.49: --sweep is T1-ONLY — any other lane is refused by name', () => {
  // The escape hatch for the one role that legitimately writes every owner's
  // manifest. Gated, because an ungated sweep flag is the defect this bead
  // exists for with a shorter spelling.
  const f = plantTwoOwners();
  const r = spawnSync('bash',
    [RECONCILE, f.repo, f.camp, 'M-*', f.from.slice(0, 8), f.to.slice(0, 8), 'label', '--sweep'],
    { encoding: 'utf8', env: { ...process.env, FORGE_LANE: 'M-T' } });
  assert.notEqual(r.status, 0, `a lane that is not T1 must not sweep:\n${r.stdout}`);
  assert.match(r.stderr, /--sweep/, 'the refusal names the flag');
  assert.match(r.stderr, /T1/, 'and who may use it');
  assert.match(readFileSync(join(f.G, 'M-OTHER.counts'), 'utf8'), /head=00000000/, 'nothing written');
});

test('7.6.49: --sweep AS T1 writes another owner\'s manifest — the gate opens for the one role', () => {
  // The positive control. Without it the refusal above passes just as well
  // against a flag that never works for anybody.
  const f = plantTwoOwners();
  const r = spawnSync('bash',
    [RECONCILE, f.repo, f.camp, 'M-*', f.from.slice(0, 8), f.to.slice(0, 8), 'label', '--sweep'],
    { encoding: 'utf8', env: { ...process.env, FORGE_LANE: 'T1' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(readFileSync(join(f.G, 'M-OTHER.counts'), 'utf8'),
    new RegExp(`head=${f.to.slice(0, 8)}`), 'T1 may write an owner it is not');
});

// ── 7.6.57 — the owner repairs its own stale tree=, and paths= is recomputed ──

test('7.6.57: a stale tree= belonging to ANOTHER lane is still REFUSED (793 untouched)', () => {
  // The repair is safe only because the rehash happened in THIS repo. A
  // non-owner reaching the same branch is asserting a verification someone
  // else's checkout performed, which is exactly what 793 exists to stop — and
  // that includes T1's `--sweep`, where `owner != LANE` by construction.
  const f = plantPair({ staleTree: true, counts: 'paths=1 manifest=0000000000000000 head=00000000 tree=/somewhere/else owner=M-OTHER\n' });
  const r = runPair(f);
  assert.notEqual(r.status, 0, `a stranger's manifest must not be written:\n${r.stdout}`);
  assert.match(r.stderr, /REFUSED/, r.stderr);
  const counts = readFileSync(join(f.G, 'M-T.counts'), 'utf8');
  assert.match(counts, /tree=\/somewhere\/else/, 'and the field is untouched — a refusal that still wrote is not a refusal');
  assert.match(counts, /head=00000000/, 'head= unchanged too');
});

test('7.6.57: paths= is RECOMPUTED from the .sha256, not carried', () => {
  // T1 (824): the tool never touched `paths=`, so after two rows were added to a
  // `.sha256` by hand the field read `paths=23` against 25 real rows — a count
  // describing an earlier version of the file it sits beside, and nothing
  // failed. The fixture's manifest has ONE row while the field claims 99.
  const f = plantPair({ counts: 'paths=99 manifest=0000000000000000 head=00000000 tree=/x owner=M-T\n' });
  const r = runPair(f);
  assert.equal(r.status, 0, r.stderr);
  const counts = readFileSync(join(f.G, 'M-T.counts'), 'utf8');
  assert.match(counts, /paths=1(\s|$)/, `one row in the .sha256 means paths=1:\n${counts}`);
  assert.doesNotMatch(counts, /paths=99/, 'the stale count is replaced, not left beside the new one');
});

// ── 7.6.85 — a dirty PINNED path is refused before anything is written ───────

test('7.6.85: a pinned path that is DIRTY refuses, and the manifest is byte-identical after', () => {
  // C ran A's #703 reconcile at porcelain 11. Nothing wrong was written — but
  // only because none of the eleven dirty paths was among the rehashed ones.
  // Had one been, the manifest would carry a hash for bytes main does not hold:
  // a wrong pin that reads CLEAN, because `sha256sum -c` passes against the
  // same dirty tree and fails only in a clean checkout, where it reads as a
  // SIBLING's drift rather than as this run's error.
  const f = plantPair({ counts: 'paths=1 manifest=0000000000000000 head=00000000 tree=/x owner=M-T\n' });
  const before = readFileSync(join(f.G, 'M-T.sha256'), 'utf8');
  const countsBefore = readFileSync(join(f.G, 'M-T.counts'), 'utf8');
  writeFileSync(join(f.repo, 'pinned.txt'), 'DIRTY — uncommitted\n');

  const r = runPair(f);
  assert.notEqual(r.status, 0, `a dirty pinned path must refuse:\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /REFUSING/, r.stderr);
  assert.match(r.stderr, /pinned\.txt/, 'the offending path is named, not just counted');
  // The refusal runs BEFORE any write, so both files are untouched — bytes, not
  // a field check: a refusal that still wrote is not a refusal.
  assert.equal(readFileSync(join(f.G, 'M-T.sha256'), 'utf8'), before, 'the .sha256 is byte-identical');
  assert.equal(readFileSync(join(f.G, 'M-T.counts'), 'utf8'), countsBefore, 'and so is the .counts');
});

test('7.6.85: a dirty UNRELATED path is NOT this tool\'s business — the run proceeds', () => {
  // Scope is the PINNED paths, not the repo. Every gate leaves story artifacts
  // behind, so refusing on any dirty file would make the tool unusable in a
  // working lane — which is the failure mode where a guard gets routed around.
  const f = plantPair({ counts: 'paths=1 manifest=0000000000000000 head=00000000 tree=/x owner=M-T\n' });
  writeFileSync(join(f.repo, 'not-pinned-by-anything.txt'), 'residue from a gate\n');

  const r = runPair(f);
  assert.equal(r.status, 0, `residue outside the manifests must not block a reconcile:\n${r.stdout}${r.stderr}`);
  assert.match(readFileSync(join(f.G, 'M-T.counts'), 'utf8'), new RegExp(`head=${f.to.slice(0, 8)}`),
    'and the reconcile actually happened');
});

test('7.6.85: HEAD that is not the <to> sha refuses, naming both', () => {
  // Already enforced before this bead (§15.169) — doored here because 7.6.85
  // names it as half the fix, and a rule with no door is a rule that can be
  // deleted by someone who does not know it was load-bearing.
  const f = plantPair({ counts: 'paths=1 manifest=0000000000000000 head=00000000 tree=/x owner=M-T\n' });
  const r = spawnSync('bash', [RECONCILE, f.repo, f.camp, 'M-*', f.from.slice(0, 8), f.from.slice(0, 8), 'wrong to'],
    { encoding: 'utf8', env: { ...process.env, FORGE_LANE: 'M-T' } });
  assert.notEqual(r.status, 0, r.stdout);
  assert.match(r.stderr, /REFUSING/, r.stderr);
  assert.match(r.stderr, new RegExp(f.to.slice(0, 8)), 'names the HEAD it found');
  assert.match(r.stderr, new RegExp(f.from.slice(0, 8)), 'and the to-sha it was given');
});

// ── 7.6.87 — a rehash is not an adoption (§15.502) ───────────────────────────

/** Its own repo rather than `plantPair`'s, because commit ORDER matters here:
 *  `pin-glob-check` expands globs over TRACKED files, so an extra file must be
 *  committed to be seen — and committing it after `to` would move HEAD past the
 *  to-sha and trip §15.169's refusal instead of the drift under test. My first
 *  cut wrote the file untracked and the door failed for that reason, which is
 *  the same fixture-carries-an-unintended-property shape as 7.6.85's. */
function plantWithGlobs(opts: { extraInGlobFile?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'pin-glob-'));
  const repo = join(root, 'repo');
  const camp = join(root, 'camp');
  const G = join(camp, 'gate-manifests');
  mkdirSync(join(repo, 'src'), { recursive: true });
  mkdirSync(G, { recursive: true });
  const git = (...a: string[]) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
  git('init', '-q', '.');
  git('config', 'user.email', 'a@b');
  git('config', 'user.name', 'c');
  writeFileSync(join(repo, 'pinned.txt'), 'before\n');
  writeFileSync(join(repo, 'src', 'listed.ts'), 'export const a = 1;\n');
  // The in-glob file NO manifest lists — committed HERE, before `to`, so it is
  // tracked (visible to the glob expansion) without moving HEAD past the to-sha.
  if (opts.extraInGlobFile === true) writeFileSync(join(repo, 'src', 'never-pinned.ts'), 'export const b = 2;\n');
  git('add', '-A');
  git('commit', '-qm', 'one');
  const from = git('rev-parse', 'HEAD');
  writeFileSync(join(repo, 'pinned.txt'), 'after\n');
  git('add', 'pinned.txt');
  git('commit', '-qm', 'two');
  const to = git('rev-parse', 'HEAD');

  writeFileSync(join(G, 'M-T.globs'), 'src/**/*.ts\n');
  writeFileSync(join(G, 'M-T.sha256'),
    `${sha256('before\n')}  pinned.txt\n${sha256('export const a = 1;\n')}  src/listed.ts\n`);
  writeFileSync(join(G, 'M-T.txt'), 'pinned.txt\nsrc/listed.ts\n');
  writeFileSync(join(G, 'M-T.counts'), `paths=2 manifest=0000000000000000 head=00000000 tree=${repo} owner=M-T\n`);
  return { root, repo, camp, G, from, to };
}

const runGlobs = (f: ReturnType<typeof plantWithGlobs>) =>
  spawnSync('bash', [RECONCILE, f.repo, f.camp, 'M-T', f.from.slice(0, 8), f.to.slice(0, 8), 'test label'],
    { encoding: 'utf8', env: { ...process.env, FORGE_LANE: 'M-T' } });

test('7.6.87: an unlisted in-glob file DRIFTS after the rehash, and the rehash still stands', () => {
  // Measured before this existed: four in-glob test files sat unpinned under
  // M6-C's globs for hours (three of them mine), plus one under M6-A's. Every
  // reconcile in between reported `0 FAILED`, and that was TRUE — an unlisted
  // file cannot fail. The pair of facts is what made it invisible.
  const f = plantWithGlobs({ extraInGlobFile: true });
  const r = runGlobs(f);

  assert.notEqual(r.status, 0, `drift must not exit 0:\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout + r.stderr, /never-pinned\.ts/, 'the unlisted path is NAMED, not merely counted');
  assert.match(r.stderr, /INCOMPLETE/, 'and the verdict says incomplete, not wrong');
  // THE REHASH STANDS. The hashes are right about the paths they cover; only the
  // coverage is short. A door that let the rehash be discarded would trade one
  // silent wrong state for another.
  assert.match(readFileSync(join(f.G, 'M-T.counts'), 'utf8'), new RegExp(`head=${f.to.slice(0, 8)}`),
    'head= still advanced — the rehash is not undone by the drift');
});

test('7.6.87: a manifest whose globs are fully listed PASSES and exits 0', () => {
  // The positive control. Without it, the door above would pass against a tool
  // that always exits non-zero — and "refuses everything" is not a guard.
  const f = plantWithGlobs();
  const r = runGlobs(f);
  assert.equal(r.status, 0, `a fully-listed manifest must reconcile cleanly:\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /every one listed|PASS/, `the check's own line is printed:\n${r.stdout}`);
});

test('7.6.87: .txt is REGENERATED from .sha256, not edited beside it', () => {
  // M6-C.txt sat at 190 rows against a 193-row .sha256: amendments updated the
  // machine listing and backed the human one up without editing it. No live
  // consumer reads .txt, which is exactly why it drifted unnoticed — and a
  // human listing that disagrees with the machine one is worse than none,
  // because it is the half a person checks.
  const f = plantWithGlobs();
  writeFileSync(join(f.G, 'M-T.txt'), 'STALE — not what .sha256 says\n');
  const r = runGlobs(f);
  assert.equal(r.status, 0, r.stderr);
  const expected = readFileSync(join(f.G, 'M-T.sha256'), 'utf8')
    .split('\n').filter(Boolean).map((l) => l.split(/\s+/)[1]).join('\n') + '\n';
  assert.equal(readFileSync(join(f.G, 'M-T.txt'), 'utf8'), expected,
    'byte-for-byte the paths column of .sha256, same order');
});

// ── 992 — the owner check runs BEFORE the first byte is written ──────────────

test('992: a manifest owned by ANOTHER lane is not REHASHED either — .sha256 byte-identical, no .pre- taken', () => {
  // 7.6.49's door above asserts `.counts` is untouched and never asked about
  // `.sha256`. Measured on M6-T1 after M6-D's #745 (glob `'M*'`, FORGE_LANE=M6-D):
  // the tool backed up and rewrote T1's two rows, THEN printed
  // `REFUSED — … Would have written … manifest=6f199368e1cb2fe6` — and that was
  // the file's ACTUAL fingerprint, a hypothetical describing a write already
  // performed. The owner's `.counts` then certified a `.sha256` that no longer
  // existed. A refusal that still wrote is not a refusal, for either file.
  const f = plantTwoOwners();
  const theirsBefore = readFileSync(join(f.G, 'M-OTHER.sha256'), 'utf8');
  const r = runAs(f, 'M-T');
  assert.notEqual(r.status, 0, 'the run still exits non-zero');
  assert.equal(readFileSync(join(f.G, 'M-OTHER.sha256'), 'utf8'), theirsBefore,
    'the stranger\'s .sha256 is byte-identical — the rehash never ran on it');
  assert.equal(readdirSync(f.G).filter((n) => n.startsWith('M-OTHER.sha256.pre-')).length, 0,
    'and no pre-image was taken — nothing to back up when nothing is written');
  assert.match(r.stderr, /M-OTHER: REFUSED/, 'the refusal is named');
  assert.match(r.stderr, /M-OTHER: nothing written[^\n]*pinned\.txt/, 'and it names the rows it left alone');
  // Positive control: the caller's OWN manifest is rehashed exactly as before.
  assert.match(readFileSync(join(f.G, 'M-T.sha256'), 'utf8'), new RegExp(sha256('after\n')),
    'my own manifest carries the merged bytes');
  assert.match(readFileSync(join(f.G, 'M-T.counts'), 'utf8'), new RegExp(`head=${f.to.slice(0, 8)}`));
});

test('992: an ABSENT .counts refuses BEFORE the rehash — the .sha256 it cannot own is left byte-identical', () => {
  // 7.6.30(c) refused to CREATE the ownerless `.counts` but had already rehashed
  // the rows above it: the same half-write, one file over. No owner, no write.
  const { root, repo, camp, g, first, second } = plant();
  try {
    rmSync(join(g, 'M5-B.counts'));
    const before = readFileSync(join(g, 'M5-B.sha256'), 'utf8');
    const r = reconcile(repo, camp, first, second);
    assert.notEqual(r.code, 0, `expected a refusal, got rc 0:\n${r.out}`);
    assert.equal(readFileSync(join(g, 'M5-B.sha256'), 'utf8'), before, 'the .sha256 is untouched');
    assert.equal(readdirSync(g).filter((n) => n.startsWith('M5-B.sha256.pre-')).length, 0, 'no pre-image');
    assert.match(r.out, /REFUSING to rehash M5-B/, 'the refusal says what it declined to do');
    assert.match(r.out, /pinned\.txt/, 'and names the rows it left alone');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
