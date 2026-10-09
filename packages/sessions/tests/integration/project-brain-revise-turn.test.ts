/**
 * forge-mfv5.1.15 — the runner half of "Revise with notes". The bridge route
 * leaves the operator's notes in feedback.md and the session at `analyzing`;
 * this pins that the next analyzing turn (a) hands those notes to the agent
 * verbatim under a fixed heading with a revise-in-place instruction, (b)
 * consumes feedback.md exactly once, and (c) leaves the session approvable
 * through the ordinary committing path.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  runProjectBrainTurn,
  projectBrainSessionDir,
  type ProjectBrainStatus,
} from '../../kinds/project-brain.ts';
import { writeSessionStatus, type QueryFn } from '../../interactive-session.ts';

const NOTES = 'The build command is `npm run build`, not `make`.\nDrop the "monorepo" claim: this is a single package.';
const HEADING = 'Revision notes from the operator (apply every one):';

function setup(phase: ProjectBrainStatus['phase'], overrides?: Partial<ProjectBrainStatus>) {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'pbrain-revise-turn-'));
  const projectRoot = join(forgeRoot, 'projects', 'demoproj');
  const sessionId = '2026-10-09T12-00-00';
  const logsRoot = join(forgeRoot, '_logs');
  const sessionDir = projectBrainSessionDir(logsRoot, 'demoproj', sessionId);
  mkdirSync(join(sessionDir, 'themes'), { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
  writeFileSync(join(projectRoot, 'README.md'), '# demoproj\n');
  writeSessionStatus<ProjectBrainStatus>(sessionDir, {
    session_id: sessionId, project: 'demoproj', project_repo_path: projectRoot, phase,
    prompt: 'focus on the build + test conventions', updated_at: new Date().toISOString(), ...overrides,
  });
  return { forgeRoot, projectRoot, sessionDir, sessionId, logsRoot };
}

/** A queryFn that records every prompt it is handed and runs `effect` as the "agent". */
function capturingQueryFn(prompts: string[], effect: () => void): QueryFn {
  return ({ prompt }) => {
    prompts.push(String(prompt));
    async function* gen(): AsyncGenerator<unknown> {
      effect();
      yield { type: 'result', total_cost_usd: 0 };
    }
    return gen();
  };
}

test('revise round: the notes reach the agent verbatim under the heading, with a revise-in-place instruction; feedback.md is consumed; approve then commits the revised themes', async () => {
  const { forgeRoot, projectRoot, sessionDir, sessionId, logsRoot } = setup('analyzing', { round: 2 });
  try {
    const themes = join(sessionDir, 'themes');
    // The round-1 draft is already staged, with the factual error the operator is correcting.
    writeFileSync(join(themes, 'structure.md'), '---\nname: structure\n---\nBuild with make.\n');
    writeFileSync(join(sessionDir, 'feedback.md'), NOTES);

    const prompts: string[] = [];
    const r = await runProjectBrainTurn({
      sessionId, project: 'demoproj', projectRoot, forgeRoot, logsRoot,
      queryFn: capturingQueryFn(prompts, () => {
        writeFileSync(join(themes, 'structure.md'), '---\nname: structure\n---\nBuild with npm run build.\n');
      }),
    });

    assert.equal(r.phase, 'awaiting-review');
    assert.equal(prompts.length, 1);
    assert.ok(prompts[0].includes(`${HEADING}\n${NOTES}`), `the notes must follow the heading verbatim, got:\n${prompts[0]}`);
    assert.match(prompts[0], /REVISE the themes already staged in the staging directory in place/);
    assert.match(prompts[0], /do not start from scratch/i);
    assert.equal(existsSync(join(sessionDir, 'feedback.md')), false, 'feedback.md is consumed once the turn resolves');

    // Approve: the ordinary committing path commits what the revised draft staged.
    writeSessionStatus<ProjectBrainStatus>(sessionDir, {
      ...JSON.parse(readFileSync(join(sessionDir, 'status.json'), 'utf8')) as ProjectBrainStatus, phase: 'committing',
    });
    const committed = await runProjectBrainTurn({ sessionId, project: 'demoproj', projectRoot, forgeRoot, logsRoot });
    assert.equal(committed.phase, 'committed');
    assert.match(
      readFileSync(join(forgeRoot, 'brain', 'projects', 'demoproj', 'themes', 'structure.md'), 'utf8'),
      /npm run build/,
      'the committed theme is the revised one',
    );
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('a later analyzing turn without feedback.md carries no revision section (consume-once)', async () => {
  const { forgeRoot, projectRoot, sessionDir, sessionId, logsRoot } = setup('analyzing');
  try {
    const themes = join(sessionDir, 'themes');
    const prompts: string[] = [];
    await runProjectBrainTurn({
      sessionId, project: 'demoproj', projectRoot, forgeRoot, logsRoot,
      queryFn: capturingQueryFn(prompts, () => { writeFileSync(join(themes, 'structure.md'), '# s\n'); }),
    });
    assert.equal(prompts.length, 1);
    assert.ok(!prompts[0].includes(HEADING), 'no heading without operator feedback');
    assert.ok(!/REVISE the themes already staged/.test(prompts[0]), 'no revise-in-place instruction without operator feedback');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('feedback.md is NOT consumed when the turn fails, so the retry still carries the notes', async () => {
  const { forgeRoot, projectRoot, sessionDir, sessionId, logsRoot } = setup('analyzing');
  try {
    writeFileSync(join(sessionDir, 'feedback.md'), NOTES);
    await assert.rejects(
      () => runProjectBrainTurn({
        sessionId, project: 'demoproj', projectRoot, forgeRoot, logsRoot,
        queryFn: capturingQueryFn([], () => { /* the agent stages nothing -> the step throws */ }),
      }),
      /produced no theme files/,
    );
    assert.equal(readFileSync(join(sessionDir, 'feedback.md'), 'utf8'), NOTES);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('a revise round whose agent turn changes no staged theme is rejected by name, keeps feedback.md, and leaves the session at analyzing', async () => {
  const { forgeRoot, projectRoot, sessionDir, sessionId, logsRoot } = setup('analyzing', { round: 2 });
  try {
    const themes = join(sessionDir, 'themes');
    writeFileSync(join(themes, 'structure.md'), '---\nname: structure\n---\nBuild with make.\n');
    writeFileSync(join(sessionDir, 'feedback.md'), NOTES);
    await assert.rejects(
      () => runProjectBrainTurn({
        sessionId, project: 'demoproj', projectRoot, forgeRoot, logsRoot,
        queryFn: capturingQueryFn([], () => { /* the agent edits nothing: round N's themes are still staged */ }),
      }),
      /revise round changed no staged theme — the operator's notes were not applied/,
    );
    assert.equal(readFileSync(join(sessionDir, 'feedback.md'), 'utf8'), NOTES, 'the retry still carries the notes');
    const status = JSON.parse(readFileSync(join(sessionDir, 'status.json'), 'utf8')) as ProjectBrainStatus;
    assert.equal(status.phase, 'analyzing', 'the session is not advanced to review on an unapplied revision');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
