import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { scoreNegativeCase, summariseNegatives } from './negatives-scoring.ts';

function tmpRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'negatives-test-'));
  mkdirSync(join(root, 'brain', 'forge', 'themes'), { recursive: true });
  writeFileSync(join(root, 'brain', 'forge', 'themes', 'real.md'), '# real theme');
  return root;
}

test('out_of_scope: passes when gap=true and no sources cited', () => {
  const root = tmpRoot();
  const r = scoreNegativeCase({
    expected: { gap: true, max_sources: 0 },
    category: 'out_of_scope',
    actualGap: true,
    actualSources: [],
    forgeRoot: root,
  });
  assert.equal(r.passed, true);
});

test('out_of_scope: fails when gap=false (missed_gap)', () => {
  const root = tmpRoot();
  const r = scoreNegativeCase({
    expected: { gap: true, max_sources: 0 },
    category: 'out_of_scope',
    actualGap: false,
    actualSources: [],
    forgeRoot: root,
  });
  assert.equal(r.passed, false);
  assert.ok(r.reasons.includes('missed_gap'));
});

test('out_of_scope: fails when sources cited (unexpected_sources)', () => {
  const root = tmpRoot();
  const r = scoreNegativeCase({
    expected: { gap: true, max_sources: 0 },
    category: 'out_of_scope',
    actualGap: true,
    actualSources: ['brain/forge/themes/real.md'],
    forgeRoot: root,
  });
  assert.equal(r.passed, false);
  assert.ok(r.reasons.some((x) => x.startsWith('unexpected_sources_for_out_of_scope')));
});

test('forge_adjacent_bait: passes with up to 2 context citations when gap=true', () => {
  const root = tmpRoot();
  // Add a second real theme so neither citation is a hallucination.
  writeFileSync(join(root, 'brain', 'forge', 'themes', 'sched.md'), '# scheduler');
  const r = scoreNegativeCase({
    expected: { gap: true },
    category: 'forge_adjacent_bait',
    actualGap: true,
    actualSources: ['brain/forge/themes/real.md', 'brain/forge/themes/sched.md'],
    forgeRoot: root,
  });
  assert.equal(r.passed, true);
});

test('forge_adjacent_bait: fails when more than 2 sources cited (filling-the-gap)', () => {
  const root = tmpRoot();
  for (const name of ['s1', 's2', 's3']) {
    writeFileSync(join(root, 'brain', 'forge', 'themes', `${name}.md`), '# x');
  }
  const r = scoreNegativeCase({
    expected: { gap: true },
    category: 'forge_adjacent_bait',
    actualGap: true,
    actualSources: ['brain/forge/themes/s1.md', 'brain/forge/themes/s2.md', 'brain/forge/themes/s3.md'],
    forgeRoot: root,
  });
  assert.equal(r.passed, false);
  assert.ok(r.reasons.some((x) => x.startsWith('too_many_context_sources_for_bait')));
});

test('hallucinated path: automatic 0 even if all other criteria met', () => {
  const root = tmpRoot();
  const r = scoreNegativeCase({
    expected: { gap: true, max_sources: 4, must_include_any_of: ['brain/forge/themes/real.md'] },
    category: 'partial_match',
    actualGap: true,
    actualSources: ['brain/forge/themes/real.md', 'brain/forge/themes/fabricated.md'],
    forgeRoot: root,
  });
  assert.equal(r.passed, false);
  assert.equal(r.hallucinated.length, 1);
  assert.equal(r.hallucinated[0], 'brain/forge/themes/fabricated.md');
});

test('partial_match: passes when gap=true + must_include hit + within max_sources', () => {
  const root = tmpRoot();
  const r = scoreNegativeCase({
    expected: {
      gap: true,
      max_sources: 4,
      must_include_any_of: ['brain/forge/themes/real.md'],
    },
    category: 'partial_match',
    actualGap: true,
    actualSources: ['brain/forge/themes/real.md'],
    forgeRoot: root,
  });
  assert.equal(r.passed, true);
});

test('partial_match: fails when must_include not satisfied', () => {
  const root = tmpRoot();
  // Add another real theme so the source isn't a hallucination, just not the required one.
  writeFileSync(join(root, 'brain', 'forge', 'themes', 'other.md'), '# other');
  const r = scoreNegativeCase({
    expected: {
      gap: true,
      max_sources: 4,
      must_include_any_of: ['brain/forge/themes/real.md'],
    },
    category: 'partial_match',
    actualGap: true,
    actualSources: ['brain/forge/themes/other.md'],
    forgeRoot: root,
  });
  assert.equal(r.passed, false);
  assert.ok(r.reasons.includes('missing_required_partial_match'));
});

test('partial_match: fails when too_many_sources (citation spam)', () => {
  const root = tmpRoot();
  for (const name of ['a', 'b', 'c', 'd', 'e']) {
    writeFileSync(join(root, 'brain', 'forge', 'themes', `${name}.md`), `# ${name}`);
  }
  const r = scoreNegativeCase({
    expected: {
      gap: true,
      max_sources: 4,
      must_include_any_of: ['brain/forge/themes/real.md'],
    },
    category: 'partial_match',
    actualGap: true,
    actualSources: [
      'brain/forge/themes/real.md',
      'brain/forge/themes/a.md',
      'brain/forge/themes/b.md',
      'brain/forge/themes/c.md',
      'brain/forge/themes/d.md',
    ],
    forgeRoot: root,
  });
  assert.equal(r.passed, false);
  assert.ok(r.reasons.some((x) => x.startsWith('too_many_sources')));
});

test('summariseNegatives: aggregates by category and reports hallucination rate', () => {
  const summary = summariseNegatives([
    { passed: true, category: 'out_of_scope', hallucinated: [] },
    { passed: false, category: 'out_of_scope', hallucinated: [] },
    { passed: true, category: 'forge_adjacent_bait', hallucinated: [] },
    { passed: false, category: 'partial_match', hallucinated: ['brain/fake.md'] },
  ]);
  assert.equal(summary.total, 4);
  assert.equal(summary.passed, 2);
  assert.equal(summary.pass_rate, 0.5);
  assert.equal(summary.by_category.out_of_scope.passed, 1);
  assert.equal(summary.by_category.out_of_scope.total, 2);
  assert.equal(summary.hallucination_rate, 0.25);
});
