/**
 * The unattended scheduler. Per ADR 011, this is a ~150-line loop that:
 *   - claims pending initiatives,
 *   - spawns each as a cycle in its own git worktree,
 *   - heartbeats while the cycle runs,
 *   - moves the manifest to ready-for-review on success or failed on failure,
 *   - fires notifications.
 *
 * `forge serve` runs this forever. `forge serve --once` claims one initiative
 * and exits — used in tests and for one-shot runs.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setInterval, clearInterval } from 'node:timers';
import {
  claim,
  counts,
  getPaths,
  listPending,
  moveTo,
  recover,
  writeHeartbeat,
} from './queue.ts';
import * as worktree from './worktree.ts';
import { runCycle } from './cycle.ts';
import { notify, type NotifyConfig } from './notify.ts';

export type SchedulerConfig = {
  queueRoot?: string;
  worktreesRoot?: string; // where git worktrees live
  maxConcurrentInitiatives?: number;
  heartbeatIntervalMs?: number;
  staleHeartbeatMs?: number;
  notify?: NotifyConfig;
  pollIntervalMs?: number;
};

const DEFAULTS: Required<Omit<SchedulerConfig, 'notify'>> = {
  queueRoot: '_queue',
  worktreesRoot: '_worktrees',
  maxConcurrentInitiatives: 2,
  heartbeatIntervalMs: 30_000,
  staleHeartbeatMs: 5 * 60_000,
  pollIntervalMs: 5_000,
};

const DEFAULT_NOTIFY: NotifyConfig = { desktop: true, webhook_url: null };

export type RunMode = 'forever' | 'once';

export async function serve(opts: { mode: RunMode } & SchedulerConfig = { mode: 'forever' }): Promise<void> {
  const cfg = { ...DEFAULTS, ...opts, notify: opts.notify ?? DEFAULT_NOTIFY };
  ensureLayout(cfg);

  // Recovery sweep at startup.
  const recoveries = recover({
    paths: getPaths(cfg.queueRoot),
    staleHeartbeatMs: cfg.staleHeartbeatMs,
    worktreeExists: worktree.exists,
  });
  for (const r of recoveries) {
    await notify(
      {
        type: 'recovered',
        title: `Recovered ${r.recovered.length} initiative(s)`,
        body: `Reason: ${r.reason}. Items: ${r.recovered.join(', ')}`,
      },
      cfg.notify,
    );
  }

  const inFlight = new Map<string, Promise<void>>();
  let stop = false;

  const tick = async (): Promise<boolean> => {
    while (inFlight.size < cfg.maxConcurrentInitiatives) {
      const pending = listPending(getPaths(cfg.queueRoot));
      if (pending.length === 0) return false;
      const filename = pending[0];
      const claimed = claim(filename, getPaths(cfg.queueRoot));
      if (!claimed) continue;
      const promise = runOne(claimed, filename, cfg).finally(() => {
        inFlight.delete(filename);
      });
      inFlight.set(filename, promise);
      if (cfg.mode === 'once') break;
    }
    return inFlight.size > 0;
  };

  if (cfg.mode === 'once') {
    await tick();
    await Promise.allSettled(inFlight.values());
    return;
  }

  // Forever loop.
  for (;;) {
    if (stop) break;
    const hasWork = await tick();
    if (!hasWork) {
      await sleep(cfg.pollIntervalMs);
    } else {
      await Promise.race([sleep(cfg.pollIntervalMs), Promise.all(inFlight.values())]);
    }
  }

  await Promise.allSettled(inFlight.values());
  // Stop is set by signal handlers (SIGINT/SIGTERM); not reachable in current
  // skeleton, but kept for future expansion.
  void stop;
}

async function runOne(
  manifestPath: string,
  filename: string,
  cfg: Required<Omit<SchedulerConfig, 'notify'>> & { notify: NotifyConfig },
): Promise<void> {
  const paths = getPaths(cfg.queueRoot);
  const heartbeat = setInterval(() => {
    writeHeartbeat(filename, paths);
  }, cfg.heartbeatIntervalMs);
  try {
    const manifest = parseManifest(manifestPath);
    const wtHandle = worktree.add({
      projectRepoPath: manifest.projectRepoPath,
      branch: `forge/${manifest.initiativeId}`,
      worktreesRoot: cfg.worktreesRoot,
      initiativeId: manifest.initiativeId,
    });
    annotateManifest(manifestPath, { worktree_path: wtHandle.path });

    const result = await runCycle({
      initiativeId: manifest.initiativeId,
      manifestPath,
      projectRepoPath: manifest.projectRepoPath,
      worktreePath: wtHandle.path,
    });

    if (result.status === 'ready-for-review') {
      moveTo(filename, 'ready-for-review', paths);
      await notify(
        {
          type: 'review-ready',
          title: `Ready for review: ${manifest.initiativeId}`,
          body: `${manifest.project} — see ${result.log_path}`,
        },
        cfg.notify,
      );
    } else {
      moveTo(filename, 'failed', paths);
      await notify(
        {
          type: 'failed',
          title: `Failed: ${manifest.initiativeId}`,
          body: `${manifest.project} — see ${result.log_path}`,
        },
        cfg.notify,
      );
    }
  } catch (err) {
    moveTo(filename, 'failed', paths);
    await notify(
      {
        type: 'failed',
        title: `Failed: ${filename}`,
        body: err instanceof Error ? err.message : String(err),
      },
      cfg.notify,
    );
  } finally {
    clearInterval(heartbeat);
  }
}

type ParsedManifest = {
  initiativeId: string;
  project: string;
  projectRepoPath: string;
};

function parseManifest(path: string): ParsedManifest {
  const content = readFileSync(path, 'utf8');
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) throw new Error(`manifest ${path} missing frontmatter`);
  const fm: Record<string, string> = {};
  for (const line of fmMatch[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  if (!fm.initiative_id) throw new Error(`manifest ${path} missing initiative_id`);
  if (!fm.project) throw new Error(`manifest ${path} missing project`);
  return {
    initiativeId: fm.initiative_id,
    project: fm.project,
    projectRepoPath: fm.project_repo_path ?? resolve('projects', fm.project),
  };
}

function annotateManifest(path: string, fields: Record<string, string>): void {
  const content = readFileSync(path, 'utf8');
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return;
  let fm = fmMatch[1];
  for (const [k, v] of Object.entries(fields)) {
    const re = new RegExp(`^${k}:.*$`, 'm');
    if (re.test(fm)) {
      fm = fm.replace(re, `${k}: ${v}`);
    } else {
      fm += `\n${k}: ${v}`;
    }
  }
  const updated = content.replace(/^---\n[\s\S]*?\n---/, `---\n${fm}\n---`);
  writeFileSync(path, updated);
}

function ensureLayout(cfg: { queueRoot: string; worktreesRoot: string }): void {
  for (const p of [cfg.queueRoot, cfg.worktreesRoot]) {
    if (!existsSync(resolve(p))) mkdirSync(resolve(p), { recursive: true });
  }
  const paths = getPaths(cfg.queueRoot);
  for (const p of [paths.pending, paths.inFlight, paths.readyForReview, paths.done, paths.failed]) {
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Lightweight status helper for `forge status`.
export function status(queueRoot = '_queue'): { counts: Record<string, number> } {
  return { counts: counts(getPaths(queueRoot)) };
}

// Reference to keep Node's tree-shaker honest in the unused-imports analysis.
void join;
