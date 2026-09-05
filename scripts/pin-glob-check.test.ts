/**
 * `pin-glob-check.sh` — a pin manifest is DERIVED from the glob that defines it
 * (bead `forge-8vfn.6.9.1`, T1 ruling 256).
 *
 * Measured, M5-B session 7: the M5-B pin's own stated scope includes
 * `scripts/stories/*.mjs` and `*.test.ts`. On merged main there were **28** such
 * files and **21** in the manifest — and `sha256sum -c` reported `0 FAILED` the
 * entire time, because **a file that is not listed cannot fail**. Absence of red
 * mistaken for presence of green, one layer above the merge gate.
 *
 * Every one of the seven had arrived the same legitimate way: a split at the
 * 800-line cap, or a new test file. `reap-cancel.mjs` had been outside the pin
 * since the session before; `beats-page.mjs` was created by a split in the very
 * session that found this, and it holds the three waits that `6.11.17` exists to
 * fix — editable without the pin noticing.
 *
 * This closes the mechanism rather than that instance. It is deliberately NOT
 * `pin-reconcile.sh`'s job: that script never re-globs and never adds a path, on
 * purpose, because a re-glob that ADOPTS silently is how a pin quietly grows to
 * cover whatever appeared. This one only ever REFUSES, and an amendment adds the
 * file — a human decision, recorded, exactly as `M5-B.amend-1.md` was.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHECK = join(
  import.meta.dirname, '..', '.claude', 'skills', 'immutable-gates', 'scripts', 'pin-glob-check.sh',
);

/** A repo with `files`, and a campaign whose manifest lists `listed` under `globs`. */
function plant(opts: { files: string[]; listed: string[]; globs: string[] | null; name?: string }) {
  const root = mkdtempSync(join(tmpdir(), 'pin-glob-'));
  const repo = join(root, 'repo');
  const g = join(root, 'camp', 'gate-manifests');
  mkdirSync(g, { recursive: true });
  for (const f of opts.files) {
    mkdirSync(join(repo, f.split('/').slice(0, -1).join('/')), { recursive: true });
    writeFileSync(join(repo, f), `// ${f}\n`, 'utf8');
  }
  const name = opts.name ?? 'M5-B';
  writeFileSync(
    join(g, `${name}.sha256`),
    opts.listed.map((f) => `0000000000000000000000000000000000000000000000000000000000000000  ${f}`).join('\n') + '\n',
    'utf8',
  );
  if (opts.globs !== null) writeFileSync(join(g, `${name}.globs`), opts.globs.join('\n') + '\n', 'utf8');
  return { root, repo, camp: join(root, 'camp') };
}

function run(repo: string, camp: string, glob = 'M5-B') {
  const r = spawnSync('bash', [CHECK, repo, camp, glob], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

test('AT-6.9.1-1 (RED) a file matching the manifest\'s own glob that the manifest does not list FAILS, naming it', () => {
  const { root, repo, camp } = plant({
    files: ['scripts/stories/beats.mjs', 'scripts/stories/beats-page.mjs', 'scripts/stories/sweep.mjs'],
    listed: ['scripts/stories/beats.mjs', 'scripts/stories/sweep.mjs'],
    globs: ['scripts/stories/*.mjs'],
  });
  try {
    const { code, out } = run(repo, camp);
    assert.notEqual(code, 0, `drift must not exit 0. Output: ${out}`);
    assert.match(out, /beats-page\.mjs/, `the unlisted file must be NAMED, not counted. Output: ${out}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('AT-6.9.1-2 (positive control) a manifest that lists every match passes', () => {
  const { root, repo, camp } = plant({
    files: ['scripts/stories/beats.mjs', 'scripts/stories/sweep.mjs'],
    listed: ['scripts/stories/beats.mjs', 'scripts/stories/sweep.mjs'],
    globs: ['scripts/stories/*.mjs'],
  });
  try {
    const { code, out } = run(repo, camp);
    assert.equal(code, 0, `a complete manifest must pass. Output: ${out}`);
    assert.match(out, /2/, `and say how many it checked, so a silent pass is impossible. Output: ${out}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('AT-6.9.1-3 a manifest that declares NO globs is its own named outcome, never a silent pass', () => {
  // The trap this tool exists to close, one level up: "nothing was checked" and
  // "everything checked out" must not share an exit code.
  const { root, repo, camp } = plant({
    files: ['scripts/stories/beats.mjs'],
    listed: ['scripts/stories/beats.mjs'],
    globs: null,
  });
  try {
    const { code, out } = run(repo, camp);
    assert.notEqual(code, 0, `an undeclared manifest must not read as clean. Output: ${out}`);
    assert.match(out, /no globs declared/i, out);
    assert.match(out, /M5-B/, out);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('AT-6.9.1-4 a listed file that no glob matches is fine — extras are explicit, only ABSENCES are drift', () => {
  const { root, repo, camp } = plant({
    files: ['scripts/stories/beats.mjs', 'package.json'],
    listed: ['scripts/stories/beats.mjs', 'package.json'],
    globs: ['scripts/stories/*.mjs'],
  });
  try {
    const { code, out } = run(repo, camp);
    assert.equal(code, 0, `an explicitly pinned extra is not drift. Output: ${out}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('AT-6.9.1-5 no manifest matched is an error, not a pass (§15.92)', () => {
  const { root, repo, camp } = plant({
    files: ['scripts/stories/beats.mjs'], listed: ['scripts/stories/beats.mjs'], globs: ['scripts/stories/*.mjs'],
  });
  try {
    const { code, out } = run(repo, camp, 'NOPE-*');
    assert.notEqual(code, 0, `a run that checked nothing must say so. Output: ${out}`);
    assert.match(out, /no manifest matched/i, out);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
