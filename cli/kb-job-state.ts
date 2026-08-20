/**
 * kb-job-state.ts (W7-B2, knowledge-05) — the ONE derivation of "is any
 * KB-mutating job currently running for this kb?".
 *
 * Before wave 7 the five KB-mutating controls (Drain to green / Consolidate /
 * Cleanup plan / Refresh index / Delete) were each gated only on their OWN
 * component's local busy flag — all five could be fired simultaneously, and
 * `op=index` didn't even queue. This module gives both sides the SAME
 * per-KB active-job fact:
 *   - the bridge routes 409 a second mutating dispatch while one is running
 *     (enforced end-to-end, never UI-only — declared-data-fails-open);
 *   - the UI's action group disables the other buttons with the reason.
 *
 * Standalone on purpose: imports NOTHING from the other cli/bridge modules,
 * so `cli/bridge-studio-kbs.ts` (which `cli/bridge-studio-kb-drain.ts`
 * imports from) and the drain module can BOTH use it without an import
 * cycle. The two tiny readers below mirror on-disk formats owned elsewhere —
 * `_logs/_kb-drain-<runId>/status.json` (written by bridge-studio-kb-drain's
 * `writeKbDrainStatus`) and `_logs/_brainfix-<runId>/events.jsonl` (written
 * by brain-fix-runner / bridge-studio-kbs' consolidate terminals).
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** A 'running' drain status whose `updatedAt` stopped moving past this is a
 *  DEAD run — the drain loop heartbeats `updatedAt` every
 *  KB_DRAIN_HEARTBEAT_MS (cli/bridge-studio-kb-drain.ts), so 45s of silence
 *  means the in-process loop is gone (bridge restarted mid-drain). Shared by
 *  the cancel route's forced-terminal branch and the active-job derivation
 *  below. */
export const KB_DRAIN_STALE_MS = 45_000;

/** Consolidates carry NO heartbeat (a single agent turn can run minutes with
 *  zero events) — the only honest staleness signal is a generous ceiling on
 *  the whole run. 15 min without a terminal event = not active. */
export const KB_CONSOLIDATE_STALE_MS = 15 * 60_000;

export type KbActiveJob = { kind: 'drain' | 'consolidate'; runId: string } | null;

function readJsonFile(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function listLogDirs(forgeRoot: string): string[] {
  const logsRoot = join(forgeRoot, '_logs');
  try {
    return existsSync(logsRoot) ? readdirSync(logsRoot) : [];
  } catch {
    return [];
  }
}

/** The active drain run for `kbId`, if a LIVE one exists (state 'running'
 *  with a heartbeat-fresh `updatedAt`). A stale 'running' status is reported
 *  separately so the cancel route can force-terminate it. */
export function findLiveDrain(
  forgeRoot: string,
  kbId: string,
  nowMs: number = Date.now(),
): { runId: string; live: boolean } | null {
  const dirPrefix = '_kb-drain-';
  const runIdPrefix = `${kbId}-drain-`;
  for (const name of listLogDirs(forgeRoot)) {
    if (!name.startsWith(dirPrefix)) continue;
    const runId = name.slice(dirPrefix.length);
    if (!runId.startsWith(runIdPrefix)) continue;
    const status = readJsonFile(join(forgeRoot, '_logs', name, 'status.json'));
    if (!status || status['state'] !== 'running') continue;
    const updatedMs = typeof status['updatedAt'] === 'string' ? new Date(status['updatedAt']).getTime() : NaN;
    const live = Number.isFinite(updatedMs) && nowMs - updatedMs <= KB_DRAIN_STALE_MS;
    return { runId, live };
  }
  return null;
}

/** True while `_brainfix-<runId>/events.jsonl` records no terminal
 *  ('end'/'error') event AND the run is younger than the staleness ceiling.
 *  `startedMs` falls back to the first event's `ts`, else unknown → stale. */
function consolidateRunning(forgeRoot: string, runId: string, nowMs: number): boolean {
  const evPath = join(forgeRoot, '_logs', `_brainfix-${runId}`, 'events.jsonl');
  let raw = '';
  try {
    raw = existsSync(evPath) ? readFileSync(evPath, 'utf8') : '';
  } catch {
    return false;
  }
  let firstTs: number | null = null;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let ev: { event_type?: string; ts?: string };
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (firstTs === null && typeof ev.ts === 'string') {
      const t = new Date(ev.ts).getTime();
      if (Number.isFinite(t)) firstTs = t;
    }
    if (ev.event_type === 'end' || ev.event_type === 'error') return false;
  }
  // Dispatch stakes the dir out synchronously with an EMPTY events.jsonl (or
  // none at all) before the queued run starts — treat a young, terminal-less
  // run as running. With no readable timestamp, fall back to the base36
  // dispatch stamp embedded in the runId itself.
  if (firstTs === null) {
    const stamp = runId.slice(runId.lastIndexOf('-') + 1);
    const t = parseInt(stamp, 36);
    if (Number.isFinite(t) && t > 0) firstTs = t;
  }
  if (firstTs === null) return false;
  return nowMs - firstTs <= KB_CONSOLIDATE_STALE_MS;
}

/**
 * The one KB-mutating job currently running for `kbId`, or null. Drain wins
 * ties (both can only coexist as queue neighbours; the drain's status file
 * is the more precise record).
 */
export function deriveKbActiveJob(forgeRoot: string, kbId: string, nowMs: number = Date.now()): KbActiveJob {
  const drain = findLiveDrain(forgeRoot, kbId, nowMs);
  if (drain?.live) return { kind: 'drain', runId: drain.runId };

  const consolidatePrefix = `_brainfix-${kbId}-consolidate-`;
  for (const name of listLogDirs(forgeRoot)) {
    if (!name.startsWith(consolidatePrefix)) continue;
    const runId = name.slice('_brainfix-'.length);
    if (runId.includes('__')) continue;
    if (consolidateRunning(forgeRoot, runId, nowMs)) return { kind: 'consolidate', runId };
  }
  return null;
}

/** The operator-facing reason a mutating dispatch is refused while `job` is
 *  active — ONE wording shared by every 409 and the UI's disabled-button
 *  hint, so the two can never drift. */
export function activeJobReason(job: NonNullable<KbActiveJob>): string {
  return job.kind === 'drain'
    ? `a drain-to-green run is active for this kb (${job.runId}) — wait for it to finish or cancel it`
    : `a consolidate run is active for this kb (${job.runId}) — wait for it to finish`;
}
