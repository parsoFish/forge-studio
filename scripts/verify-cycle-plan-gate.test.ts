/**
 * bead forge-8vfn.6.10.8 — the harness auto-approved the plan gate without
 * reading the severity it had just printed.
 *
 * G1 run 4: the completeness critic blocked finalize with
 *   `[high] the PLAN … pivots to a completely different initiative … no
 *    relationship to the idea`
 * and `verify-cycle.mjs` logged that line and re-approved anyway (frame
 * `03-plan-approved`, 01:05:40Z). The severity was parsed, printed, and
 * enforced nowhere — the campaign's recurring declared-data-fails-open shape,
 * this time in the harness that is supposed to be the check.
 *
 * The decision is a pure function of the findings, so it is tested as one, for
 * the same reason `classifyServeStageOutcome` is: a predicate exercised only by
 * a live $12 run is a predicate nobody exercises (§15.163).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyCriticFindings } from './verify-cycle-plan-gate.mjs';

test('kills "the harness prints the severity and approves anyway": a [high] finding BLOCKS, it is not acknowledged', () => {
  const r = classifyCriticFindings([
    { severity: 'high', gap: 'the PLAN pivots to a completely different initiative — no relationship to the idea' },
  ]);
  assert.equal(r.acknowledge, false);
  assert.equal(r.blocking.length, 1);
  assert.match(r.reason, /high/);
  assert.match(r.reason, /pivots to a completely different initiative/, 'the reason quotes the finding, so the log says WHY the run stopped');
});

test('kills "any finding stops the run": medium and low are still acknowledged once, which is the critic\'s one-shot contract', () => {
  const r = classifyCriticFindings([
    { severity: 'medium', gap: 'AC-2 has no verification artifact' },
    { severity: 'low', gap: 'the title could be shorter' },
  ]);
  assert.equal(r.acknowledge, true);
  assert.deepEqual(r.blocking, []);
});

test('kills "one high is hidden behind two lows": a mixed set blocks on the high alone', () => {
  const r = classifyCriticFindings([
    { severity: 'low', gap: 'nit' },
    { severity: 'high', gap: 'the plan does not address the idea' },
    { severity: 'medium', gap: 'thin' },
  ]);
  assert.equal(r.acknowledge, false);
  assert.deepEqual(r.blocking.map((f) => f.gap), ['the plan does not address the idea']);
});

test('kills "severity is trusted to be lowercase": HIGH and " High " block too', () => {
  for (const severity of ['HIGH', 'High', ' high ']) {
    assert.equal(classifyCriticFindings([{ severity, gap: 'g' }]).acknowledge, false, `${JSON.stringify(severity)} must block`);
  }
});

test('kills "an unreadable severity is treated as harmless": a missing or unknown severity BLOCKS, it does not pass', () => {
  // Fail closed. The harness cannot tell "the critic found nothing serious"
  // from "the critic said something this parser does not understand", and the
  // second must never be spent $12 on.
  for (const f of [{ gap: 'g' }, { severity: null, gap: 'g' }, { severity: 'catastrophic', gap: 'g' }, { severity: 7, gap: 'g' }]) {
    const r = classifyCriticFindings([f]);
    assert.equal(r.acknowledge, false, `${JSON.stringify(f)} must not be auto-acknowledged`);
  }
});

test('kills "no findings still needs a decision": an empty set is nothing to acknowledge and nothing to block', () => {
  const r = classifyCriticFindings([]);
  assert.equal(r.acknowledge, false, 'there is no finding to acknowledge — the caller only re-approves when findings.length > 0');
  assert.deepEqual(r.blocking, []);
});

test('kills "a non-array is a crash or a pass": a malformed critic payload blocks', () => {
  for (const bad of [null, undefined, 'high', { severity: 'high' }]) {
    const r = classifyCriticFindings(bad);
    assert.equal(r.acknowledge, false);
  }
});

test('kills "the printed severity and the acted-on severity drift apart": the log lines come from the SAME call that decides', () => {
  // The defect this bead closes was precisely a print and a decision made from
  // two separate reads. One call now owns both.
  const blocked = classifyCriticFindings([{ severity: 'high', gap: 'the plan does not address the idea' }]);
  assert.ok(blocked.log.some((l) => l.includes('[high]') && l.includes('the plan does not address the idea')));
  assert.ok(blocked.log.includes(blocked.reason), 'the refusal itself is printed, not just thrown');
  assert.ok(!blocked.log.some((l) => l.includes('re-approving')), 'a blocked run must never print that it is re-approving');

  const acked = classifyCriticFindings([{ severity: 'low', gap: 'nit' }]);
  assert.ok(acked.log.some((l) => l.includes('re-approving to acknowledge')));
  assert.ok(acked.log.some((l) => l.includes('[low]') && l.includes('nit')), 'the acknowledged findings are still listed, not swallowed');
});
