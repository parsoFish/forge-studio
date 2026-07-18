/**
 * Tests for `agent-readiness.ts` — the /agents/[id] ReadinessPanel's pure
 * check-list computation (R2-02-F4).
 *
 * The `runtime` check and the `interactive` fact are sourced from the
 * server-computed F1 capability descriptor (`AgentCapabilityDescriptor`,
 * threaded onto the wire by GET /api/studio/agents + GET /api/studio/starters
 * and carried through verbatim by `parseAgentDefinition` — see
 * forge-ui/lib/studio-client.ts) — never re-derived from the client
 * `AgentRuntime` form state. That client re-derivation
 * (`runtimeConfigured(rt)`: sdk truthy + model/range chosen) was the exact
 * "hardcoded heuristic" the R2-02-F4 AC replaces. The content-completeness
 * checks (purpose/skill/hook/process/interactivity) are real readiness
 * signals independent of the descriptor and stay as direct field checks.
 */
import { test, expect } from 'vitest';

import { computeReadinessChecks, capabilityInteractive } from './agent-readiness';
import type { AgentCapabilityDescriptor } from './studio-client';

const FULL_CONTENT = {
  purpose: 'Decompose initiatives.',
  skills: ['brain-query'],
  hooks: ['event-log'],
  process: '# Project Manager\n...',
  interactivity: 'Fully autonomous; never blocks on the operator.',
};

const READY_CAPABILITY: AgentCapabilityDescriptor = { interactive: false, runtimeSdks: ['claude'] };

test('computeReadinessChecks: all 6 checks ok when content complete + descriptor has >=1 runtime SDK', () => {
  const checks = computeReadinessChecks({ ...FULL_CONTENT, capability: READY_CAPABILITY });
  expect(checks).toHaveLength(6);
  expect(checks.every((c) => c.ok)).toBe(true);
  expect(checks.map((c) => c.key)).toEqual(['purpose', 'skill', 'hook', 'process', 'interactivity', 'runtime']);
});

test('computeReadinessChecks: runtime check fails when capability.runtimeSdks is empty (descriptor fact, not client-derived)', () => {
  const checks = computeReadinessChecks({ ...FULL_CONTENT, capability: { interactive: false, runtimeSdks: [] } });
  expect(checks.find((c) => c.key === 'runtime')?.ok).toBe(false);
});

test('computeReadinessChecks: runtime check fails when capability is undefined (descriptor not yet loaded/saved)', () => {
  const checks = computeReadinessChecks({ ...FULL_CONTENT, capability: undefined });
  expect(checks.find((c) => c.key === 'runtime')?.ok).toBe(false);
});

test('computeReadinessChecks: content-completeness checks stay independent of the descriptor', () => {
  const checks = computeReadinessChecks({
    purpose: '',
    skills: [],
    hooks: [],
    process: '',
    interactivity: '',
    capability: READY_CAPABILITY, // descriptor fully ready, but content is empty
  });
  expect(checks.filter((c) => c.ok)).toHaveLength(1); // only 'runtime' passes
  expect(checks.find((c) => c.key === 'runtime')?.ok).toBe(true);
  expect(checks.find((c) => c.key === 'purpose')?.ok).toBe(false);
});

test('capabilityInteractive: reflects capability.interactive when present (informational, not a pass/fail gate)', () => {
  expect(capabilityInteractive({ interactive: true, runtimeSdks: ['claude'] })).toBe(true);
  expect(capabilityInteractive({ interactive: false, runtimeSdks: ['claude'] })).toBe(false);
});

test('capabilityInteractive: defaults to false when the descriptor has not loaded yet', () => {
  expect(capabilityInteractive(undefined)).toBe(false);
});
