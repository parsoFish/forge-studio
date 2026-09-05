/**
 * Tests for `validate-flow.ts`'s trigger DECLARATION rules (R2-04, ADR-041):
 * which `on:` kinds exist, which are schema-reserved, and the `agent-complete`
 * / `projects:` requirements. The target, cron, webhook and shape rules are the
 * sibling `validate-flow-trigger-targets.test.ts`.
 *
 * Both files were split out of `apps/forge/validate.test.ts` by ruling 159's
 * retirement of `orchestrator/studio/validate.ts`, then split again to stay
 * under the 800-line cap. Fixtures are duplicated rather than shared so each
 * file reads on its own, matching the convention the original file used.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentDefinition, FlowDefinition, FlowTrigger } from '@forge/contracts/studio/types.ts';
import { TRIGGER_KIND_IDS } from '../flow-trigger.ts';
import { validateFlow } from './validate-flow.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    slug: 'my-agent',
    name: 'My Agent',
    description: 'An agent.',
    purpose: 'Do things.',
    composition: { skills: ['demo'], tools: [], mcps: [], hooks: [], guards: ['event-log'] },
    runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6' },
    brainAccess: 'none',
    interactivity: 'Fully autonomous.',
    budgets: {},
    allowedTools: [],
    disallowedTools: [],
    body: 'Process body here.',
    path: '/skills/my-agent/SKILL.md',
    ...overrides,
  };
}

function makeFlow(overrides: Partial<FlowDefinition> = {}): FlowDefinition {
  return {
    id: 'my-flow',
    name: 'My Flow',
    version: 1,
    goal: 'Do something.',
    project: null,
    kb: null,
    costCeilingUsd: 10,
    origin: 'seed',
    nodes: [
      { id: 'step-a', agent: 'my-agent' },
      { id: 'gate', gate: 'verdict' },
    ],
    edges: [{ from: 'step-a', to: 'gate', artifact: 'result' }],
    triggers: [],
    path: '/studio/flows/my-flow/flow.yaml',
    ...overrides,
  };
}

function makeAgentMap(...agents: AgentDefinition[]): ReadonlyMap<string, AgentDefinition> {
  return new Map(agents.map((a) => [a.slug, a]));
}

// ---------------------------------------------------------------------------
// validateFlow — triggers (R2-04, ADR-041)
// ---------------------------------------------------------------------------

describe('validateFlow — trigger-kind', () => {
  it('bogus "on" value → error trigger-kind', () => {
    const flow = makeFlow({
      triggers: [{ on: 'bogus', target: { kind: 'flow', ref: 'other-flow' } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-kind');
    assert.ok(f, 'expected trigger-kind finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('bogus'));
  });

  it('shipped kind ("flow-complete") → no trigger-kind finding', () => {
    const flow = makeFlow({
      triggers: [{ on: 'flow-complete', target: { kind: 'flow', ref: 'other-flow' } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    assert.ok(!findings.some((x) => x.check === 'trigger-kind'));
  });
});

describe('validateFlow — trigger-kind-reserved', () => {
  // T1 ruling (R2-08-F2 pin review): this case originally used `agent-complete`
  // as its "reserved kind" example. F2 ships that row as `status: 'shipped'`
  // (ADR-027's R2-08 amendment), so that example now asserts the OPPOSITE of
  // the ratified design. T1 explicitly ruled that the T3 test-writer amends
  // this ONE pre-existing test itself (the implementer must not — editing the
  // tests that judge your own change is exactly what the immutable-gates
  // contract prevents); the example below was swapped to `manual`, a kind
  // that stays reserved. See the new describe block below for the RED
  // acceptance criteria this swap makes room for.
  it('reserved kind (manual) → error trigger-kind-reserved', () => {
    const flow = makeFlow({
      triggers: [{ on: 'manual', target: { kind: 'agent', ref: 'my-agent' } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-kind-reserved');
    assert.ok(f, 'expected trigger-kind-reserved finding');
    assert.equal(f.level, 'error');
    assert.match(f.message, /schema-reserved/);
  });

  it('shipped kind ("merged") → no trigger-kind-reserved finding', () => {
    const flow = makeFlow({
      triggers: [{ on: 'merged', target: { kind: 'flow', ref: 'other-flow' } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    assert.ok(!findings.some((x) => x.check === 'trigger-kind-reserved'));
  });
});

/**
 * ACCEPTANCE TESTS (T3, R2-08-F2) — `agent-complete` flips reserved → shipped.
 * The `manual` case above already covers "still reserved"; `feed` is covered
 * here as the second reserved kind (kills a fix that flips the WHOLE registry
 * to shipped instead of just the one row).
 */
describe('validateFlow — trigger-kind-reserved after R2-08-F2 (agent-complete shipped)', () => {
  it('(RED) agent-complete is NO LONGER reserved once its TRIGGER_KINDS row ships → no trigger-kind-reserved finding', () => {
    const flow = makeFlow({
      triggers: [{ on: 'agent-complete', target: { kind: 'flow', ref: 'other-flow' } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()), { flowIds: new Set(['my-flow', 'other-flow']) });
    assert.ok(
      !findings.some((x) => x.check === 'trigger-kind-reserved'),
      `expected NO trigger-kind-reserved finding for agent-complete once F2 ships — got ${JSON.stringify(findings)}`,
    );
  });

  it('(green-on-arrival) feed is STILL reserved after F2 ships — kills flipping the WHOLE registry to shipped instead of just the one row', () => {
    const flow = makeFlow({
      triggers: [{ on: 'feed', target: { kind: 'agent', ref: 'my-agent' } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-kind-reserved');
    assert.ok(f, 'expected "feed" to remain schema-reserved after F2 ships');
    assert.equal(f!.level, 'error');
  });
});

/**
 * ACCEPTANCE TESTS (T3, R2-08-F3 #1) — `pr-merged` / `issue-raised` flip
 * reserved → shipped (project-event kinds over the existing webhook
 * receiver, ADR-027's R2-08-F3). Mirrors the F2 block above exactly: RED for
 * the two newly-shipped kinds, green-on-arrival for the kinds that must stay
 * reserved (kills flipping the WHOLE registry instead of just these two rows).
 */
describe('validateFlow — trigger-kind-reserved after R2-08-F3 (pr-merged / issue-raised shipped)', () => {
  // NOTE: asserting the absence of a 'trigger-kind-reserved' finding ALONE
  // would be a characterization test, not acceptance — it is trivially true
  // on 631154a1 for the WRONG reason (the kind isn't in TRIGGER_KINDS AT ALL
  // yet, so RESERVED_TRIGGER_KIND_IDS never contains it either — the same
  // "green on arrival for the wrong reason" trap this exact suite's
  // immutable-gates review has caught before). Each test below additionally
  // asserts membership in TRIGGER_KIND_IDS AND a completely clean findings
  // list for an otherwise-valid trigger, so a kind that doesn't exist at all
  // yet (today) fails on the FIRST assertion, and a kind that's still
  // schema-reserved fails on the (still-present) 'trigger-kind'/
  // 'trigger-kind-reserved' finding.
  it('(RED) pr-merged is a real, non-reserved TRIGGER_KINDS row → zero findings for an otherwise-valid trigger', () => {
    assert.ok(
      (TRIGGER_KIND_IDS as readonly string[]).includes('pr-merged'),
      'expected "pr-merged" to already be a TRIGGER_KINDS member — RED until F3 registers the row',
    );
    const flow = makeFlow({
      triggers: [{ on: 'pr-merged', target: { kind: 'flow', ref: 'other-flow' } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()), { flowIds: new Set(['my-flow', 'other-flow']) });
    assert.deepEqual(
      findings,
      [],
      `expected NO findings at all for a minimal, otherwise-valid pr-merged trigger once F3 ships — got ${JSON.stringify(findings)}`,
    );
  });

  it('(RED) issue-raised is a real, non-reserved TRIGGER_KINDS row → zero findings for an otherwise-valid trigger', () => {
    assert.ok(
      (TRIGGER_KIND_IDS as readonly string[]).includes('issue-raised'),
      'expected "issue-raised" to already be a TRIGGER_KINDS member — RED until F3 registers the row',
    );
    const flow = makeFlow({
      triggers: [{ on: 'issue-raised', target: { kind: 'flow', ref: 'other-flow' } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()), { flowIds: new Set(['my-flow', 'other-flow']) });
    assert.deepEqual(
      findings,
      [],
      `expected NO findings at all for a minimal, otherwise-valid issue-raised trigger once F3 ships — got ${JSON.stringify(findings)}`,
    );
  });

  it('(green-on-arrival) manual and feed are STILL reserved after F3 ships — kills flipping the WHOLE registry to shipped instead of just pr-merged/issue-raised', () => {
    for (const id of ['manual', 'feed']) {
      const flow = makeFlow({
        triggers: [{ on: id, target: { kind: 'agent', ref: 'my-agent' } }],
      });
      const findings = validateFlow(flow, makeAgentMap(makeAgent()));
      const f = findings.find((x) => x.check === 'trigger-kind-reserved');
      assert.ok(f, `expected "${id}" to remain schema-reserved after F3 ships`);
      assert.equal(f!.level, 'error');
    }
  });
});

/**
 * ACCEPTANCE TESTS (T3, R2-08-F2, T1 ruling #1) — `trigger-agent-complete`:
 * an `on: agent-complete` row's `agent:` field is REQUIRED. Absent must never
 * mean "fires for all" (the fail-open shape T1's ruling closed) — it is a
 * `forge studio lint` error, same `surface/enum`-family shape as
 * `trigger-projects` above (this WI's other new per-kind requiredness check).
 */
describe('validateFlow — trigger-agent-complete (R2-08-F2, T1 ruling #1)', () => {
  it('(RED) an agent-complete row with agent: absent → error trigger-agent-complete', () => {
    const flow = makeFlow({
      triggers: [{ on: 'agent-complete', target: { kind: 'flow', ref: 'other-flow' } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()), { flowIds: new Set(['my-flow', 'other-flow']) });
    const f = findings.find((x) => x.check === 'trigger-agent-complete');
    assert.ok(
      f,
      `expected a trigger-agent-complete finding for a missing "agent:" — got ${JSON.stringify(findings)}. An absent agent: must never default to "fires for all" (T1's fail-open ruling).`,
    );
    assert.equal(f!.level, 'error');
  });

  it('(green-on-arrival — vacuously true until the check exists, meaningful only paired with the RED test above) an agent-complete row WITH agent: declared → no trigger-agent-complete finding', () => {
    const flow = makeFlow({
      triggers: [
        { on: 'agent-complete', target: { kind: 'flow', ref: 'other-flow' }, agent: 'doc-updater' } as unknown as FlowTrigger,
      ],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()), { flowIds: new Set(['my-flow', 'other-flow']) });
    assert.ok(
      !findings.some((x) => x.check === 'trigger-agent-complete'),
      `expected no trigger-agent-complete finding when agent: is declared — got ${JSON.stringify(findings)}`,
    );
  });
});

/**
 * ACCEPTANCE TESTS (T3, R2-08-F1) — the `trigger-projects` lint check.
 *
 * PINNED CONTRACT: `TriggerCheckOpts` (orchestrator/studio/validate-triggers.ts)
 * gains an optional `projectIds?: ReadonlySet<string>` field — mirroring the
 * existing `flowIds` opt exactly (same shape, same "omitted ⇒ skip the check"
 * precedent already established for `flowIds`/`flowProjectOf`). `checkFlowTriggers`
 * gains a new finding, check id `trigger-projects`, `surface/enum` shape: an
 * error naming both the offending value and the full allowed set, exactly as
 * `readiness`'s `surface/enum` check does for `def.surface`. `apps/forge/studio-lint.ts`
 * already computes the exact enumeration this needs at line ~389
 * (`const projectIds = new Set(discoveredProjects.map((p) => p.id));`,
 * currently used only for the KB `binding-ref` check) — F1 threads that SAME
 * set into `validateFlow(flow, agentMap, { flowIds, flowProjectOf, projectIds })`.
 */
describe('validateFlow — trigger-projects (R2-08-F1)', () => {
  it('(RED) projects: names an id absent from the project enumeration → error trigger-projects naming the offending value AND the allowed set', () => {
    const flow = makeFlow({
      triggers: [
        {
          on: 'flow-complete',
          target: { kind: 'flow', ref: 'other-flow' },
          projects: ['ghost-project'],
        } as unknown as FlowTrigger,
      ],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()), {
      flowIds: new Set(['my-flow', 'other-flow']),
      projectIds: new Set(['betterado', 'gitpulse']),
    } as unknown as Parameters<typeof validateFlow>[2]);
    const f = findings.find((x) => x.check === 'trigger-projects');
    assert.ok(f, `expected a trigger-projects finding — got ${JSON.stringify(findings)}`);
    assert.equal(f!.level, 'error');
    assert.match(f!.message, /ghost-project/, 'message must name the offending value');
    assert.match(f!.message, /betterado/, 'message must name the allowed set (surface/enum shape)');
    assert.match(f!.message, /gitpulse/, 'message must name the allowed set (surface/enum shape)');
  });

  it('(green-on-arrival — vacuously true until the check exists, so it only becomes meaningful paired with the RED test above) a VALID project id in projects: produces no trigger-projects finding — kills a rule that errors on everything regardless of validity', () => {
    const flow = makeFlow({
      triggers: [
        {
          on: 'flow-complete',
          target: { kind: 'flow', ref: 'other-flow' },
          projects: ['gitpulse'],
        } as unknown as FlowTrigger,
      ],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()), {
      flowIds: new Set(['my-flow', 'other-flow']),
      projectIds: new Set(['betterado', 'gitpulse']),
    } as unknown as Parameters<typeof validateFlow>[2]);
    assert.ok(
      !findings.some((x) => x.check === 'trigger-projects'),
      `expected no trigger-projects finding for a valid id — got ${JSON.stringify(findings)}`,
    );
  });

  it('(green-on-arrival) omitted projectIds opt → the check is skipped, mirroring the flowIds/flowProjectOf precedent — kills a fix that throws instead of skipping for callers that have not consulted the registry', () => {
    const flow = makeFlow({
      triggers: [
        {
          on: 'flow-complete',
          target: { kind: 'flow', ref: 'other-flow' },
          projects: ['anything-goes-here'],
        } as unknown as FlowTrigger,
      ],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    assert.ok(
      !findings.some((x) => x.check === 'trigger-projects'),
      `expected no trigger-projects finding when projectIds is omitted — got ${JSON.stringify(findings)}`,
    );
  });
});

/**
 * ACCEPTANCE TESTS (T3, forge-f9g fix, W8-A1) — the R2-08 addendum
 * (2026-08-07) that made `projects:` unauthorable on `on: merged` is
 * WITHDRAWN (docs/decisions/027-studio-object-model.md, addendum dated
 * 2026-08-23). Scope is now enforced at a single structural choke point —
 * `decideTriggerProjectScope` (`orchestrator/flow-run-requests.ts`) —
 * consulted both by `drainFlowRunRequests` (the staged-request path) and by
 * `fireFlowTriggers` (`orchestrator/flow-trigger.ts`, the inline `on: merged`
 * path finalize-merged.ts drives). `on: merged` therefore now falls through
 * to the SAME shape + membership checks every other kind gets — it is no
 * longer special-cased at all.
 *
 * Check id: reuses `trigger-projects` — the SAME check id the block above
 * already uses for shape/membership. This is one more `projects:` validity
 * rule in that same family, not a new concern needing its own id.
 */
describe('validateFlow — trigger-projects on on:merged (R2-08 addendum withdrawn, 2026-08-23, WI forge-f9g)', () => {
  it('a validly-scoped on:merged trigger (real project ids) is now VALID — zero findings — the exclusion is withdrawn now that scope is enforced at a single structural choke point every dispatch mechanism passes through, inline dispatch included', () => {
    const flow = makeFlow({
      triggers: [
        { on: 'merged', target: { kind: 'flow', ref: 'other-flow' }, projects: ['gitpulse'] } as unknown as FlowTrigger,
      ],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()), {
      flowIds: new Set(['my-flow', 'other-flow']),
      projectIds: new Set(['gitpulse']),
    } as unknown as Parameters<typeof validateFlow>[2]);
    assert.deepEqual(
      findings,
      [],
      `expected zero findings for a validly-scoped on:merged trigger — got ${JSON.stringify(findings)}`,
    );
  });

  it('(green-on-arrival) an on:merged trigger with NO projects: is still perfectly valid — zero findings — kills an implementation that rejects ALL merged triggers regardless of projects:', () => {
    const flow = makeFlow({
      triggers: [{ on: 'merged', target: { kind: 'flow', ref: 'other-flow' } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()), {
      flowIds: new Set(['my-flow', 'other-flow']),
      projectIds: new Set(['gitpulse']),
    } as unknown as Parameters<typeof validateFlow>[2]);
    assert.deepEqual(
      findings,
      [],
      `expected zero findings for an unscoped on:merged trigger — got ${JSON.stringify(findings)}`,
    );
  });

  it('projects: [] on an on:merged trigger is a valid declared-empty scope, same as every other kind — zero findings (the empty array trivially satisfies both the shape and membership checks) — kills a fix that special-cases merged to still reject the empty array', () => {
    const flow = makeFlow({
      triggers: [{ on: 'merged', target: { kind: 'flow', ref: 'other-flow' }, projects: [] } as unknown as FlowTrigger],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()), {
      flowIds: new Set(['my-flow', 'other-flow']),
      projectIds: new Set(['gitpulse']),
    } as unknown as Parameters<typeof validateFlow>[2]);
    assert.deepEqual(
      findings,
      [],
      `expected zero findings for projects: [] on on:merged — got ${JSON.stringify(findings)}`,
    );
  });

  it('a malformed projects: value on an on:merged trigger emits the SAME trigger-projects shape finding every other kind gets', () => {
    const flow = makeFlow({
      triggers: [{ on: 'merged', target: { kind: 'flow', ref: 'other-flow' }, projects: 'gitpulse' } as unknown as FlowTrigger],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-projects');
    assert.ok(f, `expected a trigger-projects finding for a malformed projects: value on on:merged — got ${JSON.stringify(findings)}`);
    assert.equal(f!.level, 'error');
    assert.match(f!.message, /array of strings/i);
  });

  it('a non-member project id in projects: on an on:merged trigger emits the SAME trigger-projects membership finding every other kind gets', () => {
    const flow = makeFlow({
      triggers: [
        { on: 'merged', target: { kind: 'flow', ref: 'other-flow' }, projects: ['not-a-real-project'] } as unknown as FlowTrigger,
      ],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()), {
      flowIds: new Set(['my-flow', 'other-flow']),
      projectIds: new Set(['gitpulse']),
    } as unknown as Parameters<typeof validateFlow>[2]);
    const f = findings.find((x) => x.check === 'trigger-projects');
    assert.ok(f, `expected a trigger-projects finding for a non-member project id on on:merged — got ${JSON.stringify(findings)}`);
    assert.equal(f!.level, 'error');
    assert.match(f!.message, /not-a-real-project/);
  });

  it('projects: on EVERY shipped kind (including merged) is treated uniformly — kills a fix that keeps merged special-cased in either direction', () => {
    const cases: FlowTrigger[] = [
      {
        on: 'cron',
        target: { kind: 'flow', ref: 'other-flow' },
        schedule: '0 3 * * *',
        projects: ['gitpulse'],
      } as unknown as FlowTrigger,
      {
        on: 'webhook',
        target: { kind: 'flow', ref: 'other-flow' },
        projects: ['gitpulse'],
        webhook: {
          id: 'my-hook',
          provider: 'github',
          events: ['push'],
          secretEnv: 'MY_SECRET',
          sources: ['acme/widgets'],
        },
      } as unknown as FlowTrigger,
      { on: 'pr-merged', target: { kind: 'flow', ref: 'other-flow' }, projects: ['gitpulse'] } as unknown as FlowTrigger,
      { on: 'issue-raised', target: { kind: 'flow', ref: 'other-flow' }, projects: ['gitpulse'] } as unknown as FlowTrigger,
      {
        on: 'agent-complete',
        target: { kind: 'flow', ref: 'other-flow' },
        agent: 'some-agent',
        projects: ['gitpulse'],
      } as unknown as FlowTrigger,
      { on: 'flow-complete', target: { kind: 'flow', ref: 'other-flow' }, projects: ['gitpulse'] } as unknown as FlowTrigger,
      { on: 'merged', target: { kind: 'flow', ref: 'other-flow' }, projects: ['gitpulse'] } as unknown as FlowTrigger,
    ];
    for (const trigger of cases) {
      const flow = makeFlow({ triggers: [trigger] });
      const findings = validateFlow(flow, makeAgentMap(makeAgent()), {
        flowIds: new Set(['my-flow', 'other-flow']),
        projectIds: new Set(['gitpulse']),
      } as unknown as Parameters<typeof validateFlow>[2]);
      assert.ok(
        !findings.some((x) => x.check === 'trigger-projects'),
        `expected on:"${trigger.on}" with a validly-scoped, real-project projects: to be finding-free — got ${JSON.stringify(findings)}`,
      );
    }
  });
});
