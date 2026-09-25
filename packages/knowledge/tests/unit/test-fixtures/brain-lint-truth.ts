/**
 * Shared fixtures for the brain-lint TRUTHFULNESS-AXIS suite
 * (`brain-lint-truth.test.ts` + `brain-lint-truth-history.test.ts`, split at
 * the 800-line cap — mirrors why `./brain-lint.ts` exists for the structural
 * checks' own suite).
 *
 * Local to the truth axis (not merged into `./brain-lint.ts`, the STRUCTURAL
 * suite's shared fixtures): these write `status:`/`category:`/`evidence:`
 * frontmatter and real git checkouts that `ThemeSpec`/`buildBrainFixture`
 * over there don't model, and per that file's own header comment a fixture
 * used by only the files that need it belongs with them, not the shared one.
 * `buildBrainFixture`/`cleanup` (the brain/INDEX.md/themes-dir scaffold)
 * still come from `./brain-lint.ts` — both truth-axis test files import that
 * ONE, never re-derive it.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

/** Inline-code backtick, spelled out once so a body string with several
 *  spans doesn't fight template-literal escaping. */
export const BT = '`';

/** Write one project-brain theme with `status:`/`category:`/`evidence:`
 *  frontmatter (a `pattern` category default keeps every existing call site
 *  unchanged), at `<root>/brain/projects/<project>/themes/<slug>.md`. */
export function writeTruthTheme(
  root: string,
  project: string,
  slug: string,
  opts: { status?: 'current' | 'historical'; category?: string; evidence?: string[]; body?: string } = {},
): string {
  const dir = join(root, 'brain', 'projects', project, 'themes');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${slug}.md`);
  const lines = [
    '---',
    `title: ${slug}`,
    'description: description text.',
    `category: ${opts.category ?? 'pattern'}`,
    'created_at: 2026-01-01T00:00:00Z',
    'updated_at: 2026-01-01T00:00:00Z',
  ];
  if (opts.status) lines.push(`status: ${opts.status}`);
  if (opts.evidence) lines.push(`evidence: [${opts.evidence.map((e) => JSON.stringify(e)).join(', ')}]`);
  lines.push('---', '', opts.body ?? '# theme body\n');
  writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

/** Create one file inside a managed project's ground clone,
 *  `<root>/projects/<project>/<relPath>` — a sibling of `<root>/brain/`. Only
 *  meaningful for a PRESENT reference (existsSync alone decides that case) —
 *  an ABSENT-but-once-real reference needs `gitCheckout` below instead, per
 *  the T2 fix-round-2 ruling (stale requires git history, not just a plain
 *  filesystem gap). */
export function writeCheckoutFile(root: string, project: string, relPath: string): void {
  const file = join(root, 'projects', project, relPath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, 'placeholder\n');
}

/** Fixed identity/date env for every fixture commit below — deterministic,
 *  independent of the sandbox's global git config, no clock-dependent SHAs. */
const GIT_FIXTURE_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'brain-lint-truth-fixture',
  GIT_AUTHOR_EMAIL: 'brain-lint-truth-fixture@example.invalid',
  GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
  GIT_COMMITTER_NAME: 'brain-lint-truth-fixture',
  GIT_COMMITTER_EMAIL: 'brain-lint-truth-fixture@example.invalid',
  GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
};

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, env: GIT_FIXTURE_ENV, stdio: 'pipe' });
}

/**
 * T2 fix-round-2 ruling: "stale" now requires GIT HISTORY, not just a plain
 * filesystem gap — `git -C <checkout> log --all -- <ref>` must find the path
 * on some ref. This turns `<root>/projects/<project>` into a REAL git repo:
 * writes `files` (path -> content), `git add`s them BY NAME (never `-A`,
 * matching the repo's own standing git-safety rule), commits once on `main`
 * with the fixed identity/date above, then deletes `deleteAfterCommit` from
 * the WORKING TREE only (the deletion itself is never committed — `git log
 * --all -- <ref>` finds the file via the commit that ADDED it regardless of
 * whether its removal was ever committed, so committing the delete would add
 * nothing this suite needs). Returns the checkout's absolute path.
 */
export function gitCheckout(
  root: string,
  project: string,
  files: Record<string, string>,
  opts: { deleteAfterCommit?: string[] } = {},
): string {
  const checkoutRoot = join(root, 'projects', project);
  mkdirSync(checkoutRoot, { recursive: true });
  git(checkoutRoot, ['init', '-q', '-b', 'main']);
  const paths = Object.keys(files);
  for (const p of paths) {
    const file = join(checkoutRoot, p);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, files[p]);
  }
  if (paths.length > 0) {
    git(checkoutRoot, ['add', ...paths]);
    git(checkoutRoot, ['commit', '-q', '-m', 'fixture commit']);
  }
  for (const p of opts.deleteAfterCommit ?? []) {
    rmSync(join(checkoutRoot, p));
  }
  return checkoutRoot;
}

/**
 * The "present only on an unmerged branch" shape: commits `filePath` on a
 * throwaway side branch that is NEVER merged back to `main`, then returns to
 * `main` (which never had the file). `git log --all` scans every ref —
 * including a branch that was never checked out again — so this still counts
 * as "once tracked" per the T2 ruling, even though `main`'s own working tree
 * and its own linear history never contained the file. `checkoutRoot` must
 * already be a `gitCheckout`-initialised repo with at least one commit on
 * `main` (so `checkout -b`/`checkout main` have a branch to work from).
 */
export function gitCommitOnSideBranchOnly(checkoutRoot: string, filePath: string, content: string): void {
  git(checkoutRoot, ['checkout', '-q', '-b', 'side-branch']);
  const file = join(checkoutRoot, filePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  git(checkoutRoot, ['add', filePath]);
  git(checkoutRoot, ['commit', '-q', '-m', 'side-branch-only fixture commit']);
  git(checkoutRoot, ['checkout', '-q', 'main']);
}
