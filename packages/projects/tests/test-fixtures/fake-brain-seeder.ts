/**
 * Test double for the `ProjectBrainSeeder` port `scaffoldGreenfieldProject`
 * takes (`../../project-create.ts`). `projects` (rank 2) may not import
 * `@forge/knowledge` (same rank) — and `scripts/check-boundaries.mjs` cruises
 * every file under a package's own `tests/` dir as that package too, so this
 * fixture can't reach for the real `seedProjectBrain` /
 * `checkProjectBrainSeedContainment` either. The real wiring is proven
 * separately, end-to-end, by `apps/forge/tests/unit/cli-create.test.ts`'s
 * "hard-green scaffold" case (`runCreate` → `@forge/cli.ts`, which injects the
 * real pair) — an assembly point that may import both packages.
 *
 * This fake stays faithful enough to keep every existing project-create
 * regression meaningful:
 *   - the SAME two-phase check-then-write shape, against the SAME three
 *     targets (`kb.yaml`, `profile.md`, `themes/README.md` under
 *     `brain/projects/<dirName>/`), idempotent per file;
 *   - containment is verified with the REAL `resolveGuardedPath` from
 *     `@forge/kernel` (rank 1 — `projects` may import it) — the actual
 *     primitive the production seeder itself calls, not a re-implementation
 *     of it — so a planted symlink/hardlink escape is rejected exactly as
 *     production would reject it;
 *   - every write is a genuine `writeFileSync`, so a caller that chmods a
 *     target directory read-only still gets a real EACCES, for the same OS
 *     reason the production seeder's write would throw one.
 * File CONTENT is a placeholder — no project-create test asserts on
 * kb.yaml/profile.md's actual shape, only on presence and on throw/unwind
 * behaviour (that shape is `packages/knowledge/tests/unit/project-brain-seed.test.ts`'s
 * job, against the real function).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveGuardedPath, PathGuardContainmentError } from '@forge/kernel';
import type { ProjectBrainSeeder } from '../../project-create.ts';

type SeedTarget = { segments: string[]; absPath: string };

function seedTargets(forgeRoot: string, dirName: string): { brainProjectsRoot: string; brainDir: string; targets: SeedTarget[] } {
  const brainProjectsRoot = join(forgeRoot, 'brain', 'projects');
  const brainDir = join(brainProjectsRoot, dirName);
  return {
    brainProjectsRoot,
    brainDir,
    targets: [
      { segments: [dirName, 'kb.yaml'], absPath: join(brainDir, 'kb.yaml') },
      { segments: [dirName, 'profile.md'], absPath: join(brainDir, 'profile.md') },
      { segments: [dirName, 'themes', 'README.md'], absPath: join(brainDir, 'themes', 'README.md') },
    ],
  };
}

function checkContainment(forgeRoot: string, projectId: string, dirName: string = projectId): void {
  const { brainProjectsRoot, targets } = seedTargets(forgeRoot, dirName);
  mkdirSync(brainProjectsRoot, { recursive: true });
  for (const target of targets) {
    if (existsSync(target.absPath)) continue; // already there — idempotent skip
    const guard = resolveGuardedPath(brainProjectsRoot, target.segments);
    if (!guard.ok) {
      throw new PathGuardContainmentError(`fakeBrainSeeder: containment check failed for "${target.segments.join('/')}"`);
    }
  }
}

function seed(
  forgeRoot: string,
  projectId: string,
  name: string,
  opts: { dirName?: string } = {},
): { projectId: string; brainDir: string; files: { path: string; action: 'created' | 'skipped-existing' }[] } {
  const dirName = opts.dirName ?? projectId;
  checkContainment(forgeRoot, projectId, dirName);

  const { brainProjectsRoot, brainDir, targets } = seedTargets(forgeRoot, dirName);
  const files: { path: string; action: 'created' | 'skipped-existing' }[] = [];
  for (const target of targets) {
    if (existsSync(target.absPath)) {
      files.push({ path: target.absPath, action: 'skipped-existing' });
      continue;
    }
    const guard = resolveGuardedPath(brainProjectsRoot, target.segments);
    if (!guard.ok) {
      throw new PathGuardContainmentError(`fakeBrainSeeder: containment check failed for "${target.segments.join('/')}"`);
    }
    mkdirSync(dirname(guard.realPath), { recursive: true });
    writeFileSync(guard.realPath, `id: ${projectId}\nname: ${name}\n`, 'utf8');
    files.push({ path: target.absPath, action: 'created' });
  }
  return { projectId, brainDir, files };
}

/** Drop-in `ProjectBrainSeeder` for any test that calls `scaffoldGreenfieldProject`
 *  directly (never asserts call args — for that, use a recording spy instead). */
export const FAKE_BRAIN_SEEDER: ProjectBrainSeeder = { seed, checkContainment };
