/**
 * SKILLS clause (forge-8vfn.5.13) — the ruling-92 TRACKED sub-clause.
 *
 * THE INCIDENT THIS CLOSES: a funded gitpulse run crashed the dev-loop agent
 * with `declared skill "git-log-analysis" does not resolve`. gitpulse's
 * `.forge/project.json` declared the skill, and `.forge/skills/
 * git-log-analysis/SKILL.md` EXISTED in the project's main checkout — but was
 * UNTRACKED (never committed). `checkSkills` (`preflight-skills.ts`) passed
 * because it only ever checked EXISTENCE in the main checkout; every per-WI
 * git worktree checks out TRACKED content only (`packages/flows/
 * wi-worktree.ts`'s `createWiWorktree`, a real linked worktree), so the
 * untracked file never arrived there and `loadDeclaredSkills` (item 90)
 * correctly refused. Operator ruling 92: `.forge/skills/` is the canonical,
 * TRACKED location — a project-local resolution that is not tracked is now a
 * SKILLS clause failure, naming the id and the exact remedy.
 *
 * happyProject()/tmp()/declareSkills()/clause() are duplicated from
 * preflight-skills.test.ts into this sibling (house style — see that file's
 * own header, and project-create-atomicity.test.ts's) rather than exported/
 * imported, so each file's fixtures stay independently readable.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { runPreflight, SCRATCH_PATHS, type ClauseId } from '../../preflight.ts';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'forge-preflight-tracked-'));
}

/** A project dir that satisfies every clause. Verbatim shape from
 *  preflight-skills.test.ts's own happyProject() (see that file's header for
 *  why this is duplicated rather than shared). */
function happyProject(): { dir: string; forgeRoot: string; cleanup: () => void } {
  const dir = tmp();
  const forgeRoot = tmp();
  const name = dir.split('/').pop()!;
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, scripts: { test: 'vitest run' } }));
  writeFileSync(join(dir, '.gitignore'), ['node_modules/', 'dist/', ...SCRATCH_PATHS].join('\n'));
  writeFileSync(join(dir, 'roadmap.md'), '# Roadmap\n');
  writeFileSync(join(dir, 'CLAUDE.md'), '# Constraints\nUser owns git.\nQuality gate: `vitest run`.\n');
  mkdirSync(join(forgeRoot, 'brain', 'projects', name), { recursive: true });
  writeFileSync(join(forgeRoot, 'brain', 'projects', name, 'profile.md'), '# profile\n');
  mkdirSync(join(dir, '.forge'), { recursive: true });
  writeFileSync(
    join(dir, '.forge', 'project.json'),
    JSON.stringify({
      testProcess: { local: { cmd: ['vitest', 'run'] }, ci: { cmd: ['vitest', 'run'] } },
      demoProcess: [
        { kind: 'capture', text: 'Capture before state.' },
        { kind: 'verify', text: 'Run vitest to verify the change.' },
      ],
    }),
  );
  mkdirSync(join(dir, '.forge', 'skills', 'demo-design'), { recursive: true });
  writeFileSync(join(dir, '.forge', 'skills', 'demo-design', 'SKILL.md'), '# demo-design\n');
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

function declareSkills(dir: string, skills: string[]): void {
  const cfgPath = join(dir, '.forge', 'project.json');
  const raw = JSON.parse(readFileSync(cfgPath, 'utf8')) as Record<string, unknown>;
  raw.skills = skills;
  writeFileSync(cfgPath, JSON.stringify(raw));
}

/** `git add -A` + commit, identity supplied per-invocation so an unattended
 *  host with no global git identity still commits (mirrors project-create.ts's
 *  own scaffold commit). */
function commitAll(dir: string, message: string): void {
  execFileSync('git', ['-C', dir, 'add', '-A']);
  execFileSync('git', [
    '-C', dir,
    '-c', 'user.name=forge-test',
    '-c', 'user.email=forge-test@localhost',
    '-c', 'commit.gpgsign=false',
    'commit', '-q', '-m', message,
  ]);
}

function clause(report: ReturnType<typeof runPreflight>, id: ClauseId) {
  const c = report.clauses.find((x) => x.clause === id);
  assert.ok(c, `clause ${id} present`);
  return c!;
}

// (a) ---------------------------------------------------------------------

test('SKILLS (HARD, ruling 92): a git project with a declared skill present PROJECT-LOCALLY but UNTRACKED fails, naming the id and the remedy', () => {
  const p = happyProject();
  try {
    declareSkills(p.dir, ['git-log-analysis']);
    mkdirSync(join(p.dir, '.forge', 'skills', 'git-log-analysis'), { recursive: true });
    writeFileSync(join(p.dir, '.forge', 'skills', 'git-log-analysis', 'SKILL.md'), '# git-log-analysis\n');
    // Deliberately NOT committed — the exact gitpulse incident shape.

    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    const skills = clause(r, 'SKILLS');
    assert.equal(skills.pass, false, skills.detail);
    assert.equal(skills.hard, true);
    assert.match(skills.detail, /git-log-analysis/);
    assert.match(
      skills.detail,
      /commit \.forge\/skills\/git-log-analysis\/SKILL\.md — the per-work-item worktree is cut from git and will not contain an untracked skill/,
    );
    assert.equal(r.ok, false, 'an untracked project-local skill must not report ok=true');
  } finally {
    p.cleanup();
  }
});

// (b) ---------------------------------------------------------------------

test('SKILLS (HARD, ruling 92): the same skill, once committed, passes', () => {
  const p = happyProject();
  try {
    declareSkills(p.dir, ['git-log-analysis']);
    mkdirSync(join(p.dir, '.forge', 'skills', 'git-log-analysis'), { recursive: true });
    writeFileSync(join(p.dir, '.forge', 'skills', 'git-log-analysis', 'SKILL.md'), '# git-log-analysis\n');
    commitAll(p.dir, 'chore: commit git-log-analysis skill');

    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    const skills = clause(r, 'SKILLS');
    assert.equal(skills.pass, true, skills.detail);
    assert.equal(r.ok, true);
  } finally {
    p.cleanup();
  }
});

// (c) ---------------------------------------------------------------------

test('SKILLS (HARD, ruling 92): a forge-wide resolution passes without any tracking check, even inside a git project', () => {
  const p = happyProject();
  try {
    declareSkills(p.dir, ['reflector']);
    mkdirSync(join(p.forgeRoot, 'skills', 'reflector'), { recursive: true });
    writeFileSync(join(p.forgeRoot, 'skills', 'reflector', 'SKILL.md'), '# reflector\n');
    // Nothing committed in p.dir beyond what happyProject() already wrote —
    // the forge-wide skill lives entirely outside the project's own repo, so
    // there is nothing project-local for git-truth to judge.

    const r = runPreflight(p.dir, { forgeRoot: p.forgeRoot });
    const skills = clause(r, 'SKILLS');
    assert.equal(skills.pass, true, skills.detail);
    assert.equal(r.ok, true);
  } finally {
    p.cleanup();
  }
});

// (d) ---------------------------------------------------------------------

test('SKILLS (HARD, ruling 92): a NON-GIT project dir is unaffected by the tracked check — presence alone still resolves it', () => {
  const dir = tmp();
  const forgeRoot = tmp();
  try {
    // No `git init` at all — isGitRepoDir(dir) is false, so the tracked
    // check must not run (there is no git-truth to consult).
    mkdirSync(join(dir, '.forge'), { recursive: true });
    writeFileSync(
      join(dir, '.forge', 'project.json'),
      JSON.stringify({ testProcess: { local: { cmd: ['true'] } }, skills: ['git-log-analysis'] }),
    );
    mkdirSync(join(dir, '.forge', 'skills', 'git-log-analysis'), { recursive: true });
    writeFileSync(join(dir, '.forge', 'skills', 'git-log-analysis', 'SKILL.md'), '# git-log-analysis\n');

    const r = runPreflight(dir, { forgeRoot });
    const skills = clause(r, 'SKILLS');
    assert.equal(skills.pass, true, skills.detail);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
