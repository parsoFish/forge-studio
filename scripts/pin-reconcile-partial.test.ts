/**
 * `pin-reconcile.sh` — the PARTIAL path and the reconcile BASE
 * (bead `forge-8vfn.7.6.102`, T1 rulings 997/1000/1001; found by lane C).
 *
 * Three defects, all silent, all read clean:
 *
 * 1. The not-advanced branch (a pinned path the merge deleted, so the manifest
 *    still FAILS after the rehash) rewrote `.sha256` and returned before
 *    `set_counts_fields`, so `manifest=` fingerprinted the PRE-rehash file,
 *    `paths=` was not recomputed and `<name>.txt` was not regenerated. Measured
 *    on M6-C: `.counts` read `manifest=46d44c25…` while the file hashed
 *    `60f18625…`. 7.6.57/7.6.87 promised the pair "cannot disagree, derived in
 *    the same edit" — true on the advancing path only.
 * 2. The `# head= NOT advanced` note was appended under `grep -q … ||` and never
 *    removed, so a later advancing run left two contradicting records two lines
 *    apart (measured live in campaign state).
 * 3. A FROM of `<merge>^1` bounds the diff at THIS merge and cannot reach a
 *    stranding an EARLIER merge created and nobody reconciled — C's first run
 *    returned `FAILED 5 → 2`, the two survivors older than the base — and both
 *    cases print identically as a rehash count. The base is the oldest
 *    unreconciled point, which the manifest already records as `head=`.
 *
 * Its own file because `pin-reconcile.test.ts` sits at 753 of the 800-line cap,
 * and a NEW test file is exactly §15.538's third state — adopted by name in the
 * same PR's amendment.
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
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const digest16 = (file: string) => sha256(readFileSync(file, 'utf8')).slice(0, 16);

function plantRepo() {
  const root = mkdtempSync(join(tmpdir(), 'pin-partial-'));
  const repo = join(root, 'repo');
  const camp = join(root, 'camp');
  const G = join(camp, 'gate-manifests');
  mkdirSync(join(repo, 'src'), { recursive: true });
  mkdirSync(G, { recursive: true });
  const git = (...a: string[]) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main', '.');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 'T');
  const write = (rel: string, body: string) => writeFileSync(join(repo, rel), body);
  const commit = (msg: string) => { git('add', '-A'); git('commit', '-qm', msg); return git('rev-parse', 'HEAD'); };
  const manifest = (name: string, rows: Array<[string, string]>, counts: string) => {
    writeFileSync(join(G, `${name}.sha256`), rows.map(([body, p]) => `${sha256(body)}  ${p}`).join('\n') + '\n');
    if (counts !== '') writeFileSync(join(G, `${name}.counts`), counts.replace('TREE', repo) + '\n');
  };
  const run = (glob: string, from: string, to: string, lane = 'M-A') =>
    spawnSync('bash', [RECONCILE, repo, camp, glob, from, to, 'test label'],
      { encoding: 'utf8', env: { ...process.env, FORGE_LANE: lane } });
  return { root, repo, camp, G, git, write, commit, manifest, run };
}

// ── (1) + (2): the not-advanced path ──────────────────────────────────────────

test('7.6.102: a NOT-advanced rehash still derives manifest=/paths= and .txt from the file — head= alone is left', () => {
  const f = plantRepo();
  try {
    f.write('pinned.txt', 'one\n'); f.write('doomed.txt', 'x\n');
    const c1 = f.commit('one');
    f.manifest('M-A', [['one\n', 'pinned.txt'], ['x\n', 'doomed.txt']],
      'paths=99 manifest=0000000000000000 head=deadbeef tree=TREE owner=M-A');
    f.write('pinned.txt', 'two\n'); rmSync(join(f.repo, 'doomed.txt'));
    const c2 = f.commit('two, doomed deleted');

    const r = f.run('M-A', c1.slice(0, 8), c2.slice(0, 8));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /NOT advanced/, 'the manifest still fails (doomed.txt is gone), so head= must not move');
    const counts = readFileSync(join(f.G, 'M-A.counts'), 'utf8');
    assert.match(counts, /head=deadbeef/, 'head= untouched');
    assert.match(counts, new RegExp(`manifest=${digest16(join(f.G, 'M-A.sha256'))}\\b`),
      `manifest= fingerprints the file AS REWRITTEN, not the pre-rehash bytes:\n${counts}`);
    assert.match(counts, /paths=2(\s|$)/, 'paths= recomputed from the file');
    assert.ok(existsSync(join(f.G, 'M-A.txt')), '.txt regenerated');
    assert.equal(readFileSync(join(f.G, 'M-A.txt'), 'utf8'), 'pinned.txt\ndoomed.txt\n');
    assert.equal((counts.match(/head-not-advanced=/g) ?? []).length, 1, 'exactly one note');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('7.6.102: a later ADVANCING run removes the not-advanced note — one record, never two that disagree', () => {
  const f = plantRepo();
  try {
    f.write('pinned.txt', 'one\n'); f.write('doomed.txt', 'x\n');
    const c1 = f.commit('one');
    f.manifest('M-A', [['one\n', 'pinned.txt'], ['x\n', 'doomed.txt']],
      'paths=2 manifest=0000000000000000 head=deadbeef tree=TREE owner=M-A');
    f.write('pinned.txt', 'two\n'); rmSync(join(f.repo, 'doomed.txt'));
    const c2 = f.commit('two');
    assert.equal(f.run('M-A', c1.slice(0, 8), c2.slice(0, 8)).status, 0);
    assert.match(readFileSync(join(f.G, 'M-A.counts'), 'utf8'), /head-not-advanced=/);

    f.write('doomed.txt', 'x\n');
    const c3 = f.commit('doomed restored');
    const r = f.run('M-A', c2.slice(0, 8), c3.slice(0, 8));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const counts = readFileSync(join(f.G, 'M-A.counts'), 'utf8');
    assert.match(counts, new RegExp(`head=${c3.slice(0, 8)}`), 'head= advanced now that it verifies');
    assert.doesNotMatch(counts, /NOT advanced|head-not-advanced/, `the stale note is gone:\n${counts}`);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

// ── (3): FROM=head — each manifest diffs from its own head= ───────────────────

test('7.6.102: FROM=head diffs EACH manifest from its own head=, so an older stranding is reached', () => {
  const f = plantRepo();
  try {
    f.write('pinned.txt', 'one\n'); f.write('other.txt', 'stable\n');
    const c1 = f.commit('one');
    f.write('pinned.txt', 'two\n');
    const c2 = f.commit('two');                       // strands M-A (nobody reconciled)
    f.write('other.txt', 'moved\n');
    const c3 = f.commit('three');                     // strands M-B
    f.manifest('M-A', [['one\n', 'pinned.txt']], `paths=1 manifest=0000000000000000 head=${c1.slice(0, 8)} tree=TREE owner=M-A`);
    f.manifest('M-B', [['stable\n', 'other.txt']], `paths=1 manifest=0000000000000000 head=${c2.slice(0, 8)} tree=TREE owner=M-A`);

    const r = f.run('M-*', 'head', c3.slice(0, 8));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    for (const n of ['M-A', 'M-B']) {
      assert.match(readFileSync(join(f.G, `${n}.counts`), 'utf8'), new RegExp(`head=${c3.slice(0, 8)}`), `${n} advanced`);
    }
    assert.match(readFileSync(join(f.G, 'M-A.sha256'), 'utf8'), new RegExp(sha256('two\n')), 'M-A reached the OLDER stranding');
    assert.match(r.stdout, /M-A: \[pinned\.txt/, 'and says which rows, per manifest');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('7.6.102 (discrimination): a literal FROM at the newest merge CANNOT reach the older stranding', () => {
  const f = plantRepo();
  try {
    f.write('pinned.txt', 'one\n'); f.write('other.txt', 'stable\n');
    const c1 = f.commit('one');
    f.write('pinned.txt', 'two\n');
    const c2 = f.commit('two');
    f.write('other.txt', 'moved\n');
    const c3 = f.commit('three');
    f.manifest('M-A', [['one\n', 'pinned.txt']], `paths=1 manifest=0000000000000000 head=${c1.slice(0, 8)} tree=TREE owner=M-A`);
    const r = f.run('M-A', c2.slice(0, 8), c3.slice(0, 8));   // C's shape: <merge>^1 .. <merge>
    assert.match(r.stdout, /M-A: head= NOT advanced — untouched by this merge but FAILED 1/,
      `the tool sees the stranding but the range cannot reach it — this is why FROM=head exists:\n${r.stdout}`);
    assert.doesNotMatch(readFileSync(join(f.G, 'M-A.sha256'), 'utf8'), new RegExp(sha256('two\n')));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('7.6.102: FROM=head with a manifest that records NO head= refuses that manifest by name and writes nothing to it', () => {
  const f = plantRepo();
  try {
    f.write('pinned.txt', 'one\n');
    const c1 = f.commit('one');
    f.write('pinned.txt', 'two\n');
    const c2 = f.commit('two');
    f.manifest('M-A', [['one\n', 'pinned.txt']], 'paths=1 manifest=0000000000000000 tree=TREE owner=M-A');
    const before = readFileSync(join(f.G, 'M-A.sha256'), 'utf8');
    const r = f.run('M-A', 'head', c2.slice(0, 8));
    assert.notEqual(r.status, 0, `no head= means no base — refuse:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /M-A: REFUSED[^\n]*no head=/, r.stderr);
    assert.equal(readFileSync(join(f.G, 'M-A.sha256'), 'utf8'), before, '.sha256 byte-identical');
    void c1;
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

// ── (1000): a DEAD glob makes the reconcile INCOMPLETE, like DRIFT ─────────────

test('7.6.102: a glob that matches NO file makes the reconcile INCOMPLETE (exit 5) — the rehash stands', () => {
  const f = plantRepo();
  try {
    f.write('pinned.txt', 'one\n'); f.write('src/a.ts', 'export const a = 1;\n');
    const c1 = f.commit('one');
    f.write('pinned.txt', 'two\n');
    const c2 = f.commit('two');
    f.manifest('M-A', [['one\n', 'pinned.txt'], ['export const a = 1;\n', 'src/a.ts']],
      'paths=2 manifest=0000000000000000 head=00000000 tree=TREE owner=M-A');
    writeFileSync(join(f.G, 'M-A.globs'), 'src/*.ts\napps/forge/architect-*.test.ts\n');   // the second is A's dead glob, verbatim
    const r = f.run('M-A', c1.slice(0, 8), c2.slice(0, 8));
    assert.equal(r.status, 5, `INCOMPLETE, not wrong and not clean:\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout + r.stderr, /DEAD[^\n]*\n\s*apps\/forge\/architect-\*\.test\.ts/, 'the dead glob is NAMED, verbatim, on its own line');
    assert.match(readFileSync(join(f.G, 'M-A.counts'), 'utf8'), new RegExp(`head=${c2.slice(0, 8)}`), 'the rehash stands');
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
