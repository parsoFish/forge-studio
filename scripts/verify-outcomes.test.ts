/**
 * Kills: (a) `const PROJECT = flag('project', 'mdtoc')` — mdtoc lives inside
 * forge's own repo and must never be the harness ground (CLAUDE.md, 1.0.md
 * global constraints); (b) verify-cycle.mjs:423-425, where 'project tests green
 * post-merge' passes on `tests.ok` alone — so a cycle that never merged still
 * scores a green post-merge row by running the tests on unmerged main.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROJECT, buildOutcomeChecks } from './lib/verify-outcomes.mjs';

test('the default ground is gitpulse, never mdtoc', () => {
  assert.equal(DEFAULT_PROJECT, 'gitpulse');
});

test('post-merge tests are SKIPPED WITH A REASON when the cycle never reached merge', () => {
  const checks = buildOutcomeChecks({
    finalStatus: 'failed', manifestInDone: false,
    wi: { total: 4, complete: 4, failed: 0 },
    tests: { ran: true, ok: true, label: 'npm test' },
    cost: 10, costCeiling: 60, reflectTheme: { present: false, reason: 'none' },
  });
  const merged = checks.find((c) => c.name === 'cycle reached merge (done)');
  const post = checks.find((c) => c.name === 'project tests green post-merge');
  assert.equal(merged.pass, false);
  assert.equal(post.skipped, true, 'a green suite on an unmerged tree is not post-merge evidence');
  assert.equal(post.pass, false, 'a skipped row never counts as a pass');
  assert.match(post.detail, /merge/i, 'the skip must say why it was skipped');
});

test('post-merge tests are judged normally once the cycle reached merge', () => {
  const checks = buildOutcomeChecks({
    finalStatus: 'done', manifestInDone: true,
    wi: { total: 4, complete: 4, failed: 0 },
    tests: { ran: true, ok: true, label: 'npm test' },
    cost: 10, costCeiling: 60, reflectTheme: { present: true, reason: '1 theme(s)' },
  });
  const post = checks.find((c) => c.name === 'project tests green post-merge');
  assert.equal(post.skipped, undefined);
  assert.equal(post.pass, true);
});
