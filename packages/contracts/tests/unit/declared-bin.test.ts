/**
 * `resolveDeclaredBin` — the pure decision for a bare checkpoint command whose
 * head is not on PATH but is declared in the worktree's package.json `bin`
 * (bead forge-8vfn.30.9). Containment is decided lexically here; the kernel's
 * `resolveCheckpointHead` adds the symlink re-check.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveDeclaredBin } from '../../demo-declaration.ts';

test('object bin: the key names the command; the target is normalised worktree-relative', () => {
  assert.deepEqual(resolveDeclaredBin({ name: 'x', bin: { gp: './dist/cli.js' } }, 'gp'), {
    kind: 'contained',
    target: 'dist/cli.js',
  });
});

test('string bin counts under the package name (scope stripped)', () => {
  assert.deepEqual(resolveDeclaredBin({ name: 'gitpulse', bin: './dist/cli.js' }, 'gitpulse'), {
    kind: 'contained',
    target: 'dist/cli.js',
  });
  assert.deepEqual(resolveDeclaredBin({ name: '@acme/gp', bin: 'cli.js' }, 'gp'), { kind: 'contained', target: 'cli.js' });
});

test('an undeclared name, a missing bin, or a non-object package is undeclared', () => {
  assert.deepEqual(resolveDeclaredBin({ name: 'x', bin: { gp: './a.js' } }, 'other'), { kind: 'undeclared' });
  assert.deepEqual(resolveDeclaredBin({ name: 'x' }, 'x'), { kind: 'undeclared' });
  assert.deepEqual(resolveDeclaredBin({ name: 'x', bin: 'a.js' }, 'y'), { kind: 'undeclared' });
  assert.deepEqual(resolveDeclaredBin(null, 'x'), { kind: 'undeclared' });
  assert.deepEqual(resolveDeclaredBin({ name: 'x', bin: { constructor: './a.js' } }, 'constructor'), { kind: 'contained', target: 'a.js' });
  assert.deepEqual(resolveDeclaredBin({ name: 'x', bin: {} }, 'toString'), { kind: 'undeclared' });
});

test('an absolute target is rejected, never followed', () => {
  const r = resolveDeclaredBin({ name: 'x', bin: { gp: '/usr/bin/evil' } }, 'gp');
  assert.equal(r.kind, 'rejected');
  assert.match(r.kind === 'rejected' ? r.reason : '', /absolute/);
});

test('a target escaping the worktree via .. is rejected', () => {
  for (const t of ['../x', './../x', '..']) {
    const r = resolveDeclaredBin({ name: 'x', bin: { gp: t } }, 'gp');
    assert.equal(r.kind, 'rejected', t);
    assert.match(r.kind === 'rejected' ? r.reason : '', /outside the worktree/);
  }
});

test('a nested ./a/../../x escape is rejected; ./a/../b.js stays contained', () => {
  assert.equal(resolveDeclaredBin({ name: 'x', bin: { gp: './a/../../x' } }, 'gp').kind, 'rejected');
  assert.deepEqual(resolveDeclaredBin({ name: 'x', bin: { gp: './a/../b.js' } }, 'gp'), { kind: 'contained', target: 'b.js' });
});

test('a non-js target is contained like any other (capture decides how to spawn it)', () => {
  assert.deepEqual(resolveDeclaredBin({ name: 'x', bin: { gp: 'bin/gp' } }, 'gp'), { kind: 'contained', target: 'bin/gp' });
});

test('a malformed declaration (non-string / empty / worktree-root target) is rejected, not skipped', () => {
  for (const t of [5, '', '.', './']) {
    assert.equal(resolveDeclaredBin({ name: 'x', bin: { gp: t } }, 'gp').kind, 'rejected', String(t));
  }
});
