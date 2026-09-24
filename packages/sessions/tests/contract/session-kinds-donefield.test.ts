/**
 * Bead forge-8vfn.6.6 item 3 (coordinator follow-up on item 5) —
 * `validateSessionKinds` checks for the doneField/nextOnDone/ceiling fields
 * (interview ceiling + interview->draft same-turn fall-through,
 * `interactive-agent-step.ts`): a dangling `nextOnDone`, and doneField/
 * nextOnDone declared without each other (ceiling declared without
 * doneField is the same co-requirement shape). Mirrors the existing
 * `turnspec-dangling-next` / `turnspec-verdicts-misplaced` pattern exactly —
 * same fixture helpers, same `turnspecFindings` isolation, same
 * name-the-offending-value-and-the-real-set message discipline.
 */
import { wellFormedTurnSpec, turnSpecDescriptor } from './test-fixtures/session-kinds-turnspec.ts';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateSessionKinds } from '../../studio/session-kinds-validate.ts';
import type { Finding } from '@forge/kernel';
import { makeForgeRoot, writeAgentSkill, writeSessionKindsYaml } from './test-fixtures/session-kinds-core.ts';

/** Mirrors session-kinds-turnspec.test.ts's own isolation helper exactly. */
function turnspecFindings(findings: Finding[]): Finding[] {
  return findings.filter((f) => f.check.startsWith('session-kinds/turnspec-'));
}

function analyzingPhase(turnSpec: Record<string, unknown>): Record<string, unknown>[] {
  return turnSpec.phases as Record<string, unknown>[];
}

describe('validateSessionKinds — doneField/nextOnDone/ceiling (bead 8vfn.6.6 item 3)', () => {
  it('POSITIVE CONTROL: a well-formed turnSpec with NO doneField/nextOnDone/ceiling at all produces zero donefield-* findings', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeSessionKindsYaml(root, [turnSpecDescriptor(wellFormedTurnSpec())]);

    const findings = turnspecFindings(validateSessionKinds(root)).filter((f) => f.check.includes('donefield'));
    assert.deepEqual(findings, [], `expected zero donefield-* findings for a turnSpec that declares none of these fields, got: ${JSON.stringify(findings)}`);
  });

  it('POSITIVE CONTROL: a CONSISTENT doneField+nextOnDone+ceiling triple, with nextOnDone resolving to a real phase, produces zero findings', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const turnSpec = wellFormedTurnSpec();
    const phases = analyzingPhase(turnSpec);
    const idx = phases.findIndex((p) => p.phase === 'analyzing');
    phases[idx] = { ...phases[idx], doneField: 'done', nextOnDone: 'committing', ceiling: 4 };
    writeSessionKindsYaml(root, [turnSpecDescriptor(turnSpec)]);

    const findings = turnspecFindings(validateSessionKinds(root)).filter((f) => f.check.includes('donefield') || f.check.includes('next-on-done'));
    assert.deepEqual(findings, [], `expected zero findings for a consistent, resolving doneField triple, got: ${JSON.stringify(findings)}`);
  });

  it('doneField declared WITHOUT nextOnDone -> error naming the co-requirement', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const turnSpec = wellFormedTurnSpec();
    const phases = analyzingPhase(turnSpec);
    const idx = phases.findIndex((p) => p.phase === 'analyzing');
    phases[idx] = { ...phases[idx], doneField: 'done' };
    writeSessionKindsYaml(root, [turnSpecDescriptor(turnSpec)]);

    const findings = turnspecFindings(validateSessionKinds(root));
    const f = findings.find((x) => x.check === 'session-kinds/turnspec-donefield-corequired');
    assert.ok(f, `expected a session-kinds/turnspec-donefield-corequired finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('analyzing'), 'message must name the offending phase');
  });

  it('nextOnDone declared WITHOUT doneField -> error naming the co-requirement', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const turnSpec = wellFormedTurnSpec();
    const phases = analyzingPhase(turnSpec);
    const idx = phases.findIndex((p) => p.phase === 'analyzing');
    phases[idx] = { ...phases[idx], nextOnDone: 'committing' };
    writeSessionKindsYaml(root, [turnSpecDescriptor(turnSpec)]);

    const findings = turnspecFindings(validateSessionKinds(root));
    const f = findings.find((x) => x.check === 'session-kinds/turnspec-donefield-corequired');
    assert.ok(f, `expected a session-kinds/turnspec-donefield-corequired finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f.level, 'error');
  });

  it('ceiling declared WITHOUT doneField -> error naming the co-requirement (ceiling is meaningless alone)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const turnSpec = wellFormedTurnSpec();
    const phases = analyzingPhase(turnSpec);
    const idx = phases.findIndex((p) => p.phase === 'analyzing');
    phases[idx] = { ...phases[idx], ceiling: 4 };
    writeSessionKindsYaml(root, [turnSpecDescriptor(turnSpec)]);

    const findings = turnspecFindings(validateSessionKinds(root));
    const f = findings.find((x) => x.check === 'session-kinds/turnspec-donefield-corequired');
    assert.ok(f, `expected a session-kinds/turnspec-donefield-corequired finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f.level, 'error');
  });

  it('nextOnDone naming a phase absent from the table ("dangling nextOnDone") -> error naming the offending value AND the real phase names', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const turnSpec = wellFormedTurnSpec();
    const phases = analyzingPhase(turnSpec);
    const idx = phases.findIndex((p) => p.phase === 'analyzing');
    phases[idx] = { ...phases[idx], doneField: 'done', nextOnDone: 'phase-that-does-not-exist' };
    writeSessionKindsYaml(root, [turnSpecDescriptor(turnSpec)]);

    const findings = turnspecFindings(validateSessionKinds(root));
    const f = findings.find((x) => x.check === 'session-kinds/turnspec-dangling-next-on-done');
    assert.ok(f, `expected a session-kinds/turnspec-dangling-next-on-done finding, got: ${JSON.stringify(findings)}`);
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('phase-that-does-not-exist'), 'message must name the offending nextOnDone value');
    for (const p of phases) {
      assert.ok(f.message.includes(p.phase as string), `message must name the real phase-name set (missing "${p.phase}")`);
    }
  });

  it('panel.phases carrying doneField/nextOnDone produces NO donefield-* finding at all (turnSpec-only; panel never dispatches)', () => {
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    const panelPhases = analyzingPhase(wellFormedTurnSpec());
    const idx = panelPhases.findIndex((p) => p.phase === 'analyzing');
    panelPhases[idx] = { ...panelPhases[idx], doneField: 'done' }; // deliberately WITHOUT nextOnDone
    writeSessionKindsYaml(root, [{
      id: 'fixture-kind', agent: 'fixture-agent', title: 'Fixture Kind', legacyRoutes: [],
      stages: ['roadmap'], defaultStage: 'roadmap', artifact: { kind: 'roadmap-draft', label: 'Fixture draft' },
      panel: { phases: panelPhases },
    }]);

    const findings = validateSessionKinds(root).filter((f) => f.check.includes('donefield') || f.check.includes('next-on-done'));
    assert.deepEqual(findings, [], `expected zero donefield-*/next-on-done findings for a panel-only descriptor, got: ${JSON.stringify(findings)}`);
  });
});
