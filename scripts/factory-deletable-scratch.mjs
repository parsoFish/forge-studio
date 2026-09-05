/**
 * The scratch worktree the deletability proof runs in (bead forge-8vfn.6.10.21).
 *
 * WHY THIS EXISTS. The first shape of `factory-deletable.mjs` deleted
 * `packages/factory` and `node_modules/@forge/factory` IN PLACE. CI's checkout
 * is ephemeral so CI was fine — but `gate.sh` replicates every `ci.yml` step in
 * the worktree it is handed, and that worktree persists: one green gate left it
 * with no example package, and the NEXT gate failed the build, 32 tests and
 * four guards on empty populations. A proof that destroys the thing it is run
 * against is not a proof, it is a trap with a receipt.
 *
 * So the deletion happens in a throwaway `git worktree`, and the caller's tree
 * is asserted untouched either side of it.
 *
 * THE NODE_MODULES PROBLEM, and why the obvious answer is wrong. A fresh
 * worktree has no `node_modules`, and symlinking the root's whole tree in would
 * defeat the point: `@forge/factory` would resolve through it to the ROOT's
 * still-present package, and the proof would pass while proving nothing. So the
 * scratch gets its OWN `node_modules` directory: every third-party entry is a
 * symlink to the root's copy (cheap, and they are identical by definition),
 * while `@forge/*` is rebuilt from the root's own RELATIVE link targets so each
 * one points at the SCRATCH tree's packages — and `@forge/factory` is simply
 * not created. That is the deletion, expressed as an absence.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** `git status --porcelain` for one pathspec, trimmed. */
export function porcelain(root, pathspec) {
  return execFileSync('git', ['-C', root, 'status', '--porcelain', '--', pathspec], { encoding: 'utf8' }).trim();
}

/**
 * Create a throwaway worktree of `root`'s HEAD with a `node_modules` that
 * resolves `@forge/*` INTO IT — minus `packages/factory`, which is deleted
 * there and linked nowhere.
 *
 * @returns {{ dir: string, cleanup: () => void }}
 */
export function createFactorylessWorktree(root) {
  const dir = mkdtempSync(join(tmpdir(), 'factory-deletable-'));
  // mkdtemp made it; `git worktree add` wants to make it itself.
  rmSync(dir, { recursive: true, force: true });
  execFileSync('git', ['-C', root, 'worktree', 'add', '--detach', dir, 'HEAD'], { stdio: 'pipe' });

  const cleanup = () => {
    try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', dir], { stdio: 'pipe' }); } catch { /* best effort */ }
    rmSync(dir, { recursive: true, force: true });
  };

  try {
    rmSync(join(dir, 'packages', 'factory'), { recursive: true, force: true });

    const rootModules = join(root, 'node_modules');
    const scratchModules = join(dir, 'node_modules');
    mkdirSync(scratchModules, { recursive: true });
    for (const entry of readdirSync(rootModules)) {
      if (entry === '@forge') continue;
      symlinkSync(join(rootModules, entry), join(scratchModules, entry));
    }
    mkdirSync(join(scratchModules, '@forge'));
    for (const pkg of readdirSync(join(rootModules, '@forge'))) {
      if (pkg === 'factory') continue;
      // The root's link targets are RELATIVE (`../../packages/kernel`,
      // `../../apps/forge`), and the scratch link sits at the same depth — so
      // copying the target verbatim points it at the SCRATCH tree, which is the
      // whole trick.
      symlinkSync(readlinkSync(join(rootModules, '@forge', pkg)), join(scratchModules, '@forge', pkg));
    }
  } catch (err) {
    cleanup();
    throw err;
  }

  return { dir, cleanup };
}

/** True when the worktree at `dir` has no example package and no link to one. */
export function isFactoryless(dir) {
  return !existsSync(join(dir, 'packages', 'factory')) && !existsSync(join(dir, 'node_modules', '@forge', 'factory'));
}
