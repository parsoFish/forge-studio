/**
 * forge-8vfn.7.3.6 — the demo builder commits OTHER agents' leftovers under a
 * subject claiming demo machinery.
 *
 * Measured twice, on two funded S1 runs, in the gitweave ground:
 *
 *   d8c6a74  forge-studio: demo machinery (generating)   9 files, 215 insertions
 *   0b96c8e  forge-studio: demo machinery (generating)  10 files, 308 insertions
 *
 * Neither commit contains a demo file. `.forge/demo/` does not exist in the
 * ground afterwards, and the product's own error says so:
 * "the agent turn ended without producing .forge/demo/DEMO.html". What the
 * commits DO contain is the ONBOARDING agent's output — `.forge/project.json`,
 * `.gitignore`, `CLAUDE.md`, `_onboarding/<id>/*`, `brain/profile.md`,
 * `roadmap.md` — left uncommitted in the ground and swept up by
 * `withStudioRepo`'s `finally`, which called `commitStudioChange` with no
 * `paths`, i.e. `git add -A -- .`.
 *
 * So "the demo builder writes nothing" understates it. It writes its
 * INSTRUCTIONS (`.forge/skills/demo-design/SKILL.md`, 104 lines in run 3) and
 * not its DELIVERABLE, then commits everything in the tree under a subject
 * that reads, to anyone inspecting the ground afterwards, as evidence that it
 * worked. T1 ruling 593: the fix must write demo files OR commit nothing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FORGE_ROOT } from '@forge/kernel/ids.ts';

import { logger, setup } from './test-fixtures/demo-builder-runner-fixtures.ts';
import { runDemoBuilderTurn } from '../../kinds/demo-builder.ts';
import { DEMO_HTML_REL_PATH, DEMO_SKILL_REL_PATH } from '../../kinds/demo-session-store.ts';
import { type QueryFn } from '../../interactive-session.ts';

const FOREIGN = 'roadmap.md';
const git = (cwd: string, args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/** A repo carrying ANOTHER agent's uncommitted work — the measured situation:
 *  onboarding runs first and leaves the ground dirty. */
function repoWithForeignWork(repoPath: string): void {
  git(repoPath, ['init', '-q', '-b', 'main']);
  git(repoPath, ['config', 'user.email', 't@example.com']);
  git(repoPath, ['config', 'user.name', 'T']);
  writeFileSync(join(repoPath, 'README.md'), '# ground\n');
  git(repoPath, ['add', '-A']);
  git(repoPath, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'ground']);
  writeFileSync(join(repoPath, FOREIGN), '# roadmap the ONBOARDING agent wrote\n');
}

function queryFn(writes: boolean): QueryFn {
  return ({ options }) => {
    const cwd = (options as { cwd?: string } | undefined)?.cwd ?? '.';
    async function* gen(): AsyncGenerator<unknown> {
      if (writes) {
        execFileSync('mkdir', ['-p', join(cwd, '.forge', 'demo'), join(cwd, '.forge', 'skills', 'demo-design')]);
        writeFileSync(join(cwd, DEMO_SKILL_REL_PATH), '# demo-design (fixture)');
        writeFileSync(join(cwd, DEMO_HTML_REL_PATH), '<!DOCTYPE html><html><body>sample</body></html>');
      }
      yield { type: 'result', total_cost_usd: 0.01 };
    }
    return gen();
  };
}

test('AT-7.3.6-1 (RED) a turn that writes no demo makes NO commit — it never sweeps another agent’s work', async () => {
  const { projectRoot, logsRoot, sessionId, repoPath } = setup();
  repoWithForeignWork(repoPath);
  const before = git(repoPath, ['rev-parse', 'HEAD']);

  await assert.rejects(() => runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT, logsRoot,
    queryFn: queryFn(false), logger: logger(logsRoot, sessionId),
  }));

  assert.equal(
    git(repoPath, ['rev-parse', 'HEAD']), before,
    'no demo was produced, so there must be no commit — a "demo machinery" subject over another agent’s files is worse than silence, because it reads as evidence the builder worked',
  );
  assert.match(git(repoPath, ['status', '--porcelain']), /roadmap\.md/, 'the other agent’s work is still theirs to commit');
});

test('AT-7.3.6-2 a turn that DOES write commits its own demo and still leaves the other agent’s work alone', async () => {
  const { projectRoot, logsRoot, sessionId, repoPath } = setup();
  repoWithForeignWork(repoPath);

  await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT, logsRoot,
    queryFn: queryFn(true), logger: logger(logsRoot, sessionId),
  });

  const files = git(repoPath, ['show', '--stat', '--name-only', '--format=', 'HEAD']);
  assert.match(files, /\.forge\/demo\/DEMO\.html/, 'the deliverable it wrote belongs in its own commit');
  assert.doesNotMatch(files, /roadmap\.md/, 'the ONBOARDING agent’s file must never appear in a demo commit');
  assert.match(git(repoPath, ['status', '--porcelain']), /roadmap\.md/, 'and it stays uncommitted, exactly as the demo builder found it');
});
