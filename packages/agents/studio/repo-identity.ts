/**
 * repo-identity.ts — resolves a directory's git repository IDENTITY (the
 * repo's `.git` COMMON dir), the real-filesystem half of the forge-repo-git
 * fence (bead `forge-8vfn.8.5.44`, row 208 — see
 * `packages/kernel/forge-repo-git-fence.ts`'s header for the full ruling and
 * why identity, not a path prefix, decides "is this the forge repo").
 *
 * EVERY WORKTREE OF ONE REPOSITORY SHARES EXACTLY ONE COMMON DIR. The main
 * checkout's `.git` IS its own common dir; a LINKED worktree's `.git` is a
 * FILE naming a per-worktree gitdir under the main repo's
 * `.git/worktrees/<name>/`, and that gitdir carries a `commondir` file
 * pointing back at the main repo's real `.git` — so resolving a linked
 * worktree all the way through `commondir` and a plain checkout's bare
 * `.git` both land on the SAME path. Comparing that path (not the directory
 * the caller started from) is what lets the fence catch `cd
 * /home/parso/forge && git update-ref …` from a forgeRoot of
 * `/home/parso/forge-m7-e-docs` — lexically unrelated paths, identical repo.
 *
 * This module does ALL the filesystem work the kernel fence refuses to do
 * (that module stays dependency-free and directly unit-testable); THIS
 * module's own tests (`repo-identity.test.ts`) exercise it against real
 * temp repos, including a real `git worktree add`.
 */
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve as resolvePath } from 'node:path';

/**
 * Resolve `dir`'s git common dir, or `null` when `dir` is not inside any git
 * repository this function can identify, or resolution fails for ANY reason
 * (a permission error, a malformed `.git` file, a dangling `gitdir:`
 * target …) — conservative by construction: a caller that cannot prove two
 * directories are DIFFERENT repos must treat them as possibly the same one
 * (`decideForgeRepoGit`'s own rule), so this never guesses an identity it
 * could not actually verify.
 *
 * Walks up from `dir` (git's own discovery algorithm, `GIT_CEILING_DIRECTORIES`
 * aside) looking for a `.git` entry at each ancestor:
 *   - a DIRECTORY `.git` IS the common dir (the main worktree, or any
 *     ordinary non-worktree repo).
 *   - a FILE `.git` holds `gitdir: <path>` (relative to the `.git` file's own
 *     directory unless `<path>` is absolute). That gitdir's OWN `commondir`
 *     file, when present, names the real common dir (relative to the
 *     gitdir) — a LINKED worktree always carries one. A gitdir with no
 *     `commondir` file IS the common dir itself (e.g. a submodule's
 *     redirect).
 * Every resolved path is `realpathSync`'d, so two differently-SPELLED routes
 * to the same repo (a symlinked worktree, a `gitdir:` line with `..`
 * segments) always compare equal.
 */
export function resolveRepoCommonDir(dir: string): string | null {
  let probe = resolvePath(dir);
  for (;;) {
    const gitPath = join(probe, '.git');
    let isDir: boolean;
    try {
      isDir = statSync(gitPath).isDirectory();
    } catch {
      const parent = dirname(probe);
      if (parent === probe) return null; // reached the filesystem root — never inside a repo
      probe = parent;
      continue;
    }
    try {
      if (isDir) return realpathSync(gitPath);
      const match = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(gitPath, 'utf8'));
      if (!match) return null;
      const gitDir = isAbsolute(match[1]!) ? match[1]! : resolvePath(probe, match[1]!);
      let commonDir = gitDir;
      try {
        const raw = readFileSync(join(gitDir, 'commondir'), 'utf8').trim();
        commonDir = isAbsolute(raw) ? raw : resolvePath(gitDir, raw);
      } catch {
        /* no `commondir` file — a non-worktree gitdir redirect IS the common dir */
      }
      return realpathSync(commonDir);
    } catch {
      return null;
    }
  }
}

/**
 * Memoising wrapper, keyed by the EXACT string passed (never re-normalised —
 * every caller already hands this an absolute, resolved path). `forgeRoot`
 * is looked up on every single Bash tool call the forge-repo-git fence
 * judges within one run, and its identity cannot change while the process
 * that resolved it is alive, so re-walking its `.git` chain on every call is
 * pure waste. Process-lifetime, not per-run: there is no per-run boundary
 * this module can observe, and a process restart is the natural cache reset.
 */
const cache = new Map<string, string | null>();
export function cachedRepoCommonDir(dir: string): string | null {
  if (!cache.has(dir)) cache.set(dir, resolveRepoCommonDir(dir));
  return cache.get(dir)!;
}
