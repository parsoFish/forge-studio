/**
 * Tests for the `forge preflight converge` CLI arg validation (R4-02-F2).
 *
 * Flag validation runs BEFORE project resolution / the loop, so these cases
 * exit non-zero without touching the filesystem or spawning anything — no real
 * project needed, no brain writes. The convergence logic itself is covered
 * hermetically by contract-compliance-loop.test.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { FORGE_ROOT } from '@forge/kernel/ids.ts';

function converge(args: string[]): { code: number | null; stderr: string } {
  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', 'apps/forge/cli.ts', 'preflight', 'converge', ...args],
    { cwd: FORGE_ROOT, encoding: 'utf8' },
  );
  return { code: r.status, stderr: (r.stderr ?? '') + (r.stdout ?? '') };
}

test('converge: non-integer --max-iterations → exit 2 (not silently truncated)', () => {
  const r = converge(['--project', 'x', '--max-iterations', '3x']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--max-iterations expects a positive integer/);
});

test('converge: zero / negative --max-iterations → exit 2', () => {
  assert.equal(converge(['--project', 'x', '--max-iterations', '0']).code, 2);
  assert.equal(converge(['--project', 'x', '--max-iterations', '-1']).code, 2);
});

test('converge: --accept with an empty rationale → exit 2 (never a silent no-op)', () => {
  const r = converge(['--project', 'x', '--accept', 'C8=']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--accept expects <clause>=<non-empty rationale>/);
});

test('converge: no project → exit 2 with the usage line', () => {
  const r = converge([]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /requires --project/);
});

test('converge: a flag value is never taken as the project (flags-first parsing)', () => {
  // `--max-iterations 3 x` (positional not first) — the loop-correctness fix
  // means '3' is NOT taken as the project; with no --project and no leading
  // positional, it errors for a missing project rather than resolving '3'.
  const r = converge(['--max-iterations', '3', 'somepos']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /requires --project/);
});
