/**
 * Row 199 (bead forge-8vfn.8.5.39, T1 ruling 1973gt) — the SESSION-LESS fix
 * turn runs under the same cap rule row 193b (#1067) gave every session turn:
 * "unpriced" is honest only when no bound exists, and a turn launched under an
 * SDK `maxBudgetUsd` is boundable by construction.
 *
 * Before this, `kinds/fix-turn.ts` (brain-fix, preflight-fix) handed the SDK no
 * `maxBudgetUsd` at all, a crashed turn left an `error` row with no figure, and
 * a resultless one wrote `cost_usd: 0`. Each arm below is red on that code
 * except the no-ceiling bag and priced-row control.
 *
 * Driven through a minimal variant rather than either real kind, so the cap
 * arithmetic is judged on its own; the real kinds' bags stay pinned
 * byte-for-byte by `packages/sessions/tests/regression/fix-turn-capture.test.ts`, which runs with
 * no ceiling and is therefore unchanged.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runFixTurn, type FixTurnInput, type FixTurnResult, type FixTurnVariant, type QueryFn } from '../../kinds/fix-turn.ts';
import { BRIDGE_COST_CEILING_ENV } from '../../turn-budget.ts';

const PREFIX = '_budgetfix';

function variant(seen: { costUsd?: number }): FixTurnVariant<FixTurnInput, FixTurnResult> {
  return {
    cycleIdPrefix: PREFIX,
    eventPhase: 'orchestrator',
    eventSkill: 'budget-fix',
    skillName: 'budget-fix',
    fallbackPrompt: 'fallback',
    inputRefs: () => [],
    startMessage: () => 'budget-fix.start',
    startMetadata: () => ({}),
    prepare: () => ({ spawn: { prompt: 'p', options: { model: 'm' } }, pre: undefined }),
    finish: ({ input, costUsd }) => {
      seen.costUsd = costUsd;
      return { result: { runId: input.runId, cleared: false }, endMetadata: {} };
    },
  };
}

/** Captures the options bag, then yields `messages` (or throws `throwErr`). */
function stub(capture: { options?: Record<string, unknown> }, messages: unknown[], throwErr?: Error): QueryFn {
  return ({ options }) => {
    capture.options = options;
    return (async function* () {
      for (const m of messages) yield m;
      if (throwErr) throw throwErr;
    })();
  };
}

type Row = { event_type: string; message: string; cost_usd?: number; metadata?: Record<string, unknown> };

function rows(logsRoot: string, runId: string): Row[] {
  return readFileSync(join(logsRoot, `${PREFIX}-${runId}`, 'events.jsonl'), 'utf8')
    .split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Row);
}

describe('fix-turn runs under the cost ceiling (row 199)', () => {
  let root: string;
  let saved: string | undefined;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'fix-turn-budget-'));
    saved = process.env[BRIDGE_COST_CEILING_ENV];
    delete process.env[BRIDGE_COST_CEILING_ENV];
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[BRIDGE_COST_CEILING_ENV];
    else process.env[BRIDGE_COST_CEILING_ENV] = saved;
    rmSync(root, { recursive: true, force: true });
  });

  const run = (runId: string, q: QueryFn, extra: Partial<FixTurnInput> = {}, seen: { costUsd?: number } = {}) =>
    runFixTurn(variant(seen), { runId, forgeRoot: root, logsRoot: join(root, '_logs'), queryFn: q, ...extra });

  test('the bridge ceiling reaches the SDK as maxBudgetUsd — the whole ceiling, one turn spends nothing before it', async () => {
    process.env[BRIDGE_COST_CEILING_ENV] = '3';
    const cap: { options?: Record<string, unknown> } = {};
    await run('env', stub(cap, [{ type: 'result', total_cost_usd: 0.2 }]));
    assert.equal(cap.options?.['maxBudgetUsd'], 3);
    assert.deepEqual(Object.keys(cap.options ?? {}).slice(-1), ['abortController'], 'abortController stays last');
  });

  test("the caller's own ceiling (the KB drain's remaining) wins over the bridge's", async () => {
    process.env[BRIDGE_COST_CEILING_ENV] = '3';
    const cap: { options?: Record<string, unknown> } = {};
    await run('declared', stub(cap, [{ type: 'result', total_cost_usd: 0.2 }]), { costCeilingUsd: 1.25 });
    assert.equal(cap.options?.['maxBudgetUsd'], 1.25);
  });

  test('no ceiling anywhere → no maxBudgetUsd key, and the priced end row is as before', async () => {
    const cap: { options?: Record<string, unknown> } = {};
    await run('none', stub(cap, [{ type: 'result', total_cost_usd: 0.2 }]));
    assert.equal('maxBudgetUsd' in (cap.options ?? {}), false);
    const end = rows(join(root, '_logs'), 'none').find((r) => r.event_type === 'end');
    assert.equal(end?.cost_usd, 0.2);
    assert.equal(end?.metadata?.['upper_bound_usd'], undefined);
  });

  test('a crashed turn under a cap leaves an unpriced row carrying upper_bound_usd', async () => {
    process.env[BRIDGE_COST_CEILING_ENV] = '2';
    await run('crash', stub({}, [], new Error('boom')));
    const err = rows(join(root, '_logs'), 'crash').find((r) => r.event_type === 'error');
    assert.equal(err?.cost_usd, undefined, 'never zeroed (ruling 849)');
    assert.equal(err?.metadata?.['priced'], false);
    assert.equal(err?.metadata?.['unpriced_reason'], 'died');
    assert.equal(err?.metadata?.['upper_bound_usd'], 2);
  });

  // T1 ruling 1973gx — with NO cap the turn is still unpriced, and says so:
  // `priced: false` with no bound, which every reader must take as UNKNOWN
  // (spend.mjs halts UNENFORCEABLE; the KB drain stops), never as free.
  test('a crashed turn with NO cap is unpriced and unbounded — no bound invented', async () => {
    await run('crash-free', stub({}, [], new Error('boom')));
    const err = rows(join(root, '_logs'), 'crash-free').find((r) => r.event_type === 'error');
    assert.equal(err?.cost_usd, undefined);
    assert.equal(err?.metadata?.['priced'], false);
    assert.equal(err?.metadata?.['unpriced_reason'], 'died');
    assert.equal('upper_bound_usd' in (err?.metadata ?? {}), false);
  });

  test('a resultless turn with NO cap is unpriced and unbounded, not cost_usd 0 (ruling 849)', async () => {
    await run('noresult-free', stub({}, []));
    const end = rows(join(root, '_logs'), 'noresult-free').find((r) => r.event_type === 'end');
    assert.equal('cost_usd' in (end ?? {}), false);
    assert.equal(end?.metadata?.['priced'], false);
    assert.equal(end?.metadata?.['unpriced_reason'], 'no-result');
    assert.equal('upper_bound_usd' in (end?.metadata ?? {}), false);
  });

  test('a resultless turn under a cap is unpriced-with-bound, not cost_usd 0', async () => {
    process.env[BRIDGE_COST_CEILING_ENV] = '2';
    await run('noresult', stub({}, []));
    const end = rows(join(root, '_logs'), 'noresult').find((r) => r.event_type === 'end');
    assert.equal(end?.cost_usd, undefined);
    assert.equal(end?.metadata?.['priced'], false);
    assert.equal(end?.metadata?.['unpriced_reason'], 'no-result');
    assert.equal(end?.metadata?.['upper_bound_usd'], 2);
  });

  test('error_max_budget_usd is priced AT the cap, never at a zeroed total', async () => {
    const seen: { costUsd?: number } = {};
    await run('maxed', stub({}, [{ type: 'result', subtype: 'error_max_budget_usd', total_cost_usd: 0 }]), { costCeilingUsd: 0.75 }, seen);
    const end = rows(join(root, '_logs'), 'maxed').find((r) => r.event_type === 'end');
    assert.equal(end?.cost_usd, 0.75);
    assert.equal(seen.costUsd, 0.75, "the kind's finish sees the same figure");
  });
});
