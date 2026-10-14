/**
 * forge-nk1y.42 — before/after must run the TREE under capture. A git repo with
 * two revisions of an in-tree CLI (prints v1, then v2) is materialised as two
 * worktrees, exactly as `captureCheckpoints` does; a stale `gw` sits first on
 * PATH. Measured defect: the PATH copy ran for both sides, so gitweave I3a's
 * 11/11 checkpoints came out byte-identical.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

import { captureCommandOutput, captureDemoBundle } from '../../demo.ts';

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim();

type Trees = { before: string; after: string };

function withTwoRevisions(fn: (t: Trees) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'demo-in-tree-'));
  const repo = join(root, 'repo');
  const stale = join(root, 'stale-bin');
  mkdirSync(repo);
  mkdirSync(stale);
  writeFileSync(join(stale, 'gw'), '#!/bin/sh\necho stale-global-install\n');
  chmodSync(join(stale, 'gw'), 0o755);
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'pyproject.toml'), '[project]\nname = "gw"\n\n[project.scripts]\ngw = "gw.cli:main"\n');
  writeFileSync(join(repo, 'cli.mjs'), "console.log('plan: v1', process.argv.slice(2).join(' '));\n");
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'v1');
  const base = git(repo, 'rev-parse', 'HEAD');
  writeFileSync(join(repo, 'cli.mjs'), "console.log('plan: v2', process.argv.slice(2).join(' '));\n");
  git(repo, 'commit', '-q', '-am', 'v2');
  const changed = git(repo, 'rev-parse', 'HEAD');
  const before = join(root, '_trees', 'before');
  const after = join(root, '_trees', 'after');
  git(repo, 'worktree', 'add', '-q', '--detach', before, base);
  git(repo, 'worktree', 'add', '-q', '--detach', after, changed);
  const saved = process.env.PATH;
  process.env.PATH = [stale, dirname(process.execPath)].join(delimiter);
  try {
    fn({ before, after });
  } finally {
    process.env.PATH = saved;
    rmSync(root, { recursive: true, force: true });
  }
}

test('with a declared run prefix, a changed tree captures a changed output (before ≠ after)', () => {
  withTwoRevisions(({ before, after }) => {
    const opts = { runPrefixes: { gw: 'node ./cli.mjs' } };
    const b = captureCommandOutput(before, 'gw plan --org x', opts);
    const a = captureCommandOutput(after, 'gw plan --org x', opts);
    assert.equal(b, 'plan: v1 plan --org x\n');
    assert.equal(a, 'plan: v2 plan --org x\n');
    assert.notEqual(b, a);
  });
});

test('without one, the PATH copy never runs: both sides record the named refusal', () => {
  withTwoRevisions(({ before, after }) => {
    for (const tree of [before, after]) {
      const out = captureCommandOutput(tree, 'gw plan');
      assert.doesNotMatch(out, /stale-global-install/);
      assert.match(out, /^\[command did not run: `gw` resolves to .*stale-bin\/gw outside the capture tree .*demoMeans\.run/);
    }
  });
});

// The door: `captureDemoBundle` reads the project's own demoMeans.run and runs
// it in both materialised trees — a changed tree reads `changed`.

test('captureDemoBundle: with the project\'s declared run prefix, a changed tree reads changed', { timeout: 120_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'demo-bundle-in-tree-'));
  const repo = join(root, 'repo');
  const stale = join(root, 'stale-bin');
  mkdirSync(join(repo, '.forge'), { recursive: true });
  mkdirSync(stale);
  writeFileSync(join(stale, 'gw'), '#!/bin/sh\necho stale-global-install\n');
  chmodSync(join(stale, 'gw'), 0o755);
  const saved = process.env.PATH;
  try {
    git(repo, 'init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'pyproject.toml'), '[project.scripts]\ngw = "gw.cli:main"\n');
    writeFileSync(join(repo, 'cli.mjs'), "console.log('plan: v1');\n");
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'v1');
    const base = git(repo, 'rev-parse', 'HEAD');
    writeFileSync(join(repo, 'cli.mjs'), "console.log('plan: v2');\n");
    git(repo, 'commit', '-q', '-am', 'v2');
    // The project config is read from the project repo, as the CLI does.
    writeFileSync(join(repo, '.forge', 'project.json'), JSON.stringify({ testProcess: { local: { cmd: ['true'] } }, demoMeans: { run: { gw: 'node ./cli.mjs' } } }));
    const jsonPath = join(root, 'demo.json');
    writeFileSync(jsonPath, JSON.stringify({
      initiativeId: 'INIT-2026-10-14-x', title: 't', essence: 'e', diffStat: '1 file changed',
      checkpoints: [{ label: 'Plan 1', caption: 'plan', command: 'gw plan' }],
    }));
    process.env.PATH = [stale, ...(saved ?? '').split(delimiter)].join(delimiter);
    const { model } = await captureDemoBundle({
      jsonPath, bundleDir: join(root, 'bundle'), projectRepoPath: repo, project: 'x', baseRef: base, changedRef: 'HEAD',
    });
    const cp = model.checkpoints[0] as { delta?: string; beforeOutput?: string; afterOutput?: string };
    assert.equal(cp.delta, 'changed');
    assert.match(cp.beforeOutput ?? '', /plan: v1/);
    assert.match(cp.afterOutput ?? '', /plan: v2/);
  } finally {
    process.env.PATH = saved;
    rmSync(root, { recursive: true, force: true });
  }
});
