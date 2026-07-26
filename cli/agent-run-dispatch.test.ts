/**
 * Tests for `cmdAgentDispatch` (R2-01-F3) — the `forge agent dispatch <slug>`
 * generic-run CLI the bridge spawns detached. Arg parsing + the no-spawn-seam
 * happy path; `process.exit` + console are stubbed so exit codes are asserted
 * without tearing down the test runner.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { cmdAgentDispatch } from './agent-run.ts';

const ROOT = process.cwd();

async function run(args: string[]): Promise<{ exitCode: number | null; out: string; err: string }> {
  const origExit = process.exit;
  const origLog = console.log;
  const origErr = console.error;
  let exitCode: number | null = null;
  const out: string[] = [];
  const err: string[] = [];
  // Throw a sentinel from the stub so control returns immediately (the real
  // handler expects process.exit to end the process).
  process.exit = ((code?: number) => { exitCode = code ?? 0; throw new Error(`__exit__${exitCode}`); }) as typeof process.exit;
  console.log = (...a: unknown[]) => { out.push(a.join(' ')); };
  console.error = (...a: unknown[]) => { err.push(a.join(' ')); };
  try {
    await cmdAgentDispatch(args, ROOT);
  } catch (e) {
    if (!/^__exit__/.test((e as Error).message)) throw e;
  } finally {
    process.exit = origExit;
    console.log = origLog;
    console.error = origErr;
  }
  return { exitCode, out: out.join('\n'), err: err.join('\n') };
}

test('cmdAgentDispatch: missing slug → exit 2', async () => {
  const r = await run([]);
  assert.equal(r.exitCode, 2);
  assert.match(r.err, /missing <slug>/);
});

test('cmdAgentDispatch: missing --run-id → exit 2', async () => {
  const r = await run(['project-scoped-review']);
  assert.equal(r.exitCode, 2);
  assert.match(r.err, /--run-id/);
});

test('cmdAgentDispatch: malformed --input (no =) → exit 2', async () => {
  const r = await run(['project-scoped-review', '--run-id', '_agent-cli', '--input', 'novalue']);
  assert.equal(r.exitCode, 2);
  assert.match(r.err, /--input expects k=v/);
});

test('cmdAgentDispatch: unknown --project → exit 2', async () => {
  const r = await run(['project-scoped-review', '--run-id', '_agent-cli', '--project', 'no-such-project-xyz']);
  assert.equal(r.exitCode, 2);
  assert.match(r.err, /project root not found/);
});

test('cmdAgentDispatch: happy path under the no-spawn seam → suppressed, no exit', async () => {
  const prior = process.env.FORGE_ARCHITECT_NO_SPAWN;
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const runId = '_agent-cli-suppressed-test';
  try {
    const r = await run(['project-scoped-review', '--run-id', runId]);
    assert.equal(r.exitCode, null, 'no exit on a successful (suppressed) dispatch');
    assert.match(r.out, /spawn suppressed/);
  } finally {
    if (prior === undefined) delete process.env.FORGE_ARCHITECT_NO_SPAWN;
    else process.env.FORGE_ARCHITECT_NO_SPAWN = prior;
    rmSync(join(ROOT, '_logs', runId), { recursive: true, force: true });
  }
});
