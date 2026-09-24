/**
 * The unattended scheduler (ADR 011): `serve`'s daemon loop + admission.
 * Size split across this file + scheduler-sweeps.ts + scheduler-run-one.ts — see design.md.
 */

import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { setInterval, clearInterval } from 'node:timers';
import {
  claim,
  counts,
  getPaths,
  listPending,
  recover,
  type QueuePaths,
} from './queue.ts';
import * as worktree from './worktree.ts';
import { isPaused } from './daemon.ts';
import type { PhaseWiring } from './phase-wiring.ts';
import { stopAllCronTriggers } from './cron-triggers.ts';
import { parseManifest as parseFullManifest } from './manifest.ts';
import { DEVELOP_FLOW_ID } from './enqueue-develop-run.ts';
import { notify, type NotifyConfig } from './notify.ts';
import { loadConfig } from '@forge/kernel';
import { isNonTerminalRefused } from './claim-validator.ts';
import { runOne, makeProgressTee } from './scheduler-run-one.ts';
import {
  runFinalizeSweep,
  runDrainSweep,
  runFlowTriggerSweep,
  runCronSync,
  runRecoverySweep,
  cleanupRecoveredWorktrees,
} from './scheduler-sweeps.ts';

export type SchedulerConfig = {
  queueRoot?: string;
  worktreesRoot?: string; // where git worktrees live
  maxConcurrentInitiatives?: number;
  heartbeatIntervalMs?: number;
  staleHeartbeatMs?: number;
  notify?: NotifyConfig;
  pollIntervalMs?: number;
  /**
   * F-08: how often to re-run the crash-recovery sweep in forever mode.
   * Defaults to 5 minutes (per ADR 012). Ignored in `once` mode.
   */
  recoverIntervalMs?: number;
};

const DEFAULTS: Required<Omit<SchedulerConfig, 'notify' | 'recoverIntervalMs'>> & {
  recoverIntervalMs: number;
} = {
  queueRoot: '_queue',
  worktreesRoot: '_worktrees',
  maxConcurrentInitiatives: 2,
  heartbeatIntervalMs: 30_000,
  staleHeartbeatMs: 5 * 60_000,
  pollIntervalMs: 5_000,
  // F-08 / ADR 012: periodic crash-recovery sweep (forever-mode only).
  recoverIntervalMs: 5 * 60_000,
};

const DEFAULT_NOTIFY: NotifyConfig = { desktop: true, webhook_url: null };

export type RunMode = 'forever' | 'once';

export async function serve(opts: { mode: RunMode; phaseWiring: PhaseWiring } & SchedulerConfig): Promise<void> {
  // F-10 / F-18: layer per-machine config from forge.config.json under
  // explicit opts. Order: opts > forge.config.json > DEFAULTS. Missing
  // config file is fine — empty object falls through to DEFAULTS.
  const userConfig = loadConfig();
  const cfg = {
    ...DEFAULTS,
    ...opts,
    notify:
      opts.notify ??
      (userConfig.notify
        ? {
            desktop: userConfig.notify.desktop ?? DEFAULT_NOTIFY.desktop,
            webhook_url: userConfig.notify.webhook_url ?? DEFAULT_NOTIFY.webhook_url,
          }
        : DEFAULT_NOTIFY),
    maxConcurrentInitiatives:
      opts.maxConcurrentInitiatives ??
      userConfig.scheduler?.maxConcurrentInitiatives ??
      DEFAULTS.maxConcurrentInitiatives,
  };
  ensureLayout(cfg);

  // Recovery sweep at startup — deliberately NOT `runRecoverySweep`
  // (scheduler-sweeps.ts), which try/catch-wraps everything for the
  // interval timer; a startup failure should stay loud.
  const recoveries = recover({
    paths: getPaths(cfg.queueRoot),
    staleHeartbeatMs: cfg.staleHeartbeatMs,
    worktreeExists: worktree.exists,
  });
  for (const r of recoveries) {
    // F-09: clean up any orphaned worktrees + scratch branches the
    // recovered initiatives left behind. The recover() call moved the
    // manifest back to pending/; we read it from there to learn the
    // worktree_path and project_repo_path (annotated by the scheduler at
    // claim time).
    cleanupRecoveredWorktrees(r.recovered, getPaths(cfg.queueRoot));
    await notify(
      {
        type: 'recovered',
        title: `Recovered ${r.recovered.length} initiative(s)`,
        body: `Reason: ${r.reason}. Items: ${r.recovered.join(', ')}`,
      },
      cfg.notify,
    );
  }

  // F-W5-7: at startup, finalize any ready-for-review cycle whose PR was merged
  // while the daemon was down (operator merged, nothing re-confirmed it).
  await runFinalizeSweep(opts.phaseWiring);
  // ADR 026: at startup, drain any review work-items appended while the daemon
  // was down (the operator sent back; the cycle must re-run them in place).
  await runDrainSweep(opts.phaseWiring);
  // Stage C: dispatch any flow-trigger run-requests staged while down.
  runFlowTriggerSweep();
  // R2-04 (ADR-041): arm the cron triggers declared across studio/flows/*.
  runCronSync();

  const inFlight = new Map<string, Promise<void>>();
  let stop = false;

  // F-22: live stdout in interactive mode. The scheduler-level `notify` calls
  // already print cycle-boundary events; the per-cycle event tee surfaces
  // intra-cycle progress (PM start/end, per-WI dev-loop start/end, review,
  // reflection). Quiet enough to leave running, loud enough to trust.
  // Enabled in both modes — once-mode is the typical validation entry point.
  const tee = makeProgressTee();

  // F-25: track which initiative IDs we've already announced as "blocked" so
  // the idle stdout doesn't repeat the same line every poll cycle (5s).
  const announcedBlocked = new Set<string>();
  // Poll toggle: when `<queueRoot>/.paused` exists the scheduler stops
  // CLAIMING new work but keeps the process alive (in-flight cycles drain,
  // recovery sweeps still run). Announce the transition once so forever
  // stdout isn't spammed every poll tick.
  let announcedPaused = false;

  const tick = async (): Promise<boolean> => {
    if (isPaused(cfg.queueRoot)) {
      if (!announcedPaused) {
        console.log('[serve] paused — not claiming new work (forge resume to re-enable)');
        announcedPaused = true;
      }
      return inFlight.size > 0;
    }
    if (announcedPaused) {
      console.log('[serve] resumed — claiming work again');
      announcedPaused = false;
    }
    while (inFlight.size < cfg.maxConcurrentInitiatives) {
      const pending = listPending(getPaths(cfg.queueRoot));
      if (pending.length === 0) return false;
      // F-25: walk pending files in order, picking the first whose
      // initiative-level dependencies are all in `_queue/done/`. A blocked
      // initiative stays in pending; we just skip past it.
      let claimed: string | null = null;
      let claimedFilename: string | null = null;
      for (const filename of pending) {
        const initiativeId = filename.replace(/\.md$/, '');
        const blockedBy = checkInitiativeDeps(filename, getPaths(cfg.queueRoot));
        if (blockedBy.length > 0) {
          if (!announcedBlocked.has(initiativeId)) {
            console.log(
              `[serve] skipping ${initiativeId} — blocked by ${blockedBy.join(', ')}`,
            );
            announcedBlocked.add(initiativeId);
          }
          continue;
        }
        announcedBlocked.delete(initiativeId);
        // M3-6: skip initiatives refused as non-contract-ready in this process
        // lifetime. validateClaimable already recorded the reason on the first
        // attempt; re-claiming every 5 s would churn an inFlight slot and spam
        // stdout. The manifest stays in pending/ so a fresh `forge serve` (after
        // the operator fixes the project) re-checks from scratch.
        if (isNonTerminalRefused(initiativeId)) continue;
        const c = claim(filename, getPaths(cfg.queueRoot));
        if (c) {
          claimed = c;
          claimedFilename = filename;
          break;
        }
      }
      if (!claimed || !claimedFilename) return inFlight.size > 0;
      // Capture the filename for the closure so a later loop iteration's
      // reassignment of `claimedFilename` can't shadow this entry's cleanup.
      const fn: string = claimedFilename;
      const promise = runOne(claimed, fn, cfg, tee, opts.phaseWiring).finally(() => {
        inFlight.delete(fn);
      });
      inFlight.set(fn, promise);
      if (cfg.mode === 'once') break;
    }
    return inFlight.size > 0;
  };

  if (cfg.mode === 'once') {
    await tick();
    await Promise.allSettled(inFlight.values());
    stopAllCronTriggers();
    return;
  }

  // F-22: signal handlers wire the existing `stop` flag so Ctrl+C drains
  // in-flight cycles cleanly instead of hard-killing the Node process. A
  // second signal force-exits — recovers the operator's intent if the drain
  // hangs (e.g., a wedged SDK call). Heartbeat + queue state is recoverable
  // either way thanks to the recovery sweep, but a clean drain is cheaper.
  const startedAt = performance.now(); // monotonic — forge-8vfn.7.6.50
  let signalCount = 0;
  const onSignal = (sig: NodeJS.Signals): void => {
    signalCount += 1;
    if (signalCount === 1) {
      stop = true;
      const n = inFlight.size;
      console.log(
        `\n[serve] received ${sig} — ${n === 0 ? 'idle, exiting' : `draining ${n} in-flight cycle(s); send ${sig} again to force-quit`}`,
      );
    } else {
      console.log(`[serve] received second ${sig} — force-quitting`);
      process.exit(130);
    }
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  // F-22: idle tick — once a minute, print a one-liner showing queue depth
  // and uptime so the operator knows the process is alive when nothing is
  // happening. Suppressed when stdout isn't a TTY (CI, file capture) so we
  // don't spam log files.
  const showIdle = process.stdout.isTTY && cfg.mode === 'forever';
  const idleTimer = showIdle
    ? setInterval(() => {
        if (stop) return;
        if (inFlight.size > 0) return; // not idle if work is in flight
        const c = counts(getPaths(cfg.queueRoot));
        const upMins = Math.floor((performance.now() - startedAt) / 60_000);
        console.log(
          `[idle] ${inFlight.size} in-flight · ${c.pending} pending · uptime ${upMins}m`,
        );
      }, 60_000)
    : null;

  // F-08 / ADR 012: periodic crash-recovery sweep. The startup sweep above
  // catches state from prior crashes; this catches mid-run loss (a worktree
  // that vanishes, a heartbeat that goes stale because runOne is wedged).
  // Cleared at shutdown so the process can exit cleanly.
  const recoverTimer = setInterval(() => {
    void runRecoverySweep(cfg);
    // F-W5-7: also re-confirm ready-for-review cycles the operator has merged,
    // then (ADR 026) drain any review work-items appended since the last sweep.
    void runFinalizeSweep(opts.phaseWiring).then(() => runDrainSweep(opts.phaseWiring)).then(() => runCronSync());
    // Stage C: dispatch any flow-trigger run-requests (on:complete chaining).
    runFlowTriggerSweep();
  }, cfg.recoverIntervalMs);

  console.log(
    `[serve] forever-mode · maxConcurrent=${cfg.maxConcurrentInitiatives} · poll=${cfg.pollIntervalMs}ms · Ctrl+C to drain`,
  );

  try {
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
  } finally {
    clearInterval(recoverTimer);
    if (idleTimer) clearInterval(idleTimer);
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    stopAllCronTriggers();
  }

  if (inFlight.size > 0) {
    console.log(`[serve] waiting on ${inFlight.size} in-flight cycle(s) before exit…`);
  }
  await Promise.allSettled(inFlight.values());
  console.log('[serve] exited cleanly');
}

/**
 * Sentinel blocker returned by `checkInitiativeDeps` when a manifest's
 * frontmatter cannot be parsed. Fail SAFE: an unreadable manifest must never
 * be treated as ungated/claimable — the scheduler skips it (blocked) and the
 * roadmap shows it as not-ready until the operator repairs it.
 */
export const UNPARSEABLE_MANIFEST_BLOCKER = '<unparseable-manifest>';

/**
 * F-25: read a pending manifest's `depends_on_initiatives` and return the
 * subset that are NOT yet in `_queue/done/`. An empty result means all deps
 * are satisfied (or there were no deps) and the scheduler may claim. A
 * manifest whose frontmatter fails to parse returns the blocking
 * `UNPARSEABLE_MANIFEST_BLOCKER` sentinel (fail safe — never dispatch what
 * we can't read) with a loud log. Exported for unit-test access — the
 * scheduler and the roadmap/planned-initiatives builders are the production
 * callers.
 *
 * plan-everything-before-kickoff: the gate applies only to build flows
 * (forge-develop). A decompose run (flow_id 'forge-architect') must be free
 * to draft its whole roadmap up front without waiting on a prerequisite
 * initiative's merge — only the later build kickoff respects merge order.
 * A manifest with no flow_id is treated as a build flow (the pre-existing,
 * safe default).
 */
export function checkInitiativeDeps(filename: string, paths: QueuePaths): string[] {
  const pendingPath = join(paths.pending, filename);
  if (!existsSync(pendingPath)) return [];
  let deps: string[];
  try {
    const full = parseFullManifest(readFileSync(pendingPath, 'utf8'));
    const flowId = full.flow_id ?? DEVELOP_FLOW_ID;
    if (flowId !== DEVELOP_FLOW_ID) return [];
    deps = full.depends_on_initiatives ?? [];
  } catch (err) {
    console.error(
      `[scheduler] ${filename}: manifest frontmatter failed to parse — blocking claim (fail safe): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return [UNPARSEABLE_MANIFEST_BLOCKER];
  }
  if (deps.length === 0) return [];
  return deps.filter((depId) => {
    // R4-11-F1: `merged` is a transient pass-through of the SAME finished
    // dependency (it's promoted to `done/` in the same sweep) — a dependent
    // must not stay blocked for the brief window a prerequisite sits in
    // `merged/` before that promotion runs, so the gate accepts merged ∪ done.
    const donePath = join(paths.done, `${depId}.md`);
    const mergedPath = join(paths.merged, `${depId}.md`);
    return !existsSync(donePath) && !existsSync(mergedPath);
  });
}

function ensureLayout(cfg: { queueRoot: string; worktreesRoot: string }): void {
  // SEC-02: `<forgeRoot>/projects` is a containment root for manifest
  // `project_repo_path` / in-place `worktree_path`, and a containment root
  // that does not exist fails CLOSED. `forge init`'s `layoutDirs` now creates
  // it, but the DAEMON has its own layout bootstrap and an install that
  // predates this change never had it — so create it here too, derived the
  // same way the guard derives it (the queue root's parent) so the directory
  // created is provably the directory checked against. Direction matters: the
  // gap is a FALSE-REJECTION risk (legitimate manifests refused), never a
  // hole — a missing root can only ever reject.
  const projectsRoot = join(dirname(resolve(cfg.queueRoot)), 'projects');
  for (const p of [cfg.queueRoot, cfg.worktreesRoot, projectsRoot]) {
    if (!existsSync(resolve(p))) mkdirSync(resolve(p), { recursive: true });
  }
  const paths = getPaths(cfg.queueRoot);
  for (const p of [paths.pending, paths.inFlight, paths.readyForReview, paths.merged, paths.done, paths.failed]) {
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

// Terminal-status dispatch + F-27 bounded auto-retry live in
// ./scheduler-dispatch.ts (Phase 3 size split). Re-exported here so the
// public API + test imports are unchanged.
export { dispatchTerminalStatus, decideAutoRetry, MAX_AUTO_RETRIES } from './scheduler-dispatch.ts';
export type {
  DispatchInput,
  DispatchDeps,
  DispatchOutcome,
  AutoRetryDecision,
} from './scheduler-dispatch.ts';

// ADR-028 §8 (M3-6): re-export claim validator + version-seam utilities
// so tests can import them from the scheduler module without reaching into
// the implementation detail.
export { validateClaimable, isNonTerminalRefused, clearPendingRefusalLog, clearAllPendingRefusalLogs } from './claim-validator.ts';
export type { ClaimValidationResult } from './claim-validator.ts';

// bead forge-8vfn.15: linkProjectDeps + annotateManifest moved to
// scheduler-run-one.ts; re-exported so deep-importers of this module
// (and scheduler.test.ts's dynamic import) keep resolving both names.
export { linkProjectDeps, annotateManifest } from './scheduler-run-one.ts';
