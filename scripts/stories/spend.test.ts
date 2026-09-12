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
import { readFileSync } from 'node:fs';
import { spendGateVerdict, summariseRunSpend, spendCeilingVerdict } from './spend.mjs';

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

/**
 * The ceiling is ENFORCED, not printed — bead `forge-8vfn.7.6.51`, ruling 788.
 *
 * §15.449: a ceiling in a string is a label. `budget_usd` used to appear in
 * five places and be compared in none: interpolated into `spendGateVerdict`'s
 * reason, printed in `--list`, and otherwise tested `> 0` to ask "does this
 * cost anything". `--approve-spend` authorised an unbounded run. T1 had told
 * the operator "the run stops at the spend guard"; nothing stopped anything.
 */
test('a run over its ceiling BREACHES and names both numbers', () => {
  const v = spendCeilingVerdict({ measured: true, usd: 84.21, label: '$84.2100' }, 12);
  assert.equal(v.breached, true);
  assert.equal(v.known, true);
  assert.match(v.reason, /EXCEEDED/);
  assert.match(v.reason, /12\.00/);
  assert.match(v.reason, /84\.21/);
});

test('a run under its ceiling does not breach, and still reports both numbers', () => {
  const v = spendCeilingVerdict({ measured: true, usd: 2.8103, label: '$2.8103' }, 35);
  assert.equal(v.breached, false);
  assert.equal(v.known, true);
  assert.match(v.reason, /2\.8103 of \$35\.00/);
});

test('exactly AT the ceiling is not a breach — the declared number is spendable', () => {
  assert.equal(spendCeilingVerdict({ measured: true, usd: 12, label: '$12' }, 12).breached, false);
});

/**
 * The half that matters most, and the one this campaign keeps re-learning:
 * UNMEASURED is not $0 and is not "under budget". `summariseRunSpend` returns
 * `measured:false` when a real agent ran and no priced event reached its log —
 * a turn reaped mid-hang writes no terminal event. "Nobody could look" must
 * never render as "looked and it was fine", which is the same defect as
 * `ls 2>/dev/null | wc -l` returning 0 for a path that never existed.
 */
test('UNMEASURED spend is neither under nor over — known:false, and it says so', () => {
  const v = spendCeilingVerdict({ measured: false, usd: null, label: 'UNMEASURED — …' }, 35);
  assert.equal(v.breached, false);
  assert.equal(v.known, false);
  assert.match(v.reason, /UNMEASURED/);
  // Asserting the PROPERTY — that it refuses to claim compliance — not the
  // absence of a substring. A first draft here banned /under/i and failed on
  // the reason's own "neither under nor over it": an over-specified door,
  // written hours after this campaign catalogued the class. The property is
  // that the verdict states the comparison could not be made.
  assert.match(v.reason, /neither under nor over/i);
});

test('an unusable ceiling is reported as UNBOUNDED, not as compliance', () => {
  for (const bad of [undefined, null, NaN, Infinity, -1, '35']) {
    const v = spendCeilingVerdict({ measured: true, usd: 5, label: '$5' }, bad as unknown as number);
    assert.equal(v.breached, false, String(bad));
    assert.equal(v.known, false, String(bad));
    assert.match(v.reason, /UNBOUNDED/, String(bad));
  }
});

/**
 * The WIRING, asserted at the source — bead `forge-8vfn.7.6.51`.
 *
 * The verdict above is pure and unit-tested; what it cannot show is that
 * `run.mjs` actually consults it, at a beat boundary, and that a breach reaches
 * the exit code. Driving that needs a costed run, which is the thing the bead
 * exists to bound — so the properties are pinned here rather than bought.
 *
 * Three things must not rot:
 *   - the ceiling is checked INSIDE the beat loop, not only in teardown (the
 *     teardown report is what existed before and enforced nothing);
 *   - the running total prints EVERY beat, not only on breach — a guard that
 *     speaks only when it fires is indistinguishable from one that never ran;
 *   - a breach makes the process exit non-zero regardless of the beat score.
 */
test('7.6.51: run.mjs enforces the ceiling at a beat boundary and exits non-zero on breach', () => {
  const src = readFileSync(new URL('./run.mjs', import.meta.url), 'utf8');
  const loop = src.slice(src.indexOf('for (const [i, beat] of story.beats.entries())'));
  const loopBody = loop.slice(0, loop.indexOf('\n  const docPath'));
  assert.match(loopBody, /spendCeilingVerdict\(/, 'the ceiling must be consulted inside the beat loop');
  assert.match(loopBody, /spend after beat/, 'the running total must print every beat, not only on breach');
  assert.match(loopBody, /ceiling\.breached/, 'a breach must stop the loop');
  assert.match(src, /row\.status === 'green' && spendBreach === null\) \? 0 : 1/,
    'a breach must make the exit code non-zero whatever the beats did');
});
