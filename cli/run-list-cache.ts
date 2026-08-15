/**
 * cli/run-list-cache.ts — ADR-044 P1: an mtime-keyed memo of the single run
 * derivation (docs/decisions/044-read-path-memoization.md).
 *
 * `orchestrator/run-model.ts::listRuns` walks every `_queue/<state>/*.md`
 * manifest and re-derives its full `Run` (phase statuses/meta/work items/
 * artifacts/cost) from `_logs/<cycleId>/events.jsonl` on EVERY call — cheap
 * at seed scale, but `_queue/done/` grows without bound and a terminal run's
 * derivation never changes, so at roadmap scale `GET /api/runs` re-reads and
 * re-JSON-parses hundreds of MB of already-settled event logs per request
 * (measured 507 MB, ADR-044 context).
 *
 * This module adds exactly ONE thing on top: a per-manifest memory-only
 * cache keyed off the manifest's and its events.jsonl's own `mtime`+`size` —
 * never off time, counters, or queue state alone (ADR-044 rule 2). The
 * DERIVATION itself is untouched: a cache miss calls the exact same
 * `aggregateRun` the uncached path uses (ADR-044 rule 1), so
 * `cachedListRuns` is a byte-identical drop-in for `listRuns`.
 *
 * Terminal runs (done/failed/merged) settle into "hit forever" NATURALLY —
 * their manifest and events files stop changing once archived, so the key
 * stays stable — rather than via a queueState special case, which would key
 * invalidation off status instead of the inputs' own metadata (the thing
 * rule 2 forbids).
 *
 * Fails open on any doubt (ADR-044 rule 4): a stat error on the manifest, or
 * anything other than a confirmed-absent (`ENOENT`) events file, skips the
 * cache entirely for that one manifest and falls through to the same
 * derivation `listRuns` would have produced uncached — a memo can never be
 * the only way to produce the value.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { parseManifest } from '../orchestrator/manifest.ts';
import type { QueueState } from '../orchestrator/queue.ts';
import {
  aggregateRun,
  buildNodeMapping,
  buildFlowNodeSets,
  buildAgentSlugToNodeId,
} from '../orchestrator/run-model.ts';
import type { Run } from '../orchestrator/run-model.ts';

// ---------------------------------------------------------------------------
// Queue-state enumeration
// ---------------------------------------------------------------------------

// Mirrors orchestrator/run-model.ts::listRuns's own hardcoded state list
// (that function duplicates it too, rather than deriving from
// orchestrator/queue.ts — there is no exported "all states" constant there).
// ADR-042/044 forbid adding a new orchestrator export for this pass, so this
// list is kept in sync by hand with listRuns's identical literal.
const QUEUE_STATES: readonly QueueState[] = [
  'pending',
  'in-flight',
  'ready-for-review',
  'merged',
  'done',
  'failed',
];

// Mirrors orchestrator/run-model.ts's private (non-exported)
// QUEUE_STATE_TO_RUN_STATUS — needed only for the degraded-run fallback
// below (a corrupt manifest that fails to parse). Not exported there either,
// so duplicated here rather than adding a new orchestrator export.
const QUEUE_STATE_TO_RUN_STATUS: Record<QueueState, Run['status']> = {
  pending: 'planned',
  'in-flight': 'active',
  'ready-for-review': 'gated',
  merged: 'complete',
  done: 'complete',
  failed: 'failed',
};

// ---------------------------------------------------------------------------
// Injectable I/O seam (test-only)
// ---------------------------------------------------------------------------

type StatFn = (path: string) => { mtimeMs: number; size: number };

let statImpl: StatFn = (path) => statSync(path);

/** Test-only: inject a stat implementation (e.g. one that throws for a
 *  specific path) to exercise the ADR-044 rule-4 fail-open path
 *  deterministically. Pass `null` to restore the real `statSync`. */
export function _setStatImplForTest(fn: StatFn | null): void {
  statImpl = fn ?? ((path) => statSync(path));
}

// ---------------------------------------------------------------------------
// Test-only instrumentation
// ---------------------------------------------------------------------------

let deriveCount = 0;

/** Test-only: count of full (uncached) derivations since the last reset —
 *  the proof-test proxy for "was the expensive parse/derive path taken". */
export function _getDeriveCountForTest(): number {
  return deriveCount;
}

/** Test-only: clear the memo AND the derive counter, so each test starts
 *  from a clean slate (the cache is a module-level singleton). */
export function _resetRunListCacheForTest(): void {
  cache.clear();
  deriveCount = 0;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

type StatFingerprint = { mtimeMs: number; size: number };

type CacheKey = {
  queueState: QueueState;
  manifest: StatFingerprint;
  /** null = confirmed-absent events.jsonl (its own key state, e.g. an
   *  in-flight cycle that hasn't emitted its first event yet) — distinct
   *  from a stat ERROR, which fails open instead (see resolveEventsFingerprint). */
  events: StatFingerprint | null;
};

type CacheEntry = { key: CacheKey; run: Run };

// Memory-only, dies with the process (ADR-044 rule 3) — no snapshot file, no
// persisted format. Keyed by manifest path, which already encodes queue
// state + initiative id; a manifest that transitions queue state (moves
// directory) simply misses under its new path and re-derives once, leaving
// the old path's entry to age out of relevance (never read again).
const cache = new Map<string, CacheEntry>();

function statOrNull(path: string): StatFingerprint | null {
  try {
    return statImpl(path);
  } catch {
    return null;
  }
}

/** Distinguishes a confirmed-absent file (ENOENT — a legitimate, cacheable
 *  key state) from any OTHER stat failure (permission error, injected test
 *  failure, …), which must fail open rather than be treated as "absent". */
function statOrAbsentOrError(path: string): { fp: StatFingerprint | null; error: boolean } {
  try {
    return { fp: statImpl(path), error: false };
  } catch (err) {
    const isEnoent = (err as NodeJS.ErrnoException)?.code === 'ENOENT';
    return { fp: null, error: !isEnoent };
  }
}

/** Mirrors orchestrator/run-model.ts's private findNewestCycleId exactly
 *  (not exported; ADR-042/044 forbid a new orchestrator export for this one
 *  call site) — needed to resolve the SAME events.jsonl path aggregateRun
 *  will read internally, for legacy manifests that carry no cycle_id. */
function findNewestCycleId(root: string, initiativeId: string): string | null {
  const logsRoot = join(resolve(root), '_logs');
  if (!existsSync(logsRoot)) return null;
  let candidates: string[];
  try {
    candidates = readdirSync(logsRoot).filter((d) => d.endsWith(`_${initiativeId}`));
  } catch {
    return null;
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.localeCompare(a));
  return candidates[0];
}

/** Resolve the events.jsonl fingerprint for the cache key, or signal a doubt
 *  that must fail the whole manifest open. `pending` runs never read events
 *  at all (aggregateRun short-circuits to a planned Run), so they carry no
 *  events component. */
function resolveEventsFingerprint(
  root: string,
  queueState: QueueState,
  manifestPath: string,
): { fp: StatFingerprint | null; error: boolean } {
  if (queueState === 'pending') return { fp: null, error: false };

  let cycleId: string | null;
  try {
    const manifest = parseManifest(readFileSync(manifestPath, 'utf8'));
    cycleId = manifest.cycle_id ?? findNewestCycleId(root, manifest.initiative_id);
  } catch {
    // Manifest unreadable/unparseable — the derivation path will hit the
    // same failure and degrade; no events file to key on either way.
    return { fp: null, error: false };
  }
  if (!cycleId) return { fp: null, error: false };

  const eventsPath = join(resolve(root), '_logs', cycleId, 'events.jsonl');
  return statOrAbsentOrError(eventsPath);
}

function sameFingerprint(a: StatFingerprint | null, b: StatFingerprint | null): boolean {
  if (a === null || b === null) return a === b;
  return a.mtimeMs === b.mtimeMs && a.size === b.size;
}

function sameKey(a: CacheKey, b: CacheKey): boolean {
  return (
    a.queueState === b.queueState &&
    sameFingerprint(a.manifest, b.manifest) &&
    sameFingerprint(a.events, b.events)
  );
}

// ---------------------------------------------------------------------------
// Derivation (cache miss / fail-open path)
// ---------------------------------------------------------------------------

function deriveFresh(args: {
  forgeRoot: string;
  queueState: QueueState;
  manifestPath: string;
  nowMs: number;
  nodeMapping?: Map<string, string | null>;
  flowNodeSets?: Map<string, Set<string>>;
  agentSlugToNodeId?: Map<string, string>;
}): Run {
  deriveCount += 1;
  const { forgeRoot, queueState, manifestPath, nowMs, nodeMapping, flowNodeSets, agentSlugToNodeId } = args;
  try {
    return aggregateRun({
      root: forgeRoot,
      queueState,
      manifestPath,
      nowMs,
      ...(nodeMapping ? { nodeMapping } : {}),
      ...(flowNodeSets ? { flowNodeSets } : {}),
      ...(agentSlugToNodeId ? { agentSlugToNodeId } : {}),
    });
  } catch {
    // Mirrors orchestrator/run-model.ts's private makeDegradedRun (not
    // exported; same ADR-042/044 no-new-export constraint) — a corrupt or
    // unreadable manifest yields a degraded Run instead of crashing the list,
    // exactly like listRuns's own per-file try/catch does.
    const initiativeId = basename(manifestPath).replace(/\.md$/, '');
    return {
      id: initiativeId,
      flowId: 'unknown',
      initiativeId,
      initiative: '(unreadable manifest)',
      status: QUEUE_STATE_TO_RUN_STATUS[queueState],
      origin: 'architect',
      costUsd: 0,
      phases: {},
      phaseMeta: {},
      artifactsReady: {},
      flowLineage: [],
    };
  }
}

function deriveOneRun(args: {
  forgeRoot: string;
  queueState: QueueState;
  manifestPath: string;
  nowMs: number;
  nodeMapping?: Map<string, string | null>;
  flowNodeSets?: Map<string, Set<string>>;
  agentSlugToNodeId?: Map<string, string>;
}): Run {
  const { forgeRoot, queueState, manifestPath } = args;

  // Manifest stat failing at all (including ENOENT — a race between readdir
  // and stat) is doubt about the manifest itself, not a modeled key state:
  // fail open unconditionally.
  const manifestFp = statOrNull(manifestPath);
  if (manifestFp === null) {
    return deriveFresh(args);
  }

  const eventsResult = resolveEventsFingerprint(forgeRoot, queueState, manifestPath);
  if (eventsResult.error) {
    // A non-ENOENT stat failure on the events file is genuine doubt — never
    // cache it, never treat it as "absent" (ADR-044 rule 4).
    return deriveFresh(args);
  }

  const key: CacheKey = { queueState, manifest: manifestFp, events: eventsResult.fp };
  const hit = cache.get(manifestPath);
  if (hit && sameKey(hit.key, key)) {
    return hit.run;
  }

  const run = deriveFresh(args);
  cache.set(manifestPath, { key, run });
  return run;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Same return contract as `orchestrator/run-model.ts::listRuns` — a
 * byte-identical drop-in. Walks every `_queue/<state>/*.md` manifest exactly
 * like `listRuns`, but resolves each `Run` through the per-manifest memo
 * above instead of always calling the full derivation.
 */
export function cachedListRuns(forgeRoot: string, nowMs: number): Run[] {
  const runs: Run[] = [];

  // Build the node/flow/agent mappings ONCE for the whole pass, exactly as
  // listRuns does internally, and hand them down via aggregateRun's
  // additive-optional params (ADR-042 disclose-not-park) so a multi-manifest
  // cold pass doesn't rebuild them per manifest.
  const nodeMapping = buildNodeMapping(forgeRoot);
  const flowNodeSets = buildFlowNodeSets(forgeRoot);
  const agentSlugToNodeId = buildAgentSlugToNodeId(forgeRoot);

  for (const queueState of QUEUE_STATES) {
    const queueDir = join(resolve(forgeRoot), '_queue', queueState);
    if (!existsSync(queueDir)) continue;

    let files: string[];
    try {
      files = readdirSync(queueDir).filter((f) => f.endsWith('.md') && !f.endsWith('.heartbeat'));
    } catch {
      continue;
    }

    for (const file of files) {
      const manifestPath = join(queueDir, file);
      runs.push(
        deriveOneRun({
          forgeRoot,
          queueState,
          manifestPath,
          nowMs,
          nodeMapping,
          flowNodeSets,
          agentSlugToNodeId,
        }),
      );
    }
  }

  // Same newest-first sort as listRuns.
  runs.sort((a, b) => {
    if (!a.startedAt && !b.startedAt) return 0;
    if (!a.startedAt) return 1;
    if (!b.startedAt) return -1;
    return b.startedAt.localeCompare(a.startedAt);
  });

  return runs;
}
