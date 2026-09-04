/**
 * Client-side fetch + pure derivation for a run-detail TIMELINE ROW's
 * click-through node log (R6-01 WI-3 / F5) — reads the new `raw=1` mode on
 * the existing `GET /api/runs/<id>/phases/<node>/log` route
 * (`apps/forge/bridge-studio-phase-log-raw.test.ts`, `apps/forge/bridge-studio.ts`) and
 * maps the node's own raw event records through the SHARED, unmodified
 * `deriveLogLine` (`./run-log-line.ts`) — the same think|tool|out mapper
 * `./run-view-client.ts` already uses for the standalone agent-run surface.
 * This file does NOT re-derive classification; it is the SAME mapping,
 * reused for a different (per-node, flow-scoped) event source.
 *
 * `resolveNodeLogFromResponse` mirrors `./run-view-client.ts`'s own
 * `resolveRunDetailFromResponse` precedent exactly: status decides success
 * BEFORE body is ever inspected (any non-2xx degrades to an honest empty
 * array, matching `fetch`'s own `res.ok` convention), and a malformed or
 * unexpected 200 body degrades to the same empty result rather than
 * throwing.
 *
 * KNOWN GAP (documented, not closed here — same class as `run-view-
 * client.ts`'s own header): `fetchNodeLog`'s real `bridgeFetch()` wiring
 * has no jsdom/mocked-fetch harness in this
 * repo, so it is verified by `tsc` + the `flows-run-detail-reachable`
 * journey beat only. `resolveNodeLogFromResponse` — the pure function that
 * wrapper calls — is what `./flow-node-log.test.ts` pins.
 */

import { bridgeFetch } from './bridge-client';
import type { EventLogEntry } from './bridge-client';
import { deriveLogLine, type RunLogLine } from './run-log-line';

/** Coerce one raw parsed JSONL record (the bridge sends the node's own
 *  `EventLogEntry` records verbatim under `raw=1`, but the client treats the
 *  wire body as untyped/unvalidated) into the client `EventLogEntry` shape —
 *  missing fields default to an honest empty string/undefined rather than
 *  being fabricated. Mirrors `./run-view-client.ts`'s own `toEventLogEntry`. */
function toEventLogEntry(raw: Record<string, unknown>): EventLogEntry {
  return {
    event_id: typeof raw['event_id'] === 'string' ? (raw['event_id'] as string) : '',
    cycle_id: typeof raw['cycle_id'] === 'string' ? (raw['cycle_id'] as string) : undefined,
    initiative_id: typeof raw['initiative_id'] === 'string' ? (raw['initiative_id'] as string) : '',
    started_at: typeof raw['started_at'] === 'string' ? (raw['started_at'] as string) : '',
    phase: typeof raw['phase'] === 'string' ? (raw['phase'] as string) : '',
    skill: typeof raw['skill'] === 'string' ? (raw['skill'] as string) : '',
    event_type: typeof raw['event_type'] === 'string' ? (raw['event_type'] as string) : 'log',
    message: typeof raw['message'] === 'string' ? (raw['message'] as string) : undefined,
    metadata: raw['metadata'] && typeof raw['metadata'] === 'object' ? (raw['metadata'] as Record<string, unknown>) : undefined,
    cost_usd: typeof raw['cost_usd'] === 'number' ? (raw['cost_usd'] as number) : undefined,
    tokens_in: typeof raw['tokens_in'] === 'number' ? (raw['tokens_in'] as number) : undefined,
    tokens_out: typeof raw['tokens_out'] === 'number' ? (raw['tokens_out'] as number) : undefined,
  };
}

/**
 * Pure: turn one resolved fetch response (`status` + parsed JSON `body`)
 * from `GET .../phases/<node>/log?raw=1` into `RunLogLine[]`, in the SAME
 * order the node's own events arrived. Any non-2xx status, or a malformed/
 * missing `lines` array, degrades to `[]` — never a throw, never invented
 * filler.
 */
export function resolveNodeLogFromResponse(status: number, body: unknown): RunLogLine[] {
  if (status < 200 || status >= 300) return [];
  const data = body && typeof body === 'object' ? (body as { lines?: unknown }) : {};
  const rawLines = Array.isArray(data.lines) ? (data.lines as Record<string, unknown>[]) : [];
  return rawLines.map(toEventLogEntry).map(deriveLogLine);
}

/** Fetch + derive one flow node's own raw log lines for a given run. */
export async function fetchNodeLog(runId: string, nodeId: string): Promise<RunLogLine[]> {
  try {
    const res = await bridgeFetch(`/api/runs/${encodeURIComponent(runId)}/phases/${encodeURIComponent(nodeId)}/log?raw=1`);
    const body = await res.json().catch(() => null);
    return resolveNodeLogFromResponse(res.status, body);
  } catch {
    return [];
  }
}
