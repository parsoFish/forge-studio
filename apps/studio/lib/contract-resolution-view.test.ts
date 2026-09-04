/**
 * Pure-logic tests for `./contract-resolution-view.ts` — extracted from
 * `ContractResolutionPanel.tsx` (Stage D guided contract resolution) so the
 * decisions this pass makes honest are independently unit-testable without
 * a browser (no jsdom in this repo; mirrors the established
 * `run-panel-view.ts` convention: pure logic extracted, unit-tested here,
 * then thinly wired into JSX).
 *
 * WHY these functions:
 *   1. `agentResolveLabel` — the agent-tier "resolve" button used to claim
 *      "Resolve with agent" for every route, but NONE of the three agent
 *      routes (instructions/demo-builder/brain-fix) actually runs an agent
 *      from that click — each just navigates the operator to the matching
 *      builder (or the Knowledge tab) to drive it themselves. The label
 *      must be honest per route, never claim "with agent".
 *   2. `brainFixHref` — the brain-fix route previously only set a dead
 *      text message and discarded the response. It takes a REAL, bound KB
 *      id — NEVER derived from the project id: a project's KB binding is
 *      operator-rebindable (`KbBind`'s select) and can be null
 *      (`apps/forge/bridge-studio-writes.ts` deliberately leaves it unbound when
 *      no KB seed landed), so id-equals-projectId is only ever the DEFAULT
 *      a fresh scaffold happens to create, never a guarantee. Guessing
 *      wrong here is not a broken link: `/knowledge`'s own `?id=`
 *      resolution silently falls back to the first KB in the list when the
 *      given id doesn't match a real one — a WRONG KB renders with no
 *      indication anything went wrong. `brainFixHref` therefore takes
 *      whatever real kb id the caller already has in scope; it does no
 *      derivation of its own.
 *   3. `isAgentRouteBlocked` / `BRAIN_FIX_UNBOUND_HINT` — the honest
 *      alternative to guessing: when brain-fix has no real bound KB to
 *      point at, the caller must disable the action and say why, not
 *      navigate to a guess.
 *
 * RUN: npx vitest run lib/contract-resolution-view.test.ts   (from forge-ui/)
 */

import { test, expect } from 'vitest';
import {
  agentResolveLabel,
  brainFixHref,
  isAgentRouteBlocked,
  BRAIN_FIX_UNBOUND_HINT,
} from './contract-resolution-view';

// ---------------------------------------------------------------------------
// agentResolveLabel — honest per-route label (kills: "Resolve with agent"
// literal, and a route-blind generic label that can't tell instructions from
// demo-builder from brain-fix)
// ---------------------------------------------------------------------------

test('agentResolveLabel: instructions route says it opens the instructions builder', () => {
  const label = agentResolveLabel('instructions');
  expect(label.toLowerCase()).toContain('instructions');
  expect(label).not.toMatch(/with agent/i);
});

test('agentResolveLabel: demo-builder route says it opens the demo builder', () => {
  const label = agentResolveLabel('demo-builder');
  expect(label.toLowerCase()).toContain('demo');
  expect(label).not.toMatch(/with agent/i);
});

test('agentResolveLabel: brain-fix route says it opens Knowledge, not a fake "resolve"', () => {
  const label = agentResolveLabel('brain-fix');
  expect(label.toLowerCase()).toContain('knowledge');
  expect(label).not.toMatch(/with agent/i);
});

test('agentResolveLabel: the three real agent routes each get a DISTINCT label — no route-blind generic fallback wins by accident', () => {
  const labels = new Set([
    agentResolveLabel('instructions'),
    agentResolveLabel('demo-builder'),
    agentResolveLabel('brain-fix'),
  ]);
  expect(labels.size).toBe(3);
});

test('agentResolveLabel: an absent route (should never happen for a real agent-tier clause) still returns a non-empty, honest label — never "Resolve with agent"', () => {
  const label = agentResolveLabel(undefined);
  expect(label.length).toBeGreaterThan(0);
  expect(label).not.toMatch(/with agent/i);
});

// ---------------------------------------------------------------------------
// brainFixHref — builds the href for a REAL kb id the caller already holds;
// it performs no id derivation and carries no opinion about where that id
// came from (kills: any implementation that re-derives an id from a
// projectId argument instead of taking the caller's real one verbatim)
// ---------------------------------------------------------------------------

test('brainFixHref: points at /knowledge?id=<kbId>&tab=health', () => {
  expect(brainFixHref('some-other-kb')).toBe('/knowledge?id=some-other-kb&tab=health');
});

test('brainFixHref: a kb id that happens to differ from any project id is passed through unchanged — never re-derived', () => {
  // Regression: an earlier version hardcoded kbId === projectId. A KB is
  // operator-rebindable to ANY kb (KbBind.tsx), so the two routinely differ.
  expect(brainFixHref('unrelated-kb-42')).toBe('/knowledge?id=unrelated-kb-42&tab=health');
});

test('brainFixHref: URI-encodes the kb id (never trusts it as a raw query fragment)', () => {
  expect(brainFixHref('a b')).toBe('/knowledge?id=a%20b&tab=health');
});

// ---------------------------------------------------------------------------
// isAgentRouteBlocked / BRAIN_FIX_UNBOUND_HINT — the honest disabled state
// when brain-fix has no real KB to point at
// ---------------------------------------------------------------------------

test('isAgentRouteBlocked: brain-fix with no bound KB (null) is blocked', () => {
  expect(isAgentRouteBlocked('brain-fix', null)).toBe(true);
});

test('isAgentRouteBlocked: brain-fix WITH a bound KB id is not blocked', () => {
  expect(isAgentRouteBlocked('brain-fix', 'gitpulse')).toBe(false);
});

test('isAgentRouteBlocked: instructions/demo-builder are never blocked, bound KB or not — they don\'t depend on a KB binding', () => {
  expect(isAgentRouteBlocked('instructions', null)).toBe(false);
  expect(isAgentRouteBlocked('demo-builder', null)).toBe(false);
  expect(isAgentRouteBlocked('instructions', 'some-kb')).toBe(false);
});

test('BRAIN_FIX_UNBOUND_HINT: names the real cause and the real fix, not a generic error', () => {
  expect(BRAIN_FIX_UNBOUND_HINT.toLowerCase()).toContain('kb');
  expect(BRAIN_FIX_UNBOUND_HINT.toLowerCase()).toContain('knowledge');
});
