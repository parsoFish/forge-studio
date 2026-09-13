/**
 * `forge-a62b` — the PM skill must not tell the agent to author a work item the
 * validator will quarantine.
 *
 * MEASURED, S10 run 15 ($35 enforced, `e1b72897`), cycle
 * `2026-09-12T07-28-42_INIT-2026-09-12-exclude-author-flag`, last event
 * `event_type=error`:
 *
 *   project-manager phase failed: set errors: WI-3: creates is required (ADR 037)
 *   unless verification_artifact is set — pure-modification WIs must declare
 *   verification_artifact as the creates: escape
 *
 * ADR 037 behaved as designed. The PM did what its SKILL told it to do. At base
 * `879c96b7` that file said, in two separate places:
 *
 *   ":158  **`creates:` is OPTIONAL — omit unless needed.**"
 *   ":168  `non_goals`, `verification_artifact`, `creates` are **optional** — omit if undefined."
 *
 * Each sentence is true about its own field and the PAIR is the constraint:
 * `validateCompiledWorkItemSet` rejects a WI carrying NEITHER. So a PM following
 * the skill literally — omit what is undefined — authors the one shape that
 * quarantines the whole set. The skill was not missing a rule; it stated the
 * opposite of one, field by field, in sentences that were individually correct.
 *
 * The fix is the authoring rule (T1 864: the fix surface is the skill, not the
 * validator). These doors keep the two from drifting apart again: one reads the
 * SKILL text, the other proves what the validator does to the shape the old text
 * described, so a reader of either half can see why the other says what it says.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateCompiledWorkItemSet } from '@forge/flows/phases/wi-spec-compile.ts';
import type { WorkItem } from '@forge/flows/work-item.ts';

const REPO = join(import.meta.dirname, '..', '..', '..', '..');
const SKILL = join(REPO, 'skills', 'project-manager', 'SKILL.md');

/** A WI carrying neither `creates` nor `verification_artifact` — the shape the
 *  old skill text described as correct. Only the fields the rule reads. */
function wiWithNeither(): WorkItem {
  return { work_item_id: 'WI-3', files_in_scope: ['src/existing.ts'] } as unknown as WorkItem;
}

describe('forge-a62b: the PM skill and ADR 037 state ONE rule', () => {
  test('the validator quarantines a WI with neither field — the consequence the skill must prevent', () => {
    const errors = validateCompiledWorkItemSet([wiWithNeither()]);
    assert.equal(errors.length, 1, `expected exactly one error, got: ${JSON.stringify(errors)}`);
    assert.match(errors[0]!, /WI-3: creates is required \(ADR 037\)/);
    assert.match(errors[0]!, /unless verification_artifact is set/);
  });

  test('setting EITHER field satisfies it — the rule is a joint one, not two independent ones', () => {
    const withCreates = { ...wiWithNeither(), creates: ['src/new.ts'] } as unknown as WorkItem;
    const withArtifact = { ...wiWithNeither(), verification_artifact: 'src/existing.ts' } as unknown as WorkItem;
    assert.deepEqual(validateCompiledWorkItemSet([withCreates]), [], 'creates alone is enough');
    assert.deepEqual(validateCompiledWorkItemSet([withArtifact]), [], 'verification_artifact alone is enough');
  });

  test('the SKILL states the joint rule, naming the pure-modification case', () => {
    const md = readFileSync(SKILL, 'utf8');
    assert.match(
      md,
      /at least one of `creates:` or `verification_artifact:`/,
      'the skill must state the pair as ONE constraint — the PM omitted both because the skill described them as two independent optional fields',
    );
    assert.match(
      md,
      /pure-modification/,
      'the skill must name the case that fails: a WI that creates nothing new',
    );
  });

  test('the SKILL does NOT describe the pair as independently optional', () => {
    const md = readFileSync(SKILL, 'utf8');
    assert.doesNotMatch(
      md,
      /`creates:` is \*\*OPTIONAL — omit unless needed\.\*\*/,
      'this exact sentence (SKILL.md:158 at 879c96b7) is what authored the quarantined WI-3',
    );
    assert.doesNotMatch(
      md,
      /`non_goals`, `verification_artifact`, `creates` are \*\*optional\*\*/,
      'this list (SKILL.md:168 at 879c96b7) puts verification_artifact and creates in the same optional bucket, which is the pair the validator rejects',
    );
  });

  test('every worked WI example in the SKILL satisfies the rule the SKILL states', () => {
    // THE EXAMPLE TEACHES HARDER THAN THE PROSE. At `879c96b7` the skill's only
    // worked example — `### Work-item file`, and it is `WI-3`, the same id that
    // quarantined run 15's set — carried `files_in_scope` with two paths, no
    // `creates:` and no `verification_artifact:`: exactly the shape the
    // validator rejects. The prose above it said both fields were optional, so
    // the example was CONSISTENT with the prose and both were wrong together.
    // An agent copies a worked example more reliably than it follows a rule, so
    // a compliant rule beside a non-compliant exemplar is the weaker half of
    // this fix. This door holds every future example to the same rule.
    const md = readFileSync(SKILL, 'utf8');
    const blocks = [...md.matchAll(/```yaml\n([\s\S]*?)```/g)].map((m) => m[1]!);
    const wiBlocks = blocks.filter((b) => /^work_item_id:/m.test(b));
    assert.ok(wiBlocks.length > 0, 'the skill must carry at least one worked WI example');
    for (const b of wiBlocks) {
      const id = /^work_item_id:\s*(\S+)/m.exec(b)?.[1] ?? '(unnamed)';
      const hasCreates = /^creates:/m.test(b);
      const hasArtifact = /^verification_artifact:/m.test(b);
      assert.ok(
        hasCreates || hasArtifact,
        `the worked example ${id} declares neither creates: nor verification_artifact: — it models the exact shape ` +
          'validateCompiledWorkItemSet quarantines, and an agent copies the example before it reads the rule',
      );
    }
  });

  test('the SKILL states the membership rule a verification_artifact must satisfy', () => {
    const md = readFileSync(SKILL, 'utf8');
    // NOT /verification_artifact[^\n]*files_in_scope/ — the rule is ONE long
    // markdown line, so `[^\n]*` spans the whole bullet and matches
    // `verification_artifact` in an early clause against `files_in_scope` in an
    // unrelated later one. That version survived its own mutation: dropping the
    // membership sentence red-ed nothing. Anchor on the VALIDATOR's own message
    // instead (work-item.ts:409), which occurs once and is the thing the skill
    // must be quoting.
    assert.ok(
      md.includes('verification_artifact <path> must appear in files_in_scope'),
      'work-item.ts:408 rejects a verification_artifact absent from files_in_scope — a PM that takes the escape and lands on that error has been sent from one quarantine to another',
    );
  });
});
