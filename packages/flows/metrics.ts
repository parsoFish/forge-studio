/**
 * Aggregate metrics from cycle event logs. Read-only; consumes the JSONL log
 * written by `logging.ts` and produces summaries for `forge metrics` and the
 * monitor.
 */

import type { EventLogEntry, Phase } from '@forge/kernel';
import { costStreamFacts, countsTowardCost } from '@forge/kernel';
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

  // Pre-scan for the two stream-level facts the cost rule needs. (1) Which
  // phases emit an 'iteration' event: for those (developer-loop) the same
  // dollars are re-stated on the per-WI 'ralph.end' AND the phase rollup 'end'.
  // (2) Which synthetic architect rows restate a session already counted (bead
  // forge-8vfn.6.10.22 — this aggregate was one of the readers that "agreed
  // with the log and was wrong together"). The rules live in
  // packages/kernel/event-cost.ts, single source, shared with the run model.
  const facts = costStreamFacts(events);

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

    // Cost attribution: count only the events that carry spend nothing else
    // already carried. If a phase has iteration events, only those hold the
    // canonical per-turn cost; 'end' events re-state the same dollars. If a
    // phase has no iteration events, its cost is on 'end' events (count them)
    // — unless the row restates an architect session the stream already
    // counted. Same rule for per_skill, whose old unconditional sum inflated
    // iteration-loop skills 2-3x (item 1.8).
    const countCost = countsTowardCost(e, facts);
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

/**
 * The phases to render, in reading order — `forge-8vfn.7.6.119`.
 *
 * `forge-metrics.ts` used to iterate a hardcoded
 * `['project-manager', 'developer-loop', 'review-loop', 'reflection']`, so a
 * phase outside that literal got no row however much it cost. S10 run 17 stated
 * `Total cost $3.99` above a table showing `project-manager $1.45`; the missing
 * $2.54 was the ARCHITECT, which the list does not contain. Run 18 the same,
 * with the architect at 77% of the cycle. The data was never incomplete —
 * `collect()` above sums `per_phase[e.phase].cost_usd` and `total_cost_usd` in
 * the SAME branch from the same events, so they are equal by construction — the
 * RENDERING was short.
 *
 * DERIVED FROM WHAT IS PRESENT, never from a list. A constant cannot see a phase
 * added later and the failure mode of missing one is SILENCE, which is
 * `queue-claim.mjs`'s argument for reading queue states from disk rather than
 * from a constant, one layer up. Known phases keep a deliberate reading order —
 * the order a cycle actually runs them — and anything unrecognised is appended
 * alphabetically rather than dropped.
 */
/**
 * The CYCLE SPINE in the order a cycle runs it — the same order `Phase` itself
 * declares in `@forge/kernel`'s `logging.ts`, which is not an accident: that
 * union is written in cycle order and this mirrors it deliberately rather than
 * inventing a second opinion about sequence.
 *
 * My first version listed six, which is how the defect it fixes was made in the
 * first place. `Phase` carries TEN spine phases; omitting `brain`, `unifier`,
 * `closure` and `release-finalize` would have left them to the alphabetical
 * tail — rendered, so not the original bug, but in an order that misrepresents
 * the run. The interactive session kinds (`instructions`, `demo`,
 * `project-brain`) are deliberately NOT here: the comment on the union says the
 * cycle spine ignores them and their logs are per-session, so if one ever
 * appears in a cycle's per_phase it should sort to the tail and look odd.
 */
export const PHASE_ORDER = [
  'orchestrator', 'brain', 'architect', 'project-manager', 'developer-loop',
  'unifier', 'review-loop', 'closure', 'release-finalize', 'reflection',
] as const;

export function phasesInRenderOrder(perPhase: Record<Phase, PhaseMetrics>): Phase[] {
  // TYPED AS `Phase`, NOT `string`, and the build is why. `per_phase` is a
  // `Record<Phase, …>`, so a `string[]` return makes the caller's index an
  // implicit `any` (TS7053) — and `npm test` never saw it: node's
  // `--experimental-strip-types` STRIPS types without checking them, so 8571
  // green assertions say nothing about whether `tsc` accepts the file. The
  // gate's `npm run build` is what catches this, and it is a different question
  // from the one the suite answers.
  const present = Object.keys(perPhase) as Phase[];
  const known = PHASE_ORDER.filter((p) => present.includes(p));
  const rest = present.filter((p) => !(PHASE_ORDER as readonly string[]).includes(p)).sort();
  return [...known, ...rest];
}

/**
 * What the rendered rows FAIL to account for, against the cycle's stated total.
 *
 * Reads 0 once every phase is rendered, and that is the point: nothing in the
 * report compared those two numbers before, so a table summing to 36% of the
 * total it printed ten lines above shipped unnoticed. A check whose passing
 * state is "these two agree" earns its keep exactly when nothing else is
 * looking.
 */
export function phaseCostRemainder(m: CycleMetrics): number {
  const summed = Object.values(m.per_phase).reduce((a, p) => a + p.cost_usd, 0);
  return m.total_cost_usd - summed;
}

