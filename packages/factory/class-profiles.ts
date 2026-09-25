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
 * `packages/factory` or `packages/stations`.
 *
 * This module decides nothing. Consumers read a profile with `profileFor(cls)`
 * and act on the columns.
 *
 * F3 (operator ruling, items 81/83): `ChangeClass` and `GateProfile` moved to
 * `@forge/stations/class-profile-port.ts` VERBATIM — the bands that read this
 * table now live in `@forge/stations` and take the table by injection (the
 * `ClassProfilePort`), not by importing this file, so `packages/factory` stays
 * deletable without deleting execution. This module imports both types back
 * down and stays their one home: the table, the four functions and every
 * value below are unchanged.
 */

import { readFileSync } from 'node:fs';

import type { ChangeClass, GateProfile } from '@forge/stations';
import { CHANGE_CLASSES, parseManifest } from '@forge/flows/manifest.ts';

export type { ChangeClass, GateProfile };
export { CHANGE_CLASSES };

export const CLASS_PROFILES: Readonly<Record<ChangeClass, GateProfile>> = {
  code: {
    iter0FailFirst: 'required',
    requiredPathsSource: 'wi.creates',
    mergeBoundaryTest: ['ci', 'local'],
    mergeBoundaryVerb: null,
    capture: 'checkpoints',
    reviewLenses: ['correctness', 'containment', 'test-strength', 'boundary'],
    singleWiAllowed: false,
    reviewCeilingUsd: 8,
  },
  docs: {
    iter0FailFirst: 'off',
    // Ruling 300: the declared scope, always — see the column's own comment.
    requiredPathsSource: 'files-in-scope',
    mergeBoundaryTest: [],
    mergeBoundaryVerb: 'gate docs',
    capture: 'none',
    reviewLenses: ['accuracy-against-source', 'link-integrity', 'forbidden-tokens', 'structure'],
    singleWiAllowed: true,
    reviewCeilingUsd: 4,
  },
  config: {
    iter0FailFirst: 'off',
    requiredPathsSource: 'wi.creates',
    mergeBoundaryTest: ['local'],
    mergeBoundaryVerb: null,
    capture: 'none',
    reviewLenses: ['schema-validity', 'secret-exposure', 'drift-from-declared', 'rollback'],
    singleWiAllowed: true,
    reviewCeilingUsd: 4,
  },
  infra: {
    iter0FailFirst: 'required',
    requiredPathsSource: 'wi.creates',
    mergeBoundaryTest: ['ci', 'local'],
    mergeBoundaryVerb: null,
    capture: 'plan-output',
    reviewLenses: ['blast-radius', 'idempotence', 'secret-exposure', 'rollback'],
    singleWiAllowed: false,
    reviewCeilingUsd: 8,
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

/**
 * Does a work item's iteration-0 hollow-gate guard run? Two independent reasons
 * to disable it, and both are honoured: THE CLASS (`iter0FailFirst` — a `docs`
 * work item has no failing test to write first, so its gate legitimately passes
 * on the untouched base) and THE WORK ITEM (`behavior_preserving` — a
 * rename/move leaves the suite green either side; the diff and the
 * empty-delivery backstop still guard against a no-op).
 */
export function hollowGateGuardFor(
  iter0FailFirst: GateProfile['iter0FailFirst'],
  behaviorPreserving: boolean | undefined,
): boolean {
  return iter0FailFirst === 'required' && !behaviorPreserving;
}
