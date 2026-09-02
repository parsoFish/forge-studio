/**
 * S3 (1.0.md §3) — `computeContractDrift` is PURE: it reports the skill
 * relocations a reset WOULD make against a real, on-disk project tree, and
 * writes NOTHING. Proven by a recursive before/after filesystem snapshot
 * (every path AND every file's content, not merely "the same file count") —
 * never by trusting the function's own return value, per the task brief.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { computeContractDrift } from '../../reset.ts';
import { projectStartersDir } from '@forge/kernel';
import { FORGE_ROOT } from '@forge/kernel/ids.ts';

function isolatedForgeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'reset-drift-forge-'));
  const startersDest = join(root, 'studio', 'starters', 'projects');
  mkdirSync(startersDest, { recursive: true });
  cpSync(projectStartersDir(FORGE_ROOT), startersDest, { recursive: true });
  return root;
}

/** A real, on-disk project tree shaped like `terraform-provider-betterado`:
 *  two bound skills, one already at the resolver's canonical location, one
 *  drifted under `<artifactRoot>/skills/`, one bound-but-truly-missing
 *  (named in neither location — still drift-report-visible with `from: null`). */
function driftedProjectTree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'reset-drift-project-'));
  mkdirSync(join(dir, '.forge', 'skills', 'already-ok'), { recursive: true });
  writeFileSync(join(dir, '.forge', 'skills', 'already-ok', 'SKILL.md'), '# already-ok\n', 'utf8');
  mkdirSync(join(dir, 'forge', 'skills', 'drifted-one'), { recursive: true });
  writeFileSync(join(dir, 'forge', 'skills', 'drifted-one', 'SKILL.md'), '# drifted-one\n', 'utf8');
  // A supporting file alongside SKILL.md — proves the report/move concerns
  // the whole skill DIRECTORY, not merely the one file (Q1).
  writeFileSync(join(dir, 'forge', 'skills', 'drifted-one', 'helper.sh'), '#!/bin/sh\necho hi\n', 'utf8');
  writeFileSync(
    join(dir, '.forge', 'project.json'),
    `${JSON.stringify(
      {
        name: 'drift-report-fixture',
        artifactRoot: 'forge',
        testProcess: { local: { cmd: ['echo', 'ok'] } },
        skills: ['already-ok', 'drifted-one', 'nowhere-to-be-found'],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return dir;
}

/** Every path (relative to `root`) AND, for files, their content — so
 *  "writes nothing" is proven at the byte level, not just "same file list". */
function snapshotTree(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      const rel = relative(root, abs);
      if (entry.isDirectory()) {
        out.set(`${rel}/`, '<dir>');
        walk(abs);
      } else if (entry.isFile()) {
        out.set(rel, readFileSync(abs, 'utf8'));
      } else {
        out.set(rel, `<other:${statSync(abs).mode}>`);
      }
    }
  };
  walk(root);
  return out;
}

test('computeContractDrift reports the skill relocations it would make, and writes NOTHING to the project tree', () => {
  const forgeRoot = isolatedForgeRoot();
  const projectDir = driftedProjectTree();
  try {
    const before = snapshotTree(projectDir);

    const drift = computeContractDrift(projectDir, { forgeRoot });

    const after = snapshotTree(projectDir);
    assert.deepEqual(after, before, 'computeContractDrift must not create, modify, or delete a single byte of the project tree');

    // The report itself: correct rows, correct relocations, correctly naming
    // an id with no source anywhere.
    const skillsRow = drift.rows.find((r) => r.section === 'skills');
    assert.ok(skillsRow, 'expected a skills row');
    assert.equal(skillsRow!.action, 'regenerate', 'a real drift exists, so the skills row must not read unchanged');

    const byId = new Map(drift.skillMoves.map((m) => [m.id, m]));
    assert.equal(byId.size, 2, `expected 2 skill-move entries (already-ok resolves cleanly and is never listed), got: ${[...byId.keys()].join(', ')}`);
    assert.equal(byId.get('already-ok'), undefined, 'an already-resolved skill must not appear in skillMoves at all');

    const drifted = byId.get('drifted-one');
    assert.ok(drifted, 'drifted-one must be named');
    assert.equal(drifted!.from, 'forge/skills/drifted-one', 'the source path found must be named exactly');
    assert.equal(drifted!.to, '.forge/skills/drifted-one', 'the destination must be the resolver-scanned path');

    const missing = byId.get('nowhere-to-be-found');
    assert.ok(missing, 'a bound id with no source anywhere must still be named, never silently dropped');
    assert.equal(missing!.from, null, 'no source was found for this id — honestly reported as null, not a fabricated guess');
    assert.equal(missing!.to, '.forge/skills/nowhere-to-be-found');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('computeContractDrift on an undrifted project (nothing to move) reports skills unchanged and an empty skillMoves', () => {
  const forgeRoot = isolatedForgeRoot();
  const dir = mkdtempSync(join(tmpdir(), 'reset-drift-clean-'));
  try {
    mkdirSync(join(dir, '.forge', 'skills', 'toc-anchor-rules'), { recursive: true });
    writeFileSync(join(dir, '.forge', 'skills', 'toc-anchor-rules', 'SKILL.md'), '# toc-anchor-rules\n', 'utf8');
    writeFileSync(
      join(dir, '.forge', 'project.json'),
      `${JSON.stringify({ name: 'mdtoc-shaped', testProcess: { local: { cmd: ['npm', 'test'] } }, skills: ['toc-anchor-rules'] }, null, 2)}\n`,
      'utf8',
    );

    const drift = computeContractDrift(dir, { forgeRoot });
    const skillsRow = drift.rows.find((r) => r.section === 'skills');
    assert.equal(skillsRow!.action, 'unchanged');
    assert.deepEqual(drift.skillMoves, []);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});
