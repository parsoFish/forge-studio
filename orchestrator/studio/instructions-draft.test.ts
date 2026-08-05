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
});
