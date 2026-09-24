/**
 * Status derivation — per-node phase status, per-WI status, the gate node's
 * identity, failure attribution, lost-reflection detection, and the
 * cost-ceiling stop outcome. Split out of run-model-derive.ts (bead
 * forge-8vfn.15; see that file's doc comment for the full seam map).
 */
import { REFLECTION_LOST_EVENT } from './cycle-context.ts';
import type { EventLogEntry } from '@forge/kernel';
import { costStreamFacts, sumAuthoritativeCostUsd } from '@forge/kernel';
import type { RunStatus, RunPhaseStatus } from './run-view-types.ts';
import { eventToNodeId } from './run-model-derive-node-id.ts';
import { findDelivered, findLatestWiVerdict } from './run-model-derive-cost.ts';

// ---------------------------------------------------------------------------
// Phase status derivation — the ONE home (the forge-ui mirror it was ported
// from had no consumers and is deleted)
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
  agentSlugToNodeId: Map<string, string>,
): Record<string, RunPhaseStatus> {
  const cycleFailed = runStatus === 'failed';

  const seen = new Map<string, NodeAccum>();

  for (const e of events) {
    const nodeId = eventToNodeId(e.phase, nodeMapping, agentSlugToNodeId, e.metadata);
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
// Work item derivation — ported from apps/studio/lib/wi-status.ts
// ---------------------------------------------------------------------------

export function deriveWorkItems(
  events: readonly EventLogEntry[],
  nodeMapping: Map<string, string | null>,
  agentSlugToNodeId: Map<string, string>,
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
  const devEvents = events.filter((e) => eventToNodeId(e.phase, nodeMapping, agentSlugToNodeId, e.metadata) === 'dev');

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
  const facts = costStreamFacts(events);

  return wiOrder.map((id) => {
    const delivered = findDelivered(events, id); // M5: this WI's own net delta (success-only)
    const costUsd = sumAuthoritativeCostUsd(buckets.get(id) ?? [], facts);
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
  agentSlugToNodeId: Map<string, string>,
): string | undefined {
  let lastNodeId: string | undefined;
  for (const e of events) {
    const nodeId = eventToNodeId(e.phase, nodeMapping, agentSlugToNodeId, e.metadata);
    if (nodeId !== null) lastNodeId = nodeId;
  }
  return lastNodeId;
}

// ---------------------------------------------------------------------------
// Failure info
// ---------------------------------------------------------------------------

export function findFailure(
  events: readonly EventLogEntry[],
  nodeMapping: Map<string, string | null>,
  agentSlugToNodeId: Map<string, string>,
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
      const failedNode = findLastErrorNode(events, i, nodeMapping, agentSlugToNodeId);
      // W8-A2 (ON-7): NO `?? 'unifier'` fallback. The unifier node was retired
      // from the live flow by R4-01-F4 (ADR-039/040) — `forge-develop/flow.yaml`
      // mentions it only in a comment saying it is gone — so defaulting here
      // pointed the operator at a node that exists in no flow. The monitor
      // silently drew no outline (no hex carries that id) and the field
      // misinformed anyone who read it. An unattributable failure now says
      // nothing rather than naming a phase that cannot have failed; every
      // consumer is already null-safe (monitor-layout `run?.failedAt ?? null`,
      // RunControls/RunRail conditional, flow-ledger gates on `status`).
      return {
        ...(failedNode !== null ? { failedAt: failedNode } : {}),
        failNote: reason,
      };
    }
  }

  // Fallback: no `failure_classification` event was ever written — the
  // process died before `emitFailureClassification` ran, or its own
  // best-effort try/catch swallowed a throw (orchestrator/cycle.ts:436-478).
  // ON-7 defect 1: the raw error text is still on disk, one event away, as
  // the last `error` event's `message` (emitted at cycle.ts:257) — derive
  // failNote from THAT instead of leaving a failed run with no reason at
  // all.
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.event_type === 'error' && e.metadata?.expected_fail !== true) {
      const nodeId = eventToNodeId(e.phase, nodeMapping, agentSlugToNodeId, e.metadata);
      // Same rule as the classified branch above — honest absence, never the
      // retired `unifier`.
      return { ...(nodeId !== null ? { failedAt: nodeId } : {}), failNote: truncateFailNote(e.message) };
    }
  }

  return {};
}

/**
 * Bound for a raw error message before it becomes `Run.failNote`. failNote
 * renders inline in two compact, unscrolled UI spots — RunControls.tsx's
 * one-line status span ("Run failed — {failNote}.") and RunRail.tsx's
 * borderless failure div — neither clips or scrolls long text, so an
 * unbounded stack trace or JSON dump would blow out that layout. 300 chars
 * comfortably covers a normal Error.message (almost always a single clause)
 * while capping the worst case. The LEADING text is kept (not the tail)
 * because the head of an error message is its most informative part (e.g.
 * "ENOENT: no such file or directory, open '/very/long/path...'" — what
 * broke is at the front; the rest is detail).
 */
const FAIL_NOTE_MAX_LEN = 300;

function truncateFailNote(message: string | undefined): string | undefined {
  if (typeof message !== 'string' || message.length === 0) return undefined;
  return message.length > FAIL_NOTE_MAX_LEN ? `${message.slice(0, FAIL_NOTE_MAX_LEN)}…` : message;
}

export function findLastErrorNode(
  events: readonly EventLogEntry[],
  beforeIdx: number,
  nodeMapping: Map<string, string | null>,
  agentSlugToNodeId: Map<string, string>,
): string | null {
  for (let i = beforeIdx - 1; i >= 0; i--) {
    if (events[i].event_type === 'error' && events[i].metadata?.expected_fail !== true) {
      return eventToNodeId(events[i].phase, nodeMapping, agentSlugToNodeId, events[i].metadata);
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
// Stop-on-budget outcome (ON-7 defect 2b, W8-A2)
// ---------------------------------------------------------------------------

/**
 * A cost-ceiling stop is a DIFFERENT terminal outcome from an ordinary
 * crash: the flow hit its budget at a clean, resumable phase boundary
 * (flow-budgets.ts CostTracker.checkCeiling) with real work already done —
 * not zero. The manifest still lands in `_queue/failed/` (no new queue
 * state; that's an ask-first architectural change, deliberately parked for
 * this fix), but the operator needs to be able to tell "stopped on budget,
 * N/M work items already complete" apart from "crashed having built
 * nothing".
 *
 * Derived — nothing is stored, so there is no `stoppedOnBudget` boolean for
 * a future writer to forget to set (`derive-status-dont-store-it`, this
 * repo's measured cure for the declared-data-fails-open defect class). The
 * signal is the flow's own structured `flow.cost-ceiling-stop` log event
 * (flow-budgets.ts CostTracker.checkCeiling), emitted with
 * `{spentUsd, ceilingUsd}` at the EXACT instant the tracker decides to
 * throw `CostCeilingError` — its one call site (flow-runner.ts,
 * `costTracker.checkCeiling({ throw: true, ... })`) always requests the
 * throw, so this event firing is synonymous with the flow having crashed
 * via CostCeilingError. Reading the structured numbers off the log event
 * (rather than regex-parsing the human-readable error text) means this
 * never rots if the error message's wording changes.
 *
 * The work-item tally comes from the run's OWN already-derived `workItems`
 * (see `deriveWorkItems` above) — never a second counter, so it can never
 * drift from what the WI hexes themselves already show.
 */
export function deriveStopOnBudget(
  events: readonly EventLogEntry[],
  workItems: readonly { status: RunPhaseStatus }[],
): {
  spentUsd: number;
  ceilingUsd: number;
  resumable: true;
  completedWorkItems: number;
  totalWorkItems: number;
  /** The flow node the run stopped BEFORE — the clean, resumable boundary.
   *  Carried by `flow.cost-ceiling-stop`'s own metadata (`stoppedBeforeNode`),
   *  which the real 2026-08-18 cycle records as `"demo"`. Omitted, never
   *  invented, when the event does not carry it. */
  stoppedBeforeNode?: string;
} | null {
  let stop: { spentUsd: number; ceilingUsd: number; stoppedBeforeNode?: string } | undefined;
  for (const e of events) {
    if (e.message !== 'flow.cost-ceiling-stop' || !e.metadata) continue;
    const { spentUsd, ceilingUsd, stoppedBeforeNode } = e.metadata;
    if (typeof spentUsd === 'number' && typeof ceilingUsd === 'number') {
      stop = {
        spentUsd,
        ceilingUsd,
        ...(typeof stoppedBeforeNode === 'string' ? { stoppedBeforeNode } : {}),
      };
    }
  }
  if (!stop) return null;

  const completedWorkItems = workItems.filter((wi) => wi.status === 'complete').length;
  return {
    spentUsd: stop.spentUsd,
    ceilingUsd: stop.ceilingUsd,
    resumable: true,
    completedWorkItems,
    totalWorkItems: workItems.length,
    ...(stop.stoppedBeforeNode !== undefined ? { stoppedBeforeNode: stop.stoppedBeforeNode } : {}),
  };
}
