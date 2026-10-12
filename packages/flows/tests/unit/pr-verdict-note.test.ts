/**
 * forge-nk1y.34 — the operator's approve rationale is written into the PR body before the merge
 * (gitweave I2 verdict 2 recorded only the canned "Approved on the visual review — no blocking
 * comments." in verdict.json). A recording gh stands in for the real one: no network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { withVerdictNote, writeVerdictToPrBody } from '../../pr.ts';

test('withVerdictNote appends the operator verdict, and replaces an earlier one rather than stacking', () => {
  const once = withVerdictNote('## Summary\n\nPlan engine.\n', '  Ledgered exception: Apply job fixed in I3. ');
  assert.equal(once, '## Summary\n\nPlan engine.\n\n## Operator verdict\n\nApproved by the operator: Ledgered exception: Apply job fixed in I3.\n');
  const twice = withVerdictNote(once, 'second reason');
  assert.equal(twice.match(/## Operator verdict/g)?.length, 1);
  assert.match(twice, /Approved by the operator: second reason\n$/);
});

test('writeVerdictToPrBody reads the body, then edits it with the verdict appended', () => {
  const calls: string[][] = [];
  let written = '';
  writeVerdictToPrBody((args) => {
    calls.push(args);
    if (args[1] === 'edit') written = readFileSync(args[args.indexOf('--body-file') + 1], 'utf8');
    return args[1] === 'view' ? 'PR body from forge\n' : '';
  }, 'demo shows the ghost team deleted');
  assert.deepEqual(calls.map((c) => c.slice(0, 2)), [['pr', 'view'], ['pr', 'edit']]);
  assert.equal(written, 'PR body from forge\n\n## Operator verdict\n\nApproved by the operator: demo shows the ghost team deleted\n');
});

test('refusal: a body that cannot be written throws, so the caller never reaches the merge', () => {
  assert.throws(
    () => writeVerdictToPrBody((args) => { if (args[1] === 'edit') throw new Error('HTTP 403: Resource not accessible by integration'); return 'b'; }, 'r'),
    /HTTP 403/,
  );
});
