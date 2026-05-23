/**
 * Aggregate metrics from cycle event logs. Read-only; consumes the JSONL log
 * written by `logging.ts` and produces summaries for `forge metrics` and the
 * monitor.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { EventLogEntry, Phase } from '../orchestrator/logging.ts';

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
  const path = join(resolve(logsDir), cycleId, 'events.jsonl');
  if (!existsSync(path)) {
    return emptyCycle(cycleId);
  }
  const events = readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as EventLogEntry);
  return aggregate(cycleId, events);
}

export function listCycles(logsDir = '_logs'): string[] {
  const dir = resolve(logsDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

export function summariseAll(logsDir = '_logs'): CycleMetrics[] {
  return listCycles(logsDir).map((id) => summariseCycle(id, logsDir));
}

function aggregate(cycleId: string, events: EventLogEntry[]): CycleMetrics {
  const m = emptyCycle(cycleId);
  const initiatives = new Set<string>();
  for (const e of events) {
    initiatives.add(e.initiative_id);
    // G6: the cohort tag rides on the orchestrator's `cycle.start` event.
    if (e.skill === 'cycle' && e.event_type === 'start') {
      const o = (e.metadata as { origin?: unknown } | undefined)?.origin;
      if (o === 'human-directed' || o === 'architect') m.origin = o;
    }
    m.total_cost_usd += e.cost_usd ?? 0;
    m.total_tokens_in += e.tokens_in ?? 0;
    m.total_tokens_out += e.tokens_out ?? 0;
    m.total_duration_ms += e.duration_ms ?? 0;
    if (e.event_type === 'iteration') m.iterations_total += 1;
    if (e.event_type === 'error') m.errors += 1;

    m.per_phase[e.phase] ??= { cost_usd: 0, iterations: 0, duration_ms: 0 };
    m.per_phase[e.phase].cost_usd += e.cost_usd ?? 0;
    m.per_phase[e.phase].duration_ms += e.duration_ms ?? 0;
    if (e.event_type === 'iteration') m.per_phase[e.phase].iterations += 1;

    m.per_skill[e.skill] ??= { invocations: 0, cost_usd: 0, duration_ms: 0 };
    if (e.event_type === 'start') m.per_skill[e.skill].invocations += 1;
    m.per_skill[e.skill].cost_usd += e.cost_usd ?? 0;
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
