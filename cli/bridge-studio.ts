/**
 * Forge Studio bridge routes (M1-2, ADR-027/028).
 *
 * Boolean-returning route module plugged into handleHttp after handleReflect.
 * All routes are read-only GET endpoints; write routes land in M2.
 * POST run/gate routes (M3-4) live in bridge-studio-runs.ts.
 *
 * Routes:
 *   GET /api/runs                           → { runs: Run[] }
 *   GET /api/runs?flow=<id>                 → { runs: Run[] } (filtered)
 *   GET /api/runs/<id>                      → { run: Run }
 *   GET /api/runs/<id>/phases/<node>/log    → { lines } (stderr=1 to filter; raw=1 for the node's own raw EventLogEntry records, R6-01 WI-3/F5)
 *   GET /api/triggers                       → { triggers: {on,target,projects,sourceFlowId}[] } (R2-08-F4)
 *   GET /api/studio/agents                  → { agents: (AgentDefinition & { capability: AgentCapabilityDescriptor })[] }
 *   GET /api/studio/flows                   → { flows: FlowDefinition[] }
 *   GET /api/studio/projects                → { projects }
 *   GET /api/studio/projects/attention      → { attention: ProjectAttentionItem[] } (R4-11-F4)
 *   GET /api/studio/catalog                 → catalog content
 *
 * KB routes (GET + POST) live in bridge-studio-kbs.ts.
 *
 * Returns false for non-matching URLs (passthrough to next handler).
 * Never throws — all errors caught, returned as 4xx/5xx JSON.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { buildNodeMapping, buildAgentSlugToNodeId } from '@forge/flows/run-model.ts';
import { cachedListRuns } from '@forge/flows/run-list-cache.ts';
import { eventToNodeId } from '@forge/flows/run-model-derive.ts';
import { listPlannedInitiatives } from '@forge/flows/planned-initiatives.ts';
import { checkInitiativeDeps } from '@forge/flows/scheduler.ts';
import type { Run } from '@forge/flows/run-model.ts';
import type { EventLogEntry } from '@forge/kernel';
import { listAgentDefinitions, loadFlowDefinition, listFlowIds } from '../orchestrator/studio/registry.ts';
import { loadCatalog } from '@forge/library/studio/catalog-registry.ts';
import { communitySkillsFromRegistry } from '@forge/library/studio/community-registry.ts';
import { listDemoElements } from '@forge/library/studio/artifact-registry.ts';
import { listPlainSkills } from '@forge/library/studio/skill-registry.ts';
import { listHookLibrary } from '@forge/library/studio/hook-library.ts';
import { listFlowBandIds } from '@forge/flows/flow-band-vocab.ts';
import { skillsDir as toSkillsDir } from '@forge/agents/skill-path.ts';
import { resolveGuardedPath } from '@forge/kernel';
import { agentCapabilityDescriptor } from '@forge/agents/studio/derive.ts';
import type { FlowDefinition } from '@forge/contracts/studio/types.ts';
import { SLUG_RE, PROJECT_ID_RE } from '../orchestrator/studio/validate.ts';
import { projectKbBindings } from '@forge/knowledge/kb-sites.ts';
import { defaultConfigPath, loadConfig, resolveDefaultKickoffCeilingUsd } from '@forge/kernel';
import { isSdkAvailable } from '@forge/agents/_adapters/registry.ts';
import { parseManifest, initiativeTitle } from '@forge/flows/manifest.ts';
import { parseWorkItem, WORK_ITEM_FILE_PATTERN } from '@forge/flows/work-item.ts';
import type { WorkItem } from '@forge/flows/work-item.ts';
import type { QueueState } from '@forge/flows/queue.ts';
import { getPaths } from '@forge/flows/queue.ts';
import { provenanceOfOrigin, AGENT_PROVENANCE, type Provenance } from '@forge/kernel';
// M4 §4 (projects routes carve): `GET /api/studio/projects`,
// `/api/studio/starters`, `/api/studio/projects/starters`,
// `/api/studio/projects/:id/preflight`, `/repo-status`,
// `/preflight/fix-agent/:runId` and `/contract-stages` left this file for
// `packages/projects/`. `GET /api/studio/projects/attention` (below) and
// `GET /api/studio/projects/:id/roadmap` (below) did NOT move —
// their helpers (`buildProjectAttention`→`scanProjectManifests`,
// `buildProjectRoadmap`) read `@forge/flows` (queue/manifest/scheduler/
// work-item/run-list-cache), a STRICTLY HIGHER package rank than `projects`
// (kernel=1 < {library,knowledge,projects}=2 < agents=3 < sessions=4 <
// flows=5, `scripts/check-boundaries.mjs`'s PACKAGE_RANK) — carving them
// into `packages/projects/` would be a NEW, unbaselinable `package-layer-
// order` violation (the baseline is a shrink-only ratchet with no
// `--write-baseline`). `loadProjectsWithMeta` DID move (no flows dependency)
// and is imported back here for the one caller (attention) that stayed.
import { loadProjectsWithMeta } from '@forge/projects/project-roster.ts';

// ---------------------------------------------------------------------------
// Context surface needed by studio routes
// ---------------------------------------------------------------------------

// StudioContext, allowedOrigin, sendJson, sanitizeError and pathOnly now live
// in `@forge/kernel` (M4 §4 step 2): every package that carves its routes out
// of this bridge needs them, and a package importing `cli/` is a
// `package-to-legacy` boundary violation. Re-exported here as a transition
// affordance so this module's existing importers are untouched; the re-export
// moves with the host when the host does (flows lane).
export type { StudioContext } from '@forge/kernel';
// …and imported for this module's own use: a re-export does not bind the name
// locally, and several handlers below still call these directly.
import { allowedOrigin, sendJson, sanitizeError, pathOnly, parseQuery, SAFE_ID_RE, type StudioContext } from '@forge/kernel';

/**
 * W8-F6 (bead forge-6gv.27) — "can this bridge actually serve
 * `/sessions/<kind>/<sessionId>`?", INJECTED rather than imported.
 *
 * The one implementation is `sessionIsReadable`
 * (cli/bridge-studio-sessions.ts), which needs this module's own `SAFE_ID_RE`
 * and cli/bridge-studio-kbs.ts's `KB_SEEDING_ANCHOR_PREFIX` — importing it
 * here would make this module the first `bridge-studio.ts` →
 * `bridge-studio-*.ts` edge and close a cycle. `cli/ui-bridge.ts` already
 * imports both modules, so it wires the two together in exactly the way it
 * already wires `ensureSessionTail`.
 *
 * REQUIRED, never optional: an optional probe with a permissive default is the
 * `declared-data-fails-open` shape this campaign keeps paying for — a call site
 * that forgot to wire it would silently stop gating. Required makes that a
 * compile error instead.
 */
export type SessionReadabilityProbe = (args: { kind: string; sessionId: string }) => boolean;

/** `StudioContext` plus the one injected dependency the runs routes need. */
export type StudioRunsContext = StudioContext & { sessionIsReadable: SessionReadabilityProbe };

// Safe-ID guard: blocks path traversal in run/gate IDs. M4 §4 (projects
// routes carve) — HOISTED to `packages/kernel/ids.ts` (next to
// `SLUG_RE`/`PROJECT_ID_RE`) so a carved `packages/projects/` route handler
// needing it never has to import `cli/` (`package-to-legacy`). Imported above
// and re-exported here unchanged: this file no longer DEFINES it, but every
// existing importer (`cli/ui-bridge.ts`, `packages/flows/bridge-studio-runs.ts`,
// `packages/sessions/bridge-studio-sessions.ts`) still reaches it at this path.
export { SAFE_ID_RE };

/** The session phase vocabulary of the four kinds whose runners predate the
 *  ADR-043 phase table now LIVES with the sessions seam
 *  (`packages/sessions/session-phases.ts`) — it is session vocabulary, and the
 *  import cycle that once kept it in this host module ended when the generic
 *  session route moved into that package. Re-exported here so this module's
 *  own consumers keep their single import, exactly as `CANCELLED_PHASE`
 *  below already does. */
export {
  LEGACY_SESSION_TERMINAL_PHASES,
  LEGACY_SESSION_AWAITS_PHASES,
  LEGACY_SESSION_WORKING_PHASES,
} from '@forge/sessions/session-phases.ts';


/** W7-A2 (ADR-043 2026-08-19 amendment §1) — the ONE universal, reserved
 *  terminal phase every session kind shares: written by the generic
 *  `POST /api/studio/sessions/:kind/:sessionId/cancel` route
 *  (cli/bridge-studio-session-cancel.ts) and read as terminal by
 *  `isTerminalPhase` (cli/bridge-studio-sessions.ts) for EVERY kind BEFORE
 *  the per-kind tables are consulted. Deliberately NOT a per-kind
 *  `{ phase: cancelled, step: terminal }` yaml row: "the operator gave up"
 *  is the same fact for all eight kinds, and eight copies of one fact in
 *  eight tables is exactly the drift shape ADR-043's "derived, not authored"
 *  discipline exists to prevent. `deriveSessionAffordances` already yields
 *  `[]` for any phase a table does not name, so a cancelled session derives
 *  no affordance without any table change.
 *
 *  W7-FIX-A2 (W7A2-01): the constant now LIVES at the status-write seam
 *  (`orchestrator/interactive-session.ts`), which enforces the sticky-cancel
 *  rule (`cancelledPhaseWins`) for every writer; re-exported here so the
 *  bridge modules keep their one import. */
export { CANCELLED_PHASE } from '@forge/sessions/interactive-session.ts';





// ---------------------------------------------------------------------------
// Anti-CSRF + CORS helpers
// ---------------------------------------------------------------------------

/** Anti-CSRF sentinel. Any non-GET request must include this header.
 *  The value is a static sentinel — security comes from it being a
 *  non-safelisted header (requires a preflight), not from secrecy. */
export const CSRF_HEADER = 'x-forge-csrf';

/** Regex matching the forge-ui dev origin (any port on localhost/127.0.0.1). */
export { allowedOrigin, sendJson, sanitizeError };

export { pathOnly, parseQuery };

const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MiB

/**
 * Read and parse the JSON request body. Used by write routes.
 * Caps at MAX_BODY_BYTES; destroys the socket and rejects on oversize.
 * Shared helper (mirrors readJson in ui-bridge.ts).
 */
export function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolveJson, rejectJson) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        req.destroy();
        rejectJson(new Error('request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try { resolveJson(raw ? JSON.parse(raw) : {}); } catch (err) { rejectJson(err); }
    });
    req.on('error', rejectJson);
  });
}

// ---------------------------------------------------------------------------
// Phase log line derivation (design §7)
// ---------------------------------------------------------------------------

type LogLineKind = 'info' | 'tool' | 'cost' | 'stderr' | 'retry' | 'reasoning';

type LogLine = { at: string; kind: LogLineKind; text: string; detail?: string };

/**
 * The expandable detail behind a one-line log entry (M3): the agent's actual
 * reasoning text, a tool's inputs, an error reason, and any remaining metadata —
 * so the operator can dig into what an agent actually did, not just a summary.
 */
function eventDetail(e: EventLogEntry): string | undefined {
  const m = (e.metadata ?? {}) as Record<string, unknown>;
  const lines: string[] = [];
  // Reasoning / free text: the agent's thinking stream.
  for (const key of ['text', 'reasoning', 'message'] as const) {
    const v = m[key];
    if (typeof v === 'string' && v.trim() && v.trim() !== e.message) { lines.push(v.trim()); break; }
  }
  if (e.event_type === 'tool_use') {
    if (typeof m.tool_name === 'string') lines.push(`tool: ${m.tool_name}`);
    if (m.input_summary !== undefined) {
      lines.push(`input: ${typeof m.input_summary === 'string' ? m.input_summary : JSON.stringify(m.input_summary)}`);
    }
  }
  if (typeof m.reason === 'string') lines.push(`reason: ${m.reason}`);
  if (typeof m.runner_error === 'string' && m.runner_error) lines.push(`error: ${m.runner_error}`);
  // Any remaining metadata, compactly, for full transparency.
  const shown = new Set(['text', 'reasoning', 'message', 'tool_name', 'input_summary', 'reason', 'runner_error', 'kind', 'work_item_id']);
  const rest = Object.fromEntries(Object.entries(m).filter(([k]) => !shown.has(k)));
  if (Object.keys(rest).length > 0) lines.push(JSON.stringify(rest));
  return lines.length > 0 ? lines.join('\n') : undefined;
}

/**
 * Classify a single EventLogEntry into a log line for the phase log route.
 *
 * kind mapping (design §7):
 *   error                                          → stderr
 *   tool_use                                       → tool
 *   usage_delta / agent_heartbeat / cost-only log  → cost
 *   failure_classification with recoverable=true   → retry
 *   else                                           → info
 */
function classifyEvent(e: EventLogEntry): LogLine {
  let kind: LogLineKind = 'info';

  if (e.message === 'failure_classification' && e.metadata?.recoverable === true) {
    kind = 'retry';
  } else if (e.event_type === 'error') {
    kind = 'stderr';
  } else if (e.event_type === 'tool_use') {
    kind = 'tool';
  } else if (e.event_type === 'log' && e.metadata?.kind === 'reasoning') {
    kind = 'reasoning'; // the agent's thinking stream (#11)
  } else if (
    e.message === 'usage_delta' ||
    e.event_type === 'agent_heartbeat' ||
    (e.cost_usd !== undefined && e.cost_usd > 0 && e.event_type === 'log')
  ) {
    kind = 'cost';
  }

  // Build a concise text from message + brief metadata
  const parts: string[] = [];
  if (e.message) parts.push(e.message);
  if (e.event_type === 'tool_use' && e.metadata?.tool_name) {
    parts.push(`[${String(e.metadata.tool_name)}]`);
  }
  if (e.cost_usd !== undefined && e.cost_usd > 0) {
    parts.push(`$${e.cost_usd.toFixed(4)}`);
  }
  if (kind === 'retry' && e.metadata?.reason) {
    parts.push(`(${String(e.metadata.reason)})`);
  }
  if (parts.length === 0 && e.metadata?.message) {
    parts.push(String(e.metadata.message));
  }
  if (parts.length === 0) {
    parts.push(e.event_type);
  }

  return { at: e.started_at, kind, text: parts.join(' '), detail: eventDetail(e) };
}

// ---------------------------------------------------------------------------
// Runs helpers
// ---------------------------------------------------------------------------

/** Find a Run by id (cycleId or initiativeId). Returns null if not found.
 *  ADR-044 P1: routes through the per-manifest memo (cli/run-list-cache.ts)
 *  — same derivation, same contract as listRuns, but terminal runs skip
 *  re-parsing their events.jsonl once cached.
 *
 *  W7-A3 (projects-32, sessions-kinds-08): a run's `id` CHANGES when the
 *  scheduler claims it (planned = the initiative id; claimed = the cycle id),
 *  so a link minted at enqueue time by run id goes dead on claim. The
 *  initiativeId is the stable handle — match it second, so
 *  `/api/runs/<initiativeId>` (and `/flows/<flow>/run/<initiativeId>`)
 *  resolves the initiative's run in every queue state. Unknown ids still 404
 *  (an INIT- id never collides with a `<iso>_INIT-…` cycle id). */
function findRun(forgeRoot: string, id: string): Run | null {
  const runs = cachedListRuns(forgeRoot, Date.now());
  return runs.find((r) => r.id === id) ?? runs.find((r) => r.initiativeId === id) ?? null;
}

/**
 * W8-F6 (bead forge-6gv.27) — strip `architectSessionId` from any run whose
 * pointed-at session this bridge cannot serve.
 *
 * `architect_session_id` is a STORED pointer on a queue manifest, minted when
 * the architect finished and never re-checked afterwards. Wave 8 started
 * rendering it as a link (`a[data-action="open-architect-session"]`,
 * apps/studio/components/studio/FlowRunDetail.tsx), which is how seven dead
 * `/sessions/architect/<ts>` addresses became first-party 404s in the
 * walkthrough crawl. The route fix makes almost all of them readable again;
 * this closes the remainder — a pointer at a session that exists NOWHERE is
 * not surfaced at all, so no link is minted for it.
 *
 * Derived, never stored: the check runs on every read, so restoring a deleted
 * session dir brings the link back with no write anywhere. Immutable: a
 * stripped run is a NEW object; the cached `Run` (cli/run-list-cache.ts) is
 * never mutated.
 *
 * `kind: 'architect'` is a literal because `architect_session_id`
 * (orchestrator/manifest.ts) carries no kind tag and has exactly ONE writer —
 * `orchestrator/architect-runner.ts:1251`, which writes the id of an ARCHITECT
 * session. That invariant is not enforced anywhere, so a second writer of a
 * differently-kinded session id would silently make this probe ask about the
 * wrong kind; if that day comes, the field needs the kind, not this call site
 * needs a guess. Memoized per request because many manifests of one roadmap
 * share one architect session — 44 manifests, 13 distinct session ids on the
 * reference host, so the memo is the difference between 44 and 13 guarded
 * stats on a polled route. Runs with no pointer (the overwhelming majority)
 * cost nothing at all.
 */
function withReadableSessionPointers(runs: readonly Run[], probe: SessionReadabilityProbe): Run[] {
  const memo = new Map<string, boolean>();
  return runs.map((run) => {
    const sessionId = run.architectSessionId;
    if (sessionId === undefined) return run;
    let readable = memo.get(sessionId);
    if (readable === undefined) {
      readable = probe({ kind: 'architect', sessionId });
      memo.set(sessionId, readable);
    }
    if (readable) return run;
    const { architectSessionId: _unreadable, ...rest } = run;
    return rest;
  });
}

// ---------------------------------------------------------------------------
// `ProjectWithMeta`/`ProjectConfigHealth`, `deriveProjectLocalSkills`,
// `deriveConfigHealth` and `loadProjectsWithMeta` moved to
// `packages/projects/project-roster.ts` (M4 §4 projects routes carve), with
// `GET /api/studio/projects`. `loadProjectsWithMeta` now takes its
// `projectKbBindings` dependency as a parameter (same injected-dependency
// shape `seedProjectBrain` uses) rather than importing `@forge/knowledge`
// itself, which a rank-2 `projects` package may not do.
// ---------------------------------------------------------------------------
// Flows loader
// ---------------------------------------------------------------------------

function loadAllFlows(forgeRoot: string): Array<FlowDefinition & { bands: string[]; provenance: Provenance }> {
  const flowsDir = join(resolve(forgeRoot), 'studio', 'flows');
  // ABSENT is a real, honest answer: nothing is registered yet.
  if (!existsSync(flowsDir)) return [];

  // W7-FIX-A3 (round-2 finding 5): a THROWN read is NOT an empty list. This
  // catch turned an unreadable `studio/flows` (EACCES, ENOTDIR, a transient FS
  // failure) into `200 {flows: []}`, and the run page derives `unregistered`
  // — a real fact about a flow id — from exactly that answered list, so a
  // failed read declared every flow unregistered instead of leaving the page
  // on its retryable unresolved body. Let it throw: the route's own catch
  // sends the 500 the client's fail-closed vocabulary already handles.
  const entries = readdirSync(flowsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  const flows: Array<FlowDefinition & { bands: string[]; provenance: Provenance }> = [];
  for (const entry of entries) {
    const flowYamlPath = join(flowsDir, entry, 'flow.yaml');
    if (!existsSync(flowYamlPath)) continue;
    try {
      const flow = loadFlowDefinition(flowYamlPath);
      // R1-06 WI-2 (group A): attach each flow's REAL derived band vocabulary
      // (cli/flow-band-vocab.ts's listFlowBandIds, WI-1) so the KB-create
      // page's per-flow band picker has something real to source options
      // from over the wire. Fails closed to [] for an underivable flow —
      // handled inside the helper, never re-guessed here.
      // forge-3oq: `origin` stays on the wire unchanged (additive-only) —
      // `provenance` is a DERIVED sibling via the one shared mapping, never
      // a second inline comparison.
      flows.push({ ...flow, bands: listFlowBandIds(forgeRoot, flow.id), provenance: provenanceOfOrigin(flow.origin) });
    } catch {
      // Skip unreadable flow
    }
  }
  return flows;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * Handle Forge Studio read-only GET routes.
 *
 * Returns true if the route was handled (even on error), false for unknown URLs.
 * Never throws — all errors caught, returned as JSON.
 *
 * @param req    - Incoming request (used for origin check)
 * @param res   - Server response
 * @param ctx   - Minimal context: forgeRoot + logsRoot
 * @param rawUrl - Full URL including query string (e.g. '/api/runs?flow=forge-cycle')
 * @param method - HTTP method string
 */
// `readPreflightFixState` moved to `packages/projects/project-preflight-read.ts`
// with its one caller, `GET /api/studio/projects/:id/preflight/fix-agent/:runId`.
export async function handleStudioRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: StudioRunsContext,
  rawUrl: string,
  method: string,
): Promise<boolean> {
  if (method !== 'GET') return false;

  const url = pathOnly(rawUrl);
  const origin = allowedOrigin(req);

  // ---- /api/runs (list) ---------------------------------------------------
  if (url === '/api/runs') {
    try {
      const qs = parseQuery(rawUrl);
      const flowFilter = qs.get('flow');
      // ADR-044 P1: cached per-manifest derivation — see cli/run-list-cache.ts.
      let runs = cachedListRuns(ctx.forgeRoot, Date.now());
      if (flowFilter) {
        // Match by lineage, not just current flowId: a run whose manifest was
        // repointed mid-saga (architect→develop hand-off) stays visible on
        // every flow page in its lineage. Filtering on flowId alone made the
        // selected run's card vanish from the rail on the next
        // cycle-list-changed tick — selection appeared to snap to the top run.
        runs = runs.filter((r) => r.flowId === flowFilter || (r.flowLineage ?? []).includes(flowFilter));
      }
      sendJson(res, 200, { runs: withReadableSessionPointers(runs, ctx.sessionIsReadable) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- /api/runs/planned (develop-able initiatives) -----------------------
  // Stage C: the forge-develop kickoff surface (kind: initiative-select). MUST
  // precede /api/runs/<id> below (else "planned" parses as a run id).
  if (url === '/api/runs/planned') {
    try {
      const planned = listPlannedInitiatives(join(resolve(ctx.forgeRoot), '_queue'));
      sendJson(res, 200, { planned }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- /api/runs/<id>/phases/<node>/log  (must be matched before /api/runs/<id>) ----
  const phaseLogMatch = url.match(/^\/api\/runs\/([^/]+)\/phases\/([^/]+)\/log$/);
  if (phaseLogMatch) {
    const runId = decodeURIComponent(phaseLogMatch[1]);
    const nodeId = decodeURIComponent(phaseLogMatch[2]);

    if (!runId || !nodeId) {
      sendJson(res, 400, { error: 'expected /api/runs/<id>/phases/<node>/log' }, origin);
      return true;
    }

    try {
      const qs = parseQuery(rawUrl);
      const stderrOnly = qs.get('stderr') === '1';
      const wiId = qs.get('wiId') ?? '';
      // R6-01 WI-3 (F5): raw=1 mirrors the stderr=1 convention above — an
      // additive mode on this SAME route, never a new URL. It returns the
      // node's own raw EventLogEntry records (event_type preserved) instead
      // of the classifyEvent-derived {kind,text,at,detail} shape, so the
      // client's shared deriveLogLine (apps/studio/lib/run-log-line.ts) has the
      // fields it needs. D2: PhaseDrawer never passes this, and the
      // classified path below is untouched when raw=1 is absent.
      const rawMode = qs.get('raw') === '1';

      // Guard against path traversal via a crafted runId.
      const safeLogsBase = resolve(ctx.logsRoot);

      // W7-FIX-A3 (A3-02): an id whose log dir does NOT exist literally is
      // resolved the SAME way `GET /api/runs/<id>` resolves it (findRun: cycle
      // id, then the stable INITIATIVE id) — since W7-A3 every run link is
      // minted by initiative id, and `_logs/<initiativeId>` does not exist once
      // the scheduler claims (the run's own id flips to the cycle id). An id
      // findRun does not know (an orphan log dir, or a planned run whose id IS
      // the initiative id) falls through as itself: honest 404 below.
      //
      // ROUND-2 (finding 11): the LITERAL path is probed FIRST, and findRun
      // only runs when it is absent. `findRun` walks the whole queue and
      // rebuilds the run/node/agent maps, re-aggregating the active run's
      // events.jsonl — and PhaseDrawer refetches this route on EVERY WebSocket
      // event for the active run, whose id it already passes as the cycle id.
      // That made a live cycle parse its own event log twice per event. The
      // literal probe is one existsSync; the resolution semantics are
      // unchanged for every id that does not have its own log dir.
      //
      // forge-2zz: this route had NO charset gate at all (unlike every sibling
      // route in this file) and its lexical `resolve()`+`startsWith()` check
      // ran on an UNRESOLVED path — two distinct holes. (a) the route regex
      // `([^/]+)` matches the RAW url, and `decodeURIComponent` (line ~600,
      // above) runs AFTER — so `%2F..%2F` becomes a real separator only once
      // the regex has already approved it; reachable only via a raw request
      // whose percent-encoding a normalizing client would never send verbatim.
      // (b) `resolve()` follows a symlinked `_logs/<charset-valid-id>` straight
      // through, no identity check. Both branches (the literal probe AND the
      // findRun-resolved fallback) now go through `resolveGuardedPath`:
      // `isSafeSegment` rejects any segment containing a separator (closes (a)
      // structurally — a decoded `/` can never become a legal segment), and
      // the realpath identity walk rejects a symlinked/hardlinked leaf dir
      // (closes (b)). The literal-probe-first PERFORMANCE behaviour above is
      // preserved unchanged — guard the literal probe, don't remove it.
      const literalGuard = resolveGuardedPath(safeLogsBase, [runId, 'events.jsonl']);
      const literalHit = literalGuard.ok && literalGuard.exists;
      const resolvedRunId = literalHit ? runId : (findRun(ctx.forgeRoot, runId)?.id ?? runId);

      const guarded = literalHit ? literalGuard : resolveGuardedPath(safeLogsBase, [resolvedRunId, 'events.jsonl']);

      // Preserve the EXISTING status codes exactly (do not "improve" them): a
      // guard REJECTION (bad charset, encoded separator, symlink/hardlink
      // escape, identity mismatch, ...) reads as the pre-existing 400 'invalid
      // run id'; a guard ACCEPTANCE whose leaf does not exist reads as the
      // pre-existing 404. Collapsing 400/404 into one status would close a
      // small existence-probe oracle (whether resolvedRunId was even
      // well-formed vs. merely absent) but that is a deliberate, separate,
      // client-visible change this containment fix does NOT make here — a
      // journey may assert today's codes.
      if (!guarded.ok) {
        sendJson(res, 400, { error: 'invalid run id' }, origin);
        return true;
      }
      if (!guarded.exists) {
        sendJson(res, 404, { error: 'no events.jsonl for run', runId }, origin);
        return true;
      }
      const eventsPath = guarded.realPath;

      // Build node mapping to resolve phase → nodeId. R2-01-F4: also build the
      // agent-slug map so a generic-agent node's events (phase:'orchestrator'
      // + metadata.agent_slug — nodeMapping.get('orchestrator') is null) are
      // resolved via eventToNodeId instead of being silently dropped.
      const nodeMapping = buildNodeMapping(ctx.forgeRoot);
      const agentSlugToNodeId = buildAgentSlugToNodeId(ctx.forgeRoot);

      // Read events, filter to this node, classify, cap last 200
      const raw = readFileSync(eventsPath, 'utf8');
      const events: EventLogEntry[] = [];
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try { events.push(JSON.parse(line) as EventLogEntry); } catch { /* skip malformed */ }
      }

      let nodeEvents = events.filter((e) => eventToNodeId(e.phase, nodeMapping, agentSlugToNodeId, e.metadata) === nodeId);
      // Per-WI scoping (#11): when a WI hex is clicked, show ONLY that WI's own
      // events — each fanOut dev agent has an independent stream, not the pooled
      // dev-loop log. Events already carry metadata.work_item_id.
      if (wiId) {
        nodeEvents = nodeEvents.filter((e) => e.metadata?.work_item_id === wiId);
      }

      if (rawMode) {
        // The node's OWN raw events, event_type intact — same node filter,
        // same last-200 cap as the classified path, but never run through
        // classifyEvent. This is exactly the array already computed above.
        let rawLines = nodeEvents;
        if (rawLines.length > 200) {
          rawLines = rawLines.slice(rawLines.length - 200);
        }
        sendJson(res, 200, { lines: rawLines }, origin);
        return true;
      }

      let lines = nodeEvents.map(classifyEvent);
      if (stderrOnly) {
        lines = lines.filter((l) => l.kind === 'stderr');
      }

      // Cap last 200
      if (lines.length > 200) {
        lines = lines.slice(lines.length - 200);
      }

      sendJson(res, 200, { lines }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- /api/runs/<id> (single run) ----------------------------------------
  const runIdMatch = url.match(/^\/api\/runs\/([^/]+)$/);
  if (runIdMatch) {
    const runId = decodeURIComponent(runIdMatch[1]);
    if (!runId) {
      sendJson(res, 400, { error: 'expected /api/runs/<id>' }, origin);
      return true;
    }
    try {
      const run = findRun(ctx.forgeRoot, runId);
      if (!run) {
        // W7-FIX-A3 (round-2 finding 2): the 404 carries the PER-RUN existence
        // fact. "This run is unknown" and "nothing exists on disk for this id"
        // are different statements, and the artifact page needs the second one
        // to decide not-found (an orphan `_logs/<id>/` — queue manifest gone,
        // artifacts still there — renders its artifact instead of the shared
        // NotFound). Deriving it from whichever artifact the page's `?type=`
        // happened to read made one id render two contradictory pages.
        // The probe goes through the guard family (the request-derived id as
        // its OWN segment under the trusted logs root), so a traversal-shaped
        // id is `false` rather than an existence oracle outside `_logs`.
        const logDir = resolveGuardedPath(ctx.logsRoot, [runId]);
        sendJson(res, 404, { error: 'run not found', onDisk: logDir.ok && logDir.exists }, origin);
        return true;
      }
      sendJson(res, 200, { run: withReadableSessionPointers([run], ctx.sessionIsReadable)[0] }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- /api/triggers (standing trigger declarations, R2-08-F4) -----------
  // Pure read: scans every registered flow's OWN declarations — no write, no
  // materialized index. `projects: null` (absent on the declaration) is kept
  // distinct from `projects: []` (declared empty) all the way to the wire
  // (ADR-027 R2-08 amendment rule 1) — never collapsed into each other.
  if (url === '/api/triggers') {
    try {
      const root = resolve(ctx.forgeRoot);
      const triggers: Array<{ on: string; target: FlowDefinition['triggers'][number]['target']; projects: string[] | null; sourceFlowId: string }> = [];
      for (const flowId of listFlowIds(root)) {
        let flow: FlowDefinition;
        try {
          flow = loadFlowDefinition(join(root, 'studio', 'flows', flowId, 'flow.yaml'));
        } catch {
          continue; // one malformed flow.yaml must not sink the whole listing
        }
        for (const trigger of flow.triggers) {
          triggers.push({
            on: trigger.on,
            target: trigger.target,
            projects: trigger.projects !== undefined ? trigger.projects : null,
            sourceFlowId: flow.id,
          });
        }
      }
      sendJson(res, 200, { triggers }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- /api/studio/agents -------------------------------------------------
  if (url === '/api/studio/agents') {
    try {
      const skillsDir = toSkillsDir(resolve(ctx.forgeRoot));
      const agents = listAgentDefinitions(skillsDir);
      // R2-02-F1: thread the server-computed capability descriptor onto each
      // agent's wire payload — no capability fact may exist only in UI code.
      // R6-04 (WI-2): `defaultCostCeilingUsd` is RUN-LEVEL policy (read from
      // forge.config.json's `runs.defaultCostCeilingUsd`, falling back to
      // the named `DEFAULT_KICKOFF_COST_CEILING_USD` constant) — served as a
      // TOP-LEVEL sibling of `agents`, never nested onto a per-agent object,
      // which would falsely assert the default is agent-specific.
      const defaultCostCeilingUsd = resolveDefaultKickoffCeilingUsd(
        loadConfig(defaultConfigPath(ctx.forgeRoot)),
      );
      sendJson(
        res,
        200,
        {
          // forge-3oq: AGENT_PROVENANCE is the named 'unknown' constant —
          // SKILL.md carries no origin field, so guessing would be exactly
          // the fabricated badge this change exists to remove.
          agents: agents.map((a) => ({ ...a, capability: agentCapabilityDescriptor(a), provenance: AGENT_PROVENANCE })),
          defaultCostCeilingUsd,
        },
        origin,
      );
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // `GET /api/studio/starters` and `GET /api/studio/projects/starters` moved
  // to `packages/projects/project-roster.ts` (M4 §4 projects routes carve).

  // ---- /api/studio/flows --------------------------------------------------
  if (url === '/api/studio/flows') {
    try {
      const flows = loadAllFlows(ctx.forgeRoot);
      sendJson(res, 200, { flows }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- /api/studio/flows/:id (single flow) --------------------------------
  const flowGetMatch = url.match(/^\/api\/studio\/flows\/([^/]+)$/);
  if (flowGetMatch) {
    try {
      const id = decodeURIComponent(flowGetMatch[1]);

      // Slug-guard blocks path traversal before any fs path construction
      if (!SLUG_RE.test(id)) {
        sendJson(res, 400, { error: 'invalid flow id' }, origin);
        return true;
      }

      // Guard symmetry: `PUT /api/studio/flows/:id` was hardened onto the
      // shared realpath identity guard; this GET sibling was left on the
      // lexical `resolve(...).startsWith(...)` shape, which cannot fail for a
      // SLUG_RE-valid id and so let a symlinked `studio/flows/<id>` disclose
      // an outside `flow.yaml`. Same guard, same root, id as its own segment.
      const flowsBase = resolve(ctx.forgeRoot, 'studio', 'flows');
      const guarded = resolveGuardedPath(flowsBase, [id, 'flow.yaml']);
      // A guard rejection and a genuinely absent flow return the SAME 404, so
      // this route cannot be used to probe which ids are planted.
      if (!guarded.ok || !guarded.exists) {
        sendJson(res, 404, { error: 'unknown flow' }, origin);
        return true;
      }

      // forge-3oq review: this is a SECOND construction site for the same
      // flow descriptor `loadAllFlows` builds for the list route above —
      // map it through the identical shared `provenanceOfOrigin` mapping so
      // list and detail can never disagree.
      const flow = loadFlowDefinition(guarded.realPath);
      sendJson(res, 200, { flow: { ...flow, provenance: provenanceOfOrigin(flow.origin) } }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // `GET /api/studio/projects` (roster list) moved to
  // `packages/projects/project-roster.ts` (M4 §4 projects routes carve).

  // ---- /api/studio/projects/attention (R4-11-F4) --------------------------
  // Cross-project "which projects need my attention" aggregate for the
  // library landing strip. One best-effort entry per registered project —
  // a single project's read failure never sinks the whole aggregate.
  //
  // NOT carved (M4 §4 projects routes carve — the blocker is the allow-graph
  // itself, measured, not a ruling): `buildProjectAttention`
  // → `scanProjectManifests` reads `@forge/flows/queue.ts` (`getPaths`,
  // `QueueState`) and `@forge/flows/manifest.ts` (`parseManifest`) — `flows` is
  // a STRICTLY HIGHER package rank than `projects` (kernel=1 <
  // {library,knowledge,projects}=2 < agents=3 < sessions=4 < flows=5), so
  // moving it into `packages/projects/` would be a new, unbaselinable
  // `package-layer-order` violation. `loadProjectsWithMeta` itself DID move
  // (no flows dependency) — imported from `@forge/projects/project-roster.ts`
  // above, with the `projectKbBindings` dependency it needs supplied here,
  // the same injected-dependency shape `seedProjectBrain` uses for the
  // projects-onboard route.
  if (url === '/api/studio/projects/attention') {
    try {
      const projects = loadProjectsWithMeta(ctx.forgeRoot, projectKbBindings);
      const attention = projects.map((p) => buildProjectAttention(p.id, p.name, ctx.forgeRoot, ctx.logsRoot));
      sendJson(res, 200, { attention }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- /api/studio/catalog ------------------------------------------------
  if (url === '/api/studio/catalog') {
    try {
      const catalogPath = join(resolve(ctx.forgeRoot), 'studio', 'catalog.yaml');
      if (!existsSync(catalogPath)) {
        sendJson(res, 404, { error: 'catalog.yaml not found' }, origin);
        return true;
      }
      const catalog = loadCatalog(catalogPath);
      // Reconcile the static yaml `available` flag with the live adapter registry.
      // An SDK is selectable iff a registered adapter reports available — this is
      // the source of truth. When a real Codex/Gemini adapter is registered later,
      // isSdkAvailable flips its flag to true automatically.
      const reconciledSdks = catalog.sdks.map((sdk) => ({
        ...sdk,
        available: isSdkAvailable(sdk.id),
      }));
      // A1: surface the curated community skills as the agent-builder Skills
      // library (the palette reads catalog.skills) so skills are draggable too.
      // R3-01-F2: union in filesystem plain skills (SKILL.md, no runtime block)
      // — e.g. one authored via `/skills/new` — so it appears in the palette on
      // the next fetch with no bridge restart (known-gaps §4.11). Community
      // entries win on an id collision (they carry provenance/stars metadata).
      // W6-CR-1: community skills are declared in studio/community/registry.yaml,
      // not catalog.yaml — tolerant of a missing registry (mirrors loadCatalog's
      // own tolerance a few lines up: a MISSING file degrades gracefully, a
      // MALFORMED one surfaces its real error rather than a silent []).
      const community = communitySkillsFromRegistry(ctx.forgeRoot).map((s) => ({ id: s.id, name: s.name, desc: s.desc }));
      const seen = new Set(community.map((s) => s.id));
      const local = listPlainSkills(ctx.forgeRoot).filter((s) => !seen.has(s.id));
      const skills = [...community, ...local];
      // R3-03-F4: real library hooks (studio/hooks/<id>/) are filesystem-
      // scanned, not catalog rows — union them into the palette the same way
      // listPlainSkills is unioned into `skills` above, so the palette offers
      // REAL hooks, never a fabricated catalog list. Only well-formed (ok:true)
      // hooks are palette-visible — a malformed one has nothing safe to bind.
      const hooks = listHookLibrary(ctx.forgeRoot)
        .filter((h) => h.ok)
        .map((h) => ({ id: h.id, name: h.name, desc: h.description }));
      sendJson(res, 200, { catalog: { ...catalog, sdks: reconciledSdks, skills, hooks } }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- /api/studio/demo-elements ------------------------------------------
  // The forge demo-element library (skill-creating skills) — the palette of demo
  // components an operator composes a demoProcess from. Body (the generator
  // prompt) is omitted; the picker needs only the metadata.
  if (url === '/api/studio/demo-elements') {
    try {
      const elements = listDemoElements(ctx.forgeRoot).map((e) => ({
        id: e.id, name: e.name, phase: e.phase, description: e.description, configHint: e.configHint,
      }));
      sendJson(res, 200, { elements }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // `GET /api/studio/projects/:id/preflight`, `/repo-status` and
  // `/preflight/fix-agent/:runId` moved to
  // `packages/projects/project-preflight-read.ts` (M4 §4 projects routes
  // carve), taking `readPreflightFixState` with them.

  // ---- /api/studio/projects/:id/roadmap -----------------------------------
  // NOT carved (M4 §4 projects routes carve — same allow-graph blocker) — see the note on
  // `GET /api/studio/projects/attention` above: `buildProjectRoadmap` and its
  // helper cluster (`scanProjectManifests`, `completedAtByInitiative`,
  // `readWorkItemsForInitiative`, `tryReadWorkItemDir`) read `@forge/flows`
  // (queue/manifest/scheduler/work-item/run-list-cache), a strictly higher
  // package rank than `projects`; carving them would be a new, unbaselinable
  // `package-layer-order` violation.
  const roadmapMatch = url.match(/^\/api\/studio\/projects\/([^/]+)\/roadmap$/);
  if (roadmapMatch) {
    try {
      const id = decodeURIComponent(roadmapMatch[1]);
      if (!PROJECT_ID_RE.test(id)) {
        sendJson(res, 400, { error: 'invalid project id' }, origin);
        return true;
      }
      const roadmap = buildProjectRoadmap(id, ctx.forgeRoot, ctx.logsRoot);
      sendJson(res, 200, { roadmap }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // `GET /api/studio/projects/:id/contract-stages` moved to
  // `packages/projects/project-roadmap.ts` (M4 §4 projects routes carve) —
  // it drags no flows-dependent helper (`deriveContractStages` is its own
  // package), so it carved cleanly despite living in the same route family
  // as the roadmap route above, which did not.

  return false;
}

// ---------------------------------------------------------------------------
// Roadmap read model (S6 DEC-3 / per-project Roadmap tab)
// ---------------------------------------------------------------------------

export type RoadmapWorkItem = {
  id: string;
  title: string;
  dependsOn: string[];
  /**
   * W6-RV-1: the WI's own status (`WorkItem['status']`, orchestrator/work-item.ts),
   * threaded through from `parseWorkItem` rather than discarded — feeds the
   * roadmap card's "done/total" micro-badge. Optional so a read that predates
   * this field (or a snapshot with no status) never fabricates one.
   */
  status?: WorkItem['status'];
};

export type RoadmapInitiative = {
  initiativeId: string;
  title: string;
  status: QueueState;
  dependsOnInitiatives: string[];
  /**
   * plan-everything-before-kickoff: whether this initiative's build deps are
   * satisfied yet (reuses the scheduler's own `checkInitiativeDeps` gate —
   * only meaningful while `status === 'pending'`; other states default to
   * ready/unblocked since the gate only ever applies at pending-claim time).
   */
  ready: boolean;
  blockedBy: string[];
  /**
   * R4-11-F2: present once the initiative has been decomposed (a WI snapshot
   * exists) — regardless of queue status. This is the "planned" fact the
   * roadmap's per-initiative Plan trigger + blocked-until-planned lock read;
   * a `pending` initiative with no WI snapshot yet is unplanned even though
   * it is otherwise a normal, readable queue entry.
   */
  workItems?: RoadmapWorkItem[];
  /**
   * W6-RV-2: the real cycle-completion instant (ISO), for the roadmap
   * canvas's completion-time X axis — `Run.completedAt`
   * (orchestrator/run-model.ts) threaded straight through via the SAME
   * memoized derivation `GET /api/runs` already uses (`cachedListRuns`,
   * cli/run-list-cache.ts) rather than a second events.jsonl parser. Absent
   * (never fabricated) whenever the run carries no derivable completion —
   * still-open initiatives, and the rare cycle dir with neither a cycle-end
   * event nor ANY non-reflection event at all. An absent completedAt places
   * the card in the canvas's projected zone with an honest "no date" marker.
   */
  completedAt?: string;
};

export type ProjectRoadmap = {
  projectId: string;
  initiatives: RoadmapInitiative[];
};

/** One manifest owned by a project, resolved during a queue-wide scan. */
type ScannedManifestEntry = {
  initId: string;
  status: QueueState;
  /** Bare filename (e.g. `INIT-1.md`) — what `checkInitiativeDeps` expects. */
  file: string;
  manifest: ReturnType<typeof parseManifest>;
};

/**
 * Scan every queue-state dir for manifests owned by `projectId`, in the same
 * first-match-wins precedence ui-bridge/roadmap have always used (in-flight →
 * ready-for-review → merged → done → failed → pending). Shared by
 * `buildProjectRoadmap` and `buildProjectAttention` (R4-11-F4) so there is
 * exactly one manifest-ownership scan, not two.
 */
function scanProjectManifests(projectId: string, forgeRoot: string): ScannedManifestEntry[] {
  const queuePaths = getPaths(join(resolve(forgeRoot), '_queue'));
  const stateDirs: Array<[string, QueueState]> = [
    [queuePaths.inFlight, 'in-flight'],
    [queuePaths.readyForReview, 'ready-for-review'],
    // R4-11-F1: `merged` — the brief pass-through between a confirmed merge
    // and its promotion to `done/` in the same sweep.
    [queuePaths.merged, 'merged'],
    [queuePaths.done, 'done'],
    [queuePaths.failed, 'failed'],
    [queuePaths.pending, 'pending'],
  ];

  const seen = new Set<string>();
  const entries: ScannedManifestEntry[] = [];

  for (const [dir, status] of stateDirs) {
    if (!existsSync(dir)) continue;
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.md'));
    } catch {
      continue;
    }
    for (const file of files) {
      const initId = file.replace(/\.md$/, '');
      if (seen.has(initId)) continue;
      const fp = join(dir, file);
      let manifest: ReturnType<typeof parseManifest>;
      try {
        // W6-RV-1 perf fix: parseManifest already runs matter() internally and
        // now exposes `title` (orchestrator/manifest.ts, additive-optional) —
        // a second matter() call here would parse the same buffer twice on a
        // route the operator UI polls repeatedly.
        manifest = parseManifest(readFileSync(fp, 'utf8'));
      } catch {
        continue;
      }
      if (manifest.project !== projectId) continue;
      seen.add(initId);
      entries.push({ initId, status, file, manifest });
    }
  }

  return entries;
}

/**
 * Build a read-only roadmap for a project by scanning all queue dirs for
 * manifests owned by this project. For each initiative, `workItems` reads
 * WI-*.md from the work-items-snapshot in `_logs/` (or the live worktree)
 * regardless of queue status — decomposition is a fact about the WI
 * snapshot, not a function of which queue dir the manifest sits in
 * (R4-11-F2: a pending initiative can already be planned; the roadmap's
 * Plan-trigger lock reads `workItems === undefined` as "unplanned").
 *
 * Mirrors the queueStatusFor pattern from cli/ui-bridge.ts:195.
 */
/**
 * W6-RV-2: initiativeId → real cycle-completion instant, sourced from the
 * SAME memoized run derivation `GET /api/runs` already uses
 * (`cachedListRuns`, cli/run-list-cache.ts) — reusing it here means the
 * roadmap's completedAt column costs nothing beyond what that route already
 * pays (a warm per-manifest cache hits for free; a cold one pays the exact
 * same events.jsonl parse `aggregateRun` performs either way), rather than a
 * second bespoke events reader. `cachedListRuns` walks the FULL forge-wide
 * queue tree (it has no project filter), so this is a superset scan — cheap
 * because it's the memo's job, not a second parse of anything roadmap-local.
 */
function completedAtByInitiative(forgeRoot: string): Map<string, string> {
  const byInitiative = new Map<string, string>();
  for (const run of cachedListRuns(forgeRoot, Date.now())) {
    if (run.completedAt !== undefined) byInitiative.set(run.initiativeId, run.completedAt);
  }
  return byInitiative;
}

function buildProjectRoadmap(projectId: string, forgeRoot: string, logsRoot: string): ProjectRoadmap {
  const queuePaths = getPaths(join(resolve(forgeRoot), '_queue'));
  const entries = scanProjectManifests(projectId, forgeRoot);
  const completedAtById = completedAtByInitiative(forgeRoot);

  const initiatives: RoadmapInitiative[] = entries.map(({ initId, status, file, manifest }) => {
    // W7-A4 (projects-10 / flows-26): the ONE title derivation the run model
    // also uses — manifest metadata (title: / initiative_id), never a heading.
    const title = initiativeTitle(manifest);

    const items = readWorkItemsForInitiative(initId, manifest.cycle_id ?? null, forgeRoot, logsRoot);
    const workItems = items.length > 0 ? items : undefined;

    const blockedBy = checkInitiativeDeps(file, queuePaths);
    const completedAt = completedAtById.get(initId);

    return {
      initiativeId: initId,
      title,
      status,
      dependsOnInitiatives: manifest.depends_on_initiatives ?? [],
      ready: blockedBy.length === 0,
      blockedBy,
      ...(workItems !== undefined ? { workItems } : {}),
      ...(completedAt !== undefined ? { completedAt } : {}),
    };
  });

  return { projectId, initiatives };
}

// ---------------------------------------------------------------------------
// Cross-project attention aggregate (R4-11-F4)
// ---------------------------------------------------------------------------

export type ProjectAttentionItem = {
  projectId: string;
  name: string;
  /** Link target for the strip item — the project's roadmap tab. */
  link: string;
  /** Count of this project's manifests in `_queue/pending/`. */
  planned: number;
  /** Count in `_queue/in-flight/`. */
  inFlight: number;
  /** Count in `_queue/ready-for-review/` — the `gated` RunStatus (an
   *  operator verdict is pending). */
  gated: number;
  /** Count in `_queue/merged/` (R4-11-F1 transient state). */
  merged: number;
  /** Count of initiatives whose latest `plan.completeness` event (R4-05-F6)
   *  has `flagged: true`. */
  flagged: number;
};

/** Queue states an attention strip cares about — done/failed are terminal
 *  and carry nothing left for the operator to act on. */
const ATTENTION_BEARING_STATES: ReadonlySet<QueueState> = new Set([
  'pending',
  'in-flight',
  'ready-for-review',
  'merged',
]);

/**
 * Build the cross-project attention summary for one project. Reuses the same
 * manifest-ownership scan as `buildProjectRoadmap` — no second queue scan.
 * Best-effort throughout: an unreadable manifest or missing event log never
 * throws, it just doesn't count toward that initiative.
 */
function buildProjectAttention(
  projectId: string,
  name: string,
  forgeRoot: string,
  logsRoot: string,
): ProjectAttentionItem {
  const entries = scanProjectManifests(projectId, forgeRoot);

  let planned = 0;
  let inFlight = 0;
  let gated = 0;
  let merged = 0;
  let flagged = 0;

  for (const { initId, status, manifest } of entries) {
    if (!ATTENTION_BEARING_STATES.has(status)) continue;

    if (status === 'pending') planned += 1;
    else if (status === 'in-flight') inFlight += 1;
    else if (status === 'ready-for-review') gated += 1;
    else if (status === 'merged') merged += 1;

    if (isCompletenessFlagged(initId, manifest.cycle_id ?? null, logsRoot)) {
      flagged += 1;
    }
  }

  return { projectId, name, link: `/projects/${projectId}`, planned, inFlight, gated, merged, flagged };
}

/**
 * Whether an initiative's LATEST `plan.completeness` event (R4-05-F6, emitted
 * by orchestrator/phases/project-manager.ts on the PM pass's success path)
 * has `metadata.flagged === true`.
 *
 * Bound: exactly ONE file read per initiative — `_logs/<cycleId>/events.jsonl`
 * — scanned line-by-line from the end (mirrors readPreflightFixState's
 * reverse-scan-for-latest-event pattern above) so a re-decomposition's newer
 * event is the one that counts, without needing a second full-file pass.
 * Best-effort: any missing cycle/file/malformed line is treated as
 * "not flagged" rather than thrown — never sinks the whole aggregate.
 */
function isCompletenessFlagged(
  initId: string,
  cycleIdFromManifest: string | null,
  logsRoot: string,
): boolean {
  const logsRootAbs = resolve(logsRoot);
  const cycleId = cycleIdFromManifest ?? discoverCycleIdFromLogs(logsRootAbs, initId);
  if (!cycleId) return false;
  const evPath = join(logsRootAbs, cycleId, 'events.jsonl');
  if (!existsSync(evPath)) return false;
  let raw: string;
  try {
    raw = readFileSync(evPath, 'utf8');
  } catch {
    return false;
  }
  for (const line of raw.split('\n').reverse()) {
    if (!line.trim()) continue;
    let ev: { message?: string; metadata?: { flagged?: boolean } };
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.message === 'plan.completeness') {
      return ev.metadata?.flagged === true;
    }
  }
  return false;
}

/**
 * Read work items for an initiative, independent of its queue status. Tries
 * the work-items-snapshot in `_logs/<cycleId>/` first (reliable for
 * done/in-flight); falls back to the live worktree spec if the snapshot
 * isn't present yet. Always returns an array — `[]` (never `undefined`)
 * when nothing is found, so callers decide what an empty result means.
 */
function readWorkItemsForInitiative(
  initId: string,
  cycleId: string | null,
  forgeRoot: string,
  logsRoot: string,
): RoadmapWorkItem[] {
  const logsRootAbs = resolve(logsRoot);
  const forgeRootAbs = resolve(forgeRoot);

  // 1. Snapshot path (post-PM, reliable for done cycles).
  if (cycleId) {
    const snapshotDir = join(logsRootAbs, cycleId, 'work-items-snapshot');
    const items = tryReadWorkItemDir(snapshotDir);
    if (items !== null) return items;
  }
  // 2. Also try discovering the cycleId from logs dir if not stamped on manifest.
  if (!cycleId) {
    const discovered = discoverCycleIdFromLogs(logsRootAbs, initId);
    if (discovered) {
      const snapshotDir = join(logsRootAbs, discovered, 'work-items-snapshot');
      const items = tryReadWorkItemDir(snapshotDir);
      if (items !== null) return items;
    }
  }
  // 3. Live worktree path (in-flight cycle, PM just ran).
  const liveDir = join(forgeRootAbs, '_worktrees', initId, '.forge', 'work-items');
  const items = tryReadWorkItemDir(liveDir);
  return items ?? [];
}

/** Try to read WI-*.md files from a directory; returns null if dir absent. */
function tryReadWorkItemDir(dir: string): RoadmapWorkItem[] | null {
  if (!existsSync(dir)) return null;
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => WORK_ITEM_FILE_PATTERN.test(f)); // SSOT: orchestrator/work-item.ts
  } catch {
    return null;
  }
  if (files.length === 0) return null;
  const items: RoadmapWorkItem[] = [];
  for (const file of files) {
    try {
      const raw = readFileSync(join(dir, file), 'utf8');
      const wi = parseWorkItem(raw);
      // Extract title from WI body: first heading line or fall back to id.
      const titleMatch = raw.match(/^##?\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1].trim() : wi.work_item_id;
      items.push({ id: wi.work_item_id, title, dependsOn: wi.depends_on, status: wi.status });
    } catch {
      // skip unparseable WI
    }
  }
  return items;
}

/** Scan _logs/ for the latest cycle dir belonging to initId. */
function discoverCycleIdFromLogs(logsRoot: string, initId: string): string | null {
  if (!existsSync(logsRoot)) return null;
  try {
    const dirs = readdirSync(logsRoot).filter((d) => d.endsWith(`_${initId}`));
    if (dirs.length === 0) return null;
    dirs.sort();
    return dirs[dirs.length - 1] ?? null;
  } catch {
    return null;
  }
}

// Write routes (PUT agents/projects/flows) live in bridge-studio-writes.ts.
// Re-export for callers that still import from this module.
export { handleStudioWriteRoutes } from './bridge-studio-writes.ts';
