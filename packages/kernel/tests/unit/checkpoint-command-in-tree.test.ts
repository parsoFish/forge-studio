/**
 * A checkpoint head runs the TREE under capture (forge-nk1y.42). Measured on
 * gitweave I3a: `gw` resolved on PATH to one global install, so before and
 * after ran the same code and 11/11 checkpoints were byte-identical. Each
 * fixture puts a stale binary of the same name on PATH: a resolution that
 * picks it is the defect.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

import { resolveCheckpointHead } from '../../checkpoint-command.ts';

type Fixture = { tree: string; staleDir: string };

/** A tree plus a PATH holding a stale `gw` and the node runtime only. */
function withStalePath(files: Record<string, string>, fn: (f: Fixture) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'ckpt-in-tree-'));
  const tree = join(root, 'tree');
  const staleDir = join(root, 'stale-bin');
  mkdirSync(tree);
  mkdirSync(staleDir);
  const stale = join(staleDir, 'gw');
  writeFileSync(stale, '#!/bin/sh\necho stale\n');
  chmodSync(stale, 0o755);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(tree, rel)), { recursive: true });
    writeFileSync(join(tree, rel), body);
  }
  const saved = process.env.PATH;
  process.env.PATH = [staleDir, dirname(process.execPath)].join(delimiter);
  try {
    fn({ tree, staleDir });
  } finally {
    process.env.PATH = saved;
    rmSync(root, { recursive: true, force: true });
  }
}

const PYPROJECT = '[project]\nname = "gitweave"\n\n[project.scripts]\ngw = "gitweave.cli:main"\n\n[tool.setuptools]\n';

test('a head the tree declares (pyproject scripts) that resolves only on PATH is refused by name', () => {
  withStalePath({ 'pyproject.toml': PYPROJECT }, ({ tree, staleDir }) => {
    const r = resolveCheckpointHead(['gw', 'plan'], tree);
    assert.equal(r.ok, false);
    const reason = r.ok ? '' : r.reason;
    assert.ok(reason.includes(`\`gw\` resolves to ${join(staleDir, 'gw')} outside the capture tree`), reason);
    assert.match(reason, /demoMeans\.run/);
  });
});

test('a poetry-declared script is the tree’s own entry point too', () => {
  withStalePath({ 'pyproject.toml': '[tool.poetry.scripts]\n"gw" = "gitweave.cli:main"\n' }, ({ tree }) => {
    assert.equal(resolveCheckpointHead(['gw'], tree).ok, false);
  });
});

test('a declared run prefix executes the tree: `gw plan` → `node ./cli.mjs plan`', () => {
  withStalePath({ 'pyproject.toml': PYPROJECT, 'cli.mjs': '' }, ({ tree }) => {
    const r = resolveCheckpointHead(['gw', 'plan', '-v'], tree, { runPrefixes: { gw: 'node ./cli.mjs' } });
    assert.deepEqual(r, { ok: true, via: 'prefix', file: 'node', args: ['./cli.mjs', 'plan', '-v'] });
  });
});

test('a package.json bin in the tree beats a PATH binary of the same name', () => {
  withStalePath({ 'package.json': JSON.stringify({ name: 'x', bin: { gw: './cli.mjs' } }), 'cli.mjs': '' }, ({ tree }) => {
    const r = resolveCheckpointHead(['gw', 'plan'], tree);
    assert.deepEqual(r, { ok: true, via: 'bin', file: process.execPath, args: [join(tree, 'cli.mjs'), 'plan'] });
  });
});

test('a system tool the tree does not declare still runs from PATH', () => {
  withStalePath({ 'pyproject.toml': PYPROJECT }, ({ tree }) => {
    const r = resolveCheckpointHead(['node', '-v'], tree);
    assert.deepEqual(r, { ok: true, via: 'path', file: 'node', args: ['-v'] });
  });
});

test('an absolute head outside the tree is refused by name; one inside is run as given', () => {
  withStalePath({ 'bin/run': '' }, ({ tree, staleDir }) => {
    const out = resolveCheckpointHead([join(staleDir, 'gw')], tree);
    assert.equal(out.ok, false);
    assert.match(out.ok ? '' : out.reason, /outside the capture tree/);
    const inside = resolveCheckpointHead([join(tree, 'bin/run'), 'a'], tree);
    assert.deepEqual(inside, { ok: true, via: 'as-given', file: join(tree, 'bin/run'), args: ['a'] });
  });
});

test('a relative head that climbs out of the tree is refused by name', () => {
  withStalePath({}, ({ tree }) => {
    const r = resolveCheckpointHead(['../stale-bin/gw'], tree);
    assert.equal(r.ok, false);
    assert.match(r.ok ? '' : r.reason, /outside the capture tree/);
  });
});

test('an invalid run prefix is refused at the point of use, never run', () => {
  withStalePath({ 'pyproject.toml': PYPROJECT }, ({ tree, staleDir }) => {
    for (const prefix of ['gw', `${join(staleDir, 'gw')}`, '../x/gw', 'node ./cli.mjs; rm -rf x', '   ', `node --require=${join(staleDir, 'gw')} ./cli.mjs`, 'node --require=../x.js ./cli.mjs']) {
      const r = resolveCheckpointHead(['gw'], tree, { runPrefixes: { gw: prefix } });
      assert.equal(r.ok, false, `prefix ${JSON.stringify(prefix)} must be refused`);
      assert.match(r.ok ? '' : r.reason, /demoMeans\.run\.gw/);
    }
  });
});

test('a prefix whose own head is a tree entry point on PATH is refused (no laundering through the prefix)', () => {
  withStalePath({ 'pyproject.toml': PYPROJECT }, ({ tree }) => {
    const r = resolveCheckpointHead(['gwx', 'plan'], tree, { runPrefixes: { gwx: 'gw' } });
    assert.equal(r.ok, false);
    assert.match(r.ok ? '' : r.reason, /outside the capture tree/);
  });
});

test('a path-bearing head that is an in-tree symlink to a PATH copy is refused (realpath, not lexical)', () => {
  withStalePath({}, ({ tree, staleDir }) => {
    mkdirSync(join(tree, 'bin'));
    symlinkSync(join(staleDir, 'gw'), join(tree, 'bin', 'gw'));
    const r = resolveCheckpointHead(['./bin/gw', 'plan'], tree);
    assert.equal(r.ok, false);
    assert.match(r.ok ? '' : r.reason, /resolves \(via symlink\) outside the capture tree/);
  });
});
