import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyPreflightAutoFixes } from './preflight-fix-auto.ts';
import { runPreflight, type ClauseResult, type ClauseId } from './preflight.ts';

/** A non-git typescript project with a .gitignore that lacks scratch + build globs. */
function setup(): { forgeRoot: string; projectDir: string } {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'pf-auto-'));
  const projectDir = join(forgeRoot, 'projects', 'demoproj');
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, 'package.json'), '{"name":"demoproj"}');
  writeFileSync(join(projectDir, 'tsconfig.json'), '{}');
  writeFileSync(join(projectDir, '.gitignore'), 'node_modules\n');
  return { forgeRoot, projectDir };
}

test('C2 + ARTIFACTS + C4 auto-fixes clear their clauses', () => {
  const { forgeRoot, projectDir } = setup();
  try {
    const before = runPreflight(projectDir, { forgeRoot });
    const result = applyPreflightAutoFixes({ projectDir, forgeRoot, clauses: before.clauses });

    assert.deepEqual(result.applied.map((a) => a.clause).sort(), ['ARTIFACTS', 'C2', 'C4']);
    for (const a of result.applied) assert.equal(a.cleared, true, `${a.clause} must clear on re-run`);

    assert.ok(existsSync(join(projectDir, 'roadmap.md')), 'roadmap.md scaffolded');
    assert.ok(existsSync(join(forgeRoot, 'brain', 'projects', 'demoproj', 'profile.md')), 'central brain profile scaffolded');
    const gi = readFileSync(join(projectDir, '.gitignore'), 'utf8');
    assert.match(gi, /\.forge\/work-items\//, 'scratch path appended');
    assert.match(gi, /\bdist\b/, 'build glob appended');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('idempotent: once cleared, a second pass applies nothing new', () => {
  const { forgeRoot, projectDir } = setup();
  try {
    const before = runPreflight(projectDir, { forgeRoot });
    applyPreflightAutoFixes({ projectDir, forgeRoot, clauses: before.clauses });
    const after = runPreflight(projectDir, { forgeRoot });
    const second = applyPreflightAutoFixes({ projectDir, forgeRoot, clauses: after.clauses });
    assert.deepEqual(second.applied, [], 'cleared clauses no longer fail → nothing to apply');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('re-applying the SAME failing clauses does not duplicate .gitignore lines', () => {
  const { forgeRoot, projectDir } = setup();
  try {
    const before = runPreflight(projectDir, { forgeRoot });
    applyPreflightAutoFixes({ projectDir, forgeRoot, clauses: before.clauses });
    // Re-run with the STALE failing set → fixers run again but find everything present.
    applyPreflightAutoFixes({ projectDir, forgeRoot, clauses: before.clauses });
    const gi = readFileSync(join(projectDir, '.gitignore'), 'utf8');
    const scratchHits = gi.split('\n').filter((l) => l.trim() === '.forge/work-items/').length;
    assert.equal(scratchHits, 1, 'scratch path must appear exactly once');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('ARTIFACTS fix skips a project with an unknown language', () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'pf-auto-unknown-'));
  const projectDir = join(forgeRoot, 'projects', 'mystery');
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, '.gitignore'), 'node_modules\n');
  try {
    const synthetic: ClauseResult = { clause: 'ARTIFACTS' as ClauseId, title: 'x', hard: false, pass: false, detail: '' };
    const result = applyPreflightAutoFixes({ projectDir, forgeRoot, clauses: [synthetic] });
    assert.deepEqual(result.applied, []);
    assert.equal(result.skipped[0].clause, 'ARTIFACTS');
    assert.match(result.skipped[0].reason, /unknown project language/);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
