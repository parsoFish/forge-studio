/**
 * Tests for `authorConstraintBlocks` (R4-02-F5) — the onboarding-side authoring
 * of live forge:constraint blocks into central profile.md.
 *
 * The AC's two halves: (1) an onboarded profile carries tagged clauses that
 * `loadProjectConstraintBlocks` returns; (2) an untagged/no-source profile still
 * compiles (no throw). Plus idempotency + the loud-parse guarantee.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { authorConstraintBlocks, extractConstraintsSource } from './constraint-author.ts';
import { projectBrainDir } from './brain-paths.ts';
import { loadProjectConstraintBlocks } from './constraint-blocks.ts';

const PROJECT = 'demoproj';

/** A temp forge root with a seeded (inert) central profile.md + a project dir. */
function fixture(): { forgeRoot: string; projectDir: string } {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'cauthor-'));
  const brainDir = projectBrainDir(forgeRoot, PROJECT);
  mkdirSync(brainDir, { recursive: true });
  writeFileSync(join(brainDir, 'profile.md'), `# ${PROJECT} — profile\n\n## Conventions\n\nTODO.\n`);
  const projectDir = join(forgeRoot, 'projects', PROJECT);
  mkdirSync(projectDir, { recursive: true });
  return { forgeRoot, projectDir };
}

test('authorConstraintBlocks: a CONSTRAINTS.md becomes a live applies_to:all block loadProjectConstraintBlocks returns', () => {
  const { forgeRoot, projectDir } = fixture();
  try {
    writeFileSync(join(projectDir, 'CONSTRAINTS.md'), '- Never edit tests to make them pass.\n- Immutability: return new objects.');
    const out = authorConstraintBlocks({ projectDir, forgeRoot, project: PROJECT });
    assert.deepEqual(out.authored, [`${PROJECT}-locked-core`]);
    assert.equal(out.source, 'CONSTRAINTS.md');

    const blocks = loadProjectConstraintBlocks(forgeRoot, PROJECT);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].id, `${PROJECT}-locked-core`);
    assert.equal(blocks[0].selector.kind, 'all');
    assert.match(blocks[0].content, /Never edit tests/);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('authorConstraintBlocks: no constraints source → no-op, untagged profile still compiles', () => {
  const { forgeRoot, projectDir } = fixture();
  try {
    const out = authorConstraintBlocks({ projectDir, forgeRoot, project: PROJECT });
    assert.deepEqual(out.authored, []);
    assert.equal(out.source, null);
    assert.equal(loadProjectConstraintBlocks(forgeRoot, PROJECT).length, 0);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('authorConstraintBlocks: idempotent — a second run does not duplicate the block', () => {
  const { forgeRoot, projectDir } = fixture();
  try {
    writeFileSync(join(projectDir, 'CONSTRAINTS.md'), '- One durable rule.');
    authorConstraintBlocks({ projectDir, forgeRoot, project: PROJECT });
    authorConstraintBlocks({ projectDir, forgeRoot, project: PROJECT });
    assert.equal(loadProjectConstraintBlocks(forgeRoot, PROJECT).length, 1, 're-authoring replaces, not accretes');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('extractConstraintsSource: a Locked-core section of CLAUDE.md is picked up', () => {
  const { projectDir } = fixture();
  try {
    writeFileSync(join(projectDir, 'CLAUDE.md'), '# Proj\n\n## Setup\n\nrun it\n\n## Locked-core\n\n- No force-push.\n\n## Other\n\nx');
    const src = extractConstraintsSource(projectDir);
    assert.ok(src);
    assert.match(src.source, /CLAUDE\.md/);
    assert.match(src.text, /No force-push/);
    assert.doesNotMatch(src.text, /run it|Other/, 'only the Locked-core section, bounded by the next heading');
  } finally {
    rmSync(join(projectDir, '..', '..'), { recursive: true, force: true });
  }
});
