/**
 * `forge gate docs` — the VERB's shell: argv in, exit code out.
 *
 * The rules are tested in `packages/factory/gates/docs-gate.test.ts`. What can
 * only be tested here is the exit-code contract a merge boundary depends on,
 * and one case matters more than the others: **a mis-invoked gate must fail
 * loud**. A gate that exits 0 because it was handed no paths, or an unknown
 * flag, is a green gate over nothing — the failure this milestone keeps finding.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cmdGate } from './cli-gate.ts';

/** Run the verb with stdout/stderr silenced, and return its exit code. */
function run(args: string[]): number {
  const outs = { log: console.log, error: console.error };
  console.log = () => {};
  console.error = () => {};
  process.exitCode = 0;
  try {
    cmdGate(args);
    return process.exitCode ?? 0;
  } finally {
    console.log = outs.log;
    console.error = outs.error;
    process.exitCode = 0;
  }
}

test('a clean document exits 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-cli-gate-'));
  try {
    writeFileSync(join(dir, 'a.md'), '# T\n\n## Overview\n\nprose\n');
    assert.equal(run(['docs', '--sections', 'Overview', join(dir, 'a.md')]), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a document with findings exits 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-cli-gate-'));
  try {
    writeFileSync(join(dir, 'a.md'), '# T\n\nthe unifier ran\n');
    assert.equal(run(['docs', '--forbid', 'unifier', join(dir, 'a.md')]), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('NO PATHS exits 2, never 0 — kills "a gate that greens on nothing to check"', () => {
  assert.equal(run(['docs']), 2);
  assert.equal(run(['docs', '--forbid', 'unifier']), 2, 'flags alone are still no documents');
});

test('an unknown flag exits 2 — a mis-typed gate invocation fails loud instead of silently checking less', () => {
  assert.equal(run(['docs', '--section', 'Overview', 'a.md']), 2, 'a near-miss flag name must not be ignored');
});

test('an unknown subcommand exits 2', () => {
  assert.equal(run(['code']), 2);
  assert.equal(run([]), 2);
});

test('--no-links turns the link check off without turning the others off', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-cli-gate-'));
  try {
    writeFileSync(join(dir, 'a.md'), '# T\n\n[bad](ghost.md)\nthe unifier ran\n');
    assert.equal(run(['docs', '--no-links', join(dir, 'a.md')]), 0, 'links off, nothing else asked for');
    assert.equal(run(['docs', '--no-links', '--forbid', 'unifier', join(dir, 'a.md')]), 1, 'the forbidden check still runs');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
