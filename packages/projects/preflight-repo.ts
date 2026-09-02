/**
 * forge↔project contract preflight — the repo-hygiene clauses C2 (scratch
 * hygiene, HARD) and C6 (a satisfiable merge model, ADVISORY). Split out of
 * `preflight.ts` (the barrel) when that file grew past the 800-line baseline
 * cap; see `scripts/baselines/file-size.json` / `scripts/check-file-size.mjs`.
 *
 * C4 (machine-consumable architecture context) and BRAIN (brain freshness)
 * are the plan's other two "repo" clauses and stay in the barrel. At the
 * split they were held there by a boundary row: both resolved brain paths
 * through `@forge/knowledge/brain-paths.ts`, the one baselined cross-package
 * edge `preflight.ts` carried, and moving them would have swapped that row
 * for a same-count rename. M4's layout PR removed the constraint entirely —
 * `projectBrainDir`/`projectThemesDir` are `@forge/kernel` exports now
 * (ruling 18) and the row is deleted from `scripts/baselines/boundaries.json`
 * — so the division here is by clause family alone.
 *
 * Siblings: `preflight-gate.ts` (C1/C1b/C7), `preflight-instructions.ts`
 * (C5/C8), `preflight-demo.ts` (DEMO family), `preflight-release.ts` (C10),
 * `preflight-build.ts` (BUILD/ARTIFACTS).
 */

import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';

import type { ClauseResult } from '@forge/kernel';

// C2: forge scratch the project repo MUST NOT track these paths (else every
// cycle commits orchestration state into the PR — the W4 reviewer-confusion
// bug). Checked via git-truth: a path violates C2 if it is tracked by git
// (`git ls-files --error-unmatch` succeeds) OR not ignored by git
// (`git check-ignore -q` fails), in either case relative to the project dir.
// NOTE: the scratch dir is `.forge/work-items/` (regenerated per cycle), NOT
// `.forge/` wholesale — `.forge/project.json` + `.forge/quality_gate_cmd` are
// tracked CONTRACT CONFIG every conformant project keeps, so flagging `.forge/`
// here false-failed them.
export const SCRATCH_PATHS = ['.forge/work-items/', 'AGENT.md', 'PROMPT.md', 'fix_plan.md'];

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
  const base = { clause: 'C2' as const, title: 'Scratch hygiene (forge scratch untracked + ignored)', hard: true };

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
          'not a git repo and no .gitignore — forge scratch (.forge/, AGENT.md, PROMPT.md, fix_plan.md) would be committed into the PR',
      };
    }
    const lines = readFileSync(giPath, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    // A scratch path is covered if .gitignore lists it OR an ancestor dir of it
    // (e.g. `.forge/` covers `.forge/work-items/`).
    const isCovered = (p: string): boolean => {
      const stripped = p.replace(/^\//, '').replace(/\/$/, '');
      return lines.some((l) => {
        const ln = l.replace(/^\//, '').replace(/\/$/, '');
        return ln === stripped || stripped.startsWith(`${ln}/`);
      });
    };
    const missing = SCRATCH_PATHS.filter((p) => !isCovered(p));
    if (missing.length > 0) {
      return {
        ...base,
        pass: false,
        detail: `not a git repo; .gitignore does not exclude: ${missing.join(', ')}`,
      };
    }
    return {
      ...base,
      pass: true,
      detail: `not a git repo; .gitignore covers all forge scratch (${SCRATCH_PATHS.join(', ')})`,
    };
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

  if (violations.length > 0) {
    return {
      ...base,
      pass: false,
      detail:
        `forge scratch violates git-truth hygiene: ${violations.join('; ')}. ` +
        'Add these to .gitignore AND ensure they are not already tracked ' +
        '(`git rm --cached <path>` if needed).',
    };
  }
  return {
    ...base,
    pass: true,
    detail: `git-truth: all forge scratch paths (${SCRATCH_PATHS.join(', ')}) are untracked + ignored`,
  };
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
