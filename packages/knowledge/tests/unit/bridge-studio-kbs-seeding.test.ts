/**
 * Tests for `mintProjectBrainSeedingSession` (packages/knowledge/bridge-studio-kbs.ts)
 * — forge-hph, the last of the 3 sibling sites forge-4vt's fix shape names.
 *
 * The 2 sibling /start routes (packages/sessions/bridge-studio-architect.ts and
 * the project-brain start route) already resolve their caller-supplied
 * `project_repo_path` through `resolveGuardedPath` rather than a raw
 * `join(projectsRoot, ...)` fold. This site had no caller-supplied override
 * to fall back FROM at all — it always folded `sessionProject` into
 * `projectsRoot` with a bare `join()`, which normalizes `..` instead of
 * refusing it. Not a live escape today (the guarded `write()` call a few
 * lines later independently validates the same segment before anything is
 * persisted), but the SAME containment guard the siblings use closes the
 * structural gap rather than relying on that ordering.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { mintProjectBrainSeedingSession } from '../../bridge-studio-kbs.ts';
import type { GuardedWriteSessionStatusFn } from '../../kb-drain-model.ts';

/** Deliberately UNGUARDED — records whatever status object it is handed and
 *  always "succeeds". Real `write()` implementations guard `dirSegments`
 *  themselves (see `../test-fixtures/session-status-io.ts`), which would mask
 *  what THIS test targets: whether `project_repo_path` itself was resolved
 *  safely before reaching `write()` at all. */
function recordingWrite(): { write: GuardedWriteSessionStatusFn; captured: () => Record<string, unknown> | undefined } {
  let captured: Record<string, unknown> | undefined;
  const write: GuardedWriteSessionStatusFn = (root, segs, status) => {
    captured = status;
    return join(root, ...segs, 'status.json');
  };
  return { write, captured: () => captured };
}

test('mintProjectBrainSeedingSession: refuses a traversal-shaped project segment instead of folding it into project_repo_path (forge-hph)', () => {
  const projectsRoot = mkdtempSync(join(tmpdir(), 'kbs-seed-'));
  try {
    const { write, captured } = recordingWrite();
    assert.throws(
      () => mintProjectBrainSeedingSession(projectsRoot, '../../etc', 'kb1', { kind: 'unique' }, write),
      /containment/,
      'must refuse by name, the same way the sibling /start routes do',
    );
    assert.equal(captured(), undefined, 'must refuse BEFORE persisting a session status at all');
  } finally {
    rmSync(projectsRoot, { recursive: true, force: true });
  }
});

test('mintProjectBrainSeedingSession: an ordinary project segment still resolves project_repo_path correctly (control)', () => {
  const projectsRoot = mkdtempSync(join(tmpdir(), 'kbs-seed-'));
  try {
    const { write, captured } = recordingWrite();
    mintProjectBrainSeedingSession(projectsRoot, 'my-project', 'kb1', { kind: 'unique' }, write);
    const status = captured();
    assert.ok(status, 'a normal segment must still succeed');
    assert.equal(status?.project_repo_path, join(projectsRoot, 'my-project'));
  } finally {
    rmSync(projectsRoot, { recursive: true, force: true });
  }
});
