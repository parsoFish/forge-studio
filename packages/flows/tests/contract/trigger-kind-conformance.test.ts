/**
 * §7.1 release-definition gap — "every extension seam is a registry with a
 * conformance test". `TriggerKindId`'s registry is `TRIGGER_KINDS`
 * (`packages/contracts/index.ts`, ADR-041). Until this file, its only test
 * was a studio UI mirror-parity test (`apps/studio/tests/contract/trigger-kind-parity.test.ts`)
 * — nothing proved the SERVER side actually wires each row to a real runtime
 * path. This file does, for EVERY row, DERIVED from the table itself (never
 * a hand-copied id list) so a new row that ships without runtime wiring reds
 * here instead of silently shipping a dead declaration:
 *
 *   1. a `shipped` kind is ACCEPTED by the flow validator
 *      (`packages/flows/studio/validate-triggers.ts`'s `checkFlowTriggers`) for a
 *      minimal, otherwise-valid declaration of that kind;
 *   2. that same `shipped` kind is actually DISPATCHED by its real runtime
 *      handler — `fireFlowTriggers` (flow-complete/merged),
 *      `fireAgentCompleteTriggers` (agent-complete), `syncCronTriggers`
 *      (cron), or the real `/api/hooks/:hookId` receiver `handleHookRoutes`
 *      (webhook/pr-merged/issue-raised) — driven end to end, not mocked;
 *   3. a `reserved` kind is REJECTED by validation with the ADR-041
 *      `trigger-kind-reserved` error code (no runtime stub);
 *   4. none of the four runtime mechanisms above dispatches a kind id that
 *      is not in the table at all (a bogus `on:` value reaches none of them).
 *
 * Mutation check (recorded in /home/parso/m7-e-trigger-mutation.txt): flipping
 * one shipped row's `status` to `reserved`, or adding a fake extra shipped
 * row, in a local copy of the registry reds this file — the per-kind
 * expectations below are DERIVED from `TRIGGER_KINDS` at require-time, not
 * pinned as a literal array.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TRIGGER_KINDS } from '@forge/contracts';
import type { AgentDefinition, FlowDefinition, FlowTrigger } from '@forge/contracts';
import { checkFlowTriggers } from '../../studio/validate-triggers.ts';
import { fireFlowTriggers, fireAgentCompleteTriggers, WEBHOOK_FAMILY_KIND_IDS } from '../../flow-trigger.ts';
import { syncCronTriggers, stopAllCronTriggers } from '../../cron-triggers.ts';
import { handleHookRoutes, type HookRoutesContext } from '../../bridge-hooks.ts';
import { flowRunsDir } from '../../flow-run-requests.ts';

// ---------------------------------------------------------------------------
// Fixture helpers (mirrors packages/flows/studio/validate-flow-triggers.test.ts)
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

const REFLECT_AGENT = makeAgent({
  slug: 'reflect-agent',
  composition: { skills: ['demo'], tools: [], mcps: [], hooks: [], guards: ['event-log', 'reflection-close'] },
});

function makeFlow(overrides: Partial<FlowDefinition> = {}): FlowDefinition {
  return {
    id: 'declaring-flow',
    name: 'Declaring Flow',
    version: 1,
    goal: 'Test fixture.',
    project: null,
    kb: null,
    costCeilingUsd: 10,
    origin: 'seed',
    accepts: ['code'],
    nodes: [{ id: 'step-a', agent: 'my-agent' }],
    edges: [],
    triggers: [],
    path: '/studio/flows/declaring-flow/flow.yaml',
    ...overrides,
  } as FlowDefinition;
}

const AGENTS = new Map([
  [makeAgent().slug, makeAgent()],
  [REFLECT_AGENT.slug, REFLECT_AGENT],
]);

const VALID_OPTS = {
  flowIds: new Set(['declaring-flow', 'other-flow']),
  flowProjectOf: (id: string) => (id === 'other-flow' ? 'demo-project' : null),
  projectIds: new Set(['demo-project']),
};

// ---------------------------------------------------------------------------
// Per-kind minimal VALID declaration — the one piece of per-kind knowledge
// this file cannot derive from the registry (each kind's own config shape is
// not itself data in TRIGGER_KINDS). Exercised against checkFlowTriggers for
// the acceptance half, and against the kind's real runtime mechanism for the
// dispatch half.
// ---------------------------------------------------------------------------

function minimalValidTrigger(id: string): FlowTrigger {
  switch (id) {
    case 'flow-complete':
      return { on: id, target: { kind: 'flow', ref: 'other-flow' } } as FlowTrigger;
    case 'merged':
      return { on: id, target: { kind: 'agent', ref: 'reflect-agent' } } as FlowTrigger;
    case 'agent-complete':
      return { on: id, target: { kind: 'flow', ref: 'other-flow' }, agent: 'developer-ralph' } as FlowTrigger;
    case 'cron':
      return {
        on: id,
        target: { kind: 'flow', ref: 'other-flow' },
        schedule: '0 0 * * *',
        concurrency: 'forbid',
      } as FlowTrigger;
    case 'webhook':
      return {
        on: id,
        target: { kind: 'flow', ref: 'other-flow' },
        webhook: {
          id: 'conformance-webhook',
          provider: 'github',
          events: ['push'],
          secretEnv: 'CONFORMANCE_WEBHOOK_SECRET',
          sources: ['acme/widgets'],
        },
      } as FlowTrigger;
    case 'pr-merged':
      return {
        on: id,
        target: { kind: 'flow', ref: 'other-flow' },
        webhook: {
          id: 'conformance-pr-merged',
          provider: 'github',
          events: ['pull_request'],
          secretEnv: 'CONFORMANCE_PR_MERGED_SECRET',
          sources: ['acme/widgets'],
        },
      } as FlowTrigger;
    case 'issue-raised':
      return {
        on: id,
        target: { kind: 'flow', ref: 'other-flow' },
        webhook: {
          id: 'conformance-issue-raised',
          provider: 'github',
          events: ['issues'],
          secretEnv: 'CONFORMANCE_ISSUE_RAISED_SECRET',
          sources: ['acme/widgets'],
        },
      } as FlowTrigger;
    default:
      throw new Error(`minimalValidTrigger: no fixture builder for shipped kind "${id}" — add one`);
  }
}

// ---------------------------------------------------------------------------
// 1. DERIVED expectation: every `shipped` row is accepted by the validator.
// ---------------------------------------------------------------------------

for (const row of TRIGGER_KINDS.filter((k) => k.status === 'shipped')) {
  test(`[trigger-kind-conformance] shipped kind "${row.id}" — minimal declaration passes validation (no trigger-kind / trigger-kind-reserved finding)`, () => {
    const flow = makeFlow({ triggers: [minimalValidTrigger(row.id)] });
    const findings = checkFlowTriggers(flow, AGENTS, VALID_OPTS);
    assert.equal(
      findings.filter((f) => f.check === 'trigger-kind' || f.check === 'trigger-kind-reserved').length,
      0,
      `expected zero trigger-kind/trigger-kind-reserved findings for shipped kind "${row.id}" — got ${JSON.stringify(findings)}`,
    );
  });
}

// ---------------------------------------------------------------------------
// 2. DERIVED expectation: every `reserved` row is rejected with the ADR-041
//    error code, and ONLY that code (the id itself is a known registry
//    member, so `trigger-kind` must NOT also fire).
// ---------------------------------------------------------------------------

for (const row of TRIGGER_KINDS.filter((k) => k.status === 'reserved')) {
  test(`[trigger-kind-conformance] reserved kind "${row.id}" — rejected with trigger-kind-reserved, no runtime stub`, () => {
    const flow = makeFlow({
      triggers: [{ on: row.id, target: { kind: 'flow', ref: 'other-flow' } } as FlowTrigger],
    });
    const findings = checkFlowTriggers(flow, AGENTS, VALID_OPTS);
    assert.ok(
      findings.some((f) => f.check === 'trigger-kind-reserved'),
      `expected a trigger-kind-reserved finding for reserved kind "${row.id}" — got ${JSON.stringify(findings)}`,
    );
    assert.ok(
      !findings.some((f) => f.check === 'trigger-kind'),
      `reserved kind "${row.id}" is a KNOWN registry id — must not also raise "trigger-kind" (unknown value) — got ${JSON.stringify(findings)}`,
    );
  });
}

// ---------------------------------------------------------------------------
// 3. Runtime handler/dispatcher proof, per shipped kind family — real
//    functions, real side effects (staged files / armed cron jobs / HTTP
//    202s), never mocked.
// ---------------------------------------------------------------------------

function tmpRoot(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

// --- lifecycle kinds: flow-complete, merged — fireFlowTriggers -------------

for (const id of ['flow-complete', 'merged'] as const) {
  if (!TRIGGER_KINDS.some((k) => k.id === id && k.status === 'shipped')) continue;
  test(`[trigger-kind-conformance] "${id}" dispatches via fireFlowTriggers`, async () => {
    let dispatched = false;
    const trigger = minimalValidTrigger(id);
    const fired = await fireFlowTriggers({ id: 'declaring-flow', triggers: [trigger] }, id, {
      dispatch: () => { dispatched = true; },
    });
    assert.equal(dispatched, true, `fireFlowTriggers never dispatched a shipped "${id}" trigger`);
    assert.deepEqual(fired, [trigger]);
  });
}

// --- agent-complete — fireAgentCompleteTriggers (real stage to disk) -------

test('[trigger-kind-conformance] "agent-complete" dispatches via fireAgentCompleteTriggers (real staged request)', async () => {
  const queueRoot = tmpRoot('trigger-conformance-agent-complete-');
  try {
    const trigger = minimalValidTrigger('agent-complete');
    const fired = await fireAgentCompleteTriggers(
      [{ id: 'declaring-flow', triggers: [trigger] }],
      'developer-ralph',
      { queueRoot },
    );
    assert.deepEqual(fired, [trigger]);
    const staged = readdirSync(flowRunsDir(queueRoot)).filter((f) => f.endsWith('.json'));
    assert.equal(staged.length, 1, 'expected exactly one staged flow-run request file');
  } finally {
    rmSync(queueRoot, { recursive: true, force: true });
  }
});

// --- cron — syncCronTriggers (real arm against a temp forgeRoot) -----------

test('[trigger-kind-conformance] "cron" dispatches via syncCronTriggers (real armed job)', () => {
  const forgeRoot = tmpRoot('trigger-conformance-cron-');
  const armed = new Map();
  try {
    const dir = join(forgeRoot, 'studio', 'flows', 'cron-fixture-flow');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'flow.yaml'),
      [
        'id: cron-fixture-flow',
        'name: Cron Fixture Flow',
        'version: 1',
        'goal: fixture',
        'project: null',
        'kb: null',
        'costCeilingUsd: 5',
        'origin: seed',
        'accepts: [code]',
        'nodes:',
        '  - { id: only, agent: developer-ralph }',
        'edges: []',
        'triggers:',
        "  - { on: cron, schedule: '0 0 1 1 *', target: { kind: flow, ref: other-flow } }",
        '',
      ].join('\n'),
    );
    const result = syncCronTriggers({ forgeRoot, armed });
    assert.equal(result.armed.length, 1, 'expected the declared cron trigger to be armed');
    assert.equal(armed.size, 1);
  } finally {
    stopAllCronTriggers(armed);
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// --- webhook family — handleHookRoutes (real HTTP receiver, real HMAC) -----

function githubSig(secret: string, payload: string): string {
  return `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
}

/** Spin a bare http server wrapping handleHookRoutes — no apps/forge import
 *  (packages may not depend on apps); the real receiver, driven for real. */
async function withHookServer(
  ctx: HookRoutesContext,
  run: (url: string) => Promise<void>,
): Promise<void> {
  const server: Server = createServer((req, res) => {
    void handleHookRoutes(req, res, ctx, req.url ?? '/', req.method ?? 'GET').then((handled) => {
      if (!handled) { res.writeHead(404); res.end(); }
    });
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a bound TCP address');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }
}

function writeWebhookFixtureFlow(forgeRoot: string, trigger: FlowTrigger): void {
  const webhook = trigger.webhook!;
  const dir = join(forgeRoot, 'studio', 'flows', 'webhook-fixture-flow');
  mkdirSync(dir, { recursive: true });
  const targetDir = join(forgeRoot, 'studio', 'flows', 'other-flow');
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(
    join(targetDir, 'flow.yaml'),
    ['id: other-flow', 'name: Other Flow', 'version: 1', 'goal: fixture', 'project: null', 'kb: null',
      'costCeilingUsd: 5', 'origin: seed', 'accepts: [code]', 'nodes:', '  - { id: only, agent: developer-ralph }',
      'edges: []', 'triggers: []', ''].join('\n'),
  );
  writeFileSync(
    join(dir, 'flow.yaml'),
    [
      'id: webhook-fixture-flow',
      'name: Webhook Fixture Flow',
      'version: 1',
      'goal: fixture',
      'project: null',
      'kb: null',
      'costCeilingUsd: 5',
      'origin: seed',
      'accepts: [code]',
      'nodes:',
      '  - { id: only, agent: developer-ralph }',
      'edges: []',
      'triggers:',
      `  - on: ${trigger.on}`,
      '    target: { kind: flow, ref: other-flow }',
      '    webhook:',
      `      id: ${webhook.id}`,
      `      provider: ${webhook.provider}`,
      `      events: [${webhook.events.join(', ')}]`,
      `      secretEnv: ${webhook.secretEnv}`,
      '      sources:',
      `        - acme/widgets`,
      '',
    ].join('\n'),
  );
}

const WEBHOOK_FAMILY_FIXTURES: Record<string, { headerEvent: string; body: Record<string, unknown> }> = {
  webhook: {
    headerEvent: 'push',
    body: {
      repository: { full_name: 'acme/widgets' },
      ref: 'refs/heads/main',
      after: 'a'.repeat(40),
      pusher: { name: 'octocat' },
      commits: [{ message: 'first commit' }],
      head_commit: { message: 'feat: conformance fixture' },
    },
  },
  'pr-merged': {
    headerEvent: 'pull_request',
    body: {
      action: 'closed',
      repository: { full_name: 'acme/widgets' },
      pull_request: {
        number: 1,
        title: 'Conformance fixture PR',
        body: 'fixture',
        merged: true,
        head: { ref: 'feature/x', sha: 'a'.repeat(40) },
        base: { ref: 'main' },
        user: { login: 'octocat' },
      },
    },
  },
  'issue-raised': {
    headerEvent: 'issues',
    body: {
      action: 'opened',
      repository: { full_name: 'acme/widgets' },
      issue: { number: 1, title: 'Conformance fixture issue', body: 'fixture', user: { login: 'octocat' } },
    },
  },
};

for (const kindId of WEBHOOK_FAMILY_KIND_IDS) {
  const fixture = WEBHOOK_FAMILY_FIXTURES[kindId];
  test(`[trigger-kind-conformance] "${kindId}" dispatches via the real /api/hooks/:hookId receiver (stages a real request)`, async () => {
    const trigger = minimalValidTrigger(kindId);
    const secretEnv = trigger.webhook!.secretEnv;
    const secret = 'conformance-secret';
    const saved = process.env[secretEnv];
    process.env[secretEnv] = secret;
    const forgeRoot = tmpRoot('trigger-conformance-webhook-');
    const queueRoot = join(forgeRoot, '_queue');
    try {
      writeWebhookFixtureFlow(forgeRoot, trigger);
      const ctx: HookRoutesContext = { forgeRoot, queueRoot, logsRoot: join(forgeRoot, '_logs') };
      await withHookServer(ctx, async (url) => {
        const raw = JSON.stringify(fixture.body);
        const res = await fetch(`${url}/api/hooks/${trigger.webhook!.id}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            [`x-github-event`]: fixture.headerEvent,
            'x-hub-signature-256': githubSig(secret, raw),
          },
          body: raw,
        });
        const json = (await res.json()) as { ok?: boolean; staged?: boolean };
        assert.equal(res.status, 202, `expected 202 for a real "${kindId}" delivery — got ${res.status}: ${JSON.stringify(json)}`);
        assert.equal(json.staged, true);
      });
      const staged = readdirSync(flowRunsDir(queueRoot)).filter((f) => f.endsWith('.json'));
      assert.equal(staged.length, 1, `expected exactly one staged flow-run request for "${kindId}"`);
    } finally {
      if (saved === undefined) delete process.env[secretEnv]; else process.env[secretEnv] = saved;
      rmSync(forgeRoot, { recursive: true, force: true });
    }
  });
}

// ---------------------------------------------------------------------------
// 4. No runtime mechanism dispatches a kind id that is NOT in the table —
//    a bogus `on:` value reaches none of the four dispatch surfaces.
// ---------------------------------------------------------------------------

const BOGUS_KIND = 'totally-not-a-real-trigger-kind';

test('[trigger-kind-conformance] a kind id absent from TRIGGER_KINDS reaches no runtime mechanism', async () => {
  assert.ok(
    !TRIGGER_KINDS.some((k) => (k.id as string) === BOGUS_KIND),
    'test setup error: BOGUS_KIND must not collide with a real registry id',
  );

  // fireFlowTriggers: event matching is a string compare against `on` — a
  // bogus `on` never matches a real FlowTriggerEvent.
  let lifecycleDispatched = false;
  await fireFlowTriggers(
    { id: 'declaring-flow', triggers: [{ on: BOGUS_KIND, target: { kind: 'flow', ref: 'other-flow' } } as FlowTrigger] },
    'flow-complete',
    { dispatch: () => { lifecycleDispatched = true; } },
  );
  assert.equal(lifecycleDispatched, false);

  // fireAgentCompleteTriggers: only `on === 'agent-complete'` rows are scanned.
  const agentQueueRoot = tmpRoot('trigger-conformance-bogus-agent-');
  try {
    const fired = await fireAgentCompleteTriggers(
      [{ id: 'declaring-flow', triggers: [{ on: BOGUS_KIND, target: { kind: 'flow', ref: 'other-flow' }, agent: 'developer-ralph' } as FlowTrigger] }],
      'developer-ralph',
      { queueRoot: agentQueueRoot },
    );
    assert.deepEqual(fired, []);
  } finally {
    rmSync(agentQueueRoot, { recursive: true, force: true });
  }

  // syncCronTriggers: only `on === 'cron'` rows are scanned, even with a
  // valid schedule.
  const cronForgeRoot = tmpRoot('trigger-conformance-bogus-cron-');
  const armed = new Map();
  try {
    const dir = join(cronForgeRoot, 'studio', 'flows', 'bogus-cron-flow');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'flow.yaml'),
      [
        'id: bogus-cron-flow', 'name: Bogus Cron Flow', 'version: 1', 'goal: fixture', 'project: null', 'kb: null',
        'costCeilingUsd: 5', 'origin: seed', 'accepts: [code]', 'nodes:', '  - { id: only, agent: developer-ralph }',
        'edges: []', 'triggers:', `  - { on: ${BOGUS_KIND}, schedule: '0 0 1 1 *', target: { kind: flow, ref: other-flow } }`, '',
      ].join('\n'),
    );
    const result = syncCronTriggers({ forgeRoot: cronForgeRoot, armed });
    assert.equal(result.armed.length, 0, 'a bogus kind id must never be armed as a cron job');
  } finally {
    stopAllCronTriggers(armed);
    rmSync(cronForgeRoot, { recursive: true, force: true });
  }

  // webhook receiver: findWebhookTrigger matches on WEBHOOK_FAMILY_KIND_IDS —
  // a bogus kind with an otherwise-identical webhook block is never found,
  // regardless of hookId, and the route 404s rather than staging anything.
  const webhookForgeRoot = tmpRoot('trigger-conformance-bogus-webhook-');
  const queueRoot = join(webhookForgeRoot, '_queue');
  const secretEnv = 'CONFORMANCE_BOGUS_WEBHOOK_SECRET';
  const secret = 'conformance-secret';
  const saved = process.env[secretEnv];
  process.env[secretEnv] = secret;
  try {
    writeWebhookFixtureFlow(webhookForgeRoot, {
      on: BOGUS_KIND,
      target: { kind: 'flow', ref: 'other-flow' },
      webhook: {
        id: 'bogus-kind-hook',
        provider: 'github',
        events: ['push'],
        secretEnv,
        sources: ['acme/widgets'],
      },
    } as FlowTrigger);
    const ctx: HookRoutesContext = { forgeRoot: webhookForgeRoot, queueRoot, logsRoot: join(webhookForgeRoot, '_logs') };
    await withHookServer(ctx, async (url) => {
      const raw = JSON.stringify({ repository: { full_name: 'acme/widgets' } });
      const res = await fetch(`${url}/api/hooks/bogus-kind-hook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-github-event': 'push', 'x-hub-signature-256': githubSig(secret, raw) },
        body: raw,
      });
      assert.equal(res.status, 404, 'a webhook declared under a bogus (non-registry) kind must never resolve');
    });
  } finally {
    if (saved === undefined) delete process.env[secretEnv]; else process.env[secretEnv] = saved;
    rmSync(webhookForgeRoot, { recursive: true, force: true });
  }
});
