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
 * (the same manifest lock and in-lock re-check).
 *
 * forge-nk1y.32 (D-48 amended): the PATCH takes the full editable set of a work
 * item ADDED at the gate (summary, acceptanceCriteria, qualityGateCmd,
 * filesInScope, creates, dependsOn — each optional, absent = unchanged; a plan
 * work item takes dependsOn only), and `DELETE /api/kickoff/work-items/<wiId>`
 * `{ initiativeId }` removes one (`editKickoffWorkItem` / `deleteKickoffWorkItem`).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

import { sendJson, allowedOrigin, sanitizeError, isText, stringList } from '@forge/kernel';
import { WORK_ITEM_ID_PATTERN } from '@forge/contracts';
import { addKickoffWorkItem, deleteKickoffWorkItem, editKickoffWorkItem } from '@forge/flows';
import { uncoveredAcceptanceCriteria } from '@forge/stations';
import { readJson } from './bridge-http.ts';

export type KickoffWorkItemContext = { forgeRoot: string; logsRoot: string };

type Source = Parameters<typeof addKickoffWorkItem>[0]['source'];
type Edit = Parameters<typeof editKickoffWorkItem>[0]['edit'];
type Parsed = { initiativeId: string; source: Source } | { error: string };

const MAX_DEPENDS_ON = 50;

/** `dependsOn`: an array of 0..50 work-item ids; unknown ids and cycles are the set validation's to name. */
function dependsOnError(v: unknown): string | null {
  if (!Array.isArray(v) || v.length > MAX_DEPENDS_ON) return `dependsOn must be an array of 0..${MAX_DEPENDS_ON} work item ids`;
  const bad = v.findIndex((id) => typeof id !== 'string' || !WORK_ITEM_ID_PATTERN.test(id));
  return bad < 0 ? null : `dependsOn[${bad}] must be a work item id (WI-<n>, optional split letter)`;
}

const EDIT_KEYS = ['summary', 'acceptanceCriteria', 'qualityGateCmd', 'filesInScope', 'creates', 'dependsOn'] as const;

/** One editable field's shape error, naming it; `creates` may be `[]` (none). */
function fieldError(k: (typeof EDIT_KEYS)[number], v: unknown): string | null {
  switch (k) {
    case 'summary': return isText(v, 2000) ? null : 'summary must be a non-empty string of at most 2000 characters';
    case 'acceptanceCriteria': {
      if (!Array.isArray(v) || v.length === 0 || v.length > 20) return 'acceptanceCriteria must be an array of 1..20 {given, when, then}';
      for (const [i, ac] of v.entries()) {
        for (const f of ['given', 'when', 'then'] as const) {
          if (!isText((ac as Record<string, unknown> | null)?.[f], 1000)) return `acceptanceCriteria[${i}].${f} must be a non-empty string of at most 1000 characters`;
        }
      }
      return null;
    }
    case 'qualityGateCmd': return stringList('qualityGateCmd', v, 64, 500);
    case 'filesInScope': return stringList('filesInScope', v, 200, 500);
    case 'creates': return Array.isArray(v) && v.length === 0 ? null : stringList('creates', v, 200, 500);
    case 'dependsOn': return dependsOnError(v);
  }
}

/** The present editable fields, each validated; `required` must all be present. */
function parseFields(b: Record<string, unknown>, required: readonly string[]): { edit: Edit } | { error: string } {
  const edit: Record<string, unknown> = {};
  for (const k of EDIT_KEYS) {
    if (b[k] === undefined && !required.includes(k)) continue;
    const error = fieldError(k, b[k]);
    if (error) return { error };
    edit[k] = k === 'acceptanceCriteria' ? (b[k] as Array<Record<string, string>>).map((ac) => ({ given: ac.given!, when: ac.when!, then: ac.then! })) : b[k];
  }
  return { edit: edit as Edit };
}

function parseBody(b: Record<string, unknown>): Parsed {
  if (!isText(b.initiativeId, 200)) return { error: 'initiativeId must be a non-empty string' };
  const parsed = parseFields(b, ['summary', 'acceptanceCriteria', 'qualityGateCmd', 'filesInScope']);
  return 'error' in parsed ? parsed : { initiativeId: b.initiativeId, source: parsed.edit as Source };
}

const HTTP = { 'not-found': 404, 'not-at-kickoff': 409, invalid: 400, unsafe: 409, 'not-a-kickoff-work-item': 409, 'has-dependents': 409 } as const;

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
  const wiMatch = url.match(/^\/api\/kickoff\/work-items\/([^/?]+)$/);
  // raw wiMatch[1]: a work-item id never needs percent-decoding, and the pattern refuses any escape
  if (method === 'PATCH' && wiMatch) return handleOne(req, res, ctx, wiMatch[1]!, 'PATCH');
  if (method === 'DELETE' && wiMatch) return handleOne(req, res, ctx, wiMatch[1]!, 'DELETE');
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

/** `PATCH` / `DELETE /api/kickoff/work-items/<wiId>` — body validated here, naming the field. */
async function handleOne(req: IncomingMessage, res: ServerResponse, ctx: KickoffWorkItemContext, workItemId: string, method: 'PATCH' | 'DELETE'): Promise<true> {
  const origin = allowedOrigin(req);
  const body = await readBody(req, res, origin);
  if (body === null) return true;
  const parsed = method === 'PATCH' ? parseFields(body, []) : { edit: {} };
  const error = !WORK_ITEM_ID_PATTERN.test(workItemId) ? 'workItemId must be a work item id (WI-<n>, optional split letter)'
    : !isText(body.initiativeId, 200) ? 'initiativeId must be a non-empty string'
      : 'error' in parsed ? parsed.error
        : method === 'PATCH' && Object.keys(parsed.edit).length === 0 ? `dependsOn (or another editable field: ${EDIT_KEYS.join(', ')}) is required`
          : null;
  if (error || 'error' in parsed) {
    sendJson(res, 400, { error }, origin);
    return true;
  }
  try {
    const gate = { ...ctx, initiativeId: body.initiativeId as string, workItemId };
    if (method === 'DELETE') {
      const r = await deleteKickoffWorkItem(gate);
      reply(res, origin, r, r.status === 'deleted' ? { workItemId: r.workItemId } : null);
      return true;
    }
    const r = await editKickoffWorkItem({ ...gate, edit: parsed.edit });
    reply(res, origin, r, r.status === 'edited' ? { workItemId: r.workItemId, dependsOn: r.dependsOn } : null);
  } catch (err) {
    sendJson(res, 500, { error: sanitizeError(err) }, origin);
  }
  return true;
}
