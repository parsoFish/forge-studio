/**
 * Tests for orchestrator/release-process.ts — the pure release helpers.
 *
 * The opt-in invariant (a project without `releaseProcess` is byte-for-byte
 * unchanged) reduces to: every helper returns an empty result on `undefined`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { releaseDraftAcs, releaseFinalizeSteps, hasReleaseProcess } from './release-process.ts';
import type { ReleaseConfig } from './studio/types.ts';

const FULL: ReleaseConfig = {
  changelogPath: 'docs/CHANGELOG.md',
  versionFile: 'VERSION',
  docsDir: 'docs',
  steps: [
    { kind: 'changelog', phase: 'in-cycle', text: 'draft an Unreleased entry' },
    { kind: 'docs', phase: 'pre-merge', text: 'regen docs', command: ['make', 'docs'] },
    { kind: 'version', phase: 'pre-merge', text: 'bump version' },
  ],
};

test('releaseDraftAcs: undefined → [] (opt-out is byte-stable)', () => {
  assert.deepEqual(releaseDraftAcs(undefined), []);
});

test('releaseDraftAcs: no in-cycle changelog step → []', () => {
  const cfg: ReleaseConfig = { steps: [{ kind: 'version', phase: 'pre-merge', text: 'bump' }] };
  assert.deepEqual(releaseDraftAcs(cfg), []);
});

test('releaseDraftAcs: in-cycle changelog step → draft AC mentioning the changelog path + step text', () => {
  const acs = releaseDraftAcs(FULL);
  assert.ok(acs.length >= 2, 'a header AC + per-step AC');
  assert.ok(acs.some((a) => a.includes('DRAFT CHANGELOG') && a.includes('docs/CHANGELOG.md')));
  assert.ok(acs.some((a) => a.includes('draft an Unreleased entry')));
  // The pre-merge steps must NOT leak into the WI-level draft ACs.
  assert.ok(!acs.some((a) => a.includes('regen docs') || a.includes('bump version')));
});

test('releaseDraftAcs: default changelog path when omitted', () => {
  const cfg: ReleaseConfig = { steps: [{ kind: 'changelog', phase: 'in-cycle', text: 'draft' }] };
  assert.ok(releaseDraftAcs(cfg).some((a) => a.includes('CHANGELOG.md')));
});

test('releaseFinalizeSteps: undefined → []', () => {
  assert.deepEqual(releaseFinalizeSteps(undefined), []);
});

test('releaseFinalizeSteps: returns only pre-merge steps in order', () => {
  const steps = releaseFinalizeSteps(FULL);
  assert.equal(steps.length, 2);
  assert.deepEqual(steps.map((s) => s.kind), ['docs', 'version']);
  assert.ok(steps.every((s) => s.phase === 'pre-merge'));
});

test('hasReleaseProcess: undefined → false; a config with steps → true', () => {
  assert.equal(hasReleaseProcess(undefined), false);
  assert.equal(hasReleaseProcess(FULL), true);
});
