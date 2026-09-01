/**
 * Tests for the forge↔project contract preflight (US-4.1 / ADR-017) — the
 * "test" clause family: C1 (fast, trustworthy quality gate, HARD), C1b (CI
 * merge-boundary net) and C7 (live-acceptance tier). Mirrors the production
 * split's preflight-gate.ts.
 *
 * Split out of preflight.test.ts (1,044 lines, 57 cases) when that file grew
 * past the 800-line baseline cap — see scripts/baselines/file-size.json /
 * scripts/check-file-size.mjs. Siblings: preflight-repo.test.ts (C2/C6),
 * preflight-instructions.test.ts (C5/C8), preflight-demo.test.ts (DEMO
 * family), preflight-release.test.ts (C10), preflight-build.test.ts
 * (BUILD/ARTIFACTS), preflight.test.ts (the barrel — C4/BRAIN, the composer,
 * buildVerdictEvent, formatPreflightReport). Neither C1b nor C7 has a
 * dedicated case in the pre-split file; their only coverage is the
 * composer-level "fully-conformant" test, which stays in the barrel.
 *
 * happyProject()/tmp()/clause() are duplicated from the pre-split file into
 * every sibling below (house style — see project-create-atomicity.test.ts's
 * own header) rather than exported/imported, so each file's fixtures stay
 * independently readable.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { runPreflight, formatPreflightReport, type ClauseId } from '../../preflight.ts';

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

test('C1 (HARD): no test command ⇒ fail + ok=false', () => {
  const p = happyProject();
  try {
    // Remove every gate source: package.json script AND project.json's
    // testProcess.local.cmd (which now takes precedence over package.json).
    writeFileSync(join(p.dir, 'package.json'), JSON.stringify({ name: 'x' }));
    rmSync(join(p.dir, '.forge', 'project.json'));
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
    // testProcess.local.cmd (project.json) is the primary C1 source now — it
    // takes precedence over package.json, so the chained command must live there.
    writeFileSync(
      join(p.dir, '.forge', 'project.json'),
      JSON.stringify({ testProcess: { local: { cmd: ['bash', '-c', 'lint && vitest run'] } } }),
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
      join(p.dir, '.forge', 'project.json'),
      JSON.stringify({ testProcess: { local: { cmd: ['playwright', 'test'] } } }),
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
    // Remove project.json too — with it present, loadProjectConfig would
    // succeed via its own testProcess.local.cmd and never consult the sidecar.
    rmSync(join(p.dir, '.forge', 'project.json'));
    mkdirSync(join(p.dir, '.forge'), { recursive: true });
    writeFileSync(join(p.dir, '.forge', 'quality_gate_cmd'), 'pytest -q');
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    assert.equal(clause(r, 'C1').pass, true);
    assert.match(clause(r, 'C1').detail, /quality_gate_cmd/);
  } finally {
    p.cleanup();
  }
});

// ── C1 (HARD): package-manager-shaped gates must resolve from the project
// dir itself, no upward walk (w8-a1 regression: a declared `npm test` with no
// package.json in the project dir false-passed, then npm's ancestor-walk ran
// FORGE's own root package.json instead of the project's) ──

/** A minimal C1-only fixture — no happyProject scaffolding, just a dir. */
function bareProjectDir(): { dir: string; cleanup: () => void } {
  const dir = tmp();
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function withProjectJson(dir: string, cmd: string[]): void {
  mkdirSync(join(dir, '.forge'), { recursive: true });
  writeFileSync(join(dir, '.forge', 'project.json'), JSON.stringify({ testProcess: { local: { cmd } } }));
}

test('C1 (HARD) regression: declared `npm test` with NO package.json in the project dir fails, names package.json', () => {
  const p = bareProjectDir();
  try {
    withProjectJson(p.dir, ['npm', 'test']);
    const r = runPreflight(p.dir, { forgeRoot: p.dir });
    const c1 = clause(r, 'C1');
    assert.equal(c1.pass, false, 'npm test with no package.json must NOT silently resolve against an ancestor package.json');
    assert.match(c1.detail, /package\.json/);
  } finally {
    p.cleanup();
  }
});

test('C1 (HARD): `npm test` with a package.json that HAS a "test" script passes', () => {
  const p = bareProjectDir();
  try {
    withProjectJson(p.dir, ['npm', 'test']);
    writeFileSync(join(p.dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'node --test' } }));
    const r = runPreflight(p.dir, { forgeRoot: p.dir });
    assert.equal(clause(r, 'C1').pass, true, clause(r, 'C1').detail);
  } finally {
    p.cleanup();
  }
});

test('C1 (HARD): `npm test` with a package.json that has NO "test" script fails', () => {
  const p = bareProjectDir();
  try {
    withProjectJson(p.dir, ['npm', 'test']);
    writeFileSync(join(p.dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { build: 'tsc' } }));
    const r = runPreflight(p.dir, { forgeRoot: p.dir });
    const c1 = clause(r, 'C1');
    assert.equal(c1.pass, false);
    assert.match(c1.detail, /test/);
  } finally {
    p.cleanup();
  }
});

test('C1 (HARD): `npm run lint:fast` passes when the script exists, fails when it does not', () => {
  const p = bareProjectDir();
  try {
    withProjectJson(p.dir, ['npm', 'run', 'lint:fast']);
    writeFileSync(join(p.dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { 'lint:fast': 'eslint --quiet' } }));
    const r = runPreflight(p.dir, { forgeRoot: p.dir });
    assert.equal(clause(r, 'C1').pass, true, clause(r, 'C1').detail);

    writeFileSync(join(p.dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { build: 'tsc' } }));
    const r2 = runPreflight(p.dir, { forgeRoot: p.dir });
    const c1 = clause(r2, 'C1');
    assert.equal(c1.pass, false);
    assert.match(c1.detail, /lint:fast/);
  } finally {
    p.cleanup();
  }
});

test('C1 (HARD): a malformed package.json with an npm-shaped gate fails closed, detail carries the parse error', () => {
  const p = bareProjectDir();
  try {
    withProjectJson(p.dir, ['npm', 'test']);
    writeFileSync(join(p.dir, 'package.json'), '{ not valid json');
    const r = runPreflight(p.dir, { forgeRoot: p.dir });
    const c1 = clause(r, 'C1');
    assert.equal(c1.pass, false);
    assert.match(c1.detail, /package\.json/);
    assert.match(c1.detail, /JSON|Unexpected|token|position/i);
  } finally {
    p.cleanup();
  }
});

test('C1 (HARD) negative control: `go test ./...` with no package.json still passes (rule is scoped to pm gates)', () => {
  const p = bareProjectDir();
  try {
    withProjectJson(p.dir, ['go', 'test', './...']);
    const r = runPreflight(p.dir, { forgeRoot: p.dir });
    const c1 = clause(r, 'C1');
    assert.equal(c1.pass, true, c1.detail);
  } finally {
    p.cleanup();
  }
});

test('C1 (HARD): chained-command rejection still fires before the package-manager check', () => {
  const p = bareProjectDir();
  try {
    withProjectJson(p.dir, ['bash', '-c', 'npm test && echo done']);
    const r = runPreflight(p.dir, { forgeRoot: p.dir });
    const c1 = clause(r, 'C1');
    assert.equal(c1.pass, false);
    assert.match(c1.detail, /chains multiple commands/);
  } finally {
    p.cleanup();
  }
});

test('C1 (HARD): slow-marker rejection still fires before the package-manager check', () => {
  const p = bareProjectDir();
  try {
    // npm-shaped AND contains a slow marker, no package.json at all — the
    // slow-marker verdict must win, not the package.json-missing verdict.
    withProjectJson(p.dir, ['npm', 'run', 'test:e2e']);
    const r = runPreflight(p.dir, { forgeRoot: p.dir });
    const c1 = clause(r, 'C1');
    assert.equal(c1.pass, false);
    assert.match(c1.detail, /slow|e2e/i);
  } finally {
    p.cleanup();
  }
});

test('C1 (HARD): `yarn <script>` shorthand (not a known yarn subcommand) resolves to that script', () => {
  const p = bareProjectDir();
  try {
    withProjectJson(p.dir, ['yarn', 'unit']);
    writeFileSync(join(p.dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { unit: 'vitest run' } }));
    const r = runPreflight(p.dir, { forgeRoot: p.dir });
    assert.equal(clause(r, 'C1').pass, true, clause(r, 'C1').detail);

    writeFileSync(join(p.dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { build: 'tsc' } }));
    const r2 = runPreflight(p.dir, { forgeRoot: p.dir });
    assert.equal(clause(r2, 'C1').pass, false);
  } finally {
    p.cleanup();
  }
});

test('C1 (HARD): `npx`-shaped gate only requires package.json to exist, no invented script check', () => {
  const p = bareProjectDir();
  try {
    withProjectJson(p.dir, ['npx', 'jest']);
    // package.json exists but has NO scripts at all — npx isn't script-backed,
    // so this must pass on presence alone.
    writeFileSync(join(p.dir, 'package.json'), JSON.stringify({ name: 'x' }));
    const r = runPreflight(p.dir, { forgeRoot: p.dir });
    assert.equal(clause(r, 'C1').pass, true, clause(r, 'C1').detail);

    rmSync(join(p.dir, 'package.json'));
    const r2 = runPreflight(p.dir, { forgeRoot: p.dir });
    assert.equal(clause(r2, 'C1').pass, false, 'npx-shaped still requires package.json to exist in the project dir');
  } finally {
    p.cleanup();
  }
});

