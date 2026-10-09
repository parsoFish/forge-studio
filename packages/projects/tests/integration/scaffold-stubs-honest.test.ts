/**
 * forge-mfv5.1.11 — a scaffolded stub reports as a stub, never as done.
 *
 * Found on gitweave (capstone A, 2026-10-09): after onboarding, preflight passed C4
 * with "central brain sub-wiki present" while every section of the central
 * profile.md was still TODO. The onboarding session showed "Demo — present" for
 * the two scaffold placeholder steps, and "Instructions — present" for a CLAUDE.md
 * that names npm test in a Python repo.
 *
 * Ruling T1 1977a: C4 stays a presence check. The BRAIN advisory clause WARNs on an
 * all-TODO central profile. The Demo and Instructions tiles read `stub`: Demo while
 * demoProcess is exactly the onboarding placeholder and no demo is locked;
 * Instructions while the file does not name the declared gate.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runPreflight } from '../../preflight.ts';
import { deriveContractStages, SCAFFOLD_DEMO_PROCESS } from '../../contract-stages.ts';

const SEED_PROFILE = `# weave — project brain (Brain 3 profile)

> This is a scaffold stub written at project-creation time.

## What this project is

TODO — one paragraph: what does this project build.

## Architecture

TODO — module map / pipeline shape.

## Conventions

TODO — load-bearing conventions.

## Constraint blocks (D-17)

\`profile.md\` can carry a machine-readable clause. Example:

    &lt;!-- forge:constraint id: example-constraint applies_to: all --&gt;
`;

const FILLED_PROFILE = SEED_PROFILE
  .replace('TODO — one paragraph: what does this project build.', 'GitWeave renders git history for org admins.')
  .replace('TODO — module map / pipeline shape.', '`gw/` CLI, `gw/apply` engine, `tests/` pytest.')
  .replace('TODO — load-bearing conventions.', 'Conventional commits; pytest is the gate.');

function fixture(profile: string, cfg: Record<string, unknown>, instructions?: string): { forgeRoot: string; projectsRoot: string; dir: string } {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'stubs-honest-'));
  const projectsRoot = join(forgeRoot, 'projects');
  const dir = join(projectsRoot, 'weave');
  mkdirSync(join(dir, '.forge'), { recursive: true });
  writeFileSync(join(dir, '.forge', 'project.json'), JSON.stringify({ name: 'weave', testProcess: { local: { cmd: ['pytest', '-q'] } }, ...cfg }));
  writeFileSync(join(dir, 'roadmap.md'), '# weave\n');
  if (instructions !== undefined) writeFileSync(join(dir, 'CLAUDE.md'), instructions);
  mkdirSync(join(forgeRoot, 'brain', 'projects', 'weave'), { recursive: true });
  writeFileSync(join(forgeRoot, 'brain', 'projects', 'weave', 'profile.md'), profile);
  return { forgeRoot, projectsRoot, dir };
}

function clause(dir: string, forgeRoot: string, id: string) {
  return runPreflight(dir, { forgeRoot }).clauses.find((c) => c.clause === id)!;
}

function row(f: { forgeRoot: string; projectsRoot: string }, stage: string) {
  const r = deriveContractStages({ forgeRoot: f.forgeRoot, projectsRoot: f.projectsRoot, projectId: 'weave' });
  assert.ok(r.ok);
  return r.rows.find((x) => x.stage === stage)!;
}

test('an all-TODO central profile: C4 still passes (presence) and BRAIN warns, naming the file', () => {
  const f = fixture(SEED_PROFILE, {});
  try {
    assert.equal(clause(f.dir, f.forgeRoot, 'C4').pass, true);
    const brain = clause(f.dir, f.forgeRoot, 'BRAIN');
    assert.equal(brain.pass, false);
    assert.equal(brain.hard, false);
    assert.match(brain.detail, /brain\/projects\/weave\/profile\.md/);
    assert.match(brain.detail, /TODO/);
  } finally {
    rmSync(f.forgeRoot, { recursive: true, force: true });
  }
});

test('a filled central profile does not warn', () => {
  const f = fixture(FILLED_PROFILE, {});
  try {
    assert.equal(clause(f.dir, f.forgeRoot, 'BRAIN').pass, true);
  } finally {
    rmSync(f.forgeRoot, { recursive: true, force: true });
  }
});

test('the Demo tile reads stub for the onboarding placeholder steps, present for a real declaration', () => {
  const stub = fixture(FILLED_PROFILE, { demoProcess: SCAFFOLD_DEMO_PROCESS });
  const real = fixture(FILLED_PROFILE, { demoProcess: [{ kind: 'capture', text: 'Run gw log --since 1w against the fixture repo.' }] });
  try {
    assert.equal(row(stub, 'demo').status, 'stub');
    assert.equal(row(real, 'demo').status, 'present');
  } finally {
    rmSync(stub.forgeRoot, { recursive: true, force: true });
    rmSync(real.forgeRoot, { recursive: true, force: true });
  }
});

test('the Instructions tile reads stub when the file does not name the declared gate, present when it does', () => {
  const stale = fixture(FILLED_PROFILE, {}, '# Rules\n\nRun npm test before every commit.\n');
  const named = fixture(FILLED_PROFILE, {}, '# Rules\n\nThe gate is `pytest -q`.\n');
  try {
    assert.equal(row(stale, 'instructions').status, 'stub');
    assert.equal(row(named, 'instructions').status, 'present');
  } finally {
    rmSync(stale.forgeRoot, { recursive: true, force: true });
    rmSync(named.forgeRoot, { recursive: true, force: true });
  }
});

test('a profile whose sections are empty or bulleted TODOs still reads as unfilled', () => {
  const f = fixture('# weave\n\n## What this project is\n\n## Architecture\n\n- TODO: module map\n\n## Conventions\n\n_TODO_\n', {});
  try {
    assert.equal(clause(f.dir, f.forgeRoot, 'BRAIN').pass, false);
  } finally {
    rmSync(f.forgeRoot, { recursive: true, force: true });
  }
});
