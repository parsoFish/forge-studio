/**
 * Tests for the forge↔project contract preflight (US-4.1 / ADR-017) — the
 * repo-hygiene clauses that need no cross-package brain-paths dependency: C2
 * (scratch hygiene, HARD, git-truth checks — a `.gitignore` text-scan alone
 * is insufficient since ignores are no-ops on already-tracked files, CON-1)
 * and C6 (a satisfiable merge model, ADVISORY, forge-side-satisfied).
 * Mirrors the production split's preflight-repo.ts.
 *
 * Split out of preflight.test.ts (1,044 lines, 57 cases) when that file grew
 * past the 800-line baseline cap — see scripts/baselines/file-size.json /
 * scripts/check-file-size.mjs. Siblings: preflight-gate.test.ts (C1/C1b/C7),
 * preflight-instructions.test.ts (C5/C8), preflight-demo.test.ts (DEMO
 * family), preflight-release.test.ts (C10), preflight-build.test.ts
 * (BUILD/ARTIFACTS), preflight.test.ts (the barrel — C4/BRAIN, the composer,
 * buildVerdictEvent, formatPreflightReport). C4/BRAIN stay in the barrel
 * (not here) for the same cross-package reason preflight-repo.ts itself
 * gives — see that file's header.
 *
 * happyProject()/tmp()/clause() are duplicated from the pre-split file into
 * every sibling (house style — see project-create-atomicity.test.ts's own
 * header) rather than exported/imported, so each file's fixtures stay
 * independently readable.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { runPreflight, SCRATCH_PATHS, type ClauseId } from '../../preflight.ts';

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

