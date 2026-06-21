#!/usr/bin/env node
/**
 * ADR 035 migration — relocate per-project Brain 3 + development/demo history
 * from inside each managed project's repo into forge's CENTRAL, forge-owned
 * directories:
 *
 *   <project>/[<artifactRoot>/]brain/      →  brain/projects/<name>/
 *   <project>/[<artifactRoot>/]history/    →  project-artifacts/<name>/demo-history/
 *
 * The brain `profile.md` lands at brain/projects/<name>/profile.md (preflight C4
 * reads it there). Demo *machinery* (forge/skills/) STAYS in the project repo.
 *
 * Idempotent + reversible. Default mode is a DRY RUN (prints the plan, writes
 * nothing). `--apply` performs the copy into forge-central. `--remove-sources`
 * additionally removes the originals — for a forge-TRACKED source (e.g. the
 * mdtoc reference project) via `git rm`; for a SEPARATE project repo via a plain
 * working-tree delete (reversible in that repo with `git checkout`). Scope to one
 * project with `--only <name>`.
 *
 * Recovery: before `--remove-sources` against forge-tracked files, tag forge
 * (e.g. `git tag artifacts-pre-central`), mirroring ADR 018's `brain-pre-restructure`.
 *
 * Usage:
 *   node scripts/migrate-central-artifacts.mjs                 # dry run, all projects
 *   node scripts/migrate-central-artifacts.mjs --apply         # copy into central
 *   node scripts/migrate-central-artifacts.mjs --apply --remove-sources --only mdtoc
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FORGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const REMOVE_SOURCES = argv.includes('--remove-sources');
const onlyIdx = argv.indexOf('--only');
const ONLY = onlyIdx >= 0 ? argv[onlyIdx + 1] : null;

const log = (...a) => console.log(...a);
const plan = [];

/** Read project.json artifactRoot (default "."), tolerant of malformed files. */
function artifactRootOf(projectRoot) {
  try {
    const p = join(projectRoot, '.forge', 'project.json');
    if (!existsSync(p)) return '.';
    const v = JSON.parse(readFileSync(p, 'utf8')).artifactRoot;
    return typeof v === 'string' && v.trim() && !v.includes('..') ? v.trim() : '.';
  } catch {
    return '.';
  }
}

/** First existing candidate dir, or null. */
function firstDir(...candidates) {
  for (const c of candidates) {
    if (c && existsSync(c) && statSync(c).isDirectory()) return c;
  }
  return null;
}

/** True iff `path` is tracked in the forge git index. */
function forgeTracked(path) {
  try {
    execFileSync('git', ['-C', FORGE_ROOT, 'ls-files', '--error-unmatch', path], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function copyInto(src, destDir, label) {
  plan.push(`COPY  ${label}: ${rel(src)} → ${rel(destDir)}`);
  if (!APPLY) return;
  mkdirSync(destDir, { recursive: true });
  cpSync(src, destDir, { recursive: true });
}

function removeSource(src) {
  if (!REMOVE_SOURCES) return;
  const tracked = forgeTracked(src);
  plan.push(`REMOVE source (${tracked ? 'git rm' : 'rm'}): ${rel(src)}`);
  if (!APPLY) return;
  if (tracked) {
    execFileSync('git', ['-C', FORGE_ROOT, 'rm', '-r', '-q', src], { stdio: 'inherit' });
  } else {
    rmSync(src, { recursive: true, force: true });
  }
}

const rel = (p) => p.replace(`${FORGE_ROOT}/`, '');

function migrateProject(name) {
  const projectRoot = join(FORGE_ROOT, 'projects', name);
  if (!existsSync(projectRoot)) return;
  const ar = artifactRootOf(projectRoot);

  const brainSrc = firstDir(
    ar !== '.' ? join(projectRoot, ar, 'brain') : null,
    join(projectRoot, 'forge', 'brain'),
    join(projectRoot, 'brain'),
  );
  const historySrc = firstDir(
    ar !== '.' ? join(projectRoot, ar, 'history') : null,
    join(projectRoot, 'forge', 'history'),
    join(projectRoot, 'history'),
  );

  if (!brainSrc && !historySrc) {
    log(`· ${name}: nothing to migrate (no brain/ or history/)`);
    return;
  }
  log(`· ${name}: artifactRoot="${ar}"`);

  if (brainSrc) {
    // brain contents (profile.md, themes/, indexes) → brain/projects/<name>/
    copyInto(brainSrc, join(FORGE_ROOT, 'brain', 'projects', name), 'brain');
    removeSource(brainSrc);
  }
  if (historySrc) {
    copyInto(
      historySrc,
      join(FORGE_ROOT, 'project-artifacts', name, 'demo-history'),
      'history',
    );
    removeSource(historySrc);
  }
}

function discoverProjects() {
  const root = join(FORGE_ROOT, 'projects');
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((n) => {
    const d = join(root, n);
    return statSync(d).isDirectory() && !n.startsWith('.') && n !== 'README.md';
  });
}

const projects = ONLY ? [ONLY] : discoverProjects();
log(
  `ADR 035 central-artifacts migration — mode: ${
    APPLY ? (REMOVE_SOURCES ? 'APPLY + REMOVE-SOURCES' : 'APPLY (copy only)') : 'DRY RUN'
  }${ONLY ? ` — only ${ONLY}` : ''}\n`,
);
for (const name of projects) migrateProject(name);

log(`\nPlan (${plan.length} action(s)):`);
for (const line of plan) log(`  ${line}`);
if (!APPLY) log(`\n(dry run — pass --apply to execute)`);
