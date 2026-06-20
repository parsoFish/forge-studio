/**
 * Demo worktree helpers used by `forge demo capture`.
 *
 * The heavy Playwright-spec-author stack (generateComparisonDemo, DemoManifest,
 * loadDemoManifest, buildComparisonModel, demo-runtime.ts) was removed in the
 * REV-2 cull. What remains is the thin capture path:
 *   1. Materialise two git worktrees (baseline + changed).
 *   2. buildTree + startServer each (from demo-runtime.ts).
 *   3. Take ONE screenshot per checkpoint label → before/<label>.png + after/<label>.png.
 *   4. demo-model.ts collectCapturedMedia/mergeCapturedMedia back-fills demo.json.
 *
 * Testable helpers (materialiseWorktree / cleanupWorktreeAt / imageToDataUri)
 * are exported and unit-tested. The heavy capture path (captureCheckpoints) is
 * side-effecting and validated via the live trafficGame run.
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

import { MAX_INLINE_IMAGE_BYTES } from './demo-types.ts';

export type WorktreeAtRef = { path: string; repo: string };

/**
 * `git worktree add --detach <path> <ref>` — materialise a tree at any ref
 * (branch, tag, sha). Detached so we never mutate or need a scratch branch.
 * Throws if the ref is unknown or the path is occupied (caller decides).
 */
export function materialiseWorktree(repo: string, ref: string, path: string): WorktreeAtRef {
  if (!existsSync(resolve(repo, '.git'))) {
    throw new Error(`materialiseWorktree: ${repo} is not a git repository`);
  }
  mkdirSync(resolve(path, '..'), { recursive: true });
  execFileSync('git', ['-C', repo, 'worktree', 'add', '--detach', path, ref], {
    stdio: 'pipe',
  });
  return { path, repo };
}

/**
 * Tear down a detached demo worktree. Idempotent and best-effort — a
 * missing worktree is fine. No branch to delete (detached).
 */
export function cleanupWorktreeAt(handle: WorktreeAtRef): void {
  try {
    execFileSync('git', ['-C', handle.repo, 'worktree', 'remove', '--force', handle.path], {
      stdio: 'pipe',
    });
  } catch {
    /* already gone */
  }
  try {
    execFileSync('git', ['-C', handle.repo, 'worktree', 'prune'], { stdio: 'pipe' });
  } catch {
    /* non-fatal */
  }
  if (existsSync(handle.path)) {
    try {
      rmSync(handle.path, { recursive: true, force: true });
    } catch {
      /* non-fatal */
    }
  }
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function imageMime(file: string): string {
  if (file.endsWith('.jpg') || file.endsWith('.jpeg')) return 'image/jpeg';
  if (file.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}


/** Read an image file into a base64 data URI; null if unreadable or > cap. */
export function imageToDataUri(file: string): string | null {
  try {
    const b = readFileSync(file);
    if (b.length > MAX_INLINE_IMAGE_BYTES) {
      process.stderr.write(
        `[demo] ${file} is ${(b.length / 1048576).toFixed(1)} MB (> ${
          MAX_INLINE_IMAGE_BYTES / 1048576
        } MB cap) — omitting from the self-contained report\n`,
      );
      return null;
    }
    return `data:${imageMime(file)};base64,${b.toString('base64')}`;
  } catch {
    return null;
  }
}

export { IMAGE_EXTS };

// ---------------------------------------------------------------------------
// Thin capture orchestrator (live-validated, not unit-tested — same split as cycle.ts)
// ---------------------------------------------------------------------------

export type CaptureCheckpointsInput = {
  projectRepoPath: string;
  project: string;
  baseRef: string;
  changedRef: string;
  /** Directory where before/<label>.png + after/<label>.png are written. */
  bundleDir: string;
  initiativeId?: string;
  /** Labels to screenshot — each yields before/<label>.png + after/<label>.png. */
  checkpointLabels: string[];
  /** Build before serving (slower) vs dev-server only. */
  build?: boolean;
};

export type CaptureCheckpointsResult = {
  capturedBefore: string[];
  capturedAfter: string[];
};

/**
 * Thin capture: materialise baseline + changed worktrees, build + serve each,
 * take ONE screenshot per label → before/<label>.png + after/<label>.png.
 * Best-effort: missing labels degrade to no capture (no throws). Always cleans
 * up worktrees. Side-effecting — validated via the live run.
 */
export async function captureCheckpoints(
  input: CaptureCheckpointsInput,
): Promise<CaptureCheckpointsResult> {
  const { buildTree, startServer } = await import('./demo-runtime.ts');
  const { screenshotUrl } = await import('./demo-capture.ts');

  const bundleDir = resolve(input.bundleDir);
  const beforeDir = join(bundleDir, 'before');
  const afterDir = join(bundleDir, 'after');
  for (const d of [bundleDir, beforeDir, afterDir]) mkdirSync(d, { recursive: true });

  const wtRoot = join(bundleDir, '_trees');
  const baselineWt: WorktreeAtRef = { path: join(wtRoot, 'before'), repo: input.projectRepoPath };
  const changedWt: WorktreeAtRef = { path: join(wtRoot, 'after'), repo: input.projectRepoPath };
  cleanupWorktreeAt(baselineWt);
  cleanupWorktreeAt(changedWt);

  const capturedBefore: string[] = [];
  const capturedAfter: string[] = [];

  try {
    materialiseWorktree(input.projectRepoPath, input.baseRef, baselineWt.path);
    materialiseWorktree(input.projectRepoPath, input.changedRef, changedWt.path);

    for (const [wt, capDir, side] of [
      [baselineWt, beforeDir, 'before'],
      [changedWt, afterDir, 'after'],
    ] as const) {
      const status = buildTree(wt.path, input.build ?? false);
      if (!status.ok) continue;

      const server = await startServer(wt.path);
      if (!server) continue;
      try {
        for (const label of input.checkpointLabels) {
          const outPath = join(capDir, `${label}.png`);
          const ok = await screenshotUrl(server.url, outPath);
          if (ok) {
            if (side === 'before') capturedBefore.push(label);
            else capturedAfter.push(label);
          }
        }
      } finally {
        await server.stop();
      }
    }
  } finally {
    cleanupWorktreeAt(baselineWt);
    cleanupWorktreeAt(changedWt);
  }

  return { capturedBefore, capturedAfter };
}

// Re-export the shared demo types so callers depend on one module surface.
export type { DemoBuildStatus, HarnessMetricRow } from './demo-types.ts';
