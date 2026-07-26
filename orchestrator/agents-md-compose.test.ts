/**
 * Tests for `composeAgentsMd` (R4-02-F4) — deterministic unattended AGENTS.md
 * authoring from the instruction-seed library.
 *
 * Seeds are read from the REAL forge root (the shipped studio/instruction-seeds
 * library); the project is a temp fixture. The load-bearing assertion is that
 * the composed AGENTS.md makes the R1-04-F1 C8 coverage clause pass (present AND
 * names the declared gate), not merely present.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { composeAgentsMd, buildAgentsMdBody } from './agents-md-compose.ts';
import { runPreflight } from '../cli/preflight.ts';

const FORGE_ROOT = process.cwd();

function fixtureProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agentsmd-'));
  mkdirSync(join(dir, '.forge'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{"name":"demoproj"}');
  writeFileSync(join(dir, 'tsconfig.json'), '{}');
  // Gate declared FIRST (the F4 ordering constraint) — a single command.
  writeFileSync(
    join(dir, '.forge', 'project.json'),
    JSON.stringify({
      name: 'demoproj',
      northStar: 'ship the thing',
      instructions: 'managed by forge',
      demoProcess: [{ kind: 'capture', text: 'x' }, { kind: 'verify', text: 'y' }],
      testProcess: { local: { cmd: ['npm', 'test'] } },
    }),
  );
  return dir;
}

test('composeAgentsMd: writes AGENTS.md that names the declared gate (C8 coverage), with a seed footer', () => {
  const dir = fixtureProject();
  try {
    const out = composeAgentsMd({ projectDir: dir, forgeRoot: FORGE_ROOT });
    assert.equal(out.gateCmd, 'npm test');
    assert.equal(out.gateCovered, true, 'the composed AGENTS.md names the declared gate command');
    assert.ok(out.seedIds.length > 0, 'the forge-managed seed always matches, so ≥1 seed composed');

    const md = readFileSync(out.path, 'utf8');
    assert.match(md, /npm test/);
    assert.match(md, /forge:composed-instruction-seeds:/, 'traceability footer present');

    // The load-bearing outcome: C8 now passes via the COVERAGE path (not presence-only).
    const report = runPreflight(dir, { forgeRoot: FORGE_ROOT });
    const c8 = report.clauses.find((c) => c.clause === 'C8');
    assert.equal(c8?.pass, true, `C8 should pass with a gate-covering AGENTS.md — ${c8?.detail}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildAgentsMdBody: no declared gate → no Quality-gate section, still names seeds', () => {
  const body = buildAgentsMdBody('demoproj', '', [
    { id: 'x-seed', title: 'X', kind: 'practice', appliesTo: ['forge-managed'], scope: 'project', body: 'Do the X.', provenance: 'test', path: 'test.md' },
  ]);
  assert.doesNotMatch(body, /## Quality gate/);
  assert.match(body, /Do the X\./);
  assert.match(body, /forge:composed-instruction-seeds: x-seed/);
});

test('composeAgentsMd: deterministic — identical output on a second run', () => {
  const dir = fixtureProject();
  try {
    const a = readFileSync(composeAgentsMd({ projectDir: dir, forgeRoot: FORGE_ROOT }).path, 'utf8');
    const b = readFileSync(composeAgentsMd({ projectDir: dir, forgeRoot: FORGE_ROOT }).path, 'utf8');
    assert.equal(a, b, 're-composing yields byte-identical AGENTS.md (idempotent)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
