/**
 * forge↔project contract preflight — the repo-hygiene clauses C2 (scratch
 * hygiene, HARD) and C6 (a satisfiable merge model, ADVISORY). A clause-family
 * leaf of `preflight.ts`, whose header carries the split's reasoning, the
 * sibling map, and why C4 and BRAIN — the plan's other two "repo" clauses —
 * stay in the barrel rather than joining this file.
 */

import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';

import type { ClauseResult } from '@forge/kernel';

// C2 policy (ruling 92, bead forge-8vfn.8.1.2): SCRATCH_PATHS (else every
// cycle commits orchestration state into the PR — the W4 reviewer-confusion
// bug) MUST be untracked+ignored — `.forge/work-items/` (regenerated per
// cycle) and the onboard marker `.forge/.create-complete`, NOT `.forge/`
// wholesale. TRACKED_CONFIG_PATHS is the inverse: `.forge/project.json` +
// `.forge/skills/` are contract config every conformant project keeps — a
// blanket `.forge/` ignore silently drops them, so it violates BOTH lists.
export const SCRATCH_PATHS = ['.forge/work-items/', '.forge/.create-complete', 'AGENT.md', 'PROMPT.md', 'fix_plan.md'];
export const TRACKED_CONFIG_PATHS = ['.forge/project.json', '.forge/skills/'];

// --- C2: scratch hygiene (HARD) ---

/**
 * Git-truth scratch hygiene check.
 *
 * A `.gitignore` text-scan is insufficient: git ignores are no-ops on
 * already-tracked files, so a project can have the right `.gitignore` entries
 * yet still commit forge scratch (e.g. betterado's AGENT.md was committed and
 * C2 false-passed). We test git-truth instead:
 *
 * A scratch path is a VIOLATION if EITHER:
 *   (a) `git ls-files --error-unmatch <path>` exits 0  → file is tracked, OR
 *   (b) `git check-ignore -q <path>` exits non-zero    → file is not ignored.
 *
 * Both commands run with cwd = project dir. If the directory is not a git
 * repo, we fall back to the `.gitignore` text-scan (best-effort).
 */
function checkC2(dir: string): ClauseResult {
  const base = { clause: 'C2' as const, title: 'Scratch hygiene (forge scratch ignored; contract config trackable)', hard: true };

  // Determine whether this is a git repo at all.
  const isRepo = spawnSync('git', ['-C', dir, 'rev-parse', '--git-dir'], {
    stdio: 'ignore',
  }).status === 0;

  if (!isRepo) {
    // No git repo — fall back to .gitignore text-scan (best-effort).
    const giPath = join(dir, '.gitignore');
    if (!existsSync(giPath)) {
      return {
        ...base,
        pass: false,
        detail:
          'not a git repo and no .gitignore — forge scratch (.forge/work-items/, .forge/.create-complete, AGENT.md, PROMPT.md, fix_plan.md) would be committed into the PR',
      };
    }
    const lines = readFileSync(giPath, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    // A scratch path is covered if .gitignore lists it OR an ancestor dir of it
    // (e.g. `.forge/work-items/` covers `.forge/work-items/wi-1.md`).
    const isCovered = (p: string): boolean => {
      const stripped = p.replace(/^\//, '').replace(/\/$/, '');
      return lines.some((l) => {
        const ln = l.replace(/^\//, '').replace(/\/$/, '');
        return ln === stripped || stripped.startsWith(`${ln}/`);
      });
    };
    const missing = SCRATCH_PATHS.filter((p) => !isCovered(p));
    const wronglyIgnored = TRACKED_CONFIG_PATHS.filter((p) => isCovered(p)); // inverse (ruling 92)
    if (missing.length > 0 || wronglyIgnored.length > 0) {
      const bad = [
        missing.length > 0 ? `does not exclude ${missing.join(', ')}` : null,
        wronglyIgnored.length > 0 ? `wrongly ignores tracked contract config ${wronglyIgnored.join(', ')}` : null,
      ].filter((s): s is string => s !== null);
      return { ...base, pass: false, detail: `not a git repo; .gitignore ${bad.join('; ')}` };
    }
    return { ...base, pass: true, detail: `not a git repo; .gitignore covers scratch (${SCRATCH_PATHS.join(', ')}) and leaves config trackable` };
  }

  // Git-truth check: a scratch path violates C2 if tracked OR not ignored.
  const violations: string[] = [];
  for (const p of SCRATCH_PATHS) {
    // Strip trailing slash for git commands (git ls-files doesn't match dirs with /).
    const isDir = p.endsWith('/');
    const pathArg = p.replace(/\/$/, '');

    const isTracked =
      spawnSync('git', ['-C', dir, 'ls-files', '--error-unmatch', pathArg], {
        stdio: 'ignore',
      }).status === 0;

    if (isTracked) {
      violations.push(`${p} (tracked by git)`);
      continue;
    }

    // W7-FIX-B-PROJ: a DIRECTORY scratch path is probed via a sentinel CHILD.
    // git's dir-only ignore patterns (`.forge/work-items/` — the exact form
    // `fixScratchHygiene` appends) match only paths git can stat as
    // directories, so probing the dir itself false-fails while the dir does
    // not exist yet (every fresh onboard — the dev-loop creates it later,
    // at which point the pattern DOES ignore it). Any pattern that ignores
    // the dir also ignores its children, and both pattern forms (with and
    // without the trailing slash) match the child, so the sentinel judges
    // the future truth without caring about on-disk state.
    const ignoreProbes = [isDir ? `${pathArg}/.forge-c2-dir-probe` : pathArg];
    // W7-FIX-B-PROJ review F1: the sentinel child judges the FUTURE dir
    // truth, but when the path exists on disk as a NON-directory (a stray
    // regular file, or a symlink — git treats links as link objects and
    // dir-only patterns match only real directories), the child probe can
    // pass while the actual on-disk entry is un-ignored and `git add -A`
    // would sweep it into the PR. lstat deliberately (not stat): a symlink
    // whose target is a directory is still a link to git. When the entry
    // exists as a non-directory, the path ITSELF must also be ignored.
    if (isDir) {
      let existsAsNonDir = false;
      try {
        existsAsNonDir = !lstatSync(join(dir, pathArg)).isDirectory();
      } catch {
        // absent (or unreachable, e.g. an ancestor is a file) — the
        // sentinel child alone judges the future truth.
      }
      if (existsAsNonDir) ignoreProbes.push(pathArg);
    }
    const notIgnored = ignoreProbes.some(
      (probe) =>
        spawnSync('git', ['-C', dir, 'check-ignore', '-q', probe], {
          stdio: 'ignore',
        }).status !== 0,
    );

    if (notIgnored) {
      violations.push(
        ignoreProbes.length > 1
          ? `${p} (exists as a non-directory that git does not ignore — remove the stray entry, or ignore the exact path)`
          : `${p} (not ignored by git)`,
      );
    }
  }

  // Inverse (ruling 92): same sentinel-child probe, but a VIOLATION if ignored.
  const configViolations: string[] = [];
  for (const p of TRACKED_CONFIG_PATHS) {
    const isDir = p.endsWith('/');
    const probe = isDir ? `${p.replace(/\/$/, '')}/.forge-c2-tracked-probe` : p;
    if (spawnSync('git', ['-C', dir, 'check-ignore', '-q', probe], { stdio: 'ignore' }).status === 0) {
      configViolations.push(`${p} (ignored — tracked contract config must stay trackable)`);
    }
  }

  if (violations.length > 0 || configViolations.length > 0) {
    const bad = [
      violations.length > 0 ? `forge scratch violates git-truth hygiene: ${violations.join('; ')}` : null,
      configViolations.length > 0 ? `tracked contract config violates git-truth hygiene: ${configViolations.join('; ')}` : null,
    ].filter((s): s is string => s !== null);
    return { ...base, pass: false, detail: `${bad.join('. ')}. Fix with .gitignore edits + \`git rm --cached <path>\` if a scratch path is already tracked.` };
  }
  return { ...base, pass: true, detail: `git-truth: scratch (${SCRATCH_PATHS.join(', ')}) untracked+ignored; config (${TRACKED_CONFIG_PATHS.join(', ')}) trackable` };
}

// --- C6: a satisfiable merge model (ADVISORY — forge-side-satisfied) ---

function checkC6(dir: string): ClauseResult {
  const base = { clause: 'C6' as const, title: 'Satisfiable merge model', hard: false };
  // Post-Phase-6 this clause is structurally satisfied by FORGE: the review
  // phase produces a demo-embedded PR and STOPS; the operator merges in
  // GitHub (no auto-merge). The only project-side requirement is a GitHub
  // remote so there is a PR surface to merge.
  const remote = gitRemoteUrl(dir);
  if (remote && /github\.com/i.test(remote)) {
    return {
      ...base,
      pass: true,
      detail: `forge-side-satisfied (Phase-6: no auto-merge, operator merges the PR). Project has a GitHub remote: ${remote}`,
    };
  }
  return {
    ...base,
    pass: false,
    detail:
      'forge-side-satisfied for the merge model, BUT no GitHub remote found — there is no PR surface ' +
      'for the operator to merge. Add a GitHub `origin` remote. (Advisory.)',
  };
}

function gitRemoteUrl(dir: string): string | null {
  try {
    return execFileSync('git', ['-C', dir, 'remote', 'get-url', 'origin'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
}

export { checkC2, checkC6 };
