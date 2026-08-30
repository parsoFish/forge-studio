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
import { basename, join, resolve, sep } from 'node:path';

import { runPreflight } from './preflight.ts';
import { classifyClause } from './preflight-resolve.ts';
import { hasPendingStudioChanges, STUDIO_BRANCH } from '../orchestrator/project-repo-tx.ts';
import { buildNodeMapping, buildAgentSlugToNodeId } from '../orchestrator/run-model.ts';
import { cachedListRuns } from './run-list-cache.ts';
import { eventToNodeId } from '../orchestrator/run-model-derive.ts';
import { listPlannedInitiatives } from '../orchestrator/planned-initiatives.ts';
import { checkInitiativeDeps } from '../orchestrator/scheduler.ts';
import type { Run } from '../orchestrator/run-model.ts';
import type { EventLogEntry } from '../orchestrator/logging.ts';
import {
  listAgentDefinitions,
  listStarterAgents,
  // (listProjectStarters imported below from project-create)
  loadStarterFlow,
  loadFlowDefinition,
  listFlowIds,
  discoverProjects,
  loadCatalog,
  communitySkillsFromRegistry,
  listDemoElements,
  listPlainSkills,
} from '../orchestrator/studio/registry.ts';
import { listHookLibrary } from '../orchestrator/studio/hook-library.ts';
import { listFlowBandIds } from './flow-band-vocab.ts';
import { listProjectStarters } from '../orchestrator/project-create.ts';
import { skillsDir as toSkillsDir } from '../orchestrator/skill-path.ts';
import { resolveGuardedPath, guardedFile, guardedReadFile, guardedReadDir } from './studio-path-guard.ts';
import { agentCapabilityDescriptor } from '../orchestrator/studio/derive.ts';
import type { FlowDefinition } from '../orchestrator/studio/types.ts';
import { SLUG_RE, PROJECT_ID_RE } from '../orchestrator/studio/validate.ts';
import { projectKbBindings } from './kb-sites.ts';
import { defaultConfigPath, loadConfig, resolveProjectsDir, resolveDefaultKickoffCeilingUsd } from '../orchestrator/config.ts';
import { deriveContractStages } from './contract-stages.ts';
import { isSdkAvailable } from '../loops/_adapters/registry.ts';
import { parseManifest, initiativeTitle } from '../orchestrator/manifest.ts';
import {
  AGENT_INSTRUCTION_FILES,
  validateProjectConfig,
  readQualityGateSidecar,
  injectSidecarIntoTestProcess,
} from '../orchestrator/project-config.ts';
import { parseWorkItem, WORK_ITEM_FILE_PATTERN } from '../orchestrator/work-item.ts';
import type { WorkItem } from '../orchestrator/work-item.ts';
import type { QueueState } from '../orchestrator/queue.ts';
import { getPaths } from '../orchestrator/queue.ts';
import { provenanceOfOrigin, AGENT_PROVENANCE, PROJECT_PROVENANCE, type Provenance } from './studio-provenance.ts';

// ---------------------------------------------------------------------------
// Context surface needed by studio routes
// ---------------------------------------------------------------------------

export type StudioContext = {
  forgeRoot: string;
  logsRoot: string;
};

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

// Safe-ID guard: blocks path traversal in run/gate IDs
export const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** W6-B2 review fix (MEDIUM 2) — terminal-phase sets for the four legacy
 *  session kinds that predate `studio/session-kinds.yaml`'s `turnSpec`
 *  table (architect/instructions/demo/project-brain never declare a
 *  `turnSpec`, so there is no `step: terminal` row to derive a terminal set
 *  from for them, unlike kb-cleanup/authoring). This is the SAME
 *  terminal-phase knowledge cli/ui-bridge.ts's four per-kind list routes
 *  already gate `ensureSessionTail` on — extracted here, into ONE named
 *  constant BOTH cli/ui-bridge.ts (those four routes) and
 *  cli/bridge-studio-sessions.ts (the generic `/api/studio/sessions/:kind/
 *  :id` route) import, so neither hand-writes its own copy. Lives in this
 *  shared, dependency-free module (not cli/ui-bridge.ts) specifically to
 *  avoid a cli/bridge-studio-sessions.ts → cli/ui-bridge.ts → cli/
 *  bridge-studio-sessions.ts import cycle (ui-bridge.ts already imports
 *  handleStudioSessionsRoutes FROM bridge-studio-sessions.ts). Keyed by
 *  session-kind id — the SAME string SPAWN_AGENT_SPECS's `logPrefix` uses
 *  (cli/ui-bridge.ts's `ensureSessionTail` doc comment), so `descriptor.id`
 *  indexes directly with no translation. */
export const LEGACY_SESSION_TERMINAL_PHASES: Readonly<Record<string, ReadonlySet<string>>> = {
  architect: new Set(['committed', 'rejected']),
  instructions: new Set(['committed', 'rejected']),
  demo: new Set(['locked', 'abandoned']),
  'project-brain': new Set(['committed', 'abandoned']),
};

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
export { CANCELLED_PHASE } from '../orchestrator/interactive-session.ts';

/** W7-A2 — operator-gate phases for the two kinds that carry NEITHER a
 *  `turnSpec` nor a `panel` table (architect — permanently bespoke per
 *  ADR-043 amendment §4 — and project-brain): which phases WAIT ON THE
 *  OPERATOR, and for what (`questions` | `verdict`, the SAME AWAITS_KINDS
 *  vocabulary the yaml rows use). The lifecycle derivation
 *  (cli/bridge-studio-lifecycle.ts) reads a table-bearing kind's `awaits:`
 *  from its own phase row and falls back to THIS table for the two legacy
 *  kinds — mirroring how `isTerminalPhase` falls back to
 *  `LEGACY_SESSION_TERMINAL_PHASES` immediately above. Sourced from the
 *  runners' own phase vocabularies: `ArchitectPhase`
 *  (orchestrator/architect-runner.ts) and `ProjectBrainPhase`
 *  (orchestrator/project-brain-builder-runner.ts) + the two bespoke panels
 *  (SessionArchitectPanel / SessionProjectBrainPanel), which render an
 *  operator control at exactly these phases and nowhere else. */
export const LEGACY_SESSION_AWAITS_PHASES: Readonly<Record<string, Readonly<Record<string, 'questions' | 'verdict'>>>> = {
  architect: { 'awaiting-answers': 'questions', 'awaiting-verdict': 'verdict' },
  'project-brain': { briefing: 'questions', 'awaiting-review': 'verdict' },
};

/** W7-A2 — the AGENT-WORKING phases for the same two legacy kinds (the
 *  twin of a table-bearing kind's `step: agent | finalize` rows): a session
 *  sitting here is the runner's to advance, so silence past the stall
 *  ceiling means "stalled", never "needs you". Same sourcing as
 *  LEGACY_SESSION_AWAITS_PHASES above. */
export const LEGACY_SESSION_WORKING_PHASES: Readonly<Record<string, ReadonlySet<string>>> = {
  architect: new Set(['interviewing', 'exploring', 'drafting', 'finalizing']),
  'project-brain': new Set(['analyzing', 'committing']),
};

// ---------------------------------------------------------------------------
// Anti-CSRF + CORS helpers
// ---------------------------------------------------------------------------

/** Anti-CSRF sentinel. Any non-GET request must include this header.
 *  The value is a static sentinel — security comes from it being a
 *  non-safelisted header (requires a preflight), not from secrecy. */
export const CSRF_HEADER = 'x-forge-csrf';

/** Regex matching the forge-ui dev origin (any port on localhost/127.0.0.1). */
const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/**
 * Returns the request's Origin if it matches the forge-ui dev-origin pattern,
 * otherwise returns 'null' (the literal string that signals "no access").
 * Used to tighten CORS beyond the old wildcard.
 */
export function allowedOrigin(req: IncomingMessage, _pattern?: RegExp): string {
  const origin = req.headers?.['origin'];
  if (typeof origin === 'string' && LOCAL_ORIGIN_RE.test(origin)) return origin;
  return 'null';
}

export function sendJson(res: ServerResponse, status: number, body: unknown, origin = 'null'): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': origin,
    'vary': 'origin',
  });
  res.end(payload);
}

/**
 * Strip absolute filesystem paths from error strings before sending them to
 * the browser. Prevents leaking the operator's directory layout.
 * Pattern: any token starting with / that looks like a path segment.
 * Exported so alias catch-blocks in ui-bridge.ts can reuse it (M2).
 */
export function sanitizeError(err: unknown): string {
  return String(err).replace(/\/[^\s:,'"]+/g, '[path]');
}

/** Parse the query-string from a URL string (e.g. '/api/runs?flow=forge-cycle'). */
export function parseQuery(rawUrl: string): URLSearchParams {
  const idx = rawUrl.indexOf('?');
  return new URLSearchParams(idx >= 0 ? rawUrl.slice(idx + 1) : '');
}

/** Strip the query-string from a URL string. */
export function pathOnly(rawUrl: string): string {
  const idx = rawUrl.indexOf('?');
  return idx >= 0 ? rawUrl.slice(0, idx) : rawUrl;
}

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
// Projects with merged project.json data
// ---------------------------------------------------------------------------

type ProjectWithMeta = {
  id: string;
  name: string;
  path: string;
  northStar?: string;
  kb?: string;
  instructions?: string;
  /** Where `instructions` came from: the agent-instruction file (single source —
   *  `AGENTS.md`, or legacy `CLAUDE.md`) or the legacy project.json field. Drives
   *  the read-only (file-bound) vs editable (json) UI binding. */
  instructionsSource?: 'AGENTS.md' | 'CLAUDE.md' | 'project.json';
  skills?: string[];
  demoProcess?: Array<{ kind: string; text: string; element?: string }>;
  /** True when a demo-builder run has locked a reproducible demo into the repo
   *  (`.forge/demo/demo.lock.json`) — drives the "update the demo" entry + the
   *  locked-demo indicator on the project page. */
  hasLockedDemo?: boolean;
  /** forge-3oq: always PROJECT_PROVENANCE ('unknown') — Studio has no OOTB-
   *  project concept and discoverProjects is a pure directory scan, so the
   *  server has no field to attest either provenance from. */
  provenance: Provenance;
  /** W8-C3 (projects-08 / forge-j1e): the project's contract health, DERIVED
   *  on every read by running `.forge/project.json` through the SAME
   *  validator the orchestrator runs the project through
   *  (`validateProjectConfig`). Never persisted — there is no field on disk a
   *  writer could forget to update, so it cannot go stale. Always present. */
  configHealth: ProjectConfigHealth;
  /** W8-C3 (projects-06 / projects-43): the ids of skills that live INSIDE this
   *  project (`.forge/skills/<id>/SKILL.md` — the shape the forge<->project
   *  contract already names, docs/forge-project-contract.md:445). Derived from
   *  disk on every read, never stored. `[]` means "we looked and found none",
   *  which is a different fact from an absent field. */
  localSkills: string[];
};

/**
 * W8-C3 (projects-08 / forge-j1e) — the derived contract-health verdict for
 * one project.
 *
 * · `ok`           — `.forge/project.json` exists, parses, and `validateProjectConfig` accepts it.
 * · `unconfigured` — the project directory exists but carries no `.forge/project.json` at all
 *                    (half-onboarded; `discoverProjects` deliberately still lists it).
 * · `invalid`      — the file is present but unreadable, is not JSON, or the REAL validator
 *                    rejects it (e.g. the R1-03 legacy flat gate keys — gitpulse's live state,
 *                    the shape `GET /api/studio/projects/:id/contract-stages` already 409s on).
 *
 * `reason` is the validator's OWN message wherever one exists, never a
 * re-worded copy: a copy is a second source of truth that drifts.
 */
const NO_PROJECT_CONFIG_REASON = 'no .forge/project.json — onboarding is unfinished';

export type ProjectConfigHealth = {
  state: 'ok' | 'unconfigured' | 'invalid';
  reason?: string;
};

/**
 * Derive one project's contract health from the parsed config.
 *
 * REVIEW ROUND 1 (S1) — this used to call `validateProjectConfig(raw)` on the
 * bare parsed JSON and claim, in three places, that it was "the SAME validator
 * the orchestrator runs the project through". **That claim was false**, and a
 * hostile review refuted it with a live project: `loadProjectConfig`
 * (`orchestrator/project-config.ts`) reads the `.forge/quality_gate_cmd`
 * sidecar and calls `injectSidecarIntoTestProcess` BEFORE validating, so a
 * project that single-sources its local gate from the sidecar — a supported,
 * documented R1-03-F1 shape, and the shape the live
 * `terraform-provider-betterado` project is in — was accepted by the
 * orchestrator and reported `invalid` / "contract broken" by this roster. A
 * healthy, actively-run project rendered bold red on the very index whose
 * purpose is telling broken from healthy: this lane's own defect class,
 * reshipped as a FALSE NEGATIVE.
 *
 * So the loader's pre-validation step happens here too, through the SAME
 * exported helper the loader uses (`injectSidecarIntoTestProcess`, whose own
 * docstring calls itself "the ONE sidecar-injection rule ... shared by the
 * loader and the bridge's PUT-validation copy") — never a re-implementation.
 * `cli/bridge-studio-project-health.test.ts` pins PARITY rather than adding a
 * third fixture: for every shape, `state === 'ok'` iff `loadProjectConfig`
 * accepts it, because a disagreement in EITHER direction is the defect.
 *
 * `sidecarCmd` is read by the CALLER, which owns every filesystem decision, so
 * this function stays pure.
 */
function deriveProjectLocalSkills(projectsDir: string, dirName: string): string[] {
  const entries = guardedReadDir(projectsDir, [dirName, '.forge', 'skills']);
  if (entries === null) return [];
  // A bare directory is not a skill: the SKILL.md is what makes an id
  // bindable, and offering a directory with no SKILL.md would re-create
  // projects-43 in the picker itself (an id that resolves to nothing).
  // Every leaf read rides the SAME per-segment guard as the rest of this
  // function (SEC-04): a symlinked skill dir escaping projectsDir is refused.
  return entries
    .filter((entry) => guardedFile(projectsDir, [dirName, '.forge', 'skills', entry, 'SKILL.md'], 'read') !== null)
    .sort((a, b) => a.localeCompare(b));
}

function deriveConfigHealth(raw: unknown, sidecarCmd: string[] | null): ProjectConfigHealth {
  try {
    // Injection MUTATES its argument, so it gets a shallow copy — the caller's
    // `raw` is still read for name/northStar/skills/... afterwards and must not
    // be altered underneath it (return new objects, never mutate inputs).
    const forValidation: unknown =
      raw !== null && typeof raw === 'object' && !Array.isArray(raw)
        ? { ...(raw as Record<string, unknown>) }
        : raw;
    if (sidecarCmd && forValidation !== null && typeof forValidation === 'object') {
      injectSidecarIntoTestProcess(forValidation as Record<string, unknown>, sidecarCmd);
    }
    validateProjectConfig(forValidation);
    return { state: 'ok' };
  } catch (err) {
    return { state: 'invalid', reason: err instanceof Error ? err.message : String(err) };
  }
}

function loadProjectsWithMeta(forgeRoot: string): ProjectWithMeta[] {
  // B1: projects are auto-discovered from disk — scan `<projectsDir>/*` rather
  // than reading a registry file. All discovered dirs are listed (a
  // half-onboarded dir without `.forge/project.json` still surfaces, with
  // id-as-name defaults, so the operator can SEE it and finish onboarding —
  // `forge studio lint` warns about the missing contract file separately).
  const projectsDir = resolveProjectsDir(resolve(forgeRoot), loadConfig(defaultConfigPath(forgeRoot)));
  const discovered = discoverProjects(projectsDir, forgeRoot);
  // W7-A4 (projects-34): a project's KB is DERIVED from the KB whose
  // `binding: { kind: project, ref: <id> }` names it — the descriptor is the
  // source of truth; nothing is stored back. Exact-match on the case-preserving
  // id (`trafficGame` ↔ `trafficGame`). An explicit project.json `kb` (an
  // operator rebind) still wins below.
  const kbBoundToProject = projectKbBindings(forgeRoot);

  return discovered.map((ref) => {
    // W8-C3: `configHealth` starts PESSIMISTIC. Every path below that learns
    // better overwrites it; a path that learns nothing leaves the project
    // honestly marked unconfigured rather than fabricating health. The whole
    // defect this closes was a fail-OPEN default, so the default fails closed.
    const result: ProjectWithMeta = {
      id: ref.id,
      name: ref.id,
      path: ref.path,
      provenance: PROJECT_PROVENANCE,
      configHealth: { state: 'unconfigured', reason: NO_PROJECT_CONFIG_REASON },
      // Derived BEFORE any config short-circuit below: a project whose config
      // is broken or missing is exactly the one whose bindings the operator
      // needs to see in order to fix it.
      localSkills: deriveProjectLocalSkills(projectsDir, basename(ref.absPath)),
    };
    // SEC-04 (bd forge-ebj): every read of a per-project leaf rides `guardedFile`
    // against the TRUSTED `projectsDir` root, with the on-disk project directory
    // NAME (`basename(ref.absPath)`, not the API-facing normalized id) as its OWN
    // `segments[]` element — never folded into the root. A project dir that is a
    // symlink escaping `projectsDir`, or a symlinked/hardlinked leaf
    // (`AGENTS.md`/`demo.lock.json`/`project.json`) inside an otherwise real
    // dir, is refused (`null`) rather than followed off-root. Replaces the
    // former raw `readAgentInstructionsFile(ref.absPath)` + `existsSync`/
    // `readFileSync(join(ref.absPath, …))` sinks that resolved the leaf outside
    // any per-segment identity guard.
    const dirName = basename(ref.absPath);
    // Instructions are single-sourced from the project's AGENTS.md (Stage A):
    // when it exists, its content IS the instructions and the UI binds read-only
    // to it. Read it BEFORE the no-config early-return — an AGENTS.md can precede
    // a full `.forge/project.json` (so a half-onboarded project still surfaces it).
    for (const file of AGENT_INSTRUCTION_FILES) {
      const content = guardedReadFile(projectsDir, [dirName, file]);
      if (content !== null && content.trim()) {
        result.instructions = content.trim();
        result.instructionsSource = file as 'AGENTS.md' | 'CLAUDE.md';
        break;
      }
    }
    const agentFile = result.instructions !== undefined;
    // Locked-demo state (read regardless of project.json) — the demo-builder lock.
    result.hasLockedDemo =
      guardedFile(projectsDir, [dirName, '.forge', 'demo', 'demo.lock.json'], 'read') !== null;
    const derivedKb = kbBoundToProject.get(ref.id);
    if (derivedKb !== undefined) result.kb = derivedKb;
    // `discoverProjects` deliberately lists a directory with no
    // `.forge/project.json` so a half-onboarded project stays VISIBLE. Before
    // W8-C3 it was visible AND indistinguishable from a fully-onboarded one.
    if (!ref.hasConfig) return result;
    const projectJsonRaw = guardedReadFile(projectsDir, [dirName, '.forge', 'project.json']);
    if (projectJsonRaw === null) {
      // `hasConfig` said the file is on disk, so this is a real read failure or
      // a containment refusal (a symlinked config escaping projectsDir) — NOT
      // the same thing as "never onboarded".
      result.configHealth = { state: 'invalid', reason: '.forge/project.json is present but could not be read' };
      return result;
    }
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(projectJsonRaw) as Record<string, unknown>;
    } catch (err) {
      result.configHealth = {
        state: 'invalid',
        reason: `.forge/project.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      };
      return result;
    }
    // The verdict is taken from the REAL validator — with the SAME sidecar
    // injection the orchestrator's own loader performs (review round 1, S1) —
    // and the field extraction below runs REGARDLESS of it: a project whose
    // contract is broken must still be nameable and openable, or the operator
    // cannot go fix it.
    //
    // The sidecar rides the projectsDir-rooted guard: `readQualityGateSidecar`
    // treats its argument as a TRUSTED root, so it is handed the guard's
    // verified realpath for this project dir, never `join(projectsDir,
    // dirName)` — folding a request-derived name into a trusted root is the
    // SEC-04 shape the rest of this function exists to avoid.
    const guardedProjectRoot = resolveGuardedPath(projectsDir, [dirName]);
    const sidecarCmd = guardedProjectRoot.ok && guardedProjectRoot.exists
      ? readQualityGateSidecar(guardedProjectRoot.realPath)
      : null;
    result.configHealth = deriveConfigHealth(raw, sidecarCmd);
    try {
      if (typeof raw.name === 'string' && raw.name.trim()) result.name = raw.name.trim();
      if (typeof raw.northStar === 'string') result.northStar = raw.northStar;
      // W7-FIX-A4: the STORED `kb` outranks the derived binding in BOTH
      // directions — a string is an explicit rebind, an explicit `null` is an
      // explicit UNBIND (the operator cleared the binding in KbBind; see
      // `apps/studio/lib/project-save-payload.ts`). Honouring only the string
      // made the unbind un-stickable: the PUT wrote `kb: null` and the very
      // next roster read handed the derived binding straight back. An ABSENT
      // key (and only an absent key) leaves the derivation live.
      if (typeof raw.kb === 'string') result.kb = raw.kb;
      else if (raw.kb === null) delete result.kb;
      // Only fall back to the legacy project.json `instructions` field when no
      // agent-instruction file exists (the agent file always wins — single source).
      if (!agentFile && typeof raw.instructions === 'string') {
        result.instructions = raw.instructions;
        result.instructionsSource = 'project.json';
      }
      if (Array.isArray(raw.skills) && raw.skills.every((s) => typeof s === 'string')) {
        result.skills = raw.skills as string[];
      }
      // Surface the typed demo steps so the editor + ContractReadiness reflect
      // a persisted demo. CARRY the optional `element` (the library element-kind
      // a step composes from) — without it the UI can't show per-element controls
      // and a save round-trip would silently drop the binding.
      if (Array.isArray(raw.demoProcess)) {
        result.demoProcess = (raw.demoProcess as Array<Record<string, unknown>>)
          .filter((s) => s && typeof s.kind === 'string' && typeof s.text === 'string')
          .map((s) => ({
            kind: s.kind as string,
            text: s.text as string,
            ...(typeof s.element === 'string' && s.element ? { element: s.element as string } : {}),
          }));
      }
    } catch (err) {
      // W8-C3: this used to be a SILENT swallow (`catch { /* ignore */ }`) —
      // the exact fail-open shape this WI closes. Every read above is
      // typeof-guarded so a throw here means the config is shaped in a way we
      // genuinely cannot read; say so rather than returning a project that
      // looks healthy. Still per-project: one bad config never sinks the roster.
      result.configHealth = {
        state: 'invalid',
        reason: `.forge/project.json could not be read: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    return result;
  });
}

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
/** Read a preflight-fix run's terminal state from its event log. Mirrors
 *  readBrainFixState — a local log reader so the bridge needn't import the
 *  SDK-laden runner module. */
function readPreflightFixState(
  forgeRoot: string,
  runId: string,
): { state: 'running' | 'cleared' | 'not-cleared' | 'failed'; cleared: boolean } {
  // Containment (forge-2zz): `runId` reaching here is only SAFE_ID_RE-gated
  // (charset only, never realpath) at the calling route above — route it
  // through the shared resolveGuardedPath so a symlinked
  // `_logs/_preflight-fix-<runId>` cannot be read through. `_preflight-fix-
  // <runId>` and 'events.jsonl' are each single, separator-free components,
  // so this is a legal segments[] list — the fixed `<forgeRoot>/_logs` stays
  // the trusted root; runId only ever enters as its OWN segment, never
  // folded into root (see studio-path-guard.ts's CONTRACT section).
  const guarded = resolveGuardedPath(join(forgeRoot, '_logs'), [`_preflight-fix-${runId}`, 'events.jsonl']);
  // Fail-soft by design, unchanged: this helper has no error channel to its
  // caller (spread straight into a 200 response above), so a guard
  // rejection collapses into the SAME 'running' shape a not-yet-started run
  // reports — never a distinct error, which would leak an oracle for
  // exactly the attacker iterating on this guard.
  if (!guarded.ok || !guarded.exists) return { state: 'running', cleared: false };
  const evPath = guarded.realPath;
  let raw: string;
  try { raw = readFileSync(evPath, 'utf8'); } catch { return { state: 'running', cleared: false }; }
  for (const line of raw.split('\n').reverse()) {
    if (!line.trim()) continue;
    let ev: { event_type?: string; message?: string; metadata?: { cleared?: boolean } };
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.event_type === 'end' || ev.message?.startsWith('preflight-fix.end')) {
      const cleared = ev.metadata?.cleared === true;
      return { state: cleared ? 'cleared' : 'not-cleared', cleared };
    }
    if (ev.event_type === 'error' || ev.message === 'preflight-fix.crashed') {
      return { state: 'failed', cleared: false };
    }
  }
  return { state: 'running', cleared: false };
}

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

  // ---- /api/studio/starters -----------------------------------------------
  // The curated OOTB starter agents (ADR-033) the New-Agent picker offers.
  // Same capability-descriptor threading as /api/studio/agents (R2-02-F1) —
  // starters carry a real AgentDefinition the builder reads via the same
  // client parser, so the fact must be present here too.
  if (url === '/api/studio/starters') {
    try {
      const starters = listStarterAgents(ctx.forgeRoot);
      const flow = loadStarterFlow(ctx.forgeRoot);
      sendJson(
        res,
        200,
        { starters: starters.map((a) => ({ ...a, capability: agentCapabilityDescriptor(a) })), flow },
        origin,
      );
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- /api/studio/projects/starters (R4-03) ------------------------------
  // The curated greenfield app-type templates the create form offers.
  if (url === '/api/studio/projects/starters') {
    try {
      sendJson(res, 200, { appTypes: listProjectStarters(ctx.forgeRoot) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

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

  // ---- /api/studio/projects -----------------------------------------------
  if (url === '/api/studio/projects') {
    try {
      const projects = loadProjectsWithMeta(ctx.forgeRoot);
      sendJson(res, 200, { projects }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- /api/studio/projects/attention (R4-11-F4) --------------------------
  // Cross-project "which projects need my attention" aggregate for the
  // library landing strip. One best-effort entry per registered project —
  // a single project's read failure never sinks the whole aggregate.
  if (url === '/api/studio/projects/attention') {
    try {
      const projects = loadProjectsWithMeta(ctx.forgeRoot);
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

  // ---- /api/studio/projects/:id/preflight ---------------------------------
  const preflightMatch = url.match(/^\/api\/studio\/projects\/([^/]+)\/preflight$/);
  if (preflightMatch) {
    try {
      const id = decodeURIComponent(preflightMatch[1]);
      if (!PROJECT_ID_RE.test(id)) {
        sendJson(res, 400, { error: 'invalid project id' }, origin);
        return true;
      }
      // B1: resolve the project by disk scan rather than the projects.yaml
      // registry. A dir without `.forge/project.json` still preflights (the
      // operator runs preflight to learn WHY it is not yet contract-green).
      const projectsDir = resolveProjectsDir(resolve(ctx.forgeRoot), loadConfig(defaultConfigPath(ctx.forgeRoot)));
      const projectRef = discoverProjects(projectsDir, ctx.forgeRoot).find((p) => p.id === id);
      if (!projectRef) {
        sendJson(res, 404, { error: 'unknown project' }, origin);
        return true;
      }
      const projectRoot = projectRef.absPath;
      if (!resolve(projectRoot).startsWith(resolve(ctx.forgeRoot) + sep)) {
        sendJson(res, 400, { error: 'project path escapes forge root' }, origin);
        return true;
      }
      const report = runPreflight(projectRoot, { forgeRoot: ctx.forgeRoot });
      const clauses = report.clauses.map((c) => {
        const cls = classifyClause(c);
        return {
          id: c.clause,
          title: c.title,
          hard: c.hard,
          pass: c.pass,
          detail: c.detail,
          resolution: cls.resolution,
          route: cls.route,
          fixHint: cls.fixHint,
        };
      });
      sendJson(res, 200, { clauses, ready: report.ok }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- /api/studio/projects/:id/repo-status (R1-2) — pending studio changes -
  const repoStatusMatch = url.match(/^\/api\/studio\/projects\/([^/]+)\/repo-status$/);
  if (repoStatusMatch) {
    try {
      const id = decodeURIComponent(repoStatusMatch[1]);
      if (!PROJECT_ID_RE.test(id)) {
        sendJson(res, 400, { error: 'invalid project id' }, origin);
        return true;
      }
      const projectsDir = resolveProjectsDir(resolve(ctx.forgeRoot), loadConfig(defaultConfigPath(ctx.forgeRoot)));
      const projectRef = discoverProjects(projectsDir, ctx.forgeRoot).find((p) => p.id === id);
      if (!projectRef) {
        sendJson(res, 404, { error: 'unknown project' }, origin);
        return true;
      }
      sendJson(res, 200, { pending: hasPendingStudioChanges(projectRef.absPath), branch: STUDIO_BRANCH }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // ---- /api/studio/projects/:id/preflight/fix-agent/:runId (Stage D) -------
  const pfStatusMatch = url.match(/^\/api\/studio\/projects\/([^/]+)\/preflight\/fix-agent\/([^/]+)$/);
  if (pfStatusMatch) {
    const runId = decodeURIComponent(pfStatusMatch[2]);
    if (!SAFE_ID_RE.test(runId)) {
      sendJson(res, 400, { error: 'invalid run id' }, origin);
      return true;
    }
    sendJson(res, 200, { ok: true, runId, ...readPreflightFixState(ctx.forgeRoot, runId) }, origin);
    return true;
  }

  // ---- /api/studio/projects/:id/roadmap -----------------------------------
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

  // ---- /api/studio/projects/:id/contract-stages (R4-17, D9) ---------------
  // The onboarding session's data contract, as its own route — this is what
  // makes "staged artifacts land on the project page" true rather than
  // aspirational (R4-12-F1 renders it in batch D). `id` is path-shaped, so it
  // is validated (SLUG_RE) BEFORE any fs call — a raw ".." segment a browser
  // client would normalise away must still be rejected server-side (mirrors
  // the R4-16 wire-level rule for path-shaped params).
  const contractStagesMatch = url.match(/^\/api\/studio\/projects\/([^/]+)\/contract-stages$/);
  if (contractStagesMatch) {
    try {
      const id = decodeURIComponent(contractStagesMatch[1]);
      if (!PROJECT_ID_RE.test(id)) {
        sendJson(res, 400, { error: 'invalid project id' }, origin);
        return true;
      }
      const projectsRoot = resolveProjectsDir(resolve(ctx.forgeRoot), loadConfig(defaultConfigPath(ctx.forgeRoot)));
      const result = deriveContractStages({ forgeRoot: ctx.forgeRoot, projectsRoot, projectId: id });
      if (!result.ok) {
        // Distinguishes "unknown project" from "project exists but its
        // .forge/project.json is malformed" the same way deriveContractStages
        // itself does — an unknown/escaping id 404s, a malformed config never
        // gets smoothed into a 200 ("declared data fails open" is the shape
        // this campaign keeps finding and closing).
        const status = /^unknown project /.test(result.error.message) ? 404 : 409;
        // W7-B6 (projects-01 / crosscut-12): when the 409 is the R1-03
        // MIGRATE shape ("the flat gate keys moved to the typed testProcess
        // object"), the message names the mechanical remedy — `forge project
        // migrate <id>` applies the exact mapping the validator's text
        // describes. Review F6: the CONFLICT shape ("conflicting flat gate
        // key(s) alongside testProcess") must NOT get the hint — migrate
        // REFUSES that shape ('conflict': which source wins is a human
        // decision), so the old broad /flat gate key/ match pointed the
        // operator at a command that would decline to act.
        const error =
          status === 409 && /flat gate keys moved to the typed testProcess object/.test(result.error.message)
            ? `${result.error.message} Run \`forge project migrate ${id}\` to apply this migration automatically.`
            : result.error.message;
        sendJson(res, status, { ok: false, error }, origin);
        return true;
      }
      sendJson(res, 200, { ok: true, project: id, stages: result.rows, sourcesScanned: result.sourcesScanned }, origin);
    } catch (err) {
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

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
