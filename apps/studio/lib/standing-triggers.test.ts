/**
 * Acceptance tests (R6-01 WI-4, the parked R6-04 rider) for a NEW pure
 * module, `./standing-triggers.ts`, that does not exist yet — every import
 * below is a legitimate RED (module not found) until the implementer
 * creates it with the exact exports this file names.
 *
 * SOURCE OF TRUTH: `GET /api/triggers` (handler `apps/forge/bridge-studio.ts:552-
 * 577`, exercised at the wire by `apps/forge/bridge-studio-triggers.test.ts`)
 * returns `{ triggers: {on, target:{kind,ref}, projects: string[]|null,
 * sourceFlowId}[] }`. `target.kind` is `'flow' | 'agent'`
 * (`forge-ui/lib/studio-client.ts`'s `TriggerTarget`). Confirmed against
 * the LIVE seed roster (`studio/flows/forge-develop/flow.yaml:54`):
 *
 *   triggers:
 *     - { on: merged, target: { kind: agent, ref: reflector } }
 *
 * ...i.e. today exactly ONE real standing trigger targets an agent
 * (`reflector`, `on: 'merged'`, no `projects:` key so `projects: null` on
 * the wire, `sourceFlowId: 'forge-develop'`). `forge-architect` declares
 * `triggers: []`.
 *
 * ASSUMED EXPORTS from `./standing-triggers.ts`:
 *
 *   export type StandingTrigger = {
 *     on: string;
 *     target: { kind: 'flow' | 'agent'; ref: string };
 *     projects: string[] | null;
 *     sourceFlowId: string;
 *   };
 *
 *   export function standingTriggersForAgent(
 *     agentSlug: string,
 *     triggers: StandingTrigger[],
 *   ): StandingTrigger[]
 *
 * RUN: npx vitest run lib/standing-triggers.test.ts   (from forge-ui/)
 */

import { test, expect } from 'vitest';
import { standingTriggersForAgent, type StandingTrigger } from './standing-triggers.ts';

function trig(overrides: Partial<StandingTrigger> & { target: StandingTrigger['target'] }): StandingTrigger {
  return {
    on: 'merged',
    projects: null,
    sourceFlowId: 'forge-develop',
    ...overrides,
  };
}

test('a trigger whose target is this agent is returned — the real seeded case (reflector, on:merged, sourceFlowId:forge-develop)', () => {
  const triggers: StandingTrigger[] = [
    trig({ target: { kind: 'agent', ref: 'reflector' } }),
  ];
  const result = standingTriggersForAgent('reflector', triggers);
  expect(result).toHaveLength(1);
  expect(result[0].target.ref).toBe('reflector');
});

test('a FLOW-targeted trigger sharing the same ref string is excluded — kills a selector matching on `target.ref` alone without also checking `target.kind === "agent"`', () => {
  const triggers: StandingTrigger[] = [
    trig({ on: 'flow-complete', target: { kind: 'flow', ref: 'reflector' } }),
  ];
  const result = standingTriggersForAgent('reflector', triggers);
  expect(result).toHaveLength(0);
});

test('a trigger whose sourceFlowId equals the agent slug but whose target.ref differs is excluded — kills a selector that matches on `sourceFlowId` instead of `target.ref`', () => {
  const triggers: StandingTrigger[] = [
    trig({ target: { kind: 'agent', ref: 'demo-agent' }, sourceFlowId: 'reflector' }),
  ];
  const result = standingTriggersForAgent('reflector', triggers);
  expect(result).toHaveLength(0);
});

test('a similarly-named agent ref is excluded by substring — kills loose/substring matching of the slug (e.g. `ref.includes(agentSlug)` or `agentSlug.includes(ref)`)', () => {
  const triggers: StandingTrigger[] = [
    trig({ target: { kind: 'agent', ref: 'reflector-v2' } }),
    trig({ target: { kind: 'agent', ref: 'reflect' } }),
  ];
  const result = standingTriggersForAgent('reflector', triggers);
  expect(result).toHaveLength(0);
});

test('an unrelated agent-targeted trigger for a different slug is excluded, and only the matching one is returned when both are present', () => {
  const triggers: StandingTrigger[] = [
    trig({ target: { kind: 'agent', ref: 'reflector' }, on: 'merged' }),
    trig({ target: { kind: 'agent', ref: 'demo-agent' }, on: 'flow-complete', sourceFlowId: 'forge-other' }),
  ];
  const result = standingTriggersForAgent('reflector', triggers);
  expect(result).toHaveLength(1);
  expect(result[0].on).toBe('merged');
});

test('no triggers at all returns an empty array, never throws — kills an implementation that assumes at least one match exists', () => {
  const result = standingTriggersForAgent('reflector', []);
  expect(result).toEqual([]);
});
