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
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spendGateVerdict, summariseRunSpend, spendCeilingVerdict, effectiveCeiling, classifyUnmeasuredDispatch } from './spend.mjs';
import { runnerSourceContaining } from './runner-source.mjs';

/** The beat loop, wherever it lives. A door names the property and the anchor;
 *  `runner-source.mjs` says which module holds it today (forge-0fli). */
const BEAT_LOOP = 'for (const [i, beat] of story.beats.entries())';

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
 * Four things must not rot:
 *   - the ceiling is checked INSIDE the beat loop, not only in teardown (the
 *     teardown report is what existed before and enforced nothing);
 *   - the running total prints EVERY beat, not only on breach — a guard that
 *     speaks only when it fires is indistinguishable from one that never ran;
 *   - a halt makes the process exit non-zero regardless of the beat score;
 *   - 7.6.71: the decision the loop branches on covers BOTH ways money ends a
 *     run — the ceiling exceeded, and the ceiling gone blind because a turn
 *     ended unpriced. A loop that consults only the breach is back to printing
 *     `UNMEASURED` twenty-three times while an unknown amount is spent.
 */
test('7.6.51: the runner enforces the ceiling at a beat boundary and exits non-zero on breach', () => {
  // forge-0fli: the beat loop moved to `run-story.mjs` when `run.mjs` hit the
  // 800-line cap, and this door went red without a behaviour changing — the
  // SECOND time (see the note below on `forge-rzrs`). The filename was the one
  // location still pinned, so it is resolved from the anchor now.
  const { source: src } = runnerSourceContaining(BEAT_LOOP);
  const loop = src.slice(src.indexOf(BEAT_LOOP));
  const loopBody = loop.slice(0, loop.indexOf('\n  const docPath'));
  // THE PROPERTY FOLLOWED ACROSS A SPLIT, NOT A CALL SITE PINNED IN PLACE.
  // `forge-rzrs` took `run.mjs` past the 800-line cap, so the per-beat spend
  // block moved into `run-observe.mjs`'s `spendSoFar`. The first version of
  // this door matched `spendCeilingVerdict(` in the loop body and went red on a
  // refactor that changed no behaviour — the same over-specification this file
  // already records one paragraph down. What must hold is the CHAIN: the loop
  // asks for the spend and hands it the ceiling, and the thing it asks consults
  // the verdict and prints a per-beat line.
  assert.match(loopBody, /spendSoFar\(/, 'the beat loop must ask for the spend at a beat boundary');
  assert.match(loopBody, /ceilingUsd:/, 'and it must hand that ask the ceiling — an ask without one enforces nothing');
  const observe = readFileSync(new URL('./run-observe.mjs', import.meta.url), 'utf8');
  const spendSoFarBody = observe.slice(observe.indexOf('export function spendSoFar'));
  assert.match(spendSoFarBody, /spendCeilingVerdict\(/, 'the ceiling must be consulted where the spend is computed');
  assert.match(loopBody, /after beat \$\{i \+ 1\}/, 'the running total must be labelled per beat, not only on breach');
  assert.match(spendSoFarBody, /\[stories\] spend \$\{label\}/, 'and that label must actually reach a printed line');
  // Asserting the BEHAVIOUR, not a variable name. The first draft of this door
  // matched /ceiling\.breached/ and broke the moment 7.6.52 renamed the local —
  // an over-specified door, pinning an identifier the property does not depend
  // on. The property is that a breach ends the loop.
  assert.match(loopBody, /\.halt\b/, 'the loop must branch on the halt decision');
  assert.match(loopBody, /\bbreak\b/, 'and it must actually break out of it');
  // 7.6.71: the decision must be the one that knows about BOTH endings, and it
  // must be made where the rows are read — a loop that re-derived a breach from
  // the verdict alone would pass every assertion above and still be blind to a
  // turn that ended unpriced.
  assert.match(spendSoFarBody, /ceilingHaltVerdict\(/, 'the halt must come from the verdict that covers breach AND unenforceable');
  assert.match(spendSoFarBody, /endedUnpricedTurns\(/, 'and the unpriced turns must be read from the same rows as the money');
  // NAME-AGNOSTIC ON PURPOSE, and this door has now been broken twice by its
  // own over-specification: once matching `ceiling.breached` before 7.6.52
  // renamed the local, once matching `spendBreach` before 7.6.71 renamed it to
  // `spendHalt`. Neither rename changed a behaviour. The property is that the
  // exit code is non-zero whenever the money verdict ended the run, whatever
  // the variable holding it is called.
  assert.match(src, /row\.status === 'green' && \w+ === null\) \? 0 : 1/,
    'a halt must make the exit code non-zero whatever the beats did');
});

/**
 * Funded vs declared — bead `forge-8vfn.7.6.52`, ruling 791.
 *
 * D's S7 run 4 declared `budget_usd: 25` and was funded $5. With 7.6.51's
 * enforcement alone the run would have stopped at $25 — five times what anyone
 * authorised — and called itself compliant, because the only number it knew
 * was the story's own. A decision about this run cannot be overridden by a file.
 */
test('the LOWER of funded and declared is enforced, and the reason names both', () => {
  const c = effectiveCeiling(25, 5);
  assert.equal(c.usd, 5);
  assert.equal(c.source, 'funded');
  assert.match(c.reason, /funded \$5\.00/);
  assert.match(c.reason, /declared \$25\.00/);
  assert.match(c.reason, /LOWER/);
});

test('a declared figure below the funded one still wins — lower, not "funded always"', () => {
  const c = effectiveCeiling(3, 35);
  assert.equal(c.usd, 3);
  assert.equal(c.source, 'declared');
});

test('agreement is stated, not silent — a guard that speaks only on disagreement never compared them', () => {
  const c = effectiveCeiling(25, 25);
  assert.equal(c.usd, 25);
  assert.match(c.reason, /they agree/);
});

test('no --ceiling falls back to the declared figure and says which it used', () => {
  const c = effectiveCeiling(35, null);
  assert.equal(c.usd, 35);
  assert.equal(c.source, 'declared');
  assert.match(c.reason, /launcher named no --ceiling/);
});

test('neither usable is UNBOUNDED and refuses to look like a ceiling', () => {
  const c = effectiveCeiling(undefined as unknown as number, null);
  assert.ok(Number.isNaN(c.usd));
  assert.match(c.reason, /UNBOUNDED/);
});

test('7.6.52: the runner parses --ceiling and enforces the effective one', () => {
  // forge-0fli: this property now SPANS the split — the flag is parsed in
  // `run.mjs`, which keeps argument handling, and combined and enforced in
  // `run-story.mjs`, which has the loop. Asserting both against one file was
  // what made it look like one property of one file.
  const cli = readFileSync(new URL('./run.mjs', import.meta.url), 'utf8');
  assert.match(cli, /--ceiling/, 'the launcher must be able to name a funded ceiling');
  const { source: src } = runnerSourceContaining(BEAT_LOOP);
  assert.match(src, /effectiveCeiling\(/, 'the runner must combine funded and declared');
  const loop = src.slice(src.indexOf(BEAT_LOOP));
  const loopBody = loop.slice(0, loop.indexOf('\n  const docPath'));
  // The effective ceiling must reach the beat loop's spend ask. `forge-rzrs`
  // moved the verdict call into `run-observe.mjs`'s `spendSoFar`, so this
  // follows the ceiling along the chain rather than pinning the old call site
  // — the same correction as the 7.6.51 door above.
  assert.match(loopBody, /spendSoFar\(/, 'the loop must ask for the spend');
  assert.match(loopBody, /ceilingUsd: ceiling\?\.usd/, 'and hand it the EFFECTIVE ceiling, not some other number');
});

/**
 * A `--ceiling` that was GIVEN but does not parse is a malformed
 * authorisation, not an absent one — bead `forge-8vfn.7.6.52`.
 *
 * The first draft returned `NaN` and let `effectiveCeiling` fall back, which
 * printed "the launcher named no --ceiling" — FALSE, and it silently restored
 * the story's own higher figure. An operator who typed `--ceiling` and
 * fat-fingered the value would have been told a number they never chose was in
 * force. Refusing is the only safe reading.
 *
 * Exercised live at 03:12 on all four paths: `--ceiling` (no value), `abc`,
 * `-3` each exit 1 naming the token; `--ceiling 5` runs (positive control, so
 * the refusal is known to be discriminating rather than universal).
 */
test('7.6.52: run.mjs refuses a given-but-unusable --ceiling instead of falling back', () => {
  const src = readFileSync(new URL('./run.mjs', import.meta.url), 'utf8');
  assert.match(src, /ceilingGiven/, 'presence must be tracked separately from value');
  assert.match(src, /REFUSING: --ceiling was given as/, 'and a malformed one must refuse, naming what it got');
  // The refusal must precede anything that spends or binds: it sits with the
  // other preflight refusals, before the bridge boots.
  const refuseAt = src.indexOf('REFUSING: --ceiling was given as');
  const bootAt = src.indexOf('booting our own bridge from this tree');
  assert.ok(refuseAt !== -1 && bootAt !== -1 && refuseAt < bootAt,
    'the refusal must come before the bridge boots');
});

/**
 * The UNMEASURED verdict points to the DISCRIMINATOR, not to prose the reader
 * applies by eye — bead `forge-8vfn.7.6.76`, supersedes `forge-8vfn.7.6.56`.
 *
 * 7.6.56 made the label name both causes and a manual "run `wc -l` and check
 * stderr" recipe. That recipe does not actually discriminate: "many lines,
 * pid alive" was offered as the mid-hang signature, and it is ALSO exactly
 * what a healthy first spawn looks like mid-flight — still working, still
 * writing, nothing priced yet. A reader applying the old recipe by eye would
 * misdiagnose a live run as reaped. `classifyUnmeasuredDispatch` (`spend.mjs`)
 * replaces the manual recipe with a mechanism: two reads, not one, and three
 * arms instead of two prose paragraphs (`AT-7.6.76-*` below).
 */
test('7.6.56: UNMEASURED points at the mechanism, names the ambiguity it replaces, and is still NOT $0.00', () => {
  const v = summariseRunSpend({ realSpawn: true, events: [[{ kind: 'start' }]] });
  assert.equal(v.measured, false);
  assert.match(v.label, /classifyUnmeasuredDispatch/, 'points a reader at the mechanism, not a recipe');
  assert.match(v.label, /reaped mid-hang/, 'still names the hang cause this replaces confusion about');
  assert.match(v.label, /TREND/, 'says why one read cannot decide it');
  assert.match(v.label, /NOT \$0\.00/, 'and it still is not zero');
});

/**
 * `classifyUnmeasuredDispatch` — the mechanism itself, bead `forge-8vfn.7.6.76`.
 *
 * THREE ARMS, from two reads of the same dispatch. The old single-read prose
 * conflated IN FLIGHT and REAPED because both show "many lines, pid alive" at
 * one instant; only the TREND between two reads tells them apart.
 */
test('AT-7.6.76-1 (RED) a growing fixture (pid alive, events grew) is IN FLIGHT, naming N', () => {
  const previous = { pid: 4242, alive: true, eventLines: 5 };
  const current = { pid: 4242, alive: true, eventLines: 12, stderrTail: '', exitCode: null };
  const v = classifyUnmeasuredDispatch(current, previous);
  assert.equal(v.arm, 'in-flight');
  assert.match(v.detail, /IN FLIGHT/);
  assert.match(v.detail, /grew by 7 line/, `must name N: ${v.detail}`);
  assert.match(v.detail, /4242/, 'names the pid too');
});

test('AT-7.6.76-2 (RED) a static log with a dead pid is REAPED\\/DIED, carrying the stderr tail', () => {
  const previous = { pid: 4242, alive: true, eventLines: 12 };
  const current = { pid: 4242, alive: false, eventLines: 12, stderrTail: 'FATAL: worker exited', exitCode: null };
  const v = classifyUnmeasuredDispatch(current, previous);
  assert.equal(v.arm, 'reaped');
  assert.match(v.detail, /REAPED\/DIED/);
  assert.match(v.detail, /FATAL: worker exited/, `stderr tail must ride along: ${v.detail}`);
});

test('AT-7.6.76-3 a static log with a STILL-ALIVE pid is also REAPED\\/DIED — a stuck shape, not live work', () => {
  const previous = { pid: 4242, alive: true, eventLines: 12 };
  const current = { pid: 4242, alive: true, eventLines: 12, stderrTail: '', exitCode: null };
  const v = classifyUnmeasuredDispatch(current, previous);
  assert.equal(v.arm, 'reaped', 'pid alive is not enough on its own — nothing moved');
});

test('AT-7.6.76-4 (RED) exactly one event line with a dead pid is NEVER STARTED, naming the exit code', () => {
  const current = { pid: 4242, alive: false, eventLines: 1, stderrTail: '', exitCode: 1 };
  const v = classifyUnmeasuredDispatch(current);
  assert.equal(v.arm, 'never-started');
  assert.match(v.detail, /NEVER STARTED/);
  assert.match(v.detail, /exit code 1/, `must name the exit code: ${v.detail}`);
});

test('AT-7.6.76-5 one line but the pid is STILL alive reads as freshly IN FLIGHT, not never-started', () => {
  // It only just began — the terminal fact (b) needs is that the SDK child
  // already exited; a live one-liner has not had the chance to prove either
  // way yet, and misreading it as never-started would be a false positive on
  // the very first beat of a healthy run.
  const current = { pid: 99, alive: true, eventLines: 1, stderrTail: '', exitCode: null };
  const v = classifyUnmeasuredDispatch(current);
  assert.equal(v.arm, 'in-flight');
});

test('AT-7.6.76-6 with no previous read at all, growth is measured from zero', () => {
  const current = { pid: 7, alive: true, eventLines: 3, stderrTail: '', exitCode: null };
  const v = classifyUnmeasuredDispatch(current);
  assert.equal(v.arm, 'in-flight');
  assert.match(v.detail, /grew by 3 line/);
});

/**
 * Bead `forge-rzrs` — an ENFORCED ceiling that cannot see a cycle's spend.
 *
 * MEASURED on S10 run 15 ($35 enforced, head `e1b72897`): reported $2.1916,
 * real $2.8690 — 23.6% invisible. The architect dir carried `turn.pid` and was
 * collected; the cycle dir carried none and was skipped, taking the
 * project-manager's $0.6774 with it.
 *
 * EVERY FIXTURE BELOW IS COPIED OUT OF THE CAPTURED LOGS, ids and all
 * (§15.497). The first version of this suite was written from a SENTENCE —
 * "the cycle log duplicates the architect row" — and encoded the model twice:
 * the test passed and the real logs produced $5.0606, because the rollup
 * carries its own `event_id` and the session dir holds four turn rows, not
 * one. A fixture invented from a description can only ever agree with the
 * description.
 *
 * Provenance: `_1.0/evidence/m6-c-S10-run15/{architect-session,cycle-channel}/events.jsonl`.
 */
const RUN15_ARCHITECT_DIR = [
  { event_id: 'EV_mty24xo8_5ohrgfq9', phase: 'architect', event_type: 'end', cost_usd: 0.6016058 },
  { event_id: 'EV_mty269q8_lfvl4ddg', phase: 'architect', event_type: 'end', cost_usd: 0.40530105 },
  { event_id: 'EV_mty28uun_17y27b72', phase: 'architect', event_type: 'end', cost_usd: 0.5572269000000001 },
  { event_id: 'EV_mty2cy8n_ben3odtb', phase: 'architect', event_type: 'end', cost_usd: 0.62746895 },
];
/** Multi-phase, which is what makes it a CYCLE log rather than a session dir. */
const RUN15_CYCLE_LOG = [
  { event_id: 'EV_orch_1', phase: 'orchestrator', event_type: 'log' },
  { event_id: 'EV_mty2d91k_6gjmufk8', phase: 'architect', event_type: 'end', cost_usd: 2.1916027000000002 },
  { event_id: 'EV_mty2gi4v_k7jeu7dh', phase: 'project-manager', event_type: 'error', cost_usd: 0.6774190500000001 },
];

describe('summariseRunSpend — one phase counts once, at the higher of its two accounts', () => {
  test('forge-rzrs (1): run 15\u2019s six real rows total $2.8690, not $5.0606', () => {
    const s = summariseRunSpend({ realSpawn: true, events: [RUN15_ARCHITECT_DIR, RUN15_CYCLE_LOG] });

    assert.equal(s.measured, true);
    assert.equal(
      s.usd?.toFixed(4),
      '2.8690',
      'the architect is counted once (its four turns OR the one rollup, not both) and the PM is counted at all',
    );
    assert.deepEqual(s.notes, [], 'rollup equals parts here, so there is nothing to report');
  });

  test('forge-rzrs (2): TWO architect sessions both count — the group is not collapsed to one dir', () => {
    const second = [
      { event_id: 'EV_second_a', phase: 'architect', event_type: 'end', cost_usd: 1 },
      { event_id: 'EV_second_b', phase: 'architect', event_type: 'end', cost_usd: 0.5 },
    ];
    const rollups = [
      { event_id: 'EV_o', phase: 'orchestrator', event_type: 'log' },
      { event_id: 'EV_r1', phase: 'architect', event_type: 'end', cost_usd: 2.1916027000000002 },
      { event_id: 'EV_r2', phase: 'architect', event_type: 'end', cost_usd: 1.5 },
    ];

    const s = summariseRunSpend({ realSpawn: true, events: [RUN15_ARCHITECT_DIR, second, rollups] });

    assert.equal(s.usd?.toFixed(4), '3.6916', 'both sessions sum into the architect group, against the summed rollups');
  });

  test('forge-rzrs (3): when the rollup EXCEEDS the parts, the rollup wins and the disagreement is NAMED', () => {
    const partial = [{ event_id: 'EV_one_turn', phase: 'architect', event_type: 'end', cost_usd: 0.6016058 }];

    const s = summariseRunSpend({ realSpawn: true, events: [partial, RUN15_CYCLE_LOG] });

    assert.equal(s.usd?.toFixed(4), '2.8690', 'a session dir that logged one of four turns must not shrink the bill');
    assert.equal(s.notes.length, 1, 'the two accounts disagree, and a ceiling never hides that');
    assert.match(s.notes[0], /architect: aggregate \$2\.1916 \u2260 parts \$0\.6016/);
  });

  test('forge-rzrs (4): rows with NO phase are summed per log — nothing links them, so nothing collapses them', () => {
    const agentA = [{ event_id: 'EV_a', event_type: 'end', cost_usd: 1 }];
    const agentB = [{ event_id: 'EV_b', event_type: 'end', cost_usd: 1 }];

    const s = summariseRunSpend({ realSpawn: true, events: [agentA, agentB] });

    assert.equal(s.usd, 2, 'two unphased dispatches are two spends; collapsing them would UNDER-report');
  });
});
