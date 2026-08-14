/**
 * Pure-logic tests for `./contract-resolution-view.ts` — extracted from
 * `ContractResolutionPanel.tsx` (Stage D guided contract resolution) so the
 * two decisions this pass makes honest are independently unit-testable
 * without a browser (no jsdom in this repo; mirrors the established
 * `run-panel-view.ts` convention: pure logic extracted, unit-tested here,
 * then thinly wired into JSX).
 *
 * RED-first: both `./contract-resolution-view.ts` and its exports
 * (`agentResolveLabel`, `brainFixHref`) do not exist yet — every test below
 * is a legitimate RED (module not found) until the implementer creates it.
 *
 * WHY these two functions:
 *   1. `agentResolveLabel` — the agent-tier "resolve" button today claims
 *      "Resolve with agent" for every route, but NONE of the three agent
 *      routes (instructions/demo-builder/brain-fix) actually runs an agent
 *      from that click — each just navigates the operator to the matching
 *      builder (or the Knowledge tab) to drive it themselves. The label
 *      must be honest per route, never claim "with agent".
 *   2. `brainFixHref` — the brain-fix route previously only set a dead
 *      text message and discarded the response. Per-project Brain-3 KBs
 *      declare `id: <projectId>` in their own kb.yaml (ADR 035 — every
 *      `brain/projects/<name>/kb.yaml` sets `id: <name>`), so the KB id is
 *      derivable straight from the projectId already in scope — the href
 *      must point at that KB's health tab.
 *
 * RUN: npx vitest run lib/contract-resolution-view.test.ts   (from forge-ui/)
 */

import { test, expect } from 'vitest';
import { agentResolveLabel, brainFixHref } from './contract-resolution-view';

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
// brainFixHref — derives the per-project Brain-3 KB id from the projectId
// already in scope (never a fabricated id, never a second lookup)
// ---------------------------------------------------------------------------

test('brainFixHref: points at /knowledge?id=<projectId>&tab=health', () => {
  expect(brainFixHref('gitpulse')).toBe('/knowledge?id=gitpulse&tab=health');
});

test('brainFixHref: URI-encodes the projectId (never trusts it as a raw query fragment)', () => {
  expect(brainFixHref('a b')).toBe('/knowledge?id=a%20b&tab=health');
});
