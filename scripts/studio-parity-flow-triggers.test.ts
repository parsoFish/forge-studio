/**
 * Parity check — ADR 046 boundary fix (`studio-beyond-contracts` edge 4:
 * `apps/studio/tests/contract/studio-client.test.ts` used to import
 * `packages/flows/studio/validate-triggers.ts`'s `checkFlowTriggers`
 * directly, which apps/studio tests may no longer do — see
 * `docs/roadmaps/1.0.md` §0, "apps/studio imports contracts only").
 *
 * WHAT THIS PROVES (zyc review finding 1): a `pr-merged` / `issue-raised`
 * trigger built through the real UI client path — `buildTriggerDeclaration`,
 * `apps/studio/lib/studio-client.ts` — is one the server's real SSOT
 * validator, `checkFlowTriggers`, actually accepts (a trigger with no
 * `webhook.id` can never be addressed by `packages/flows/bridge-hooks.ts`'s
 * `findWebhookTrigger`, so this is a genuine route-works-means-feature-works
 * check, not just a shape asserted by eye).
 *
 * WHY A RECONSTRUCTED LITERAL, NOT A LIVE CALL TO `buildTriggerDeclaration`.
 * This checker's OTHER parity fixes (e.g. `scripts/studio-parity-session-kinds
 * .test.ts`) import the studio mirror module directly, same as this file
 * imports the package SSOT below — but `apps/studio/lib/studio-client.ts`'s
 * own transitive imports (`./bridge-client`, `./session-client`, …) are
 * Next.js/bundler-style EXTENSIONLESS specifiers, which plain
 * `node --experimental-strip-types` cannot resolve (confirmed: importing it
 * directly throws `Cannot find module '.../bridge-client'`) without a custom
 * ESM loader hook this fix does not add. The two literals below are instead
 * BYTE-IDENTICAL to what `apps/studio/tests/contract/studio-client.test.ts`
 * independently pins `buildTriggerDeclaration` to produce for the SAME
 * inputs (its `expect(trigger?.webhook).toEqual({...})` assertion for
 * pr-merged, the target-construction invariant `{kind:'flow', ref:
 * fields.targetId}` pinned across many sibling `toEqual` assertions in that
 * same file for `targetId: 'forge-develop'`, and `expect(trigger?.webhook?.id)
 * .toBe('myproj-issue-raised')` for the issue-raised companion). Nothing is
 * weakened: a future change to either `buildTriggerDeclaration`'s output
 * shape or `checkFlowTriggers`'s acceptance rules still fails loudly — the
 * studio-side test on one side, this one on the other — exactly as the
 * single removed test did before the boundary fix.
 *
 * RUN: node --test --experimental-strip-types scripts/studio-parity-flow-triggers.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkFlowTriggers } from '../packages/flows/studio/validate-triggers.ts';
import type { AgentDefinition, FlowDefinition, FlowTrigger } from '@forge/contracts';

function flowWithTrigger(trigger: FlowTrigger): FlowDefinition {
  return {
    id: 'flow-a',
    name: 'Flow A',
    version: 1,
    goal: '',
    project: 'demo-project',
    kb: null,
    costCeilingUsd: 0,
    origin: 'studio',
    accepts: ['code'],
    nodes: [],
    edges: [],
    triggers: [trigger],
    path: '/dev/null/flow.yaml',
  };
}

const CHECK_OPTS = { flowIds: new Set(['flow-a', 'forge-develop']), flowProjectOf: () => 'demo-project' };

test('RED (zyc finding 1): a pr-merged trigger built via the real client path is one validate-triggers.ts actually accepts (webhook.id present, zero lint findings)', () => {
  // byte-identical to buildTriggerDeclaration('pr-merged', {targetId:
  // 'forge-develop', webhookId: 'myproj-pr-merged', webhookProvider:
  // 'github', webhookEvents: ['pull_request'], webhookSecretEnv:
  // 'MYPROJ_WEBHOOK_SECRET', webhookSources: 'parsoFish/myproj'}) — pinned in
  // apps/studio/tests/contract/studio-client.test.ts.
  const trigger: FlowTrigger = {
    on: 'pr-merged',
    target: { kind: 'flow', ref: 'forge-develop' },
    webhook: {
      id: 'myproj-pr-merged',
      provider: 'github',
      events: ['pull_request'],
      secretEnv: 'MYPROJ_WEBHOOK_SECRET',
      sources: ['parsoFish/myproj'],
    },
  };
  const findings = checkFlowTriggers(flowWithTrigger(trigger), new Map<string, AgentDefinition>(), CHECK_OPTS);
  assert.deepEqual(findings, []);
});

test('companion (zyc finding 1): issue-raised builds the SAME real webhook shape (the sibling kind, not just pr-merged)', () => {
  // byte-identical to buildTriggerDeclaration('issue-raised', {targetId:
  // 'forge-develop', webhookId: 'myproj-issue-raised', webhookProvider:
  // 'github', webhookEvents: ['issues'], webhookSecretEnv:
  // 'MYPROJ_WEBHOOK_SECRET', webhookSources: 'parsoFish/myproj'}) — pinned in
  // apps/studio/tests/contract/studio-client.test.ts.
  const trigger: FlowTrigger = {
    on: 'issue-raised',
    target: { kind: 'flow', ref: 'forge-develop' },
    webhook: {
      id: 'myproj-issue-raised',
      provider: 'github',
      events: ['issues'],
      secretEnv: 'MYPROJ_WEBHOOK_SECRET',
      sources: ['parsoFish/myproj'],
    },
  };
  const findings = checkFlowTriggers(flowWithTrigger(trigger), new Map<string, AgentDefinition>(), CHECK_OPTS);
  assert.deepEqual(findings, []);
});
