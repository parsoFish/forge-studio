/**
 * Tests for the forge↔project contract preflight (US-4.1 / ADR-017) — BUILD +
 * ARTIFACTS. ARTIFACTS: build outputs must be gitignored (ADVISORY, betterado
 * #4a). BUILD: the project's build process is declared, distinct from the
 * test gate (ADVISORY, R1-04-F3). Mirrors the production split's
 * preflight-build.ts.
 *
 * Split out of preflight.test.ts (1,044 lines, 57 cases) when that file grew
 * past the 800-line baseline cap — see scripts/baselines/file-size.json /
 * scripts/check-file-size.mjs. Siblings: preflight-gate.test.ts (C1/C1b/C7),
 * preflight-repo.test.ts (C2/C6), preflight-instructions.test.ts (C5/C8),
 * preflight-demo.test.ts (DEMO family), preflight-release.test.ts (C10),
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

test('ARTIFACTS (ADVISORY): a Go project whose .gitignore lacks any binary ignore warns', () => {
  const p = happyProject();
  try {
    // Make it a Go project; keep only forge-scratch ignores (no binary/build outputs).
    writeFileSync(join(p.dir, 'go.mod'), 'module example.com/x\n');
    writeFileSync(join(p.dir, '.gitignore'), ['.forge/', 'AGENT.md', 'PROMPT.md', 'fix_plan.md'].join('\n'));
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    const c = clause(r, 'ARTIFACTS');
    assert.equal(c.pass, false);
    assert.equal(c.hard, false);
    assert.equal(r.ok, true, 'ARTIFACTS is advisory — must not flip ok');
    assert.match(c.detail, /build-output|binary|git add -A/i);
  } finally {
    p.cleanup();
  }
});

test('ARTIFACTS (ADVISORY): a Go project that ignores its binary outputs passes', () => {
  const p = happyProject();
  try {
    writeFileSync(join(p.dir, 'go.mod'), 'module example.com/x\n');
    writeFileSync(join(p.dir, '.gitignore'), ['/bin/', '*.test', '.forge/', 'AGENT.md', 'PROMPT.md', 'fix_plan.md'].join('\n'));
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    assert.equal(clause(r, 'ARTIFACTS').pass, true);
  } finally {
    p.cleanup();
  }
});

// --- R1-04-F3: BUILD ---

test('BUILD (R1-04-F3): buildProcess.local declared → pass', () => {
  const p = happyProject();
  try {
    writeFileSync(
      join(p.dir, '.forge', 'project.json'),
      JSON.stringify({
        testProcess: { local: { cmd: ['vitest', 'run'] } },
        demoProcess: [{ kind: 'capture', text: 'x' }, { kind: 'verify', text: 'y' }],
        buildProcess: { local: ['npm', 'run', 'build'] },
      }),
    );
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    const b = clause(r, 'BUILD');
    assert.equal(b.pass, true);
    assert.match(b.detail, /npm run build/);
  } finally {
    p.cleanup();
  }
});

test('BUILD (R1-04-F3): buildProcess.remote pointing at a missing workflow → advisory fail', () => {
  const p = happyProject();
  try {
    writeFileSync(
      join(p.dir, '.forge', 'project.json'),
      JSON.stringify({
        testProcess: { local: { cmd: ['vitest', 'run'] } },
        demoProcess: [{ kind: 'capture', text: 'x' }, { kind: 'verify', text: 'y' }],
        buildProcess: { local: ['npm', 'run', 'build'], remote: '.github/workflows/ci.yml' },
      }),
    );
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    const b = clause(r, 'BUILD');
    assert.equal(b.pass, false);
    assert.match(b.detail, /does not exist/);
  } finally {
    p.cleanup();
  }
});

test('BUILD (R1-04-F3): an inferable but undeclared build → PASS with an opt-in note (not a fail)', () => {
  const p = happyProject();
  try {
    writeFileSync(
      join(p.dir, 'package.json'),
      JSON.stringify({ name: 'x', scripts: { test: 'vitest run', build: 'tsc' } }),
    );
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    const b = clause(r, 'BUILD');
    assert.equal(b.pass, true, 'inferable-but-undeclared is an opt-in note, not a failure');
    assert.match(b.detail, /a build is inferable/);
  } finally {
    p.cleanup();
  }
});

test('BUILD (R1-04-F3): no build inferable and none declared → inert pass', () => {
  const p = happyProject();
  try {
    // happyProject's package.json has only a `test` script → no build inferable.
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    assert.equal(clause(r, 'BUILD').pass, true);
  } finally {
    p.cleanup();
  }
});

