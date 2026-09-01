/**
 * Tests for the forge↔project contract preflight (US-4.1 / ADR-017) — the
 * BARREL: C4 (machine-readable architecture context, HARD), the composer
 * (`runPreflight`, exercised end-to-end via the "fully-conformant project"
 * and "ok stays false" cases), `buildVerdictEvent`, and
 * `formatPreflightReport`. Mirrors the production split's preflight.ts
 * (which also keeps BRAIN here, alongside C4, for the cross-package
 * `brain-paths.ts` reason its own header explains — there is no dedicated
 * BRAIN-clause test case in this package; BRAIN is exercised only implicitly
 * via the "fully-conformant" happy-path fixture).
 *
 * Each test builds a throwaway project dir exercising one clause's
 * pass/fail path. C1/C2/C4 are HARD (drive `ok`); C5/C6/C8 are advisory
 * (warn, never flip `ok`).
 *
 * C2 uses git-truth checks (git ls-files + git check-ignore) rather than
 * scanning .gitignore text — already-tracked files bypass .gitignore and
 * must be caught (CON-1).
 *
 * Split out when this file (originally 1,044 lines, 57 cases) grew past the
 * 800-line baseline cap — see scripts/baselines/file-size.json /
 * scripts/check-file-size.mjs. Siblings: preflight-gate.test.ts (C1/C1b/C7),
 * preflight-repo.test.ts (C2/C6), preflight-instructions.test.ts (C5/C8),
 * preflight-demo.test.ts (DEMO family), preflight-release.test.ts (C10),
 * preflight-build.test.ts (BUILD/ARTIFACTS).
 *
 * happyProject()/tmp()/clause() are duplicated into every sibling (house
 * style — see project-create-atomicity.test.ts's own header) rather than
 * exported/imported, so each file's fixtures stay independently readable.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { runPreflight, formatPreflightReport, buildVerdictEvent, type ClauseId } from '../../preflight.ts';

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

test('preflight: a fully-conformant project passes every clause and ok=true', () => {
  const p = happyProject();
  try {
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    assert.equal(r.ok, true);
    for (const id of ['C1', 'C1b', 'C2', 'C4', 'C5', 'C6', 'C7', 'C8', 'C10', 'BUILD', 'BRAIN', 'DEMO', 'DEMO-SKILL', 'ARTIFACTS'] as ClauseId[]) {
      assert.equal(clause(r, id).pass, true, `${id} should pass: ${clause(r, id).detail}`);
    }
    assert.match(formatPreflightReport(r), /CONTRACT MET/);
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
    // Brain 3 is forge-owned + central (ADR 035); remove it to test the hard fail.
    const name = p.dir.split('/').pop()!;
    rmSync(join(p.forgeRoot, 'brain', 'projects', name), { recursive: true, force: true });
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    assert.equal(clause(r, 'C4').pass, false);
    assert.equal(r.ok, false);
    assert.match(clause(r, 'C4').detail, /profile\.md|sub-wiki|brain/);
  } finally {
    p.cleanup();
  }
});

test('buildVerdictEvent: produces correct structure for a passing report', () => {
  const p = happyProject();
  try {
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    const evt = buildVerdictEvent(r);
    assert.equal(evt.event_type, 'preflight.verdict');
    assert.equal(evt.ok, r.ok);
    assert.equal(evt.project_name, r.projectName);
    assert.ok(Array.isArray(evt.failing_clause_ids));
    assert.ok(Array.isArray(evt.warning_clause_ids));
    assert.ok(evt.timestamp.startsWith('20'));
  } finally {
    p.cleanup();
  }
});

test('buildVerdictEvent: failing hard clauses appear in failing_clause_ids', () => {
  const p = happyProject();
  try {
    rmSync(join(p.dir, 'roadmap.md')); // C4 hard fail
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    const evt = buildVerdictEvent(r);
    assert.equal(evt.ok, false);
    assert.ok(evt.failing_clause_ids.includes('C4'));
  } finally {
    p.cleanup();
  }
});

test('preflight: ok stays false if ANY hard clause fails even when advisory ones warn too', () => {
  const p = happyProject();
  try {
    rmSync(join(p.dir, 'roadmap.md')); // C4 hard fail
    rmSync(join(p.dir, 'CLAUDE.md')); // C5 + C8 advisory warn
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    assert.equal(r.ok, false);
    assert.match(formatPreflightReport(r), /CONTRACT NOT MET/);
  } finally {
    p.cleanup();
  }
});

