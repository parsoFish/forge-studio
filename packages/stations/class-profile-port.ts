/**
 * The one port `@forge/stations` uses to reach the class → gate-profile table
 * (ADR 051). The bands need `profileFor`/`readChangeClass`/`isChangeClass`/
 * `hollowGateGuardFor`, but the table itself — `class-profiles.ts`, and the
 * operator-authored VALUES in it — stays in `packages/factory`: the example's,
 * not the platform's (operator ruling, items 81/83). A second factory can ship
 * its own table and bind it through this same port; nothing here assumes the
 * example is installed.
 *
 * `ChangeClass` and `GateProfile` moved here VERBATIM from `class-profiles.ts`,
 * which now imports both back down (`@forge/stations`) and stays the table's
 * one home — its columns, its values and its four functions are unchanged.
 */

import type { InitiativeManifest } from '@forge/contracts/manifest-types.ts';
import type { RequiredPathsSource } from '@forge/flows/work-item.ts';

/** The manifest field's own union — not a second declaration of it. */
export type ChangeClass = InitiativeManifest['class'];

export type GateProfile = {
  /**
   * Must the per-WI quality gate FAIL on the untouched base before iteration 1?
   *
   * Two values, not three. `'advisory'` — run the iteration-0 check, record it,
   * do not fail the work item — has no mapping onto the ralph runner's
   * `failOnHollowIter0Gate` boolean, and giving it one meant editing
   * `packages/agents` at exactly its cap. The `infra` row it was written for now
   * reads `'required'`, the safe direction: a gate that passes before any work
   * exists still stops the work item. Narrowed under T1 ruling 292 and RATIFIED
   * by the operator in window 8 (ruling 300).
   */
  iter0FailFirst: 'required' | 'off';
  /**
   * Where the ralph runner's diff-inclusion list comes from. The union is
   * `@forge/flows`' own (`work-item.ts`, beside `gateRequiredPaths`), not a
   * copy of it — see the module header on why this table declares no
   * vocabulary of its own.
   *
   * `docs` is the one row off the `'wi.creates'` priority chain (ruling 300):
   * the chain stops at `creates`, so a docs WI that declared two pages to
   * revise and created one new page passed its gate touching neither.
   */
  requiredPathsSource: RequiredPathsSource;
  /**
   * Which `testProcess.*` the ORCHESTRATOR runs at the merge boundary, in
   * order; `[]` = none, and then `mergeBoundaryVerb` must not be null — a class
   * with neither has no merge boundary at all, which the contract test refuses.
   *
   * `'acceptance'` was dropped from the union with `'advisory'` and for the same
   * reason: no gate implements it and no row selected it. Narrowed under T1
   * ruling 292 and RATIFIED by the operator in window 8 (ruling 300).
   */
  mergeBoundaryTest: ReadonlyArray<'ci' | 'local'>;
  /** An orchestrator verb run at the merge boundary in addition to the above; null = none. */
  mergeBoundaryVerb: 'gate docs' | null;
  /** What evidence the integrate band captures. */
  capture: 'checkpoints' | 'plan-output' | 'none';
  /** The review agent's lenses for this class (spec §5 item 5). */
  reviewLenses: ReadonlyArray<string>;
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
  /**
   * The WALL on a review chunk's derived spend ceiling, in dollars (beads
   * `forge-gefz` / `forge-jb7i`, operator ruling 475).
   *
   * `adversarial-review` no longer hands the SDK its flat declared
   * `maxBudgetUsd`. The ceiling is DERIVED from the diff the chunk is actually
   * given (`phases/review-budget.ts`) — because the work scales with the diff
   * and the declared number does not — and this column is where that curve
   * stops. Without it "derive from the diff" is "unbounded".
   */
  reviewCeilingUsd: number;
};

/**
 * The class table, behind a port. A factory binds one (today,
 * `packages/factory/class-profiles.ts`'s four functions, wired by
 * `apps/forge/factory-wiring.ts` into `createPhaseExecutor({ classProfiles })`);
 * a station takes it optionally and refuses BY NAME — `requireClassProfiles`
 * below — when it needs a profile and none is bound. Never a default profile:
 * a station that guessed one would be enforcing gates the operator never set.
 */
export type ClassProfilePort = {
  profileFor(changeClass: ChangeClass): GateProfile;
  readChangeClass(manifestPath: string): ChangeClass;
  isChangeClass(value: unknown): value is ChangeClass;
  hollowGateGuardFor(iter0FailFirst: GateProfile['iter0FailFirst'], behaviorPreserving: boolean | undefined): boolean;
};

/**
 * The bound port, or a loud, named refusal. `station` is the band that needed
 * it (`developer-loop`, `adversarial-review`, `integrate`,
 * `pm-class-set-rules`, `merge-boundary`) — every call site names itself, so
 * the error tells the operator which station to wire a table for, not just
 * that "something" needed one.
 */
export function requireClassProfiles(port: ClassProfilePort | undefined, station: string): ClassProfilePort {
  if (!port) {
    throw new Error(
      `station "${station}" needs a class profile table (ClassProfilePort) and none is bound — the example factory provides one`,
    );
  }
  return port;
}
