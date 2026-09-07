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
 * checks (purpose/skill/guard/process/interactivity) are real readiness
 * signals independent of the descriptor and stay as direct field checks.
 */
import { test, expect } from 'vitest';

import { computeReadinessChecks, capabilityInteractive } from './agent-readiness';
import type { AgentCapabilityDescriptor } from './studio-client';

const FULL_CONTENT = {
  purpose: 'Decompose initiatives.',
  skills: ['brain-query'],
  guards: ['event-log'],
  process: '# Project Manager\n...',
  interactivity: 'Fully autonomous; never blocks on the operator.',
};

const READY_CAPABILITY: AgentCapabilityDescriptor = { interactive: false, runtimeSdks: ['claude'], fanoutCapable: false };

test('computeReadinessChecks: all 7 checks ready when content complete + descriptor has >=1 runtime SDK + every bound connection is ready', () => {
  const checks = computeReadinessChecks({ ...FULL_CONTENT, capability: READY_CAPABILITY, connectionsUnready: [] });
  expect(checks).toHaveLength(7);
  expect(checks.every((c) => c.state === 'ready')).toBe(true);
  expect(checks.map((c) => c.key)).toEqual(['purpose', 'skill', 'guard', 'process', 'interactivity', 'runtime', 'connections']);
});

// ---------------------------------------------------------------------------
// Rulings 400 + 410 (T1 M6) — the check LIST is closed and its length never
// moves; `state` replaces `ok` because a check has THREE answers, not two.
//
// Measured on S5 beat 9 (`_1.0/reports/m6-d-S5-1.log`, 2026-09-07):
// `data-ready-count: expected "6", got "7"`. The panel APPENDED the
// `connections` check only once `connectionsUnready` was defined, so the
// number of checks moved with whether the agent happened to have a tool
// bound — and the DOM's count moved with it. A bound that moves with what it
// measures measures nothing, and no harness or screen reader can assert it.
// The check is now always NAMED; what varies is its STATE, carried on the
// check itself where a reader can see it.
//
// `pending` is why this is not a one-word change. `connectionsUnready:
// undefined` means "the connections fetch has not resolved yet" — neither
// ready nor not-ready. The old code was RIGHT to refuse to fabricate either
// answer; its mistake was expressing that refusal by dropping the row, which
// moved the count. Both halves are kept: the row is always there, and while
// the fetch is unresolved it says so in its own words.
//
// Ruling 410 fixes the DOM split: `data-ready-count` KEEPS its meaning (how
// many checks pass) so `scripts/journeys/connections.mjs`'s CONN-3 assertion
// stays true, and the stable total arrives as a NEW attribute. Redefining a
// live attribute would have made every existing reader silently wrong.
// ---------------------------------------------------------------------------

test('computeReadinessChecks: the connections check is ALWAYS named — the list length does not move with whether a tool is bound (rulings 400/410)', () => {
  const unresolved = computeReadinessChecks({ ...FULL_CONTENT, capability: READY_CAPABILITY });
  const resolvedReady = computeReadinessChecks({ ...FULL_CONTENT, capability: READY_CAPABILITY, connectionsUnready: [] });
  const resolvedUnready = computeReadinessChecks({
    ...FULL_CONTENT,
    capability: READY_CAPABILITY,
    connectionsUnready: [{ id: 'memory', kind: 'mcp', state: 'not-installed' }],
  });

  for (const checks of [unresolved, resolvedReady, resolvedUnready]) {
    expect(checks).toHaveLength(7);
    expect(checks.map((c) => c.key)).toEqual(['purpose', 'skill', 'guard', 'process', 'interactivity', 'runtime', 'connections']);
  }
});

test('computeReadinessChecks: an unresolved connections fetch reads "pending" — never fabricated as ready or not-ready', () => {
  const connections = computeReadinessChecks({ ...FULL_CONTENT, capability: READY_CAPABILITY })
    .find((c) => c.key === 'connections');
  expect(connections?.state).toBe('pending');
  expect(connections?.detail).toBeUndefined();
});

test('computeReadinessChecks: a resolved-and-empty connections fetch reads "ready"', () => {
  const checks = computeReadinessChecks({ ...FULL_CONTENT, capability: READY_CAPABILITY, connectionsUnready: [] });
  expect(checks.find((c) => c.key === 'connections')?.state).toBe('ready');
});

test('computeReadinessChecks: an unready bound connection reads "not-ready" and its detail names the component, not the agent', () => {
  const connections = computeReadinessChecks({
    ...FULL_CONTENT,
    capability: READY_CAPABILITY,
    connectionsUnready: [{ id: 'memory', kind: 'mcp', state: 'not-installed' }],
  }).find((c) => c.key === 'connections');
  expect(connections?.state).toBe('not-ready');
  expect(connections?.detail).toContain('memory');
});

test('computeReadinessChecks: runtime check fails when capability.runtimeSdks is empty (descriptor fact, not client-derived)', () => {
  const checks = computeReadinessChecks({ ...FULL_CONTENT, capability: { interactive: false, runtimeSdks: [], fanoutCapable: false } });
  expect(checks.find((c) => c.key === 'runtime')?.state).toBe('not-ready');
});

test('computeReadinessChecks: runtime check fails when capability is undefined (descriptor not yet loaded/saved)', () => {
  const checks = computeReadinessChecks({ ...FULL_CONTENT, capability: undefined });
  expect(checks.find((c) => c.key === 'runtime')?.state).toBe('not-ready');
});

test('computeReadinessChecks: content-completeness checks stay independent of the descriptor', () => {
  const checks = computeReadinessChecks({
    purpose: '',
    skills: [],
    guards: [],
    process: '',
    interactivity: '',
    capability: READY_CAPABILITY, // descriptor fully ready, but content is empty
  });
  expect(checks.filter((c) => c.state === 'ready')).toHaveLength(1); // only 'runtime' passes
  expect(checks.find((c) => c.key === 'runtime')?.state).toBe('ready');
  expect(checks.find((c) => c.key === 'purpose')?.state).toBe('not-ready');
});

test('capabilityInteractive: reflects capability.interactive when present (informational, not a pass/fail gate)', () => {
  expect(capabilityInteractive({ interactive: true, runtimeSdks: ['claude'], fanoutCapable: false })).toBe(true);
  expect(capabilityInteractive({ interactive: false, runtimeSdks: ['claude'], fanoutCapable: false })).toBe(false);
});

test('capabilityInteractive: defaults to false when the descriptor has not loaded yet', () => {
  expect(capabilityInteractive(undefined)).toBe(false);
});
