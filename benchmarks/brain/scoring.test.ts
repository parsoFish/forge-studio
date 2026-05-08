/**
 * Pure-function tests for brain benchmark scoring. No SDK mocked here — that's
 * sdk.test.ts. These verify recall, F1 (diagnostic), keyword matching, and path
 * normalisation behave as the README documents.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  caseScore,
  detectHallucinatedPaths,
  keywordMatch,
  matchKeyword,
  normalisePath,
  sourceF1,
  sourceRecall,
} from './scoring.ts';

test('normalisePath: prefixes brain/ when missing, lowercases, strips ./', () => {
  assert.equal(normalisePath('brain/forge/themes/x.md'), 'brain/forge/themes/x.md');
  assert.equal(normalisePath('forge/themes/x.md'), 'brain/forge/themes/x.md');
  assert.equal(normalisePath('./brain/forge/themes/X.md'), 'brain/forge/themes/x.md');
  assert.equal(normalisePath('  Brain/Forge/Themes/X.md  '), 'brain/forge/themes/x.md');
});

test('sourceF1: full match scores 1', () => {
  const expected = ['brain/forge/themes/a.md', 'brain/forge/themes/b.md'];
  const actual = ['brain/forge/themes/a.md', 'brain/forge/themes/b.md'];
  assert.equal(sourceF1(expected, actual), 1);
});

test('sourceF1: half match scores 0.5 (1 hit out of 2 expected, 1 actual)', () => {
  const expected = ['brain/forge/themes/a.md', 'brain/forge/themes/b.md'];
  const actual = ['brain/forge/themes/a.md'];
  // F1 = 2*1 / (2 + 1) = 0.6666...
  assert.ok(Math.abs(sourceF1(expected, actual) - 2 / 3) < 1e-9);
});

test('sourceF1: penalises citation spam (asymmetric containment would not)', () => {
  const expected = ['brain/forge/themes/a.md'];
  const actual = [
    'brain/forge/themes/a.md',
    'brain/forge/themes/junk1.md',
    'brain/forge/themes/junk2.md',
    'brain/forge/themes/junk3.md',
  ];
  // F1 = 2*1 / (1 + 4) = 0.4. Asymmetric containment would have given 1.0.
  assert.equal(sourceF1(expected, actual), 0.4);
});

test('sourceF1: empty expected and actual is 1 (vacuously true)', () => {
  assert.equal(sourceF1([], []), 1);
});

test('sourceF1: empty actual scores 0 when expected non-empty', () => {
  assert.equal(sourceF1(['brain/forge/themes/a.md'], []), 0);
});

test('sourceF1: handles missing brain/ prefix and case differences via normalisation', () => {
  const expected = ['brain/forge/themes/Ralph-Loop-Pattern.md'];
  const actual = ['./forge/themes/ralph-loop-pattern.md'];
  assert.equal(sourceF1(expected, actual), 1);
});

test('keywordMatch: full hit', () => {
  assert.equal(keywordMatch(['ralph', 'sdk'], 'Forge uses Ralph atop the SDK.'), 1);
});

test('keywordMatch: half hit (one full, one no-match)', () => {
  assert.equal(keywordMatch(['ralph', 'aider'], 'Forge uses Ralph.'), 0.5);
});

test('keywordMatch: case-insensitive substring', () => {
  assert.equal(keywordMatch(['MaXTuRnS'], 'The maxturns budget'), 1);
});

test('keywordMatch: empty expected = 1 (vacuously true)', () => {
  assert.equal(keywordMatch([], 'anything'), 1);
});

test('matchKeyword tier 1: full substring stays 1.0', () => {
  assert.equal(matchKeyword('gw:plan', 'GitWeave uses gw:plan to dry-run.'), 1);
  assert.equal(matchKeyword('48%', 'failure rate of 48% in v1'), 1);
});

test('matchKeyword tier 2: single-word stem match scores 0.7', () => {
  // "secrets" not present, but stem "secret" appears
  assert.equal(matchKeyword('secrets', 'Mandatory credential redaction prevents secret leakage.'), 0.7);
  assert.equal(matchKeyword('principles', 'Three core principle drives this design.'), 0.7);
});

test('matchKeyword tier 2: multi-word all-tokens-present scores 0.7', () => {
  // "atomic mv" → tokens ["atomic","mv"]; both stems appear in answer
  assert.equal(matchKeyword('atomic mv', 'The scheduler uses atomic filesystem moves via mv.'), 0.7);
});

test('matchKeyword tier 2: multi-word half-tokens-present scores 0.4', () => {
  // "agent stage" → tokens ["agent","stage"]; only "stage" stem present (in "two-stage")
  // "two-stage" tokenizes to ["two","stage"], stem of "stage" is "stage"; agent absent.
  assert.equal(matchKeyword('agent stage', 'The two-stage pipeline triages first.'), 0.4);
});

test('matchKeyword tier 0: no signal scores 0', () => {
  assert.equal(matchKeyword('kubernetes', 'forge runs in WSL via tmux.'), 0);
});

test('matchKeyword: paraphrase precision — semantically distinct phrases never reach 1.0', () => {
  // "two-stage pipeline" should NOT get 1.0 for "agent stage" — they describe
  // different things even though tokens overlap. Partial credit (0.4) is the
  // ceiling.
  const score = matchKeyword('agent stage', 'The two-stage pipeline triages first.');
  assert.ok(score < 1, `partial-credit ceiling: ${score}`);
});

test('keywordMatch: averages per-keyword scores (mixed tiers)', () => {
  // 3 keywords:
  //   "ralph" → tier 1 (1.0)
  //   "secrets" → tier 2 stem (0.7) — answer has "secret"
  //   "kubernetes" → tier 0 (0.0)
  // mean = (1 + 0.7 + 0) / 3 = 0.5666...
  const score = keywordMatch(
    ['ralph', 'secrets', 'kubernetes'],
    'Ralph treats every secret as redacted before storage.',
  );
  assert.ok(Math.abs(score - 1.7 / 3) < 1e-9);
});

test('sourceRecall: full match scores 1', () => {
  const expected = ['brain/forge/themes/a.md', 'brain/forge/themes/b.md'];
  const actual = ['brain/forge/themes/a.md', 'brain/forge/themes/b.md'];
  assert.equal(sourceRecall(expected, actual), 1);
});

test('sourceRecall: extras do NOT reduce score (recall is precision-blind)', () => {
  const expected = ['brain/forge/themes/a.md', 'brain/forge/themes/b.md'];
  const actual = [
    'brain/forge/themes/a.md',
    'brain/forge/themes/b.md',
    'brain/forge/themes/extra.md',
  ];
  assert.equal(sourceRecall(expected, actual), 1, 'all expected found, extras irrelevant');
});

test('sourceRecall: half match scores 0.5', () => {
  assert.equal(
    sourceRecall(['brain/forge/themes/a.md', 'brain/forge/themes/b.md'], ['brain/forge/themes/a.md']),
    0.5,
  );
});

test('sourceRecall: empty expected is 1 (vacuously true)', () => {
  assert.equal(sourceRecall([], ['brain/x.md']), 1);
});

test('detectHallucinatedPaths: flags paths that do not exist on disk', () => {
  const root = mkdtempSync(join(tmpdir(), 'scoring-test-'));
  mkdirSync(join(root, 'brain', 'forge', 'themes'), { recursive: true });
  writeFileSync(join(root, 'brain', 'forge', 'themes', 'real.md'), '# real');

  const halls = detectHallucinatedPaths(
    ['brain/forge/themes/real.md', 'brain/forge/themes/fabricated.md'],
    root,
  );
  assert.deepEqual(halls, ['brain/forge/themes/fabricated.md']);
});

test('detectHallucinatedPaths: empty when all paths exist', () => {
  const root = mkdtempSync(join(tmpdir(), 'scoring-test-'));
  mkdirSync(join(root, 'brain'), { recursive: true });
  writeFileSync(join(root, 'brain', 'a.md'), '# a');
  assert.deepEqual(detectHallucinatedPaths(['brain/a.md'], root), []);
});

test('detectHallucinatedPaths: case-insensitive — lowercased citation matches mixed-case dir', () => {
  // Models often lowercase project names. Case mismatches are rendering quirks,
  // not hallucinations.
  const root = mkdtempSync(join(tmpdir(), 'scoring-test-'));
  mkdirSync(join(root, 'brain', 'projects', 'GitWeave', 'themes'), { recursive: true });
  writeFileSync(join(root, 'brain', 'projects', 'GitWeave', 'themes', 'foo.md'), '# foo');

  // Cited path is lowercased (`gitweave`) but real dir is `GitWeave`.
  const halls = detectHallucinatedPaths(
    ['brain/projects/gitweave/themes/foo.md'],
    root,
  );
  assert.deepEqual(halls, [], 'case-insensitive match should NOT flag as hallucinated');
});

test('caseScore: max score is 1.0 for full recall + full keyword match', () => {
  const root = mkdtempSync(join(tmpdir(), 'scoring-test-'));
  mkdirSync(join(root, 'brain', 'forge', 'themes'), { recursive: true });
  writeFileSync(join(root, 'brain', 'forge', 'themes', 'a.md'), '# a');
  writeFileSync(join(root, 'brain', 'forge', 'themes', 'b.md'), '# b');

  const r = caseScore({
    expectedSources: ['brain/forge/themes/a.md', 'brain/forge/themes/b.md'],
    expectedKeywords: ['ralph', 'sdk'],
    actualSources: ['brain/forge/themes/a.md', 'brain/forge/themes/b.md'],
    actualAnswer: 'Ralph atop the Claude Agent SDK.',
    forgeRoot: root,
  });
  assert.equal(r.source_recall, 1);
  assert.equal(r.keyword_match, 1);
  assert.equal(r.score, 1);
});

test('caseScore: extras do not penalise (judge-validated rubric)', () => {
  const root = mkdtempSync(join(tmpdir(), 'scoring-test-'));
  mkdirSync(join(root, 'brain', 'forge', 'themes'), { recursive: true });
  for (const f of ['a.md', 'extra1.md', 'extra2.md']) {
    writeFileSync(join(root, 'brain', 'forge', 'themes', f), '# x');
  }

  const r = caseScore({
    expectedSources: ['brain/forge/themes/a.md'],
    expectedKeywords: ['x'],
    actualSources: [
      'brain/forge/themes/a.md',
      'brain/forge/themes/extra1.md',
      'brain/forge/themes/extra2.md',
    ],
    actualAnswer: 'x is the answer',
    forgeRoot: root,
  });
  // recall = 1.0 (found expected); F1 would be much lower (1/3 precision).
  assert.equal(r.source_recall, 1);
  assert.ok(r.source_f1 < 1, 'F1 surfaced as diagnostic');
  assert.equal(r.score, 1, 'extras must not penalise the pass score');
});

test('caseScore: hallucinated path forces score to 0', () => {
  const root = mkdtempSync(join(tmpdir(), 'scoring-test-'));
  mkdirSync(join(root, 'brain', 'forge', 'themes'), { recursive: true });
  writeFileSync(join(root, 'brain', 'forge', 'themes', 'real.md'), '# real');

  const r = caseScore({
    expectedSources: ['brain/forge/themes/real.md'],
    expectedKeywords: ['x'],
    actualSources: ['brain/forge/themes/real.md', 'brain/forge/themes/fake.md'],
    actualAnswer: 'x',
    forgeRoot: root,
  });
  assert.equal(r.score, 0, 'hallucinated path → automatic 0');
  assert.deepEqual(r.hallucinated_paths, ['brain/forge/themes/fake.md']);
});

test('caseScore: judge-validated combo — partial recall + correct synthesis passes 0.65 bar', () => {
  // Q3-shape: 1 of 2 expected sources cited (recall 0.5), keyword match 1.0.
  // Recall-based score = 0.4*0.5 + 0.6*1.0 = 0.8 → passes 0.65 threshold.
  const root = mkdtempSync(join(tmpdir(), 'scoring-test-'));
  mkdirSync(join(root, 'brain', 'forge', 'themes'), { recursive: true });
  writeFileSync(join(root, 'brain', 'forge', 'themes', 'a.md'), '# a');

  const r = caseScore({
    expectedSources: ['brain/forge/themes/a.md', 'brain/forge/themes/b.md'],
    expectedKeywords: ['council', 'critic'],
    actualSources: ['brain/forge/themes/a.md'],
    actualAnswer: 'The council uses critic chains.',
    forgeRoot: root,
  });
  assert.ok(r.score >= 0.65, `score ${r.score} should clear 0.65 pass bar`);
});
