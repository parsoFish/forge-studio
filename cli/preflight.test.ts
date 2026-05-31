/**
 * Tests for the forge↔project contract preflight (US-4.1 / ADR-017).
 *
 * Each test builds a throwaway project dir exercising one clause's
 * pass/fail path. C1/C2/C4 are HARD (drive `ok`); C3/C5/C6 are advisory
 * (warn, never flip `ok`).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { runPreflight, formatPreflightReport, type ClauseId } from './preflight.ts';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'forge-preflight-'));
}

/** A project dir that satisfies every clause. The project's brain is now
 *  inside the project repo itself (Brain 3 / three-brain restructure 2026-05-26). */
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
  writeFileSync(join(dir, 'CLAUDE.md'), '# Constraints\nUser owns git.\n');
  // Brain 3: profile lives inside the project repo at brain/profile.md.
  mkdirSync(join(dir, 'brain'), { recursive: true });
  writeFileSync(join(dir, 'brain', 'profile.md'), '# profile\n');
  // DEMO: a declared demo shape (the project half of the demo contract family).
  mkdirSync(join(dir, '.forge'), { recursive: true });
  writeFileSync(
    join(dir, '.forge', 'project.json'),
    JSON.stringify({ demo: { shape: 'harness', command: ['npm', 'run', 'demo'] }, quality_gate_cmd: ['vitest', 'run'] }),
  );
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

test('preflight: a fully-conformant project passes every clause and ok=true', () => {
  const p = happyProject();
  try {
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    assert.equal(r.ok, true);
    for (const id of ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'DEMO', 'ARTIFACTS'] as ClauseId[]) {
      assert.equal(clause(r, id).pass, true, `${id} should pass: ${clause(r, id).detail}`);
    }
    assert.match(formatPreflightReport(r), /CONTRACT MET/);
  } finally {
    p.cleanup();
  }
});

test('C1 (HARD): no test command ⇒ fail + ok=false', () => {
  const p = happyProject();
  try {
    // Remove the test script.
    writeFileSync(join(p.dir, 'package.json'), JSON.stringify({ name: 'x' }));
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    assert.equal(clause(r, 'C1').pass, false);
    assert.equal(clause(r, 'C1').hard, true);
    assert.equal(r.ok, false);
    assert.match(formatPreflightReport(r), /Failing hard clause\(s\): C1/);
  } finally {
    p.cleanup();
  }
});

test('C1 (HARD): chained test command is rejected (must be ONE command)', () => {
  const p = happyProject();
  try {
    writeFileSync(
      join(p.dir, 'package.json'),
      JSON.stringify({ name: 'x', scripts: { test: 'lint && vitest run' } }),
    );
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    assert.equal(clause(r, 'C1').pass, false);
    assert.match(clause(r, 'C1').detail, /chains multiple commands/);
  } finally {
    p.cleanup();
  }
});

test('C1 (HARD): a primarily-e2e gate is flagged as slow', () => {
  const p = happyProject();
  try {
    writeFileSync(
      join(p.dir, 'package.json'),
      JSON.stringify({ name: 'x', scripts: { test: 'playwright test' } }),
    );
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    assert.equal(clause(r, 'C1').pass, false);
    assert.match(clause(r, 'C1').detail, /slow|playwright/i);
  } finally {
    p.cleanup();
  }
});

test('C1: a .forge/quality_gate_cmd sidecar satisfies the gate without package.json', () => {
  const p = happyProject();
  try {
    rmSync(join(p.dir, 'package.json'));
    mkdirSync(join(p.dir, '.forge'), { recursive: true });
    writeFileSync(join(p.dir, '.forge', 'quality_gate_cmd'), 'pytest -q');
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    assert.equal(clause(r, 'C1').pass, true);
    assert.match(clause(r, 'C1').detail, /quality_gate_cmd/);
  } finally {
    p.cleanup();
  }
});

test('C2 (HARD): .gitignore missing a scratch path ⇒ fail + ok=false, names the path', () => {
  const p = happyProject();
  try {
    writeFileSync(join(p.dir, '.gitignore'), ['node_modules/', '.forge/', 'AGENT.md'].join('\n'));
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    const c = clause(r, 'C2');
    assert.equal(c.pass, false);
    assert.equal(c.hard, true);
    assert.equal(r.ok, false);
    assert.match(c.detail, /PROMPT\.md/);
    assert.match(c.detail, /fix_plan\.md/);
  } finally {
    p.cleanup();
  }
});

test('C2 (HARD): absent .gitignore fails', () => {
  const p = happyProject();
  try {
    rmSync(join(p.dir, '.gitignore'));
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    assert.equal(clause(r, 'C2').pass, false);
    assert.equal(r.ok, false);
  } finally {
    p.cleanup();
  }
});

test('C3 (ADVISORY): an oversized source file warns but does NOT flip ok', () => {
  const p = happyProject();
  try {
    writeFileSync(join(p.dir, 'huge.ts'), 'const x = 1;\n'.repeat(900));
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    const c = clause(r, 'C3');
    assert.equal(c.pass, false);
    assert.equal(c.hard, false);
    assert.equal(r.ok, true, 'C3 is advisory — must not flip ok');
    assert.match(c.detail, /huge\.ts:90[01]/);
    assert.match(formatPreflightReport(r), /advisory warning/);
  } finally {
    p.cleanup();
  }
});

test('C3 (ADVISORY): an extreme god-file (≥2× ceiling) is called out, still non-fatal', () => {
  const p = happyProject();
  try {
    writeFileSync(join(p.dir, 'god.ts'), 'const x = 1;\n'.repeat(1700));
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    assert.equal(clause(r, 'C3').pass, false);
    assert.equal(r.ok, true);
    assert.match(clause(r, 'C3').detail, /god-file class/);
  } finally {
    p.cleanup();
  }
});

test('C4 (HARD): missing roadmap.md ⇒ fail + ok=false', () => {
  const p = happyProject();
  try {
    rmSync(join(p.dir, 'roadmap.md'));
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    assert.equal(clause(r, 'C4').pass, false);
    assert.equal(clause(r, 'C4').hard, true);
    assert.equal(r.ok, false);
    assert.match(clause(r, 'C4').detail, /roadmap\.md/);
  } finally {
    p.cleanup();
  }
});

test('C4 (HARD): missing brain sub-wiki ⇒ fail', () => {
  const p = happyProject();
  try {
    // Brain 3 now lives in the project dir itself; remove it to test the hard fail.
    rmSync(join(p.dir, 'brain'), { recursive: true, force: true });
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    assert.equal(clause(r, 'C4').pass, false);
    assert.equal(r.ok, false);
    assert.match(clause(r, 'C4').detail, /profile\.md|sub-wiki|brain/);
  } finally {
    p.cleanup();
  }
});

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

test('C6 (ADVISORY): no GitHub remote warns but does NOT flip ok; states forge-side-satisfied', () => {
  const dir = tmp();
  const forgeRoot = tmp();
  const name = dir.split('/').pop()!;
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, scripts: { test: 'vitest run' } }));
    writeFileSync(join(dir, '.gitignore'), ['.forge/', 'AGENT.md', 'PROMPT.md', 'fix_plan.md'].join('\n'));
    writeFileSync(join(dir, 'roadmap.md'), '# r\n');
    writeFileSync(join(dir, 'CLAUDE.md'), '# c\n');
    // Brain 3 lives in the project dir (three-brain restructure 2026-05-26).
    mkdirSync(join(dir, 'brain'), { recursive: true });
    writeFileSync(join(dir, 'brain', 'profile.md'), '# p\n');
    // No git repo / no remote at all.
    const r = runPreflight(dir, { forgeRoot });
    const c = clause(r, 'C6');
    assert.equal(c.pass, false);
    assert.equal(c.hard, false);
    assert.equal(r.ok, true, 'C6 is advisory (forge-side-satisfied) — must not flip ok');
    assert.match(c.detail, /forge-side-satisfied/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('DEMO (ADVISORY): no .forge/project.json warns but does NOT flip ok', () => {
  const p = happyProject();
  try {
    rmSync(join(p.dir, '.forge', 'project.json'));
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    const c = clause(r, 'DEMO');
    assert.equal(c.pass, false);
    assert.equal(c.hard, false);
    assert.equal(r.ok, true, 'DEMO is advisory — must not flip ok');
    assert.match(c.detail, /demo shape is undeclared|notes-only/);
  } finally {
    p.cleanup();
  }
});

test('DEMO (ADVISORY): browser shape without preview_command warns', () => {
  const p = happyProject();
  try {
    writeFileSync(
      join(p.dir, '.forge', 'project.json'),
      JSON.stringify({ demo: { shape: 'browser', command: ['npm', 'run', 'demo'] }, quality_gate_cmd: ['vitest', 'run'] }),
    );
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    const c = clause(r, 'DEMO');
    assert.equal(c.pass, false);
    assert.equal(r.ok, true);
    assert.match(c.detail, /preview_command/);
  } finally {
    p.cleanup();
  }
});

test('DEMO (ADVISORY): a non-none shape without a command warns', () => {
  const p = happyProject();
  try {
    writeFileSync(
      join(p.dir, '.forge', 'project.json'),
      JSON.stringify({ demo: { shape: 'cli-diff' }, quality_gate_cmd: ['vitest', 'run'] }),
    );
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    assert.equal(clause(r, 'DEMO').pass, false);
    assert.equal(r.ok, true);
    assert.match(clause(r, 'DEMO').detail, /demo\.command/);
  } finally {
    p.cleanup();
  }
});

test('DEMO (ADVISORY): shape "none" is valid with no command', () => {
  const p = happyProject();
  try {
    writeFileSync(
      join(p.dir, '.forge', 'project.json'),
      JSON.stringify({ demo: { shape: 'none' }, quality_gate_cmd: ['vitest', 'run'] }),
    );
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    assert.equal(clause(r, 'DEMO').pass, true);
  } finally {
    p.cleanup();
  }
});

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

test('preflight: ok stays false if ANY hard clause fails even when advisory ones warn too', () => {
  const p = happyProject();
  try {
    rmSync(join(p.dir, 'roadmap.md')); // C4 hard fail
    rmSync(join(p.dir, 'CLAUDE.md')); // C5 advisory warn
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    assert.equal(r.ok, false);
    assert.match(formatPreflightReport(r), /CONTRACT NOT MET/);
  } finally {
    p.cleanup();
  }
});
