/**
 * reap.mjs — every agent a story run dispatched is dead when the run ends.
 *
 * THE INCIDENT (bead `forge-8vfn.5.37`, LIFECYCLE half; measured on the S3 run,
 * 2026-09-02). A beat pressed `run-onboarding-agent`, forge dispatched a real
 * Agent, and the run then wrote its verdict and exited — leaving that Agent
 * running as an ORPHAN. It went on to leave the run's worktree entirely and
 * executed `forge constraints author` / `forge preflight converge --accept …`
 * inside ANOTHER session's checkout, adding ten files to that tree's copy of
 * the story ground. No `git status` anywhere showed it: the project's own
 * `.gitignore` ignores `.forge/`, forge's ignores `projects/*`.
 *
 * The orphan window IS the escape window. A run that has written its verdict
 * has stopped watching by definition, so anything still executing past that
 * point is unobserved by the very gate that started it — and a gate that
 * starts processes it does not stop is not bounded by its own run.
 *
 * THE KILL IS AIMED, NEVER PATTERNED. COMMON §15.17 exists because a
 * `pkill -f` on a shared pattern coincided with three sessions dying in one
 * minute. So a pid is signalled only after its OWN `/proc/<pid>/cwd` is read
 * and placed INSIDE this run's worktree — the same probe, and the same
 * `readProcCwd`, the bridge-identity decision already uses. An unreadable cwd
 * is unknown provenance, and unknown provenance is not our provenance: skipped
 * and reported, never signalled on a guess. A prefix is not containment
 * either: `<root>-evil` shares nine characters with `<root>` and belongs to
 * someone else.
 *
 * SCOPE. This closes 5.37's LIFECYCLE half only. That an agent could `cd` out
 * of its worktree at all is 5.37's containment half (M4-agents), and that the
 * run's event log stopped five minutes before the agent did is
 * `forge-8vfn.5.38` — neither is touched here.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { readProcCwd } from './bridge.mjs';

/** How long a dispatched agent gets to exit on SIGTERM before SIGKILL. */
const DEFAULT_GRACE_MS = 5_000;
/** How often its liveness is re-read during that grace period. */
const DEFAULT_POLL_MS = 100;

/** Real-filesystem default for {@link collectAgentRuns}. */
function listSessionDirs(logsDir) {
  return readdirSync(logsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, mtimeMs: statSync(join(logsDir, e.name)).mtimeMs }));
}

/** Real-filesystem default for {@link collectAgentRuns}. */
function readPidFile(path) {
  try {
    const n = Number.parseInt(readFileSync(path, 'utf8').trim(), 10);
    return Number.isInteger(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Every session this run dispatched, read from the `turn.pid` each one writes.
 *
 * `sinceMs` is the run's own start: a session dir older than the run belongs
 * to a PREVIOUS run and is not ours to kill — the same reasoning that makes
 * the bridge decision refuse a foreign holder rather than take it over.
 *
 * Deliberately keyed on "carries a `turn.pid`" rather than on a `_agent-`
 * filename prefix: the S3 incident's dispatch wrote TWO session dirs
 * (`_agent-onboarding-agent-…` and `_onboarding-…`), both with a pid, and a
 * filename-keyed scan is the class COMMON §15.16/§15.22 keeps catching.
 *
 * Never throws — this runs in a `finally`, and a teardown that throws loses
 * the verdict the run just produced.
 */
export function collectAgentRuns(root, sinceMs, deps = {}) {
  const listDirs = deps.listDirs ?? listSessionDirs;
  const readPid = deps.readPid ?? readPidFile;
  const logsDir = join(root, '_logs');

  let entries;
  try {
    entries = listDirs(logsDir);
  } catch {
    return [];
  }

  const runs = [];
  for (const entry of entries) {
    if (entry.mtimeMs < sinceMs) continue;
    const dir = join(logsDir, entry.name);
    const pid = readPid(join(dir, 'turn.pid'));
    if (pid === null) continue;
    runs.push({ dir, pid });
  }
  return runs;
}

/** True iff `cwd` is `root` itself or a path genuinely beneath it. */
function isInside(cwd, root) {
  return cwd === root || cwd.startsWith(`${root}/`);
}

/**
 * Whether this pid may be signalled — pure, so the containment rule is
 * testable without a process table.
 */
export function decideReap({ pid, cwd, ownRoot }) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return { reap: false, reason: `not a signalable pid: ${JSON.stringify(pid)}` };
  }
  if (typeof cwd !== 'string' || cwd === '') {
    return {
      reap: false,
      reason: `pid ${pid}: cwd unreadable — unknown provenance is not our provenance, so it is not signalled`,
    };
  }
  if (!isInside(cwd, ownRoot)) {
    return { reap: false, reason: `pid ${pid}: cwd ${cwd} is outside the run worktree ${ownRoot}` };
  }
  return { reap: true };
}

/**
 * Terminate every collected run that this worktree can claim, and report what
 * happened to each — the report is written into the run's verdict record, so a
 * kill is evidence rather than a side effect nobody can see afterwards.
 *
 * SIGTERM, a BOUNDED wait, then SIGKILL. The wait counts poll steps rather
 * than wall clock so an injected `sleep` cannot make it spin forever.
 */
export async function reapAgentRuns(runs, opts = {}) {
  const ownRoot = opts.ownRoot;
  const cwdOf = opts.cwdOf ?? readProcCwd;
  const kill = opts.kill ?? ((pid, sig) => process.kill(pid, sig));
  const isAlive =
    opts.isAlive ??
    ((pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    });
  const graceMs = opts.graceMs ?? DEFAULT_GRACE_MS;
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  const reaped = [];
  const skipped = [];

  for (const { dir, pid } of runs) {
    const decision = decideReap({ pid, cwd: cwdOf(pid), ownRoot });
    if (!decision.reap) {
      skipped.push({ pid, dir, reason: decision.reason });
      continue;
    }

    try {
      kill(pid, 'SIGTERM');
    } catch (err) {
      // Already gone, or never ours to signal. Both are outcomes, not faults.
      skipped.push({ pid, dir, reason: `SIGTERM failed: ${err?.message ?? String(err)}` });
      continue;
    }

    let alive = true;
    const steps = Math.max(1, Math.ceil(graceMs / pollMs));
    for (let i = 0; i < steps; i += 1) {
      await sleep(pollMs);
      if (!isAlive(pid)) {
        alive = false;
        break;
      }
    }

    if (!alive) {
      reaped.push({ pid, dir, signal: 'SIGTERM' });
      continue;
    }

    try {
      kill(pid, 'SIGKILL');
      reaped.push({ pid, dir, signal: 'SIGKILL' });
    } catch (err) {
      skipped.push({ pid, dir, reason: `SIGKILL failed: ${err?.message ?? String(err)}` });
    }
  }

  return { reaped, skipped };
}

/** One line per outcome, for the run's stdout. */
export function describeReap(report) {
  return [
    ...report.reaped.map((r) => `[stories] reaped dispatched agent pid ${r.pid} (${r.signal}) — ${r.dir}`),
    ...report.skipped.map((s) => `[stories] NOT reaped: ${s.reason}`),
  ];
}
