/**
 * Pure-function tests for architect benchmark scoring. No SDK mocked here —
 * that's sdk.test.ts. These verify each rubric dimension and the gate
 * behaviour (invalid manifest → 0).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  brainConsulted,
  caseScore,
  countAcceptanceHeadings,
  countGivenWhenThen,
  loadManifestForScoring,
  PASS_THRESHOLD,
  scopeRightSized,
  specsConcrete,
  WEIGHT_BRAIN,
  WEIGHT_SCOPE,
  WEIGHT_SPECS,
} from './scoring.ts';

const VALID_FRONTMATTER = [
  '---',
  'initiative_id: INIT-2026-05-08-oauth',
  'project: simplarr',
  'project_repo_path: /home/parso/projects/simplarr',
  'created_at: \'2026-05-08T16:00:00.000Z\'',
  'iteration_budget: 50',
  'cost_budget_usd: 25',
  'phase: pending',
  'features:',
  '  - feature_id: FEAT-1',
  '    title: Stub OAuth provider config',
  '    depends_on: []',
  '  - feature_id: FEAT-2',
  '    title: Wire login button',
  '    depends_on: [FEAT-1]',
  '---',
  '',
].join('\n');

function manifestWith(body: string): string {
  return VALID_FRONTMATTER + body;
}

test('weights sum to 1', () => {
  assert.equal(WEIGHT_SPECS + WEIGHT_SCOPE + WEIGHT_BRAIN, 1);
});

test('loadManifestForScoring: valid manifest parses with no errors', () => {
  const r = loadManifestForScoring(manifestWith('# Body\n'));
  assert.notEqual(r.manifest, null);
  assert.deepEqual(r.errors, []);
  assert.equal(r.parseError, undefined);
});

test('loadManifestForScoring: malformed input yields parseError, no errors thrown', () => {
  const r = loadManifestForScoring('not a real manifest, no frontmatter');
  // gray-matter accepts arbitrary input but parseManifest will throw on missing required fields.
  assert.equal(r.manifest, null);
  assert.notEqual(r.parseError, undefined);
});

test('loadManifestForScoring: missing budgets surface as validation errors', () => {
  const text = [
    '---',
    'initiative_id: INIT-2026-05-08-x',
    'project: x',
    'created_at: \'2026-05-08T16:00:00.000Z\'',
    'iteration_budget: 0',
    'cost_budget_usd: 0',
    'phase: pending',
    '---',
    '',
    'body',
  ].join('\n');
  const r = loadManifestForScoring(text);
  assert.notEqual(r.manifest, null);
  assert.ok(r.errors.some((e) => e.includes('iteration_budget')));
  assert.ok(r.errors.some((e) => e.includes('cost_budget_usd')));
});

test('scopeRightSized: in range = 1', () => {
  assert.equal(scopeRightSized(2, { min_features: 1, max_features: 5 }), 1);
  assert.equal(scopeRightSized(1, { min_features: 1, max_features: 5 }), 1);
  assert.equal(scopeRightSized(5, { min_features: 1, max_features: 5 }), 1);
});

test('scopeRightSized: out of range = 0', () => {
  assert.equal(scopeRightSized(0, { min_features: 1, max_features: 5 }), 0);
  assert.equal(scopeRightSized(6, { min_features: 1, max_features: 5 }), 0);
});

test('scopeRightSized: defaults are min=1 max=5', () => {
  assert.equal(scopeRightSized(3, {}), 1);
  assert.equal(scopeRightSized(6, {}), 0);
});

test('countGivenWhenThen: counts a basic triad', () => {
  const body = 'Given a logged-out user\nWhen they click login\nThen they see the OAuth screen';
  assert.equal(countGivenWhenThen(body), 1);
});

test('countGivenWhenThen: counts two triads in one body', () => {
  const body = [
    '## FEAT-1',
    'Given X',
    'When Y',
    'Then Z',
    '',
    '## FEAT-2',
    'Given A',
    'When B',
    'Then C',
  ].join('\n');
  assert.equal(countGivenWhenThen(body), 2);
});

test('countGivenWhenThen: ignores `Given` without When/Then nearby', () => {
  const body = 'Given the system is up. Then we proceed (without intervening clauses).';
  // No `when` between `given` and `then` → not a valid triad.
  assert.equal(countGivenWhenThen(body), 0);
});

test('countGivenWhenThen: tolerates bullet prefix and case', () => {
  const body = '- given a user\n- WHEN they click\n- Then login fires';
  assert.equal(countGivenWhenThen(body), 1);
});

test('countAcceptanceHeadings: matches ## / ### / bold variants', () => {
  const body = [
    '## Acceptance',
    'stuff',
    '### Acceptance criteria',
    'more stuff',
    '**Acceptance criteria**',
  ].join('\n');
  assert.equal(countAcceptanceHeadings(body), 3);
});

test('countAcceptanceHeadings: ignores in-paragraph mentions', () => {
  const body = 'this paragraph mentions acceptance criteria but is not a heading.';
  assert.equal(countAcceptanceHeadings(body), 0);
});

test('specsConcrete: passes when triads >= feature count', () => {
  const body = ['Given X', 'When Y', 'Then Z', '', 'Given A', 'When B', 'Then C'].join('\n');
  assert.equal(specsConcrete(body, 2), 1);
});

test('specsConcrete: passes when headings >= feature count', () => {
  const body = ['## Acceptance', 'a', '## Acceptance criteria', 'b'].join('\n');
  assert.equal(specsConcrete(body, 2), 1);
});

test('specsConcrete: fails when both signals are short of feature count', () => {
  const body = ['Given X', 'When Y', 'Then Z'].join('\n');
  assert.equal(specsConcrete(body, 3), 0);
});

test('specsConcrete: fails on zero features (degenerate)', () => {
  assert.equal(specsConcrete('Given X When Y Then Z', 0), 0);
});

test('brainConsulted: matches a brain path mention', () => {
  assert.equal(brainConsulted('See brain/forge/themes/spec-driven-work-items.md for context.'), 1);
});

test('brainConsulted: matches uppercased / partial paths', () => {
  assert.equal(brainConsulted('reviewed Brain/projects/simplarr/profile.md'), 1);
});

test('brainConsulted: misses when no brain path is cited', () => {
  assert.equal(brainConsulted('We followed best practices and consulted internal docs.'), 0);
});

test('caseScore: full pass — valid manifest, scope ok, specs concrete, brain cited', () => {
  const body = [
    '## Why',
    'See brain/forge/themes/x.md',
    '',
    '## FEAT-1',
    'Given a user',
    'When they click',
    'Then it logs in',
    '',
    '## FEAT-2',
    'Given a user',
    'When they revisit',
    'Then session persists',
  ].join('\n');
  const r = caseScore({
    manifestText: manifestWith(body),
    expected: { min_features: 2, max_features: 4 },
  });
  assert.equal(r.criteria.manifest_valid, 1);
  assert.equal(r.criteria.scope_right_sized, 1);
  assert.equal(r.criteria.specs_concrete, 1);
  assert.equal(r.criteria.brain_consulted, 1);
  assert.equal(r.score, 1);
  assert.equal(r.passed, true);
});

test('caseScore: invalid manifest gates score to 0 regardless of body', () => {
  // iteration_budget = 0 → invalid
  const text = [
    '---',
    'initiative_id: INIT-2026-05-08-x',
    'project: x',
    'created_at: \'2026-05-08T16:00:00.000Z\'',
    'iteration_budget: 0',
    'cost_budget_usd: 25',
    'phase: pending',
    'features:',
    '  - feature_id: FEAT-1',
    '    title: t',
    '    depends_on: []',
    '---',
    '',
    'See brain/x.md',
    'Given a user',
    'When they act',
    'Then result',
  ].join('\n');
  const r = caseScore({ manifestText: text, expected: {} });
  assert.equal(r.criteria.manifest_valid, 0);
  assert.equal(r.score, 0);
  assert.equal(r.passed, false);
  assert.ok(r.manifest_errors.length > 0);
});

test('caseScore: partial pass — specs missing brings score below threshold', () => {
  // No acceptance criteria, but scope right and brain cited.
  const body = '## Why\nSee brain/forge/themes/x.md\nWe will add OAuth.';
  const r = caseScore({
    manifestText: manifestWith(body),
    expected: { min_features: 2, max_features: 4 },
  });
  assert.equal(r.criteria.manifest_valid, 1);
  assert.equal(r.criteria.scope_right_sized, 1);
  assert.equal(r.criteria.specs_concrete, 0);
  assert.equal(r.criteria.brain_consulted, 1);
  // 0.4*0 + 0.3*1 + 0.3*1 = 0.6 < 0.7
  assert.ok(Math.abs(r.score - 0.6) < 1e-9);
  assert.equal(r.passed, false);
});

test('caseScore: weighted score uses declared constants', () => {
  // Specs only — should be exactly WEIGHT_SPECS.
  const body = ['## FEAT-1', 'Given X', 'When Y', 'Then Z', '## FEAT-2', 'Given A', 'When B', 'Then C'].join('\n');
  const r = caseScore({
    manifestText: manifestWith(body),
    expected: { min_features: 4, max_features: 5 }, // scope = 0
  });
  assert.equal(r.criteria.specs_concrete, 1);
  assert.equal(r.criteria.scope_right_sized, 0);
  assert.equal(r.criteria.brain_consulted, 0);
  assert.ok(Math.abs(r.score - WEIGHT_SPECS) < 1e-9);
});

test('PASS_THRESHOLD matches plan (0.7)', () => {
  assert.equal(PASS_THRESHOLD, 0.7);
});
