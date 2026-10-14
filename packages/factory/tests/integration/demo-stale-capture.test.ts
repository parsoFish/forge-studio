/**
 * forge-nk1y.43 — gitweave I3a's demo.json carried five `Plan-…` checkpoints no
 * plan declared: media a PREVIOUS capture left in `.capture/{before,after}`
 * under an earlier plan's labels, merged back in as extra checkpoints and
 * marked `changed` by their recording stills. That turned an all-unchanged
 * capture into "5 of 11 changed". A capture starts from empty before/after
 * directories.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { captureDemoBundle } from '../../demo.ts';

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim();

test('stale media from an earlier capture never becomes a checkpoint', { timeout: 120_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'demo-stale-capture-'));
  const repo = join(root, 'repo');
  const bundleDir = join(root, 'bundle');
  try {
    mkdirSync(join(repo, '.forge'), { recursive: true });
    git(repo, 'init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'cli.mjs'), "console.log('same');\n");
    writeFileSync(join(repo, '.forge', 'project.json'), JSON.stringify({ testProcess: { local: { cmd: ['true'] } } }));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'base');
    const base = git(repo, 'rev-parse', 'HEAD');
    writeFileSync(join(repo, 'README.md'), 'docs only\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'change');
    // What an earlier capture under another plan left behind.
    for (const side of ['before', 'after']) {
      mkdirSync(join(bundleDir, side), { recursive: true });
      writeFileSync(join(bundleDir, side, 'Plan-1-WI-5-1yki11.out'), 'Error: same\n');
      writeFileSync(join(bundleDir, side, 'Plan-1-WI-5-1yki11.filmstrip.png'), side);
    }
    const jsonPath = join(root, 'demo.json');
    writeFileSync(jsonPath, JSON.stringify({
      title: 't', essence: 'e', project: 'x', diffStat: '1 file changed',
      checkpoints: [{ label: 'Plan 1: WI-1', caption: 'runs', form: 'cli-before-after', command: 'node ./cli.mjs' }],
    }));
    const { model } = await captureDemoBundle({ jsonPath, bundleDir, projectRepoPath: repo, project: 'x', baseRef: base, changedRef: 'HEAD' });
    assert.deepEqual(model.checkpoints.map((c) => [c.label, c.delta]), [['Plan 1: WI-1', 'unchanged']]);
    assert.ok(!existsSync(join(bundleDir, 'before', 'Plan-1-WI-5-1yki11.out')), 'the stale artifact is gone');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
