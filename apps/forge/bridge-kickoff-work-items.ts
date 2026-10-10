/**
 * bridge-kickoff-work-items — `POST /api/kickoff/work-items` (bead
 * forge-nk1y.12, D-48): the operator adds a plan work item to a decomposed,
 * unbuilt initiative at the Kickoff gate. The body is validated HERE, at the
 * boundary, naming the field; `addKickoffWorkItem` (`@forge/flows`) owns the
 * gate, the lock and the write; the D-47 coverage it re-reports is stations'.
 * Same conventions as `POST /api/develop/start` (global CSRF guard, sendJson).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

import { sendJson, allowedOrigin, sanitizeError } from '@forge/kernel';
import { addKickoffWorkItem } from '@forge/flows';
import { uncoveredAcceptanceCriteria } from '@forge/stations';
import { readJson, isText, stringList } from './bridge-http.ts';

export type KickoffWorkItemContext = { forgeRoot: string; logsRoot: string };

type Source = Parameters<typeof addKickoffWorkItem>[0]['source'];
type Parsed = { initiativeId: string; source: Source } | { error: string };

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
  const listError = stringList('qualityGateCmd', b.qualityGateCmd, 64, 500) ?? stringList('filesInScope', b.filesInScope, 200, 500);
  if (listError) return { error: listError };
  return {
    initiativeId: b.initiativeId,
    source: {
      summary: b.summary,
      acceptanceCriteria: (acs as Array<Record<string, string>>).map((ac) => ({ given: ac.given!, when: ac.when!, then: ac.then! })),
      qualityGateCmd: b.qualityGateCmd as string[],
      filesInScope: b.filesInScope as string[],
    },
  };
}

const HTTP = { 'not-found': 404, 'not-at-kickoff': 409, invalid: 400, unsafe: 409 } as const;

export async function handleKickoffWorkItemRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: KickoffWorkItemContext,
  url: string,
  method: string,
): Promise<boolean> {
  if (!(method === 'POST' && url === '/api/kickoff/work-items')) return false;
  const origin = allowedOrigin(req);
  let body: unknown;
  try {
    body = await readJson(req);
  } catch {
    sendJson(res, 400, { error: 'invalid JSON body' }, origin);
    return true;
  }
  const parsed = parseBody((body ?? {}) as Record<string, unknown>);
  if ('error' in parsed) {
    sendJson(res, 400, { error: parsed.error }, origin);
    return true;
  }
  try {
    const r = await addKickoffWorkItem({ ...ctx, ...parsed, coverage: uncoveredAcceptanceCriteria });
    if (r.status === 'added') {
      sendJson(res, 200, { ok: true, workItemId: r.workItemId, uncoveredAcceptanceCriteria: r.uncoveredAcceptanceCriteria }, origin);
    } else {
      sendJson(res, HTTP[r.status], { ok: false, status: r.status, detail: r.detail, error: r.detail }, origin);
    }
  } catch (err) {
    sendJson(res, 500, { error: sanitizeError(err) }, origin);
  }
  return true;
}
