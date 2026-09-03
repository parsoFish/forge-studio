/**
 * `resolveDispatchableAgent` — the boundary rejections, and the pins that keep
 * them honest.
 *
 * The refusal of an interactive agent is asserted BYTE-FOR-BYTE (the
 * TWIN-REFUSAL pin), because the message is the operator-facing contract and a
 * reworded refusal is a silent behaviour change. R4-21 phase 2 WI-2 holds the
 * real `creation-agent` on the refusing side. The NON-DISTURBANCE pin is the
 * positive control for both. The COMPLEMENT PIN then walks the REAL,
 * live-loaded roster and asserts the resolver accepts a def IFF the shared
 * interactivity predicate says it is not interactive — parity between two
 * things that must agree, which is what `contract/` means (tests/README.md).
 *
 * SPLIT FROM `agent-dispatch.test.ts` (863 lines) along its declared seams;
 * the rendering half is `unit/agent-dispatch-prompt`, the discovery half is
 * `integration/agent-dispatch-wiring`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { resolveDispatchableAgent } from '../../agent-dispatch.ts';
import { listAgentDefinitions, loadAgentDefinition } from '../../studio/agent-registry.ts';
import { agentCapabilityDescriptor, FORGE_ROOT } from '../../studio/derive.ts';
import type { AgentDefinition } from '@forge/contracts/studio/types.ts';

const ROOT = FORGE_ROOT;
const SKILLS = join(ROOT, 'skills');

/** Read one shipped agent definition off the REAL roster. Duplicated into each
 *  part of this split rather than exported from a `.test.ts` — the precedent
 *  this package already set in `regression/failure-classifier.rate-limit.test.ts`:
 *  a test file that exports a helper becomes an import target and starts
 *  constraining what it may assert. Five lines is the cheaper side of that. */
function getDef(slug: string): AgentDefinition {
  const def = listAgentDefinitions(SKILLS).find((d) => d.slug === slug);
  assert.ok(def, `expected the ${slug} library fixture in the roster`);
  return def;
}

// ---------------------------------------------------------------------------
// resolveDispatchableAgent — the boundary rejections
// ---------------------------------------------------------------------------

test('resolveDispatchableAgent: unknown slug throws with the roster listed', () => {
  const defs = listAgentDefinitions(SKILLS);
  assert.throws(
    () => resolveDispatchableAgent('no-such-agent', defs),
    /no runnable agent "no-such-agent"/,
  );
});

test('resolveDispatchableAgent: an interactive agent is refused (bespoke page, not generic host)', () => {
  // The roster is studio agents (runtime-bearing); none ship `surface:
  // interactive` today, so synthesize one from a real def to prove the guard
  // defends a future interactive studio agent.
  const interactive = { ...getDef('project-scoped-review'), slug: 'fake-interactive', surface: 'interactive' } as AgentDefinition;
  assert.throws(
    () => resolveDispatchableAgent('fake-interactive', [interactive]),
    /is interactive .*not the generic run host/,
  );
});

test('resolveDispatchableAgent: a non-interactive runnable agent resolves', () => {
  const defs = listAgentDefinitions(SKILLS);
  const def = resolveDispatchableAgent('project-scoped-review', defs);
  assert.equal(def.slug, 'project-scoped-review');
});

test('resolveDispatchableAgent: the R4-02 onboarding-agent is dispatchable (both entry points reach it)', () => {
  // Both F1 entry points — the agent page RunPanel and the /projects
  // OnboardWithAgent button — dispatch via the same client → the same route →
  // resolveDispatchableAgent. If the onboarding agent resolves here, both reach
  // the same runner.
  const def = resolveDispatchableAgent('onboarding-agent', listAgentDefinitions(SKILLS));
  assert.equal(def.slug, 'onboarding-agent');
  assert.notEqual(def.surface, 'interactive', 'onboarding agent must be non-interactive to dispatch');
});

// ---------------------------------------------------------------------------
// TWIN-REFUSAL PIN — resolveDispatchableAgent's existing interactive refusal
// must stay BYTE-FOR-BYTE unchanged. ADR-043 §4: "resolveDispatchableAgent
// (orchestrator/agent-dispatch.ts:81) is UNCHANGED... Softening that refusal
// is the single change that would break the boundary this whole design rests
// on." This is a regression lock, not a characterization test: it exists
// specifically so that if a later implementer reworks the refusal wording
// "to make the mirror easier," THIS test goes red — see the worker report
// for the mutation proof (perturbed text, confirmed-applied, red, reverted,
// confirmed-green).
// ---------------------------------------------------------------------------

test('TWIN-REFUSAL PIN: resolveDispatchableAgent refuses an interactive agent with the EXACT existing message, byte-for-byte', () => {
  // Kills: ANY edit to resolveDispatchableAgent's refusal wording, phrasing,
  // punctuation, or structure — including one made in the name of "cleaning
  // up" after ADR-043 §4's deleted mirror. The exact literal below is
  // NOT derived from the source file; it is hand-transcribed from
  // `orchestrator/agent-dispatch.ts:88-91` at pin-authoring time, so a
  // future edit to that literal breaks this test rather than silently
  // agreeing with it.
  const interactive = {
    ...getDef('project-scoped-review'),
    slug: 'fake-interactive-twin',
    surface: 'interactive',
  } as AgentDefinition;
  const expected =
    'dispatchAgentRun: agent "fake-interactive-twin" is interactive (surface: interactive) — ' +
    'interactive agents run through their bespoke session page, not the generic run host';
  let threw: unknown;
  try {
    resolveDispatchableAgent('fake-interactive-twin', [interactive]);
  } catch (err) {
    threw = err;
  }
  assert.ok(threw instanceof Error, 'expected resolveDispatchableAgent to throw for an interactive agent');
  assert.equal((threw as Error).message, expected);
});

// ---------------------------------------------------------------------------
// R4-21 phase 2, WI-2 (_wave5/unit-specs/R4-21-phase2.md) — the unit-spec's
// own literal bullet: "resolveDispatchableAgent('creation-agent', defs)
// STILL refuses (the twin-refusal boundary is not softened by this WI) — a
// pin test." The TWIN-REFUSAL PIN above already proves the GENERIC boundary
// with a SYNTHESIZED fixture (spread from project-scoped-review, `surface`
// overridden by the test) — it never touches creation-agent's own SKILL.md
// at all. This test closes that gap: it loads creation-agent's REAL,
// checked-in AgentDefinition (`skills/creation-agent/SKILL.md` — `surface:
// interactive`, `library: false`) directly via `loadAgentDefinition` (NOT
// `listAgentDefinitions`, which excludes `library: false` defs from its
// roster entirely — verified empirically: creation-agent is absent from
// `listAgentDefinitions(SKILLS)`'s 11-agent roster today), so a future edit
// to the REAL file (e.g. an implementer "wiring up authoring for the new
// spine" flips `surface:` away from `interactive`, thinking the generic
// dispatch host is now the right place for it) is what this test actually
// catches — the synthetic TWIN-REFUSAL PIN structurally cannot.
//
// This is a MUST-STAY-GREEN characterization pin, not a fresh RED (WI-2 does
// not touch resolveDispatchableAgent or creation-agent's SKILL.md) — proven
// by mutation per this WI's own T3 report (temporarily removed the
// interactivity check from resolveDispatchableAgent, confirmed this test
// fails, reverted, confirmed green again).
// ---------------------------------------------------------------------------

test('R4-21 phase 2, WI-2: resolveDispatchableAgent("creation-agent", defs) STILL refuses the REAL creation-agent def — the twin-refusal boundary is not softened by this WI', () => {
  const skillMdPath = join(SKILLS, 'creation-agent', 'SKILL.md');
  assert.ok(existsSync(skillMdPath), 'arrange: skills/creation-agent/SKILL.md must exist on this branch');
  const creationAgentDef = loadAgentDefinition(skillMdPath);
  // Fixture preconditions, asserted before reading any verdict.
  assert.equal(creationAgentDef.slug, 'creation-agent');
  assert.equal(creationAgentDef.surface, 'interactive', 'arrange: creation-agent must genuinely declare surface: interactive or this pin is vacuous');
  assert.equal(
    listAgentDefinitions(SKILLS).some((d) => d.slug === 'creation-agent'),
    false,
    'arrange: creation-agent (library: false) must NOT be in the listAgentDefinitions roster — this test loads it directly instead',
  );

  let threw: unknown;
  try {
    resolveDispatchableAgent('creation-agent', [creationAgentDef]);
  } catch (err) {
    threw = err;
  }
  assert.ok(threw instanceof Error, 'expected resolveDispatchableAgent to throw for the real creation-agent def');
  assert.match((threw as Error).message, /"creation-agent"/, 'must name the slug');
  assert.match((threw as Error).message, /is interactive/i, 'must state the interactive-boundary refusal, not the unknown-slug branch');
  assert.match((threw as Error).message, /not the generic run host/i);
});

test('NON-DISTURBANCE PIN: resolveDispatchableAgent still ACCEPTS a normal non-interactive agent unchanged (positive control for the twin-refusal pin above)', () => {
  // Kills: an implementation that makes resolveDispatchableAgent refuse
  // EVERYTHING (interactive and non-interactive alike) while "fixing" the
  // refusal message — that mutation would still pass the TWIN-REFUSAL PIN's
  // sibling test above for the interactive case, but this positive control
  // catches it on the non-interactive case. Without this test, the
  // TWIN-REFUSAL PIN alone could not distinguish "still discriminating
  // correctly" from "refuses everything now."
  const defs = listAgentDefinitions(SKILLS);
  const def = resolveDispatchableAgent('project-scoped-review', defs);
  assert.equal(def.slug, 'project-scoped-review');
  assert.notEqual(def.surface, 'interactive');
});

test('COMPLEMENT PIN: over the REAL, live-loaded roster, resolveDispatchableAgent accepts a def IFF the shared interactivity predicate says it is NOT interactive', () => {
  // R4-23 (bead forge-4y7) rewrote this pin. It used to drive the deleted
  // `resolveInteractiveAgent` mirror as the second half of the comparison;
  // with the mirror gone (it had zero production callers — see the ADR-043
  // amendment) the SAME property is asserted directly against the one shared
  // predicate both hosts were required to use, `agentCapabilityDescriptor(
  // def).interactive`. Nothing is weakened: the pin still kills an
  // implementation where the generic host accepts an interactive def, or
  // refuses a non-interactive one.
  //
  // Driven over the REAL roster (`listAgentDefinitions(SKILLS)`) rather than a
  // hand-built fixture, because a hand-built fixture cannot surface a defect
  // that only shows up on a specific real def's actual shape (an absent
  // `surface` field, or `surface: both`).
  //
  // UPDATED (W8-B5b): the roster is back to containing ZERO interactive defs,
  // and this time it is a retirement rather than an addition.
  //
  // W6-CR-3 had added exactly one: `community-refresh`, the only interactive
  // session-kind agent that declared `library: true` (every other one —
  // creation-agent / brain-maintenance / demo-builder / instructions-creator /
  // project-brain-builder — declares `library: false` and so never enters
  // `listAgentDefinitions`'s roster at all). W8-B5b retired that session kind:
  // its work is now done by a deterministic, LLM-free refresh
  // (`forge community refresh` / `POST /api/studio/community/refresh`) that is
  // not an agent and has no roster entry. With it gone, the roster's
  // interactive membership is empty again.
  //
  // WHAT THAT COSTS THIS TEST, STATED PLAINLY RATHER THAN GLOSSED. The per-def
  // loop below asserts `resolveDispatchableAgent` accepts a def IFF it is not
  // interactive. With no interactive def in the roster, the loop now only ever
  // exercises the ACCEPT arm — its refusal arm is VACUOUS over real data. The
  // trailing assertion is inverted to match (`!sawInteractive`), and a
  // precondition that used to guarantee the refusal arm ran no longer can.
  //
  // WHY THAT IS NOT A COVERAGE HOLE. The boundary itself — the one-shot generic
  // run host must refuse every interactive def — stays pinned by THREE
  // independent tests earlier in this same file, none of which depends on the
  // roster's contents:
  //   :160  'resolveDispatchableAgent: an interactive agent is refused'   (fake-interactive fixture)
  //   :199  'TWIN-REFUSAL PIN: ... the EXACT existing message, byte-for-byte' (fake-interactive-twin fixture)
  //   :250  'R4-21 phase 2, WI-2: ... STILL refuses the REAL creation-agent def' (a REAL interactive def)
  // The `:250` pin is the load-bearing one: `creation-agent` is genuinely
  // interactive and genuinely real, and is absent from the roster only because
  // it is `library: false`. So a real interactive def is still driven through
  // the refusal, by a test that cannot be emptied by a roster change.
  //
  // `resolveInteractiveAgent` is still NOT resurrected, exactly as before.
  const defs = listAgentDefinitions(SKILLS);
  assert.ok(defs.length > 0, 'precondition: the real roster must be non-empty for this test to mean anything');
  let sawInteractive = false;
  let sawNonInteractive = false;
  for (const def of defs) {
    const interactive = agentCapabilityDescriptor(def).interactive;
    if (interactive) sawInteractive = true;
    else sawNonInteractive = true;
    let dispatchableAccepted = false;
    try {
      resolveDispatchableAgent(def.slug, defs);
      dispatchableAccepted = true;
    } catch {
      dispatchableAccepted = false;
    }
    assert.equal(
      dispatchableAccepted,
      !interactive,
      `${def.slug}: resolveDispatchableAgent must accept exactly the non-interactive defs ` +
        `(interactive=${interactive}, accepted=${dispatchableAccepted})`,
    );
  }
  assert.ok(sawNonInteractive, 'precondition: the real roster must contain at least one non-interactive def for this pin to be non-vacuous');
  // W8-B5b: the roster contains NO interactive def (community-refresh, the
  // only one that ever did, was retired — see this test's header). This is a
  // MEASURED FACT about the roster's contents, not a boundary check, and it is
  // asserted rather than dropped for one reason: an interactive def entering
  // the roster is exactly the event that should force someone back to this
  // test's header, because it silently un-vacuums the refusal arm above and
  // changes what this file proves. Failing here is the intended signal, not an
  // obstacle — read the header, then update both this line and it together.
  assert.ok(!sawInteractive, 'measured fact: the real roster contains NO interactive def. If this fails, an interactive def has entered listAgentDefinitions — re-read this test\'s header before changing this line: it un-vacuums the per-def refusal arm above and deserves the same deliberate review community-refresh got, not a silent widening');
  assert.deepEqual(
    defs.filter((d) => agentCapabilityDescriptor(d).interactive).map((d) => d.slug),
    [],
    'the real roster\'s interactive-def membership must be EMPTY — the one member it ever had (community-refresh) ' +
      'retired with its session kind in W8-B5b, and the boundary that membership used to exercise is pinned ' +
      'independently by the fixture and real-creation-agent refusal tests earlier in this file',
  );
});
