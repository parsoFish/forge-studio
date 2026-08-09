/**
 * Client-side fetch + pure derivation for the standalone run view
 * (R6-04 WI-4 item 4) — `app/agents/[id]/run/[runId]/page.tsx`'s data
 * source. Kept separate from `studio-client.ts`'s existing
 * `getAgentRunStatus` (which `RunPanel.tsx` polls today — a WI-3 contract
 * this file must not touch) so this new surface's fetch/derivation can
 * evolve without any risk to that earlier, already-pinned behaviour.
 *
 * Reads `GET /api/agents/runs/:runId`'s `lines` field (R6-04 WI-4 item 1) —
 * the run's own parsed event records — and derives:
 *   - `RunLogLine[]` for the shared `RunLog` renderer (`./run-log-line.ts`)
 *   - materials REFERENCES (`{path, kind}`) from the
 *     `agent-run.materials-staged` log event's `metadata.materials`
 *     (`cli/ui-bridge.ts` ~line 1352; `orchestrator/agent-dispatch.ts`'s
 *     `MaterialReference` type)
 *   - the cost ceiling that was actually in force, from the terminal `end`
 *     event's `metadata.kickoff_ceiling_usd` (`orchestrator/run-agent.ts`
 *     ~line 387) — `undefined` when no ceiling was ever recorded, never a
 *     fabricated default
 *
 * KNOWN GAP (documented, not closed here — see RunView.tsx's own header and
 * the WI-4 task brief): this fetch is exercised only by `tsc`, not by an
 * acceptance test — no jsdom / `@testing-library/react` is installed in
 * this repo and `useParams()`/`useEffect` need a mounted Next.js router
 * context `renderToStaticMarkup` cannot provide. A real-browser journey
 * beat (a later work item) proves this end to end.
 *
 * `found`: R6-04 D22 follow-up — `GET /api/agents/runs/:runId` now 404s for
 * a runId with no `_logs/<runId>` directory at all (genuinely never
 * dispatched), distinct from "directory exists, no events landed yet"
 * (200, `state: 'running'`, `lines: []` — a real in-flight run). `found`
 * mirrors the HTTP status, not the body: `resolveRunDetailFromResponse`
 * below decides on `status` alone (any non-2xx, matching `fetch`'s own
 * `res.ok` convention, not a 404-only special case) BEFORE it ever reads
 * `body`, so a stray/cached body on an error response can never leak
 * through as a live run.
 *
 * Typed outputs (`RunOutput[]`) — there is no wired data source for a
 * generic dispatched agent's artifact outputs yet (that lives on the
 * cycle-shaped flows, not the standalone-agent-run primitive this route
 * serves). `outputs` is honestly always `[]` here rather than fabricated;
 * wiring a real source is future work once one exists.
 */

import { resolveBridgeUrl } from './bridge-client';
import type { EventLogEntry } from './bridge-client';
import { deriveLogLine, type RunLogLine } from './run-log-line';
import type { RunMaterialRef, RunOutput } from '@/components/studio/agent-builder/RunView';

export type RunDetail = {
  found: boolean;
  state: string;
  costUsd: number;
  lines: RunLogLine[];
  materials: RunMaterialRef[];
  ceilingUsd?: number;
  outputs: RunOutput[];
  /**
   * R6-01 WI-2-style provenance (debt-T trigger plumbing): what started this
   * run, mirrored from `GET /api/agents/runs/:runId`'s `trigger` field.
   * Absent when the run carries no derivable trigger — NEVER a fabricated
   * default. Client-side plumbing only (T1 ruling): no corresponding server
   * field is wired by this change, so this key is honestly absent on every
   * real response today until a server-side field lands.
   */
  trigger?: {
    kind: string;
    source: string;
    scope: string | null;
  };
};

const NOT_FOUND_DETAIL: RunDetail = {
  found: false,
  state: 'unknown',
  costUsd: 0,
  lines: [],
  materials: [],
  ceilingUsd: undefined,
  outputs: [],
};

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

/** The cost ceiling actually in force for this run, from the terminal
 *  `end` event's `metadata.kickoff_ceiling_usd` — `undefined` (never a
 *  fabricated default) when no ceiling was ever recorded. */
export function ceilingFromEvents(events: EventLogEntry[]): number | undefined {
  const end = [...events].reverse().find((e) => e.event_type === 'end');
  const val = end?.metadata?.['kickoff_ceiling_usd'];
  return typeof val === 'number' ? val : undefined;
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
 * into a `RunDetail`. Extracted out of `fetchRunDetail` (R6-04 D22
 * follow-up) so the status-vs-body precedence — status decides `found`
 * BEFORE body is ever inspected, and any non-2xx status (not just 404)
 * means not-found, mirroring `fetch`'s own `res.ok` — is unit-testable
 * without a running bridge. `body` is untyped/unvalidated on purpose: a
 * malformed or unexpected 200 body (null, a bare string, missing fields)
 * degrades to the same honest defaults `fetchRunDetail` always used, never
 * throws.
 */
export function resolveRunDetailFromResponse(status: number, body: unknown): RunDetail {
  if (status < 200 || status >= 300) return NOT_FOUND_DETAIL;
  const data = body && typeof body === 'object'
    ? (body as { state?: unknown; costUsd?: unknown; lines?: unknown; trigger?: unknown })
    : {};
  const rawLines = Array.isArray(data.lines) ? (data.lines as Record<string, unknown>[]) : [];
  const events = rawLines.map(toEventLogEntry);
  const trigger = triggerFromBody(data.trigger);
  return {
    found: true,
    state: typeof data.state === 'string' ? data.state : 'unknown',
    costUsd: typeof data.costUsd === 'number' ? data.costUsd : 0,
    lines: events.map(deriveLogLine),
    materials: materialsFromEvents(events),
    ceilingUsd: ceilingFromEvents(events),
    outputs: [],
    // Carried through only when present + valid — mirrors
    // studio-client.ts:588's declared-data-fails-open convention: an absent
    // `trigger` key must stay absent, never defaulted.
    ...(trigger !== undefined ? { trigger } : {}),
  };
}

/** Fetch + derive everything `RunView` needs for one runId. */
export async function fetchRunDetail(runId: string): Promise<RunDetail> {
  const base = await resolveBridgeUrl();
  if (!base) return NOT_FOUND_DETAIL;
  try {
    const res = await fetch(`${base}/api/agents/runs/${encodeURIComponent(runId)}`);
    const body = await res.json().catch(() => null);
    return resolveRunDetailFromResponse(res.status, body);
  } catch {
    return NOT_FOUND_DETAIL;
  }
}
