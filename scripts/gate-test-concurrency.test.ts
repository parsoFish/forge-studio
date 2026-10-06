/**
 * docs-w7 row 7.14 (T1 1976q): a gate's `npm test` saturated this host by
 * itself (load 25-45 measured, node's default concurrency = cores - 1), and
 * the timing doors of other suites went red under it. gate.sh now runs its
 * npm-test step with FORGE_TEST_CONCURRENCY = nproc / 2 (GATE_TEST_CONCURRENCY
 * overrides), and the root `npm test` script turns that variable into node's
 * own --test-concurrency flag. Unset (CI, a developer's shell) it adds nothing.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir, availableParallelism } from 'node:os';
import { join } from 'node:path';
// @ts-ignore -- plain .mjs module
import { parseNodeGlobs } from './check-test-discovery.mjs';

const ROOT = join(import.meta.dirname, '..');
const GATE = join(ROOT, '.claude', 'skills', 'tiered-orchestration', 'scripts', 'gate.sh');
const TEST_SCRIPT: string = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts.test;

/** What gate.sh hands its npm-test step, read back from a fixture tree whose `npm test` records it. */
function gateConcurrency(env: Record<string, string>) {
  const d = mkdtempSync(join(tmpdir(), 'gate-conc-tree-'));
  const c = mkdtempSync(join(tmpdir(), 'gate-conc-camp-'));
  try {
    mkdirSync(join(d, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(d, '.github', 'workflows', 'ci.yml'),
      'name: CI\non: [push]\njobs:\n  build-and-test:\n    runs-on: ubuntu-latest\n    steps:\n      - name: T\n        run: npm test\n');
    mkdirSync(join(d, 'packages', 'kernel'), { recursive: true });
    mkdirSync(join(d, 'node_modules', '@forge'), { recursive: true });
    symlinkSync(join(d, 'packages', 'kernel'), join(d, 'node_modules', '@forge', 'kernel'));
    const out = join(c, 'seen.txt');
    writeFileSync(join(d, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0', scripts: { test: `printf %s "$FORGE_TEST_CONCURRENCY" > ${out}` } }));
    const { NODE_TEST_CONTEXT: _n, GATE_RERUN_ALONE: _g, FORGE_TEST_CONCURRENCY: _f, GATE_TEST_CONCURRENCY: _o, ...rest } = process.env;
    const r = spawnSync('bash', [GATE, d, c], { encoding: 'utf8', env: { ...rest, ...env } });
    assert.match(r.stdout, /^PASS {2}npm test/m, r.stdout + r.stderr);
    return readFileSync(out, 'utf8');
  } finally {
    rmSync(d, { recursive: true, force: true });
    rmSync(c, { recursive: true, force: true });
  }
}

describe('row 7.14 — a gate caps npm test concurrency', () => {
  test('gate.sh gives its npm-test step FORGE_TEST_CONCURRENCY = nproc / 2 by default', () => {
    // kills: a gate that runs npm test at node's default (cores - 1) and saturates the host
    const nproc = Number(spawnSync('nproc', { encoding: 'utf8' }).stdout.trim());
    assert.equal(gateConcurrency({}), String(Math.max(1, Math.floor(nproc / 2))));
  });

  test('GATE_TEST_CONCURRENCY overrides it', () => {
    // kills: a hard-coded cap nobody can raise on a quiet host
    assert.equal(gateConcurrency({ GATE_TEST_CONCURRENCY: '3' }), '3');
  });

  test('a non-integer or zero override is refused by name, never coerced to a default', () => {
    // kills: a typo silently running the suite at some other concurrency
    for (const bad of ['abc', '0', '']) {
      const d = mkdtempSync(join(tmpdir(), 'gate-conc-bad-'));
      const c = mkdtempSync(join(tmpdir(), 'gate-conc-badc-'));
      try {
        mkdirSync(join(d, '.github', 'workflows'), { recursive: true });
        writeFileSync(join(d, '.github', 'workflows', 'ci.yml'), 'name: CI\non: [push]\njobs:\n  build-and-test:\n    runs-on: ubuntu-latest\n    steps:\n      - name: T\n        run: npm test\n');
        mkdirSync(join(d, 'packages', 'kernel'), { recursive: true });
        mkdirSync(join(d, 'node_modules', '@forge'), { recursive: true });
        symlinkSync(join(d, 'packages', 'kernel'), join(d, 'node_modules', '@forge', 'kernel'));
        writeFileSync(join(d, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0', scripts: { test: 'true' } }));
        const { NODE_TEST_CONTEXT: _n, GATE_RERUN_ALONE: _g, ...rest } = process.env;
        const r = spawnSync('bash', [GATE, d, c], { encoding: 'utf8', env: { ...rest, GATE_TEST_CONCURRENCY: bad } });
        if (bad === '') {
          assert.match(r.stdout, /^PASS {2}npm test/m, 'an EMPTY override is "unset": the default applies');
        } else {
          assert.notEqual(r.status, 0, bad);
          assert.match(r.stdout + r.stderr, /GATE_TEST_CONCURRENCY must be a positive integer/, bad);
        }
      } finally {
        rmSync(d, { recursive: true, force: true });
        rmSync(c, { recursive: true, force: true });
      }
    }
  });

  test('the npm test script passes FORGE_TEST_CONCURRENCY as a LEADING --test-concurrency, and nothing when unset', () => {
    // kills: a flag appended after the file list (node ignores it there: measured, 3 x 1.5 s files took 1.6 s at c=1)
    const expand = (env: Record<string, string>) =>
      spawnSync('sh', ['-c', `set -- ${TEST_SCRIPT}; printf '%s\\n' "$@"`], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env } })
        .stdout.split('\n').filter(Boolean);
    const set = expand({ FORGE_TEST_CONCURRENCY: '6' });
    const flagAt = set.indexOf('--test-concurrency=6');
    const firstFile = set.findIndex((t) => t.endsWith('.test.ts'));
    assert.ok(flagAt > 0 && flagAt < firstFile, `the flag precedes every file: ${set.slice(0, 8).join(' ')}`);
    assert.equal(expand({}).some((t) => t.startsWith('--test-concurrency')), false, 'unset adds no flag, so CI keeps node\'s default');
    assert.ok(availableParallelism() >= 1);
  });

  test('check-test-discovery reads the script\'s globs and not the expansion', () => {
    // kills: the `${...}` token being read as a test glob that matches nothing
    assert.equal(parseNodeGlobs(TEST_SCRIPT).some((g: string) => g.includes('$')), false);
  });
});
