/**
 * forge-mfv5.1.43 (D-20 amended): an operator-authored work item carries ONE
 * falsifying check per acceptance criterion. The check lives in the criterion's
 * frontmatter, survives a parse/serialize round trip, is validated by name, and
 * the WI file's checkboxes are ticked by forge from the checks' results.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  acLabel,
  acceptanceCheckErrors,
  missingCheckErrors,
  tickAcceptanceCriteria,
} from '../../acceptance-check.ts';
import { parseWorkItem, serializeWorkItem, validateWorkItem, type WorkItem } from '../../work-item.ts';

const wi = (acs: WorkItem['acceptance_criteria']): WorkItem => ({
  work_item_id: 'WI-14',
  initiative_id: 'INIT-2026-10-11-i3b-self-service',
  status: 'pending',
  depends_on: [],
  acceptance_criteria: acs,
  files_in_scope: ['tests/acceptance/test_gw_self_serve.py'],
  quality_gate_cmd: ['python3', '-m', 'pytest', 'tests/'],
  estimated_iterations: 3,
  body: '# WI-14\n\n- [ ] AC1: GIVEN g WHEN w THEN t\n- [ ] M1: GIVEN g WHEN w THEN t\n',
});

const failCheck = { argv: ['python3', '-m', 'pytest', 'tests/acceptance', '-q'], expect: 'fail' as const, unsetEnv: ['GW_CALLER_TOKEN'] };

test('a check round-trips through frontmatter with its id, expect and env lists', () => {
  const w = wi([
    { id: 'AC1', given: 'g', when: 'w', then: 't', check: failCheck },
    { given: 'g2', when: 'w2', then: 't2', check: { argv: ['python3', '-m', 'pytest', 'tests/test_a.py'], expect: 'pass', requiresEnv: ['GW_TOKEN'] } },
  ]);
  const back = parseWorkItem(serializeWorkItem(w));
  assert.deepEqual(back.acceptance_criteria, w.acceptance_criteria);
  assert.deepEqual(validateWorkItem(back), []);
});

test('a criterion without a check serializes byte-identically to before (no new keys)', () => {
  const text = serializeWorkItem(wi([{ given: 'g', when: 'w', then: 't' }]));
  assert.doesNotMatch(text, /check:|\n\s+(- )?id:/);
});

test('a malformed check is refused by name: shell chain, empty argv, bad expect, bad env name, duplicate id', () => {
  const errs = (c: unknown, id?: string) => acceptanceCheckErrors([{ given: 'g', when: 'w', then: 't', ...(id ? { id } : {}), check: c } as never]);
  assert.match(errs({ argv: ['bash', '-c', 'pytest && rm -rf x'], expect: 'pass' }).join(), /AC1.*ONE runnable command/);
  assert.match(errs({ argv: [], expect: 'pass' }).join(), /AC1.*argv/);
  assert.match(errs({ argv: Array.from({ length: 65 }, () => 'x'), expect: 'pass' }).join(), /AC1: check\.argv must be 1\.\.64/);
  assert.match(errs({ argv: ['pytest', 'x'.repeat(501)], expect: 'pass' }).join(), /at most 500 characters/);
  assert.match(errs({ argv: ['pytest'], expect: 'maybe' }).join(), /AC1.*expect must be pass \| fail/);
  assert.match(errs({ argv: ['pytest'], expect: 'fail', unsetEnv: ['gw token'] }).join(), /AC1.*unsetEnv/);
  assert.match(errs({ argv: ['pytest'], expect: 'pass' }, 'has space').join(), /id must match/);
  const dup = acceptanceCheckErrors([
    { id: 'M1', given: 'g', when: 'w', then: 't' },
    { id: 'M1', given: 'g', when: 'w', then: 't' },
  ]);
  assert.match(dup.join(), /duplicate.*M1/);
  assert.deepEqual(errs(failCheck), []);
});

test('validateWorkItem carries the check errors (one validation door)', () => {
  const errors = validateWorkItem(wi([{ given: 'g', when: 'w', then: 't', check: { argv: ['sh', '-c', 'pytest; rm x'], expect: 'pass' } }]));
  assert.ok(errors.some((e) => /AC1/.test(e)), errors.join('\n'));
});

test('an operator-authored criterion with a prose WHEN and no check is refused naming it', () => {
  const errs = missingCheckErrors([
    { id: 'AC1', given: 'g', when: 'python3 -m pytest tests/acceptance -q', then: 't', check: failCheck },
    { given: 'g', when: 'the operator reads the output', then: 't' },
  ]);
  assert.equal(errs.length, 1);
  assert.match(errs[0]!, /AC2 \(when: the operator reads the output\) has no falsifying check/);
});

test('labels: the declared id, else AC<n>', () => {
  assert.equal(acLabel({ id: 'M1' }, 0), 'M1');
  assert.equal(acLabel({}, 2), 'AC3');
});

test('ticking marks exactly the named boxes; a label with no box is appended under a forge heading', () => {
  const body = '# WI-14\n\n- [ ] AC1: GIVEN g WHEN w THEN t\n- [ ] M1: GIVEN g WHEN w THEN t\n';
  const ticked = tickAcceptanceCriteria(body, ['AC1', 'AC3']);
  assert.match(ticked, /- \[x\] AC1: GIVEN/);
  assert.match(ticked, /- \[ \] M1: GIVEN/);
  assert.match(ticked, /## Acceptance checks passed \(ticked by forge\)\n\n- \[x\] AC3/);
  assert.equal(tickAcceptanceCriteria(body, []), body);
});
