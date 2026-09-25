/**
 * `pin-extension-gap.sh` — a file CLASS with no glob, beside a class that has
 * one, is invisible to every pin check (bead `forge-8vfn.7.6.115`).
 *
 * Three real instances generalise to one shape: a directory has a `*.mjs`
 * class fully globbed and a lone `.sh` beside it with no glob at all — the
 * covered class drifts loudly and the uncovered one is silent, because
 * nothing ever asks the TREE what extensions sit there. Two scope rules keep
 * the check from crying wolf: a directory is only "touched" by a
 * DIRECTORY-SCOPED glob (one whose pattern contains `*`), and coverage is
 * judged across the WHOLE manifest set, never per manifest.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHECK = join(
  import.meta.dirname, '..', '.claude', 'skills', 'immutable-gates', 'scripts', 'pin-extension-gap.sh',
);

/** Two manifests: one globs `scripts/*.mjs`, the other `scripts/*.test.ts` —
 *  the exact split the real M6-B/M6-D manifests have — and a repo whose
 *  `scripts/` also holds a lone `.sh` that neither covers. */
function plant() {
  const root = mkdtempSync(join(tmpdir(), 'pin-ext-gap-'));
  const repo = join(root, 'repo');
  const g = join(root, 'camp', 'gate-manifests');
  mkdirSync(join(repo, 'scripts'), { recursive: true });
  mkdirSync(g, { recursive: true });
  writeFileSync(join(repo, 'scripts', 'a.mjs'), '// a\n', 'utf8');
  writeFileSync(join(repo, 'scripts', 'b.test.ts'), '// b\n', 'utf8');
  writeFileSync(join(repo, 'scripts', 'c.sh'), '#!/bin/sh\n', 'utf8');
  writeFileSync(join(g, 'M-A.globs'), 'scripts/*.mjs\n', 'utf8');
  writeFileSync(join(g, 'M-B.globs'), 'scripts/*.test.ts\n', 'utf8');
  return { root, repo, camp: join(root, 'camp'), g };
}

function run(repo: string, camp: string) {
  const r = spawnSync('bash', [CHECK, repo, camp], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

test('AT-7.6.115-1 (RED) a class with no glob beside a class with one is reported', () => {
  const { root, repo, camp } = plant();
  try {
    const { code, out } = run(repo, camp);
    assert.equal(code, 1, `the lone .sh must be reported as a gap. Output: ${out}`);
    assert.match(out, /scripts\s+\.sh/, `must name the directory and the uncovered extension. Output: ${out}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('adding the missing glob clears the gap: exit 0', () => {
  const { root, repo, camp, g } = plant();
  try {
    writeFileSync(join(g, 'M-B.globs'), 'scripts/*.test.ts\nscripts/*.sh\n', 'utf8');

    const { code, out } = run(repo, camp);
    assert.equal(code, 0, `covering every class must clear the gap. Output: ${out}`);
    assert.doesNotMatch(out, /\.sh/, `Output: ${out}`);
    assert.match(out, /PASS/, `Output: ${out}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('scope rule 1: a literal single-file glob does not put its whole directory in scope', () => {
  const root = mkdtempSync(join(tmpdir(), 'pin-ext-gap-root-'));
  const repo = join(root, 'repo');
  const g = join(root, 'camp', 'gate-manifests');
  mkdirSync(repo, { recursive: true });
  mkdirSync(g, { recursive: true });
  try {
    writeFileSync(join(repo, 'package.json'), '{}\n', 'utf8');
    // Root-level neighbours no glob covers — must NOT be flagged, because the
    // manifest below names package.json LITERALLY, with no '*'.
    writeFileSync(join(repo, 'LICENSE.txt'), 'x\n', 'utf8');
    writeFileSync(join(g, 'M-ROOT.globs'), 'package.json\n', 'utf8');

    const { code, out } = run(repo, join(root, 'camp'));
    assert.equal(code, 0, `a literal one-file row must not audit its whole directory. Output: ${out}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('scope rule 2: a directory-scoped glob in one manifest is covered by another manifest entirely', () => {
  // The exact shape the evidence named for `scripts/request-path-sinks.baseline.txt`:
  // the glob that TOUCHES a directory and the glob that COVERS one of its
  // classes can be declared in two different manifests. A per-manifest check
  // would flag this; the whole-set check must not.
  const { root, repo, camp } = plant();
  try {
    rmSync(join(repo, 'scripts', 'c.sh'));
    const { code, out } = run(repo, camp);
    assert.equal(
      code,
      0,
      `M-A covers .mjs and M-B covers .test.ts — together, across the whole manifest set, nothing is left uncovered. Output: ${out}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('usage: no repo, or no gate-manifests dir, exits 2', () => {
  const root = mkdtempSync(join(tmpdir(), 'pin-ext-gap-usage-'));
  try {
    const r = spawnSync('bash', [CHECK, join(root, 'nope'), join(root, 'camp')], { encoding: 'utf8' });
    assert.equal(r.status, 2, `Output: ${r.stdout}${r.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
