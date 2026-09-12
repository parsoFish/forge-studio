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

test('7.6.99: a file matched by TWO globs is counted ONCE (the OK branch)', () => {
  // MEASURED ON M1-C-S1, which pins the story file by name AND carries
  // `tests/stories/S1.*.mjs` since T1 961 — so `S1.story.mjs` matched both and
  // the check reported `OK — 3 file(s)` for a manifest listing 2. The verdict
  // was right and the NUMBER was not, which is the worse half: a reader
  // comparing "3 file(s) match" against `paths=2` concludes something is
  // unlisted — exactly the drift this tool exists to report, in a manifest that
  // has none.
  const { root, repo, camp } = plant({
    files: ['tests/stories/S1.story.mjs', 'tests/stories/S1.constants.mjs'],
    listed: ['tests/stories/S1.story.mjs', 'tests/stories/S1.constants.mjs'],
    globs: ['tests/stories/S1.story.mjs', 'tests/stories/S1.*.mjs'],
  });
  try {
    const { code, out } = run(repo, camp);
    assert.equal(code, 0, `both files are listed, so this is clean. Output: ${out}`);
    assert.match(out, /OK — 2 file\(s\)/,
      `two files, one matched twice — the count is of FILES, not of (glob, file) pairs. Output: ${out}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('7.6.99: an UNLISTED file matched by two globs is reported once (the DRIFT branch)', () => {
  // The same defect on the branch that matters more. Before the dedupe the
  // unlisted list was accumulated per (glob, file) pair, so a drifting file
  // matching two globs was counted twice AND printed twice — inflating the
  // count a lane acts on and making one file look like two problems.
  const { root, repo, camp } = plant({
    files: ['tests/stories/S1.story.mjs', 'tests/stories/S1.act3.mjs'],
    listed: ['tests/stories/S1.story.mjs'],
    globs: ['tests/stories/S1.act3.mjs', 'tests/stories/S1.*.mjs'],
  });
  try {
    const { code, out } = run(repo, camp);
    assert.notEqual(code, 0, `the unlisted file must still drift. Output: ${out}`);
    assert.match(out, /DRIFT — 1 file\(s\)/, `ONE file drifts, not two. Output: ${out}`);
    const named = out.split('\n').filter((l) => l.includes('S1.act3.mjs')).length;
    assert.equal(named, 1, `and it is named exactly once, not once per matching glob. Output: ${out}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

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

// --- forge-m86d: the listed-check was a PIPELINE under `set -o pipefail` -----
//
// MEASURED TWICE by lane M6-C in one session, on manifests whose files WERE
// listed: `tests/stories/S1.story.mjs` reported unlisted once, then
// `scripts/stories/spend.test.ts` on a later run; three immediate re-runs after
// each were clean. Neither is the manifest's first entry, which refutes this
// bead's original "drops the FIRST listed entry" reading.
//
// THE MECHANISM, and it is exact. The check was
//
//     printf '%s\n' "$listed" | grep -Fxq -- "$hit" || unlisted=…
//
// under `set -uo pipefail`. `grep -q` exits the instant it matches. If `printf`
// is still writing when it does, `printf` takes SIGPIPE and exits 141 — and
// pipefail makes the PIPELINE's status 141, so a MATCH is read as a MISS. The
// first test below demonstrates that on this very shell, deterministically.
//
// Why it looked like a load flake: a small `listed` fits the 64 KB pipe buffer,
// so `printf` finishes before `grep` can exit and the race is not run at all.
// Under scheduling pressure — a full suite, a concurrent story run — `printf`
// gets preempted after `grep` exits, and one arbitrary entry reports unlisted.
//
// The fix removes the pipeline (a herestring, no second process to signal) and
// reads grep's OWN status: 0 listed, 1 unlisted, anything else ABORTS. The
// script's header already argues that "nothing was checked" and "everything
// checked out" must never share an exit code; this is the same argument one
// line lower.

test('m86d: the DEFECT ITSELF — `printf | grep -q` under pipefail returns 141 on an early match', () => {
  const r = spawnSync('bash', ['-uo', 'pipefail', '-c',
    'big=$(seq 1 200000); printf "%s\\n" "$big" | grep -Fxq -- "1"; echo $?'],
    { encoding: 'utf8' });
  assert.equal(r.stdout.trim(), '141',
    'if this ever prints 0, this shell no longer reproduces the defect and the test below stops meaning anything');

  // THE LATE-MATCH CONTRAST IS NOT ASSERTED, and that correction is itself
  // measured. This test first claimed `grep -Fxq -- "199999"` returns 0 —
  // printf finishing before grep exits — as the reason the false drift moved
  // between files. Under gate pr6's full suite that assertion FAILED with
  // `'141' !== '0'`: under load a LATE match SIGPIPEs too. So the contrast is a
  // common case, not a law, and asserting it made this file flaky in exactly
  // the way it exists to explain. The defect is worse than the original
  // reading: the pipeline's status is timing-dependent for ANY entry, not only
  // an early one. Only the reliable half is pinned above — an early match on an
  // input far larger than the 64 KB pipe buffer, where printf MUST still be
  // writing when grep exits.
});

test('m86d (RED): a LISTED file matched early in a large manifest is NOT reported as drift', () => {
  // `listed` is `sort -u`'d by the script, so the filler is named to sort AFTER
  // the real file: `grep -q` then exits on line 1 while `printf` still has
  // ~700 KB to write — the exact shape above. Named `zfiller` on purpose; with
  // `filler` the target sorts LAST, the match is late, and this test passes
  // against the defect it exists to catch.
  const filler = Array.from({ length: 20_000 }, (_, i) => `scripts/zfiller/f${i}.mjs`);
  const { root, repo, camp } = plant({
    files: ['scripts/stories/beats.mjs'],
    listed: ['scripts/stories/beats.mjs', ...filler],
    globs: ['scripts/stories/*.mjs'],
  });
  try {
    const { code, out } = run(repo, camp);
    assert.equal(code, 0, `a listed file must never read as drift. Output: ${out}`);
    assert.doesNotMatch(out, /DRIFT/, `Output: ${out}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('m86d POSITIVE CONTROL: a listed-check that cannot RUN aborts with its own code, never as drift', () => {
  const { root, repo, camp } = plant({
    files: ['scripts/stories/beats.mjs'],
    listed: ['scripts/stories/beats.mjs'],
    globs: ['scripts/stories/*.mjs'],
  });
  try {
    // A `grep` that exits 2 — the errno a real fork/exec failure produces — put
    // in front of the real one on PATH.
    const bin = join(root, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'grep'), '#!/bin/sh\nexit 2\n', { mode: 0o755 });
    const r = spawnSync('bash', [CHECK, repo, camp, 'M5-B'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` },
    });
    const out = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 4, `a check that could not run must have its OWN exit code, not 1. Output: ${out}`);
    assert.doesNotMatch(out, /DRIFT/, `it must not invent a drift finding out of its own failure. Output: ${out}`);
    assert.match(out, /could not be run/i, `and it must say so. Output: ${out}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── 7.6.102 (T1 1000) — a glob that matches NOTHING is its own named state ────

test('7.6.102: a glob matching NO file is DEAD — named per glob, exit 6, distinct from DRIFT and no-scope', () => {
  // A (1000): three M6-A globs named files directly under apps/forge/ that had
  // moved to apps/forge/tests/{integration,regression}/; six rows were held only
  // by their literal names ever since, and one in-class test sat in no manifest.
  // A dead glob cannot DRIFT and cannot FAIL, and read identically to a glob
  // doing its job — nothing asked "does this still match anything".
  const { root, repo, camp } = plant({
    files: ['a/x.test.ts'], listed: ['a/x.test.ts'], globs: ['a/*.test.ts', 'apps/forge/architect-*.test.ts'],
  });
  try {
    const r = run(repo, camp);
    assert.equal(r.code, 6, r.out);
    assert.match(r.out, /M5-B: DEAD — 1 glob\(s\) match no file/, r.out);
    assert.match(r.out, /apps\/forge\/architect-\*\.test\.ts/, 'the glob itself is named, verbatim');
    assert.doesNotMatch(r.out, /PASS/, 'and there is no PASS line beside it');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('7.6.102: DRIFT outranks DEAD — both are printed, the exit is 1', () => {
  const { root, repo, camp } = plant({
    files: ['a/x.test.ts', 'a/y.test.ts'], listed: ['a/x.test.ts'], globs: ['a/*.test.ts', 'b/*.test.ts'],
  });
  try {
    const r = run(repo, camp);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /DRIFT/); assert.match(r.out, /a\/y\.test\.ts/);
    assert.match(r.out, /DEAD/); assert.match(r.out, /b\/\*\.test\.ts/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
