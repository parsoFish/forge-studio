/**
 * Row 193b (bead forge-8vfn.8.5.38, T1 ruling 1973gq) — every session turn runs
 * under the SDK's `maxBudgetUsd` when a ceiling exists, so a turn that ends
 * unpriced still carries a bound.
 *
 * MEASURED: row 6 run 6, story S10 beat 30. ACT 2's architect turn stalled,
 * was aborted by `withIdleDeadline`, and wrote `architect.turn-ended-unpriced
 * reason=abort` with nothing bounding it; the story halted CEILING
 * UNENFORCEABLE. The SDK option existed (sdk.d.ts `maxBudgetUsd`) and forge set
 * it only on the cycle path (`run-agent.ts` → `ralph/claude-agent.ts`), never
 * on `runStructuredTurn` / `runAgentTurn`.
 *
 * The architect pins drive the REAL `runArchitectTurn` (interviewing) with a
 * fake `queryFn`, so they prove the dispatch wiring, not a helper in isolation:
 * cap = the session's own declared ceiling (`status.costCeilingUsd`, the start
 * form's figure), else `FORGE_COST_CEILING_USD`, minus what the session's own
 * `events.jsonl` says it spent (priced rows + bounded unpriced rows).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createLogger, type EventLogger } from '@forge/kernel';

import { runArchitectTurn, type ArchitectStatus } from '../../kinds/architect.ts';
import { runAgentTurn, runStructuredTurn, type QueryFn, type UnpricedTurnInfo } from '../../interactive-session.ts';
import { emitTurnCostRow, emitTurnEndedUnpricedRow } from '../../turn-cost-rows.ts';
import { BRIDGE_COST_CEILING_ENV, TurnBudgetExhaustedError } from '../../turn-budget.ts';

const SESSION_ID = '2026-10-02T20-56-58-budget';

const ARCHITECT_SKILL_FIXTURE = [
  'You are the forge architect (turn-budget fixture).',
  '', '<!-- turn: interview -->', 'FIXTURE INTERVIEW.',
  '', '<!-- turn: explore -->', 'FIXTURE EXPLORE.',
  '', '<!-- turn: draft -->', 'FIXTURE DRAFT.',
  '', '<!-- turn: draft-force-emit -->', 'FIXTURE FORCE-EMIT.',
].join('\n');

type Options = Record<string, unknown>;

/** One architect interview turn; `seed` writes prior rows into the session's log. */
async function architectTurn(opts: {
  costCeilingUsd?: number;
  env?: string;
  seed?: (logger: EventLogger) => void;
}): Promise<{ options: Options | null; error: unknown; rows: Array<Record<string, unknown>> }> {
  const root = mkdtempSync(join(tmpdir(), 'turn-budget-'));
  const prevEnv = process.env[BRIDGE_COST_CEILING_ENV];
  if (opts.env === undefined) delete process.env[BRIDGE_COST_CEILING_ENV];
  else process.env[BRIDGE_COST_CEILING_ENV] = opts.env;
  try {
    const projectRoot = join(root, 'projects', 'project');
    const sessionDir = join(projectRoot, '_architect', SESSION_ID);
    mkdirSync(sessionDir, { recursive: true });
    const skillPromptPath = join(root, 'skill.md');
    writeFileSync(skillPromptPath, ARCHITECT_SKILL_FIXTURE);
    const status: ArchitectStatus = {
      session_id: SESSION_ID, project: 'testproj', project_repo_path: projectRoot,
      phase: 'interviewing', round: 1, idea: 'A dark-mode toggle.', updated_at: new Date(0).toISOString(),
      ...(opts.costCeilingUsd !== undefined ? { costCeilingUsd: opts.costCeilingUsd } : {}),
    };
    writeFileSync(join(sessionDir, 'status.json'), JSON.stringify(status));
    const logsRoot = join(root, '_logs');
    const logger = createLogger(`_architect-${SESSION_ID}`, logsRoot);
    opts.seed?.(logger);

    let options: Options | null = null;
    const queryFn: QueryFn = ({ options: o }) => {
      options = o as Options;
      return (async function* () {
        yield { type: 'result', subtype: 'success', total_cost_usd: 0.01, structured_output: { done: false, questions: [{ question: 'Q?', header: 'H', options: [{ label: 'a', description: 'b' }] }] } };
      })();
    };
    let error: unknown = null;
    try {
      await runArchitectTurn({ sessionId: SESSION_ID, projectRoot, queryFn, logsRoot, logger, skillPromptPath, brainCwd: root });
    } catch (err) {
      error = err;
    }
    const rows = readFileSync(logger.logFilePath, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    return { options, error, rows };
  } finally {
    if (prevEnv === undefined) delete process.env[BRIDGE_COST_CEILING_ENV];
    else process.env[BRIDGE_COST_CEILING_ENV] = prevEnv;
    rmSync(root, { recursive: true, force: true });
  }
}

const priced = (usd: number) => (logger: EventLogger) =>
  emitTurnCostRow(logger, { initiativeId: `architect-session-${SESSION_ID}`, phase: 'architect', skill: 'architect', message: 'architect.turn-cost' }, usd);

test('row 193b (b) the architect structured turn receives maxBudgetUsd = declared ceiling − priced spend', async () => {
  const r = await architectTurn({ costCeilingUsd: 5, seed: priced(1.25) });
  assert.equal(r.error, null, String(r.error));
  assert.equal(r.options?.['maxBudgetUsd'], 3.75);
});

test('row 193b (b) a bounded unpriced row counts as spent at its bound — a stall retry cannot get the whole remaining twice', async () => {
  const r = await architectTurn({
    costCeilingUsd: 5,
    seed: (logger) => {
      priced(1)(logger);
      emitTurnEndedUnpricedRow(logger, { initiativeId: 'x', phase: 'architect', skill: 'architect', message: 'architect.turn-ended-unpriced' }, { reason: 'abort', upperBoundUsd: 0.5 });
    },
  });
  assert.equal(r.options?.['maxBudgetUsd'], 3.5);
});

test('row 193b (b) no ceiling anywhere → no maxBudgetUsd key at all (operator sessions stay unbounded, options bag unchanged)', async () => {
  const r = await architectTurn({ seed: priced(1.25) });
  assert.equal(r.error, null, String(r.error));
  assert.ok(r.options !== null);
  assert.equal(Object.hasOwn(r.options!, 'maxBudgetUsd'), false);
});

test('row 193b (b) no declared ceiling → the bridge process\'s FORGE_COST_CEILING_USD is the fallback source', async () => {
  const r = await architectTurn({ env: '2', seed: priced(1.25) });
  assert.equal(r.options?.['maxBudgetUsd'], 0.75);
});

test('row 193b (b) the operator\'s declared ceiling wins over the bridge\'s', async () => {
  const r = await architectTurn({ costCeilingUsd: 5, env: '2', seed: priced(1.25) });
  assert.equal(r.options?.['maxBudgetUsd'], 3.75);
});

test('row 193b (b) nothing remaining → the turn is REFUSED with a named reason; the SDK is never called with a cap <= 0', async () => {
  const r = await architectTurn({ env: '1', seed: priced(1.25) });
  assert.ok(r.error instanceof TurnBudgetExhaustedError, `expected a TurnBudgetExhaustedError, got ${String(r.error)}`);
  assert.match((r.error as Error).message, /session turn budget exhausted: \$1\.2500 spent .* >= \$1\.00 bridge ceiling \(FORGE_COST_CEILING_USD\)/);
  assert.equal(r.options, null, 'the SDK must never be called');
  const refusal = r.rows.find((e) => e['event_type'] === 'error' && /turn budget exhausted/.test(String(e['message'])));
  assert.ok(refusal, 'the refusal is on the session\'s own log');
  assert.equal((refusal!['metadata'] as Record<string, unknown>)['ceiling_source'], 'bridge');
});

// ---------------------------------------------------------------------------
// The primitives
// ---------------------------------------------------------------------------

const stream = (...msgs: unknown[]) => (async function* () { for (const m of msgs) yield m; })();

test('row 193b (1) runStructuredTurn passes maxBudgetUsd to the SDK options; an unpriced end carries it as upperBoundUsd', async () => {
  let options: Options | null = null;
  const seen: UnpricedTurnInfo[] = [];
  const out = await runStructuredTurn({
    queryFn: (({ options: o }: { options: Options }) => { options = o; return stream({ type: 'assistant', message: { content: [] } }); }) as never,
    prompt: 'p', schema: {}, model: 'm', allowedTools: [], maxBudgetUsd: 3.75,
    onTurnEndedUnpriced: (i) => seen.push(i),
  });
  assert.equal(options!['maxBudgetUsd'], 3.75);
  assert.equal(out.costUsd, null);
  assert.deepEqual(seen.map((i) => [i.reason, i.upperBoundUsd]), [['no-result', 3.75]]);
});

test('row 193b (3) an error_max_budget_usd result is PRICED at the cap — a priced turn, not an unpriced one', async () => {
  for (const [total, expected] of [[undefined, 3.75], [0, 3.75], [3.9, 3.9]] as const) {
    const seen: UnpricedTurnInfo[] = [];
    const out = await runStructuredTurn({
      queryFn: (() => stream({ type: 'result', subtype: 'error_max_budget_usd', ...(total !== undefined ? { total_cost_usd: total } : {}) })) as never,
      prompt: 'p', schema: {}, model: 'm', allowedTools: [], maxBudgetUsd: 3.75,
      onTurnEndedUnpriced: (i) => seen.push(i),
    });
    assert.equal(out.costUsd, expected, `total_cost_usd=${String(total)}`);
    assert.equal(seen.length, 0, 'a turn stopped at its cap has a price and leaves no unpriced row');
  }
});

test('row 193b (1)(3) runAgentTurn: maxBudgetUsd reaches the options; error_max_budget_usd prices at the cap; a died turn carries the bound', async () => {
  let options: Options | null = null;
  const capped = await runAgentTurn({
    queryFn: (({ options: o }: { options: Options }) => { options = o; return stream({ type: 'result', subtype: 'error_max_budget_usd' }); }) as never,
    prompt: 'p', cwd: tmpdir(), model: 'm', allowedTools: [], maxBudgetUsd: 2.5,
  });
  assert.equal(options!['maxBudgetUsd'], 2.5);
  assert.equal(capped.costUsd, 2.5);

  const seen: UnpricedTurnInfo[] = [];
  await assert.rejects(runAgentTurn({
    queryFn: (() => (async function* () { throw new Error('boom'); })()) as never,
    prompt: 'p', cwd: tmpdir(), model: 'm', allowedTools: [], maxBudgetUsd: 2.5,
    onTurnEndedUnpriced: (i) => seen.push(i),
  }), /boom/);
  assert.deepEqual(seen.map((i) => [i.reason, i.upperBoundUsd]), [['died', 2.5]]);
});

test('row 193b (1) no maxBudgetUsd → no options key and no upperBoundUsd (byte-identical prior shape)', async () => {
  let options: Options | null = null;
  const seen: UnpricedTurnInfo[] = [];
  await runStructuredTurn({
    queryFn: (({ options: o }: { options: Options }) => { options = o; return stream(); }) as never,
    prompt: 'p', schema: {}, model: 'm', allowedTools: [], onTurnEndedUnpriced: (i) => seen.push(i),
  });
  assert.equal(Object.hasOwn(options!, 'maxBudgetUsd'), false);
  assert.equal(Object.hasOwn(seen[0]!, 'upperBoundUsd'), false);
});

test('row 193b (3) emitTurnEndedUnpricedRow records metadata.upper_bound_usd = the cap; absent when there was none', () => {
  const rows: Array<Record<string, unknown>> = [];
  const logger = { emit: (e: Record<string, unknown>) => { rows.push(e); return e; }, logFilePath: join(tmpdir(), 'x', 'events.jsonl') } as never;
  const id = { initiativeId: 'i', phase: 'architect' as const, skill: 'architect', message: 'architect.turn-ended-unpriced' };
  emitTurnEndedUnpricedRow(logger, id, { reason: 'abort', upperBoundUsd: 6.5 });
  emitTurnEndedUnpricedRow(logger, id, { reason: 'abort' });
  const meta = rows.map((r) => r['metadata'] as Record<string, unknown>);
  assert.deepEqual(meta[0], { unpriced_reason: 'abort', priced: false, upper_bound_usd: 6.5 });
  assert.equal(Object.hasOwn(meta[1]!, 'upper_bound_usd'), false);
  assert.equal(Object.hasOwn(rows[0]!, 'cost_usd'), false, 'still unpriced: the bound is metadata, never a cost_usd');
});
