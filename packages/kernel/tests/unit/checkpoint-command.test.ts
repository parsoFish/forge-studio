/** `resolveCheckpointHead` — PATH, then a contained package.json bin (forge-8vfn.30.9). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveCheckpointHead } from '../../checkpoint-command.ts';

function inTree(pkg: string | object, fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'ckpt-head-'));
  const saved = process.env.PATH;
  try {
    writeFileSync(join(dir, 'package.json'), typeof pkg === 'string' ? pkg : JSON.stringify(pkg));
    process.env.PATH = join(dir, 'no-such-dir');
    fn(dir);
  } finally {
    process.env.PATH = saved;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a path-bearing head is returned unchanged', () => {
  const r = resolveCheckpointHead(['./x.sh', 'a'], '/nonexistent');
  assert.deepEqual(r, { ok: true, via: 'as-given', file: './x.sh', args: ['a'] });
});

test('a declared .js bin runs under process.execPath; a non-js bin runs directly', () => {
  inTree({ name: 'x', bin: { gp: './dist/cli.js', sh: 'bin/run' } }, (dir) => {
    const js = resolveCheckpointHead(['gp', '-v'], dir);
    assert.deepEqual(js, { ok: true, via: 'bin', file: process.execPath, args: [join(dir, 'dist/cli.js'), '-v'] });
    const raw = resolveCheckpointHead(['sh'], dir);
    assert.deepEqual(raw, { ok: true, via: 'bin', file: join(dir, 'bin/run'), args: [] });
  });
});

test('a bin target that is a symlink out of the worktree is refused', () => {
  const outside = mkdtempSync(join(tmpdir(), 'ckpt-out-'));
  try {
    writeFileSync(join(outside, 'evil.js'), '');
    inTree({ name: 'x', bin: { gp: './link.js' } }, (dir) => {
      symlinkSync(join(outside, 'evil.js'), join(dir, 'link.js'));
      const r = resolveCheckpointHead(['gp'], dir);
      assert.equal(r.ok, false);
      assert.match(r.ok ? '' : r.reason, /via symlink/);
    });
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test('a symlinked bin target that stays inside the worktree is accepted', () => {
  inTree({ name: 'x', bin: { gp: './link.js' } }, (dir) => {
    mkdirSync(join(dir, 'real'));
    writeFileSync(join(dir, 'real', 'a.js'), '');
    symlinkSync(join(dir, 'real', 'a.js'), join(dir, 'link.js'));
    assert.equal(resolveCheckpointHead(['gp'], dir).ok, true);
  });
});

test('a missing package.json is "no bin declared"; a malformed one is a named refusal', () => {
  inTree('{bad', (dir) => {
    const r = resolveCheckpointHead(['gp'], dir);
    assert.match(r.ok ? '' : r.reason, /unreadable or malformed/);
    rmSync(join(dir, 'package.json'));
    const r2 = resolveCheckpointHead(['gp'], dir);
    assert.match(r2.ok ? '' : r2.reason, /PATH.*package\.json "bin"/);
  });
});
