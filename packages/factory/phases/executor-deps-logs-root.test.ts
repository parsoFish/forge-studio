/**
 * A1 (handoff, agents s4 re-confirmed on `05b327f0`): `DEFAULT_DEPS` resolved the
 * demo-agent and review pipelines' `logsRoot` with `resolve('_logs')` — relative to
 * the PROCESS's cwd, not to the forge checkout. A cycle started from anywhere but
 * the repo root therefore wrote its evidence into a `_logs` tree beside whatever
 * directory the operator happened to be in, and the run that went looking for it
 * later found nothing. Same class as 5.37.
 *
 * A source-level assertion would be characterization: it would look identical if
 * the value were still cwd-relative. The only thing that distinguishes the two
 * implementations is what a process with a DIFFERENT cwd computes, so this test
 * runs one — a child node process whose cwd is a temp directory — and reads the
 * value back. Under `resolve('_logs')` it prints `<tmp>/_logs`; under the fix it
 * prints the checkout's own `_logs`, whatever the cwd.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { DEFAULT_LOGS_ROOT } from './executor-deps.ts';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

test('A1: DEFAULT_LOGS_ROOT is the checkout\'s _logs, not the caller\'s cwd + /_logs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-a1-cwd-'));
  try {
    const modUrl = new URL('./executor-deps.ts', import.meta.url).href;
    const out = execFileSync(
      process.execPath,
      ['--experimental-strip-types', '--input-type=module', '-e',
       `const m = await import(${JSON.stringify(modUrl)}); process.stdout.write(m.DEFAULT_LOGS_ROOT);`],
      { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
    assert.equal(out, join(REPO_ROOT, '_logs'),
      `a process running in ${dir} must still resolve the checkout's _logs; got ${out}`);
    assert.ok(!out.startsWith(dir), 'the logs root must not be derived from the process cwd');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('A1: the in-process value agrees with the child process\'s (one definition, not two)', () => {
  assert.equal(DEFAULT_LOGS_ROOT, join(REPO_ROOT, '_logs'));
});
