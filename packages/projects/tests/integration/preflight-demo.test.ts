/**
 * Tests for the forge↔project contract preflight (US-4.1 / ADR-017) — the
 * DEMO clause family: DEMO (demoProcess declared), DEMO-SKILL (the generated
 * demo-design machinery exists, DEC-4), DEMO-ALIGN (demo builds off the
 * declared test process, R1-03-F3). All ADVISORY. Mirrors the production
 * split's preflight-demo.ts.
 *
 * Split out of preflight.test.ts (1,044 lines, 57 cases) when that file grew
 * past the 800-line baseline cap — see scripts/baselines/file-size.json /
 * scripts/check-file-size.mjs. Siblings: preflight-gate.test.ts (C1/C1b/C7),
 * preflight-repo.test.ts (C2/C6), preflight-instructions.test.ts (C5/C8),
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

test('DEMO (ADVISORY): no .forge/project.json warns but does NOT flip ok', () => {
  const p = happyProject();
  try {
    rmSync(join(p.dir, '.forge', 'project.json'));
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    const c = clause(r, 'DEMO');
    assert.equal(c.pass, false);
    assert.equal(c.hard, false);
    assert.equal(r.ok, true, 'DEMO is advisory — must not flip ok');
    assert.match(c.detail, /demoProcess undeclared/);
  } finally {
    p.cleanup();
  }
});

test('DEMO (ADVISORY): demoProcess with only verify step (no capture) warns', () => {
  const p = happyProject();
  try {
    writeFileSync(
      join(p.dir, '.forge', 'project.json'),
      JSON.stringify({
        testProcess: { local: { cmd: ['vitest', 'run'] } },
        demoProcess: [{ kind: 'verify', text: 'Run vitest' }],
      }),
    );
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    const c = clause(r, 'DEMO');
    assert.equal(c.pass, false);
    assert.equal(r.ok, true);
    assert.match(c.detail, /capture step/);
  } finally {
    p.cleanup();
  }
});

test('DEMO (ADVISORY): demoProcess with only capture step (no verify) warns', () => {
  const p = happyProject();
  try {
    writeFileSync(
      join(p.dir, '.forge', 'project.json'),
      JSON.stringify({
        testProcess: { local: { cmd: ['vitest', 'run'] } },
        demoProcess: [{ kind: 'capture', text: 'Screenshot' }],
      }),
    );
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    const c = clause(r, 'DEMO');
    assert.equal(c.pass, false);
    assert.equal(r.ok, true);
    assert.match(c.detail, /verify step/);
  } finally {
    p.cleanup();
  }
});

test('DEMO (ADVISORY): empty demoProcess warns', () => {
  const p = happyProject();
  try {
    writeFileSync(
      join(p.dir, '.forge', 'project.json'),
      JSON.stringify({ testProcess: { local: { cmd: ['vitest', 'run'] } } }),
    );
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    const c = clause(r, 'DEMO');
    assert.equal(c.pass, false);
    assert.equal(r.ok, true, 'DEMO is advisory — must not flip ok');
    assert.match(c.detail, /capture step/);
  } finally {
    p.cleanup();
  }
});

test('DEMO (ADVISORY): demoProcess with capture + verify passes', () => {
  const p = happyProject();
  try {
    writeFileSync(
      join(p.dir, '.forge', 'project.json'),
      JSON.stringify({
        testProcess: { local: { cmd: ['vitest', 'run'] } },
        demoProcess: [
          { kind: 'capture', text: 'Scrape harness metrics' },
          { kind: 'verify', text: 'Project tests green' },
        ],
      }),
    );
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    assert.equal(clause(r, 'DEMO').pass, true);
  } finally {
    p.cleanup();
  }
});

test('DEMO-SKILL (ADVISORY): demoProcess declared but no .forge/skills/demo-design/SKILL.md warns, ok stays true', () => {
  const p = happyProject();
  try {
    // happyProject ships the skill — remove it to simulate a project that was
    // never run through the demo-design generator.
    rmSync(join(p.dir, '.forge', 'skills', 'demo-design'), { recursive: true, force: true });
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    const c = clause(r, 'DEMO-SKILL');
    assert.equal(c.pass, false);
    assert.equal(c.hard, false);
    assert.equal(r.ok, true, 'advisory DEMO-SKILL must not flip ok');
    assert.match(c.detail, /demo-design/);
    assert.match(c.detail, /run the demo-design generator/);
  } finally {
    p.cleanup();
  }
});

test('DEMO-SKILL (ADVISORY): present skill passes', () => {
  const p = happyProject();
  try {
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    assert.equal(clause(r, 'DEMO-SKILL').pass, true);
  } finally {
    p.cleanup();
  }
});

test('DEMO-SKILL (N/A): no demoProcess → not applicable, passes (no double-warn with DEMO)', () => {
  const p = happyProject();
  try {
    rmSync(join(p.dir, '.forge', 'skills', 'demo-design'), { recursive: true, force: true });
    writeFileSync(
      join(p.dir, '.forge', 'project.json'),
      JSON.stringify({ testProcess: { local: { cmd: ['vitest', 'run'] } } }),
    );
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    assert.equal(clause(r, 'DEMO-SKILL').pass, true);
  } finally {
    p.cleanup();
  }
});

// ── DEMO-ALIGN (R1-03-F3): demo-builds-off-testing alignment, always advisory ──

test('DEMO-ALIGN: capture referencing a test-process token (or test-evidence element) is aligned', () => {
  const { dir, forgeRoot, cleanup } = happyProject();
  try {
    writeFileSync(join(dir, '.forge', 'project.json'), JSON.stringify({
      testProcess: { local: { cmd: ['npm', 'test'] }, acceptance: { match: 'acceptance', required: false } },
      demoProcess: [
        { kind: 'capture', text: 'Capture the acceptance run output.' },
        { kind: 'capture', text: 'Anything at all', element: 'test-evidence' },
        { kind: 'verify', text: 'Assert the output.' },
      ],
    }));
    const r = runPreflight(dir, { forgeRoot });
    const al = r.clauses.find((c) => c.clause === 'DEMO-ALIGN');
    assert.ok(al && !al.hard, 'DEMO-ALIGN present and advisory');
    assert.equal(al.pass, true, al.detail);
  } finally {
    cleanup();
  }
});

test('DEMO-ALIGN: a divergent capture flags advisory — ok stays true (live evidence is legitimate)', () => {
  const { dir, forgeRoot, cleanup } = happyProject();
  try {
    writeFileSync(join(dir, '.forge', 'project.json'), JSON.stringify({
      testProcess: { local: { cmd: ['npm', 'test'] } },
      demoProcess: [
        { kind: 'capture', text: 'Screenshot of the live resource in the portal.', element: 'screenshot' },
        { kind: 'verify', text: 'Assert the screenshot shows the resource.' },
      ],
    }));
    const r = runPreflight(dir, { forgeRoot });
    const al = r.clauses.find((c) => c.clause === 'DEMO-ALIGN');
    assert.ok(al);
    assert.equal(al.pass, false);
    assert.match(al.detail, /divergence may be intentional/);
    assert.equal(r.clauses.filter((c) => c.hard).every((c) => c.pass), r.ok);
    assert.equal(r.ok, true, 'advisory divergence never fails the preflight');
  } finally {
    cleanup();
  }
});

test('DEMO-ALIGN: no capture steps (or no config) → not applicable, pass', () => {
  const { dir, forgeRoot, cleanup } = happyProject();
  try {
    writeFileSync(join(dir, '.forge', 'project.json'), JSON.stringify({
      testProcess: { local: { cmd: ['npm', 'test'] } },
    }));
    const r = runPreflight(dir, { forgeRoot });
    const al = r.clauses.find((c) => c.clause === 'DEMO-ALIGN');
    assert.ok(al);
    assert.equal(al.pass, true);
    assert.match(al.detail, /not applicable/);
  } finally {
    cleanup();
  }
});

