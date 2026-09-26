/**
 * The derived PR body (spec §5 item 4) — red-first.
 *
 * `openPrInline` opens the PR with `--body-file .forge/pr-description.md`. That
 * file used to be authored by the demo agent and validated for three sections;
 * a missing one bought a retry. It is now derived from the same three facts the
 * demo model is derived from, so the sections cannot be missing and there is
 * nothing to retry.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { derivePrBody, PR_BODY_SECTIONS } from '../../phases/derive-pr-body.ts';
import { deriveDemoModel, type DerivedDemoInput } from '../../phases/derive-demo-model.ts';

function input(overrides: Partial<DerivedDemoInput> = {}): DerivedDemoInput {
  return {
    initiativeId: 'INIT-2026-09-05-derive',
    title: 'Derive the demo bundle',
    project: 'gitpulse',
    diffStat: ' 3 files changed, 42 insertions(+), 7 deletions(-)',
    headSha: 'abc1234',
    changedFiles: ['src/report.ts'],
    workItems: [{ id: 'WI-1', title: 'Build the report', status: 'complete' }],
    acceptanceCriteria: [{ workItemId: 'WI-1', given: 'a fixture repo', when: 'the CLI runs', then: 'a report prints' }],
    gateEvidence: [
      { gate: 'local', cmd: ['npm', 'test'], ok: true, outputTail: '120 passing' },
      { gate: 'ci', cmd: ['npm', 'run', 'ci'], ok: false, outputTail: 'red' },
    ],
    demoProcess: [{ kind: 'capture', text: 'Run `npm run demo` and capture it.' }],
    capture: 'checkpoints',
    ...overrides,
  };
}

function bodyOf(overrides: Partial<DerivedDemoInput> = {}): string {
  const derived = deriveDemoModel(input(overrides));
  assert.equal(derived.ok, true);
  return derived.ok ? derivePrBody(derived.model, input(overrides)) : '';
}

describe('derivePrBody', () => {
  it('kills "no PR opens": every section openPrInline\'s body needs is present', () => {
    const body = bodyOf();
    for (const section of PR_BODY_SECTIONS) assert.ok(body.includes(section), `missing ${section}`);
  });

  it('kills "the body claims a criterion that is not in the manifest": every AC appears VERBATIM, rendered from its typed fields', () => {
    const acs = [
      { workItemId: 'WI-1', given: 'a', when: 'w1', then: 'b' },
      { workItemId: 'WI-2', given: 'c', when: 'w2', then: 'd' },
    ];
    const rendered = ['(WI-1) GIVEN a WHEN w1 THEN b', '(WI-2) GIVEN c WHEN w2 THEN d'];
    const body = bodyOf({ acceptanceCriteria: acs });
    for (const line of rendered) assert.ok(body.includes(line), `missing ${line}`);
  });

  it('kills "the body names a file the diff does not contain": the file list IS the diff\'s', () => {
    const body = bodyOf({ changedFiles: ['src/only.ts'] });
    assert.ok(body.includes('src/only.ts'));
    assert.ok(!body.includes('src/report.ts'));
  });

  it('kills "a red gate reads as green": each gate row carries its real result', () => {
    const body = bodyOf();
    assert.match(body, /npm test.*(pass|✅|green)/i);
    assert.match(body, /npm run ci.*(fail|❌|red)/i);
  });

  it('kills "the diffstat drifted": the diffstat is carried verbatim', () => {
    assert.ok(bodyOf().includes(' 3 files changed, 42 insertions(+), 7 deletions(-)'));
  });

  it('kills "the body drifts between runs": the same input derives the same body twice', () => {
    assert.equal(bodyOf(), bodyOf());
  });

  it('kills "an empty initiative writes an empty body": a no-WI, no-AC initiative still yields all sections', () => {
    const body = bodyOf({ workItems: [], acceptanceCriteria: [], gateEvidence: [] });
    for (const section of PR_BODY_SECTIONS) assert.ok(body.includes(section), `missing ${section}`);
    assert.ok(body.trim().length > 0);
  });
});

describe('derivePrBody — delta honesty (forge-mfv5.1.7, CONTROL RED)', () => {
  it('kills "a behaviour-preserving change goes unremarked": every captured checkpoint unchanged must say so in words', () => {
    const derived = deriveDemoModel(input());
    assert.equal(derived.ok, true);
    if (!derived.ok) return;
    // Simulate a successful capture whose before/after evidence was BYTE-IDENTICAL
    // for every checkpoint — the fact the delta-honesty computation (item 3) would
    // tag `delta: 'unchanged'` after a real capture.
    const model = {
      ...derived.model,
      checkpoints: derived.model.checkpoints.map((c) => ({ ...c, delta: 'unchanged' as const })),
    };
    const body = derivePrBody(model, input());
    assert.ok(
      body.includes('No observable behaviour change was captured.'),
      'a byte-identical before/after capture must say so in the PR body, not leave the reader to assume something changed',
    );
  });

  it('kills "the flag never reaches the reader": each evidence row names its own checkpoint\'s delta in words', () => {
    const derived = deriveDemoModel(input());
    assert.equal(derived.ok, true);
    if (!derived.ok) return;
    const model = { ...derived.model, checkpoints: derived.model.checkpoints.map((c) => ({ ...c, delta: 'changed' as const })) };
    const body = derivePrBody(model, input());
    assert.match(body, /npm run demo.*\(changed\)/);
  });

  it('kills "some changed reads as no change": a mix reports "<k> of <n> captured checkpoints changed behaviour."', () => {
    const derived = deriveDemoModel(
      input({ demoProcess: [{ kind: 'capture', text: 'Run `npm run demo` and capture it.' }, { kind: 'capture', text: 'Run `npm run demo2` and capture it.' }] }),
    );
    assert.equal(derived.ok, true);
    if (!derived.ok) return;
    const model = {
      ...derived.model,
      checkpoints: derived.model.checkpoints.map((c, i) => ({ ...c, delta: i === 0 ? ('changed' as const) : ('unchanged' as const) })),
    };
    const body = derivePrBody(model, input());
    assert.ok(body.includes('1 of 2 captured checkpoints changed behaviour.'), body);
  });

  it('kills "unknown counts as a claim of change": an unknown checkpoint is NAMED, and no "no change" claim is made', () => {
    const derived = deriveDemoModel(input());
    assert.equal(derived.ok, true);
    if (!derived.ok) return;
    const model = {
      ...derived.model,
      checkpoints: derived.model.checkpoints.map((c) => ({ ...c, delta: 'unknown' as const })),
    };
    const body = derivePrBody(model, input());
    assert.ok(body.includes(`checkpoint(s) could not be compared: ${model.checkpoints[0]?.label}`), body);
    assert.doesNotMatch(body, /No observable behaviour change was captured\./, 'unknown must never be read as "no change"');
  });
});
