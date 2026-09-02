/**
 * Tests for the forge↔project contract preflight (US-4.1 / ADR-017) — the
 * SKILLS clause (forge-8vfn.5.13): a declared `skills[]` id must resolve to
 * a real `SKILL.md`, project-local or forge-wide, or the clause fails HARD.
 * Mirrors the production split's preflight-skills.ts.
 *
 * THE DECLARED-DATA-FAILS-OPEN CLASS this closes: before this clause
 * existed, a project whose declared skills ALL failed to resolve still read
 * `ok: true` (health=healthy, preflight-status=ok, flow-ready=true
 * downstream) — the per-chip `data-resolved="missing"` fact
 * (`SkillsBind.tsx`) never fed into anything a gate reads.
 * `apps/studio/components/studio/project-builder/ContractReadiness.tsx`'s
 * `data-preflight-status`/`data-flow-ready` are ALREADY derived from
 * `report.clauses` — `hard: true` here is the one change that reaches them,
 * with no apps/studio edit and no second stored flag.
 *
 * happyProject()/tmp()/clause() are duplicated from the pre-split file into
 * every sibling (house style — see project-create-atomicity.test.ts's own
 * header) rather than exported/imported, so each file's fixtures stay
 * independently readable.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { runPreflight, type ClauseId } from '../../preflight.ts';
import { checkSkills } from '../../preflight-skills.ts';
import { loadProjectConfig } from '../../project-config.ts';

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

/** Merge `skills` into an already-written `.forge/project.json` (house
 *  pattern: happyProject() writes the base config, tests layer a field). */
function declareSkills(dir: string, skills: string[]): void {
  const cfgPath = join(dir, '.forge', 'project.json');
  const raw = JSON.parse(readFileSync(cfgPath, 'utf8')) as Record<string, unknown>;
  raw.skills = skills;
  writeFileSync(cfgPath, JSON.stringify(raw));
}

function clause(report: ReturnType<typeof runPreflight>, id: ClauseId) {
  const c = report.clauses.find((x) => x.clause === id);
  assert.ok(c, `clause ${id} present`);
  return c!;
}

test('SKILLS (HARD): no skills declared — passes trivially, ok stays true', () => {
  const p = happyProject();
  try {
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    assert.equal(clause(r, 'SKILLS').pass, true);
    assert.equal(clause(r, 'SKILLS').hard, true);
    assert.equal(r.ok, true);
  } finally {
    p.cleanup();
  }
});

test('SKILLS (HARD): a declared id that resolves to NOTHING fails the clause AND flips report.ok — forge-8vfn.5.13\'s core bug (declared skills that fail to resolve must not read ok)', () => {
  const p = happyProject();
  try {
    declareSkills(p.dir, ['ghost-skill']);
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    assert.equal(clause(r, 'SKILLS').pass, false);
    assert.equal(clause(r, 'SKILLS').hard, true);
    assert.match(clause(r, 'SKILLS').detail, /ghost-skill/);
    assert.equal(r.ok, false, 'a project with an unresolved declared skill must not report ok=true');
  } finally {
    p.cleanup();
  }
});

test('SKILLS (HARD): ALL declared skills failing to resolve — the exact terraform-provider-betterado shape (multiple dead bindings)', () => {
  const p = happyProject();
  try {
    declareSkills(p.dir, ['ado-api-explorer', 'tfplugindocs-gen', 'breaking-change-detector']);
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    assert.equal(clause(r, 'SKILLS').pass, false);
    assert.match(clause(r, 'SKILLS').detail, /3 of 3/);
    assert.equal(r.ok, false);
  } finally {
    p.cleanup();
  }
});

test('SKILLS (HARD): a declared id that resolves PROJECT-LOCALLY (.forge/skills/<id>/SKILL.md) passes', () => {
  const p = happyProject();
  try {
    declareSkills(p.dir, ['local-only-skill']);
    mkdirSync(join(p.dir, '.forge', 'skills', 'local-only-skill'), { recursive: true });
    writeFileSync(join(p.dir, '.forge', 'skills', 'local-only-skill', 'SKILL.md'), '# local\n');
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    assert.equal(clause(r, 'SKILLS').pass, true, clause(r, 'SKILLS').detail);
    assert.equal(r.ok, true);
  } finally {
    p.cleanup();
  }
});

test('SKILLS (HARD): a declared id that resolves FORGE-WIDE (<forgeRoot>/skills/<id>/SKILL.md) passes', () => {
  const p = happyProject();
  try {
    declareSkills(p.dir, ['reflector']);
    mkdirSync(join(p.forgeRoot, 'skills', 'reflector'), { recursive: true });
    writeFileSync(join(p.forgeRoot, 'skills', 'reflector', 'SKILL.md'), '# reflector\n');
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    assert.equal(clause(r, 'SKILLS').pass, true, clause(r, 'SKILLS').detail);
    assert.equal(r.ok, true);
  } finally {
    p.cleanup();
  }
});

test('SKILLS (HARD): a mix of one resolving + one dead id still fails the clause — partial resolution is not resolution', () => {
  const p = happyProject();
  try {
    declareSkills(p.dir, ['reflector', 'ghost-skill']);
    mkdirSync(join(p.forgeRoot, 'skills', 'reflector'), { recursive: true });
    writeFileSync(join(p.forgeRoot, 'skills', 'reflector', 'SKILL.md'), '# reflector\n');
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    assert.equal(clause(r, 'SKILLS').pass, false);
    assert.match(clause(r, 'SKILLS').detail, /1 of 2/);
    assert.doesNotMatch(clause(r, 'SKILLS').detail, /reflector/, 'the resolved id must not be named among the missing ones');
    assert.match(clause(r, 'SKILLS').detail, /ghost-skill/);
  } finally {
    p.cleanup();
  }
});

test('checkSkills: cfg=null (unloadable config) is treated as no skills declared — C1 already reports the load failure', () => {
  const p = happyProject();
  try {
    const result = checkSkills(p.dir, null, p.forgeRoot);
    assert.equal(result.pass, true);
  } finally {
    p.cleanup();
  }
});

test('checkSkills: wired through loadProjectConfig end-to-end matches the runPreflight clause', () => {
  const p = happyProject();
  try {
    declareSkills(p.dir, ['ghost-skill']);
    const cfg = loadProjectConfig(p.dir);
    const result = checkSkills(p.dir, cfg, p.forgeRoot);
    assert.equal(result.pass, false);
    assert.equal(result.hard, true);
  } finally {
    p.cleanup();
  }
});
