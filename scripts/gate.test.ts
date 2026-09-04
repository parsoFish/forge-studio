/**
 * `gate.sh` — the campaign exit gate, generalised out of `_1.0/gate-M4.sh`.
 *
 * §15.37: a lane's local gate block is the CI job's list, not the subset it remembers.
 * `build-and-test` runs fifteen steps in order plus three run-lock jobs; knowledge ran 4 of 15
 * and lost a CI round-trip to markdownlint, library lost one to check-file-size by running only
 * `test:ui`, projects lost one to unused imports by not re-running `build`. So the gate does not
 * carry a list at all — it reads the `run:` lines out of the tree it is measuring.
 *
 * "The tree it is measuring" is the load-bearing half: `gate-M4.sh` hard-coded `/home/parso/forge`
 * for its helper tools and a single session's scratchpad for its logs, so it answered a different
 * question in each checkout (§15.148). Every path here is an argument.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GATE = join(import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts', 'gate.sh');

function gate(...args: string[]) {
  const r = spawnSync('bash', [GATE, ...args], { encoding: 'utf8' });
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}
/** A throwaway tree with its own ci.yml — the point is that the gate reads THIS one. */
function tree(ci: string) {
  const d = mkdtempSync(join(tmpdir(), 'gate-'));
  mkdirSync(join(d, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(d, '.github', 'workflows', 'ci.yml'), ci);
  return d;
}
const CI = `name: CI
on: [push]
jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - name: Install
        run: npm ci
      - name: Build
        run: npm run build
      - name: Unit tests
        run: npm test
      - name: Guard
        run: node scripts/check-identity.mjs
      - name: A multi-line step
        run: |
          npm run stories -- --story smoke
          npm run stories -- --story proof
  deadpaths:
    runs-on: ubuntu-latest
    steps:
      - name: Dead paths
        run: npm run ui:deadpaths
`;

describe('gate.sh --list — the step list comes from the tree, never from memory', () => {
  test('lists the single-line run: steps of build-and-test, in order, and drops only `npm ci`', () => {
    const d = tree(CI);
    try {
      const r = gate('--list', d);

      assert.equal(r.status, 0, r.err);
      const runs = r.out.split('\n').filter((l) => l.startsWith('RUN ')).map((l) => l.slice(4));
      assert.deepEqual(runs, ['npm run build', 'npm test', 'node scripts/check-identity.mjs'], 'the job\'s own order, with the install step dropped — a worktree already has its install');
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test('a multi-line `run: |` step is NAMED as not run, never silently dropped (§15.92)', () => {
    const d = tree(CI);
    try {
      const r = gate('--list', d);

      assert.match(r.out, /^SKIP .*multi-line/m, 'the gate says which step it is not running, and why');
      assert.match(r.out, /^SKIP .*npm ci/m, 'including the install it deliberately drops');
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test('steps of OTHER jobs are named as not run — they are the run-lock jobs a lane runs separately', () => {
    const d = tree(CI);
    try {
      const r = gate('--list', d);

      assert.match(r.out, /^OTHER JOB deadpaths: npm run ui:deadpaths — /m, 'the run-lock jobs are visible, and say where they belong');
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test('a tree with no ci.yml is a loud failure — a gate that finds no steps is not a green gate', () => {
    const d = mkdtempSync(join(tmpdir(), 'gate-empty-'));
    try {
      const r = gate('--list', d);

      assert.notEqual(r.status, 0);
      assert.match(r.err, /ci\.yml/, 'the failure names the file it could not read');
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe('gate.sh — a verdict about a tree is void unless it measured that tree', () => {
  test('BORROWED node_modules voids the verdict before a single gate runs (§15.13)', () => {
    const d = tree(CI);
    const other = mkdtempSync(join(tmpdir(), 'gate-other-'));
    try {
      mkdirSync(join(other, 'packages', 'kernel'), { recursive: true });
      mkdirSync(join(d, 'node_modules', '@forge'), { recursive: true });
      symlinkSync(join(other, 'packages', 'kernel'), join(d, 'node_modules', '@forge', 'kernel'));

      const r = gate(d);

      assert.notEqual(r.status, 0);
      assert.match(r.out + r.err, /BORROWED node_modules/, 'a tree running another tree\'s install measures the other tree');
    } finally {
      rmSync(d, { recursive: true, force: true });
      rmSync(other, { recursive: true, force: true });
    }
  });
});
