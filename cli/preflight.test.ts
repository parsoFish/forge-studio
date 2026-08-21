/**
 * Tests for the forge↔project contract preflight (US-4.1 / ADR-017).
 *
 * Each test builds a throwaway project dir exercising one clause's
 * pass/fail path. C1/C2/C4 are HARD (drive `ok`); C5/C6/C8 are advisory
 * (warn, never flip `ok`).
 *
 * C2 uses git-truth checks (git ls-files + git check-ignore) rather than
 * scanning .gitignore text — already-tracked files bypass .gitignore and
 * must be caught (CON-1).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { runPreflight, formatPreflightReport, buildVerdictEvent, SCRATCH_PATHS, type ClauseId } from './preflight.ts';

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

test('C2 (HARD): scratch path not ignored by git ⇒ fail + ok=false, names the path', () => {
  const p = happyProject();
  try {
    // Remove PROMPT.md and fix_plan.md from .gitignore so they are NOT ignored.
    writeFileSync(join(p.dir, '.gitignore'), ['node_modules/', 'dist/', '.forge/', 'AGENT.md'].join('\n'));
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    const c = clause(r, 'C2');
    assert.equal(c.pass, false);
    assert.equal(c.hard, true);
    assert.equal(r.ok, false);
    assert.match(c.detail, /PROMPT\.md|fix_plan\.md/);
  } finally {
    p.cleanup();
  }
});

test('C2 (HARD): scratch path tracked by git ⇒ fail even with .gitignore entry', () => {
  const p = happyProject();
  try {
    // Create and stage AGENT.md — once tracked, .gitignore entries are ignored.
    writeFileSync(join(p.dir, 'AGENT.md'), '# agent\n');
    execFileSync('git', ['-C', p.dir, 'add', '-f', 'AGENT.md']);
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    const c = clause(r, 'C2');
    assert.equal(c.pass, false);
    assert.equal(c.hard, true);
    assert.equal(r.ok, false);
    assert.match(c.detail, /AGENT\.md.*tracked|tracked.*AGENT\.md/i);
  } finally {
    p.cleanup();
  }
});

test('C2 (HARD): no git repo + absent .gitignore fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-preflight-nogit-'));
  const forgeRoot = mkdtempSync(join(tmpdir(), 'forge-preflight-root-'));
  try {
    // Set up just enough to not trigger other hard clauses, but no git repo.
    const name = dir.split('/').pop()!;
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, scripts: { test: 'vitest run' } }));
    writeFileSync(join(dir, 'roadmap.md'), '# r\n');
    mkdirSync(join(forgeRoot, 'brain', 'projects', name), { recursive: true });
    writeFileSync(join(forgeRoot, 'brain', 'projects', name, 'profile.md'), '# p\n');
    const r = runPreflight(dir, { forgeRoot });
    assert.equal(clause(r, 'C2').pass, false);
    assert.equal(r.ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('C2 (HARD): a dir-only ignore pattern (".forge/work-items/") covers the NOT-yet-created work-items dir', () => {
  // W7-FIX-B-PROJ (gate regression, stand-up-onboard SU beat): git's dir-only
  // patterns (trailing slash) match only paths git can SEE as directories, so
  // `git check-ignore -q .forge/work-items` false-fails on a fresh project
  // whose work-items dir has not been created yet — the dev-loop creates it
  // later, at which point the pattern DOES ignore it. The probe must judge the
  // future truth (a sentinel child), not the current stat. Pre-W7-B6 this was
  // masked: projects under forge's own work tree had no repo of their own, so
  // the probe resolved against FORGE's repo where projects/ ignores everything.
  const p = happyProject();
  try {
    // The exact journey-fixture / operator-idiomatic shape: work-items listed
    // with a trailing slash, `.forge/` itself NOT wholesale-ignored.
    writeFileSync(
      join(p.dir, '.gitignore'),
      ['node_modules/', 'dist/', '.forge/work-items/', 'AGENT.md', 'PROMPT.md', 'fix_plan.md'].join('\n'),
    );
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    const c = clause(r, 'C2');
    assert.equal(c.pass, true, `C2 must pass — dir-only pattern covers the future work-items dir: ${c.detail}`);
  } finally {
    p.cleanup();
  }
});

test('C2 (HARD): the auto-fix\'s own output (SCRATCH_PATHS verbatim in .gitignore) clears C2 in git-truth mode', () => {
  // Self-consistency pin: `fixScratchHygiene` appends SCRATCH_PATHS verbatim
  // (`.forge/work-items/` with the trailing slash). checkC2 must accept its
  // own auto-fix's output on a repo where none of the scratch paths exist yet
  // — otherwise the resolution loop can never converge on a fresh project.
  const p = happyProject();
  try {
    writeFileSync(join(p.dir, '.gitignore'), ['node_modules/', ...SCRATCH_PATHS].join('\n') + '\n');
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    const c = clause(r, 'C2');
    assert.equal(c.pass, true, `C2 must accept the auto-fix's own .gitignore output: ${c.detail}`);
  } finally {
    p.cleanup();
  }
});

test('C2 (HARD): a dir scratch path ignored ONLY against the enclosing repo still fails (own-repo truth)', () => {
  // Green-lock for the W7-B6 own-repo semantics: the project HAS its own repo
  // and its own .gitignore misses the dir scratch path — C2 must fail even
  // though a hypothetical enclosing repo would have ignored everything. The
  // sentinel-child probe must not accidentally consult anything but the
  // project's own repo.
  const p = happyProject();
  try {
    writeFileSync(
      join(p.dir, '.gitignore'),
      ['node_modules/', 'AGENT.md', 'PROMPT.md', 'fix_plan.md'].join('\n'),
    );
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    const c = clause(r, 'C2');
    assert.equal(c.pass, false);
    assert.match(c.detail, /\.forge\/work-items/);
  } finally {
    p.cleanup();
  }
});

test('C2 (HARD): a dir scratch path existing as a stray regular FILE fails even with the dir-only pattern present', () => {
  // W7-FIX-B-PROJ review F1: the sentinel-child probe judges the FUTURE dir
  // truth, but when the path exists on disk as a regular file (e.g. a buggy
  // agent wrote `.forge/work-items` as a FILE), git's dir-only pattern
  // `.forge/work-items/` never matches it — the stray entry is untracked AND
  // un-ignored, so the dev-loop's `git add -A` sweeps it into the PR while
  // the child probe alone reports green. When the path exists as a
  // non-directory, checkC2 must also probe the path ITSELF.
  const p = happyProject();
  try {
    writeFileSync(join(p.dir, '.gitignore'), ['node_modules/', ...SCRATCH_PATHS].join('\n') + '\n');
    // happyProject already created .forge/ (a real dir) — plant the stray FILE.
    writeFileSync(join(p.dir, '.forge', 'work-items'), 'stray — not a directory\n');
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    const c = clause(r, 'C2');
    assert.equal(c.pass, false, `a stray FILE at a dir scratch path must fail C2: ${c.detail}`);
    assert.match(c.detail, /\.forge\/work-items/);
  } finally {
    p.cleanup();
  }
});

test('C2 (HARD): a dir scratch path existing as a SYMLINK fails under a dir-only pattern (git never dir-matches links)', () => {
  // Same class as the stray-FILE pin, via lstat: a symlink — even one whose
  // target IS a directory — is a link object to git (never descended, added
  // as the link itself by `git add -A`), and dir-only patterns match only
  // real directories. The probe must judge the on-disk entry with lstat, not
  // a target-following stat.
  const p = happyProject();
  try {
    writeFileSync(join(p.dir, '.gitignore'), ['node_modules/', ...SCRATCH_PATHS].join('\n') + '\n');
    mkdirSync(join(p.dir, 'real-scratch-dir'));
    symlinkSync(join(p.dir, 'real-scratch-dir'), join(p.dir, '.forge', 'work-items'));
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    const c = clause(r, 'C2');
    assert.equal(c.pass, false, `a symlink at a dir scratch path must fail C2: ${c.detail}`);
    assert.match(c.detail, /\.forge\/work-items/);
  } finally {
    p.cleanup();
  }
});

test('C2 (HARD, green-lock) a dir scratch path existing as a REAL directory still passes with the dir-only pattern', () => {
  // Guard the fix's own edge: when the dir genuinely exists, the dir-only
  // pattern matches it and the non-dir probe must NOT fire — C2 stays green.
  const p = happyProject();
  try {
    writeFileSync(join(p.dir, '.gitignore'), ['node_modules/', ...SCRATCH_PATHS].join('\n') + '\n');
    mkdirSync(join(p.dir, '.forge', 'work-items'), { recursive: true });
    writeFileSync(join(p.dir, '.forge', 'work-items', 'wi-1.md'), '# wi\n');
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    const c = clause(r, 'C2');
    assert.equal(c.pass, true, `an existing real work-items dir under the dir-only pattern must pass: ${c.detail}`);
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
    // Brain 3 is forge-owned + central (ADR 035).
    mkdirSync(join(forgeRoot, 'brain', 'projects', name), { recursive: true });
    writeFileSync(join(forgeRoot, 'brain', 'projects', name, 'profile.md'), '# p\n');
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

// --- R1-04-F1: C8 coverage ---

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

// --- R1-04-F2: C10 release substrate ---

test('C10 (R1-04-F2): no releaseProcess → inert pass', () => {
  const p = happyProject();
  try {
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    const c10 = clause(r, 'C10');
    assert.equal(c10.pass, true);
    assert.match(c10.detail, /inert/);
  } finally {
    p.cleanup();
  }
});

test('C10 (R1-04-F2): a changelog step with a missing changelogPath substrate → advisory fail', () => {
  const p = happyProject();
  try {
    writeFileSync(
      join(p.dir, '.forge', 'project.json'),
      JSON.stringify({
        testProcess: { local: { cmd: ['vitest', 'run'] } },
        demoProcess: [{ kind: 'capture', text: 'x' }, { kind: 'verify', text: 'y' }],
        releaseProcess: { steps: [{ kind: 'changelog', phase: 'in-cycle', text: 'draft' }], changelogPath: 'CHANGELOG.md' },
      }),
    );
    // No CHANGELOG.md written → substrate missing.
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    const c10 = clause(r, 'C10');
    assert.equal(c10.pass, false);
    assert.match(c10.detail, /changelogPath "CHANGELOG.md" does not exist/);
  } finally {
    p.cleanup();
  }
});

test('C10 (R1-04-F2): declared substrate present → pass', () => {
  const p = happyProject();
  try {
    writeFileSync(join(p.dir, 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n');
    writeFileSync(
      join(p.dir, '.forge', 'project.json'),
      JSON.stringify({
        testProcess: { local: { cmd: ['vitest', 'run'] } },
        demoProcess: [{ kind: 'capture', text: 'x' }, { kind: 'verify', text: 'y' }],
        releaseProcess: { steps: [{ kind: 'changelog', phase: 'in-cycle', text: 'draft' }], changelogPath: 'CHANGELOG.md' },
      }),
    );
    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    assert.equal(clause(r, 'C10').pass, true);
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
