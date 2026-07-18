/**
 * File-based initiative queue (per ADR 011).
 *
 * State machine via directory rename:
 *   _queue/pending → in-flight → ready-for-review → merged → done
 *                      ↓
 *                   failed
 *
 * `merged` (R4-11-F1) is a transient pass-through, NOT a parking state: a
 * confirmed PR merge lands an initiative in `merged/`, then the existing
 * finalize→reflector chain transits it to `done/` in the SAME sweep (see
 * `orchestrator/finalize-merged.ts`). It is never left sitting in `merged/`
 * across ticks. NOTE: the string `'merged'` is also an unrelated
 * `CycleOutcome`/`CycleResult.status` *value* (`orchestrator/cycle-context.ts`)
 * — that's an event outcome, not this queue directory. Don't conflate them.
 *
 * Atomicity: `rename` on a single filesystem is atomic. That is the entire
 * claim mechanism.
 *
 * Recovery: on serve startup, sweep in-flight for stale heartbeats and
 * missing worktrees; move them back to pending.
 */

import {
  readdirSync,
  renameSync,
  existsSync,
  statSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { parseManifest } from './manifest.ts';

export type QueueState =
  | 'pending'
  | 'in-flight'
  | 'ready-for-review'
  | 'merged'
  | 'done'
  | 'failed';

export type QueuePaths = {
  root: string;
  pending: string;
  inFlight: string;
  readyForReview: string;
  merged: string;
  done: string;
  failed: string;
};

export function getPaths(queueRoot = '_queue'): QueuePaths {
  const root = resolve(queueRoot);
  return {
    root,
    pending: join(root, 'pending'),
    inFlight: join(root, 'in-flight'),
    readyForReview: join(root, 'ready-for-review'),
    merged: join(root, 'merged'),
    done: join(root, 'done'),
    failed: join(root, 'failed'),
  };
}

export function listPending(paths = getPaths()): string[] {
  if (!existsSync(paths.pending)) return [];
  return readdirSync(paths.pending)
    .filter((f) => f.endsWith('.md'))
    .sort();
}

export function listInFlight(paths = getPaths()): string[] {
  if (!existsSync(paths.inFlight)) return [];
  return readdirSync(paths.inFlight).filter((f) => f.endsWith('.md'));
}

export function counts(paths = getPaths()): Record<QueueState, number> {
  return {
    pending: safeCount(paths.pending),
    'in-flight': safeCount(paths.inFlight),
    'ready-for-review': safeCount(paths.readyForReview),
    merged: safeCount(paths.merged),
    done: safeCount(paths.done),
    failed: safeCount(paths.failed),
  };
}

function safeCount(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((f) => f.endsWith('.md')).length;
}

/**
 * Atomically claim a pending initiative by `rename`. Returns the new in-flight
 * path, or `null` if the file is no longer in pending (claimed by a
 * concurrent caller).
 */
export function claim(filename: string, paths = getPaths()): string | null {
  const from = join(paths.pending, filename);
  const to = join(paths.inFlight, filename);
  try {
    renameSync(from, to);
  } catch {
    return null;
  }
  writeHeartbeat(filename, paths);
  return to;
}

/**
 * Move a manifest from `_queue/in-flight/` to another terminal directory.
 * F-27 widened the target set to include `pending` so the scheduler can
 * auto-retry recoverable failures by sending them back to the front of the
 * queue. `pending` is unique in that it's also the *initial* state — the
 * caller (scheduler) is responsible for incrementing retry_count first so
 * the same manifest doesn't oscillate between in-flight ↔ pending forever.
 */
export function moveTo(
  filename: string,
  toState: Exclude<QueueState, 'in-flight'>,
  paths = getPaths(),
): string {
  const from = join(paths.inFlight, filename);
  const to = join(paths[toStateKey(toState)], filename);
  renameSync(from, to);
  // Clean up the heartbeat that lived alongside the manifest in in-flight.
  const hbPath = join(paths.inFlight, filename + '.heartbeat');
  if (existsSync(hbPath)) unlinkSync(hbPath);
  return to;
}

/**
 * Promote a manifest already sitting in `_queue/merged/` on to `_queue/done/`.
 * R4-11-F1: `merged` is a transient pass-through, never a parking state —
 * `orchestrator/phases/closure.ts` (the single terminal-move authority) is the
 * only caller, invoked in the SAME sweep as the `→merged` move (right after
 * firing reflection, success or lost). Distinct from `moveTo` (which always
 * sources from `in-flight/` and clears a heartbeat) because this move sources
 * from `merged/`, where no heartbeat ever lived.
 */
export function promoteMergedToDone(filename: string, paths = getPaths()): string {
  const from = join(paths.merged, filename);
  const to = join(paths.done, filename);
  renameSync(from, to);
  return to;
}

function toStateKey(state: Exclude<QueueState, 'in-flight'>): keyof QueuePaths {
  switch (state) {
    case 'pending':
      return 'pending';
    case 'ready-for-review':
      return 'readyForReview';
    case 'merged':
      return 'merged';
    case 'done':
      return 'done';
    case 'failed':
      return 'failed';
  }
}

export function writeHeartbeat(filename: string, paths = getPaths()): void {
  const hbPath = join(paths.inFlight, filename + '.heartbeat');
  writeFileSync(hbPath, new Date().toISOString());
}

export type RecoveryResult = {
  recovered: string[];
  reason: 'stale-heartbeat' | 'missing-worktree';
};

/**
 * Sweep in-flight for stale heartbeats and missing worktrees. Returns the
 * filenames that were moved back to pending.
 */
export function recover(opts: {
  paths?: QueuePaths;
  staleHeartbeatMs?: number;
  worktreeExists?: (workTreePath: string) => boolean;
} = {}): RecoveryResult[] {
  const paths = opts.paths ?? getPaths();
  const staleMs = opts.staleHeartbeatMs ?? 5 * 60 * 1000;
  const wtExists = opts.worktreeExists ?? ((p: string) => existsSync(p));

  const stale: string[] = [];
  const missing: string[] = [];

  for (const filename of listInFlight(paths)) {
    const hbPath = join(paths.inFlight, filename + '.heartbeat');
    const manifestPath = join(paths.inFlight, filename);

    // Stale-heartbeat sweep
    if (existsSync(hbPath)) {
      const age = Date.now() - statSync(hbPath).mtimeMs;
      if (age > staleMs) {
        renameSync(manifestPath, join(paths.pending, filename));
        stale.push(filename);
        continue;
      }
    }

    // Missing-worktree sweep
    const worktreePath = parseWorktreePath(manifestPath);
    if (worktreePath && !wtExists(worktreePath)) {
      renameSync(manifestPath, join(paths.pending, filename));
      missing.push(filename);
    }
  }

  const out: RecoveryResult[] = [];
  if (stale.length) out.push({ recovered: stale, reason: 'stale-heartbeat' });
  if (missing.length) out.push({ recovered: missing, reason: 'missing-worktree' });
  return out;
}

/**
 * Parse the `worktree_path` field from a manifest using the canonical parser.
 * Returns null if the file is missing, malformed, or has no worktree_path.
 */
function parseWorktreePath(manifestPath: string): string | null {
  if (!existsSync(manifestPath)) return null;
  try {
    const m = parseManifest(readFileSync(manifestPath, 'utf8'));
    return m.worktree_path ?? null;
  } catch {
    return null;
  }
}
