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

import { derivePrBody, PR_BODY_SECTIONS } from './derive-pr-body.ts';
import { deriveDemoModel, type DerivedDemoInput } from './derive-demo-model.ts';

function input(overrides: Partial<DerivedDemoInput> = {}): DerivedDemoInput {
  return {
    initiativeId: 'INIT-2026-09-05-derive',
    title: 'Derive the demo bundle',
    project: 'gitpulse',
    diffStat: ' 3 files changed, 42 insertions(+), 7 deletions(-)',
    headSha: 'abc1234',
    changedFiles: ['src/report.ts'],
    workItems: [{ id: 'WI-1', title: 'Build the report', status: 'complete' }],
    acceptanceCriteria: ['(WI-1) GIVEN a fixture repo WHEN the CLI runs THEN a report prints'],
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

  it('kills "the body claims a criterion that is not in the manifest": every AC appears VERBATIM', () => {
    const acs = ['(WI-1) GIVEN a THEN b', '(WI-2) GIVEN c THEN d'];
    const body = bodyOf({ acceptanceCriteria: acs });
    for (const ac of acs) assert.ok(body.includes(ac), `missing ${ac}`);
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
