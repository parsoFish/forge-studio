/**
 * spend.test.ts — the story spend gate (park point H2).
 *
 * §3.1: "a story that needs money declares it and the runner refuses to start
 * without `--approve-spend`". Stories run REAL spawns — they never set
 * `FORGE_ARCHITECT_NO_SPAWN` — so this gate is the only thing standing between
 * `npm run stories` and the operator's money.
 *
 * The gate is pure and is evaluated BEFORE any browser, bridge or lock work,
 * so a refusal costs nothing.
 *
 * Pinned before implementation (`_1.0/gate-manifests/M1-B.txt`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spendGateVerdict, summariseRunSpend } from './spend.mjs';

test('a costless story runs without --approve-spend', () => {
  const v = spendGateVerdict({ realSpawn: false, budget_usd: 0 }, { approveSpend: false });
  assert.equal(v.allowed, true);
});

test('a costed story REFUSES to start without --approve-spend, naming the ceiling', () => {
  // Kills a gate that warns and proceeds. The operator must be told the
  // ceiling they are being asked to approve, in the refusal itself.
  const v = spendGateVerdict({ realSpawn: true, budget_usd: 12 }, { approveSpend: false });
  assert.equal(v.allowed, false);
  assert.match(v.reason, /--approve-spend/);
  assert.match(v.reason, /12/);
});

test('a costed story runs when spend is approved', () => {
  const v = spendGateVerdict({ realSpawn: true, budget_usd: 12 }, { approveSpend: true });
  assert.equal(v.allowed, true);
});

test('a real spawn declared at a zero budget still refuses — a spawn costs money', () => {
  // Kills `if (budget_usd > 0)` alone. `realSpawn: true, budget_usd: 0` is a
  // mis-declared story, and the safe reading of a mis-declared story is that
  // it spends.
  const v = spendGateVerdict({ realSpawn: true, budget_usd: 0 }, { approveSpend: false });
  assert.equal(v.allowed, false);
});

test('a budget above zero refuses even when realSpawn is false', () => {
  // The two declarations are independent; either one means money.
  const v = spendGateVerdict({ realSpawn: false, budget_usd: 5 }, { approveSpend: false });
  assert.equal(v.allowed, false);
});

test('the approval flag defaults to absent, never to approved', () => {
  // Kills a default-open signature. A caller that forgets to pass the flag
  // must get the refusing behaviour, not the spending one.
  const v = spendGateVerdict({ realSpawn: true, budget_usd: 3 });
  assert.equal(v.allowed, false);
});

test('a costless story is identified as costless in its reason', () => {
  const v = spendGateVerdict({ realSpawn: false, budget_usd: 0 });
  assert.match(v.reason, /costless/);
});

/**
 * The spend COLUMN — bead `forge-8vfn.6.11.8`.
 *
 * Four H6 runs dispatched real agents and every one reported spend as
 * UNMEASURED. Session 7 settled the class by measuring its opposite: three
 * healthy architect turns each priced themselves on their own `end` event —
 * $0.3844 (an out-of-story dispatch), $0.3870 (S2 run 3), $0.5358 (S4 run 3) —
 * while S4 run 2, the one turn that HUNG, was reaped mid-turn and so wrote no
 * terminal event and had nothing to price. UNMEASURED was never a pricing bug;
 * it was the shape of a reaped turn.
 *
 * So the runner can sum what `architect.turn-cost` (#424, bead 8vfn.18) emits.
 * The rule that matters is the negative one: a run that DISPATCHED and produced
 * no priced event must fail the cost row saying so, never report `$0.00`. A
 * zero that means "nothing was spent" and a zero that means "nobody looked"
 * must never print the same.
 */
test('AT-6.11.8-1 (RED) a run with priced events reports their SUM', () => {
  const v = summariseRunSpend({
    realSpawn: true,
    events: [
      [{ event_type: 'start' }, { event_type: 'end', cost_usd: 0.3844 }],
      [{ event_type: 'end', cost_usd: 0.1512 }],
    ],
  });
  assert.equal(v.measured, true);
  assert.equal(Number(v.usd.toFixed(4)), 0.5356);
  assert.match(v.label, /0\.5356/, v.label);
});

test('AT-6.11.8-2 (RED) a run that DISPATCHED with no priced event is UNMEASURED, never $0.00', () => {
  const v = summariseRunSpend({ realSpawn: true, events: [[{ event_type: 'start' }, { event_type: 'tool_use' }]] });
  assert.equal(v.measured, false);
  assert.equal(v.usd, null, 'null, not 0 — a zero would read as "nothing was spent"');
  assert.match(v.label, /UNMEASURED/, v.label);
  assert.match(v.label, /reaped|no priced event/i, `and it must say WHY: ${v.label}`);
});

test('AT-6.11.8-3 (positive control) a COSTLESS story reports a real, measured zero', () => {
  const v = summariseRunSpend({ realSpawn: false, events: [] });
  assert.equal(v.measured, true, 'a story that never dispatches genuinely spent nothing');
  assert.equal(v.usd, 0);
  assert.doesNotMatch(v.label, /UNMEASURED/, v.label);
});

test('AT-6.11.8-4 a dispatching run with NO event log at all is UNMEASURED, not zero', () => {
  // The S4-run-2 shape: the turn was reaped before it wrote anything priceable.
  const v = summariseRunSpend({ realSpawn: true, events: [] });
  assert.equal(v.measured, false);
  assert.equal(v.usd, null);
});

test('AT-6.11.8-5 a non-numeric or negative cost is ignored rather than trusted', () => {
  const v = summariseRunSpend({
    realSpawn: true,
    events: [[{ event_type: 'end', cost_usd: '0.50' }, { event_type: 'end', cost_usd: -1 }, { event_type: 'end', cost_usd: 0.25 }]],
  });
  assert.equal(v.usd, 0.25, 'only genuine non-negative numbers are summed');
  assert.equal(v.measured, true);
});
