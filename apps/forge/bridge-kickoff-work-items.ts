/**
 * bridge-kickoff-work-items — `POST /api/kickoff/work-items` (bead
 * forge-nk1y.12, D-48): the operator adds a plan work item to a decomposed,
 * unbuilt initiative at the Kickoff gate. The body is validated HERE, at the
 * boundary, naming the field; `addKickoffWorkItem` (`@forge/flows`) owns the
 * gate, the lock and the write; the D-47 coverage it re-reports is stations'.
 * Same conventions as `POST /api/develop/start` (global CSRF guard, sendJson).
 *
 * forge-mfv5.1.36 (D-48 amended): the add takes an optional `dependsOn` (absent
 * = the plan's leaf work items), and `PATCH /api/kickoff/work-items/<wiId>`
 * `{ initiativeId, dependsOn }` edits one work item's dependencies at the gate
 * (`editKickoffWorkItemDeps`: the same manifest lock and in-lock re-check).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

import { sendJson, allowedOrigin, sanitizeError, isText, stringList } from '@forge/kernel';
import { WORK_ITEM_ID_PATTERN } from '@forge/contracts';
import { addKickoffWorkItem, editKickoffWorkItemDeps } from '@forge/flows';
import { uncoveredAcceptanceCriteria } from '@forge/stations';
import { readJson } from './bridge-http.ts';

export type KickoffWorkItemContext = { forgeRoot: string; logsRoot: string };

type Source = Parameters<typeof addKickoffWorkItem>[0]['source'];
type Parsed = { initiativeId: string; source: Source } | { error: string };

const MAX_DEPENDS_ON = 50;

/** `dependsOn`: an array of 0..50 work-item ids; unknown ids and cycles are the set validation's to name. */
function dependsOnError(v: unknown): string | null {
  if (!Array.isArray(v) || v.length > MAX_DEPENDS_ON) return `dependsOn must be an array of 0..${MAX_DEPENDS_ON} work item ids`;
  const bad = v.findIndex((id) => typeof id !== 'string' || !WORK_ITEM_ID_PATTERN.test(id));
  return bad < 0 ? null : `dependsOn[${bad}] must be a work item id (WI-<n>, optional split letter)`;
}

function parseBody(b: Record<string, unknown>): Parsed {
  if (!isText(b.initiativeId, 200)) return { error: 'initiativeId must be a non-empty string' };
  if (!isText(b.summary, 2000)) return { error: 'summary must be a non-empty string of at most 2000 characters' };
  const acs = b.acceptanceCriteria;
  if (!Array.isArray(acs) || acs.length === 0 || acs.length > 20) return { error: 'acceptanceCriteria must be an array of 1..20 {given, when, then}' };
  for (const [i, ac] of acs.entries()) {
    for (const k of ['given', 'when', 'then'] as const) {
      if (!isText((ac as Record<string, unknown> | null)?.[k], 1000)) return { error: `acceptanceCriteria[${i}].${k} must be a non-empty string of at most 1000 characters` };
    }
  }
  const listError = stringList('qualityGateCmd', b.qualityGateCmd, 64, 500) ?? stringList('filesInScope', b.filesInScope, 200, 500)
    ?? (b.dependsOn === undefined ? null : dependsOnError(b.dependsOn));
  if (listError) return { error: listError };
  return {
    initiativeId: b.initiativeId,
    source: {
      summary: b.summary,
      acceptanceCriteria: (acs as Array<Record<string, string>>).map((ac) => ({ given: ac.given!, when: ac.when!, then: ac.then! })),
      qualityGateCmd: b.qualityGateCmd as string[],
      filesInScope: b.filesInScope as string[],
      ...(b.dependsOn === undefined ? {} : { dependsOn: b.dependsOn as string[] }),
    },
  };
}

const HTTP = { 'not-found': 404, 'not-at-kickoff': 409, invalid: 400, unsafe: 409 } as const;

async function readBody(req: IncomingMessage, res: ServerResponse, origin: string): Promise<Record<string, unknown> | null> {
  try {
    return ((await readJson(req)) ?? {}) as Record<string, unknown>;
  } catch {
    sendJson(res, 400, { error: 'invalid JSON body' }, origin);
    return null;
  }
}

type Outcome = { status: string; detail?: string } & Record<string, unknown>;

function reply(res: ServerResponse, origin: string, r: Outcome, ok: Record<string, unknown> | null): void {
  if (ok) sendJson(res, 200, { ok: true, ...ok }, origin);
  else sendJson(res, HTTP[r.status as keyof typeof HTTP] ?? 500, { ok: false, status: r.status, detail: r.detail, error: r.detail }, origin);
}

export async function handleKickoffWorkItemRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: KickoffWorkItemContext,
  url: string,
  method: string,
): Promise<boolean> {
  const depsMatch = url.match(/^\/api\/kickoff\/work-items\/([^/?]+)$/);
  if (method === 'PATCH' && depsMatch) {
    await handleEditDeps(req, res, ctx, depsMatch[1]!); // raw: a work-item id never needs percent-decoding, and the pattern refuses any escape
    return true;
  }
  if (!(method === 'POST' && url === '/api/kickoff/work-items')) return false;
  const origin = allowedOrigin(req);
  const body = await readBody(req, res, origin);
  if (body === null) return true;
  const parsed = parseBody(body);
  if ('error' in parsed) {
    sendJson(res, 400, { error: parsed.error }, origin);
    return true;
  }
  try {
    const r = await addKickoffWorkItem({ ...ctx, ...parsed, coverage: uncoveredAcceptanceCriteria });
    reply(res, origin, r, r.status === 'added' ? { workItemId: r.workItemId, uncoveredAcceptanceCriteria: r.uncoveredAcceptanceCriteria } : null);
  } catch (err) {
    sendJson(res, 500, { error: sanitizeError(err) }, origin);
  }
  return true;
}

/** `PATCH /api/kickoff/work-items/<wiId>` — body validated here, naming the field. */
async function handleEditDeps(req: IncomingMessage, res: ServerResponse, ctx: KickoffWorkItemContext, workItemId: string): Promise<void> {
  const origin = allowedOrigin(req);
  const body = await readBody(req, res, origin);
  if (body === null) return;
  const error = !WORK_ITEM_ID_PATTERN.test(workItemId) ? 'workItemId must be a work item id (WI-<n>, optional split letter)'
    : !isText(body.initiativeId, 200) ? 'initiativeId must be a non-empty string'
      : dependsOnError(body.dependsOn);
  if (error) {
    sendJson(res, 400, { error }, origin);
    return;
  }
  try {
    const r = await editKickoffWorkItemDeps({ ...ctx, initiativeId: body.initiativeId as string, workItemId, dependsOn: body.dependsOn as string[] });
    reply(res, origin, r, r.status === 'edited' ? { workItemId: r.workItemId, dependsOn: r.dependsOn } : null);
  } catch (err) {
    sendJson(res, 500, { error: sanitizeError(err) }, origin);
  }
}
