/**
 * Bead forge-mfv5.1.40 (P1, capstone-found) — the entry rebase (D-06) stopped
 * on gitweave I3b round 2 because untracked forge scratch
 * (`.forge/work-items-rejected-<ts>/`, the PM repair's residue) sat at paths a
 * replayed branch commit ADDS (a pre-review boundary snapshot; a later commit
 * drops them again): git refuses to overwrite untracked files, and the reason
 * it recorded was only `Rebasing (n/72)` progress noise.
 *
 * Fixture: real temp git, no origin, no network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createLogger } from '@forge/kernel';
import { rebaseForResume } from '../../cycle-helpers.ts';
import type { CycleInput } from '../../cycle-context.ts';

const INIT = 'INIT-2026-10-16-rebase-scratch';
const REJECTED = '.forge/work-items-rejected-2026-10-12T05-20-04-070Z';

function ground(opts: { conflict?: boolean; snapshotWorkItems?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'rebase-scratch-'));
  const wt = join(root, 'wt');
  mkdirSync(wt);
  const git = (args: string[]) => execFileSync('git', args, { cwd: wt, stdio: 'pipe', encoding: 'utf8' }).trim();
  const commit = (file: string, body: string, msg: string) => { mkdirSync(join(wt, file, '..'), { recursive: true }); writeFileSync(join(wt, file), body); git(['add', '--', file]); git(['commit', '-q', '-m', msg]); };
  git(['init', '-q', '-b', 'main']); git(['config', 'user.email', 't@t']); git(['config', 'user.name', 't']);
  commit('a.txt', 'base\n', 'base');
  git(['checkout', '-q', '-b', `forge/${INIT}`]);
  commit('b.txt', 'wi work\n', 'wi(WI-1): merge');
  // The pre-review snapshot commit ADDS the PM repair residue, then a later commit drops it.
  for (let n = 1; n <= 3; n++) commit(`${REJECTED}/WI-${n}.md`, `snapshot WI-${n}\n`, n === 3 ? 'chore(developer-loop): pre-review boundary snapshot' : `snap ${n}`);
  if (opts.snapshotWorkItems) commit('.forge/work-items/WI-1.md', 'status: pending\n', 'snap work items');
  git(['rm', '-q', '-r', '--', REJECTED, ...(opts.snapshotWorkItems ? ['.forge/work-items'] : [])]); git(['commit', '-q', '-m', 'chore: drop forge scratch']);
  if (opts.conflict) commit('a.txt', 'branch edit\n', 'wi(WI-2): edit a');
  git(['checkout', '-q', 'main']);
  commit(opts.conflict ? 'a.txt' : 'c.txt', 'another initiative merged\n', 'main moved');
  git(['checkout', '-q', `forge/${INIT}`]);
  // The live worktree still holds the residue untracked, plus other forge scratch.
  mkdirSync(join(wt, REJECTED), { recursive: true });
  for (let n = 1; n <= 3; n++) writeFileSync(join(wt, REJECTED, `WI-${n}.md`), `live rejected WI-${n} — repair input\n`);
  writeFileSync(join(wt, '.forge', 'pr-description.md'), 'the PR body\n');
  return { root, wt, git, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function rebase(g: ReturnType<typeof ground>): { error: string | null; events: Array<{ message?: string; metadata?: Record<string, unknown> }> } {
  const logsRoot = join(g.root, '_logs');
  const logger = createLogger('CYCLE-rebase-scratch', logsRoot);
  const input = { initiativeId: INIT, manifestPath: join(g.root, 'm.md'), projectRepoPath: g.wt, worktreePath: g.wt, cycleId: 'CYCLE-rebase-scratch', resumeFrom: 'develop', logsRoot } as CycleInput;
  let error: string | null = null;
  try { rebaseForResume(input, logger); } catch (err) { error = (err as Error).message; }
  const events = readFileSync(logger.logFilePath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { error, events };
}

test('untracked forge scratch at paths a replayed commit adds: the rebase succeeds and the scratch is restored byte-identical', () => {
  const g = ground();
  try {
    const { error, events } = rebase(g);
    assert.equal(error, null);
    assert.ok(events.some((e) => e.message === 'cycle.resume-rebased'), JSON.stringify(events.map((e) => e.metadata?.reason)));
    for (let n = 1; n <= 3; n++) assert.equal(readFileSync(join(g.wt, REJECTED, `WI-${n}.md`), 'utf8'), `live rejected WI-${n} — repair input\n`);
    assert.equal(readFileSync(join(g.wt, '.forge', 'pr-description.md'), 'utf8'), 'the PR body\n');
    assert.ok(existsSync(join(g.wt, 'c.txt')), 'the branch is on the moved main');
    assert.equal(g.git(['status', '--porcelain', '--untracked-files=no']), '', 'no tracked file left dirty');
    assert.equal(existsSync(`${g.wt}.forge-scratch-resume-bak`), false, 'the aside copy is cleaned up');
  } finally {
    g.cleanup();
  }
});

test('a genuine conflict names git\'s own stop line and the file, never the progress output', () => {
  const g = ground({ conflict: true });
  try {
    const { error } = rebase(g);
    assert.match(error ?? '', /CONFLICT[^\n]*a\.txt/);
    assert.doesNotMatch(error ?? '', /Rebasing \(\d+\/\d+\)/);
    for (let n = 1; n <= 3; n++) assert.equal(readFileSync(join(g.wt, REJECTED, `WI-${n}.md`), 'utf8'), `live rejected WI-${n} — repair input\n`, 'scratch restored after a refused rebase too');
  } finally {
    g.cleanup();
  }
});

test('IGNORED forge scratch a replayed commit adds (the live work-item statuses) is restored, never replaced by the commit\'s copy', () => {
  const g = ground({ snapshotWorkItems: true });
  try {
    writeFileSync(join(g.wt, '.git', 'info', 'exclude'), '.forge/work-items/\n');
    mkdirSync(join(g.wt, '.forge', 'work-items'), { recursive: true });
    writeFileSync(join(g.wt, '.forge', 'work-items', 'WI-1.md'), 'status: complete\n');
    const { error } = rebase(g);
    assert.equal(error, null);
    assert.equal(readFileSync(join(g.wt, '.forge', 'work-items', 'WI-1.md'), 'utf8'), 'status: complete\n');
  } finally {
    g.cleanup();
  }
});
