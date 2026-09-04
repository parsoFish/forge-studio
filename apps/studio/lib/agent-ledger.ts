/**
 * Agent-scoped run-history ledger derivation (R6-06 Task 2) — the SECOND
 * caller of the shared engine in `./history-ledger.ts` (`./flow-ledger.ts`,
 * R6-05, was the first). Turns an agent's runs across THREE execution paths
 * — flow-node / standalone / session — into ONE `LedgerRow[]`, reusing
 * `renderSegment`/`renderNarrative`/`sortLedgerRowsNewestFirst`/`formatWhen`
 * unchanged (D2).
 *
 * ARCHITECTURE: the SERVER route (`apps/forge/ui-bridge-agent-history.test.ts`,
 * Task 1, `GET /api/agents/:slug/history`) already reduces status/cost to
 * the TARGET's own per-row fact (D3) before the wire and sends
 * already-shaped `LedgerRow[]` — this module's `resolveAgentHistoryFromResponse`
 * / `fetchAgentHistory` are the pure status-aware wire resolver for THAT
 * response, mirroring `flow-run-detail-client.ts`'s
 * `resolveFlowRunDetailFromResponse` / `fetchFlowRunDetail` pattern exactly
 * (three-state: not-found / found / unresolved — never a two-state
 * "any non-2xx collapses to not-found", the known filed defect elsewhere in
 * this codebase, D10).
 *
 * `deriveAgentNodeLedgerSegments` / `deriveAgentLedgerRows` are the
 * DERIVATION half: given richer, already-resolved PER-PATH entries (a
 * flow-node entry carries the FULL `Run` + its `nodeId`, exactly like
 * `flow-ledger.ts`'s own `deriveFlowLedgerRows(runs: Run[])` takes full
 * `Run[]`, not a pre-flattened wire summary), derive narrative/href/
 * linkKind/sort — the presentation-layer work the server/CLI side never
 * imports (mirrors the EXISTING split: `orchestrator/run-model.ts` knows
 * nothing of `LedgerSegment`).
 *
 * ⚑ D9 (restated per-node) — `gate-fails` is sourced from a node's own
 * `retries` ONLY when `nodeId === 'dev'`. Every OTHER node's `retries` is a
 * count of `error`-typed events (spawn errors, budget exhaustion, scope
 * violations) — real, but NOT a gate-failure fact. `{kind:'node-errors'}` is
 * what that fact honestly is; it is never emitted for `dev`, where
 * `gate-fails` owns that number.
 *
 * ⚑ A per-NODE row's narrative derives from THAT NODE's own facts —
 * `run.phaseMeta[nodeId]` — never from `flow-ledger.ts`'s RUN-level segments
 * (`work-items`/`merged`/`gate-waiting`/`failed`/`reflection-lost`). Reusing
 * a run-level segment on a per-node row would be the exact attributed-status
 * defect this initiative exists to prevent.
 *
 * See `./agent-ledger.test.ts` for the full acceptance contract.
 */

import { bridgeFetch } from './bridge-client';
import {
  renderNarrative,
  sortLedgerRowsNewestFirst,
  type LedgerRow,
  type LedgerSegment,
  type LedgerRowTrigger,
} from './history-ledger';
// R6-06 ROUND 8/9 fix: `parseRun` is the SAME normalizer `GET /api/runs`'s
// own client already trusts to turn a raw wire `Run` into the typed shape
// (D2 reuse) — used below to defend `deriveAgentLedgerRows` against a
// structurally-incomplete `run` object (e.g. a missing `phases`/`phaseMeta`
// key would otherwise throw inside `deriveFlowNodeRow`/
// `deriveAgentNodeLedgerSegments`, not merely render oddly).
import { parseRun, type Run } from './studio-client';

// ---------------------------------------------------------------------------
// Entry shapes — one per execution path, already-resolved by the caller
// ---------------------------------------------------------------------------

/** A flow-node execution: the FULL `Run` this node ran inside, which node it
 *  was, and the already-built href (D2, the reuse seam — this module never
 *  constructs a URL itself). */
export type AgentFlowNodeRunEntry = { run: Run; nodeId: string; href: string };

/** A standalone (non-flow) worker dispatch. `status` is its OWN closed
 *  vocabulary — never coerced into `RunStatus`/`RunPhaseStatus` (D12).
 *  `costUsd: null` when the cost genuinely does not exist yet.
 *
 *  W8-A2 (ON-7 defect 4) — 'stalled' added: `StandaloneRunState['state']`
 *  (apps/forge/ui-bridge.ts) grew this member (a run whose process died/wedged
 *  with no terminal marker, silent past the stall ceiling) and this union
 *  is the enforcement point for what a standalone row's status may be
 *  (`STANDALONE_STATUSES` below, `isValidStandaloneEntry`) — leaving it
 *  out here would not merely mis-render a stalled row, it would reject the
 *  ENTIRE ledger response as 'unresolved' the moment one appeared (every
 *  item must validate or the whole response is rejected — see
 *  `resolveAgentHistoryFromResponse`'s own doc comment), which is worse
 *  than the defect this fix closes. */
export type AgentStandaloneRunEntry = {
  id: string;
  href: string;
  when: string;
  what: string;
  status: 'running' | 'done' | 'failed' | 'suppressed' | 'budget-exceeded' | 'stalled';
  costUsd: number | null;
  trigger?: LedgerRowTrigger;
};

/** An interactive session (e.g. an architect interview). `status` is that
 *  session's own `status.json` phase string — an OPEN vocabulary forge does
 *  not control, carried verbatim (D12). */
export type AgentSessionRunEntry = {
  id: string;
  href: string;
  when: string;
  what: string;
  status: string;
  costUsd: number | null;
};

// ---------------------------------------------------------------------------
// deriveAgentNodeLedgerSegments — per-NODE, D9
// ---------------------------------------------------------------------------

/**
 * Derive ONE flow-node's own outcome-narrative segments, in canonical order:
 * `in-flow` (always — a fact about the ROW's own run, not `phaseMeta`) →
 * `gate-fails` (dev only) | `node-errors` (every other node, D9) →
 * `review-findings` (adversarial-review only, independent of retries). Never
 * derived from `run.status`/`run.workItems`/any other run-level field —
 * those belong exclusively to `flow-ledger.ts`'s run-level derivation.
 */
export function deriveAgentNodeLedgerSegments(run: Run, nodeId: string): LedgerSegment[] {
  const segments: LedgerSegment[] = [{ kind: 'in-flow', flowId: run.flowId }];

  const nodeMeta = run.phaseMeta[nodeId];
  if (!nodeMeta) return segments;

  if (nodeId === 'dev') {
    // D9: `retries` is a GATE signal ONLY on the dev node.
    if (nodeMeta.retries > 0) {
      segments.push({ kind: 'gate-fails', count: nodeMeta.retries });
    }
  } else if (nodeMeta.retries > 0) {
    // Every other node's `retries` is a real error-event count, NOT a gate
    // outcome (D9) — 'node-errors' says what it honestly is.
    segments.push({ kind: 'node-errors', count: nodeMeta.retries });
  }

  if (nodeId === 'adversarial-review' && nodeMeta.findings && nodeMeta.findings.total > 0) {
    segments.push({
      kind: 'review-findings',
      total: nodeMeta.findings.total,
      blocker: nodeMeta.findings.blocker,
      major: nodeMeta.findings.major,
      minor: nodeMeta.findings.minor,
      info: nodeMeta.findings.info,
    });
  }

  return segments;
}

// ---------------------------------------------------------------------------
// deriveAgentLedgerRows — the three-path join
// ---------------------------------------------------------------------------

function deriveFlowNodeRow(entry: AgentFlowNodeRunEntry): LedgerRow {
  const { run, nodeId, href } = entry;
  const segments = deriveAgentNodeLedgerSegments(run, nodeId);
  const nodeMeta = run.phaseMeta[nodeId];
  return {
    id: run.id,
    when: run.startedAt ?? '',
    what: run.initiative,
    narrative: renderNarrative(segments),
    narrativeKinds: segments.map((s) => s.kind),
    // D9: the NODE's own status/cost, never run.status/run.costUsd.
    status: run.phases[nodeId],
    costUsd: nodeMeta ? nodeMeta.costUsd : null,
    href,
    linkKind: 'flow-node',
    ...(run.trigger !== undefined ? { trigger: run.trigger } : {}),
  };
}

function deriveStandaloneRow(entry: AgentStandaloneRunEntry): LedgerRow {
  const segments: LedgerSegment[] = [{ kind: 'standalone' }];
  return {
    id: entry.id,
    when: entry.when,
    what: entry.what,
    narrative: renderNarrative(segments),
    narrativeKinds: segments.map((s) => s.kind),
    status: entry.status,
    costUsd: entry.costUsd,
    href: entry.href,
    linkKind: 'standalone',
    ...(entry.trigger !== undefined ? { trigger: entry.trigger } : {}),
  };
}

function deriveSessionRow(entry: AgentSessionRunEntry): LedgerRow {
  return {
    id: entry.id,
    when: entry.when,
    what: entry.what,
    // No segment kind applies to a session — honest null, never filler.
    narrative: null,
    narrativeKinds: [],
    status: entry.status,
    costUsd: entry.costUsd,
    href: entry.href,
    linkKind: 'session',
  };
}

/**
 * Assemble the three execution paths into ONE ledger, newest-first (reuses
 * `sortLedgerRowsNewestFirst`, D2). Each path's rows carry that path's own
 * `linkKind` — 'flow-node' | 'standalone' | 'session' — never scrambled
 * across a neighbour.
 */
export function deriveAgentLedgerRows(args: {
  flowNodeEntries: AgentFlowNodeRunEntry[];
  standaloneEntries: AgentStandaloneRunEntry[];
  sessionEntries: AgentSessionRunEntry[];
}): LedgerRow[] {
  const rows: LedgerRow[] = [
    ...args.flowNodeEntries.map(deriveFlowNodeRow),
    ...args.standaloneEntries.map(deriveStandaloneRow),
    ...args.sessionEntries.map(deriveSessionRow),
  ];
  return sortLedgerRowsNewestFirst(rows);
}

// ---------------------------------------------------------------------------
// D10 — the three-state wire resolver, mirrors flow-run-detail-client.ts's
// resolveFlowRunDetailFromResponse exactly.
// ---------------------------------------------------------------------------

export type AgentHistoryResolution =
  | { kind: 'found'; rows: LedgerRow[] }
  | { kind: 'not-found' }
  | { kind: 'unresolved' };

// ---------------------------------------------------------------------------
// ROUND 8/9 — the wire carries per-path ENTRIES (raw facts: `run`+`nodeId`
// for flow-node; `id/href/when/what/status/costUsd[/trigger]` for
// standalone/session), never a pre-derived `LedgerRow` — see this module's
// header + agent-ledger.test.ts's ROUND 8/9 sections for the full ruling.
// Each wire item is tagged with `linkKind`; this resolver validates the
// ENTRY shape for that linkKind, then calls the REAL `deriveAgentLedgerRows`
// to produce rows. `Array.isArray(rows)` alone says nothing about what's
// INSIDE the array; the server's own 200 contract can still arrive with a
// structurally broken item (wrong-typed `costUsd`, an absent field, a
// status outside the row's own closed vocabulary) and this resolver is the
// ONE seam that stands between that wire body and the real `HistoryLedger`
// component, which crashes on exactly this shape (`row.costUsd.toFixed is
// not a function` — its `!== null` guard does not catch `undefined`
// either). See agent-ledger.test.ts's DEFECT 2 battery.
// ---------------------------------------------------------------------------

/** Mirrors `AgentStandaloneRunEntry['status']` exactly. Duplicated as a
 *  runtime array because a TS union has no runtime membership check of its
 *  own — same precedent as session-kinds.ts's `SESSION_STAGES`
 *  (`Object.freeze([...] as const)`), kept in sync by hand. */
const STANDALONE_STATUSES = Object.freeze(['running', 'done', 'failed', 'suppressed', 'budget-exceeded', 'stalled'] as const);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Mirrors `LedgerRowTrigger` (history-ledger.ts) exactly — validated here
 *  because `HistoryLedger.tsx` reads `row.trigger.kind`/`.source`/`.scope`
 *  unconditionally once `row.trigger !== undefined`: the SAME class of
 *  crash DEFECT 2 already named for `costUsd` (self-attack: is there the
 *  same defect one layer down?). */
function isValidTrigger(t: unknown): t is LedgerRowTrigger {
  return isRecord(t) && typeof t.kind === 'string' && typeof t.source === 'string' && (t.scope === null || typeof t.scope === 'string');
}

/**
 * A flow-node wire entry needs `run` (a non-null, non-array object —
 * normalised via `parseRun` below, D2 reuse) plus `nodeId`/`href` as
 * strings. Deliberately SHALLOW: no per-field validation reaches inside
 * `run` itself — there is no precedent anywhere in this codebase for that
 * (`studio-client.ts`'s `fetchRuns` normalizes a raw `Run` via `parseRun`,
 * it does not reject one), and inventing a new nested-validation
 * requirement here is out of scope for this fix (see the task report).
 */
function isValidFlowNodeEntry(e: Record<string, unknown>): boolean {
  return isRecord(e.run) && typeof e.nodeId === 'string' && typeof e.href === 'string';
}

/** `status` is validated against `AgentStandaloneRunEntry`'s own closed
 *  five-member vocabulary (D12) — never widened, never mapped. */
function isValidStandaloneEntry(e: Record<string, unknown>): boolean {
  return (
    typeof e.id === 'string' &&
    typeof e.href === 'string' &&
    typeof e.when === 'string' &&
    typeof e.what === 'string' &&
    (e.costUsd === null || typeof e.costUsd === 'number') &&
    typeof e.status === 'string' &&
    (STANDALONE_STATUSES as readonly string[]).includes(e.status) &&
    (e.trigger === undefined || isValidTrigger(e.trigger))
  );
}

/** A session's own `status.json` phase is a deliberately OPEN vocabulary
 *  (D12) — closed per runner, open across the four-and-growing runners this
 *  module aggregates — so `status` is checked for TYPE only, never against
 *  a closed set. */
function isValidSessionEntry(e: Record<string, unknown>): boolean {
  return (
    typeof e.id === 'string' &&
    typeof e.href === 'string' &&
    typeof e.when === 'string' &&
    typeof e.what === 'string' &&
    (e.costUsd === null || typeof e.costUsd === 'number') &&
    typeof e.status === 'string'
  );
}

/**
 * Pure: status decides FIRST, before body is ever inspected, in both
 * directions — a 404 wins even over a plausible-looking body, and a 2xx
 * with a malformed/absent `rows` never silently degrades to "found, empty"
 * (the server's own contract is "200 always carries `{ rows: [...] }`" —
 * Task 1). Any other status (transient 5xx, an unexpected 4xx) is
 * `'unresolved'` — NEITHER a positive nor a negative fact, so a caller never
 * renders a transient outage as the authoritative "this agent has no
 * history".
 *
 * ROUND 8/9: once `rows` is confirmed to be an array, EVERY element must
 * validate as a well-formed ENTRY for its own declared `linkKind` (an
 * unrecognised/missing `linkKind` has no vocabulary to check against at
 * all, so it is rejected too) or the WHOLE response is rejected as
 * `'unresolved'` — never a silently shortened "drop the bad one, keep the
 * rest" list (a shortened history is its own kind of lie; see the DEFECT 2
 * "CHOSEN BEHAVIOUR" test). Once every item validates, the collected
 * per-path entries are handed to the REAL `deriveAgentLedgerRows` — the
 * derivation half of this module, previously unreached from this resolver
 * (the shipped-blind defect this round fixes).
 */
export function resolveAgentHistoryFromResponse(status: number, body: unknown): AgentHistoryResolution {
  if (status === 404) return { kind: 'not-found' };

  if (status >= 200 && status < 300) {
    const parsed = body && typeof body === 'object' ? (body as { rows?: unknown }) : undefined;
    const rawRows = parsed?.rows;
    if (!Array.isArray(rawRows)) return { kind: 'unresolved' };

    const flowNodeEntries: AgentFlowNodeRunEntry[] = [];
    const standaloneEntries: AgentStandaloneRunEntry[] = [];
    const sessionEntries: AgentSessionRunEntry[] = [];

    for (const raw of rawRows) {
      if (!isRecord(raw)) return { kind: 'unresolved' };
      if (raw.linkKind === 'flow-node') {
        if (!isValidFlowNodeEntry(raw)) return { kind: 'unresolved' };
        flowNodeEntries.push({ run: parseRun(raw.run), nodeId: raw.nodeId as string, href: raw.href as string });
      } else if (raw.linkKind === 'standalone') {
        if (!isValidStandaloneEntry(raw)) return { kind: 'unresolved' };
        standaloneEntries.push({
          id: raw.id as string,
          href: raw.href as string,
          when: raw.when as string,
          what: raw.what as string,
          status: raw.status as AgentStandaloneRunEntry['status'],
          costUsd: raw.costUsd as number | null,
          ...(raw.trigger !== undefined ? { trigger: raw.trigger as LedgerRowTrigger } : {}),
        });
      } else if (raw.linkKind === 'session') {
        if (!isValidSessionEntry(raw)) return { kind: 'unresolved' };
        sessionEntries.push({
          id: raw.id as string,
          href: raw.href as string,
          when: raw.when as string,
          what: raw.what as string,
          status: raw.status as string,
          costUsd: raw.costUsd as number | null,
        });
      } else {
        return { kind: 'unresolved' };
      }
    }

    return { kind: 'found', rows: deriveAgentLedgerRows({ flowNodeEntries, standaloneEntries, sessionEntries }) };
  }

  return { kind: 'unresolved' };
}

/**
 * Fetch + resolve one agent slug's history. No bridge configured, OR a
 * thrown `fetch()` itself, resolves via the pure resolver above called with
 * the sentinel `status: 0` (never a real 2xx/404) and `body: null` — mirrors
 * `fetchFlowRunDetail`'s own convention.
 *
 * Task 3: `res.status` is read into the resolver UNCONDITIONALLY — a failed
 * `res.json()` (the ordinary shape of a real 404, a framework HTML error
 * page) only clears the BODY, never the status, so status still decides
 * first exactly as this module's own docstring above promises. The former
 * bug called `res.json()` unconditionally and let a thrown parse error
 * escape to the OUTER catch, which discards `res.status` entirely and
 * resolves via the sentinel status 0 — turning an authoritative 404 into
 * `'unresolved'` (ROUND 5 DEFECT 1, agent-ledger.test.ts). The body is still
 * always attempted here (never left undrained) — only the FAILURE is
 * contained locally instead of being allowed to erase `res.status`.
 */
export async function fetchAgentHistory(slug: string): Promise<AgentHistoryResolution> {
  try {
    const res = await bridgeFetch(`/api/agents/${encodeURIComponent(slug)}/history`);
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return resolveAgentHistoryFromResponse(res.status, body);
  } catch {
    return resolveAgentHistoryFromResponse(0, null);
  }
}
