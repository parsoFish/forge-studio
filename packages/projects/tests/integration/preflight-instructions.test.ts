/**
 * Tests for the forge↔project contract preflight (US-4.1 / ADR-017) — the
 * "instructions" clause family: C5 (locked-core constraints declared,
 * ADVISORY) and C8 (agent-instruction file present + covers the declared
 * gate, ADVISORY, R1-04-F1 coverage). Mirrors the production split's
 * preflight-instructions.ts.
 *
 * Split out of preflight.test.ts (1,044 lines, 57 cases) when that file grew
 * past the 800-line baseline cap — see scripts/baselines/file-size.json /
 * scripts/check-file-size.mjs. Siblings: preflight-gate.test.ts (C1/C1b/C7),
 * preflight-repo.test.ts (C2/C6), preflight-demo.test.ts (DEMO family),
 * preflight-release.test.ts (C10), preflight-build.test.ts (BUILD/ARTIFACTS),
 * preflight.test.ts (the barrel — C4/BRAIN, the composer, buildVerdictEvent,
 * formatPreflightReport).
 *
 * happyProject()/tmp()/clause() are duplicated from the pre-split file into
 * every sibling (house style — see project-create-atomicity.test.ts's own
 * header) rather than exported/imported, so each file's fixtures stay
 * independently readable.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { runPreflight, type ClauseId } from '../../preflight.ts';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'forge-preflight-'));
}

/** A project dir that satisfies every clause. The project's brain is forge-owned
 *  + CENTRAL at <forgeRoot>/brain/projects/<name>/ (ADR 035). */
function happyProject(): { dir: string; forgeRoot: string; cleanup: () => void } {
  const dir = tmp();
  const forgeRoot = tmp();
  const name = dir.split('/').pop()!;
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name, scripts: { test: 'vitest run' } }),
  );
  writeFileSync(
    join(dir, '.gitignore'),
    ['node_modules/', 'dist/', '.forge/', 'AGENT.md', 'PROMPT.md', 'fix_plan.md'].join('\n'),
  );
  writeFileSync(join(dir, 'roadmap.md'), '# Roadmap\n');
  // C8 coverage (R1-04-F1): the instruction file mentions the declared gate command.
  writeFileSync(join(dir, 'CLAUDE.md'), '# Constraints\nUser owns git.\nQuality gate: `vitest run`.\n');
  // Brain 3 (ADR 035): profile lives CENTRAL under the forge root.
  mkdirSync(join(forgeRoot, 'brain', 'projects', name), { recursive: true });
  writeFileSync(join(forgeRoot, 'brain', 'projects', name, 'profile.md'), '# profile\n');
  // DEMO: a declared demoProcess (the project half of the demo contract family).
  mkdirSync(join(dir, '.forge'), { recursive: true });
  writeFileSync(
    join(dir, '.forge', 'project.json'),
    JSON.stringify({
      testProcess: {
        local: { cmd: ['vitest', 'run'] },
        ci: { cmd: ['vitest', 'run'] },
      },
      demoProcess: [
        { kind: 'capture', text: 'Capture before state.' },
        { kind: 'verify', text: 'Run vitest to verify the change.' },
      ],
    }),
  );
  // DEC-4: the generated demo-design skill at the fixed scorecard path.
  mkdirSync(join(dir, '.forge', 'skills', 'demo-design'), { recursive: true });
  writeFileSync(join(dir, '.forge', 'skills', 'demo-design', 'SKILL.md'), '# demo-design\n');
  // A GitHub remote (C6) — set on a real git repo so `git remote get-url` works.
  execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'main']);
  execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', 'https://github.com/acme/x.git']);
  return {
    dir,
    forgeRoot,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
      rmSync(forgeRoot, { recursive: true, force: true });
    },
  };
}

function clause(report: ReturnType<typeof runPreflight>, id: ClauseId) {
  const c = report.clauses.find((x) => x.clause === id);
  assert.ok(c, `clause ${id} present`);
  return c!;
}

test('C5 (ADVISORY): no constraints doc warns but does NOT flip ok', () => {
  const p = happyProject();
  try {
    rmSync(join(p.dir, 'CLAUDE.md'));
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    const c = clause(r, 'C5');
    assert.equal(c.pass, false);
    assert.equal(c.hard, false);
    assert.equal(r.ok, true);
  } finally {
    p.cleanup();
  }
});

test('C8 (ADVISORY): no AGENTS.md or CLAUDE.md warns but does NOT flip ok', () => {
  const p = happyProject();
  try {
    rmSync(join(p.dir, 'CLAUDE.md'));
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    const c = clause(r, 'C8');
    assert.equal(c.pass, false);
    assert.equal(c.hard, false);
    assert.equal(r.ok, true, 'C8 is advisory — must not flip ok');
    assert.match(c.detail, /AGENTS\.md|CLAUDE\.md/);
  } finally {
    p.cleanup();
  }
});

test('C8 (ADVISORY): AGENTS.md at root passes', () => {
  const p = happyProject();
  try {
    rmSync(join(p.dir, 'CLAUDE.md'));
    // Mentions the declared gate (`vitest run`) → C8 coverage passes (R1-04-F1).
    writeFileSync(join(p.dir, 'AGENTS.md'), '# Agents\n\nBuild/test: `vitest run`.\n');
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    assert.equal(clause(r, 'C8').pass, true);
  } finally {
    p.cleanup();
  }
});

test('C8 (ADVISORY): CLAUDE.md at root passes', () => {
  const p = happyProject();
  try {
    // happyProject already has CLAUDE.md.
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    assert.equal(clause(r, 'C8').pass, true);
  } finally {
    p.cleanup();
  }
});

test('C8 coverage (R1-04-F1): file present but omitting the declared gate → advisory fail', () => {
  const p = happyProject();
  try {
    // Overwrite CLAUDE.md so it no longer mentions `vitest run` (the declared gate).
    writeFileSync(join(p.dir, 'CLAUDE.md'), '# Constraints\nUser owns git.\n');
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    const c8 = clause(r, 'C8');
    assert.equal(c8.pass, false, 'present-but-no-gate-mention fails coverage');
    assert.match(c8.detail, /never mentions the declared quality-gate command/);
  } finally {
    p.cleanup();
  }
});

test('C8 coverage (R1-04-F1): a matching head token (npm test) covers a longer declared gate', () => {
  const p = happyProject();
  try {
    // Declared gate = `vitest run`; file mentions it → pass (already covered by happyProject).
    // Now prove the head-token match: declare `npm test --silent`, file says `npm test`.
    writeFileSync(
      join(p.dir, '.forge', 'project.json'),
      JSON.stringify({ testProcess: { local: { cmd: ['npm', 'test', '--silent'] } }, demoProcess: [{ kind: 'capture', text: 'x' }, { kind: 'verify', text: 'y' }] }),
    );
    writeFileSync(join(p.dir, 'CLAUDE.md'), '# Constraints\nRun `npm test` before committing.\n');
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    assert.equal(clause(r, 'C8').pass, true);
  } finally {
    p.cleanup();
  }
});

test('C8 coverage (R1-04-F1): a bare runner prefix does NOT falsely cover an unrelated script', () => {
  const p = happyProject();
  try {
    // Declared gate = `npm run test:unit`; the file only mentions `npm run build`.
    writeFileSync(
      join(p.dir, '.forge', 'project.json'),
      JSON.stringify({ testProcess: { local: { cmd: ['npm', 'run', 'test:unit'] } }, demoProcess: [{ kind: 'capture', text: 'x' }, { kind: 'verify', text: 'y' }] }),
    );
    writeFileSync(join(p.dir, 'CLAUDE.md'), '# Constraints\nBuild with `npm run build`.\n');
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    assert.equal(clause(r, 'C8').pass, false, 'npm run build must not cover a declared npm run test:unit');
    // And the file DOES cover it once it names the real script.
    writeFileSync(join(p.dir, 'CLAUDE.md'), '# Constraints\nGate: `npm run test:unit`.\n');
    const r2 = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    assert.equal(clause(r2, 'C8').pass, true);
  } finally {
    p.cleanup();
  }
});

