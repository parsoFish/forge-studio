import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  runProjectBrainTurn,
  projectBrainSessionDir,
  type ProjectBrainStatus,
} from './project-brain-builder-runner.ts';
import { writeSessionStatus, type QueryFn } from './interactive-session.ts';
import { loadKbDescriptor } from './studio/registry.ts';

function setup(phase: ProjectBrainStatus['phase']): { forgeRoot: string; projectRoot: string; sessionDir: string; sessionId: string } {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'pbrain-'));
  const projectRoot = join(forgeRoot, 'projects', 'demoproj');
  const sessionId = '2026-06-27T10-00-00';
  const sessionDir = projectBrainSessionDir(projectRoot, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
  writeFileSync(join(projectRoot, 'README.md'), '# demoproj\n');
  writeSessionStatus<ProjectBrainStatus>(sessionDir, {
    session_id: sessionId,
    project: 'demoproj',
    project_repo_path: projectRoot,
    phase,
    prompt: 'focus on the build + test conventions',
    updated_at: new Date().toISOString(),
  });
  return { forgeRoot, projectRoot, sessionDir, sessionId };
}

function makeQueryFn(effect?: () => void): QueryFn {
  return () => {
    async function* gen(): AsyncGenerator<unknown> {
      effect?.();
      yield { type: 'result', total_cost_usd: 0 };
    }
    return gen();
  };
}

test('analyzing → awaiting-review when the agent stages themes', async () => {
  const { forgeRoot, sessionDir, sessionId, projectRoot } = setup('analyzing');
  try {
    const staging = join(sessionDir, 'themes');
    const r = await runProjectBrainTurn({
      sessionId,
      projectRoot,
      forgeRoot,
      logsRoot: join(forgeRoot, '_logs'),
      queryFn: makeQueryFn(() => {
        mkdirSync(staging, { recursive: true });
        writeFileSync(join(staging, 'structure.md'), '---\nname: structure\n---\n# Structure\n');
        writeFileSync(join(staging, 'conventions.md'), '---\nname: conventions\n---\n# Conventions\n');
        writeFileSync(join(staging, 'profile.md'), '# demoproj profile\n');
      }),
    });
    assert.equal(r.phase, 'awaiting-review');
    assert.deepEqual(r.themes, ['conventions.md', 'profile.md', 'structure.md']);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('analyzing with no staged themes → throws (retry)', async () => {
  const { forgeRoot, sessionId, projectRoot } = setup('analyzing');
  try {
    await assert.rejects(
      () => runProjectBrainTurn({ sessionId, projectRoot, forgeRoot, logsRoot: join(forgeRoot, '_logs'), queryFn: makeQueryFn() }),
      /produced no theme files/,
    );
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('committing copies staged themes into the central project brain + kb.yaml', async () => {
  const { forgeRoot, sessionDir, sessionId, projectRoot } = setup('committing');
  try {
    const staging = join(sessionDir, 'themes');
    mkdirSync(staging, { recursive: true });
    writeFileSync(join(staging, 'structure.md'), '---\nname: structure\n---\n# Structure\n');
    writeFileSync(join(staging, 'profile.md'), '# demoproj profile\n');

    const r = await runProjectBrainTurn({ sessionId, projectRoot, forgeRoot, logsRoot: join(forgeRoot, '_logs') });
    assert.equal(r.phase, 'committed');
    assert.ok(existsSync(join(forgeRoot, 'brain', 'projects', 'demoproj', 'themes', 'structure.md')), 'theme committed to central brain');
    assert.ok(existsSync(join(forgeRoot, 'brain', 'projects', 'demoproj', 'profile.md')), 'profile committed');
    assert.ok(existsSync(join(forgeRoot, 'brain', 'projects', 'demoproj', 'kb.yaml')), 'kb.yaml scaffolded');
    const committedKb = loadKbDescriptor(join(forgeRoot, 'brain', 'projects', 'demoproj', 'kb.yaml'));
    assert.deepEqual(committedKb.binding, { kind: 'project', ref: 'demoproj' }, 'kb.yaml carries the project binding');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
