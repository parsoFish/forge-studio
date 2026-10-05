/**
 * SEC-07 r35 hardening (defense-in-depth) locks for `findSessionProject`
 * (`apps/forge/agent-run.ts`). r35 is NOT a red→green exploit pin: the function's own
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
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { findSessionProject } from '../../find-session-project.ts';

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
      assert.equal(findSessionProject(join(fixture, '_logs'), 'a/b/c'), null, 'a session id containing a separator must be bounded out');
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
      assert.equal(findSessionProject(join(fixture, '_logs'), '..'), null, 'a ".." session id must be bounded out');
    });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('a legitimate session id still resolves to its project dir (the bound does not over-reject real ids)', async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'sec07-findsession-'));
  const project = 'realproj';
  const legitSid = 'sec07-legit-sid';
  const sessionDir = join(fixture, '_logs', '_sessions', project, '_architect', legitSid);
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, 'status.json'), JSON.stringify({ phase: 'drafting' }));
  try {
    await withCwd(fixture, async () => {
      assert.equal(findSessionProject(join(fixture, '_logs'), legitSid), project, 'a legitimate session id must resolve to its containing project name');
    });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('a symlinked kind dir (or status.json leaf) under <logsRoot>/_sessions is NOT a match — no out-of-root existence oracle', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'sec07-findsession-link-'));
  try {
    const outside = join(fixture, 'outside');
    mkdirSync(join(outside, 'victim-sid'), { recursive: true });
    writeFileSync(join(outside, 'victim-sid', 'status.json'), JSON.stringify({ phase: 'drafting' }));
    mkdirSync(join(fixture, '_logs', '_sessions', 'attacker'), { recursive: true });
    symlinkSync(outside, join(fixture, '_logs', '_sessions', 'attacker', '_architect'), 'dir');
    assert.equal(findSessionProject(join(fixture, '_logs'), 'victim-sid'), null, 'a symlinked _architect dir must not resolve');

    const sessionDir = join(fixture, '_logs', '_sessions', 'leaky', '_architect', 'leaf-sid');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(outside, 'secret.json'), '{}');
    symlinkSync(join(outside, 'secret.json'), join(sessionDir, 'status.json'));
    assert.equal(findSessionProject(join(fixture, '_logs'), 'leaf-sid'), null, 'a symlinked status.json leaf must not resolve');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
