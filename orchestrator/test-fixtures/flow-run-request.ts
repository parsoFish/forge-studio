/**
 * forge-76y — test-only `FlowRunRequest` fixture builders.
 *
 * Every hand-built `FlowRunRequest` literal a test file writes is a
 * fixture-parity risk: a literal that omits a field a REAL staging site
 * always sets can silently exercise a code path (e.g.
 * `mint-triggered-initiative.ts`'s `deriveTriggerFields`) with an
 * unrealistic shape, hiding gaps or forcing production code to grow a
 * fallback that no real caller needs (see the round-2 finding documented in
 * `orchestrator/trigger-provenance.test.ts`). These builders close that gap
 * by mirroring each real staging site's shape exactly, so fixtures drift
 * with production instead of away from it.
 *
 * Real staging sites mirrored (T1 ruling, forge-76y):
 *  - cron:           orchestrator/cron-triggers.ts:154-172 (`makeFireFn`)
 *  - webhook:         cli/bridge-hooks.ts:373-394 (the `/api/hooks/:hookId` route)
 *  - agent-complete:  orchestrator/flow-trigger.ts:149-166 (`fireAgentCompleteTriggers`)
 *
 * Test-only: NOT a production export (T1 ruling Q8) — lives beside the
 * existing `test-fixtures/` fixture data, imported only from `*.test.ts`
 * files.
 */
import type { FlowRunRequest } from '@forge/flows/flow-run-requests.ts';
import type { WebhookPushPayload, CronTriggerPayload } from '@forge/flows/trigger-payload.ts';

/**
 * Mirrors `cron-triggers.ts`'s `makeFireFn`: every field a real cron fire
 * ALWAYS sets (`target`, `origin`, `triggeredBy`, `sourceFlowId`,
 * `concurrency`, `payload`) gets a realistic default; `projects` /
 * `eventProject` are conditional at the real call site too (present only
 * when the declaring trigger/flow scope them) so they default absent here.
 * `overrides` wins over every default, applied last.
 */
export function buildCronFlowRunRequest(overrides: Partial<FlowRunRequest> = {}): FlowRunRequest {
  const defaultPayload: CronTriggerPayload = { kind: 'cron', schedule: '0 3 * * *', firedAt: new Date().toISOString() };
  return {
    target: { kind: 'flow', ref: 'fixture-cron-target' },
    origin: 'cron',
    triggeredBy: 'cron:fixture-cron-flow',
    // The one field real production ALWAYS sets that the pre-fix hand-built
    // literals omitted (forge-76y's defect) — defaulted here so every
    // fixture built through this function exercises the real shape.
    sourceFlowId: 'fixture-cron-flow',
    concurrency: 'forbid',
    payload: defaultPayload,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Mirrors `cli/bridge-hooks.ts`'s webhook route: every field a real webhook
 * receipt ALWAYS sets (`target`, `origin`, `triggeredBy`, `sourceFlowId`,
 * `triggerKind`, `payload`, `eventProject`) gets a realistic default;
 * `projects` is conditional at the real call site too (present only when the
 * declaring trigger scopes it) so it defaults absent here.
 */
export function buildWebhookFlowRunRequest(overrides: Partial<FlowRunRequest> = {}): FlowRunRequest {
  const defaultPayload: WebhookPushPayload = {
    kind: 'webhook',
    provider: 'github',
    event: 'push',
    repo: 'acme/widgets',
    ref: 'refs/heads/main',
    headSha: 'a'.repeat(40),
    pusherLogin: 'octocat',
    commitCount: 1,
    headCommitMessage: 'fix: widget alignment',
  };
  return {
    target: { kind: 'flow', ref: 'fixture-webhook-target' },
    origin: 'webhook',
    triggeredBy: 'webhook:fixture-hook',
    sourceFlowId: 'fixture-webhook-declaring-flow',
    triggerKind: 'webhook',
    payload: defaultPayload,
    eventProject: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Mirrors `orchestrator/flow-trigger.ts`'s `fireAgentCompleteTriggers`: every
 * field a real agent-complete fire ALWAYS sets (`target`, `origin`,
 * `triggeredBy`, `sourceAgent`, `createdAt`) gets a realistic default;
 * `projects` / `eventProject` are conditional at the real call site too, so
 * they default absent here.
 */
export function buildAgentCompleteFlowRunRequest(overrides: Partial<FlowRunRequest> = {}): FlowRunRequest {
  return {
    target: { kind: 'flow', ref: 'fixture-agent-complete-target' },
    origin: 'agent-complete',
    triggeredBy: 'agent-complete:fixture-agent',
    sourceAgent: 'fixture-agent',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}
