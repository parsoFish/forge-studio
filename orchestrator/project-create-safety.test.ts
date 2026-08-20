/**
 * W7-B6 WI-1 — greenfield-create safety pins (projects-35, projects-11).
 *
 * projects-35 (S1, DATA LOSS): the pre-create reconcile treated ANY
 * `projects/<id>` lacking `.forge/.create-complete` as a crashed-create orphan
 * and `rmSync`'d it (plus its brain) — but every onboarded / hand-added
 * project lacks that marker, so a greenfield create whose name collided with
 * a REAL project silently deleted it. New contract: create REFUSES whenever
 * the target directory carries any evidence (any entry at `projects/<id>`),
 * and whenever a REAL `brain/projects/<id>` already exists; the orphan sweep
 * only ever touches dirs carrying the staging marker (`.staging-<id>-*` name
 * prefix). Killed implementation: the marker-absence-implies-orphan reconcile
 * (project-create.ts, pre-W7-B6) — AT-B6-1/-2 are RED against it.
 *
 * projects-11: a greenfield project must be its OWN git repository with a
 * first commit — even when `projectsRoot` sits inside an enclosing git work
 * tree (the real forge-repo shape, where a bare `rev-parse
 * --is-inside-work-tree` probe lies). AT-B6-4 is RED against the pre-fix
 * scaffold (no git init at all on the greenfield path).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { scaffoldGreenfieldProject, projectStartersDir, type CreationManifest } from './project-create.ts';

const REAL_ROOT = process.cwd();

/** Temp forge root with the real starters copied in (same shape as
 *  project-create.test.ts's isolatedForgeRoot). */
function isolatedForgeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pcreate-safety-'));
  const startersDest = join(root, 'studio', 'starters', 'projects');
  mkdirSync(startersDest, { recursive: true });
  cpSync(projectStartersDir(REAL_ROOT), startersDest, { recursive: true });
  mkdirSync(join(root, 'brain', 'projects'), { recursive: true });
  mkdirSync(join(root, 'projects'), { recursive: true });
  return root;
}

function manifest(over: Partial<CreationManifest> = {}): CreationManifest {
  return { name: 'My Tool', appType: 'typescript-cli', language: 'typescript', northStar: 'ship the thing', ...over };
}

test('AT-B6-1 (RED, projects-35) an EXISTING marker-less project (the onboarded shape) is REFUSED — and every pre-existing byte survives', () => {
  const forgeRoot = isolatedForgeRoot();
  const id = 'my-tool';
  const projectDir = join(forgeRoot, 'projects', id);
  const brainDir = join(forgeRoot, 'brain', 'projects', id);
  try {
    // A REAL project, onboarded or hand-added — carries .forge/project.json,
    // source, and a brain, but (like every non-greenfield project) NO
    // .forge/.create-complete marker.
    mkdirSync(join(projectDir, '.forge'), { recursive: true });
    const configBytes = '{"name":"my tool","testProcess":{"local":{"cmd":["npm","test"]}}}\n';
    writeFileSync(join(projectDir, '.forge', 'project.json'), configBytes, 'utf8');
    mkdirSync(join(projectDir, 'src'), { recursive: true });
    writeFileSync(join(projectDir, 'src', 'irreplaceable.ts'), '// months of work\n', 'utf8');
    mkdirSync(join(brainDir, 'themes'), { recursive: true });
    writeFileSync(join(brainDir, 'profile.md'), '# my tool profile\n', 'utf8');
    writeFileSync(join(brainDir, 'themes', 'hard-won-lesson.md'), 'do not lose this\n', 'utf8');
    assert.ok(!existsSync(join(projectDir, '.forge', '.create-complete')), 'precondition: no create marker (the onboarded shape)');

    // KILLED IMPLEMENTATION: the marker-absence reconcile rmSync's projectDir
    // + brain and returns 200 with a fresh scaffold (projects-35's live repro
    // wiped projects/mdtoc + brain/projects/mdtoc).
    assert.throws(
      () => scaffoldGreenfieldProject({ manifest: manifest(), forgeRoot }),
      /already exists/i,
      'a colliding create must REFUSE, never sweep',
    );

    // Assert the ARTIFACT, not just the throw: every pre-existing byte survives.
    assert.equal(readFileSync(join(projectDir, '.forge', 'project.json'), 'utf8'), configBytes, 'project.json must be byte-unchanged');
    assert.ok(existsSync(join(projectDir, 'src', 'irreplaceable.ts')), 'project source must survive');
    assert.ok(existsSync(join(brainDir, 'themes', 'hard-won-lesson.md')), 'the project brain must survive');
    assert.equal(readFileSync(join(brainDir, 'profile.md'), 'utf8'), '# my tool profile\n', 'brain profile must be byte-unchanged');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('AT-B6-2 (RED, projects-35) a REAL brain/projects/<id> with NO matching project dir is REFUSED, never swept (repo-tracked brains exist for projects not on this disk)', () => {
  const forgeRoot = isolatedForgeRoot();
  const id = 'my-tool';
  const brainDir = join(forgeRoot, 'brain', 'projects', id);
  try {
    // The fresh-clone shape: brain/projects/<id> is REPO-TRACKED and present,
    // while gitignored projects/<id> is not checked out. The old reconcile
    // called sweepBrainOrphan() here — deleting a real project's whole brain.
    mkdirSync(join(brainDir, 'themes'), { recursive: true });
    writeFileSync(join(brainDir, 'kb.yaml'), 'id: my-tool\n', 'utf8');
    writeFileSync(join(brainDir, 'themes', 'a-theme.md'), 'accumulated knowledge\n', 'utf8');

    assert.throws(
      () => scaffoldGreenfieldProject({ manifest: manifest(), forgeRoot }),
      /brain/i,
      'an existing REAL project brain must refuse the create, naming the brain',
    );
    assert.equal(readFileSync(join(brainDir, 'themes', 'a-theme.md'), 'utf8'), 'accumulated knowledge\n', 'the brain must be byte-unchanged');
    assert.ok(!existsSync(join(forgeRoot, 'projects', id)), 'no project dir may appear on the refused path');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('AT-B6-3 (green-lock) the `.staging-<id>-*` sweep still runs — a stale staging orphan never blocks or contaminates a fresh create', () => {
  const forgeRoot = isolatedForgeRoot();
  const id = 'my-tool';
  const stagingProj = join(forgeRoot, 'projects', `.staging-${id}-deadbeef`);
  try {
    mkdirSync(stagingProj, { recursive: true });
    writeFileSync(join(stagingProj, 'STALE.txt'), 'from a hard-killed create\n', 'utf8');
    const out = scaffoldGreenfieldProject({ manifest: manifest(), forgeRoot });
    assert.equal(out.id, id);
    assert.ok(!existsSync(stagingProj), 'the staging-marker orphan is swept');
    assert.ok(existsSync(join(forgeRoot, 'projects', id, 'package.json')), 'the fresh create lands');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('AT-B6-4 (RED, projects-11) a greenfield create is its OWN git repo with a first commit — even under an enclosing git work tree', () => {
  const forgeRoot = isolatedForgeRoot();
  try {
    // The real forge-repo shape: projectsRoot sits INSIDE an enclosing git
    // work tree, so a bare `rev-parse --is-inside-work-tree` probe (the
    // projects-11 defect on the onboard path) reports true and a naive
    // implementation would skip `git init` entirely.
    execFileSync('git', ['init', '-q'], { cwd: forgeRoot, stdio: 'ignore' });

    const out = scaffoldGreenfieldProject({ manifest: manifest(), forgeRoot });
    const projectDir = out.projectDir;

    assert.ok(existsSync(join(projectDir, '.git')), 'the created project must carry its OWN .git');
    const toplevel = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: projectDir, encoding: 'utf8' }).trim();
    assert.equal(
      realpathSync(toplevel),
      realpathSync(projectDir),
      'git must resolve the PROJECT dir as its work-tree root — not the enclosing repo (the projects-11 silent-inherit shape)',
    );
    const log = execFileSync('git', ['log', '--oneline'], { cwd: projectDir, encoding: 'utf8' }).trim();
    assert.ok(log.length > 0, 'the scaffold must be committed (a first commit exists)');
    const tracked = execFileSync('git', ['ls-files'], { cwd: projectDir, encoding: 'utf8' });
    assert.ok(tracked.includes('package.json'), 'the first commit must carry the scaffold files');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
