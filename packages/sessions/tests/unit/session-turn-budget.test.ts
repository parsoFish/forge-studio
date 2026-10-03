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
 * Row 209 (bead forge-8vfn.8.5.45) — corrects this file's own prior rule.
 * MEASURED: a costed story bridge ran at `FORGE_COST_CEILING_USD=6`; three
 * architect sessions each declared $25 on their own start form; the first two
 * spent the run down to $0.44 left of its $6; the THIRD session's turns kept
 * capping against $25 minus ITS OWN spend (the old "declared wins outright"
 * rule), and one SDK turn overshot the bridge's ceiling by $2.47. The cap is
 * now MIN(declared remaining, bridge-wide remaining) — see `turn-budget.ts`'s
 * own header for the full rule.
 *
 * The architect pins drive the REAL `runArchitectTurn` (interviewing) with a
 * fake `queryFn`, so they prove the dispatch wiring, not a helper in isolation:
 * cap = MIN(the session's own declared ceiling minus what ITS OWN
 * `events.jsonl` says it spent, `FORGE_COST_CEILING_USD` minus what EVERY
 * directory under the same `_logs/` says the bridge has spent).
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
import { BRIDGE_COST_CEILING_ENV, TurnBudgetExhaustedError, bridgeSpentUsd } from '../../turn-budget.ts';

const SESSION_ID = '2026-10-02T20-56-58-budget';

const ARCHITECT_SKILL_FIXTURE = [
  'You are the forge architect (turn-budget fixture).',
  '', '<!-- turn: interview -->', 'FIXTURE INTERVIEW.',
  '', '<!-- turn: explore -->', 'FIXTURE EXPLORE.',
  '', '<!-- turn: draft -->', 'FIXTURE DRAFT.',
  '', '<!-- turn: draft-force-emit -->', 'FIXTURE FORCE-EMIT.',
].join('\n');

type Options = Record<string, unknown>;

/** One architect interview turn; `seed` writes prior rows into the session's
 *  OWN log. `otherSessionUsd` (row 209) spends a DIFFERENT session's log under
 *  the SAME `logsRoot`, before this turn runs — the bridge-wide spend this
 *  session itself never touched, the way three separate architect sessions
 *  under one bridge actually do. */
async function architectTurn(opts: {
  costCeilingUsd?: number;
  env?: string;
  seed?: (logger: EventLogger) => void;
  otherSessionUsd?: number;
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
    if (opts.otherSessionUsd !== undefined) {
      priced(opts.otherSessionUsd)(createLogger('_architect-other-session', logsRoot));
    }
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

test('row 209 — a DECLARED ceiling lower than the bridge-wide remaining still wins (MIN, not "bridge always wins")', async () => {
  // declared remaining 2 − 1 = 1; bridge-wide remaining 10 − 1 (this same
  // session's own spend, counted once under logsRoot too) = 9. MIN picks the
  // declared arm.
  const r = await architectTurn({ costCeilingUsd: 2, env: '10', seed: priced(1) });
  assert.equal(r.error, null, String(r.error));
  assert.equal(r.options?.['maxBudgetUsd'], 1);
  const refusal = r.rows.find((e) => e['event_type'] === 'error');
  assert.equal(refusal, undefined);
});

test('row 209 — the bridge is the LOWER remaining and BINDS even though the operator\'s own declared ceiling is nowhere near exhausted (the measured overshoot)', async () => {
  // The exact measured shape: declared $25, bridge $6, $5.56 already spent by
  // OTHER sessions under this same bridge, this session itself spent nothing.
  // Declared remaining is $25; bridge-wide remaining is $0.44 — MIN is bridge.
  const r = await architectTurn({ costCeilingUsd: 25, env: '6', otherSessionUsd: 5.56 });
  assert.equal(r.error, null, String(r.error));
  assert.ok(
    Math.abs((r.options?.['maxBudgetUsd'] as number) - 0.44) < 1e-9,
    `expected ~0.44, got ${String(r.options?.['maxBudgetUsd'])}`,
  );
});

test('row 209 — bridge-wide spend by OTHER sessions can exhaust the bridge ceiling and refuse a session that itself spent nothing, naming the bridge', async () => {
  const r = await architectTurn({ costCeilingUsd: 25, env: '6', otherSessionUsd: 7 });
  assert.ok(r.error instanceof TurnBudgetExhaustedError, `expected a TurnBudgetExhaustedError, got ${String(r.error)}`);
  assert.match((r.error as Error).message, /\$7\.0000 spent .* >= \$6\.00 bridge ceiling \(FORGE_COST_CEILING_USD\)/);
  assert.equal(r.options, null, 'the SDK must never be called');
  const refusal = r.rows.find((e) => e['event_type'] === 'error' && /turn budget exhausted/.test(String(e['message'])));
  assert.ok(refusal, 'the refusal is on the session\'s own log');
  const meta = refusal!['metadata'] as Record<string, unknown>;
  assert.equal(meta['ceiling_source'], 'bridge');
  assert.equal(meta['cost_ceiling_usd'], 6);
  assert.equal(meta['cost_usd_spent'], 7);
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
// bridgeSpentUsd — the bridge-wide tally itself (row 209)
// ---------------------------------------------------------------------------

test('bridgeSpentUsd sums every directory under logsRoot; a sinceIso cutoff excludes dirs this bridge did not spend (born before it booted)', () => {
  const root = mkdtempSync(join(tmpdir(), 'bridge-spent-'));
  try {
    const logsRoot = join(root, '_logs');
    priced(3)(createLogger('_architect-old-session', logsRoot));
    assert.equal(bridgeSpentUsd(logsRoot, undefined), 3, 'no cutoff given: every dir under logsRoot counts');

    // A cutoff "in the future" relative to the dir(s) already on disk reads
    // every one of them as born BEFORE this bridge — none of them is this
    // bridge's own spend.
    const sinceIso = new Date(Date.now() + 10_000).toISOString();
    assert.equal(bridgeSpentUsd(logsRoot, sinceIso), 0, 'a dir older than the bridge\'s own boot time is excluded');

    priced(2)(createLogger('_architect-newer-session', logsRoot));
    assert.equal(bridgeSpentUsd(logsRoot, sinceIso), 0, 'a dir created after the read but still before the (future) cutoff is excluded too');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('bridgeSpentUsd: an unreadable logsRoot reads as $0, never a throw — a turn-budget check must not crash the turn it caps', () => {
  assert.equal(bridgeSpentUsd(join(tmpdir(), 'does-not-exist-' + Date.now()), undefined), 0);
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
