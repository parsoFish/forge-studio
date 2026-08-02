/**
 * Tests for the `forge create` CLI (R4-03) — flag parsing, the `list`
 * subcommand, and exit codes. Only side-effect-free paths are exercised here
 * (list / missing flags / unknown app-type errors BEFORE any scaffold write);
 * the scaffold itself is covered hermetically by project-create.test.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();

function create(args: string[]): { code: number | null; out: string } {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', 'orchestrator/cli.ts', 'create', ...args], {
    cwd: ROOT, encoding: 'utf8',
  });
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

test('create list: prints the curated app types (exit 0)', () => {
  const r = create(['list']);
  assert.equal(r.code, 0);
  assert.match(r.out, /typescript-cli/);
  assert.match(r.out, /typescript-api/);
});

test('create: missing required flags → exit 2 with usage', () => {
  const r = create(['--name', 'x']);
  assert.equal(r.code, 2);
  assert.match(r.out, /requires --name .* --app-type .* --north-star/);
});

test('create: unknown app-type → exit 1 (errors before any scaffold write)', () => {
  const r = create(['--name', 'x', '--app-type', 'cobol-mainframe', '--north-star', 'y']);
  assert.equal(r.code, 1);
  assert.match(r.out, /unknown appType/);
});
