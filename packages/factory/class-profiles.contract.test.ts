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

import { CHANGE_CLASSES, CLASS_PROFILES, isChangeClass, profileFor, readChangeClass, type ChangeClass, type GateProfile } from './class-profiles.ts';
import { gateRequiredPaths, type RequiredPathsSource, type WorkItem } from '@forge/flows/work-item.ts';
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
  'singleWiAllowed',
];

/**
 * Columns whose consumer has not landed yet. **EMPTY, and it closed by the
 * countdown's own rule: a column is wired or it is deleted, never carried.**
 * The test below still fails BOTH ways, so the list cannot come back as a
 * blindfold — a column named here that has a consumer fails, and a column not
 * named here that has none fails too (§15.41's shape).
 *
 * Nothing is added to this list without a ruling.
 */
const COLUMNS_AWAITING_A_CONSUMER: ReadonlyArray<keyof GateProfile> = [];

// `reviewLenses` came off with spec §5 item 5: `phases/adversarial-review.ts`
// reads it ONCE and threads the same array to the launch prompt and to
// `validateReviewFindings`, so a finding cannot be judged against a vocabulary
// the agent was never shown.
//
// `requiredPathsSource` came off with item 9: `phases/developer-loop.ts` reads
// it ONCE per run and hands it to `gateRequiredPaths`, so the paths the
// gate-tightening layer demands in the branch diff are the class's, not a
// constant. Landing it CUT two of the column's drafted values — see the union
// in `@forge/flows/work-item.ts` for why neither could be given an honest
// consumer.
//
// `capture` came off with item 4, read by the integrate band
// (`phases/integrate.ts`) to choose between running the project's declared demo
// commands, recording the gate's own output, and recording the diff alone.
//
// `singleWiAllowed` came off this list first, and where it landed corrected the
// draft: it is enforced by the project manager's SET rules, not the plan gate,
// because at the plan gate there are no work items to count.
//
// THE LAST FOUR, and how the countdown actually closed:
//
// `iter0FailFirst` — `phases/developer-loop.ts` reads it beside
// `requiredPathsSource` and hands it to the ralph runner's hollow-gate guard.
// Landing it NARROWED the union to `'required' | 'off'`: `'advisory'` ("run the
// iteration-0 check, record it, do not fail the work item") has no mapping onto
// the runner's boolean, and inventing one would have meant editing
// `packages/agents` at exactly its cap. The `infra` row now reads `'required'`,
// the safe direction. Narrowed under T1 ruling 292, RATIFIED in window 8 (300).
//
// `mergeBoundaryTest` + `mergeBoundaryVerb` — read together by
// `phases/executor-deps.ts`, which passes the class's SELECTION down into
// `runMergeBoundaryGate` (the value goes down, never the table: `@forge/flows`
// may not import this package) and then runs the class's verb. The union
// narrowed to `'ci' | 'local'` for the same reason as above: no gate implements
// `'acceptance'`, and no operator row selected it.
//
// `reflect` — DELETED. It asked "does the reflector run?", and `'optional'`
// named no chooser: nothing in the product decides per run whether an optional
// reflection happens, so every honest wiring either made it behave exactly like
// `'always'` (the decorative shape this file exists to catch) or changed the
// column's meaning to something its own doc comment contradicted. The reflector
// keeps firing from the develop flow's `on: merged` trigger for every class.
// Deleted under T1 ruling 292; if per-class reflection control is wanted, M6
// defines the chooser and the column returns with a meaning.

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

describe('class profiles — every class has a merge boundary', () => {
  it('kills "a class with no merge boundary at all": every class selects a test gate, a verb, or both', () => {
    // `docs` selects NO `testProcess.*` — a markdown initiative has no suite to
    // run — and that is only safe because it carries `mergeBoundaryVerb: 'gate
    // docs'`. A class with neither would reach the merge with nothing having
    // checked it, and the emptiness would look exactly like a green gate.
    for (const cls of CHANGE_CLASSES) {
      const p = CLASS_PROFILES[cls];
      assert.ok(
        p.mergeBoundaryTest.length > 0 || p.mergeBoundaryVerb !== null,
        `${cls} declares neither a merge-boundary test nor a verb — its merge boundary checks nothing`,
      );
    }
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

describe('class profiles — the required-paths source is the table\'s, and it is total', () => {
  it('kills "the source column is decorative": every class\'s declared value is one the real function acts on, and the two act differently', () => {
    // A WI that both CREATES a file and declares a wider scope — the only shape
    // where the two sources disagree, and therefore the only one that can tell
    // a wired column from an ignored one.
    const wi = {
      work_item_id: 'WI-1',
      initiative_id: 'INIT-x',
      title: 't',
      files_in_scope: ['docs/a.md', 'docs/b.md'],
      creates: ['docs/c.md'],
      acceptance_criteria: [],
      depends_on: [],
      quality_gate_cmd: ['true'],
    } as unknown as WorkItem;

    assert.deepEqual([...gateRequiredPaths(wi, 'wi.creates')], ['docs/c.md']);
    assert.deepEqual([...gateRequiredPaths(wi, 'files-in-scope')], ['docs/a.md', 'docs/b.md']);

    for (const cls of CHANGE_CLASSES) {
      const source = profileFor(cls).requiredPathsSource;
      const paths = gateRequiredPaths(wi, source);
      assert.ok(paths.length > 0, `${cls}: a class must never resolve to an EMPTY required-paths list — that is the 2026-07-11 vacuous-gate defect`);
      assert.deepEqual(
        [...paths],
        source === 'files-in-scope' ? ['docs/a.md', 'docs/b.md'] : ['docs/c.md'],
        `${cls}: the paths must be the ones its declared source names`,
      );
    }
  });

  it('kills "a class could ask for no required paths at all": the union offers no such value', () => {
    // Structural, not a value check: `'none'` and `'manifest.creates'` were cut
    // from the drafted union, so a table row asking for either is a compile
    // error rather than a silently disabled diff-touch check.
    const legal: RequiredPathsSource[] = ['wi.creates', 'files-in-scope'];
    for (const cls of CHANGE_CLASSES) {
      assert.ok(legal.includes(profileFor(cls).requiredPathsSource), `${cls} declares a source outside the union`);
    }
  });

  it('kills "a docs work item passes by creating a page it never had to edit": the docs row demands the files it DECLARED', () => {
    // Operator ruling 300 (window 8), adopting T1's B4. Under `'wi.creates'` a
    // docs work item that declares two pages to revise and creates one new page
    // satisfied its gate the moment the new page appeared: the priority chain
    // returns `creates` and never looks at `files_in_scope`, so the revision the
    // initiative was FOR was never required to be in the branch diff. Docs work
    // is editing named files; the class that edits declares its scope and must
    // touch it.
    const docsWi = {
      work_item_id: 'WI-1',
      initiative_id: 'INIT-x',
      title: 'revise the two pages the gap registry names',
      files_in_scope: ['docs/registry.md', 'docs/gaps.md'],
      creates: ['docs/new-index.md'],
      acceptance_criteria: [],
      depends_on: [],
      quality_gate_cmd: ['true'],
    } as unknown as WorkItem;

    const required = gateRequiredPaths(docsWi, profileFor('docs').requiredPathsSource);
    assert.deepEqual([...required], ['docs/registry.md', 'docs/gaps.md']);
    assert.ok(
      !required.includes('docs/new-index.md'),
      'the created page is not the requirement — a docs WI that only creates has not done the editing it declared',
    );
    // The value itself, pinned: reverting the row to the priority chain is a red
    // here and not a silent policy change one character wide.
    assert.equal(profileFor('docs').requiredPathsSource, 'files-in-scope');
  });

  it('kills "the dev-loop reads the manifest itself": readChangeClass is the one reader, and it refuses an unreadable manifest', () => {
    assert.throws(() => readChangeClass(join(FACTORY_DIR, 'no-such-manifest.md')), /ENOENT|no such file/i);
  });
});
