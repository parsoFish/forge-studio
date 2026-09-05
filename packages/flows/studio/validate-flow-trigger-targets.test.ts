/**
 * Tests for `validate-flow.ts`'s trigger TARGET rules (R2-04, ADR-041): the
 * `target: {kind, ref}` shape and its self-loop check, the cron expression, the
 * webhook provider/event matrix, and the per-kind `trigger-shape` requirements.
 * Which `on:` kinds exist at all is the sibling `validate-flow-triggers.test.ts`.
 *
 * Both files were split out of `apps/forge/validate.test.ts` by ruling 159's
 * retirement of `orchestrator/studio/validate.ts`, then split again to stay
 * under the 800-line cap. Fixtures are duplicated rather than shared so each
 * file reads on its own, matching the convention the original file used.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentDefinition, FlowDefinition } from '@forge/contracts/studio/types.ts';
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
// validateFlow — trigger targets, cron, webhook and shape (R2-04, ADR-041)
// ---------------------------------------------------------------------------

describe('validateFlow — trigger-target', () => {
  it('flow target referencing its own flow → error trigger-target (self-loop)', () => {
    const flow = makeFlow({
      id: 'my-flow',
      triggers: [{ on: 'flow-complete', target: { kind: 'flow', ref: 'my-flow' } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-target');
    assert.ok(f, 'expected trigger-target finding');
    assert.equal(f.level, 'error');
    assert.match(f.message, /self-loop/);
  });

  it('flow target referencing an unregistered flow (flowIds provided) → error trigger-target', () => {
    const flow = makeFlow({
      triggers: [{ on: 'flow-complete', target: { kind: 'flow', ref: 'ghost-flow' } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()), { flowIds: new Set(['my-flow']) });
    const f = findings.find((x) => x.check === 'trigger-target');
    assert.ok(f, 'expected trigger-target finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('ghost-flow'));
  });

  it('flow target referencing an unregistered flow WITHOUT flowIds → no trigger-target finding (opts is optional)', () => {
    const flow = makeFlow({
      triggers: [{ on: 'flow-complete', target: { kind: 'flow', ref: 'ghost-flow' } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    assert.ok(!findings.some((x) => x.check === 'trigger-target'));
  });

  it('agent target referencing an unknown agent → error trigger-target', () => {
    const flow = makeFlow({
      triggers: [{ on: 'merged', target: { kind: 'agent', ref: 'ghost-agent' } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-target');
    assert.ok(f, 'expected trigger-target finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('ghost-agent'));
  });

  it('on:merged agent target with the reflection-close band → no trigger-target finding', () => {
    const reflectAgent = makeAgent({
      composition: { skills: ['demo'], tools: [], mcps: [], hooks: [], guards: ['event-log', 'reflection-close'] },
    });
    const flow = makeFlow({
      triggers: [{ on: 'merged', target: { kind: 'agent', ref: 'my-agent' } }],
    });
    const findings = validateFlow(flow, makeAgentMap(reflectAgent));
    assert.ok(!findings.some((x) => x.check === 'trigger-target'));
  });

  it('R4-09-F1: on:merged agent target WITHOUT the reflection-close band → error trigger-target', () => {
    // makeAgent's default guards are ['event-log'] — no reflection-close band —
    // so finalize-merged would never dispatch it; lint must reject it.
    const flow = makeFlow({
      triggers: [{ on: 'merged', target: { kind: 'agent', ref: 'my-agent' } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-target');
    assert.ok(f, 'expected trigger-target finding');
    assert.equal(f.level, 'error');
    assert.match(f.message, /reflection-close/);
  });

  it('flow target referencing a real registered flow → no trigger-target finding', () => {
    const flow = makeFlow({
      triggers: [{ on: 'flow-complete', target: { kind: 'flow', ref: 'other-flow' } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()), {
      flowIds: new Set(['my-flow', 'other-flow']),
    });
    assert.ok(!findings.some((x) => x.check === 'trigger-target'));
  });

  it('trigger missing "target" entirely (hand-crafted PUT body) → error trigger-target, no thrown TypeError', () => {
    const flow = makeFlow({
      triggers: [{ on: 'merged' } as any],
    });
    assert.doesNotThrow(() => validateFlow(flow, makeAgentMap(makeAgent())));
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-target');
    assert.ok(f, 'expected trigger-target finding');
    assert.equal(f.level, 'error');
    assert.match(f.message, /missing a well-formed/);
  });
});

describe('validateFlow — trigger-cron', () => {
  const validCron = () => ({
    on: 'cron' as const,
    target: { kind: 'flow' as const, ref: 'other-flow' },
    schedule: '0 0 * * *',
    concurrency: 'forbid' as const,
  });

  it('missing schedule → error trigger-cron', () => {
    const t = validCron();
    const flow = makeFlow({
      project: 'gitpulse',
      triggers: [{ ...t, schedule: undefined }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-cron');
    assert.ok(f, 'expected trigger-cron finding');
    assert.equal(f.level, 'error');
    assert.match(f.message, /schedule/);
  });

  it('unparseable schedule pattern → error trigger-cron', () => {
    const flow = makeFlow({
      project: 'gitpulse',
      triggers: [{ ...validCron(), schedule: 'not a cron pattern' }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-cron');
    assert.ok(f, 'expected trigger-cron finding');
    assert.equal(f.level, 'error');
  });

  it('concurrency "replace" → error trigger-cron (enum-reserved)', () => {
    const flow = makeFlow({
      project: 'gitpulse',
      triggers: [{ ...validCron(), concurrency: 'replace' }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-cron');
    assert.ok(f, 'expected trigger-cron finding');
    assert.equal(f.level, 'error');
    assert.match(f.message, /enum-reserved/);
  });

  it('TARGET flow has no project → error trigger-cron (ADR-041: the mint uses the target flow project)', () => {
    // validCron targets `other-flow`; the DECLARING flow's project is irrelevant.
    const flow = makeFlow({ project: 'someproj', triggers: [validCron()] });
    const flowProjectOf = (id: string) => (id === 'other-flow' ? null : 'someproj');
    const findings = validateFlow(flow, makeAgentMap(makeAgent()), { flowProjectOf });
    const f = findings.find((x) => x.check === 'trigger-cron');
    assert.ok(f, 'expected trigger-cron finding');
    assert.equal(f.level, 'error');
    assert.match(f.message, /project/);
  });

  it('target flow HAS a project → no trigger-cron project finding (declaring flow project null is fine)', () => {
    const flow = makeFlow({ project: null, triggers: [validCron()] });
    const flowProjectOf = (id: string) => (id === 'other-flow' ? 'someproj' : null);
    const findings = validateFlow(flow, makeAgentMap(makeAgent()), { flowProjectOf });
    assert.equal(findings.filter((x) => x.check === 'trigger-cron' && /project/.test(x.message)).length, 0);
  });

  it('no flowProjectOf supplied → project check skipped (single-flow PUT without registry)', () => {
    const flow = makeFlow({ project: null, triggers: [validCron()] });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    assert.equal(findings.filter((x) => x.check === 'trigger-cron' && /project/.test(x.message)).length, 0);
  });

  it('fully-valid cron trigger → no trigger-cron finding', () => {
    const flow = makeFlow({
      project: 'gitpulse',
      triggers: [validCron()],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    assert.ok(!findings.some((x) => x.check === 'trigger-cron'));
  });
});

describe('validateFlow — trigger-webhook', () => {
  const validWebhook = () => ({
    on: 'webhook' as const,
    target: { kind: 'flow' as const, ref: 'other-flow' },
    webhook: {
      id: 'push-hook',
      provider: 'github' as const,
      events: ['push' as const],
      secretEnv: 'WEBHOOK_SECRET',
      sources: ['org/repo'],
    },
  });

  it('missing webhook block → error trigger-webhook', () => {
    const flow = makeFlow({
      project: 'gitpulse',
      triggers: [{ on: 'webhook', target: { kind: 'flow', ref: 'other-flow' } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-webhook');
    assert.ok(f, 'expected trigger-webhook finding');
    assert.equal(f.level, 'error');
    assert.match(f.message, /webhook/);
  });

  it('bad id slug → error trigger-webhook', () => {
    const t = validWebhook();
    const flow = makeFlow({
      project: 'gitpulse',
      triggers: [{ ...t, webhook: { ...t.webhook, id: 'Push_Hook' } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-webhook');
    assert.ok(f, 'expected trigger-webhook finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('Push_Hook'));
  });

  it('bad provider → error trigger-webhook', () => {
    const t = validWebhook();
    const flow = makeFlow({
      project: 'gitpulse',
      triggers: [{ ...t, webhook: { ...t.webhook, provider: 'bitbucket' as never } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-webhook');
    assert.ok(f, 'expected trigger-webhook finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('bitbucket'));
  });

  it('provider typo ("gitllab") is preserved, not silently coerced to "github" → error trigger-webhook matching /provider/', () => {
    const t = validWebhook();
    const flow = makeFlow({
      project: 'gitpulse',
      triggers: [{ ...t, webhook: { ...t.webhook, provider: 'gitllab' as any } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-webhook' && /provider/.test(x.message));
    assert.ok(f, 'expected trigger-webhook provider finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('gitllab'));
  });

  it('empty events → error trigger-webhook', () => {
    const t = validWebhook();
    const flow = makeFlow({
      project: 'gitpulse',
      triggers: [{ ...t, webhook: { ...t.webhook, events: [] } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-webhook');
    assert.ok(f, 'expected trigger-webhook finding');
    assert.equal(f.level, 'error');
    assert.match(f.message, /events/);
  });

  it('bad secretEnv (lowercase) → error trigger-webhook', () => {
    const t = validWebhook();
    const flow = makeFlow({
      project: 'gitpulse',
      triggers: [{ ...t, webhook: { ...t.webhook, secretEnv: 'webhook_secret' } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-webhook');
    assert.ok(f, 'expected trigger-webhook finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('webhook_secret'));
  });

  it('bad secretEnvPrevious (lowercase) → error trigger-webhook', () => {
    const t = validWebhook();
    const flow = makeFlow({
      project: 'gitpulse',
      triggers: [{ ...t, webhook: { ...t.webhook, secretEnvPrevious: 'old_secret' } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-webhook');
    assert.ok(f, 'expected trigger-webhook finding');
    assert.equal(f.level, 'error');
    assert.ok(f.message.includes('old_secret'));
  });

  it('empty sources → error trigger-webhook', () => {
    const t = validWebhook();
    const flow = makeFlow({
      project: 'gitpulse',
      triggers: [{ ...t, webhook: { ...t.webhook, sources: [] } }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-webhook');
    assert.ok(f, 'expected trigger-webhook finding');
    assert.equal(f.level, 'error');
    assert.match(f.message, /sources/);
  });

  it('TARGET flow has no project → error trigger-webhook (ADR-041: the mint uses the target flow project)', () => {
    const flow = makeFlow({ project: 'someproj', triggers: [validWebhook()] });
    const flowProjectOf = (id: string) => (id === 'other-flow' ? null : 'someproj');
    const findings = validateFlow(flow, makeAgentMap(makeAgent()), { flowProjectOf });
    const f = findings.find((x) => x.check === 'trigger-webhook');
    assert.ok(f, 'expected trigger-webhook finding');
    assert.equal(f.level, 'error');
    assert.match(f.message, /project/);
  });

  it('webhook target flow HAS a project → no trigger-webhook project finding', () => {
    const flow = makeFlow({ project: null, triggers: [validWebhook()] });
    const flowProjectOf = (id: string) => (id === 'other-flow' ? 'someproj' : null);
    const findings = validateFlow(flow, makeAgentMap(makeAgent()), { flowProjectOf });
    assert.equal(findings.filter((x) => x.check === 'trigger-webhook' && /project/.test(x.message)).length, 0);
  });

  it('fully-valid webhook trigger → no trigger-webhook finding', () => {
    const flow = makeFlow({
      project: 'gitpulse',
      triggers: [validWebhook()],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    assert.ok(!findings.some((x) => x.check === 'trigger-webhook'));
  });

  // trigger-webhook-unique (cross-flow id uniqueness) is enforced in
  // apps/forge/studio-lint.ts, which sees the full flow roster — validateFlow only
  // sees one flow at a time and cannot check it.
});

describe('validateFlow — trigger-shape', () => {
  it('cron fields on a flow-complete trigger → error trigger-shape (naming both stray fields)', () => {
    const flow = makeFlow({
      triggers: [
        {
          on: 'flow-complete',
          target: { kind: 'flow', ref: 'other-flow' },
          schedule: '0 0 * * *',
          concurrency: 'forbid',
        },
      ],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const shapeFindings = findings.filter((x) => x.check === 'trigger-shape');
    assert.ok(shapeFindings.length >= 2, 'expected both stray schedule and concurrency findings');
    assert.ok(shapeFindings.every((f) => f.level === 'error'));
    assert.ok(shapeFindings.some((f) => f.message.includes('schedule')));
    assert.ok(shapeFindings.some((f) => f.message.includes('concurrency')));
  });

  it('webhook block on a non-webhook trigger → error trigger-shape', () => {
    const flow = makeFlow({
      triggers: [
        {
          on: 'flow-complete',
          target: { kind: 'flow', ref: 'other-flow' },
          webhook: {
            id: 'push-hook',
            provider: 'github',
            events: ['push'],
            secretEnv: 'WEBHOOK_SECRET',
            sources: ['org/repo'],
          },
        },
      ],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-shape');
    assert.ok(f, 'expected trigger-shape finding');
    assert.equal(f.level, 'error');
    assert.match(f.message, /webhook/);
  });

  // R4-09-F3 — the reflect `mode` field
  const reflectAgent = () =>
    makeAgent({ composition: { skills: ['demo'], tools: [], mcps: [], hooks: [], guards: ['event-log', 'reflection-close'] } });

  it('mode: automated on an on:merged reflect-agent target → no trigger-mode/shape finding', () => {
    const flow = makeFlow({
      triggers: [{ on: 'merged', target: { kind: 'agent', ref: 'my-agent' }, mode: 'automated' }],
    });
    const findings = validateFlow(flow, makeAgentMap(reflectAgent()));
    assert.ok(!findings.some((x) => x.check === 'trigger-mode' || x.check === 'trigger-shape'), `unexpected finding: ${JSON.stringify(findings)}`);
  });

  it('an invalid mode value → error trigger-mode', () => {
    const flow = makeFlow({
      triggers: [{ on: 'merged', target: { kind: 'agent', ref: 'my-agent' }, mode: 'bogus' as never }],
    });
    const findings = validateFlow(flow, makeAgentMap(reflectAgent()));
    const f = findings.find((x) => x.check === 'trigger-mode');
    assert.ok(f, 'expected trigger-mode finding');
    assert.equal(f.level, 'error');
    assert.match(f.message, /interactive\|automated/);
  });

  it('mode on a non-merged / non-agent trigger → error trigger-shape', () => {
    const flow = makeFlow({
      triggers: [{ on: 'flow-complete', target: { kind: 'flow', ref: 'other-flow' }, mode: 'automated' }],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    const f = findings.find((x) => x.check === 'trigger-shape' && /mode/.test(x.message));
    assert.ok(f, 'expected trigger-shape finding for stray mode');
    assert.equal(f.level, 'error');
  });

  it('schedule/concurrency on cron, webhook block on webhook → no trigger-shape finding', () => {
    const flow = makeFlow({
      project: 'gitpulse',
      triggers: [
        {
          on: 'cron',
          target: { kind: 'flow', ref: 'other-flow' },
          schedule: '0 0 * * *',
          concurrency: 'forbid',
        },
        {
          on: 'webhook',
          target: { kind: 'flow', ref: 'other-flow' },
          webhook: {
            id: 'push-hook',
            provider: 'github',
            events: ['push'],
            secretEnv: 'WEBHOOK_SECRET',
            sources: ['org/repo'],
          },
        },
      ],
    });
    const findings = validateFlow(flow, makeAgentMap(makeAgent()));
    assert.ok(!findings.some((x) => x.check === 'trigger-shape'));
  });
});
