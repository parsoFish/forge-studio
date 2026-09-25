/**
 * A `ClassProfilePort` fixture for tests that drive a station's REAL function
 * directly (not through `createPhaseExecutor`, which a production caller
 * binds a real table into). `packages/stations` may not import
 * `packages/factory/class-profiles.ts` — that is the whole point of the port
 * (operator ruling, items 81/83) — so a test exercising a band's plumbing
 * needs its OWN table, not the operator's.
 *
 * The values mirror `packages/factory/class-profiles.ts`'s real table so a
 * test written against "the docs class" or "the code class" reads the same
 * as it did before the move; they are a fixture copy for wiring tests, not a
 * second declaration the product depends on — `class-profiles.contract.test.ts`
 * (which stays in `packages/factory`) is the one place the real values are
 * pinned.
 */
import { readFileSync } from 'node:fs';
import { parseManifest, CHANGE_CLASSES } from '@forge/flows';
import type { ChangeClass, ClassProfilePort, GateProfile } from '../../class-profile-port.ts';

export const TEST_CLASS_PROFILES: Readonly<Record<ChangeClass, GateProfile>> = {
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

function isTestChangeClass(value: unknown): value is ChangeClass {
  return typeof value === 'string' && (CHANGE_CLASSES as readonly string[]).includes(value);
}

/** A working `ClassProfilePort` a test can bind wherever a station needs one. */
export function testClassProfilePort(): ClassProfilePort {
  return {
    profileFor: (cls) => TEST_CLASS_PROFILES[cls],
    readChangeClass: (manifestPath) => parseManifest(readFileSync(manifestPath, 'utf8')).class,
    isChangeClass: isTestChangeClass,
    hollowGateGuardFor: (iter0FailFirst, behaviorPreserving) => iter0FailFirst === 'required' && !behaviorPreserving,
  };
}
