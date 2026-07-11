/**
 * Forge Studio — Run Derivation Helpers (M1-1, ADR-027/028)
 *
 * Pure derivation functions extracted from run-model.ts. All functions here
 * are internal implementation details of the run aggregator; nothing in this
 * file is part of the public run-aggregation API (aggregateRun / listRuns /
 * buildNodeMapping / Run types all live in run-model.ts).
 *
 * Responsibility boundaries:
 *   - Phase status derivation  (ported from forge-ui/lib/phases.ts)
 *   - Per-node metadata derivation
 *   - Work item status derivation (ported from forge-ui/lib/wi-status.ts)
 *   - Artifact detection
 *   - Gate node identity + note extraction
 *   - Failure info extraction
 *   - eventToNodeId mapping helper
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REFLECTION_LOST_EVENT } from './cycle-context.ts';
import type { EventLogEntry } from './logging.ts';
import type { RunStatus, RunPhaseStatus, RunPhaseMeta, Run } from './run-model.ts';
import { phasesWithIterationEvents, sumAuthoritativeCostUsd } from './event-cost.ts';

// ---------------------------------------------------------------------------
// Constants (used by derivation helpers only)
// ---------------------------------------------------------------------------

/** Progress event types that update lastProgressAt / determine wedge */
export const PROGRESS_EVENT_TYPES = new Set([
  'tool_use', 'file_change', 'test_run', 'iteration',
]);

/** 30 minutes in ms */
export const WEDGE_THRESHOLD_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// Phase status derivation — ported from forge-ui/lib/phases.ts
// ---------------------------------------------------------------------------

type NodeAccum = {
  lastAt: string;
  ended: boolean;
  errored: boolean;
  endFailed: boolean;
};

export function deriveNodeStatuses(
  events: readonly EventLogEntry[],
  runStatus: RunStatus,
  nodeMapping: Map<string, string | null>,
): Record<string, RunPhaseStatus> {
  const cycleFailed = runStatus === 'failed';

  const seen = new Map<string, NodeAccum>();

  for (const e of events) {
    const nodeId = eventToNodeId(e.phase, nodeMapping);
    if (nodeId === null) continue;

    const acc = seen.get(nodeId) ?? {
      lastAt: e.started_at,
      ended: false,
      errored: false,
      endFailed: false,
    };

    acc.lastAt = e.started_at;

    // Per-WI end events do NOT end the dev phase
    const isPerWiEnd = e.event_type === 'end' && typeof e.metadata?.work_item_id === 'string';
    if (e.event_type === 'end' && !isPerWiEnd) {
      acc.ended = true;
      if (endMetaIndicatesFailure(e.metadata)) acc.endFailed = true;
    }

    if (e.event_type === 'error' && e.metadata?.expected_fail !== true) {
      acc.errored = true;
    }

    seen.set(nodeId, acc);
  }

  const result: Record<string, RunPhaseStatus> = {};

  for (const [nodeId, acc] of seen) {
    if (acc.ended) {
      result[nodeId] = acc.endFailed ? 'failed' : 'complete';
    } else if (acc.errored) {
      result[nodeId] = cycleFailed ? 'failed' : 'retrying';
    } else {
      result[nodeId] = 'active';
    }
  }

  return result;
}

export function endMetaIndicatesFailure(meta: EventLogEntry['metadata']): boolean {
  if (!meta) return false;
  if (meta.resumed === true) return false;
  if (meta.status === 'failed') return true;
  if (typeof meta.failed === 'number' && meta.failed > 0) return true;
  if (
    typeof meta.work_item_count === 'number' && meta.work_item_count > 0 &&
    typeof meta.complete === 'number' && meta.complete < meta.work_item_count
  ) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Per-node metadata derivation
// ---------------------------------------------------------------------------

export function deriveNodeMeta(
  events: readonly EventLogEntry[],
  iterationBudget: number,
  nowMs: number,
  nodeMapping: Map<string, string | null>,
): Record<string, RunPhaseMeta> {
  // Bucket events by nodeId
  const buckets = new Map<string, EventLogEntry[]>();
  for (const e of events) {
    const nodeId = eventToNodeId(e.phase, nodeMapping);
    if (nodeId === null) continue;
    if (!buckets.has(nodeId)) buckets.set(nodeId, []);
    buckets.get(nodeId)!.push(e);
  }

  const result: Record<string, RunPhaseMeta> = {};

  for (const [nodeId, nodeEvents] of buckets) {
    result[nodeId] = buildNodeMeta(nodeId, nodeEvents, iterationBudget, nowMs);
  }

  return result;
}

export function buildNodeMeta(
  nodeId: string,
  events: readonly EventLogEntry[],
  iterationBudget: number,
  nowMs: number,
): RunPhaseMeta {
  // Cost — authoritative rule (item 1.8, orchestrator/event-cost.ts): an
  // iteration-loop phase restates its iteration spend on per-WI + phase-level
  // 'end' events; the old naive sum inflated the Studio phase-hex cost badge
  // (data-phase-cost-usd) 2-3x for developer-loop/unifier nodes.
  const costUsd = sumAuthoritativeCostUsd(events);

  // Model (first event with metadata.model)
  const model = findModel(events);

  // Brain reads: pm.brain-query messages + brain-query event_type + tool_use reading brain/
  const brainReads = countBrainReads(events);

  // retries: gate.fail count for dev; error events for others
  const retries = nodeId === 'dev'
    ? countGateFails(events)
    : events.filter((e) => e.event_type === 'error' && e.metadata?.expected_fail !== true).length;

  // Progress tracking (lastProgressAt, wedged)
  const { lastProgressAt, wedged } = computeProgress(events, nowMs);

  // Iteration tracking (dev node)
  const { iter, iterBudget } = computeIterations(nodeId, events, iterationBudget);

  // Delivered (dev node — from dev-loop.delivered message)
  const delivered = nodeId === 'dev' ? findDelivered(events) : undefined;

  // GateChecks (unifier node — from unifier.gate.sub-check messages)
  const gateChecks = nodeId === 'unifier' ? findGateChecks(events) : undefined;

  const meta: RunPhaseMeta = {
    costUsd,
    retries,
    wedged,
  };

  if (model !== undefined) meta.model = model;
  if (lastProgressAt !== undefined) meta.lastProgressAt = lastProgressAt;
  if (brainReads > 0) meta.brainReads = brainReads;
  if (iter !== undefined) meta.iter = iter;
  if (iterBudget !== undefined) meta.iterBudget = iterBudget;
  if (delivered !== undefined) meta.delivered = delivered;
  if (gateChecks !== undefined && gateChecks.length > 0) meta.gateChecks = gateChecks;

  return meta;
}

export function findModel(events: readonly EventLogEntry[]): string | undefined {
  for (const e of events) {
    const model = e.metadata?.model;
    if (typeof model === 'string') return model;
  }
  return undefined;
}

export function countBrainReads(events: readonly EventLogEntry[]): number {
  let count = 0;
  for (const e of events) {
    if (e.event_type === 'brain-query') { count++; continue; }
    if (e.message === 'pm.brain-query') { count++; continue; }
    // tool_use events reading from brain/ paths
    if (e.event_type === 'tool_use') {
      const inputSummary = e.metadata?.input_summary;
      const summary = typeof inputSummary === 'string' ? inputSummary : '';
      if (summary.includes('brain/')) count++;
    }
  }
  return count;
}

export function countGateFails(events: readonly EventLogEntry[]): number {
  return events.filter((e) => e.message === 'gate.fail').length;
}

export function computeProgress(
  events: readonly EventLogEntry[],
  nowMs: number,
): { lastProgressAt?: string; wedged: boolean } {
  let lastProgressAt: string | undefined;

  for (const e of events) {
    if (PROGRESS_EVENT_TYPES.has(e.event_type)) {
      if (lastProgressAt === undefined || e.started_at > lastProgressAt) {
        lastProgressAt = e.started_at;
      }
    }
  }

  if (lastProgressAt === undefined) {
    return { wedged: false };
  }

  const ageMs = nowMs - new Date(lastProgressAt).getTime();
  return { lastProgressAt, wedged: ageMs >= WEDGE_THRESHOLD_MS };
}

export function computeIterations(
  nodeId: string,
  events: readonly EventLogEntry[],
  iterationBudget: number,
): { iter?: number; iterBudget?: number } {
  if (nodeId !== 'dev') return {};

  // iter: latest iteration event's iteration field (or ralph.end iterations)
  let iter: number | undefined;

  for (const e of events) {
    if (e.event_type === 'iteration' && typeof e.iteration === 'number') {
      if (iter === undefined || e.iteration > iter) {
        iter = e.iteration;
      }
    }
    if (e.message === 'ralph.end') {
      const iterations = e.metadata?.iterations;
      if (typeof iterations === 'number') {
        if (iter === undefined || iterations > iter) iter = iterations;
      }
    }
  }

  return {
    iter,
    iterBudget: iter !== undefined ? iterationBudget : undefined,
  };
}

/**
 * Internal: the WI's (or the cycle-level aggregate's) most recent delivery
 * VERDICT — the last `dev-loop.delivered` or `dev-loop.discarded` event in
 * array order, whichever message it actually is. Message-agnostic on
 * purpose: a WI can be resumed/reworked, so its delivery message can flip
 * either direction across attempts (discarded→delivered on a successful
 * retry, or delivered→discarded if a later rework attempt fails) — only the
 * LATEST verdict is ever the true state. Matching strictly on one message
 * name (as `findDelivered` alone used to) makes a later `dev-loop.discarded`
 * invisible to a backward scan and falls through to a STALE earlier
 * `dev-loop.delivered`; `deriveWorkItems`' crash-retry override needs the
 * latest verdict's stats regardless of which message carries them. See
 * brain/cycles/themes/2026-07-11-dev-loop-delivered-event-fires-for-failed-
 * wi.md.
 *
 * Only the crash-retry override in `deriveWorkItems` uses this now —
 * `findDelivered` (below) needs a different scan (it must see PAST a
 * trivial all-zero `dev-loop.delivered` re-run to an earlier meaningful one,
 * whereas the override only cares whether the WI's single latest verdict
 * carries any commits at all) so it no longer delegates to this helper.
 */
function findLatestWiVerdict(
  events: readonly EventLogEntry[],
  wiId?: string,
): { message: 'dev-loop.delivered' | 'dev-loop.discarded'; outcome?: string; files: number; insertions: number; commits: number } | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.message !== 'dev-loop.delivered' && e.message !== 'dev-loop.discarded') continue;
    if (!e.metadata) continue;
    const m = e.metadata;
    // M5: a wiId selects that WI's per-WI event; the phase aggregate (no
    // wiId) selects the cycle-level summary (the one without work_item_id).
    if (wiId !== undefined) {
      if (m.work_item_id !== wiId) continue;
    } else if (typeof m.work_item_id === 'string') {
      continue;
    }
    // Accept both files_changed and files
    const files =
      typeof m.files_changed === 'number' ? m.files_changed :
      typeof m.files === 'number' ? m.files : 0;
    const insertions = typeof m.insertions === 'number' ? m.insertions : 0;
    const commits = typeof m.commits === 'number' ? m.commits : 0;
    const outcome = typeof m.outcome === 'string' ? m.outcome : undefined;
    return { message: e.message as 'dev-loop.delivered' | 'dev-loop.discarded', outcome, files, insertions, commits };
  }
  return undefined;
}

/**
 * Phase 4/2 (honest delivery events): `findDelivered` treats delivery as
 * SUCCESS-ONLY, scanning backward through the WI's (or the cycle
 * aggregate's) `dev-loop.delivered`/`dev-loop.discarded` events for the
 * latest MEANINGFUL verdict:
 *
 *   - A `dev-loop.discarded` event — or a `dev-loop.delivered` event whose
 *     explicit `outcome` isn't `'complete'` (defense-in-depth) — is decisive:
 *     the WI is not delivered, full stop. Per the ordering guarantee this
 *     also establishes, it is never overridden by falling through to an
 *     earlier, now-stale `dev-loop.delivered` event.
 *   - A `dev-loop.delivered` event with a genuine (non-zero) diff is the
 *     WI's delivered stat.
 *   - A `dev-loop.delivered` event whose diff is ALL ZERO carries no
 *     information — a dev-loop re-run after the PR is already open can
 *     emit a harmless 0/0/0 `dev-loop.delivered` for a WI that already
 *     shipped real work (brain/cycles/themes/2026-07-03-duplicate-dev-loop-
 *     after-pr-open.md) — so the scan continues PAST it to find the last
 *     meaningful delivered stat, same as the pre-Phase-4/2 baseline did.
 *     FIX ROUND 2: an earlier version of this function delegated to
 *     `findLatestWiVerdict` (single latest event, no zero-diff skip), which
 *     regressed this exact case — a trivial zero-diff re-run silently
 *     erased a real earlier delivery.
 *
 * See brain/cycles/themes/2026-07-11-dev-loop-delivered-event-fires-for-
 * failed-wi.md.
 */
export function findDelivered(
  events: readonly EventLogEntry[],
  wiId?: string,
): { files: number; insertions: number; commits: number } | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.message !== 'dev-loop.delivered' && e.message !== 'dev-loop.discarded') continue;
    if (!e.metadata) continue;
    const m = e.metadata;
    // M5: a wiId selects that WI's per-WI event; the phase aggregate (no
    // wiId) selects the cycle-level summary (the one without work_item_id).
    if (wiId !== undefined) {
      if (m.work_item_id !== wiId) continue;
    } else if (typeof m.work_item_id === 'string') {
      continue;
    }
    // A discarded verdict is decisive — never delivered, never overridden
    // by an earlier delivered event.
    if (e.message === 'dev-loop.discarded') return undefined;
    const outcome = typeof m.outcome === 'string' ? m.outcome : undefined;
    if (outcome !== undefined && outcome !== 'complete') return undefined;
    // Accept both files_changed and files
    const files =
      typeof m.files_changed === 'number' ? m.files_changed :
      typeof m.files === 'number' ? m.files : 0;
    const insertions = typeof m.insertions === 'number' ? m.insertions : 0;
    const commits = typeof m.commits === 'number' ? m.commits : 0;
    if (files === 0 && insertions === 0 && commits === 0) continue; // non-informative — keep scanning for the last meaningful delivered stat
    return { files, insertions, commits };
  }
  return undefined;
}

export function findGateChecks(
  events: readonly EventLogEntry[],
): { id: string; pass: boolean; detail?: string }[] {
  const checks: { id: string; pass: boolean; detail?: string }[] = [];
  for (const e of events) {
    if (e.message === 'unifier.gate.sub-check' && e.metadata) {
      const m = e.metadata;
      const checkId = m.check_id;
      const pass = m.pass;
      const detail = m.detail;
      if (typeof checkId === 'string' && typeof pass === 'boolean') {
        checks.push({
          id: checkId,
          pass,
          ...(typeof detail === 'string' ? { detail } : {}),
        });
      }
    }
  }
  return checks;
}

// ---------------------------------------------------------------------------
// Work item derivation — ported from forge-ui/lib/wi-status.ts
// ---------------------------------------------------------------------------

export function deriveWorkItems(
  events: readonly EventLogEntry[],
  nodeMapping: Map<string, string | null>,
): { id: string; status: RunPhaseStatus; costUsd: number; task?: string; dependsOn?: string[]; delivered?: { files: number; insertions: number; commits: number } }[] {
  // Collect WI ids in order of first appearance
  const wiOrder: string[] = [];
  const wiIdSet = new Set<string>();

  for (const e of events) {
    const wiId = e.metadata?.work_item_id;
    // Only dev WIs (WI-*) are hexes here. Unifier items (UWI-*) are the unifier
    // node's own work — surfaced via that node's gateChecks, not as dev hexes;
    // including them produced a phantom always-'pending' UWI hex (no dev events).
    if (typeof wiId === 'string' && wiId.startsWith('WI-') && !wiIdSet.has(wiId)) {
      wiOrder.push(wiId);
      wiIdSet.add(wiId);
    }
  }

  if (wiOrder.length === 0) return [];

  // Per-WI spec (#11 observability) — task line + dependency edges, captured from
  // the PM's `pm.work-item-emitted` events (the only place the WI's deps/ACs exist
  // in the event stream). Feeds the hex-detail drawer + the WI dependency graph.
  const wiSpec = new Map<string, { task?: string; dependsOn?: string[] }>();
  for (const e of events) {
    if (e.message !== 'pm.work-item-emitted') continue;
    const id = e.metadata?.work_item_id;
    if (typeof id !== 'string') continue;
    const m = e.metadata ?? {};
    const deps = Array.isArray(m.depends_on)
      ? (m.depends_on as unknown[]).filter((x): x is string => typeof x === 'string')
      : undefined;
    wiSpec.set(id, { task: typeof m.task === 'string' ? m.task : undefined, dependsOn: deps });
  }

  // Only dev-phase events are relevant for per-WI status
  const devEvents = events.filter((e) => eventToNodeId(e.phase, nodeMapping) === 'dev');

  const LIFECYCLE_TYPES = new Set(['start', 'iteration', 'tool_use', 'end', 'error']);

  const buckets = new Map<string, EventLogEntry[]>();
  for (const id of wiOrder) buckets.set(id, []);
  for (const e of devEvents) {
    const wiId = e.metadata?.work_item_id;
    if (typeof wiId !== 'string') continue;
    if (!LIFECYCLE_TYPES.has(e.event_type)) continue;
    // Only events that match a known WI
    const bucket = buckets.get(wiId);
    if (bucket) bucket.push(e);
  }

  // Per-WI cost (item 1.4): WI-scoped iteration events carry the authoritative
  // spend (metadata.work_item_id rides on each dev-loop iteration event). The
  // iteration-phase set is derived from the WHOLE stream — not the WI bucket —
  // so a WI that crashed before iterating never counts a restated 'end'
  // rollup the phase badge excludes (event-cost.ts rule; feeds the WI hex's
  // data-wi-cost-usd, mirroring data-phase-cost-usd).
  const iterationPhases = phasesWithIterationEvents(events);

  return wiOrder.map((id) => {
    const delivered = findDelivered(events, id); // M5: this WI's own net delta (success-only)
    const costUsd = sumAuthoritativeCostUsd(buckets.get(id) ?? [], iterationPhases);
    let status = wiStatusFor(buckets.get(id) ?? []);
    // A WI that auto-committed real work then crashed (or is on a later
    // retry) is recoverable, not a red failure — show 'retrying'. Phase 4/2
    // routes a non-'complete' WI's diff-stat to `dev-loop.discarded` instead
    // of `dev-loop.delivered`, so `findDelivered` (success-only, above)
    // never sees it — the override must read the WI's LATEST verdict
    // directly, regardless of which of the two messages carries it, or a
    // WI that crashed after committing real work is misread as a hard
    // failure. See brain/cycles/themes/2026-07-11-dev-loop-delivered-event-
    // fires-for-failed-wi.md.
    if (status === 'failed') {
      const verdict = findLatestWiVerdict(events, id);
      if (verdict !== undefined && verdict.commits > 0) {
        status = 'retrying';
      }
    }
    return { id, status, costUsd, ...wiSpec.get(id), delivered };
  });
}

export function wiStatusFor(events: readonly EventLogEntry[]): RunPhaseStatus {
  if (events.length === 0) return 'pending';

  const lastEndIdx = lastIndexOfType(events, 'end');
  const lastStartIdx = lastIndexOfType(events, 'start');

  if (lastEndIdx >= 0 && lastEndIdx > lastStartIdx) {
    const status = events[lastEndIdx].metadata?.status;
    if (status === 'failed') return 'failed';
    if (status === 'complete') return 'complete';
    return hasErrorBetween(events, lastStartIdx, lastEndIdx) ? 'failed' : 'complete';
  }

  if (lastStartIdx >= 0) {
    const erroredSinceStart = hasErrorBetween(events, lastStartIdx, events.length);
    const reattempt = lastEndIdx >= 0 && lastEndIdx < lastStartIdx;
    if (erroredSinceStart || reattempt) return 'retrying';
  }
  return 'active';
}

export function lastIndexOfType(events: readonly EventLogEntry[], type: string): number {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].event_type === type) return i;
  }
  return -1;
}

export function hasErrorBetween(events: readonly EventLogEntry[], afterIdx: number, beforeIdx: number): boolean {
  for (let i = afterIdx + 1; i < beforeIdx; i++) {
    if (events[i].event_type !== 'error') continue;
    if (events[i].metadata?.expected_fail === true) continue;
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Artifact detection
// ---------------------------------------------------------------------------

export function deriveArtifacts(
  logDir: string,
  root: string,
  runStatus: RunStatus,
  initiativeId: string,
  hasReflectionEvents = false,
): Run['artifactsReady'] {
  const artifacts: Run['artifactsReady'] = {};
  const artifactsDir = join(logDir, 'artifacts');
  const mode = (runStatus === 'gated') ? 'gate' : 'view';

  // plan: PLAN.html in artifacts/
  if (existsSync(join(artifactsDir, 'PLAN.html'))) {
    artifacts['plan'] = 'view'; // plan is always view-only
  }

  // work-items: work-items-snapshot/ non-empty
  const wiSnapshotDir = join(logDir, 'work-items-snapshot');
  if (existsSync(wiSnapshotDir)) {
    try {
      const files = readdirSync(wiSnapshotDir).filter((f) => f.endsWith('.md'));
      if (files.length > 0) artifacts['work-items'] = 'view';
    } catch { /* ignore */ }
  }

  // pr: pr-description.md. New cycles mirror it into artifacts/ (same dir the
  // bridge route serves from); accept the legacy cycle-log-root location too so
  // older frozen logs still resolve.
  if (
    existsSync(join(artifactsDir, 'pr-description.md')) ||
    existsSync(join(logDir, 'pr-description.md'))
  ) {
    artifacts['pr'] = mode;
  }

  // demo: artifacts/demo.json
  if (existsSync(join(artifactsDir, 'demo.json'))) {
    artifacts['demo'] = mode;
  }

  // verdict: <initiativeId>.verdict-response.md in any queue dir (walk up)
  const verdictFile = `${initiativeId}.verdict-response.md`;
  const queueRoot = join(resolve(root), '_queue');
  for (const state of ['done', 'failed', 'ready-for-review', 'pending', 'in-flight']) {
    if (existsSync(join(queueRoot, state, verdictFile))) {
      artifacts['verdict'] = 'view';
      break;
    }
  }

  // reflection: present when reflector events exist in the event log
  if (hasReflectionEvents) {
    artifacts['reflection'] = 'view';
  }

  return artifacts;
}

// ---------------------------------------------------------------------------
// Gate node identity
// ---------------------------------------------------------------------------

/**
 * G9: the node id actually holding the gate, derived from the run's own
 * event trail rather than assumed. A run reaches queueState `ready-for-review`
 * (RunStatus 'gated') after its last node parked awaiting an operator verdict
 * — for the seed forge-develop flow that is always the `review` node
 * (review-loop + closure both fold into it, per CANONICAL_PHASE_OVERRIDES),
 * but a user-authored flow (ADR-028) can name its gate node anything, and a
 * flow with no review node at all (e.g. an architect hand-off parking in the
 * same queue state) has no review gate to report. Trusting the last event
 * whose phase resolves to a real node — the same array-order trust
 * `deriveNodeStatuses` already places in `events` — names the node honestly
 * instead of hardcoding the seed flow's node id.
 */
export function findGateNodeId(
  events: readonly EventLogEntry[],
  nodeMapping: Map<string, string | null>,
): string | undefined {
  let lastNodeId: string | undefined;
  for (const e of events) {
    const nodeId = eventToNodeId(e.phase, nodeMapping);
    if (nodeId !== null) lastNodeId = nodeId;
  }
  return lastNodeId;
}

// ---------------------------------------------------------------------------
// Gate note
// ---------------------------------------------------------------------------

export function findGateNote(logDir: string): string {
  const prPath = join(logDir, 'pr-description.md');
  if (existsSync(prPath)) {
    try {
      const content = readFileSync(prPath, 'utf8');
      const match = content.match(/^#+ (.+)/m);
      if (match) return match[1].trim();
    } catch { /* ignore */ }
  }
  return 'Awaiting operator verdict';
}

// ---------------------------------------------------------------------------
// Failure info
// ---------------------------------------------------------------------------

export function findFailure(
  events: readonly EventLogEntry[],
  nodeMapping: Map<string, string | null>,
): {
  failedAt?: string;
  failNote?: string;
} {
  // Find failure_classification event
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.message === 'failure_classification' && e.metadata) {
      const m = e.metadata;
      const reason = typeof m.reason === 'string' ? m.reason : undefined;
      // Find the node of the last error event before this classifier
      const failedNode = findLastErrorNode(events, i, nodeMapping);
      return {
        failedAt: failedNode ?? 'unifier',
        failNote: reason,
      };
    }
  }

  // Fallback: last error event's node
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.event_type === 'error' && e.metadata?.expected_fail !== true) {
      const nodeId = eventToNodeId(e.phase, nodeMapping);
      return { failedAt: nodeId ?? 'unifier' };
    }
  }

  return {};
}

export function findLastErrorNode(
  events: readonly EventLogEntry[],
  beforeIdx: number,
  nodeMapping: Map<string, string | null>,
): string | null {
  for (let i = beforeIdx - 1; i >= 0; i--) {
    if (events[i].event_type === 'error' && events[i].metadata?.expected_fail !== true) {
      return eventToNodeId(events[i].phase, nodeMapping);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reflection-loss info (2.10 reflector pipeline honesty)
// ---------------------------------------------------------------------------

/**
 * Detect a lost reflection on a merged cycle so Studio surfaces it distinctly
 * (ten July cycles closed as done with reflection silently missing).
 *
 * Two signals, in priority order:
 *
 * 1. An explicit `cycle.reflection-lost` event (emitted by the reflector /
 *    its callers at the moment of loss) with no LATER reflection `end` —
 *    a later end means a rerun (`forge reflect --rerun`, boot reconcile)
 *    recovered it, which clears the flag.
 * 2. The stranded case: the queue says complete (manifest in `_queue/done/`),
 *    reflection STARTED but never emitted any `end`, and the cycle has gone
 *    quiet past the wedge threshold — a SIGKILL / Studio restart leaves no
 *    event to find, so the loss is inferred. (`reflector.skipped-disposable`
 *    is an `end` event, so deliberate skips never trip this.)
 *
 * A never-started reflection (killed between merge and reflector.start) has
 * no runtime trace at all — that gap stays covered archive-side by
 * `forge brain lint`'s checkReflectorLoss (plan 1.9).
 */
export function findReflectionLoss(
  events: readonly EventLogEntry[],
  opts: { queueComplete: boolean; isStale: boolean },
): { cause: string; note?: string } | undefined {
  let lastLost: { idx: number; cause: string; note?: string } | undefined;
  let lastEndIdx = -1;
  let sawReflectionEvent = false;

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.phase !== 'reflection') continue;
    sawReflectionEvent = true;
    if (e.event_type === 'end') {
      lastEndIdx = i;
      continue;
    }
    if (e.message === REFLECTION_LOST_EVENT) {
      const cause = typeof e.metadata?.cause === 'string' ? e.metadata.cause : 'unknown';
      const note = typeof e.metadata?.detail === 'string' ? e.metadata.detail : undefined;
      lastLost = { idx: i, cause, note };
    }
  }

  if (lastLost !== undefined && lastLost.idx > lastEndIdx) {
    return { cause: lastLost.cause, note: lastLost.note };
  }
  if (lastLost === undefined && opts.queueComplete && opts.isStale && sawReflectionEvent && lastEndIdx === -1) {
    return {
      cause: 'interrupted',
      note: 'reflector started but never completed and the cycle went quiet — likely killed (Studio restart / SIGKILL)',
    };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Shared low-level helper
// ---------------------------------------------------------------------------

export function eventToNodeId(phase: string, nodeMapping: Map<string, string | null>): string | null {
  // An explicit mapping entry wins — including an explicit `null` (orchestrator
  // and brain are deliberately ignored for phase status).
  if (nodeMapping.has(phase)) return nodeMapping.get(phase) ?? null;
  // Otherwise the event names its own node. For user-authored flows (ADR-028 /
  // J5) the agent slug = node id = event phase, so a run surfaces statuses on
  // the right hexes without the canonical seed-flow mapping knowing them.
  return phase;
}
