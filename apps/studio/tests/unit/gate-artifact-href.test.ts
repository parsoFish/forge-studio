/**
 * `forge-8vfn.7.6.62` — the run page had no link to its own pending gate, and
 * the two surfaces that DID carry one hardcoded `type=verdict` for ANY gated
 * run, so a plan-gated architect run was sent to a review verdict that does not
 * exist for it.
 *
 * THE BUG IS A NAMING COLLISION, and these tests pin both halves of it.
 * `run.gate` (`packages/flows/run-view-types.ts:110`) is a NODE ID, "derived
 * from the run's own events (G9)". `node.gate`
 * (`packages/contracts/studio-types.ts:161`) is the GATE KIND — `plan` or
 * `verdict`. Two fields, same name, different meanings. `RunRail.tsx:293` held
 * only `flowId?: string` and no flow definition, so it had a node id with
 * nothing to resolve it against: hardcoding was the only thing it COULD do.
 *
 * So the helper takes BOTH, and RETURNS NULL rather than guessing. Guessing is
 * what produced the defect; a missing link is honest, a wrong link sends the
 * operator to an artifact their run does not have.
 *
 * Gate kinds are real, not invented for the test: `studio/flows/
 * forge-architect/flow.yaml:10` is `{ id: architect, agent: architect,
 * gate: plan }` and `forge-develop/flow.yaml:39` is `{ id: review,
 * gate: verdict }`.
 *
 * RUN: npx vitest run tests/unit/gate-artifact-href.test.ts   (from apps/studio/)
 */

import { test, expect } from 'vitest';
import { gateArtifactHref } from '@/lib/gate-artifact-href';
import type { Flow, Run } from '@/lib/studio-client';

const develop = {
  id: 'forge-develop',
  nodes: [{ id: 'develop' }, { id: 'review', gate: 'verdict' }],
} as unknown as Flow;

const architect = {
  id: 'forge-architect',
  nodes: [{ id: 'architect', agent: 'architect', gate: 'plan' }],
} as unknown as Flow;

function run(over: Partial<Run> = {}): Run {
  return { id: 'CYCLE-1', status: 'gated', gate: 'review', ...over } as unknown as Run;
}

test('a verdict-gated develop run resolves its own kind — not a hardcoded one', () => {
  const got = gateArtifactHref(run(), develop);
  expect(got).toEqual({
    href: '/artifact?run=CYCLE-1&type=verdict&mode=gate',
    gateType: 'verdict',
    gateNode: 'review',
  });
});

test('THE DEFECT: a PLAN-gated architect run resolves type=plan, where both surfaces used to say verdict', () => {
  const got = gateArtifactHref(run({ gate: 'architect' } as Partial<Run>), architect);
  expect(got?.gateType).toBe('plan');
  expect(got?.href).toBe('/artifact?run=CYCLE-1&type=plan&mode=gate');
});

test('a run that is not gated has no gate link — presence is itself the assertion', () => {
  // Every OTHER member of RunStatus (`lib/studio-client.ts:46`), by name rather
  // than a sample: an invented value would typecheck as a cast and prove nothing.
  for (const status of ['planned', 'active', 'complete', 'failed'] as const) {
    expect(gateArtifactHref(run({ status }), develop), status).toBeNull();
  }
});

test('NULL RATHER THAN A GUESS when the flow is unavailable — the whole point of the bead', () => {
  // RunRail's case before this change: a node id and nothing to resolve it
  // against. It answered `verdict`; the honest answer is "I cannot say".
  expect(gateArtifactHref(run(), null)).toBeNull();
});

test('null rather than a guess when the parked node carries no gate kind, or is not in the flow', () => {
  const gateless = { id: 'f', nodes: [{ id: 'review' }] } as unknown as Flow;
  expect(gateArtifactHref(run(), gateless)).toBeNull();
  expect(gateArtifactHref(run({ gate: 'nowhere' } as Partial<Run>), develop)).toBeNull();
});

test('a gated run with no parked node id resolves nothing — `gate` is how the node is known', () => {
  expect(gateArtifactHref(run({ gate: undefined } as Partial<Run>), develop)).toBeNull();
});

test('the run id is URL-encoded — cycle ids carry colons and slashes in other shapes', () => {
  const got = gateArtifactHref(run({ id: 'a/b:c' } as Partial<Run>), develop);
  expect(got?.href).toBe('/artifact?run=a%2Fb%3Ac&type=verdict&mode=gate');
});

test('a null run resolves nothing rather than throwing — the page renders before its run arrives', () => {
  expect(gateArtifactHref(null, develop)).toBeNull();
});
