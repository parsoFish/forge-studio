/**
 * bridge-cycle-scan — cycle/liveness derivation and the fs.watch signal
 * wiring `startBridge` uses to notice new cycle + session-checkpoint writes.
 *
 * forge-4zk: carved out of `apps/forge/ui-bridge.ts`'s `startBridge` body
 * (feature move, no behaviour change). Each function here is a
 * parameterised extraction of a closure that used to capture `startBridge`'s
 * locals directly — the two derivations (`scanCyclesFromDisk`,
 * `computeLivenessReport`) take `logsRoot`/`queuePaths` as plain arguments
 * instead of closing over them, and the two fs.watch helpers
 * (`watchDirsFlat`, `watchProjectSubdirs`) take an `onChange` callback
 * instead of closing over `broadcast`/`queueChangeCoalescer`/
 * `startTailsForLive`. `startBridge` still owns every watcher ARRAY
 * (`queueWatchers`/`architectWatchers`/`instructionsWatchers`/
 * `demoWatchers`) and `close()`'s cleanup of them; these two helpers only
 * build the `FSWatcher[]` each call site pushes into its own array.
 *
 * `watchProjectSubdirs` also DE-DUPLICATES `watchArchitect`/
 * `watchInstructions`/`watchDemo`, which were three byte-identical bodies
 * differing only in the sub-directory name and the broadcast payload
 * (`_architect`/architect-list-changed, `_instructions`/
 * instructions-list-changed, `_demo`/demo-list-changed) — same fs.watch
 * call, same recursive-then-non-recursive-fallback shape, same silent
 * catch. `watchQueue`'s own shape differs (a FIXED dir list, no
 * recursive/fallback, and TWO effects per change instead of one broadcast)
 * so it stays its own helper, `watchDirsFlat`.
 */
import { existsSync, readFileSync, readdirSync, statSync, watch as fsWatch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';

import { listInFlight, type QueuePaths } from '@forge/flows/queue.ts';
import { parseManifest } from '@forge/flows/manifest.ts';

/** Cap on how many terminal (non-live) cycles `scanCyclesFromDisk` surfaces —
 *  the UI's "recent" list, not a hard retention limit (frozen cycle logs are
 *  never deleted by this scan). */
const RECENT_CYCLES_MAX = 20;

export type Cycle = {
  cycleId: string;
  initiativeId: string;
  project?: string;
  // R4-11-F1: `merged` is the transient pass-through state a confirmed-merge
  // manifest briefly occupies between closure's two terminal moves (→merged,
  // then merged→done in the same sweep) — distinct from the unrelated
  // `CycleOutcome`/`CycleResult.status` `'merged'` VALUE (an event outcome).
  status: 'in-flight' | 'ready-for-review' | 'merged' | 'done' | 'failed' | 'pending';
  startedAt?: string;
  endedAt?: string;
  /** Feature #10: cross-initiative dependency edges (manifest
   *  `depends_on_initiatives`) — drives the UI's per-project roadmap spine. */
  dependsOnInitiatives?: string[];
};

/**
 * The cycle ID is the _logs/<dir> name (timestamp + initiative ID); the
 * queue dirs only carry status. This scan walks _logs/ first to build a
 * list of cycles (most-recent per initiative), then cross-references queue
 * dirs to label each with its current status.
 */
export function scanCyclesFromDisk(logsRoot: string, queuePaths: QueuePaths): { live: Cycle[]; recent: Cycle[] } {
  const live: Cycle[] = [];
  const recent: Cycle[] = [];

  type LogDirInfo = { cycleId: string; initiativeId: string; mtime: number };
  const latestPerInit = new Map<string, LogDirInfo>();
  if (existsSync(logsRoot)) {
    for (const name of readdirSync(logsRoot)) {
      const dir = join(logsRoot, name);
      let mtime = 0;
      try {
        if (!statSync(dir).isDirectory()) continue;
        mtime = statSync(dir).mtimeMs;
      } catch { continue; }
      // Cycle ID format: `<ISO-ish-timestamp>_<INIT-…>`.
      const m = name.match(/_(INIT-.+)$/);
      if (!m) continue;
      const initId = m[1];
      const cur = latestPerInit.get(initId);
      if (!cur || cur.mtime < mtime) {
        latestPerInit.set(initId, { cycleId: name, initiativeId: initId, mtime });
      }
    }
  }

  const queueStatusFor = (initId: string): { status: Cycle['status']; project?: string; dependsOnInitiatives?: string[] } | null => {
    const fn = `${initId}.md`;
    const lookups: Array<[string, Cycle['status']]> = [
      [queuePaths.inFlight, 'in-flight'],
      [queuePaths.readyForReview, 'ready-for-review'],
      // R4-11-F1: `merged` — the brief pass-through window between a
      // confirmed merge and its promotion to `done/` in the same sweep.
      [queuePaths.merged, 'merged'],
      [queuePaths.done, 'done'],
      [queuePaths.failed, 'failed'],
      [queuePaths.pending, 'pending'],
    ];
    for (const [dir, status] of lookups) {
      const fp = join(dir, fn);
      if (existsSync(fp)) {
        let project: string | undefined;
        let dependsOnInitiatives: string[] | undefined;
        try {
          const m = parseManifest(readFileSync(fp, 'utf8'));
          project = m.project;
          dependsOnInitiatives = m.depends_on_initiatives;
        } catch { /* ignore */ }
        return { status, project, dependsOnInitiatives };
      }
    }
    return null;
  };

  const candidates: Array<{ cycle: Cycle; mtime: number }> = [];
  for (const info of latestPerInit.values()) {
    const q = queueStatusFor(info.initiativeId);
    if (!q) continue; // log dir exists but the queue manifest is gone — orphan, skip
    candidates.push({
      cycle: {
        cycleId: info.cycleId,
        initiativeId: info.initiativeId,
        project: q.project,
        status: q.status,
        dependsOnInitiatives: q.dependsOnInitiatives,
      },
      mtime: info.mtime,
    });
  }
  // Also surface in-flight / ready-for-review manifests that don't yet
  // have a log dir (just-claimed, pre-first-event).
  const seenInits = new Set([...candidates.map((c) => c.cycle.initiativeId)]);
  for (const name of listInFlight(queuePaths)) {
    const id = name.replace(/\.md$/, '');
    if (seenInits.has(id)) continue;
    let project: string | undefined;
    let dependsOnInitiatives: string[] | undefined;
    try {
      const m = parseManifest(readFileSync(join(queuePaths.inFlight, name), 'utf8'));
      project = m.project;
      dependsOnInitiatives = m.depends_on_initiatives;
    } catch { /* */ }
    candidates.push({
      cycle: { cycleId: id, initiativeId: id, project, status: 'in-flight', dependsOnInitiatives },
      mtime: Date.now(),
    });
  }

  candidates.sort((a, b) => b.mtime - a.mtime);
  for (const { cycle } of candidates) {
    // R4-11-F1: `merged` deliberately classifies as RECENT, not live — it's
    // the tail end of a finished cycle finalizing (merged → done, same
    // finalize sweep), not an actively-running one. That sweep spans the
    // post-merge CI watch plus the reflector run, so a manifest legitimately
    // sits in `merged/` for minutes on every normal finalize, not
    // instantaneously.
    if (cycle.status === 'in-flight' || cycle.status === 'ready-for-review') {
      live.push(cycle);
    } else if (recent.length < RECENT_CYCLES_MAX) {
      recent.push(cycle);
    }
  }
  return { live, recent };
}

export type LivenessReport = {
  /** in-flight cycles considered (those with a `.heartbeat` file). */
  inFlightCount: number;
  /** max heartbeat age across in-flight cycles, ms (0 when none in flight). */
  maxHeartbeatAgeMs: number;
  /** the project's stale threshold (default 5min). */
  staleHeartbeatMs: number;
  /** the generous stall threshold (6× stale) the UI flips state at. */
  stallThresholdMs: number;
  /** true when maxHeartbeatAgeMs > stallThresholdMs AND a cycle is in flight. */
  stalled: boolean;
};

// Feature #8 — daemon-stall liveness. Mirrors packages/flows/scheduler.ts's
// staleHeartbeatMs default (5min); the UI flips to `daemon-stalled` only at a
// GENEROUS multiple, because the surface means "wedged or dead", not "slow".
const DEFAULT_STALE_HEARTBEAT_MS = 5 * 60_000;
const STALL_MULTIPLE = 6;

/**
 * Max heartbeat age across in-flight cycles, from the `.heartbeat` file
 * (mtime = last beat) the scheduler writes alongside each in-flight
 * manifest. Authoritative liveness signal; cheaper than scanning every
 * cycle's events. Never throws — a stat error skips that cycle.
 */
export function computeLivenessReport(queuePaths: QueuePaths): LivenessReport {
  const staleHeartbeatMs = DEFAULT_STALE_HEARTBEAT_MS;
  const stallThresholdMs = staleHeartbeatMs * STALL_MULTIPLE;
  let maxAge = 0;
  let count = 0;
  const now = Date.now();
  for (const filename of listInFlight(queuePaths)) {
    const hbPath = join(queuePaths.inFlight, filename + '.heartbeat');
    if (!existsSync(hbPath)) continue;
    try {
      const age = now - statSync(hbPath).mtimeMs;
      count += 1;
      if (age > maxAge) maxAge = age;
    } catch { /* skip unreadable heartbeat */ }
  }
  return {
    inFlightCount: count,
    maxHeartbeatAgeMs: count > 0 ? maxAge : 0,
    staleHeartbeatMs,
    stallThresholdMs,
    stalled: count > 0 && maxAge > stallThresholdMs,
  };
}

/**
 * Watch a FIXED list of directories (non-recursive), firing `onChange` on
 * any change. Used for the six queue-state dirs (`watchQueue`) — no
 * recursive/fallback shape (queue dirs are flat, one manifest per file).
 * Best-effort: a dir that doesn't exist yet, or whose `fs.watch` throws, is
 * silently skipped (a queue dir created later is picked up by the caller's
 * own re-arm, not by this one-shot setup call).
 */
export function watchDirsFlat(dirs: readonly string[], onChange: () => void): FSWatcher[] {
  const watchers: FSWatcher[] = [];
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    try {
      watchers.push(fsWatch(d, { persistent: false }, onChange));
    } catch { /* fs.watch unavailable */ }
  }
  return watchers;
}

/**
 * Watch every project's `<projectsRoot>/<name>/<subdirName>` directory
 * (recursively where the platform supports it), firing `onChange` on any
 * change. Shared by `watchArchitect` (`_architect`), `watchInstructions`
 * (`_instructions`) and `watchDemo` (`_demo`) — same fs.watch call, same
 * recursive-then-non-recursive-fallback shape (a UA without recursive
 * `fs.watch` support still catches new sessions; the UI re-fetches anyway),
 * same silent catch when `fs.watch` is unavailable entirely.
 */
export function watchProjectSubdirs(projectsRoot: string, subdirName: string, onChange: () => void): FSWatcher[] {
  const watchers: FSWatcher[] = [];
  if (!existsSync(projectsRoot)) return watchers;
  let projects: string[];
  try { projects = readdirSync(projectsRoot); } catch { return watchers; }
  for (const name of projects) {
    const dir = join(projectsRoot, name, subdirName);
    if (!existsSync(dir)) continue;
    try {
      watchers.push(fsWatch(dir, { persistent: false, recursive: true }, onChange));
    } catch {
      try {
        watchers.push(fsWatch(dir, { persistent: false }, onChange));
      } catch { /* fs.watch unavailable */ }
    }
  }
  return watchers;
}
