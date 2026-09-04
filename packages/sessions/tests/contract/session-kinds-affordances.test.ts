import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadSessionKinds, VERDICT_VALUES, type SessionKindDescriptor } from '../../studio/session-kinds.ts';
import { validateSessionKinds } from '../../studio/session-kinds-validate.ts';
import { deriveSessionAffordances } from '../../studio/session-kinds-affordances.ts';

import { REPO_ROOT, baseDescriptor, byId } from './test-fixtures/session-kinds-core.ts';

// ===========================================================================
// W6-B3 — deriveSessionAffordances: the derivation table, one test per
// mapping (ADR-043 §1 "affordances are derived, not authored" + the
// 2026-08-15 amendment's worked mapping — see the function's own doc comment
// in session-kinds.ts for the full rule set this table exercises).
// ===========================================================================

describe('deriveSessionAffordances — derivation table (W6-B3)', () => {
  const PANEL_DESCRIPTOR: SessionKindDescriptor = {
    ...baseDescriptor(),
    panel: {
      phases: [
        { phase: 'interviewing', step: 'agent' },
        { phase: 'awaiting-answers', step: 'noop', awaits: 'questions', next: 'interviewing' },
        { phase: 'drafting', step: 'agent', writes: ['draft'], next: 'awaiting-verdict' },
        { phase: 'awaiting-verdict', step: 'noop', awaits: 'verdict' },
        { phase: 'finalizing', step: 'finalize', finalizer: 'writeToRepoRoot', next: 'committed' },
        { phase: 'committed', step: 'terminal' },
      ],
    },
  } as SessionKindDescriptor;

  const NO_TABLE_DESCRIPTOR: SessionKindDescriptor = { ...baseDescriptor() } as SessionKindDescriptor;

  it('a descriptor with NEITHER turnSpec NOR panel (architect\'s real shape) → [] for any phase — the honest "no derivable affordances" answer', () => {
    assert.deepEqual(deriveSessionAffordances(NO_TABLE_DESCRIPTOR, 'anything'), []);
  });

  it('an unknown/undeclared phase (not in the table at all) → [] — fail closed, never fabricate', () => {
    assert.deepEqual(deriveSessionAffordances(PANEL_DESCRIPTOR, 'not-a-real-phase'), []);
  });

  it('a terminal phase → [] (ADR: "terminal ⇒ none"), even though this fixture\'s "committed" row could otherwise be reached via no other field', () => {
    assert.deepEqual(deriveSessionAffordances(PANEL_DESCRIPTOR, 'committed'), []);
  });

  it('a `noop` phase with `awaits: "questions"` (here, named "awaiting-answers") → [question-form] — driven by the AUTHORED `awaits` field, not the phase name — also carries next-turn from its `next` field', () => {
    const result = deriveSessionAffordances(PANEL_DESCRIPTOR, 'awaiting-answers');
    assert.deepEqual(result, [
      { id: 'awaiting-answers-question-form', kind: 'question-form', phase: 'awaiting-answers' },
      { id: 'awaiting-answers-next-turn', kind: 'next-turn', phase: 'awaiting-answers', meta: { next: 'interviewing' } },
    ]);
  });

  it('W6-B3 post-merge review — the misclassification fix, direct proof: a `noop` phase named SOMETHING OTHER THAN "awaiting-answers" (e.g. "awaiting-input") still derives [question-form] when its `awaits` field says so — a bare phase-NAME match would have silently mis-derived this as `verdict`', () => {
    const differentlyNamedQuestionPhase: SessionKindDescriptor = {
      ...baseDescriptor(),
      panel: { phases: [{ phase: 'awaiting-input', step: 'noop', awaits: 'questions' }] },
    } as SessionKindDescriptor;
    assert.deepEqual(deriveSessionAffordances(differentlyNamedQuestionPhase, 'awaiting-input'), [
      { id: 'awaiting-input-question-form', kind: 'question-form', phase: 'awaiting-input' },
    ]);
  });

  it('W6-B3 post-merge review — the converse proof: a `noop` phase LITERALLY named "awaiting-answers" but with `awaits: "verdict"` derives [verdict], NOT [question-form] — proves derivation reads `awaits`, never the phase name (the old `row.phase === \'awaiting-answers\'` heuristic would have gotten this one right for the wrong reason)', () => {
    const namedLikeAQuestionButIsAVerdict: SessionKindDescriptor = {
      ...baseDescriptor(),
      panel: { phases: [{ phase: 'awaiting-answers', step: 'noop', awaits: 'verdict' }] },
    } as SessionKindDescriptor;
    assert.deepEqual(deriveSessionAffordances(namedLikeAQuestionButIsAVerdict, 'awaiting-answers'), [
      // verdicts defaults to ['approve','reject'] (the ADR default) — this
      // fixture row declares no `verdicts:` of its own.
      { id: 'awaiting-answers-verdict', kind: 'verdict', phase: 'awaiting-answers', meta: { verdicts: ['approve', 'reject'] } },
    ]);
  });

  it('any OTHER `noop` phase (e.g. "awaiting-verdict") → [verdict], never question-form', () => {
    const result = deriveSessionAffordances(PANEL_DESCRIPTOR, 'awaiting-verdict');
    // verdicts defaults to ['approve','reject'] — PANEL_DESCRIPTOR's
    // "awaiting-verdict" row declares no `verdicts:` of its own.
    assert.deepEqual(result, [{ id: 'awaiting-verdict-verdict', kind: 'verdict', phase: 'awaiting-verdict', meta: { verdicts: ['approve', 'reject'] } }]);
  });

  it('an `agent` step with `writes` AND `next` (e.g. "drafting") → [staged-review, next-turn], in that order', () => {
    const result = deriveSessionAffordances(PANEL_DESCRIPTOR, 'drafting');
    assert.deepEqual(result, [
      { id: 'drafting-staged-review', kind: 'staged-review', phase: 'drafting', meta: { writes: ['draft'] } },
      { id: 'drafting-next-turn', kind: 'next-turn', phase: 'drafting', meta: { next: 'awaiting-verdict' } },
    ]);
  });

  it('an `agent` step with NEITHER `writes` NOR `next` (e.g. "interviewing", a branching phase) → [] — nothing for the operator to do while the agent is actively working', () => {
    assert.deepEqual(deriveSessionAffordances(PANEL_DESCRIPTOR, 'interviewing'), []);
  });

  it('a `finalize` step with `next` but no `writes` (e.g. "finalizing") → [next-turn] only', () => {
    const result = deriveSessionAffordances(PANEL_DESCRIPTOR, 'finalizing');
    assert.deepEqual(result, [{ id: 'finalizing-next-turn', kind: 'next-turn', phase: 'finalizing', meta: { next: 'committed' } }]);
  });

  it('positive control: a REAL turnSpec descriptor (authoring, the ADR-043 §1 worked example) derives correctly through turnSpec.phases, not just panel.phases — "analyzing" → [staged-review, next-turn]', () => {
    const authoring: SessionKindDescriptor = {
      ...baseDescriptor(),
      turnSpec: {
        kindDir: '_authoring',
        style: 'agent',
        phases: [
          { phase: 'analyzing', step: 'agent', writes: ['staging'], next: 'awaiting-review' },
          { phase: 'awaiting-review', step: 'noop', awaits: 'verdict' },
          { phase: 'committing', step: 'finalize', finalizer: 'copyStagingToLibrary', next: 'committed' },
          { phase: 'committed', step: 'terminal' },
        ],
      },
    } as SessionKindDescriptor;

    assert.deepEqual(deriveSessionAffordances(authoring, 'analyzing'), [
      { id: 'analyzing-staged-review', kind: 'staged-review', phase: 'analyzing', meta: { writes: ['staging'] } },
      { id: 'analyzing-next-turn', kind: 'next-turn', phase: 'analyzing', meta: { next: 'awaiting-review' } },
    ]);
    // verdicts defaults to ['approve','reject'] — this LOCAL fixture's own
    // "awaiting-review" row declares no `verdicts:` (unlike the real,
    // checked-in authoring row, which declares `verdicts: [approve]` — see
    // wellFormedTurnSpec() above).
    assert.deepEqual(deriveSessionAffordances(authoring, 'awaiting-review'), [{ id: 'awaiting-review-verdict', kind: 'verdict', phase: 'awaiting-review', meta: { verdicts: ['approve', 'reject'] } }]);
    assert.deepEqual(deriveSessionAffordances(authoring, 'committed'), []);
  });

  it('the real repo — every panel-bearing kind EXCEPT onboarding derives at least one non-empty affordance set somewhere in its table, and every terminal phase in every REAL turnSpec/panel table derives []', () => {
    const descs = loadSessionKinds(REPO_ROOT);
    // onboarding is deliberately excluded from the non-empty assertion: its
    // real table is running(agent, no writes/next, branches to complete OR
    // failed) -> complete(terminal) -> failed(terminal) — EVERY row derives
    // [] (running has neither writes nor next; both others are terminal).
    // This is the HONEST correct answer for a fire-and-forget dispatch with
    // no operator-facing decision point (ADR-043 §Consequences: "onboarding
    // is explicitly out of scope... a different path") — not a gap this
    // table's design failed to fill. See the dedicated onboarding assertion
    // below instead.
    for (const id of ['demo', 'instructions', 'authoring', 'kb-cleanup']) {
      const d = byId(descs, id);
      const table = d.turnSpec?.phases ?? d.panel?.phases;
      assert.ok(table, `expected "${id}" to carry a turnSpec or panel table`);
      const nonEmpty = table!.some((p) => deriveSessionAffordances(d, p.phase).length > 0);
      assert.ok(nonEmpty, `expected at least one phase in "${id}"'s real table to derive a non-empty affordance set`);
      for (const p of table!.filter((p) => p.step === 'terminal')) {
        assert.deepEqual(deriveSessionAffordances(d, p.phase), [], `terminal phase "${p.phase}" of "${id}" must derive []`);
      }
    }

    const onboarding = byId(descs, 'onboarding');
    for (const p of onboarding.panel!.phases) {
      assert.deepEqual(deriveSessionAffordances(onboarding, p.phase), [], `onboarding phase "${p.phase}" must derive [] — the fire-and-forget table has no operator-facing decision point anywhere`);
    }

    const architect = byId(descs, 'architect');
    assert.deepEqual(deriveSessionAffordances(architect, architect.defaultStage), [], 'architect has neither table — must derive [] regardless of phase');
  });
});

// ===========================================================================
// W7-C2 (sessions-kinds-09/23, library-24, beads forge-4ei/forge-lzv) — the
// 'revise' verdict joins the frozen vocabulary, and every DRAFT kind's
// operator gate declares the full three-way branch its runner actually
// supports (instructions/demo always had a bespoke revise path; authoring/
// kb-cleanup gain the generic one — community-refresh also gained it under
// W6-CR-3, but that kind was retired in W8-B5b). authoring + kb-cleanup
// additionally gain a `rejected` terminal row — reusing the token
// `instructions` already ships, never a new vocab value.
// ===========================================================================

describe('W7-C2 — revise verdict vocabulary + real-yaml three-way gates', () => {
  it('C2-K1: VERDICT_VALUES contains exactly approve|reject|revise', () => {
    const ids = VERDICT_VALUES.map((v) => v.id).sort();
    assert.deepEqual(ids, ['approve', 'reject', 'revise']);
  });

  it('C2-K2: the REAL yaml declares [approve, revise, reject] on every draft kind\'s operator gate', () => {
    const descs = loadSessionKinds(REPO_ROOT);
    const gate = (kindId: string, phase: string): readonly string[] | undefined => {
      const d = descs.find((x) => x.id === kindId);
      assert.ok(d, `descriptor "${kindId}" must exist`);
      const rows = d!.turnSpec?.phases ?? d!.panel?.phases;
      assert.ok(rows, `descriptor "${kindId}" must carry a phase table`);
      return rows!.find((p) => p.phase === phase)?.verdicts;
    };
    assert.deepEqual(gate('instructions', 'awaiting-verdict'), ['approve', 'revise', 'reject']);
    assert.deepEqual(gate('demo', 'awaiting-review'), ['approve', 'revise', 'reject']);
    assert.deepEqual(gate('authoring', 'awaiting-review'), ['approve', 'revise', 'reject']);
    assert.deepEqual(gate('kb-cleanup', 'awaiting-approval'), ['approve', 'revise', 'reject']);
    // W6-CR-3 once asserted the same gate on 'community-refresh' here; that
    // kind was retired in W8-B5b, so the descriptor no longer exists.
  });

  it('C2-K3: authoring + kb-cleanup gain a `rejected` terminal row (reject now has somewhere honest to land)', () => {
    const descs = loadSessionKinds(REPO_ROOT);
    for (const kindId of ['authoring', 'kb-cleanup']) {
      const d = descs.find((x) => x.id === kindId);
      const row = d!.turnSpec!.phases.find((p) => p.phase === 'rejected');
      assert.ok(row, `${kindId} must declare a "rejected" phase row`);
      assert.equal(row!.step, 'terminal', `${kindId}'s rejected row must be terminal`);
    }
  });

  it('C2-K4: deriveSessionAffordances threads the three-way meta.verdicts onto the wire (authoring awaiting-review)', () => {
    const descs = loadSessionKinds(REPO_ROOT);
    const authoring = descs.find((x) => x.id === 'authoring')!;
    const affordances = deriveSessionAffordances(authoring, 'awaiting-review');
    const verdict = affordances.find((a) => a.kind === 'verdict');
    assert.ok(verdict, 'awaiting-review must derive a verdict affordance');
    assert.deepEqual(verdict!.meta?.verdicts, ['approve', 'revise', 'reject']);
    assert.deepEqual(verdict!.meta?.requires, ['id'], 'requires stays declared (approve-scoped enforcement is the write route\'s job)');
  });

  it('C2-K5: validateSessionKinds(REPO_ROOT) stays at zero error-level findings with the revise rows in place', () => {
    const findings = validateSessionKinds(REPO_ROOT).filter((f) => f.level === 'error');
    assert.deepEqual(findings, [], `expected zero errors, got: ${JSON.stringify(findings, null, 2)}`);
  });

  // W7-C2 T1 review — the generic revise handler derives the phase to send a
  // session back to with `phases.find((p) => p.step === 'agent' && p.next ===
  // affordance.phase)`. `find` takes the FIRST match, and nothing (lint or
  // test) enforced that there IS only one: a second agent-step row landing on
  // the same verdict phase would silently pick whichever the yaml happened to
  // list first — the revise would re-run the wrong turn, with no signal at
  // all. Pinned against the SHIPPED yaml, for every revise-declaring row.
  // W8-B5b: the covered count drops 5 -> 4 with the retirement of the
  // `community-refresh` session kind, which was one of the five
  // revise-declaring rows. The count assertion is KEPT rather than relaxed to
  // `> 0`: its whole job is to fail when a revise-declaring kind stops being
  // reached by this loop, and a floor of zero would pass on an empty yaml.
  it('C2-K6: every revise-declaring verdict row in the REAL yaml has EXACTLY ONE agent-step producer landing on it', () => {
    const descs = loadSessionKinds(REPO_ROOT);
    let checked = 0;
    for (const d of descs) {
      const rows = d.turnSpec?.phases ?? d.panel?.phases ?? [];
      for (const row of rows) {
        if (!(row.verdicts ?? []).includes('revise')) continue;
        const producers = rows.filter((p) => p.step === 'agent' && p.next === row.phase);
        assert.equal(
          producers.length,
          1,
          `session kind "${d.id}" phase "${row.phase}" declares a "revise" verdict but has ${producers.length} agent-step producer rows landing on it (${producers.map((p) => p.phase).join(', ') || 'none'}) — the revise handler's phases.find() would pick the first silently`,
        );
        checked += 1;
      }
    }
    assert.equal(checked, 4, `all four revise-declaring kinds must be covered, checked ${checked} (was five until W8-B5b retired community-refresh)`);
  });
});
