/**
 * Aggregate metrics from cycle event logs. Read-only; consumes the JSONL log
 * written by `logging.ts` and produces summaries for `forge metrics` and the
 * monitor.
 */

import type { EventLogEntry, Phase } from '@forge/kernel';
import { isAuthoritativeCostEvent, phasesWithIterationEvents } from '@forge/kernel';
import { guardedReadFile } from '@forge/kernel';

export type CycleMetrics = {
  cycle_id: string;
  initiatives: string[];
  /**
   * G6: autonomous-vs-hand-directed cohort, read from the `cycle.start`
   * event's `origin` metadata (defaults to `architect` for legacy logs
   * without the tag). This lets a metrics consumer answer "did forge get
   * more autonomous" by filtering to `origin === 'architect'` rather than
   * conflating it with hand-directed project surgery.
   */
  origin: 'architect' | 'human-directed';
  total_cost_usd: number;
  total_tokens_in: number;
  total_tokens_out: number;
  total_duration_ms: number;
  iterations_total: number;
  per_phase: Record<Phase, PhaseMetrics>;
  per_skill: Record<string, SkillMetrics>;
  errors: number;
};

export type PhaseMetrics = {
  cost_usd: number;
  iterations: number;
  duration_ms: number;
};

export type SkillMetrics = {
  invocations: number;
  cost_usd: number;
  duration_ms: number;
};

export function summariseCycle(cycleId: string, logsDir = '_logs'): CycleMetrics {
  // SEC-04 (bd forge-ebj, GET /api/cost/<cycleId>): `cycleId` is request-derived
  // and was previously folded straight into `join(resolve(logsDir), cycleId,
  // 'events.jsonl')` with no per-segment containment — a `%2F`-smuggled
  // `../../..` escaped `_logs` entirely, and a symlinked `events.jsonl` leaf (or
  // `_logs/<cycleId>` dir) was FOLLOWED off-root. Route the whole path — leaf
  // included — through `guardedReadFile`: `logsDir` is the TRUSTED root, and
  // `cycleId` rides as its OWN `segments[]` element (never folded into root), so
  // the per-segment identity walk + `nlink` leaf check reject both escapes. A
  // rejected path collapses to `null` indistinguishably from a genuinely absent
  // events.jsonl (no oracle) — both yield the empty-cycle summary the caller
  // already handled for a missing log.
  const raw = guardedReadFile(logsDir, [cycleId, 'events.jsonl'], 'utf8');
  if (raw === null) {
    return emptyCycle(cycleId);
  }
  const events = raw
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as EventLogEntry);
  return aggregate(cycleId, events);
}

// `listCycles` moved to `@forge/kernel` (M4-knowledge s5, ruling 57): a rank-2
// package needed it and may not import flows. Re-exported so this module's
// public surface is unchanged.
export { listCycles } from '@forge/kernel';

export function aggregate(cycleId: string, events: EventLogEntry[]): CycleMetrics {
  const m = emptyCycle(cycleId);
  const initiatives = new Set<string>();

  // Pre-scan: determine which phases emit at least one 'iteration' event.
  // For phases WITH iteration events (developer-loop, unifier) the same dollar
  // amount is re-stated on the per-WI 'ralph.end' AND the phase-level 'end'
  // event — counting all three would triple/double the cost. The rule lives in
  // orchestrator/event-cost.ts (single source, shared with the run model).
  const phasesWithIterations = phasesWithIterationEvents(events);

  for (const e of events) {
    initiatives.add(e.initiative_id);
    // G6: the cohort tag rides on the orchestrator's `cycle.start` event.
    if (e.skill === 'cycle' && e.event_type === 'start') {
      const o = (e.metadata as { origin?: unknown } | undefined)?.origin;
      if (o === 'human-directed' || o === 'architect') m.origin = o;
    }
    m.total_tokens_in += e.tokens_in ?? 0;
    m.total_tokens_out += e.tokens_out ?? 0;
    m.total_duration_ms += e.duration_ms ?? 0;
    if (e.event_type === 'iteration') m.iterations_total += 1;
    if (e.event_type === 'error') m.errors += 1;

    m.per_phase[e.phase] ??= { cost_usd: 0, iterations: 0, duration_ms: 0 };
    m.per_phase[e.phase].duration_ms += e.duration_ms ?? 0;
    if (e.event_type === 'iteration') m.per_phase[e.phase].iterations += 1;

    // Cost attribution: count only the authoritative (non-restating) events
    // per phase. If a phase has iteration events, only those carry the
    // canonical per-turn cost; 'end' events re-state the same dollars and
    // must be excluded. If a phase has no iteration events, its cost is on
    // 'end' events only (count everything). Same rule for per_skill — its
    // old unconditional sum inflated iteration-loop skills 2-3x (item 1.8).
    const countCost = isAuthoritativeCostEvent(e, phasesWithIterations);
    if (countCost) {
      const cost = e.cost_usd ?? 0;
      m.per_phase[e.phase].cost_usd += cost;
      m.total_cost_usd += cost;
    }

    m.per_skill[e.skill] ??= { invocations: 0, cost_usd: 0, duration_ms: 0 };
    if (e.event_type === 'start') m.per_skill[e.skill].invocations += 1;
    if (countCost) m.per_skill[e.skill].cost_usd += e.cost_usd ?? 0;
    m.per_skill[e.skill].duration_ms += e.duration_ms ?? 0;
  }
  m.initiatives = [...initiatives];
  return m;
}

function emptyCycle(cycleId: string): CycleMetrics {
  return {
    cycle_id: cycleId,
    initiatives: [],
    origin: 'architect',
    total_cost_usd: 0,
    total_tokens_in: 0,
    total_tokens_out: 0,
    total_duration_ms: 0,
    iterations_total: 0,
    per_phase: {} as Record<Phase, PhaseMetrics>,
    per_skill: {},
    errors: 0,
  };
}
