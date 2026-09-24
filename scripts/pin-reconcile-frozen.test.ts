/**
 * `pin-reconcile.sh` must refuse a matched manifest carrying a `<name>.frozen`
 * marker beside its `.sha256` — bead `forge-8vfn.6.9.3`.
 *
 * A retired milestone's manifests move out of `_1.0/gate-manifests/` entirely
 * (ledger 463/464), so a habitual wide glob (`M*`) no longer reaches one BY
 * POSITION. But the hazard this bead was filed for — rehashing a frozen
 * manifest twice in one M5-B session, both restored + annulled — can recur
 * for a manifest retired IN PLACE, before that move happens. `<name>.frozen`
 * is the marker for that window, and reaching it must refuse the WHOLE run,
 * writing nothing — including to any live sibling manifest the same glob also
 * matched, never a per-manifest skip.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RECONCILE = join(
  import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts', 'pin-reconcile.sh',
);

const git = (repo: string, ...args: string[]) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
const sha256 = (repo: string, file: string) =>
  spawnSync('sha256sum', [file], { cwd: repo, encoding: 'utf8' }).stdout.split(' ')[0];

/** A repo with two commits, and a FROZEN manifest pinning `pinned.txt` at
 *  commit 1's bytes — the exact shape a retired milestone's manifest has. */
function plant() {
  const root = mkdtempSync(join(tmpdir(), 'pin-frozen-'));
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
  const h1 = sha256(repo, 'pinned.txt');
  writeFileSync(join(g, 'RETIRED-X.sha256'), `${h1}  pinned.txt\n`, 'utf8');
  writeFileSync(
    join(g, 'RETIRED-X.counts'),
    `paths=1 manifest=0000000000000000 head=deadbeef tree=${repo} owner=RETIRED-X\n`,
    'utf8',
  );
  writeFileSync(join(g, 'RETIRED-X.frozen'), '', 'utf8');
  writeFileSync(join(repo, 'pinned.txt'), 'two\n', 'utf8');
  git(repo, 'add', 'pinned.txt');
  git(repo, 'commit', '-qm', 'two');
  const second = git(repo, 'rev-parse', 'HEAD').stdout.trim();
  return { root, repo, camp: join(root, 'camp'), g, first, second };
}

function reconcile(repo: string, camp: string, glob: string, from: string, to: string) {
  const r = spawnSync('bash', [RECONCILE, repo, camp, glob, from, to, 'a label'], {
    encoding: 'utf8',
    env: { ...process.env, FORGE_LANE: 'RETIRED-X' },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

test('AT-6.9.3-1 (RED) a manifest carrying <name>.frozen is refused, exit 2, nothing written', () => {
  const { root, repo, camp, g, first, second } = plant();
  try {
    const beforeSha = readFileSync(join(g, 'RETIRED-X.sha256'), 'utf8');
    const beforeCounts = readFileSync(join(g, 'RETIRED-X.counts'), 'utf8');

    const { code, out } = reconcile(repo, camp, 'RETIRED-*', first, second);

    assert.equal(code, 2, `a frozen manifest must refuse with exit 2, not reconcile it. Output: ${out}`);
    assert.match(out, /RETIRED-X/, `the refusal must name the frozen manifest. Output: ${out}`);
    assert.match(out, /frozen/i, `the refusal must say WHY — it carries a .frozen marker. Output: ${out}`);
    assert.equal(readFileSync(join(g, 'RETIRED-X.sha256'), 'utf8'), beforeSha, 'the .sha256 must be byte-identical');
    assert.equal(readFileSync(join(g, 'RETIRED-X.counts'), 'utf8'), beforeCounts, 'the .counts must be byte-identical');
    assert.ok(
      !existsSync(join(g, `RETIRED-X.sha256.pre-${second.slice(0, 8)}`)),
      'nothing written means nothing, including the .pre- backup the happy path takes',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a glob matching a frozen AND a live manifest refuses the whole run, not a per-manifest skip', () => {
  const { root, repo, camp, g, first, second } = plant();
  try {
    // A live sibling under the same glob prefix, owned by the same lane —
    // exactly what a `--sweep`-shaped or habitual wide glob would also reach.
    const h1 = sha256(repo, 'pinned.txt');
    writeFileSync(join(g, 'RETIRED-Y.sha256'), `${h1}  pinned.txt\n`, 'utf8');
    writeFileSync(
      join(g, 'RETIRED-Y.counts'),
      `paths=1 manifest=0000000000000000 head=${second.slice(0, 8)} tree=${repo} owner=RETIRED-X\n`,
      'utf8',
    );
    const beforeY = readFileSync(join(g, 'RETIRED-Y.sha256'), 'utf8');

    const { code, out } = reconcile(repo, camp, 'RETIRED-*', first, second);

    assert.equal(code, 2, `Output: ${out}`);
    assert.equal(
      readFileSync(join(g, 'RETIRED-Y.sha256'), 'utf8'),
      beforeY,
      'the live sibling must be untouched too — one frozen manifest under the glob voids the whole run',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
