/**
 * forge-npp3 — preflight-fix committed other agents' leftovers under
 * `forge-studio: preflight-fix <clause>`.
 *
 * Measured on S1 run 4 in the gitweave ground:
 *
 *   c911c93  forge-studio: preflight-fix C1b      10 files, 225 insertions
 *     .forge/contract-compliance-report.json · .forge/project.json · .gitignore
 *     CLAUDE.md · CONSTRAINTS.md · _onboarding/<id>/* · brain/profile.md · roadmap.md
 *
 * Not one of those is a C1b fix. Every one is the ONBOARDING agent's output,
 * left uncommitted in the ground and swept up by a `commitStudioChange` call
 * with no `paths` — `git add -A`.
 *
 * THE "ITS TERRITORY IS THE WHOLE REPO" CLAIM IS REFUTED BY THE PRODUCT'S OWN
 * INSTRUCTIONS, which is why this is the same defect as 7.3.6 and not a
 * legitimate difference. The agent is told three times to touch only its fix:
 *   kinds/preflight-fix.ts:36  "Apply ONLY the minimal edit that clears this
 *                               clause … Touch nothing else, then stop."
 *   skills/preflight-fix/SKILL.md:35  "smallest edit that satisfies the clause
 *                               — nothing else."
 *   skills/preflight-fix/SKILL.md:47  "Touch only the file(s) the fix requires."
 * The instruction says "touch nothing else"; the commit said "take everything".
 *
 * The fix commits the DELTA: what is dirty after the turn, minus what was
 * already dirty before it. A turn cannot claim work it did not do, and it
 * cannot be blamed for work it found.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runPreflightFixTurn, type QueryFn } from '../../kinds/preflight-fix.ts';

const FOREIGN = 'roadmap.md';
const git = (cwd: string, args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function setup(): { forgeRoot: string; projectDir: string; logsRoot: string } {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'pf-scope-'));
  const projectDir = join(forgeRoot, 'projects', 'demoproj');
  mkdirSync(projectDir, { recursive: true });
  git(projectDir, ['init', '-q', '-b', 'main']);
  git(projectDir, ['config', 'user.email', 't@example.com']);
  git(projectDir, ['config', 'user.name', 'T']);
  writeFileSync(join(projectDir, 'README.md'), '# ground\n');
  git(projectDir, ['add', '-A']);
  git(projectDir, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'ground']);
  // ANOTHER agent's uncommitted work — the measured situation: onboarding runs
  // first and leaves the ground dirty.
  writeFileSync(join(projectDir, FOREIGN), '# roadmap the ONBOARDING agent wrote\n');
  return { forgeRoot, projectDir, logsRoot: join(forgeRoot, '_logs') };
}

const queryFn = (effect?: () => void): QueryFn => () => {
  async function* gen(): AsyncGenerator<unknown> {
    effect?.();
    yield { type: 'result', total_cost_usd: 0 };
  }
  return gen();
};

test('AT-npp3-1 (RED) the fix commit carries the agent’s own edit and NOT another agent’s file', async () => {
  const { forgeRoot, projectDir, logsRoot } = setup();
  try {
    await runPreflightFixTurn({
      runId: 'scope-1', projectDir, clause: 'C5', instruction: 'no test tampering', forgeRoot, logsRoot,
      queryFn: queryFn(() => writeFileSync(join(projectDir, 'CONSTRAINTS.md'), '# Constraints\n')),
    });
    const files = git(projectDir, ['show', '--stat', '--name-only', '--format=', 'HEAD']);
    assert.match(files, /CONSTRAINTS\.md/, 'the edit this turn made belongs in its own commit');
    assert.doesNotMatch(files, /roadmap\.md/, 'the ONBOARDING agent’s file must never appear in a preflight-fix commit');
    assert.match(git(projectDir, ['status', '--porcelain']), /roadmap\.md/, 'and it stays uncommitted, exactly as this turn found it');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('AT-npp3-2 (RED) a turn that edits nothing makes NO commit — it never sweeps what it found', async () => {
  const { forgeRoot, projectDir, logsRoot } = setup();
  try {
    const before = git(projectDir, ['rev-parse', 'HEAD']);
    await runPreflightFixTurn({
      runId: 'scope-2', projectDir, clause: 'C5', instruction: '', forgeRoot, logsRoot,
      queryFn: queryFn(),
    });
    assert.equal(git(projectDir, ['rev-parse', 'HEAD']), before,
      'nothing was written, so there must be no commit — a "preflight-fix" subject over another agent’s files reads as evidence this turn did something');
    assert.match(git(projectDir, ['status', '--porcelain']), /roadmap\.md/);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
