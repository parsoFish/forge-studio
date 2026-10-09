/**
 * forge-mfv5.1.13 — approving an AGENTS.md draft commits a conventional commit.
 *
 * Found on gitweave (capstone A, 2026-10-09): the commit was
 * "forge-studio: author AGENTS.md", which the project's own AGENTS.md (conventional
 * commits only) forbids. Approve also leaves an existing CLAUDE.md untouched, as the
 * verdict panel now says.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

import { runInstructionsTurn, instructionsSessionDir, DRAFT_FILENAME, type InstructionsStatus } from '../../kinds/instructions.ts';
import { writeSessionStatus, type QueryFn } from '../../interactive-session.ts';
import { createLogger } from '@forge/kernel';

const noQuery: QueryFn = () => (async function* () { yield { type: 'result', total_cost_usd: 0, structured_output: null }; })();

function g(dir: string, args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
}

test('approving a draft commits AGENTS.md as "docs(agents): author AGENTS.md" and leaves CLAUDE.md untouched', async () => {
  const root = mkdtempSync(join(tmpdir(), 'instr-subject-'));
  try {
    const repoPath = join(root, 'repo');
    mkdirSync(repoPath);
    execFileSync('git', ['init', '-q', '-b', 'main', repoPath]);
    g(repoPath, ['config', 'user.email', 't@forge.dev']);
    g(repoPath, ['config', 'user.name', 'Forge Test']);
    writeFileSync(join(repoPath, 'CLAUDE.md'), '# stale\n');
    g(repoPath, ['add', 'CLAUDE.md']);
    g(repoPath, ['commit', '-q', '-m', 'init']);

    const logsRoot = join(root, '_logs');
    const sessionId = '2026-10-09T05-00-00';
    const sessionDir = instructionsSessionDir(logsRoot, 'demo', sessionId);
    mkdirSync(sessionDir, { recursive: true });
    const status: InstructionsStatus = {
      session_id: sessionId, project: 'demo', project_repo_path: repoPath, phase: 'finalizing',
      round: 1, prompt: '', updated_at: new Date().toISOString(),
    };
    writeSessionStatus(sessionDir, status);
    writeFileSync(join(sessionDir, DRAFT_FILENAME), '# Demo\n\nGate: `pytest -q`.\n');

    const result = await runInstructionsTurn({
      sessionId, project: 'demo', projectRoot: join(root, 'project'), logsRoot, queryFn: noQuery,
      logger: createLogger(`_instructions-${sessionId}`, logsRoot),
      isContainedProjectRepoPath: (c: string) => resolve(c).startsWith(`${root}${sep}`),
    });

    assert.equal(result.phase, 'committed');
    assert.equal(g(repoPath, ['log', '-1', '--pretty=%s', 'forge-studio']), 'docs(agents): author AGENTS.md');
    assert.equal(readFileSync(join(repoPath, 'CLAUDE.md'), 'utf8'), '# stale\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
