/**
 * Pure scoring functions for the architect benchmark. Kept separate from
 * score.ts (the runner) so they're trivially unit-testable without mocking
 * the SDK.
 *
 * Per benchmarks/architect/README.md and the plan:
 *   manifest_valid is a gate. If 0, total = 0 (mirrors brain's hallucinated-path
 *   gate). Otherwise a weighted average over three rubric criteria:
 *     0.4 * specs_concrete + 0.3 * scope_right_sized + 0.3 * brain_consulted
 *   Pass threshold = 0.7 (same bar as the brain bench).
 *
 * Why these four dimensions and no others:
 *   - manifest_valid    : reuses orchestrator/manifest.ts:validateManifest. If
 *                         the architect produced something the queue can't
 *                         load, no other quality dimension matters.
 *   - scope_right_sized : feature count within an expected range. Cheap to
 *                         check; catches the "agent over-reaches" failure
 *                         mode called out in docs/phases/architect.md.
 *   - specs_concrete    : every feature has acceptance criteria in the body
 *                         (Given-When-Then OR an `Acceptance` heading).
 *                         Catches "vague acceptance criteria" — the failure
 *                         that propagates downstream and breaks the dev loop.
 *   - brain_consulted   : body cites a `brain/` path. Proxy for the
 *                         brain-first discipline (ADR 010); if the body never
 *                         mentions brain/, the architect almost certainly
 *                         skipped the mandatory first action.
 *
 * Council-invoked / brain-query-first as separate criteria require runtime
 * instrumentation we don't have without an event log. The artifact-quality
 * proxy criteria above cover the same ground at much lower complexity. If
 * the bench plateaus on the prompt and we want to disambiguate "agent
 * skipped step X" from "agent did step X badly", we add event-log assertions
 * later.
 */

import { parseManifest, validateManifest, type InitiativeManifest } from '../../orchestrator/manifest.ts';

export type ArchitectExpected = {
  /** Inclusive lower bound on feature count. Default 1. */
  min_features?: number;
  /** Inclusive upper bound on feature count. Default 5. */
  max_features?: number;
};

export type ArchitectCriteria = {
  manifest_valid: number;       // 0 or 1
  scope_right_sized: number;    // 0 or 1
  specs_concrete: number;       // 0 or 1
  brain_consulted: number;      // 0 or 1
};

export type ArchitectScore = {
  score: number;                // weighted in [0, 1]
  passed: boolean;              // score >= PASS_THRESHOLD
  criteria: ArchitectCriteria;
  manifest_errors: string[];    // from validateManifest, empty when valid
  feature_count: number;
};

export const PASS_THRESHOLD = 0.7;

// Weights — must sum to 1. specs_concrete weighted highest because vague
// criteria are the failure mode that most damages the downstream loop.
export const WEIGHT_SPECS = 0.4;
export const WEIGHT_SCOPE = 0.3;
export const WEIGHT_BRAIN = 0.3;

/**
 * Parse and validate. Returns the parsed manifest plus validateManifest errors.
 * Throws only on unparseable input (malformed YAML / no frontmatter); validation
 * errors are returned as data.
 */
export function loadManifestForScoring(content: string): { manifest: InitiativeManifest | null; errors: string[]; parseError?: string } {
  let manifest: InitiativeManifest;
  try {
    manifest = parseManifest(content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { manifest: null, errors: [], parseError: message };
  }
  const errors = validateManifest(manifest);
  return { manifest, errors };
}

/** Feature count within [min, max] inclusive. */
export function scopeRightSized(featureCount: number, expected: ArchitectExpected): number {
  const min = expected.min_features ?? 1;
  const max = expected.max_features ?? 5;
  return featureCount >= min && featureCount <= max ? 1 : 0;
}

/**
 * Every feature has acceptance criteria expressed in its body.
 *
 * The architect's body structure isn't rigidly fixed — it may write
 * per-feature sections (`## FEAT-1: <title>` then prose) or a single
 * `## Acceptance criteria` block listing all features. We accept either by
 * counting evidence and requiring at least `features.length` matches.
 *
 * Evidence patterns (case-insensitive):
 *   - Given-When-Then triads: a `Given` line followed (within ~400 chars) by
 *     `When` and `Then`.
 *   - `## Acceptance` / `### Acceptance` / `**Acceptance criteria**` headings.
 */
export function specsConcrete(body: string, featureCount: number): number {
  if (featureCount === 0) return 0;
  const triads = countGivenWhenThen(body);
  const headings = countAcceptanceHeadings(body);
  return Math.max(triads, headings) >= featureCount ? 1 : 0;
}

export function countGivenWhenThen(body: string): number {
  // Each triad is `given … when … then` with at most ~400 chars between
  // tokens, anchored on a word-ish boundary at `given`. Non-greedy spans let
  // adjacent triads each match as their own group.
  const re = /(?:^|[\s\n*\->(])given\b[\s\S]{0,400}?\bwhen\b[\s\S]{0,400}?\bthen\b/gi;
  return (body.match(re) ?? []).length;
}

export function countAcceptanceHeadings(body: string): number {
  const re = /^\s*(?:#{2,6}\s+|\*\*\s*)acceptance(?:\s+criteria)?(?:\s*\*\*)?\s*:?\s*$/gim;
  return (body.match(re) ?? []).length;
}

/**
 * Body cites the brain. Cheap proxy for the brain-first discipline: if the
 * architect followed its skill, the manifest body will reference at least one
 * brain path or theme. We accept any `brain/` path token.
 */
export function brainConsulted(body: string): number {
  return /\bbrain\/[\w./-]+/i.test(body) ? 1 : 0;
}

export function caseScore(args: {
  manifestText: string;
  expected: ArchitectExpected;
}): ArchitectScore {
  const { manifest, errors, parseError } = loadManifestForScoring(args.manifestText);

  if (parseError !== undefined || manifest === null) {
    return {
      score: 0,
      passed: false,
      criteria: { manifest_valid: 0, scope_right_sized: 0, specs_concrete: 0, brain_consulted: 0 },
      manifest_errors: parseError !== undefined ? [parseError] : ['parseManifest returned null'],
      feature_count: 0,
    };
  }

  const manifest_valid = errors.length === 0 ? 1 : 0;
  const featureCount = manifest.features.length;
  const scope = scopeRightSized(featureCount, args.expected);
  const specs = specsConcrete(manifest.body, featureCount);
  const brain = brainConsulted(manifest.body);

  // Gate: invalid manifest → score 0 regardless of other dimensions.
  const score = manifest_valid === 0
    ? 0
    : WEIGHT_SPECS * specs + WEIGHT_SCOPE * scope + WEIGHT_BRAIN * brain;

  return {
    score,
    passed: score >= PASS_THRESHOLD,
    criteria: { manifest_valid, scope_right_sized: scope, specs_concrete: specs, brain_consulted: brain },
    manifest_errors: errors,
    feature_count: featureCount,
  };
}
