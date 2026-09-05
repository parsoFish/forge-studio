/**
 * The change class and its gate profile — ONE data table, no logic.
 *
 * ADR 051: `class` is a typed, required manifest field; the architect sets it,
 * the plan gate confirms it, and every work item inherits it. This module holds
 * the operator-authored table that maps a class to the gates its work is judged
 * by (roadmap §5 H7). The values are the operator's; the columns are fixed by
 * spec §5 item 1.
 *
 * IT DECLARES NO VOCABULARY OF ITS OWN. The union is the manifest field's
 * (`@forge/contracts`) and the runtime list is the validator's
 * (`@forge/flows`), so the table is keyed by the same four names the field is
 * checked against and cannot drift from what it claims to describe. A private
 * copy of `['code','docs','config','infra']` here would be a second source of
 * truth that agrees until someone edits one of them.
 *
 * WHY A TABLE AND NOT A BRANCH. What this replaces is
 * `packages/projects/gate-recipes.ts`'s `detectProjectLanguage()`, which sniffs
 * `go.mod` / `Cargo.toml` / `pyproject.toml` / `package.json` and hands the
 * project manager a per-LANGUAGE gate template — it answers "what language is
 * this repo" when the question is "what kind of change is this", so a docs
 * initiative in a Go repo is handed a Go test recipe. A phase that re-derives a
 * profile by branching on a class name can drift from this table while claiming
 * to obey it; `class-profiles.contract.test.ts` fails on any such branch inside
 * `packages/factory`.
 *
 * This module decides nothing. Consumers read a profile with `profileFor(cls)`
 * and act on the columns.
 */

import { readFileSync } from 'node:fs';

import type { InitiativeManifest } from '@forge/contracts/manifest-types.ts';
import { CHANGE_CLASSES, parseManifest } from '@forge/flows/manifest.ts';
import type { RequiredPathsSource } from '@forge/flows/work-item.ts';

/** The manifest field's own union — not a second declaration of it. */
export type ChangeClass = InitiativeManifest['class'];

export { CHANGE_CLASSES };

export type GateProfile = {
  /** Must the per-WI quality gate FAIL on the untouched base before iteration 1? */
  iter0FailFirst: 'required' | 'advisory' | 'off';
  /**
   * Where the ralph runner's diff-inclusion list comes from. The union is
   * `@forge/flows`' own (`work-item.ts`, beside `gateRequiredPaths`), not a
   * copy of it — see the module header on why this table declares no
   * vocabulary of its own.
   */
  requiredPathsSource: RequiredPathsSource;
  /** Which `testProcess.*` the ORCHESTRATOR runs at the merge boundary, in order; [] = none. */
  mergeBoundaryTest: ReadonlyArray<'ci' | 'local' | 'acceptance'>;
  /** An orchestrator verb run at the merge boundary in addition to the above; null = none. */
  mergeBoundaryVerb: 'gate docs' | null;
  /** What evidence the integrate band captures. */
  capture: 'checkpoints' | 'plan-output' | 'none';
  /** The review agent's lenses for this class (spec §5 item 5). */
  reviewLenses: ReadonlyArray<string>;
  /** Does the reflector run? */
  reflect: 'always' | 'optional';
  /**
   * May an initiative of this class be a SINGLE deliverable outcome?
   *
   * Enforced in two places, which ruling 229 settled after the column's first
   * consumer showed the sentence could be read two ways:
   *   - GATE, at the plan gate, on the manifest's declared `acceptance_criteria`
   *     — exactly one criterion for a `false` class is REFUSED before any spend.
   *   - FLAG, at the project manager, on the decomposed work-item count — a
   *     one-item set for a `false` class is recorded for the report and NEVER
   *     fails the pass, because a one-item decomposition of a genuinely
   *     one-item initiative is the PM being correct, and the PM is the wrong
   *     actor to punish for the architect's scoping.
   */
  singleWiAllowed: boolean;
};

export const CLASS_PROFILES: Readonly<Record<ChangeClass, GateProfile>> = {
  code: {
    iter0FailFirst: 'required',
    requiredPathsSource: 'wi.creates',
    mergeBoundaryTest: ['ci', 'local'],
    mergeBoundaryVerb: null,
    capture: 'checkpoints',
    reviewLenses: ['correctness', 'containment', 'test-strength', 'boundary'],
    reflect: 'always',
    singleWiAllowed: false,
  },
  docs: {
    iter0FailFirst: 'off',
    requiredPathsSource: 'wi.creates',
    mergeBoundaryTest: [],
    mergeBoundaryVerb: 'gate docs',
    capture: 'none',
    reviewLenses: ['accuracy-against-source', 'link-integrity', 'forbidden-tokens', 'structure'],
    reflect: 'optional',
    singleWiAllowed: true,
  },
  config: {
    iter0FailFirst: 'off',
    requiredPathsSource: 'wi.creates',
    mergeBoundaryTest: ['local'],
    mergeBoundaryVerb: null,
    capture: 'none',
    reviewLenses: ['schema-validity', 'secret-exposure', 'drift-from-declared', 'rollback'],
    reflect: 'optional',
    singleWiAllowed: true,
  },
  infra: {
    iter0FailFirst: 'advisory',
    requiredPathsSource: 'wi.creates',
    mergeBoundaryTest: ['ci', 'local'],
    mergeBoundaryVerb: null,
    capture: 'plan-output',
    reviewLenses: ['blast-radius', 'idempotence', 'secret-exposure', 'rollback'],
    reflect: 'always',
    singleWiAllowed: false,
  },
};

/** True for a string that names a change class. The one predicate a reader needs. */
export function isChangeClass(value: unknown): value is ChangeClass {
  return typeof value === 'string' && (CHANGE_CLASSES as readonly string[]).includes(value as ChangeClass);
}

/**
 * The profile for a class. Total over `ChangeClass` by construction — there is
 * no default and no fallback, because a class the table does not know is a
 * validation error at the plan gate, never a silently-code-shaped run.
 */
export function profileFor(cls: ChangeClass): GateProfile {
  return CLASS_PROFILES[cls];
}

/**
 * The initiative's change class, read from its manifest. NOT best-effort: the
 * class selects the gate profile, so an unreadable manifest here has no honest
 * default — running under a guessed policy is worse than refusing to run.
 *
 * It lives with the table because every caller that reads a profile needs it
 * first, and two independent manifest reads would be two answers to the same
 * question the moment one of them grew a fallback.
 */
export function readChangeClass(manifestPath: string): ChangeClass {
  return parseManifest(readFileSync(manifestPath, 'utf8')).class;
}
