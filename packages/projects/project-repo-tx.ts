/**
 * Project-repo write transaction (operator feedback R1, 2026-06-27).
 *
 * Every forge-UI change that touches a PROJECT repo (project.json, AGENTS.md,
 * .gitignore, roadmap.md, demo machinery, preflight-fix edits) is committed to a
 * single persistent `forge-studio` branch rather than left uncommitted in the
 * working tree (which is why "apply decision" silently lost its edits). Changes
 * accumulate on that one branch across many forge-UI actions; a single "Save"
 * (`saveProjectRepo`, project-repo-save.ts) merges it into the default branch —
 * or, when that branch is protected, opens a pull request — so cycles branching
 * from origin/main (and GitHub) see the configuration.
 *
 * Pure git wrappers (execFileSync) — no orchestrator deps — so they unit-test
 * against a throwaway repo.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';

import { gitIdentityConfigArgs, ORCHESTRATOR_GIT_IDENTITY } from '@forge/kernel';

export const STUDIO_BRANCH = 'forge-studio';

/** Thrown when `commitStudioChange` is handed a path to commit that git still
 *  ignores, so `git add` silently skipped it. That skip once committed a skill
 *  relocation as nine deletions and nothing added (forge project reset). */
export class StudioWritePathIgnoredError extends Error {
  readonly paths: string[];
  constructor(paths: string[]) {
    super(
      `commitStudioChange: git refused to stage the following explicitly-listed path(s) — still ignored by .gitignore: ${paths.join(', ')}`,
    );
    this.name = 'StudioWritePathIgnoredError';
    this.paths = paths;
  }
}

/** Forge session/scratch dirs that must NEVER be committed into the project. */
const SCRATCH_EXCLUDES = ['_preflight-fix', '.forge/work-items'];

export /** Ceiling for one git call (a fetch/push to a dead remote must not hold a request forever);
 *  `FORGE_GIT_TIMEOUT_MS` overrides it. */
const DEFAULT_GIT_TIMEOUT_MS = 120_000;
const gitTimeoutMs = (): number => Number(process.env['FORGE_GIT_TIMEOUT_MS']) || DEFAULT_GIT_TIMEOUT_MS;

/** Never prompt: a credential or host-key question on /dev/tty would hang a bridge
 *  route with nobody to answer it (forge-mfv5.1.22 review). */
/** Never prompt on a tty; an operator's own GIT_SSH_COMMAND is kept (only the default ssh gets BatchMode). */
const nonInteractiveEnv = (): Record<string, string> => ({
  GIT_TERMINAL_PROMPT: '0',
  ...(process.env.GIT_SSH_COMMAND ? {} : { GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' }),
});

export function git(projectDir: string, args: string[], opts: { allowFail?: boolean; raw?: boolean } = {}): string { // raw: porcelain's leading status column survives (a trim eats it)
  const timeout = gitTimeoutMs();
  try {
    const out = execFileSync('git', ['-C', projectDir, ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout, env: { ...process.env, ...nonInteractiveEnv() },
    });
    return opts.raw ? out : out.trim();
  } catch (err) {
    if (opts.allowFail) return '';
    if ((err as { code?: unknown }).code === 'ETIMEDOUT') throw new Error(`git ${args.find((a) => !a.startsWith('-')) ?? ''} timed out after ${timeout} ms`);
    throw err;
  }
}

export function branchExists(projectDir: string, branch: string): boolean {
  try {
    git(projectDir, ['rev-parse', '--verify', '--quiet', branch]);
    return true;
  } catch {
    return false;
  }
}

/**
 * True iff `projectDir` is itself a standalone git repo ROOT — not merely
 * nested somewhere inside an ancestor repo's working tree. `git rev-parse
 * --git-dir` alone is NOT sufficient: it succeeds for ANY directory nested
 * inside a repo (git walks upward to find `.git`), so a managed project with
 * no `.git` of its own (committed straight into the forge repo/worktree,
 * e.g. `projects/mdtoc`) would wrongly report `true` — and a caller that then
 * runs `git checkout <branch>` against it moves the ANCESTOR repo's HEAD
 * instead (the R5-01 dry-bridge Defect B class). Comparing the realpath of
 * `--show-toplevel` against the realpath of `projectDir` itself only passes
 * for a directory that IS its own repo root.
 */
export function isGitRepo(projectDir: string): boolean {
  if (!existsSync(projectDir)) return false;
  try {
    const toplevel = git(projectDir, ['rev-parse', '--show-toplevel']);
    return realpathSync(toplevel) === realpathSync(projectDir);
  } catch {
    return false;
  }
}

/** The repo's default branch (main|master), falling back to 'main'. */
export function defaultBranch(projectDir: string): string {
  for (const b of ['main', 'master']) {
    if (branchExists(projectDir, b)) return b;
  }
  return 'main';
}

export function currentBranch(projectDir: string): string {
  return git(projectDir, ['rev-parse', '--abbrev-ref', 'HEAD'], { allowFail: true });
}

/**
 * True iff the repo has at least one commit. A freshly `git init`'d repo has
 * an UNBORN HEAD — no commits, and therefore NO branch ref at all, so
 * `defaultBranch()`'s literal 'main' fallback names something that does not
 * exist (projects-37).
 */
function hasCommits(projectDir: string): boolean {
  try {
    git(projectDir, ['rev-parse', '--verify', '--quiet', 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure the project repo is on the persistent `forge-studio` branch (created
 * from the default branch if it doesn't exist yet). No-op for a non-git dir.
 */
export function ensureStudioBranch(projectDir: string): void {
  if (!isGitRepo(projectDir)) return;
  if (currentBranch(projectDir) === STUDIO_BRANCH) return;
  if (branchExists(projectDir, STUDIO_BRANCH)) git(projectDir, ['checkout', STUDIO_BRANCH]);
  // projects-37 (S1): an UNBORN repo — `git init` with no commit yet, exactly
  // what onboarding a brand-new project leaves behind — has no branch ref at
  // all, so `defaultBranch()` returns its literal 'main' fallback and
  // `checkout -b forge-studio main` fatals ("'main' is not a commit"). That
  // throw propagated through withStudioWrite to the PUT
  // /api/studio/projects/:id route → 500, so the operator's FIRST "Save
  // project" after onboarding silently discarded the edit, with no in-Studio
  // remedy. On an unborn HEAD the branch is created with NO start-point.
  else if (!hasCommits(projectDir)) git(projectDir, ['checkout', '-b', STUDIO_BRANCH]);
  else git(projectDir, ['checkout', '-b', STUDIO_BRANCH, defaultBranch(projectDir)]);
}

/**
 * Stage + commit the forge-UI change onto `forge-studio`. With `paths`, stages
 * exactly those; otherwise stages everything EXCEPT forge scratch/session dirs.
 * Returns true iff a commit was made (false when nothing changed).
 */
/** Paths git reports as dirty (modified, added, untracked) in the project repo,
 *  porcelain-parsed. `[]` for a clean tree, a non-repo, or an unreadable read —
 *  every one of which means "nothing this caller may claim it wrote". */
export function dirtyPaths(projectDir: string): string[] {
  if (!isGitRepo(projectDir)) return [];
  return porcelainPaths(git(projectDir, ['status', '--porcelain', '-z'], { allowFail: true, raw: true }));
}

function porcelainPaths(out: string): string[] {
  const entries = out.split('\0');
  const paths: string[] = [];
  for (let i = 0; i < entries.length; i++) if (entries[i]) { paths.push(entries[i]!.slice(3)); if (/^[RC]/.test(entries[i]!)) i++; } // R/C: next -z field is the source
  return paths;
}

export function commitStudioChange(projectDir: string, message: string, paths?: string[]): boolean {
  if (!isGitRepo(projectDir)) return false;
  // An EMPTY explicit list means "this caller wrote nothing", never "take
  // everything" — bead forge-npp3. The old `paths && paths.length > 0` fell
  // through to `add -A` on `[]`, so a caller that correctly computed it had
  // written nothing got the sweep it was trying to avoid. #608's call site
  // needed a `length > 0` guard at the call site for exactly this reason; the
  // footgun belongs here, where every caller is protected at once.
  if (paths !== undefined && paths.length === 0) return false;
  ensureStudioBranch(projectDir);
  if (paths !== undefined) {
    git(projectDir, ['add', '--', ...paths], { allowFail: true });
    // ls-files lists only files that exist, so a move's deleted source never
    // shows here; an existing-but-ignored listed path does.
    const ignored = git(projectDir, ['ls-files', '--others', '--ignored', '--exclude-standard', '--', ...paths], { allowFail: true })
      .split('\n').filter(Boolean);
    const stillIgnored = paths.filter((p) => ignored.some((f) => f === p || f.startsWith(`${p.replace(/\/$/, '')}/`)));
    if (stillIgnored.length > 0) throw new StudioWritePathIgnoredError(stillIgnored);
  } else {
    git(projectDir, ['add', '-A', '--', '.', ...SCRATCH_EXCLUDES.map((s) => `:(exclude)${s}`)], { allowFail: true });
  }
  const staged = git(projectDir, ['diff', '--cached', '--name-only'], { allowFail: true });
  if (!staged) return false;
  git(projectDir, [...gitIdentityConfigArgs(ORCHESTRATOR_GIT_IDENTITY), 'commit', '--no-verify', '-m', message]);
  return true;
}

/**
 * Run a synchronous write against the project repo, committed to `forge-studio`.
 * Ensures the branch first so the write lands there, runs `applyFn`, then commits.
 */
export function withStudioWrite<T>(projectDir: string, message: string, applyFn: () => T, paths?: string[]): T {
  ensureStudioBranch(projectDir);
  const result = applyFn();
  commitStudioChange(projectDir, message, paths);
  return result;
}

/** The contract files a cycle branching from origin/main must see — config (C1),
 *  scratch ignores (C2), instructions (C8), roadmap (C4). A Save refuses while any
 *  is uncommitted (forge-mfv5.1.12). */
export const CONTRACT_PATHS: readonly string[] = ['.forge/project.json', '.gitignore', 'AGENTS.md', 'roadmap.md'];

/** Uncommitted contract files, sorted, untracked dirs expanded. Throws when git
 *  cannot answer — an unreadable tree is never read as clean (§6.15). */
export function uncommittedContractPaths(projectDir: string): string[] {
  if (!isGitRepo(projectDir)) return [];
  return porcelainPaths(git(projectDir, ['status', '--porcelain', '-z', '--untracked-files=all', '--', ...CONTRACT_PATHS], { raw: true })).sort();
}

/** A forge-studio transaction around a write whose paths are unknown in advance (an
 *  agent run): on forge-studio first; `commit` stages only what became dirty since
 *  — what was dirty before is not this write's (forge-npp3). No-op for a non-git dir. */
export function beginStudioTransaction(projectDir: string): { commit: (message: string) => boolean } {
  if (!isGitRepo(projectDir)) return { commit: () => false };
  ensureStudioBranch(projectDir);
  // Files, not collapsed dirs: a new dir holding an ignored file must not trip
  // StudioWritePathIgnoredError, and a pre-dirty dir must not mask new files in it.
  const dirtyFiles = () => porcelainPaths(git(projectDir, ['status', '--porcelain', '-z', '--untracked-files=all'], { raw: true }));
  const pre = new Set(dirtyFiles());
  return { commit: (message) => commitStudioChange(projectDir, message, dirtyFiles().filter((p) => !pre.has(p))) };
}
