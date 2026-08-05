/**
 * Tests for orchestrator/studio/instructions-draft.ts (R2-09 D8/D9).
 *
 * NEW MODULE — does not exist yet. `composeInstructionsDraft(input)` is a
 * DETERMINISTIC composition of an instructions draft from the definition's
 * own fields (purpose, composition, brainAccess, interactivity) — never an
 * LLM call. Consumed by the (also new) POST
 * /api/studio/agents/:slug/instructions-draft route, which writes nothing to
 * disk (D9: the draft is never auto-saved).
 *
 * AMBIGUITY (see final report): T2's spec does not pin the exact `input`
 * shape beyond "the definition's own fields" — this file models `input` as
 * the subset of AgentDefinition fields the draft prose actually needs
 * (purpose, composition, brainAccess, interactivity), matching the fields the
 * route receives from the builder's unsaved state (D8). The `derivation`
 * shape (`{ sources: [{field, present}] }`) is likewise this test's best-
 * effort rendering of "the derivation names itself" — the implementer may
 * reasonably choose a different concrete shape as long as it satisfies the
 * same self-describing contract.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { composeInstructionsDraft } from './instructions-draft.ts';

// ---------------------------------------------------------------------------
// Fixture helper
// ---------------------------------------------------------------------------

function baseInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    purpose: 'Decompose an approved initiative into atomic, dependency-ordered work items.',
    composition: {
      skills: ['brain-query'],
      tools: [],
      mcps: [],
      guards: ['event-log', 'wi-contract'],
      hooks: [],
    },
    brainAccess: 'mandatory',
    interactivity: 'Fully autonomous; never blocks on the operator.',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// composeInstructionsDraft
// ---------------------------------------------------------------------------

describe('composeInstructionsDraft', () => {
  it('returns {draft, derivation}; draft is non-empty markdown', () => {
    const result = composeInstructionsDraft(baseInput());
    assert.equal(typeof result.draft, 'string');
    assert.ok(result.draft.trim().length > 0, 'draft must not be blank');
    assert.equal(typeof result.derivation, 'object');
    assert.notEqual(result.derivation, null);
  });

  it('embeds the real purpose, bound skills, guards, hooks, brainAccess and interactivity', () => {
    const input = baseInput({
      composition: {
        skills: ['brain-query', 'tdd-workflow'],
        tools: [],
        mcps: [],
        guards: ['event-log'],
        hooks: ['pre-commit-lint'],
      },
    });
    const { draft } = composeInstructionsDraft(input);
    assert.ok(draft.includes('Decompose an approved initiative into atomic, dependency-ordered work items.'), 'purpose must appear verbatim');
    assert.ok(draft.includes('brain-query'), 'a bound skill must appear');
    assert.ok(draft.includes('tdd-workflow'), 'a second bound skill must appear');
    assert.ok(draft.includes('event-log'), 'a bound guard must appear');
    assert.ok(draft.includes('pre-commit-lint'), 'a bound hook must appear');
    assert.ok(draft.includes('Fully autonomous; never blocks on the operator.'), 'interactivity must appear verbatim');
  });

  it('the derivation names itself: reports every field it read and whether it was present/empty', () => {
    const input = baseInput({
      composition: { skills: [], tools: [], mcps: [], guards: [], hooks: [] },
    });
    const { draft, derivation } = composeInstructionsDraft(input);
    const sources = (derivation as { sources?: Array<{ field: string; present: boolean }> }).sources;
    assert.ok(Array.isArray(sources), 'derivation.sources must be an array');
    const skillsSource = sources!.find((s) => s.field === 'composition.skills');
    assert.ok(skillsSource !== undefined, 'derivation must report on composition.skills specifically');
    assert.equal(skillsSource!.present, false, 'no skills composed ⇒ present:false');
    // The draft must not claim any skills when none were composed — a
    // fabricated skill list is exactly the "declared data enforced nowhere"
    // failure class this campaign exists to close.
    assert.ok(!/brain-query|tdd-workflow/.test(draft), 'no invented skill names may leak into the draft');
  });

  it('determinism: two calls with the same input produce byte-identical drafts and derivations', () => {
    const input = baseInput();
    const a = composeInstructionsDraft(input);
    const b = composeInstructionsDraft(input);
    assert.equal(a.draft, b.draft);
    assert.deepEqual(a.derivation, b.derivation);
  });

  it('never invents: an empty purpose yields an explicit "not declared" marker, not fabrication or silence', () => {
    const input = baseInput({ purpose: '' });
    const { draft } = composeInstructionsDraft(input);
    assert.match(
      draft,
      /not declared|not yet declared|no purpose declared/i,
      'an empty purpose must surface an explicit not-declared marker in the draft, never silence or a made-up purpose',
    );
  });

  it('brain policy is encoded honestly: brainAccess:none states the do-not-read-the-brain rule', () => {
    const { draft } = composeInstructionsDraft(baseInput({ brainAccess: 'none' }));
    assert.match(
      draft,
      /do(?:es)? not (?:read|query) the (?:forge )?brain/i,
      'brainAccess:none must state the ADR-010 do-not-read-the-brain rule, not merely omit brain talk',
    );
  });

  it('brain policy is encoded honestly: brainAccess:mandatory states brain-first', () => {
    const { draft } = composeInstructionsDraft(baseInput({ brainAccess: 'mandatory' }));
    assert.match(
      draft,
      /brain[- ]first|query the brain (?:first|before)/i,
      'brainAccess:mandatory must state the ADR-010 brain-first rule, not merely omit brain talk',
    );
  });

  // -------------------------------------------------------------------------
  // 2026-08-05 adversarial-review round 2, finding D/10: an INVALID
  // brainAccess value ('bogus-not-a-real-value', not one of
  // none|mandatory|advisory) currently makes the draft and the derivation
  // DISAGREE — the draft correctly falls through to "Brain access not
  // declared." (there is no ADR-010 policy for an unrecognised value), but
  // `derivation.sources` computes `present: brainAccessRaw.length > 0`,
  // which is true for ANY non-empty string including a bogus one. A caller
  // trusting `present` to mean "the draft says something real" is lied to.
  // -------------------------------------------------------------------------

  it('an INVALID brainAccess value: draft and derivation must AGREE, and the draft must never state a brain policy it cannot justify', () => {
    const input = baseInput({ brainAccess: 'bogus-not-a-real-value' });
    const { draft, derivation } = composeInstructionsDraft(input);
    const brainSource = derivation.sources.find((s) => s.field === 'brainAccess');
    assert.ok(brainSource !== undefined, 'derivation must report on brainAccess');

    const statesNotDeclared = /brain access not declared|brain policy not declared/i.test(draft);
    const statesAJustifiedPolicy =
      /do(?:es)? not (?:read|query) the (?:forge )?brain/i.test(draft) ||
      /brain[- ]first/i.test(draft) ||
      /may consult the brain/i.test(draft);

    assert.ok(
      !statesAJustifiedPolicy,
      'the draft must never state one of the three real ADR-010 policies (none/mandatory/advisory wording) for a value that is none of the three',
    );
    assert.ok(statesNotDeclared, 'an unrecognised brainAccess value has no valid policy to state — the draft must say so explicitly');
    assert.equal(
      brainSource!.present,
      false,
      'the derivation must AGREE with the draft: today it reports present:true for the same invalid value the draft calls "not declared"',
    );
  });

  // -------------------------------------------------------------------------
  // 2026-08-05 adversarial-review round 2, finding D/11: `readStringArray`
  // does not filter out empty/whitespace-only entries, so
  // `describeCompositionSection` renders each as a bare "- " bullet with no
  // content after it. If filtering the empties leaves the list empty, the
  // derivation's `present` flag (currently computed on the UNFILTERED length)
  // must also flip to false and the not-declared marker must apply — the
  // rendered draft and the derivation must describe the SAME reality.
  // -------------------------------------------------------------------------

  it('empty/whitespace-only composition entries never render as a bare bullet', () => {
    const input = baseInput({
      composition: { skills: ['', '   ', 'real-skill'], tools: [], mcps: [], guards: [], hooks: [] },
    });
    const { draft } = composeInstructionsDraft(input);
    assert.ok(
      !/^-\s*$/m.test(draft),
      'no bare bullet (a "- " line with nothing real after it) may be emitted for an empty/whitespace entry',
    );
    assert.ok(draft.includes('- real-skill'), 'a real entry in the same list must still render');
  });

  it('if filtering empties leaves composition.skills empty, derivation.present must be false and the not-declared marker must apply', () => {
    const input = baseInput({
      composition: { skills: ['', '   '], tools: [], mcps: [], guards: [], hooks: [] },
    });
    const { draft, derivation } = composeInstructionsDraft(input);
    const skillsSource = derivation.sources.find((s) => s.field === 'composition.skills');
    assert.equal(
      skillsSource?.present,
      false,
      'skills that are all empty/whitespace after filtering must not count as "present" — today\'s present check runs on the UNFILTERED array length',
    );
    assert.match(
      draft,
      /No skills declared\./i,
      'the not-declared marker for skills must apply once nothing real is left after filtering',
    );
  });
});
