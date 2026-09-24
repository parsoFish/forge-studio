/**
 * Per-node metadata derivation: "what did this run cost" (bead forge-8vfn.15
 * size split — see design.md).
 */
import type { EventLogEntry } from '@forge/kernel';
import { sumAuthoritativeCostUsd } from '@forge/kernel';
import type { RunPhaseMeta } from './run-view-types.ts';
import { eventToNodeId } from './run-model-derive-node-id.ts';

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
// Per-node metadata derivation
// ---------------------------------------------------------------------------

export function deriveNodeMeta(
  events: readonly EventLogEntry[],
  iterationBudget: number,
  nowMs: number,
  nodeMapping: Map<string, string | null>,
  agentSlugToNodeId: Map<string, string>,
): Record<string, RunPhaseMeta> {
  // Bucket events by nodeId
  const buckets = new Map<string, EventLogEntry[]>();
  for (const e of events) {
    const nodeId = eventToNodeId(e.phase, nodeMapping, agentSlugToNodeId, e.metadata);
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

  // Live-log freshness (R6-01 WI-1 F1): over EVERY event in this node's own
  // bucket (already attributed via eventToNodeId, same bucket lastProgressAt
  // reads) — NOT filtered to PROGRESS_EVENT_TYPES, so a node narrating only
  // via 'log'/'error' events still reports freshness.
  const lastEventAt = computeLastEventAt(events);

  // Iteration tracking (dev node)
  const { iter, iterBudget } = computeIterations(nodeId, events, iterationBudget);

  // Delivered (dev node — from dev-loop.delivered message)
  const delivered = nodeId === 'dev' ? findDelivered(events) : undefined;

  // GateChecks (unifier node — from unifier.gate.sub-check messages)
  const gateChecks = nodeId === 'unifier' ? findGateChecks(events) : undefined;

  // Findings (R6-05 WI-1: adversarial-review node only — from
  // review.findings.authored events, latest wins, honest-absent otherwise)
  const findings = nodeId === 'adversarial-review' ? findFindings(events) : undefined;

  const meta: RunPhaseMeta = {
    costUsd,
    retries,
    wedged,
  };

  if (model !== undefined) meta.model = model;
  if (lastProgressAt !== undefined) meta.lastProgressAt = lastProgressAt;
  if (lastEventAt !== undefined) meta.lastEventAt = lastEventAt;
  if (brainReads > 0) meta.brainReads = brainReads;
  if (iter !== undefined) meta.iter = iter;
  if (iterBudget !== undefined) meta.iterBudget = iterBudget;
  if (delivered !== undefined) meta.delivered = delivered;
  if (gateChecks !== undefined && gateChecks.length > 0) meta.gateChecks = gateChecks;
  if (findings !== undefined) meta.findings = findings;

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

/**
 * R6-01 WI-1 F1: the latest `started_at` across ALL events in this node's
 * bucket — deliberately unfiltered (unlike computeProgress's
 * PROGRESS_EVENT_TYPES gate), since the whole point of this field is to
 * advance on 'log'/'error'/'start'/etc events that lastProgressAt ignores.
 * Same lexicographic-max-over-ISO-strings technique as computeProgress.
 */
export function computeLastEventAt(events: readonly EventLogEntry[]): string | undefined {
  let lastEventAt: string | undefined;
  for (const e of events) {
    if (lastEventAt === undefined || e.started_at > lastEventAt) {
      lastEventAt = e.started_at;
    }
  }
  return lastEventAt;
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
 *
 * Exported so run-model-derive-status.ts's `deriveWorkItems` can call it.
 */
export function findLatestWiVerdict(
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

/**
 * R6-05 WI-1: the adversarial-review node's finding-count summary, derived
 * from the LATEST `review.findings.authored` event on this node's own event
 * bucket (never summed across retries, never the first/stale one — a
 * re-review's counts supersede the earlier pass's). Extracts ONLY the five
 * numeric count fields by name — never a spread of the event's metadata —
 * so the event's `path`/`head_sha`/`agent_slug` string keys can never leak
 * into what must be a pure numeric summary (orchestrator/phases/
 * adversarial-review.ts:330-332 emits all seven keys on the wire).
 */
export function findFindings(
  events: readonly EventLogEntry[],
): { total: number; blocker: number; major: number; minor: number; info: number } | undefined {
  let result: { total: number; blocker: number; major: number; minor: number; info: number } | undefined;
  for (const e of events) {
    if (e.message !== 'review.findings.authored' || !e.metadata) continue;
    const m = e.metadata;
    const { total, blocker, major, minor, info } = m;
    if (
      typeof total === 'number' &&
      typeof blocker === 'number' &&
      typeof major === 'number' &&
      typeof minor === 'number' &&
      typeof info === 'number'
    ) {
      result = { total, blocker, major, minor, info };
    }
  }
  return result;
}
