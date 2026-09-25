/**
 * artifact-spend.test.ts — findings row 56 (second half), the narrowing.
 *
 * `artifactSpend` (`gallery.mjs`) is the pure narrowing `run-story.mjs`'s
 * `result.spend` is built from: exactly `{measured, usd, label}`, the shape
 * PR #890's `spendFieldFor` reads — never the whole `summariseRunSpend`
 * object, whose `priced`/`notes` are console diagnostics for the run's own
 * transcript, not the artifact's stable contract.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { artifactSpend } from './gallery.mjs';

test('narrows a measured spend reading to exactly measured/usd/label', () => {
  const spend = { measured: true, usd: 1.5, label: '$1.5000', priced: 1, notes: ['whatever'] };
  assert.deepEqual(artifactSpend(spend), { measured: true, usd: 1.5, label: '$1.5000' });
});

test('narrows an UNMEASURED reading the same way — usd stays null', () => {
  const spend = { measured: false, usd: null, label: 'UNMEASURED — reason', priced: 0 };
  assert.deepEqual(artifactSpend(spend), { measured: false, usd: null, label: 'UNMEASURED — reason' });
});

test('drops priced and notes — they are console diagnostics, not the artifact contract', () => {
  const spend = { measured: true, usd: 0, label: '$0.0000', priced: 0, notes: ['a disagreement'] };
  const out = artifactSpend(spend);
  assert.equal(Object.hasOwn(out, 'priced'), false);
  assert.equal(Object.hasOwn(out, 'notes'), false);
});
