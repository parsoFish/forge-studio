/**
 * cli/run-list-cache.ts — ADR-044 P1: a keyed memo of the single run
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
 * cache keyed off the manifest's and its events.jsonl's own identity — never
 * off time, counters, or queue state alone (ADR-044 rule 2). The DERIVATION
 * itself is untouched: a cache miss calls the exact same `aggregateRun` the
 * uncached path uses (ADR-044 rule 1), so `cachedListRuns` is a
 * byte-identical drop-in for `listRuns`.
 *
 * KEY ASYMMETRY (deliberate, not an oversight): the two inputs are keyed
 * DIFFERENTLY.
 *   - Manifests are keyed on a **sha1 content hash** of the file's raw
 *     bytes, not `mtime`+`size`. Manifests are small (KB-scale) files that
 *     get edited IN PLACE by an operator or the bridge's own write routes;
 *     two different rewrites landing inside the same filesystem mtime tick
 *     with an unchanged byte count (same-second, same-size) would collide
 *     under an mtime+size key and serve stale content. Hashing a KB-scale
 *     file is trivial next to the MB-scale events.jsonl parse this cache
 *     exists to avoid, so there is no reason to accept that collision risk.
 *   - `events.jsonl` stays `mtime`+`size`. It is APPEND-ONLY (ADR-008): size
 *     is monotonically non-decreasing for a given cycle, so a same-second
 *     collision would require rewriting the exact same byte count in place —
 *     a shape this file is never produced in. Hashing every events.jsonl on
 *     every request would re-introduce the MB-scale read cost being avoided.
 *
 * Terminal runs (done/failed/merged) settle into "hit forever" NATURALLY —
 * their manifest and events files stop changing once archived, so the key
 * stays stable — rather than via a queueState special case, which would key
 * invalidation off status instead of the inputs' own identity (the thing
 * rule 2 forbids).
 *
 * Fails open on any doubt (ADR-044 rule 4): a read/stat error on the
 * manifest, or anything other than a confirmed-absent (`ENOENT`) events
 * file, skips the cache entirely for that one manifest and falls through to
 * the same derivation `listRuns` would have produced uncached — a memo can
 * never be the only way to produce the value.
 *
 * BOUNDED GROWTH: every `cachedListRuns` pass evicts any cache entry whose
 * manifest path was NOT seen in that pass's enumeration (a set-diff on the
 * Map's keys) — otherwise an initiative that keeps transiting queue states
 * over the life of a long-running bridge process leaves an ever-growing
 * trail of dead entries under its old paths.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join, resolve } from 'node:path';

import { parseManifest } from '../orchestrator/manifest.ts';
import type { QueueState } from '../orchestrator/queue.ts';
import {
  aggregateRun,
  buildNodeMapping,
  buildFlowNodeSets,
  buildAgentSlugToNodeId,
  makeDegradedRun,
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

// ---------------------------------------------------------------------------
// Injectable I/O seam (test-only)
// ---------------------------------------------------------------------------

type StatFn = (path: string) => { mtimeMs: number; size: number };
type ReadFn = (path: string) => string;

let statImpl: StatFn = (path) => statSync(path);
let readImpl: ReadFn = (path) => readFileSync(path, 'utf8');

/** Test-only: inject a stat implementation (e.g. one that throws for a
 *  specific path) to exercise the ADR-044 rule-4 fail-open path on the
 *  events.jsonl fingerprint deterministically. Pass `null` to restore the
 *  real `statSync`. */
export function _setStatImplForTest(fn: StatFn | null): void {
  statImpl = fn ?? ((path) => statSync(path));
}

/** Test-only: inject a manifest-read implementation (e.g. one that throws
 *  for a specific path) to exercise the ADR-044 rule-4 fail-open path on
 *  the manifest hash deterministically. Pass `null` to restore the real
 *  `readFileSync`. */
export function _setReadImplForTest(fn: ReadFn | null): void {
  readImpl = fn ?? ((path) => readFileSync(path, 'utf8'));
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

/** Test-only: the manifest paths currently held in the memo — used to prove
 *  bounded growth (a manifest that moved queue dirs evicts its old-path
 *  entry rather than accumulating dead rows forever). */
export function _getCachedManifestPathsForTest(): string[] {
  return [...cache.keys()];
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

type StatFingerprint = { mtimeMs: number; size: number };

type CacheKey = {
  queueState: QueueState;
  /** sha1 hex digest of the manifest's raw bytes — see the module header's
   *  KEY ASYMMETRY note for why manifests are content-hashed rather than
   *  mtime+size keyed. */
  manifestHash: string;
  /** null = confirmed-absent events.jsonl (its own key state, e.g. an
   *  in-flight cycle that hasn't emitted its first event yet) — distinct
   *  from a stat ERROR, which fails open instead (see resolveEventsFingerprint). */
  events: StatFingerprint | null;
};

type CacheEntry = { key: CacheKey; run: Run };

// Memory-only, dies with the process (ADR-044 rule 3) — no snapshot file, no
// persisted format. Keyed by manifest path, which already encodes queue
// state + initiative id. Bounded by cachedListRuns's own end-of-pass evict
// step below (a manifest that transitions queue state, or is deleted, drops
// its old-path entry instead of accumulating dead rows forever).
const cache = new Map<string, CacheEntry>();

/** Read the manifest's raw bytes once and hash them — the manifest half of
 *  the cache key. Any read failure (ENOENT race, permission error, …) is
 *  genuine doubt about the manifest itself, signaled via `error: true` so
 *  the caller fails open unconditionally (ADR-044 rule 4); there is no
 *  "confirmed absent" state for a manifest the way there is for events.jsonl
 *  — a manifest readdirSync just enumerated failing to read is always a
 *  race or a real error, never an expected shape. */
function readManifestFingerprint(manifestPath: string): { raw: string; hash: string } | { error: true } {
  try {
    const raw = readImpl(manifestPath);
    const hash = createHash('sha1').update(raw).digest('hex');
    return { raw, hash };
  } catch {
    return { error: true };
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
 *  events component. Takes the manifest's ALREADY-READ raw content (from
 *  readManifestFingerprint) rather than re-reading the file — the manifest
 *  is only ever read once per cachedListRuns pass per manifest. */
function resolveEventsFingerprint(
  root: string,
  queueState: QueueState,
  manifestRaw: string,
): { fp: StatFingerprint | null; error: boolean } {
  if (queueState === 'pending') return { fp: null, error: false };

  let cycleId: string | null;
  try {
    const manifest = parseManifest(manifestRaw);
    cycleId = manifest.cycle_id ?? findNewestCycleId(root, manifest.initiative_id);
  } catch {
    // Manifest unparseable — the derivation path will hit the same failure
    // and degrade; no events file to key on either way.
    return { fp: null, error: false };
  }
  if (!cycleId) return { fp: null, error: false };

  const eventsPath = join(resolve(root), '_logs', cycleId, 'events.jsonl');
  return statOrAbsentOrError(eventsPath);
}

function sameStatFingerprint(a: StatFingerprint | null, b: StatFingerprint | null): boolean {
  if (a === null || b === null) return a === b;
  return a.mtimeMs === b.mtimeMs && a.size === b.size;
}

function sameKey(a: CacheKey, b: CacheKey): boolean {
  return (
    a.queueState === b.queueState &&
    a.manifestHash === b.manifestHash &&
    sameStatFingerprint(a.events, b.events)
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
    // Same degraded-Run constructor listRuns's own per-file catch calls
    // (orchestrator/run-model.ts::makeDegradedRun, exported per ADR-042) —
    // a corrupt or unreadable manifest yields the IDENTICAL degraded shape
    // instead of a hand-duplicated twin that can drift from it.
    const initiativeId = basename(manifestPath).replace(/\.md$/, '');
    return makeDegradedRun(initiativeId, queueState, manifestPath);
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

  // Manifest read/hash failing at all (including ENOENT — a race between
  // readdir and read) is doubt about the manifest itself, not a modeled key
  // state: fail open unconditionally.
  const manifestResult = readManifestFingerprint(manifestPath);
  if ('error' in manifestResult) {
    return deriveFresh(args);
  }

  const eventsResult = resolveEventsFingerprint(forgeRoot, queueState, manifestResult.raw);
  if (eventsResult.error) {
    // A non-ENOENT stat failure on the events file is genuine doubt — never
    // cache it, never treat it as "absent" (ADR-044 rule 4).
    return deriveFresh(args);
  }

  const key: CacheKey = { queueState, manifestHash: manifestResult.hash, events: eventsResult.fp };
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
  // Every manifest path enumerated THIS pass — drives the bounded-growth
  // evict step below, regardless of whether that manifest hit, missed, or
  // fail-opened the cache.
  const seenPaths = new Set<string>();

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
      seenPaths.add(manifestPath);
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

  // Bounded growth: a manifest that transitioned queue state (or was
  // deleted) between passes no longer appears in seenPaths — drop its
  // old-path entry rather than letting the memo grow forever as initiatives
  // churn through queue states over the life of a long-running bridge.
  for (const cachedPath of cache.keys()) {
    if (!seenPaths.has(cachedPath)) cache.delete(cachedPath);
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
