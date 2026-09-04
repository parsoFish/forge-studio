import { wellFormedTurnSpec, turnSpecDescriptor } from './test-fixtures/session-kinds-turnspec.ts';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SESSION_ARTIFACT_KINDS, sessionArtifactKindState, loadSessionKinds, FINALIZER_IDS, type SessionKindDescriptor } from '../../studio/session-kinds.ts';
import { validateSessionKinds } from '../../studio/session-kinds-validate.ts';
import { deriveSessionAffordances } from '../../studio/session-kinds-affordances.ts';
import { AGENT_RUNNERS } from '@forge/agents/agent-run.ts';
import type { Finding } from '@forge/kernel';

import { type FixtureDescriptor, REPO_ROOT, baseDescriptor, byId, makeForgeRoot, writeAgentSkill, writeSessionKindsYaml } from './test-fixtures/session-kinds-core.ts';

// ===========================================================================
// R4-19-F2 — the "kb-cleanup" session kind (ADR-043 §1/§2/§3, brain-
// maintenance / cleanup-plan). RED at branch base: `studio/session-kinds.yaml`
// carries no "kb-cleanup" row yet, and `SESSION_ARTIFACT_KINDS` carries no
// "cleanup-plan" row yet. This block pins the DESCRIPTOR/REGISTRY half of the
// feature only — the renderer lives in session-transcript.test.ts, the turn
// spine in interactive-runner.test.ts, the routes in
// apps/forge/ui-bridge-kb-cleanup.test.ts, and dry-bridge coverage in
// apps/forge/dry-bridge-coverage.test.ts.
// ===========================================================================

describe('R4-19-F2 — the "kb-cleanup" session kind (brain-maintenance, cleanup-plan)', () => {
  // The exact ADR-043-shaped turnSpec table the task brief specifies
  // verbatim. Binding note (deliberate, the approval gate this whole feature
  // hinges on): "awaiting-approval" carries NO `next` — re-running the turn
  // while a session sits there must never advance it.
  const KB_CLEANUP_TURNSPEC = {
    kindDir: '_kb-cleanup',
    style: 'agent',
    phases: [
      { phase: 'drafting', step: 'agent', writes: ['plan'], next: 'awaiting-approval' },
      // verdicts (W7-C2, superseding W6-B6's approve-only ruling): the full
      // three-way branch — revise (feedback -> re-draft) + reject (-> the
      // terminal `rejected` row below), per sessions-kinds-23.
      { phase: 'awaiting-approval', step: 'noop', awaits: 'verdict', verdicts: ['approve', 'revise', 'reject'] },
      // W6-B4 adversarial-review fix: the atomic-claim marker
      // `approveKbCleanup` writes synchronously before its one await —
      // see session-kinds.yaml's own comment on this row.
      { phase: 'applying', step: 'terminal' },
      { phase: 'applied', step: 'terminal' },
      // W7-C2 — reject's terminal landing row.
      { phase: 'rejected', step: 'terminal' },
    ],
  };

  // Kills: a "kb-cleanup" row that never lands in the real
  // studio/session-kinds.yaml at all (RED today — this is the primary red);
  // a row whose turnSpec drifts from the ADR-043-shaped table (e.g. a `next`
  // added to awaiting-approval, which would silently defeat the approval
  // gate item #11 below pins); a wrong kindDir/agent/artifact.
  it('R4-19-F2 AT-1: loadSessionKinds(REPO_ROOT) returns a "kb-cleanup" descriptor with the exact agent/title/legacyRoutes/stages/defaultStage/artifact/turnSpec', () => {
    const descs = loadSessionKinds(REPO_ROOT);
    const kbCleanup = descs.find((d) => d.id === 'kb-cleanup');
    assert.ok(
      kbCleanup,
      'expected a "kb-cleanup" row in the real studio/session-kinds.yaml — not present yet (this IS the RED this test pins)',
    );
    assert.equal(kbCleanup!.agent, 'brain-maintenance');
    assert.equal(kbCleanup!.title, 'KB cleanup session');
    assert.deepEqual(kbCleanup!.legacyRoutes, []);
    assert.deepEqual(kbCleanup!.stages, ['brain']);
    assert.equal(kbCleanup!.defaultStage, 'brain');
    assert.deepEqual(kbCleanup!.artifact, { kind: 'cleanup-plan', label: 'Cleanup plan' });
    assert.deepEqual(
      kbCleanup!.turnSpec,
      KB_CLEANUP_TURNSPEC,
      `kb-cleanup's turnSpec must deep-equal the ADR-043-shaped table exactly — in particular "awaiting-approval" must declare NO "next" key at all (that absence IS the approval gate); got: ${JSON.stringify(kbCleanup!.turnSpec)}`,
    );
  });

  // Kills: a "kb-cleanup" row whose `agent:` does not resolve to a
  // runtime-bearing SKILL.md (a typo, or brain-maintenance shipped without a
  // `runtime:` block) — validateSessionKinds' unknown-agent check is the one
  // place that would catch it. The positive control (asserting the
  // descriptor genuinely exists) matters here: filtering findings down to
  // `session-kind:kb-cleanup` would trivially yield `[]` if the row is
  // simply ABSENT, which would make a bare "findings must be empty"
  // assertion pass for the wrong reason.
  it('R4-19-F2 AT-2: validateSessionKinds(REPO_ROOT) reports ZERO findings scoped to session-kind:kb-cleanup, and the descriptor genuinely exists (non-vacuous)', () => {
    const descs = loadSessionKinds(REPO_ROOT);
    assert.ok(
      descs.some((d) => d.id === 'kb-cleanup'),
      'positive control: the "kb-cleanup" descriptor must actually exist, or a zero-findings result below is vacuous (an absent row trivially has zero findings scoped to it)',
    );
    const findings = validateSessionKinds(REPO_ROOT).filter((f) => f.object === 'session-kind:kb-cleanup');
    assert.deepEqual(findings, [], `expected zero findings for session-kind:kb-cleanup, got: ${JSON.stringify(findings)}`);
  });

  // Kills: shipping the 'cleanup-plan' artifact renderer without promoting
  // its row in SESSION_ARTIFACT_KINDS (leaving kb-cleanup a permanent
  // reserved-artifact-kind lint error, mirroring every prior reserved->live
  // flip's own pin above); a row added as a plain mutable object instead of
  // individually Object.freeze()'d (defeating the registry's whole
  // deep-freeze discipline, per this file's own header note on
  // SESSION_ARTIFACT_KINDS).
  it('R4-19-F2 AT-3: SESSION_ARTIFACT_KINDS gains a frozen {id:"cleanup-plan", status:"live"} row, and sessionArtifactKindState("cleanup-plan") === "live" — a mutation attempt on the row must never take effect', () => {
    const row = SESSION_ARTIFACT_KINDS.find((k) => k.id === 'cleanup-plan');
    assert.ok(row, 'expected a "cleanup-plan" row in SESSION_ARTIFACT_KINDS — not present yet (this IS the RED this test pins)');
    assert.equal(row!.status, 'live', 'cleanup-plan must ship live (a real renderer) — never reserved');
    assert.ok(
      Object.isFrozen(row),
      'each row must be individually frozen — SESSION_ARTIFACT_KINDS.push(Object.freeze({...})) is not enough; the file header is explicit that Object.freeze is SHALLOW on the outer array alone',
    );
    assert.equal(sessionArtifactKindState('cleanup-plan'), 'live');
    assert.ok(Object.isFrozen(SESSION_ARTIFACT_KINDS), 'the outer array must stay frozen');
    // A mutation attempt on a genuinely-frozen row either throws (strict
    // mode) or silently no-ops — either way the total lookup function's
    // answer must be unaffected, proving the freeze is real, not merely
    // present in name.
    try {
      (row as { status: string }).status = 'HACKED';
    } catch {
      /* a strict-mode TypeError is an equally valid proof of the freeze */
    }
    assert.equal(sessionArtifactKindState('cleanup-plan'), 'live', 'a row mutation attempt must never actually change what the total lookup function reports');
  });
});

// ===========================================================================
// R4-19-F2 — THE CONSTRAINT TEST. ADR-043's entire reason for existing: a new
// interactive session kind is authored as turnSpec DATA riding the EXISTING
// generic `runInteractiveTurn` spine — NEVER a new orchestrator runner, NEVER
// a new `AGENT_RUNNERS` entry, NEVER a new `FINALIZER_IDS` row (kb-cleanup's
// phase table — drafting(agent) -> awaiting-approval(noop) -> applied
// (terminal) — has no `finalize` step at all, so it needs no finalizer).
// Asserted against the REAL source files, not a fixture or a hand-built
// registry snapshot — this is the test that kills a "just add a fifth
// runner" implementation, the exact per-kind re-invention ADR-043 dissolves.
//
// Both checks below are ALREADY TRUE today (GREEN, not RED) — they are
// regression ratchets pinning an invariant a correct kb-cleanup
// implementation must never violate, not a not-yet-built capability like
// AT-1..AT-3 above.
// ===========================================================================

describe('R4-19-F2 — the constraint: no new orchestrator runner for kb-cleanup', () => {
  it('AGENT_RUNNERS (packages/agents/agent-run.ts) gains NO "kb-cleanup" key — the session rides the existing turnSpec dispatch fork in cmdAgentRun, not a new bespoke runner', () => {
    assert.ok(
      !Object.prototype.hasOwnProperty.call(AGENT_RUNNERS, 'kb-cleanup'),
      `AGENT_RUNNERS must not gain a "kb-cleanup" entry — got keys: ${Object.keys(AGENT_RUNNERS).join(', ')}. A turnSpec-bearing descriptor is dispatched by cmdAgentRun's ADR-043 §3 fork BEFORE AGENT_RUNNERS is ever consulted (packages/agents/agent-run.ts); adding a key here re-opens the exact per-runner cap park ADR-043 dissolved.`,
    );
    // Belt-and-suspenders grep on the real source TEXT (not just the
    // imported object's own keys) — catches a "kb-cleanup" entry added under
    // a shape the plain object-key check above might not observe (e.g. a
    // computed-key assignment appended after the object literal).
    const src = readFileSync(join(REPO_ROOT, 'packages', 'agents', 'agent-run.ts'), 'utf8');
    assert.doesNotMatch(
      src,
      /['"]kb-cleanup['"]\s*:/,
      'the real packages/agents/agent-run.ts source text must not declare a "kb-cleanup" key anywhere',
    );
  });

  it('FINALIZER_IDS (packages/sessions/studio/session-kinds.ts) gains no new row FOR kb-cleanup specifically — its phase table declares no `finalize` step, so a correct implementation needs no finalizer for it (updated W6-B3: FINALIZER_IDS DOES grow, for a DIFFERENT reason — the new panel.phases finalize steps on demo/instructions need named finalizer identities; W6-CR-3 briefly grew it a third time for community-refresh\'s real dispatchable turnSpec finalizer, commitRegistryDraft — retired in W8-B5b along with the kind; this assertion is scoped to "not because of kb-cleanup", not "never grows at all")', () => {
    assert.deepEqual(
      FINALIZER_IDS.map((f) => f.id),
      ['copyStagingToLibrary', 'writeToRepoRoot', 'recordLockedDemo'],
      `FINALIZER_IDS must be exactly these three rows — copyStagingToLibrary (authoring's real turnSpec finalizer, pre-existing), writeToRepoRoot/recordLockedDemo (W6-B3's panel.phases-only finalizer identities for instructions/demo) — kb-cleanup's own turnSpec (drafting -> awaiting-approval -> applied) still declares no "finalize" step anywhere, so it still contributes none of these three. commitRegistryDraft (community-refresh's real turnSpec finalizer, W6-CR-3) was removed in W8-B5b when that kind was retired. Got: ${JSON.stringify(FINALIZER_IDS.map((f) => f.id))}`,
    );
  });
});

// ===========================================================================
// W6-B3 — the additive-optional `panel` field (ADR-043 2026-08-15 amendment
// §2: the read-half twin of `turnSpec` for a legacy kind — demo, onboarding,
// instructions gain `panel.phases`; architect keeps none, permanently) +
// `deriveSessionAffordances` (the read-half affordance view B6's UI will
// consume). Mirrors the AT-R422-* idiom above: fixture-driven vocab/exclusivity
// coverage, plus real-repo pins for the checked-in yaml.
// ===========================================================================

/** A well-formed 3-phase panel table — NOT copied from any real kind, just
 *  small enough to isolate one-field mutations cleanly (mirrors
 *  wellFormedTurnSpec's own role for turnSpec fixtures). */
function wellFormedPanel(): Record<string, unknown> {
  return {
    phases: [
      { phase: 'drafting', step: 'agent', writes: ['draft'], next: 'awaiting-review' },
      { phase: 'awaiting-review', step: 'noop', awaits: 'verdict' },
      { phase: 'done', step: 'terminal' },
    ],
  };
}

/** A descriptor fixture carrying `panel`, otherwise identical to
 *  baseDescriptor() — legacyRoutes forced to [] for the same reason
 *  turnSpecDescriptor does (a fresh tmp root has no apps/studio/app/ dir). */
function panelDescriptor(panel: Record<string, unknown>): FixtureDescriptor & { panel: Record<string, unknown> } {
  return { ...baseDescriptor({ legacyRoutes: [] }), panel };
}

/** Findings scoped to panel-* checks, isolated the same way turnspecFindings
 *  isolates turnspec-* checks. */
function panelFindings(findings: Finding[]): Finding[] {
  return findings.filter((f) => f.check.startsWith('session-kinds/panel-'));
}

describe('validateSessionKinds — panel (W6-B3): reuses the SAME frozen phase-row vocab as turnSpec.phases, under panel-* check ids', () => {
  it('W6-B3-1: a panel phase.step outside TURN_STEPS → session-kinds/panel-unknown-step naming the offending value AND every id in TURN_STEPS (the panel-side counterpart to AT-R422-2)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const bogus = 'not-a-real-step-at-all';
    const panel = wellFormedPanel();
    (panel.phases as Record<string, unknown>[])[0] = { ...(panel.phases as Record<string, unknown>[])[0], step: bogus };
    writeSessionKindsYaml(root, [panelDescriptor(panel)]);

    const findings = panelFindings(validateSessionKinds(root));
    const f = findings.find((x) => x.check === 'session-kinds/panel-unknown-step');
    assert.ok(f, `expected a session-kinds/panel-unknown-step finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes(bogus), 'message must name the offending value');
    for (const row of TURN_STEPS_FOR_TEST()) {
      assert.ok(f.message.includes(row), `message must name the allowed set (missing "${row}")`);
    }
  });

  it('W6-B3-2: a panel phase.finalizer outside FINALIZER_IDS → session-kinds/panel-unknown-finalizer naming the offending value AND every id in FINALIZER_IDS', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const bogus = 'notARealFinalizerAtAll';
    const panel = wellFormedPanel();
    const phases = panel.phases as Record<string, unknown>[];
    phases[phases.length - 1] = { phase: 'finalizing', step: 'finalize', finalizer: bogus }; // replace the terminal row so no-terminal-phase doesn't also fire
    writeSessionKindsYaml(root, [panelDescriptor(panel)]);

    const findings = panelFindings(validateSessionKinds(root));
    const f = findings.find((x) => x.check === 'session-kinds/panel-unknown-finalizer');
    assert.ok(f, `expected a session-kinds/panel-unknown-finalizer finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes(bogus), 'message must name the offending value');
    assert.ok(f.message.includes('copyStagingToLibrary'), 'message must name the allowed set (missing "copyStagingToLibrary")');
    assert.ok(f.message.includes('writeToRepoRoot'), 'message must name the allowed set (missing "writeToRepoRoot")');
    assert.ok(f.message.includes('recordLockedDemo'), 'message must name the allowed set (missing "recordLockedDemo")');
  });

  it('W6-B3-3: a panel.phases table with NO `step: terminal` row anywhere → session-kinds/panel-no-terminal-phase naming the offending descriptor', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const panel = wellFormedPanel();
    const phases = panel.phases as Record<string, unknown>[];
    const idx = phases.findIndex((p) => p.step === 'terminal');
    phases[idx] = { ...phases[idx], step: 'noop' };
    writeSessionKindsYaml(root, [panelDescriptor(panel)]);

    const findings = panelFindings(validateSessionKinds(root));
    const f = findings.find((x) => x.check === 'session-kinds/panel-no-terminal-phase');
    assert.ok(f, `expected a session-kinds/panel-no-terminal-phase finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('fixture-kind'));
  });

  it('W6-B3-4: an EMPTY panel.phases list → session-kinds/panel-empty-phases naming the offending descriptor', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeSessionKindsYaml(root, [panelDescriptor({ phases: [] })]);

    const findings = panelFindings(validateSessionKinds(root));
    const f = findings.find((x) => x.check === 'session-kinds/panel-empty-phases');
    assert.ok(f, `expected a session-kinds/panel-empty-phases finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('fixture-kind'));
  });

  it('W6-B3-12 (the reviewer\'s HIGH finding, missing-awaits rejection): a panel `step: noop` phase that OMITS `awaits` ENTIRELY → session-kinds/panel-noop-missing-awaits naming the kind, the phase, AND the allowed set — no fallback, no silent misclassification', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const panel = wellFormedPanel();
    const phases = panel.phases as Record<string, unknown>[];
    const idx = phases.findIndex((p) => p.phase === 'awaiting-review');
    phases[idx] = { phase: 'awaiting-review', step: 'noop' }; // `awaits` key genuinely absent, not merely undefined-valued
    writeSessionKindsYaml(root, [panelDescriptor(panel)]);

    const findings = panelFindings(validateSessionKinds(root));
    const f = findings.find((x) => x.check === 'session-kinds/panel-noop-missing-awaits');
    assert.ok(f, `expected a session-kinds/panel-noop-missing-awaits finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('fixture-kind'), 'message must name the offending kind');
    assert.ok(f.message.includes('awaiting-review'), 'message must name the offending phase');
    assert.ok(f.message.includes('questions'), 'message must name the allowed set (missing "questions")');
    assert.ok(f.message.includes('verdict'), 'message must name the allowed set (missing "verdict")');
  });

  it('W6-B3-13: a panel phase.awaits present but outside AWAITS_KINDS → session-kinds/panel-unknown-awaits naming the offending value AND the allowed set', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const bogus = 'not-a-real-awaits-value';
    const panel = wellFormedPanel();
    const phases = panel.phases as Record<string, unknown>[];
    const idx = phases.findIndex((p) => p.phase === 'awaiting-review');
    phases[idx] = { ...phases[idx], awaits: bogus };
    writeSessionKindsYaml(root, [panelDescriptor(panel)]);

    const findings = panelFindings(validateSessionKinds(root));
    const f = findings.find((x) => x.check === 'session-kinds/panel-unknown-awaits');
    assert.ok(f, `expected a session-kinds/panel-unknown-awaits finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes(bogus), 'message must name the offending value');
    assert.ok(f.message.includes('questions') && f.message.includes('verdict'), 'message must name the allowed set');
  });

  it('W6-B6-1 (the reviewer\'s HIGH finding, unknown-verdict rejection): a panel verdict row declaring a "verdicts" entry outside VERDICT_VALUES -> session-kinds/panel-unknown-verdict naming the offending value AND the allowed set', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const bogus = 'not-a-real-verdict-value';
    const panel = wellFormedPanel();
    const phases = panel.phases as Record<string, unknown>[];
    const idx = phases.findIndex((p) => p.phase === 'awaiting-review');
    phases[idx] = { ...phases[idx], verdicts: [bogus] };
    writeSessionKindsYaml(root, [panelDescriptor(panel)]);

    const findings = panelFindings(validateSessionKinds(root));
    const f = findings.find((x) => x.check === 'session-kinds/panel-unknown-verdict');
    assert.ok(f, `expected a session-kinds/panel-unknown-verdict finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes(bogus), 'message must name the offending value');
    assert.ok(f.message.includes('approve') && f.message.includes('reject'), 'message must name the allowed set');
  });

  it('W6-B6-2: "verdicts" declared on a row that is NOT a noop+awaits:verdict row -> session-kinds/panel-verdicts-misplaced (the field is meaningless anywhere else — dead, confusing authored data, never silently ignored)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const panel = wellFormedPanel();
    const phases = panel.phases as Record<string, unknown>[];
    const idx = phases.findIndex((p) => p.phase === 'drafting');
    phases[idx] = { ...phases[idx], verdicts: ['approve'] }; // "drafting" is step:agent, not noop+awaits:verdict
    writeSessionKindsYaml(root, [panelDescriptor(panel)]);

    const findings = panelFindings(validateSessionKinds(root));
    const f = findings.find((x) => x.check === 'session-kinds/panel-verdicts-misplaced');
    assert.ok(f, `expected a session-kinds/panel-verdicts-misplaced finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('drafting'), 'message must name the offending phase');
  });

  it('W6-B9 (reviewer finding on W6-B8): "requires" declared on a row that is NOT a noop+awaits:verdict row -> session-kinds/panel-requires-misplaced (mirrors verdicts-misplaced\'s exact shape — the field is meaningless anywhere else)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const panel = wellFormedPanel();
    const phases = panel.phases as Record<string, unknown>[];
    const idx = phases.findIndex((p) => p.phase === 'drafting');
    phases[idx] = { ...phases[idx], requires: ['id'] }; // "drafting" is step:agent, not noop+awaits:verdict
    writeSessionKindsYaml(root, [panelDescriptor(panel)]);

    const findings = panelFindings(validateSessionKinds(root));
    const f = findings.find((x) => x.check === 'session-kinds/panel-requires-misplaced');
    assert.ok(f, `expected a session-kinds/panel-requires-misplaced finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('drafting'), 'message must name the offending phase');
  });

  it('W6-B9 (derivation): a noop+awaits:verdict row declaring "requires: [id]" derives a verdict affordance whose meta.requires deep-equals it verbatim; a row declaring none omits the key entirely (never a fabricated [])', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const panel = wellFormedPanel();
    const phases = panel.phases as Record<string, unknown>[];
    const idx = phases.findIndex((p) => p.phase === 'awaiting-review');
    phases[idx] = { ...phases[idx], requires: ['id'] };
    writeSessionKindsYaml(root, [panelDescriptor(panel)]);

    const descs = loadSessionKinds(root);
    const withRequires = descs.find((d) => d.id === 'fixture-kind');
    assert.ok(withRequires, 'expected the fixture descriptor to load');
    const affordances = deriveSessionAffordances(withRequires as SessionKindDescriptor, 'awaiting-review');
    assert.deepEqual(
      affordances,
      [{ id: 'awaiting-review-verdict', kind: 'verdict', phase: 'awaiting-review', meta: { verdicts: ['approve', 'reject'], requires: ['id'] } }],
      `expected meta.requires to deep-equal the authored ["id"] list, got: ${JSON.stringify(affordances)}`,
    );

    // Negative control: the SAME row with no "requires" key at all omits it
    // entirely from meta — never defaults to [].
    const panelNoRequires = wellFormedPanel();
    writeSessionKindsYaml(root, [panelDescriptor(panelNoRequires)]);
    const descsNoRequires = loadSessionKinds(root);
    const withoutRequires = descsNoRequires.find((d) => d.id === 'fixture-kind');
    assert.ok(withoutRequires, 'expected the fixture descriptor to load');
    const affordancesNoRequires = deriveSessionAffordances(withoutRequires as SessionKindDescriptor, 'awaiting-review');
    assert.equal(affordancesNoRequires.length, 1);
    assert.equal(
      Object.prototype.hasOwnProperty.call(affordancesNoRequires[0].meta ?? {}, 'requires'),
      false,
      `a row with no "requires" key must omit it from meta entirely, got: ${JSON.stringify(affordancesNoRequires[0].meta)}`,
    );
  });

  it('W6-B6-3 (positive control): a panel verdict row declaring "verdicts: [approve]" (kb-cleanup/authoring\'s real shape) validates CLEAN — zero panel-* findings, and derives ONLY an approve button, never a fabricated reject', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const panel = wellFormedPanel();
    const phases = panel.phases as Record<string, unknown>[];
    const idx = phases.findIndex((p) => p.phase === 'awaiting-review');
    phases[idx] = { ...phases[idx], verdicts: ['approve'] };
    writeSessionKindsYaml(root, [panelDescriptor(panel)]);

    const findings = panelFindings(validateSessionKinds(root));
    assert.deepEqual(findings, [], `expected zero panel-* findings for a well-formed approve-only verdict row, got: ${JSON.stringify(findings)}`);

    const [descriptor] = loadSessionKinds(root);
    const affordances = deriveSessionAffordances(descriptor, 'awaiting-review');
    const verdictAffordance = affordances.find((a) => a.kind === 'verdict');
    assert.ok(verdictAffordance, 'expected a verdict affordance to derive for "awaiting-review"');
    assert.deepEqual(
      verdictAffordance!.meta,
      { verdicts: ['approve'] },
      `expected the authored approve-only list to derive verbatim (never the ['approve','reject'] default), got: ${JSON.stringify(verdictAffordance!.meta)}`,
    );
  });

  it('W6-B3-5 (positive control): the well-formed panel fixture validates CLEAN — zero panel-* findings (without this, W6-B3-1..4 could all pass for the wrong reason — an implementation that rejects every panel unconditionally)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeSessionKindsYaml(root, [panelDescriptor(wellFormedPanel())]);
    const findings = panelFindings(validateSessionKinds(root));
    assert.deepEqual(findings, [], `expected zero panel-* findings for a well-formed panel, got: ${JSON.stringify(findings)}`);
  });

  it('W6-B3-11 (the finalizer-vocab-split reviewer finding, direct pairing): a turnSpec row naming "writeToRepoRoot" FAILS lint (it is real and descriptive but not in the DISPATCHABLE set — resolveFinalizer would throw at spawn time), while the IDENTICAL finalizer id on a panel row (never dispatched) PASSES', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const turnSpec = wellFormedTurnSpec();
    const turnSpecPhases = turnSpec.phases as Record<string, unknown>[];
    const committingIdx = turnSpecPhases.findIndex((p) => p.phase === 'committing');
    turnSpecPhases[committingIdx] = { ...turnSpecPhases[committingIdx], finalizer: 'writeToRepoRoot' };

    const panel = wellFormedPanel();
    const panelPhases = panel.phases as Record<string, unknown>[];
    panelPhases[panelPhases.length - 1] = { phase: 'finalizing', step: 'finalize', finalizer: 'writeToRepoRoot' }; // replaces the terminal row — see W6-B3-2's own note on this shape

    writeSessionKindsYaml(root, [
      { ...turnSpecDescriptor(turnSpec), id: 'turnspec-writetorepo-kind' },
      { ...panelDescriptor(panel), id: 'panel-writetorepo-kind' },
    ]);

    const findings = validateSessionKinds(root);
    const turnSpecFinding = findings.find((f) => f.object === 'session-kind:turnspec-writetorepo-kind' && f.check === 'session-kinds/turnspec-unknown-finalizer');
    assert.ok(
      turnSpecFinding,
      `expected a session-kinds/turnspec-unknown-finalizer finding for the turnSpec row naming "writeToRepoRoot" (it would throw at spawn — resolveFinalizer/FINALIZERS has no such id), got: ${JSON.stringify(findings)}`,
    );
    assert.ok(turnSpecFinding!.message.includes('writeToRepoRoot'), 'message must name the offending value');

    const panelUnknownFinalizerFindings = findings.filter((f) => f.object === 'session-kind:panel-writetorepo-kind' && f.check === 'session-kinds/panel-unknown-finalizer');
    assert.deepEqual(
      panelUnknownFinalizerFindings,
      [],
      `the IDENTICAL finalizer id on a panel row must pass — panel is never dispatched (invisible to cmdAgentRun's turnSpec fork), so it validates against the full DESCRIPTIVE FINALIZER_IDS, which does carry "writeToRepoRoot". Got: ${JSON.stringify(panelUnknownFinalizerFindings)}`,
    );
  });
});

/** Local literal mirror of TURN_STEPS' ids, used only so the allowed-set
 *  assertion above doesn't have to (dynamically) import the module a second
 *  time — the four ids TURN_STEPS is documented to be exactly. */
function TURN_STEPS_FOR_TEST(): string[] {
  return ['agent', 'noop', 'finalize', 'terminal'];
}

describe('validateSessionKinds — turnSpec ⊕ panel mutual exclusion (W6-B3, ADR-043 2026-08-15 amendment §2)', () => {
  it('W6-B3-6: a descriptor declaring BOTH turnSpec AND panel → EXACTLY ONE finding (session-kinds/turnspec-panel-exclusive), naming the kind AND both field names — and NEITHER field\'s own phase-table checks run (no turnspec-* or panel-* secondary findings, even though both tables here are individually well-formed)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeSessionKindsYaml(root, [
      { ...baseDescriptor({ legacyRoutes: [] }), turnSpec: wellFormedTurnSpec(), panel: wellFormedPanel() },
    ]);

    const findings = validateSessionKinds(root).filter((f) => f.object === 'session-kind:fixture-kind');
    const exclusive = findings.filter((f) => f.check === 'session-kinds/turnspec-panel-exclusive');
    assert.equal(exclusive.length, 1, `expected exactly ONE exclusivity finding, got: ${JSON.stringify(findings)}`);
    assert.equal(exclusive[0].level, 'error');
    assert.ok(exclusive[0].message.includes('fixture-kind'), 'message must name the offending kind');
    assert.ok(exclusive[0].message.includes('turnSpec'), 'message must name the "turnSpec" field');
    assert.ok(exclusive[0].message.includes('panel'), 'message must name the "panel" field');

    const secondary = findings.filter(
      (f) => f.check !== 'session-kinds/turnspec-panel-exclusive' && (f.check.startsWith('session-kinds/turnspec-') || f.check.startsWith('session-kinds/panel-')),
    );
    assert.deepEqual(
      secondary,
      [],
      `both wellFormedTurnSpec() and wellFormedPanel() are individually valid — a doubly-declared descriptor must produce ONLY the exclusivity finding, not also run either field's phase-table checks. Got secondary findings: ${JSON.stringify(secondary)}`,
    );
  });

  it('W6-B3-7 (positive controls): turnSpec-only and panel-only descriptors never trip the exclusivity check', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeSessionKindsYaml(root, [
      turnSpecDescriptor(wellFormedTurnSpec()),
      { ...panelDescriptor(wellFormedPanel()), id: 'panel-only-kind' },
    ]);
    const findings = validateSessionKinds(root);
    assert.deepEqual(
      findings.filter((f) => f.check === 'session-kinds/turnspec-panel-exclusive'),
      [],
      `a descriptor carrying only ONE of turnSpec/panel must never trip the exclusivity check, got: ${JSON.stringify(findings)}`,
    );
  });
});

describe('loadSessionKinds — panel is STRUCTURAL ONLY (mirrors AT-R422-6\'s split for turnSpec)', () => {
  it('W6-B3-8: a semantically-invalid panel (bogus step) does NOT throw at load time and the parsed descriptor carries the panel data INTACT, unmodified', () => {
    const root = makeForgeRoot();
    const bogusPanel = { phases: [{ phase: 'x', step: 'not-a-real-step' }] };
    writeSessionKindsYaml(root, [panelDescriptor(bogusPanel)]);
    let descs: SessionKindDescriptor[] = [];
    assert.doesNotThrow(() => { descs = loadSessionKinds(root); }, 'loadSessionKinds must not throw on a semantically-bogus panel — only a structurally malformed one');
    assert.deepEqual((descs[0] as SessionKindDescriptor & { panel?: unknown }).panel, bogusPanel, 'the loader must carry the panel object through unmodified, including the offending step value');
  });
});

describe('the real repo (studio/session-kinds.yaml) — panel.phases on demo/instructions/onboarding, architect gains none (W6-B3)', () => {
  it('W6-B3-9: loadSessionKinds(REPO_ROOT) — demo, instructions, and onboarding each carry a `panel` with the exact phase table this initiative authored; project-brain, authoring, kb-cleanup, and architect carry NO panel at all', () => {
    const descs = loadSessionKinds(REPO_ROOT);

    const demo = byId(descs, 'demo');
    assert.deepEqual(
      demo.panel,
      {
        phases: [
          // W6-B10: every demo session is minted straight into 'briefing'
          // (POST /api/demo-builder/start) — this row is what lets the
          // dedicated /sessions/demo/<sid> screen actually get one started.
          { phase: 'briefing', step: 'noop', awaits: 'questions' },
          { phase: 'generating', step: 'agent', writes: ['demo'], next: 'awaiting-review' },
          // W7-C2 (bead forge-4ei): the three-way branch the runner always
          // supported is now DECLARED (revise = feedback -> regenerate).
          { phase: 'awaiting-review', step: 'noop', awaits: 'verdict', verdicts: ['approve', 'revise', 'reject'] },
          { phase: 'locking', step: 'finalize', finalizer: 'recordLockedDemo', next: 'locked' },
          { phase: 'locked', step: 'terminal' },
          { phase: 'abandoned', step: 'terminal' },
        ],
      },
      `demo's panel must deep-equal the briefing->generating->awaiting-review->locking->locked/abandoned table mirroring demo-builder-runner.ts:15-20, got: ${JSON.stringify(demo.panel)}`,
    );

    const instructions = byId(descs, 'instructions');
    assert.deepEqual(
      instructions.panel,
      {
        phases: [
          // W6-B9 — the pre-interview briefing checkpoint (POST
          // /api/instructions/start lands every new session here); reuses
          // `question-form` (`awaits: 'questions'`), same as awaiting-answers.
          { phase: 'briefing', step: 'noop', awaits: 'questions', next: 'interviewing' },
          { phase: 'interviewing', step: 'agent' },
          { phase: 'awaiting-answers', step: 'noop', awaits: 'questions', next: 'interviewing' },
          { phase: 'drafting', step: 'agent', writes: ['draft'], next: 'awaiting-verdict' },
          // W7-C2 (sessions-kinds-09): the runner's real three-way branch,
          // declared (revise = feedback.md -> drafting).
          { phase: 'awaiting-verdict', step: 'noop', awaits: 'verdict', verdicts: ['approve', 'revise', 'reject'] },
          { phase: 'finalizing', step: 'finalize', finalizer: 'writeToRepoRoot', next: 'committed' },
          { phase: 'committed', step: 'terminal' },
          { phase: 'rejected', step: 'terminal' },
        ],
      },
      `instructions' panel must deep-equal the briefing->interviewing->...->committed/rejected table mirroring instructions-runner.ts:17-24 + W6-B9's briefing row, got: ${JSON.stringify(instructions.panel)}`,
    );

    const onboarding = byId(descs, 'onboarding');
    assert.deepEqual(
      onboarding.panel,
      { phases: [{ phase: 'running', step: 'agent' }, { phase: 'complete', step: 'terminal' }, { phase: 'failed', step: 'terminal' }] },
      `onboarding's panel must deep-equal the thin running->complete/failed table mirroring writeSessionTerminalPhase (packages/agents/agent-run.ts:198), got: ${JSON.stringify(onboarding.panel)}`,
    );

    for (const id of ['architect', 'project-brain', 'authoring', 'kb-cleanup']) {
      const d = byId(descs, id);
      assert.equal(
        (d as SessionKindDescriptor & { panel?: unknown }).panel,
        undefined,
        `"${id}" must carry NO panel field — architect keeps its bespoke panel permanently (ADR-043 amendment §4); authoring/kb-cleanup already have turnSpec, which is mutually exclusive with panel; project-brain has neither yet`,
      );
    }
  });

  it('W6-B3-10: validateSessionKinds(REPO_ROOT) reports ZERO panel-* and ZERO turnspec-panel-exclusive findings (the real yaml round-trips clean end to end — reinforces AT-17\'s blanket zero-errors assertion with a check specific to this initiative\'s own new checks)', () => {
    const findings = validateSessionKinds(REPO_ROOT);
    const scoped = findings.filter((f) => f.check.startsWith('session-kinds/panel-') || f.check === 'session-kinds/turnspec-panel-exclusive');
    assert.deepEqual(scoped, [], `expected zero panel-scoped findings in the real repo, got: ${JSON.stringify(scoped)}`);
  });
});

