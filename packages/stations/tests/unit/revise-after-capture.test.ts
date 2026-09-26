/**
 * `reviseAfterCapture` (spec item forge-mfv5.1.7) — direct unit tests.
 *
 * `runIntegrateBand` calls this AFTER a successful, nonce-verified orchestrated
 * capture, to re-derive the essence + PR body from the real per-checkpoint
 * delta flags `forge demo capture` just wrote. Two properties matter enough to
 * test directly rather than only through the full band:
 *
 *   FAILS CLOSED — an unreadable/malformed demo.json at this point is a real
 *   failure (the capture succeeded, but this module cannot trust what it left
 *   behind), not a best-effort skip that leaves a stale pre-capture PR body
 *   in place with no one told.
 *
 *   IDEMPOTENT — the essence is re-derived from a fixed `baseEssence` (what
 *   `deriveDemoModel` computed BEFORE capture ran) every time, never appended
 *   to whatever is already on disk, so calling this twice over the same
 *   demo.json cannot duplicate the delta sentence.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { reviseAfterCapture } from '../../phases/integrate.ts';
import type { DerivedDemoInput } from '../../phases/derive-demo-model.ts';
import type { DemoModel } from '../../demo-model.ts';

function derivedInput(): DerivedDemoInput {
  return {
    initiativeId: 'INIT-2026-09-27-revise',
    title: 'Revise after capture',
    project: 'gitpulse',
    diffStat: ' 1 file changed',
    headSha: 'abc1234',
    changedFiles: ['src.ts'],
    workItems: [],
    acceptanceCriteria: [],
    gateEvidence: [],
    demoProcess: [],
    capture: 'checkpoints',
  };
}

function validModel(overrides: Partial<DemoModel> = {}): DemoModel {
  return {
    title: 'Revise after capture',
    essence: 'BASE ESSENCE — 0 work items delivered.',
    project: 'gitpulse',
    diffStat: ' 1 file changed',
    checkpoints: [{ label: 'churn', caption: 'CLI run', command: 'gitpulse churn .', delta: 'unchanged' }],
    ...overrides,
  };
}

function noopEmit(): void {}

describe('reviseAfterCapture — fails closed', () => {
  it('kills "a corrupt demo.json reads as success": invalid JSON after a successful capture returns a failure, not a silent skip', () => {
    const dir = mkdtempSync(join(tmpdir(), 'revise-corrupt-'));
    const jsonPath = join(dir, 'demo.json');
    const prPath = join(dir, 'pr.md');
    try {
      writeFileSync(jsonPath, 'not json at all {{{');
      const result = reviseAfterCapture(jsonPath, dir, prPath, dir, derivedInput(), 'BASE ESSENCE.', noopEmit);
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.reason, 'delta-revise-failed');
      assert.ok(result.detail.length > 0, 'the detail must name what went wrong');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('kills "a demo.json with no checkpoints array reads as success": structurally broken JSON is also a failure', () => {
    const dir = mkdtempSync(join(tmpdir(), 'revise-nockpts-'));
    const jsonPath = join(dir, 'demo.json');
    const prPath = join(dir, 'pr.md');
    try {
      writeFileSync(jsonPath, JSON.stringify({ capture: { nonce: 'n' } }));
      const result = reviseAfterCapture(jsonPath, dir, prPath, dir, derivedInput(), 'BASE ESSENCE.', noopEmit);
      assert.equal(result.ok, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('reviseAfterCapture — idempotent', () => {
  it('kills "revise twice, sentence twice": the delta sentence appears exactly once no matter how many times revise runs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'revise-idempotent-'));
    const jsonPath = join(dir, 'demo.json');
    const prPath = join(dir, 'pr.md');
    const baseEssence = 'BASE ESSENCE — 0 work items delivered.';
    try {
      writeFileSync(jsonPath, JSON.stringify(validModel()));
      const first = reviseAfterCapture(jsonPath, dir, prPath, dir, derivedInput(), baseEssence, noopEmit);
      assert.equal(first.ok, true);
      const second = reviseAfterCapture(jsonPath, dir, prPath, dir, derivedInput(), baseEssence, noopEmit);
      assert.equal(second.ok, true);
      const finalModel = JSON.parse(readFileSync(jsonPath, 'utf8')) as DemoModel;
      const occurrences = finalModel.essence.split('No observable behaviour change was captured.').length - 1;
      assert.equal(occurrences, 1, `expected the sentence exactly once, essence was: ${finalModel.essence}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
