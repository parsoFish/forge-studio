/**
 * Client-side fetch + pure derivation for the standalone run view
 * (`app/agents/[id]/run/[runId]/page.tsx`'s data source).
 *
 * W7-B5 rewrites the resolution onto the THREE-STATE contract
 * `flow-run-detail-client.ts` established (bead forge-irn, the D9 sibling):
 *   - 404            → `resolution: 'not-found'` — the bridge ANSWERED "no
 *                      such run" (a definitive negative fact)
 *   - 2xx            → `resolution: 'found'` + the run's own facts
 *   - anything else  → `resolution: 'unresolved'` — a 500/403/transport
 *                      failure is an ERROR about the READ, never rendered as
 *                      the authoritative "run not found" it used to collapse
 *                      into.
 *
 * Also W7-B5:
 *   - `outputRefs` (agents-06 / forge-75j): the run's real output references,
 *     read off the wire (`GET /api/agents/runs/:runId` now serves the end
 *     event's own `output_refs`) — the old hard-wired `outputs: []` literal
 *     and its dead `RunOutput[]` shape are gone.
 *   - `errorText` (agents-19): the dispatch failure's own recorded reason,
 *     served by the same route.
 *   - `ceilingUsd` (agents-31): server-derived (`kickoff_ceiling_usd` off ANY
 *     of the run's events — the t0 dispatched marker, start, or end), with
 *     the event-scan fallback kept for older runs whose wire payload predates
 *     the field.
 */

import { bridgeFetch } from './bridge-client';
import type { EventLogEntry } from './bridge-client';
import { deriveLogLine, type RunLogLine } from './run-log-line';
import type { RunMaterialRef } from '@/components/studio/agent-builder/RunView';

export type RunDetailResolution = 'found' | 'not-found' | 'unresolved';

export type RunDetail = {
  resolution: RunDetailResolution;
  /** Back-compat convenience: `resolution === 'found'`. */
  found: boolean;
  state: string;
  costUsd: number;
  lines: RunLogLine[];
  materials: RunMaterialRef[];
  ceilingUsd?: number;
  /** W7-B5 (agents-06): the run's real output references (end event
   *  `output_refs`), served on the wire — `[]` until the run produces any. */
  outputRefs: string[];
  /** W7-B5 (agents-19): the dispatch failure's own recorded reason —
   *  absent when the run never failed. */
  errorText?: string;
  /** Set ONLY on `resolution: 'unresolved'` — the read failure's own facts
   *  (never a fact about the run). `status` absent = transport failure. */
  readError?: { message: string; status?: number };
  /**
   * R6-01 WI-2-style provenance (debt-T trigger plumbing): what started this
   * run, mirrored from `GET /api/agents/runs/:runId`'s `trigger` field.
   * Absent when the run carries no derivable trigger — NEVER a fabricated
   * default.
   */
  trigger?: {
    kind: string;
    source: string;
    scope: string | null;
  };
};

function emptyDetail(resolution: RunDetailResolution): RunDetail {
  return {
    resolution,
    found: false,
    state: 'unknown',
    costUsd: 0,
    lines: [],
    materials: [],
    ceilingUsd: undefined,
    outputRefs: [],
  };
}

/** Coerce one raw parsed JSONL record (server sends plain `JSON.parse`
 *  output, not a validated `EventLogEntry`) into the client `EventLogEntry`
 *  shape — missing fields default to an honest empty string/undefined
 *  rather than being fabricated. */
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

/** Materials REFERENCES only (`{path, kind}`) — never contents, even if the
 *  wire payload happened to carry more (this reads only path/kind off the
 *  metadata array). The LAST `agent-run.materials-staged` line wins if a
 *  run somehow staged more than once. */
export function materialsFromEvents(events: EventLogEntry[]): RunMaterialRef[] {
  const staged = events.filter((e) => e.message === 'agent-run.materials-staged');
  const last = staged[staged.length - 1];
  const raw = last?.metadata?.['materials'];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m): m is { path: unknown; kind: unknown } => m !== null && typeof m === 'object')
    .filter((m) => typeof m.path === 'string' && typeof m.kind === 'string')
    .map((m) => ({ path: m.path as string, kind: m.kind as string }));
}

/** The cost ceiling actually in force for this run — W7-B5 (agents-31): read
 *  from ANY event carrying `metadata.kickoff_ceiling_usd` (the t0
 *  `agent-run.dispatched` marker, `start`, or the terminal `end` — latest
 *  wins), not only the end event, so a failed or still-running run still
 *  surfaces the ceiling that was submitted. `undefined` (never a fabricated
 *  default) when no event recorded one. */
export function ceilingFromEvents(events: EventLogEntry[]): number | undefined {
  let ceiling: number | undefined;
  for (const e of events) {
    const val = e.metadata?.['kickoff_ceiling_usd'];
    if (typeof val === 'number') ceiling = val;
  }
  return ceiling;
}

/** Validate a raw `trigger` field off the wire body into `RunDetail`'s
 *  `trigger` shape — an object with string `kind`/`source` and a
 *  `scope` that is either a string or `null`. Returns `undefined` (never a
 *  fabricated default) when the raw value is missing or malformed. */
function triggerFromBody(raw: unknown): RunDetail['trigger'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const t = raw as { kind?: unknown; source?: unknown; scope?: unknown };
  if (typeof t.kind !== 'string' || typeof t.source !== 'string') return undefined;
  if (typeof t.scope !== 'string' && t.scope !== null) return undefined;
  return { kind: t.kind, source: t.source, scope: t.scope };
}

/**
 * Pure: turn one resolved fetch response (`status` + parsed JSON `body`)
 * into a `RunDetail`. W7-B5 three-state rules (see module header): only a
 * 404 is `'not-found'`; any OTHER non-2xx is `'unresolved'`, carrying the
 * bridge's own error text when the body has one. `body` is untyped/
 * unvalidated on purpose: a malformed 200 body degrades to honest defaults,
 * never throws.
 */
export function resolveRunDetailFromResponse(status: number, body: unknown): RunDetail {
  if (status === 404) return emptyDetail('not-found');
  if (status < 200 || status >= 300) {
    const message = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : `bridge answered HTTP ${status}`;
    return { ...emptyDetail('unresolved'), readError: { message, status } };
  }
  const data = body && typeof body === 'object'
    ? (body as { state?: unknown; costUsd?: unknown; lines?: unknown; trigger?: unknown; outputRefs?: unknown; errorText?: unknown; ceilingUsd?: unknown })
    : {};
  const rawLines = Array.isArray(data.lines) ? (data.lines as Record<string, unknown>[]) : [];
  const events = rawLines.map(toEventLogEntry);
  const trigger = triggerFromBody(data.trigger);
  const outputRefs = Array.isArray(data.outputRefs)
    ? (data.outputRefs as unknown[]).filter((r): r is string => typeof r === 'string')
    : [];
  const serverCeiling = typeof data.ceilingUsd === 'number' ? data.ceilingUsd : undefined;
  return {
    resolution: 'found',
    found: true,
    state: typeof data.state === 'string' ? data.state : 'unknown',
    costUsd: typeof data.costUsd === 'number' ? data.costUsd : 0,
    lines: events.map(deriveLogLine),
    materials: materialsFromEvents(events),
    ceilingUsd: serverCeiling ?? ceilingFromEvents(events),
    outputRefs,
    ...(typeof data.errorText === 'string' && data.errorText.length > 0 ? { errorText: data.errorText } : {}),
    // Carried through only when present + valid — mirrors
    // studio-client.ts's declared-data-fails-open convention: an absent
    // `trigger` key must stay absent, never defaulted.
    ...(trigger !== undefined ? { trigger } : {}),
  };
}

/** Fetch + derive everything `RunView` needs for one runId. A transport
 *  failure is `'unresolved'` (the read failed), NEVER `'not-found'`. */
export async function fetchRunDetail(runId: string): Promise<RunDetail> {
  try {
    const res = await bridgeFetch(`/api/agents/runs/${encodeURIComponent(runId)}`);
    const body = await res.json().catch(() => null);
    return resolveRunDetailFromResponse(res.status, body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ...emptyDetail('unresolved'), readError: { message: `bridge unreachable (${message})` } };
  }
}
