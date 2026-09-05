/**
 * CONFORMANCE TEST for the class → gate-profile table (ADR 051 decision 2,
 * spec §5 item 1). It is not a behavioural test of any phase; it is the test
 * that keeps the table the ONE place a class's gates are decided.
 *
 * WHICH WRONG IMPLEMENTATION EACH TEST KILLS is named per test. A test that
 * would look identical had the implementation been wrong is characterization,
 * not acceptance.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { CHANGE_CLASSES, CLASS_PROFILES, isChangeClass, profileFor, type ChangeClass, type GateProfile } from './class-profiles.ts';
import { CHANGE_CLASSES as CHANGE_CLASSES_FROM_THE_VALIDATOR } from '@forge/flows/manifest.ts';

const FACTORY_DIR = import.meta.dirname;

/** Every production `.ts` file in packages/factory, recursively. */
function productionFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'test-fixtures' || entry === 'tests') continue;
      out.push(...productionFiles(full));
      continue;
    }
    if (!entry.endsWith('.ts') || entry.includes('.test.')) continue;
    out.push(full);
  }
  return out;
}

const COLUMNS: ReadonlyArray<keyof GateProfile> = [
  'iter0FailFirst',
  'requiredPathsSource',
  'mergeBoundaryTest',
  'mergeBoundaryVerb',
  'capture',
  'reviewLenses',
  'reflect',
  'singleWiAllowed',
];

/**
 * Columns whose consumer has not landed yet, with the spec §5 item that lands
 * it. This list may only SHRINK, and the test below fails BOTH ways: a column
 * here that has gained a consumer must be removed, and a column not here must
 * have one. That two-way assertion is what stops it becoming the stale
 * allowlist that reads as progress while it blinds the check (§15.41's shape).
 *
 * Empty by the end of M5-A. Nothing is added to this list without a ruling.
 */
const COLUMNS_AWAITING_A_CONSUMER: ReadonlyArray<keyof GateProfile> = [
  'iter0FailFirst',      // spec §5 item 4 — the integrate band's per-WI gate
  'requiredPathsSource', // spec §5 item 3 — the ralph runner's diff-inclusion list
  'mergeBoundaryTest',   // spec §5 item 4 — the class-selected merge gate
  'mergeBoundaryVerb',   // spec §5 item 6 — `forge gate docs`
  'reflect',             // spec §5 item 4 — the reflector's class rule
];

// `reviewLenses` came off with spec §5 item 5: `phases/adversarial-review.ts`
// reads it ONCE and threads the same array to the launch prompt and to
// `validateReviewFindings`, so a finding cannot be judged against a vocabulary
// the agent was never shown.
//
// `capture` came off with item 4, read by the integrate band
// (`phases/integrate.ts`) to choose between running the project's declared demo
// commands, recording the gate's own output, and recording the diff alone.
//
// `singleWiAllowed` came off this list first, and where it landed corrected the
// draft: it is enforced by the project manager's SET rules, not the plan gate,
// because at the plan gate there are no work items to count. FIVE columns left,
// and each names the spec item that lands it.

// Every column is on the list as this lands, and that is the honest state of a
// table whose consumers are spec §5 items 3 to 6: the DATA is ratified now
// (ruling 155) so the items that read it are written against a fixed shape
// rather than inventing one each. The list is the countdown, asserted in BOTH
// directions so it cannot quietly become a permanent exemption, and it is empty
// at this lane's close or the row is NOT MET with the columns named.

describe('class profiles — the table is total', () => {
  it('kills "a class exists with no profile": every ChangeClass has a profile, and the table has no extra keys', () => {
    assert.deepEqual([...Object.keys(CLASS_PROFILES)].sort(), [...CHANGE_CLASSES].sort());
  });

  it('kills "a profile is missing a column": every profile declares every column', () => {
    for (const cls of CHANGE_CLASSES) {
      const profile = CLASS_PROFILES[cls];
      for (const column of COLUMNS) {
        assert.ok(column in profile, `${cls} is missing the ${column} column`);
      }
      assert.deepEqual([...Object.keys(profile)].sort(), [...COLUMNS].sort(), `${cls} has columns the table does not declare`);
    }
  });

  it('kills "profileFor invents a default": it returns the table row itself, by identity', () => {
    for (const cls of CHANGE_CLASSES) {
      assert.equal(profileFor(cls), CLASS_PROFILES[cls]);
    }
  });

  it('kills "any string is a class": isChangeClass refuses what the table does not know', () => {
    for (const cls of CHANGE_CLASSES) assert.equal(isChangeClass(cls), true);
    for (const notAClass of ['Code', 'test', 'release', '', 'docs ', null, undefined, 7, {}]) {
      assert.equal(isChangeClass(notAClass), false, `${String(notAClass)} must not be a class`);
    }
  });
});

describe('class profiles — the table is keyed by the manifest field, not by a copy of it', () => {
  it('kills "a private list of the four names": the table iterates the SAME array the manifest validator checks against', () => {
    // Not a value comparison — an IDENTITY one. Two arrays with equal contents
    // are exactly what drift looks like on the day someone edits one of them.
    assert.equal(CHANGE_CLASSES, CHANGE_CLASSES_FROM_THE_VALIDATOR);
  });

  it('kills "the table knows a class the manifest does not": every key is assignable to the manifest field type', () => {
    // Compile-time in substance: if `ChangeClass` ever stops being
    // `InitiativeManifest['class']`, this file fails to typecheck before it
    // fails to run. The runtime assertion states the same thing for a reader.
    const keys: ChangeClass[] = Object.keys(CLASS_PROFILES) as ChangeClass[];
    assert.deepEqual([...keys].sort(), [...CHANGE_CLASSES].sort());
  });
});

describe('class profiles — no phase re-derives what the table decides', () => {
  it('kills "a phase branches on a class name": nothing in packages/factory compares against a class literal outside the table', () => {
    const offenders: string[] = [];
    for (const file of productionFiles(FACTORY_DIR)) {
      if (file.endsWith('class-profiles.ts')) continue;
      const source = readFileSync(file, 'utf8');
      // Only a comparison that is ABOUT a class counts. A bare `=== 'config'`
      // elsewhere in the package is not this defect, and a check that fired on
      // it would be abandoned rather than obeyed.
      const branchOnClass = new RegExp(
        String.raw`(?:\bclass\b|\bcls\b|\bchangeClass\b)[^\n]*(?:===|!==)\s*'(?:${CHANGE_CLASSES.join('|')})'`
        + String.raw`|\bcase\s*'(?:${CHANGE_CLASSES.join('|')})'`
        + String.raw`|\bswitch\s*\(\s*[^)\n]*(?:class|cls)\b`,
      );
      for (const [i, line] of source.split('\n').entries()) {
        if (branchOnClass.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      }
    }
    assert.deepEqual(offenders, [], 'a profile re-derived from a class name can drift from the table it claims to obey');
  });
});

describe('class profiles — every column is enforced somewhere', () => {
  it('kills "a column nobody reads": each column is read by production code, or is named as awaiting its consumer', () => {
    // ONLY files that actually import the table count. A bare `.capture` or
    // `.reflect` elsewhere in the package is some other object's property, and
    // a check that counted it would report a column enforced when nothing reads
    // the profile at all — the precise failure this test exists to catch.
    const sources = productionFiles(FACTORY_DIR)
      .filter((f) => !f.endsWith('class-profiles.ts'))
      .map((f) => readFileSync(f, 'utf8'))
      .filter((src) => src.includes("class-profiles.ts'"))
      .join('\n');

    const consumed: (keyof GateProfile)[] = [];
    const unconsumed: (keyof GateProfile)[] = [];
    for (const column of COLUMNS) (sources.includes(`.${column}`) ? consumed : unconsumed).push(column);

    // BOTH directions, so the list cannot rot into a blindfold.
    assert.deepEqual(
      unconsumed.filter((c) => !COLUMNS_AWAITING_A_CONSUMER.includes(c)),
      [],
      'a column read by nothing is a gate that is silently not enforced — add its consumer, or name it in COLUMNS_AWAITING_A_CONSUMER with the spec item that lands it',
    );
    assert.deepEqual(
      consumed.filter((c) => COLUMNS_AWAITING_A_CONSUMER.includes(c)),
      [],
      'this column now HAS a consumer — remove it from COLUMNS_AWAITING_A_CONSUMER so the check covers it',
    );
  });
});
