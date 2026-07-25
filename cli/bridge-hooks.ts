/**
 * bridge-hooks — R2-04 (ADR-041) external webhook receipts.
 *
 * `POST /api/hooks/:hookId` is the ONE ingress for github/gitea/gitlab
 * webhook deliveries. It is deliberately thin: verify the signature over the
 * RAW body, extract a typed payload, check the source allowlist, then STAGE a
 * claimable flow-run request (`orchestrator/flow-run-requests.ts`). There is
 * no dispatch and no agent spawn on this path — dispatch happens only in the
 * daemon's sweep, so `FORGE_ARCHITECT_NO_SPAWN` / dry-bridge hold structurally
 * for this trigger kind (see `cli/dry-bridge.ts`'s `exempt-local` row for this
 * route: staging a request file is not a real-acting operation).
 *
 * Trust model: the bridge binds 0.0.0.0, so this route is LAN/internet
 * reachable the moment an operator exposes it — signature verification
 * (`orchestrator/webhook-verify.ts`) is the ONLY trust boundary; there is no
 * source-IP allowlist (documented as defense-in-depth-only in ADR-041). A
 * missing/empty secret env value fails closed (503) rather than accepting an
 * unverified payload.
 *
 * Mounted like the other bridge dispatch modules (`bridge-recovery.ts`,
 * `bridge-studio.ts`, …): `handleHookRoutes` returns `false` for any
 * non-matching method/URL so `ui-bridge.ts`'s dispatch chain falls through to
 * the next handler.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';

import { sendJson, allowedOrigin, pathOnly } from './bridge-studio.ts';
import { listFlowIds, loadFlowDefinition } from '../orchestrator/studio/registry.ts';
import type { FlowDefinition, FlowTrigger, WebhookTriggerConfig } from '../orchestrator/studio/types.ts';
import { verifyWebhookSignature } from '../orchestrator/webhook-verify.ts';
import {
  extractPushPayload,
  extractReleasePayload,
  TriggerPayloadInvalidError,
  type TriggerPayload,
} from '../orchestrator/trigger-payload.ts';
import { stageFlowRunRequest } from '../orchestrator/flow-run-requests.ts';

export type HookRoutesContext = { forgeRoot: string; queueRoot: string; logsRoot: string };

/** `webhook.id` slugs (bridge URL segment): validated BEFORE any lookup/use. */
const HOOK_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

const MAX_HOOK_BODY_BYTES = 1 * 1024 * 1024; // 1 MiB

class BodyTooLargeError extends Error {}

/**
 * Read the raw request body as a Buffer, capped at 1 MiB — the exact bytes
 * signature verification runs over, BEFORE any `JSON.parse`. Destroys the
 * socket and rejects with {@link BodyTooLargeError} over cap rather than
 * buffering an unbounded body.
 */
function readRawBody(req: IncomingMessage, maxBytes = MAX_HOOK_BODY_BYTES): Promise<Buffer> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.byteLength;
      if (total > maxBytes) {
        req.destroy();
        rejectBody(new BodyTooLargeError('request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', rejectBody);
  });
}

function firstHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const v = headers[name];
  return Array.isArray(v) ? v[0] : v;
}

type ResolvedHook = { flow: FlowDefinition; trigger: FlowTrigger; webhook: WebhookTriggerConfig };

/**
 * Scan every registered flow for the `on: webhook` trigger whose
 * `webhook.id === hookId`. One malformed flow.yaml is skipped (try/catch per
 * flow) rather than 500ing every hook receipt — mirrors
 * `orchestrator/cron-triggers.ts`'s `scanDeclaredCronTriggers`.
 */
function findWebhookTrigger(forgeRoot: string, hookId: string): ResolvedHook | null {
  const root = resolve(forgeRoot);
  for (const flowId of listFlowIds(root)) {
    let flow: FlowDefinition;
    try {
      flow = loadFlowDefinition(join(root, 'studio', 'flows', flowId, 'flow.yaml'));
    } catch {
      continue;
    }
    for (const trigger of flow.triggers) {
      if (trigger.on === 'webhook' && trigger.webhook && trigger.webhook.id === hookId) {
        return { flow, trigger, webhook: trigger.webhook };
      }
    }
  }
  return null;
}

type ResolvedEvent = 'push' | 'release';

/**
 * github/gitea send the event name verbatim (`x-*-event: push|release`);
 * gitlab sends human-readable values (`x-gitlab-event: Push Hook|Release
 * Hook`) that need mapping onto the same `push`/`release` vocabulary.
 */
function resolveEventName(
  provider: WebhookTriggerConfig['provider'],
  headers: Record<string, string | string[] | undefined>,
): ResolvedEvent | null {
  if (provider === 'gitlab') {
    const raw = firstHeader(headers, 'x-gitlab-event');
    if (raw === 'Push Hook') return 'push';
    if (raw === 'Release Hook') return 'release';
    return null;
  }
  const headerName = provider === 'gitea' ? 'x-gitea-event' : 'x-github-event';
  const raw = firstHeader(headers, headerName);
  return raw === 'push' || raw === 'release' ? raw : null;
}

/**
 * Handle `POST /api/hooks/:hookId`. Returns `true` iff handled (including
 * every rejection branch); `false` for any non-matching method/URL so the
 * bridge's dispatch chain falls through. Never throws — every failure mode
 * maps to a typed HTTP status plus a `console.warn` (no cycle context exists
 * yet at this point in the pipeline, so structured event-log emission is not
 * attempted here).
 */
export async function handleHookRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: HookRoutesContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  if (method !== 'POST') return false;
  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  const hookMatch = url.match(/^\/api\/hooks\/([^/]+)$/);
  if (!hookMatch) return false;

  const rawHookId = decodeURIComponent(hookMatch[1]);
  if (!HOOK_ID_RE.test(rawHookId)) {
    console.warn(`bridge-hooks: rejected malformed hook id slug: ${JSON.stringify(rawHookId.slice(0, 200))}`);
    sendJson(res, 404, { error: 'unknown hook' }, origin);
    return true;
  }
  const hookId = rawHookId;

  // 1. Resolve the declaration. Unknown hook → 404 with a constant body (no
  // existence-leak detail — the response is identical whether the id was
  // never declared or belongs to a flow that failed to load).
  const found = findWebhookTrigger(ctx.forgeRoot, hookId);
  if (!found) {
    console.warn(`bridge-hooks: no webhook trigger declared for hook id "${hookId}"`);
    sendJson(res, 404, { error: 'unknown hook' }, origin);
    return true;
  }
  const { trigger, webhook } = found;

  // 2. Raw body, capped, BEFORE any parsing — HMAC/token verification needs
  // the exact bytes the sender signed.
  let rawBody: Buffer;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      console.warn(`bridge-hooks: oversize body for hook "${hookId}"`);
      sendJson(res, 413, { error: 'request body too large' }, origin);
      return true;
    }
    console.warn(`bridge-hooks: body read error for hook "${hookId}": ${err instanceof Error ? err.message : String(err)}`);
    sendJson(res, 400, { error: 'unreadable request body' }, origin);
    return true;
  }

  // 3. Signature verification — fail closed.
  const verified = await verifyWebhookSignature({
    provider: webhook.provider,
    rawBody,
    headers: req.headers,
    secretEnv: webhook.secretEnv,
    secretEnvPrevious: webhook.secretEnvPrevious,
  });
  if (!verified.ok) {
    console.warn(`bridge-hooks: signature rejected for hook "${hookId}" (${verified.status}): ${verified.reason}`);
    sendJson(res, verified.status, { error: verified.reason }, origin);
    return true;
  }

  // 4. Parse — only after the raw bytes are verified.
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString('utf8'));
  } catch {
    console.warn(`bridge-hooks: unparseable JSON body for hook "${hookId}"`);
    sendJson(res, 400, { error: 'unparseable request body' }, origin);
    return true;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    console.warn(`bridge-hooks: non-object JSON body for hook "${hookId}"`);
    sendJson(res, 400, { error: 'unparseable request body' }, origin);
    return true;
  }
  const body = parsed as Record<string, unknown>;

  // 5. Event resolution — unresolvable header or an event the declaration
  // didn't subscribe to are both a plain 400 (kept simple; no 422 nuance).
  const event = resolveEventName(webhook.provider, req.headers);
  if (!event) {
    console.warn(`bridge-hooks: unrecognised event header for hook "${hookId}"`);
    sendJson(res, 400, { error: 'event not declared' }, origin);
    return true;
  }
  if (!webhook.events.includes(event)) {
    console.warn(`bridge-hooks: undeclared event "${event}" for hook "${hookId}"`);
    sendJson(res, 400, { error: 'event not declared' }, origin);
    return true;
  }

  // 6. Extract the typed, extraction-validated payload.
  let payload: TriggerPayload;
  try {
    payload =
      event === 'push'
        ? extractPushPayload(webhook.provider, body)
        : extractReleasePayload(webhook.provider, body);
  } catch (err) {
    if (err instanceof TriggerPayloadInvalidError) {
      console.warn(`bridge-hooks: invalid payload for hook "${hookId}": ${err.message}`);
      sendJson(res, 400, { error: 'invalid payload' }, origin);
      return true;
    }
    throw err;
  }

  // 7. Source allowlist — checked AFTER signature verification (scoping, not
  // the trust root).
  if (!webhook.sources.includes(payload.repo)) {
    console.warn(`bridge-hooks: source "${payload.repo}" not allowed for hook "${hookId}"`);
    sendJson(res, 403, { error: 'source not allowed' }, origin);
    return true;
  }

  // 8. Stage only — no dispatch, no spawn (see the dry-bridge classification).
  stageFlowRunRequest(
    {
      target: trigger.target,
      origin: 'webhook',
      triggeredBy: `webhook:${hookId}`,
      payload,
    },
    { queueRoot: ctx.queueRoot },
  );
  sendJson(res, 202, { ok: true, staged: true }, origin);
  return true;
}
