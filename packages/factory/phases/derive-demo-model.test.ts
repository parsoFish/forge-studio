/**
 * The derived demo model (spec §5 item 4) — red-first.
 *
 * The demo bundle used to be authored by an LLM and validated afterwards. It is
 * now DERIVED: the AC table, the gate evidence and the diffstat are facts the
 * orchestrator already holds, so a model built from them is reproducible and
 * needs no authoring retry. These tests fix the derivation's contract before it
 * exists, and every one of them names the failure it kills.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { deriveDemoModel, type DerivedDemoInput } from './derive-demo-model.ts';
import { validateDemoModel } from '../demo-model.ts';

const CAPTURE_STEP = {
  kind: 'capture' as const,
  text: 'Run `npm run demo` to build a deterministic fixture repo and capture the real generated report.',
};
const VERIFY_STEP = {
  kind: 'verify' as const,
  text: 'Read back the captured report against the expected sentinel values.',
};

function baseInput(overrides: Partial<DerivedDemoInput> = {}): DerivedDemoInput {
  return {
    initiativeId: 'INIT-2026-09-05-derive',
    title: 'Derive the demo bundle',
    project: 'gitpulse',
    diffStat: ' 3 files changed, 42 insertions(+), 7 deletions(-)',
    headSha: 'abc1234',
    changedFiles: ['src/report.ts', 'src/report.test.ts'],
    workItems: [
      { id: 'WI-1', title: 'Build the report', status: 'complete' },
      { id: 'WI-2', title: 'Prove the report', status: 'complete' },
    ],
    acceptanceCriteria: ['(WI-1) GIVEN a fixture repo WHEN the CLI runs THEN a report prints'],
    gateEvidence: [
      { gate: 'local', cmd: ['npm', 'test'], ok: true, outputTail: '120 passing' },
      { gate: 'ci', cmd: ['npm', 'run', 'ci'], ok: true, outputTail: 'ci green' },
    ],
    demoProcess: [CAPTURE_STEP, VERIFY_STEP],
    capture: 'checkpoints',
    ...overrides,
  };
}

function modelOf(input: DerivedDemoInput) {
  const derived = deriveDemoModel(input);
  assert.equal(derived.ok, true, `expected a derived model, got errors: ${derived.ok ? '' : derived.errors.join('; ')}`);
  return derived.ok ? derived.model : (undefined as never);
}

describe('deriveDemoModel — the checkpoint comes from the project contract, never from prose invention', () => {
  it('kills "the command was invented": a capture step\'s FIRST inline-code span is the checkpoint command', () => {
    const model = modelOf(baseInput());
    const withCommand = model.checkpoints.filter((c) => c.command !== undefined);
    assert.equal(withCommand.length, 1);
    assert.equal(withCommand[0]?.command, 'npm run demo');
    assert.ok(withCommand[0]?.caption.includes('capture the real generated report'), 'the step text is the caption');
  });

  it('kills "a verify/present step becomes a fake before/after": only capture steps carry a command', () => {
    const model = modelOf(baseInput({ demoProcess: [CAPTURE_STEP, VERIFY_STEP, { kind: 'present', text: 'Attach the evidence.' }] }));
    assert.deepEqual(model.checkpoints.map((c) => c.command !== undefined), [true]);
  });

  it('kills "capture was demanded and silently skipped": a capture step with no inline-code span is a LOUD config error', () => {
    const derived = deriveDemoModel(baseInput({ demoProcess: [{ kind: 'capture', text: 'Somehow show the thing working.' }] }));
    assert.equal(derived.ok, false);
    if (derived.ok) return;
    assert.match(derived.errors.join('\n'), /demoProcess\[0\]/);
    assert.match(derived.errors.join('\n'), /inline-code/i);
  });

  it('kills "no demo process, green anyway": class capture=checkpoints with zero capture steps is a LOUD config error', () => {
    const derived = deriveDemoModel(baseInput({ demoProcess: [VERIFY_STEP] }));
    assert.equal(derived.ok, false);
    if (derived.ok) return;
    assert.match(derived.errors.join('\n'), /capture/i);
  });

  it('kills "a shell string is run as a command": an inline span with shell metacharacters is a config error', () => {
    const derived = deriveDemoModel(
      baseInput({ demoProcess: [{ kind: 'capture', text: 'Run `npm run demo | tee out.txt` and capture it.' }] }),
    );
    assert.equal(derived.ok, false);
    if (derived.ok) return;
    assert.match(derived.errors.join('\n'), /shell/i);
  });
});

describe('deriveDemoModel — the class decides what evidence is captured', () => {
  it('kills "docs work runs a demo capture": capture=none derives ONE command-less checkpoint and no error', () => {
    const model = modelOf(baseInput({ capture: 'none', demoProcess: [{ kind: 'capture', text: 'no code span here' }] }));
    assert.equal(model.checkpoints.length, 1);
    assert.equal(model.checkpoints[0]?.command, undefined);
  });

  it('kills "infra invents a before/after": capture=plan-output carries the GATE output as the after-evidence', () => {
    const model = modelOf(baseInput({ capture: 'plan-output' }));
    assert.equal(model.checkpoints.length, 1);
    assert.equal(model.checkpoints[0]?.command, undefined);
    assert.ok(model.checkpoints[0]?.afterOutput?.includes('120 passing'), 'the gate output is the plan evidence');
  });
});

describe('deriveDemoModel — what it refuses to invent', () => {
  it('kills self-grading: the derived model carries NO acEvaluations, whatever the input', () => {
    for (const capture of ['checkpoints', 'none', 'plan-output'] as const) {
      const model = modelOf(baseInput({ capture }));
      assert.equal(model.acEvaluations, undefined, `capture=${capture} must not score its own criteria`);
    }
  });

  it('kills "the diffstat drifted": diffStat and the AC list are carried VERBATIM', () => {
    const input = baseInput();
    const model = modelOf(input);
    assert.equal(model.diffStat, input.diffStat);
    assert.deepEqual(model.acceptanceCriteria, [...input.acceptanceCriteria]);
  });

  it('kills "the gate evidence was summarised away": one testEvidence row per gate, with its real result', () => {
    const model = modelOf(
      baseInput({ gateEvidence: [{ gate: 'local', cmd: ['npm', 'test'], ok: false, outputTail: '1 failing' }] }),
    );
    assert.deepEqual(model.testEvidence?.map((r) => [r.name, r.result]), [['local: npm test', 'fail']]);
  });

  it('kills "the model drifts between runs": the same input derives a deep-equal model twice', () => {
    const input = baseInput();
    assert.deepEqual(deriveDemoModel(input), deriveDemoModel(input));
  });
});

describe('deriveDemoModel — the product of the derivation is a valid demo.json', () => {
  it('kills "derived but unrenderable": every capture mode produces a model the shipped validator accepts', () => {
    for (const capture of ['checkpoints', 'none', 'plan-output'] as const) {
      const model = modelOf(baseInput({ capture }));
      assert.deepEqual(validateDemoModel(model), [], `capture=${capture} produced an invalid demo.json`);
    }
  });

  it('kills "an empty initiative renders an empty demo": title, essence and project are non-empty', () => {
    const model = modelOf(baseInput({ workItems: [], acceptanceCriteria: [] }));
    for (const field of ['title', 'essence', 'project'] as const) {
      assert.ok(String(model[field]).trim().length > 0, `${field} must be non-empty`);
    }
  });
});
