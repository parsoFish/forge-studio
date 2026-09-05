/**
 * Bead forge-8vfn.6.10.23 — the ceiling a run is BOUND by, and the knob that set it.
 *
 * Found mid-G2 (2026-09-05), measured on the run's own event log
 * (`_1.0/evidence/m5-a-g2/`): an operator authorised $20, the harness took
 * `--cost-ceiling 20` as a POST-HOC gate assertion and never threaded it into the
 * run, and the ceiling the tracker actually enforced was the manifest's derivation
 * — `cost_budget_usd` (18) + a flat `DERIVED_CEILING_MARGIN_USD` (40) = $58. A
 * docs budget of $18 authorised a $58 run, and item 7's per-work-item share
 * (0.5 x 58 = $29) could not fire on work items costing $0.40-$7.85.
 *
 * Two things are wrong and both are tested here:
 *
 *   1. The margin was a FLAT constant, and its own comment justified the size by
 *      "unifier + review + reflect legs" — the unifier is retired. A flat margin
 *      does not scale: it triples a small budget and barely moves a large one.
 *      Re-derived as a SHARE of the budget, sized from the only two real runs on
 *      disk. G2 (`_1.0/evidence/m5-a-g2/cost-deduplicated.txt`) spent $23.9721
 *      deduplicated against a `cost_budget_usd` of 18 = 1.33 x budget, of which
 *      the legs the budget does NOT estimate (architect $2.3327 + project-manager
 *      $0.8338 + review $0.6247) were $3.79. G1 run 3
 *      (`_1.0/evidence/m5-a-G1-run3-brain/2026-09-04T15-35-29_*.md`) spent $6.84
 *      total against a ~$3.05 dev-loop, so its non-dev-loop legs were ~$3.8 as
 *      well — near-fixed legs, a variable dev loop. A share of 0.5 covers the
 *      worst measured ratio (1.33) with ~12% headroom and cannot triple a budget.
 *
 *   2. Nothing named the knob. A stop event carried `ceilingUsd` and no source,
 *      so "which of the three knobs stopped this run" had to be re-derived by
 *      hand from the env, the manifest and the flow. The resolver now returns the
 *      source alongside the number and the stop/warn events carry it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveCostCeilingOverride } from '../../cycle.ts';
import {
  DERIVED_CEILING_MARGIN_SHARE,
  readManifestCostCeiling,
  serializeManifest,
  type InitiativeManifest,
} from '../../manifest.ts';
import { CostTracker, PER_WORK_ITEM_CEILING_SHARE } from '../../flow-budgets.ts';

/** G2's real manifest shape: a docs initiative with a $18 budget and no explicit ceiling. */
const G2_BUDGET_USD = 18;

function writeManifest(fields: Partial<InitiativeManifest>): string {
  const dir = mkdtempSync(join(tmpdir(), 'forge-ceiling-binds-'));
  const m: InitiativeManifest = {
    initiative_id: 'INIT-2026-09-05-init-gap-registry-consolidation',
    class: 'docs',
    acceptance_criteria: [],
    project: 'demo',
    project_repo_path: '/tmp/demo',
    created_at: '2026-09-05T00:00:00Z',
    iteration_budget: 50,
    cost_budget_usd: G2_BUDGET_USD,
    phase: 'pending',
    origin: 'architect',
    body: '# body',
    ...fields,
  };
  const path = join(dir, 'manifest.md');
  writeFileSync(path, serializeManifest(m));
  return path;
}

function withoutCeilingEnv<T>(fn: () => T): T {
  const prev = process.env.FORGE_COST_CEILING_USD;
  delete process.env.FORGE_COST_CEILING_USD;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.FORGE_COST_CEILING_USD;
    else process.env.FORGE_COST_CEILING_USD = prev;
  }
}

function stubLogger() {
  const emitted: any[] = [];
  return { emitted, cycleId: 'test', emit(p: any) { emitted.push(p); return { ...p, event_id: `e${emitted.length}` }; } };
}

/** One authoritative cost-bearing event, shaped as the real log writes it. */
function costEvent(fields: Record<string, unknown>) {
  const { workItemId, ...rest } = fields as { workItemId?: string };
  return {
    event_id: `x-${String(workItemId ?? 'none')}-${String((rest as any).cost_usd)}`,
    initiative_id: 'INIT-x',
    phase: 'developer-loop',
    skill: 'developer-ralph',
    event_type: 'end',
    message: 'ralph.end',
    ...rest,
    ...(workItemId ? { metadata: { work_item_id: workItemId } } : {}),
  } as any;
}

// ---------------------------------------------------------------------------
// 1. The margin is a share of the budget, not a flat constant
// ---------------------------------------------------------------------------

test('readManifestCostCeiling derives a SHARE of the budget — G2\'s $18 docs budget bounds the run at $27, never the old flat-$40 $58', () => {
  const path = writeManifest({});
  const derived = readManifestCostCeiling(path);
  assert.equal(
    derived?.ceilingUsd,
    G2_BUDGET_USD * (1 + DERIVED_CEILING_MARGIN_SHARE),
    'the derived ceiling must be the budget scaled by the margin SHARE',
  );
  assert.equal(derived?.ceilingUsd, 27, 'G2\'s $18 budget derives a $27 ceiling');
  assert.notEqual(derived?.ceilingUsd, 58, 'the retired flat $40 margin turned an $18 budget into a $58 run');
  assert.equal(derived?.source, 'derived', 'a budget-derived ceiling must say it was derived, not claim the operator set it');
  assert.ok(
    (derived?.ceilingUsd ?? 0) >= 23.9721,
    `the derived ceiling must cover G2's measured deduplicated spend ($23.9721) — got ${derived?.ceilingUsd}`,
  );
});

test('the margin share scales: it can never triple a budget the way the flat $40 tripled $18', () => {
  const small = readManifestCostCeiling(writeManifest({ cost_budget_usd: 4 }));
  const large = readManifestCostCeiling(writeManifest({ cost_budget_usd: 100 }));
  assert.equal(small?.ceilingUsd, 4 * (1 + DERIVED_CEILING_MARGIN_SHARE));
  assert.equal(large?.ceilingUsd, 100 * (1 + DERIVED_CEILING_MARGIN_SHARE));
  assert.ok(DERIVED_CEILING_MARGIN_SHARE < 1, 'a margin share of 1 or more doubles every budget');
});

// ---------------------------------------------------------------------------
// 2. The resolver names the knob it read
// ---------------------------------------------------------------------------

test('resolveCostCeilingOverride names its SOURCE: env (the harness flag) > manifest ceiling > derived', () => {
  const derivedPath = writeManifest({});
  const explicitPath = writeManifest({ cost_ceiling_usd: 120 });

  withoutCeilingEnv(() => {
    assert.deepEqual(resolveCostCeilingOverride(derivedPath), {
      ceilingUsd: 27,
      source: 'derived',
    });
    assert.deepEqual(resolveCostCeilingOverride(explicitPath), {
      ceilingUsd: 120,
      source: 'manifest',
    });
    assert.deepEqual(resolveCostCeilingOverride('/nonexistent/manifest.md'), {
      ceilingUsd: undefined,
      source: 'none',
    });
  });

  const prev = process.env.FORGE_COST_CEILING_USD;
  process.env.FORGE_COST_CEILING_USD = '20';
  try {
    assert.deepEqual(
      resolveCostCeilingOverride(explicitPath),
      { ceilingUsd: 20, source: 'env' },
      'the operator\'s $20 must win over the manifest and say so',
    );
  } finally {
    if (prev === undefined) delete process.env.FORGE_COST_CEILING_USD;
    else process.env.FORGE_COST_CEILING_USD = prev;
  }
});

// ---------------------------------------------------------------------------
// 3. A run bound by the flag stops, and the stop names the flag
// ---------------------------------------------------------------------------

test('a run whose events exceed the flag stops with flow.cost-ceiling-stop NAMING the flag as the source', () => {
  const logger = stubLogger();
  const tracker = new CostTracker({ ceilingUsd: 20, ceilingSource: 'env', initiativeId: 'INIT-x', logger: logger as any });

  // G2's first three work items, verbatim from the run's event log.
  for (const [workItemId, costUsd] of [['WI-1', 0.39610245], ['WI-2', 7.8504427], ['WI-3', 3.1699688]] as const) {
    tracker.noteEvent(costEvent({ workItemId, cost_usd: costUsd }));
  }
  assert.equal(tracker.stopReasonBeforeNextWorkItem('WI-4a'), null, 'under the bound, the run continues');

  // WI-4a..WI-5, which took the deduplicated figure past the operator's $20.
  for (const [workItemId, costUsd] of [['WI-4a', 2.43617145], ['WI-4b', 3.7588268], ['WI-5', 2.56942455]] as const) {
    tracker.noteEvent(costEvent({ workItemId, cost_usd: costUsd }));
  }
  tracker.noteEvent(costEvent({ phase: 'orchestrator', skill: 'adversarial-review', event_type: 'log', message: 'review.agent-pass', cost_usd: 0.6247399 }));

  const reason = tracker.stopReasonBeforeNextWorkItem('WI-6');
  assert.ok(reason, 'the run must stop once the flag\'s ceiling is reached');

  const stop = logger.emitted.find((e) => e.message === 'flow.cost-ceiling-stop');
  assert.ok(stop, 'flow.cost-ceiling-stop must be emitted');
  assert.equal(stop.metadata?.limit, 'cycle');
  assert.equal(stop.metadata?.ceilingUsd, 20, 'the stop cites the flag\'s ceiling, not the manifest\'s derivation');
  assert.equal(
    stop.metadata?.ceilingSource,
    'env',
    'the stop must NAME the knob that bound the run — "which of the three ceilings stopped me" is the first question a stopped run asks',
  );
});

test('the warn line names the source too, so a run discloses its bound before it hits it', () => {
  const logger = stubLogger();
  const tracker = new CostTracker({ ceilingUsd: 20, ceilingSource: 'env', initiativeId: 'INIT-x', logger: logger as any });
  tracker.noteEvent(costEvent({ workItemId: 'WI-1', cost_usd: 15 }));
  const warn = logger.emitted.find((e) => e.message === 'flow.cost-warn');
  assert.ok(warn, 'flow.cost-warn must be emitted at >= 70%');
  assert.equal(warn.metadata?.ceilingSource, 'env');
});

// ---------------------------------------------------------------------------
// 4. Item 7's per-work-item share multiplies the BOUND ceiling
// ---------------------------------------------------------------------------

test('the per-work-item ceiling is a share of the BOUND ceiling — G2\'s WI-2 ($7.85) is 78% of the flag\'s share, not 27% of the inflated derivation\'s', () => {
  const bound = new CostTracker({ ceilingUsd: 20, ceilingSource: 'env', initiativeId: 'INIT-x', logger: stubLogger() as any });
  assert.equal(bound.perWorkItemCeilingUsd, PER_WORK_ITEM_CEILING_SHARE * 20, 'the share multiplies the ceiling the run is bound by');
  assert.equal(bound.perWorkItemCeilingUsd, 10);

  // The inflated derivation the manifest used to produce ($18 + $40) gave a
  // per-WI ceiling of $29 — looser than every work item G2 ran, so it could
  // never fire. The re-derived $27 ceiling gives $13.50.
  const derived = new CostTracker({ ceilingUsd: 27, ceilingSource: 'derived', initiativeId: 'INIT-x', logger: stubLogger() as any });
  assert.equal(derived.perWorkItemCeilingUsd, 13.5);
  assert.ok(derived.perWorkItemCeilingUsd < 29, 'the retired flat margin put the per-WI ceiling at $29, above every work item in the run it was meant to bound');
});

test('a work-item stop names the source as well as the breached share', () => {
  const logger = stubLogger();
  const tracker = new CostTracker({ ceilingUsd: 20, ceilingSource: 'env', initiativeId: 'INIT-x', logger: logger as any });
  tracker.noteEvent(costEvent({ workItemId: 'WI-runaway', cost_usd: 11 }));
  const reason = tracker.stopReasonBeforeNextWorkItem('WI-runaway');
  assert.ok(reason, 'a work item over its share must stop before the next dispatch');
  const stop = logger.emitted.find((e) => e.message === 'flow.cost-ceiling-stop' && e.metadata?.limit === 'work-item');
  assert.ok(stop, 'the work-item stop must be emitted');
  assert.equal(stop.metadata?.ceilingUsd, 10, 'the work-item stop cites the BREACHED limit (the share), not the cycle ceiling');
  assert.equal(stop.metadata?.ceilingSource, 'env', 'and still names the knob the share was taken from');
});
