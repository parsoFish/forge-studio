/**
 * SEC-07 r35 hardening (defense-in-depth) locks for `findSessionProject`
 * (`cli/agent-run.ts`). r35 is NOT a red→green exploit pin: the function's own
 * finding is a non-exploitable existence oracle, statically proven never to
 * return an out-of-root path (it only ever returns one of the real
 * `projects/*` entries it scanned). The fix (a) EXPORTS the function for direct
 * testing (`cli/` is uncapped — export-for-testability is allowed) and (b) adds
 * a cheap defensive bound `if (!isSafeRunId(sessionId)) return null;` at the
 * top. These are hygiene locks, not a defect pin.
 *
 * RED-AT-BASE for this file is the EXPORT: `findSessionProject` is not exported
 * on the current code, so the import below fails to resolve and the whole file
 * errors until the fix lands. That is the expected, disclosed red here.
 *
 * PUBLIC-REPO NOTE: neutral naming — a separator/traversal-shaped id is bounded
 * out; a legitimate id still resolves.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { findSessionProject } from './agent-run.ts';

/** chdir for the duration of `fn` (findSessionProject reads a cwd-relative
 *  `resolve('projects')`), always restoring. */
async function withCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(prev);
  }
}

test('a separator-shaped session id is bounded out (returns null)', async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'sec07-findsession-'));
  mkdirSync(join(fixture, 'projects'), { recursive: true });
  try {
    await withCwd(fixture, async () => {
      assert.equal(findSessionProject('a/b/c'), null, 'a session id containing a separator must be bounded out');
    });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('a traversal-shaped session id is bounded out (returns null)', async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'sec07-findsession-'));
  mkdirSync(join(fixture, 'projects'), { recursive: true });
  try {
    await withCwd(fixture, async () => {
      assert.equal(findSessionProject('..'), null, 'a ".." session id must be bounded out');
    });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('a legitimate session id still resolves to its project dir (the bound does not over-reject real ids)', async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'sec07-findsession-'));
  const project = 'realproj';
  const legitSid = 'sec07-legit-sid';
  const sessionDir = join(fixture, 'projects', project, '_architect', legitSid);
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, 'status.json'), JSON.stringify({ phase: 'drafting' }));
  try {
    await withCwd(fixture, async () => {
      // findSessionProject builds `candidate = join(resolve('projects'), name)`
      // — compute the expected value the identical way under the same cwd.
      const expected = join(resolve('projects'), project);
      assert.equal(findSessionProject(legitSid), expected, 'a legitimate session id must resolve to its containing project dir');
    });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
