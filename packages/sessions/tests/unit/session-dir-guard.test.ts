/**
 * forge-8vfn.8.5.58 — `guardedSessionDir` is the bridge's ONE containment choke
 * point for request-derived session dirs, now rooted at the LOGS root
 * (`<logsRoot>/_sessions/<project>/<kindDir>/<sid>`). The route-level
 * containment tests cannot see it fail: the later guarded leaf writes refuse
 * the same escapes, so removing this guard changes no HTTP outcome. Pinned
 * directly here so removing it is RED.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { guardedSessionDir } from '../../bridge-studio-session-helpers.ts';

function fixture(): { logsRoot: string; outside: string; done: () => void } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'session-dir-guard-')));
  const logsRoot = join(root, '_logs');
  const outside = join(root, 'outside');
  mkdirSync(logsRoot, { recursive: true });
  mkdirSync(join(outside, 'victim-session'), { recursive: true });
  return { logsRoot, outside, done: () => rmSync(root, { recursive: true, force: true }) };
}

test('a legitimate session dir resolves under <logsRoot>/_sessions/<project>/<kindDir>/<sid>', () => {
  const f = fixture();
  try {
    mkdirSync(join(f.logsRoot, '_sessions', 'proj', '_architect', 'sid1'), { recursive: true });
    assert.equal(guardedSessionDir(f.logsRoot, 'proj', '_architect', 'sid1'), join(f.logsRoot, '_sessions', 'proj', '_architect', 'sid1'));
  } finally { f.done(); }
});

test('a not-yet-created session dir (the /start case) is still contained, not null', () => {
  const f = fixture();
  try {
    assert.equal(guardedSessionDir(f.logsRoot, 'proj', '_architect', 'brand-new'), join(f.logsRoot, '_sessions', 'proj', '_architect', 'brand-new'));
  } finally { f.done(); }
});

test('traversal in project or sessionId is refused (null)', () => {
  const f = fixture();
  try {
    assert.equal(guardedSessionDir(f.logsRoot, '..', '_architect', 'sid1'), null);
    assert.equal(guardedSessionDir(f.logsRoot, 'proj', '_architect', '../../outside/victim-session'), null);
    assert.equal(guardedSessionDir(f.logsRoot, 'proj', '_architect', 'a/b'), null);
  } finally { f.done(); }
});

test('a symlinked kind dir under the logs root is refused (identity mismatch), not followed', () => {
  const f = fixture();
  try {
    mkdirSync(join(f.logsRoot, '_sessions', 'proj'), { recursive: true });
    symlinkSync(f.outside, join(f.logsRoot, '_sessions', 'proj', '_architect'), 'dir');
    assert.equal(guardedSessionDir(f.logsRoot, 'proj', '_architect', 'victim-session'), null);
  } finally { f.done(); }
});

test('a symlinked project home under the logs root is refused', () => {
  const f = fixture();
  try {
    mkdirSync(join(f.logsRoot, '_sessions'), { recursive: true });
    symlinkSync(f.outside, join(f.logsRoot, '_sessions', 'proj'), 'dir');
    assert.equal(guardedSessionDir(f.logsRoot, 'proj', '_architect', 'victim-session'), null);
  } finally { f.done(); }
});

test('a symlinked session id is refused', () => {
  const f = fixture();
  try {
    mkdirSync(join(f.logsRoot, '_sessions', 'proj', '_architect'), { recursive: true });
    symlinkSync(join(f.outside, 'victim-session'), join(f.logsRoot, '_sessions', 'proj', '_architect', 'linked'), 'dir');
    assert.equal(guardedSessionDir(f.logsRoot, 'proj', '_architect', 'linked'), null);
  } finally { f.done(); }
});
