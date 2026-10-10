/**
 * forge-nk1y.20 — the kernel predicate's own contract. The escape-shape table
 * (with real symlinks and real targets) lives in
 * `packages/flows/tests/regression/worktree-containment-escapes.test.ts`; this
 * pins what only the kernel owns: it never throws on a hostile argument and its
 * reason is a fixed NAME, never a path.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initiativeWorktreeRefusal } from '../../initiative-worktree.ts';

const ID = 'INIT-2026-10-10-alpha';

test('initiativeWorktreeRefusal: non-string arguments are refused by name, never thrown', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'iw-')));
  try {
    mkdirSync(join(root, '_worktrees', ID), { recursive: true });
    const own = join(root, '_worktrees', ID);
    for (const bad of [null, undefined, 42, {}, [], Symbol('x')] as unknown[]) {
      assert.equal(initiativeWorktreeRefusal(bad as string, { forgeRoot: root, initiativeId: ID }), 'not-absolute');
      assert.equal(initiativeWorktreeRefusal(own, { forgeRoot: root, initiativeId: bad as string }), 'unsafe-initiative-id');
      assert.equal(initiativeWorktreeRefusal(own, { forgeRoot: bad as string, initiativeId: ID }), 'forge-root-unavailable');
    }
    assert.equal(initiativeWorktreeRefusal(own, { forgeRoot: root, initiativeId: ID }), null, 'control: the own worktree is accepted');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('initiativeWorktreeRefusal: a refusal is a short fixed name that never contains the path or the forge root', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'iw-')));
  try {
    mkdirSync(join(root, 'projects', 'secret-project'), { recursive: true });
    const reason = initiativeWorktreeRefusal(join(root, 'projects', 'secret-project'), { forgeRoot: root, initiativeId: ID });
    assert.equal(reason, 'not-under-forge-worktrees');
    assert.match(reason!, /^[a-z-]+$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('initiativeWorktreeRefusal: a forge root that does not exist is refused by name, not accepted as an empty slot', () => {
  assert.equal(
    initiativeWorktreeRefusal('/nonexistent-forge-root-xyz/_worktrees/' + ID, { forgeRoot: '/nonexistent-forge-root-xyz', initiativeId: ID }),
    'forge-root-unavailable',
  );
});
