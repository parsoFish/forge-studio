/**
 * Shared brain-mask plumbing for bench harnesses that run an agent which may
 * write into `brain/`.
 *
 * Lifted verbatim from `benchmarks/reflection/sdk.ts` (Phase 5 / 5.1) so both
 * the reflection bench and the chained sequencer share one masking
 * implementation. Logic is UNCHANGED — only relocated. `FORGE_ROOT` resolves
 * to the same path: `_lib/` and `reflection/` are siblings under
 * `benchmarks/`, so `../..` reaches the forge root from either.
 *
 * Why mask: a bench symlinks the live `brain/` tree into its tempdir so the
 * agent can navigate it read-through. New theme files written under
 * `<tempdir>/brain/projects/<n>/themes/` would otherwise land inside the
 * symlinked directory — i.e. touch the live brain. `layerBrain` replaces the
 * target project's `themes/` directory and `brain/_raw/cycles/` (plus
 * `brain/log.md`) with fresh writable dirs/files in the tempdir while
 * everything else read-throughs to the live brain.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

const FORGE_ROOT = resolve(import.meta.dirname, '..', '..');

/**
 * Layer brain/ in the tempdir so:
 *   - top-level files (INDEX.md, LINT.md, etc.) are symlinked to the live brain
 *   - top-level dirs (forge/, projects/) are mostly symlinked
 *   - EXCEPT: the target project's themes/ directory is a fresh empty dir in
 *     the tempdir (so theme writes land there, not in the live brain)
 *   - EXCEPT: brain/_raw/cycles/ is a fresh empty dir in the tempdir (so the
 *     cycle archive write lands there)
 *
 * The symlinks are read-through: the agent's `Read brain/forge/patterns.md`
 * resolves to the live file. Writes to a masked-out path land in the tempdir.
 */
export function layerBrain(tempdir: string, projectName: string): void {
  const liveBrain = resolve(FORGE_ROOT, 'brain');
  const benchBrain = resolve(tempdir, 'brain');
  mkdirSync(benchBrain, { recursive: true });

  // Symlink top-level entries except `projects/`, `_raw/`, and `log.md`
  // (the reflector appends to log.md per its SKILL.md; isolating it
  // prevents the bench run from polluting the live operations log).
  for (const entry of readdirSync(liveBrain, { withFileTypes: true })) {
    if (entry.name === 'projects' || entry.name === '_raw' || entry.name === 'log.md') continue;
    symlinkSync(resolve(liveBrain, entry.name), resolve(benchBrain, entry.name));
  }
  // Mask brain/log.md as a fresh empty file in the tempdir.
  writeFileSync(resolve(benchBrain, 'log.md'), '# Brain — Operations Log (bench tempdir)\n\n');

  // brain/projects/: layer per-project, masking the target project's themes/.
  const benchProjects = resolve(benchBrain, 'projects');
  mkdirSync(benchProjects, { recursive: true });
  const liveProjects = resolve(liveBrain, 'projects');
  if (existsSync(liveProjects)) {
    for (const entry of readdirSync(liveProjects, { withFileTypes: true })) {
      if (entry.name === projectName) {
        // Mask: write a layered project dir. Symlink everything except
        // themes/, which is a fresh empty dir.
        const benchProj = resolve(benchProjects, projectName);
        mkdirSync(benchProj, { recursive: true });
        const liveProj = resolve(liveProjects, projectName);
        for (const sub of readdirSync(liveProj, { withFileTypes: true })) {
          if (sub.name === 'themes') continue;
          symlinkSync(resolve(liveProj, sub.name), resolve(benchProj, sub.name));
        }
        // Fresh themes/ dir in the tempdir.
        mkdirSync(resolve(benchProj, 'themes'), { recursive: true });
      } else {
        // Other projects: pass through.
        symlinkSync(resolve(liveProjects, entry.name), resolve(benchProjects, entry.name));
      }
    }
  }
  // If the target project doesn't exist in the live brain, create it fresh.
  if (!existsSync(resolve(benchProjects, projectName))) {
    mkdirSync(resolve(benchProjects, projectName, 'themes'), { recursive: true });
  }

  // brain/_raw/: layer so cycles/ is fresh; pass through other subdirs.
  const benchRaw = resolve(benchBrain, '_raw');
  mkdirSync(benchRaw, { recursive: true });
  const liveRaw = resolve(liveBrain, '_raw');
  if (existsSync(liveRaw)) {
    for (const entry of readdirSync(liveRaw, { withFileTypes: true })) {
      if (entry.name === 'cycles') continue;
      symlinkSync(resolve(liveRaw, entry.name), resolve(benchRaw, entry.name));
    }
  }
  mkdirSync(resolve(benchRaw, 'cycles'), { recursive: true });
}
