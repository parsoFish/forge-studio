import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runProjectBrainTurn, projectBrainSessionDir, type ProjectBrainStatus } from '../../kinds/project-brain.ts';
import { writeSessionStatus } from '../../interactive-session.ts';
import { runBrainLint } from '@forge/knowledge';

/** The two checks the bead names, run for real over the committed brain. */
function indexFindings(forgeRoot: string, check: 'checkOrphans' | 'checkProjectBrainIndexes'): string[] {
  return runBrainLint({ cwd: forgeRoot, scope: 'full' })
    .findings.filter((f) => f.check === check)
    .map((f) => `${f.file}: ${f.message}`);
}

// Bead forge-mfv5.1.18 — the commit step copied themes into
// brain/projects/<project>/themes/ and wrote NO category index, so every
// committed theme was an orphan and checkProjectBrainIndexes flagged the
// whole brain. These tests run the REAL lint checks over a committed brain.

const SESSION = '2026-10-09T10-00-00';

function theme(category: string, description: string): string {
  return `---\ntitle: ${description}\ndescription: ${description}\ncategory: ${category}\ncreated_at: 2026-10-09T05:00:00Z\nupdated_at: 2026-10-09T05:00:00Z\n---\n\n# body\n`;
}

function stage(forgeRoot: string, files: Record<string, string>): void {
  const logsRoot = join(forgeRoot, '_logs');
  const sessionDir = projectBrainSessionDir(logsRoot, 'demoproj', SESSION);
  mkdirSync(join(sessionDir, 'themes'), { recursive: true });
  writeSessionStatus<ProjectBrainStatus>(sessionDir, {
    session_id: SESSION,
    project: 'demoproj',
    project_repo_path: join(forgeRoot, 'projects', 'demoproj'),
    phase: 'committing',
    prompt: '',
    updated_at: new Date().toISOString(),
  });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(sessionDir, 'themes', name), body);
}

function commit(forgeRoot: string): Promise<unknown> {
  return runProjectBrainTurn({
    sessionId: SESSION,
    project: 'demoproj',
    projectRoot: join(forgeRoot, 'projects', 'demoproj'),
    forgeRoot,
    logsRoot: join(forgeRoot, '_logs'),
  });
}

const STAGED = {
  'structure.md': theme('reference', 'Repository layout'),
  'key-patterns.md': theme('pattern', 'The apply pipeline'),
  'sharp-edges.md': theme('antipattern', 'Red tests to delete'),
  'build-and-test.md': theme('operation', 'Exact gate commands'),
  'profile.md': '# demoproj profile\n',
};

test('committed themes are indexed: zero orphans, zero project-index findings', async () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'pbrain-idx-'));
  try {
    stage(forgeRoot, STAGED);
    await commit(forgeRoot);
    const brain = join(forgeRoot, 'brain', 'projects', 'demoproj');
    assert.deepEqual(indexFindings(forgeRoot, 'checkProjectBrainIndexes'), []);
    assert.deepEqual(indexFindings(forgeRoot, 'checkOrphans'), []);
    for (const idx of ['patterns.md', 'antipatterns.md', 'operations.md', 'reference.md']) {
      assert.ok(existsSync(join(brain, idx)), `category index ${idx} written`);
    }
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('re-committing is idempotent: no duplicate links, still zero findings', async () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'pbrain-idx-'));
  try {
    stage(forgeRoot, STAGED);
    await commit(forgeRoot);
    const patterns = join(forgeRoot, 'brain', 'projects', 'demoproj', 'patterns.md');
    const first = readFileSync(patterns, 'utf8');
    await commit(forgeRoot);
    const second = readFileSync(patterns, 'utf8');
    assert.equal(second, first, 'second commit leaves the index byte-identical');
    assert.equal(second.split('themes/key-patterns.md').length - 1, 1, 'exactly one link to the theme');
    assert.deepEqual(indexFindings(forgeRoot, 'checkProjectBrainIndexes'), []);
    assert.deepEqual(indexFindings(forgeRoot, 'checkOrphans'), []);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('a curated index is preserved: only the missing theme is added', async () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'pbrain-idx-'));
  try {
    stage(forgeRoot, STAGED);
    const brain = join(forgeRoot, 'brain', 'projects', 'demoproj');
    mkdirSync(brain, { recursive: true });
    writeFileSync(join(brain, 'patterns.md'), '# Curated\n\n## Mine\n\nhand-written line\n');
    await commit(forgeRoot);
    const body = readFileSync(join(brain, 'patterns.md'), 'utf8');
    assert.match(body, /hand-written line/);
    assert.match(body, /themes\/key-patterns\.md/);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
