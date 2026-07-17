/**
 * dry-bridge — the R5-01-F1 safety seam on real-acting Studio bridge routes.
 *
 * Motivated by the 2026-07-16 incident: the Studio bridge self-merged a forge
 * PR with the operator's real gh token during a `ui:journey` harness run.
 * `FORGE_DRY_BRIDGE=1` (see `isDryBridge`) is an orthogonal, broader seam than
 * the existing `FORGE_ARCHITECT_NO_SPAWN` guard — it covers every route that
 * touches a real daemon process, a real git remote, or spawns a real agent
 * turn, not just the architect/instructions/demo-builder/project-brain spawn
 * helpers. `FORGE_ARCHITECT_NO_SPAWN` keeps its current narrow meaning
 * everywhere; this module never redefines it.
 *
 * `BRIDGE_ROUTE_CLASSIFICATION` is the coverage artifact: a typed, exported
 * table (data, not prose) enumerating every bridge route with its
 * classification. Route-coverage drift-guard tests consume this table.
 *
 * Never silent success: every `refuse` route writes both a typed 409 HTTP
 * response (via `refuseDryBridge`) AND a JSONL event, reusing the existing
 * `orchestrator/logging.ts` `createLogger` event-emission pattern (the same
 * one `applyReviewVerdict`'s send-back path and the reflect-answer route
 * already use) rather than inventing a new logging path.
 */

import type { ServerResponse } from 'node:http';

import { createLogger, type EventLogger } from '../orchestrator/logging.ts';
import { sendJson } from './bridge-studio.ts';

/** The env var that activates dry-bridge mode. Single source of truth — no
 *  string literals scattered at call sites. */
export const DRY_BRIDGE_ENV = 'FORGE_DRY_BRIDGE';

/** Shared JSONL bucket every route-level refusal event is logged into (no
 *  natural per-cycle id exists for most refuse routes — e.g. scheduler
 *  start/stop). Stub-actions skips (verdict-approve) log into the cycle's
 *  OWN events.jsonl instead, via `emitDryBridgeSkip`, since a real cycleId is
 *  already in hand there and the skip is genuinely part of that cycle's
 *  narrative. */
export const DRY_BRIDGE_LOG_BUCKET = '_dry-bridge';

/** True iff dry-bridge mode is active. Reads `process.env` by default;
 *  callers (and tests) may pass an explicit env map. */
export function isDryBridge(env: Record<string, string | undefined> = process.env): boolean {
  return env[DRY_BRIDGE_ENV] === '1';
}

/** The three real-acting sub-steps `applyReviewVerdict`'s approve path can
 *  individually skip in dry-bridge mode. Named for the incident: these are
 *  exactly the actions that self-merged the PR on 2026-07-16. */
export type DryBridgeStubAction = 'release-finalize' | 'merge-pr' | 'finalize-after-merge';

/** The action kind a `refuse` route's real-acting call falls into — carried
 *  in the typed 409 body so a caller can tell WHY without parsing prose. */
export type DryBridgeAction = 'spawn-agent' | 'git-remote' | 'daemon';

export type DryBridgeClassification = 'refuse' | 'stub-actions' | 'exempt-local' | 'read-only';

export type RouteClassification = {
  method: 'GET' | 'POST' | 'PUT' | '*';
  /** Route path. `:id`-style segments are literal placeholders (documentation,
   *  not a router pattern). A `(op=...)` suffix distinguishes routes that
   *  multiplex behavior over a body field (e.g. KB maintenance). `*` for the
   *  GET wildcard row (all GET routes are read-only by construction). */
  route: string;
  classification: DryBridgeClassification;
  /** Required when classification is 'refuse'; the 409 body's `action` field. */
  action?: DryBridgeAction;
  /** For 'refuse' routes: where the guard fires. 'route' = a route-level 409
   *  via `refuseDryBridge`, before any processing. 'spawn-helper' = the six
   *  routes whose spawn is already gated by FORGE_ARCHITECT_NO_SPAWN inside a
   *  private spawn-helper function; dry-bridge ORs into that SAME internal
   *  guard rather than adding a second, route-level refusal, per the design
   *  decision to not alter their existing NO_SPAWN behavior/response shape. */
  guard?: 'route' | 'spawn-helper';
  /** One-line reason: what real-acting thing this route does (or why it's safe). */
  reason: string;
};

// ---------------------------------------------------------------------------
// The coverage table — every bridge route, classified. Data, not prose.
// ---------------------------------------------------------------------------

export const BRIDGE_ROUTE_CLASSIFICATION: readonly RouteClassification[] = [
  // ---- refuse: full route-level 409 -------------------------------------
  { method: 'POST', route: '/api/scheduler/start', classification: 'refuse', action: 'daemon', guard: 'route',
    reason: 'spawns the detached forge serve daemon (spawnServeDetached)' },
  { method: 'POST', route: '/api/scheduler/stop', classification: 'refuse', action: 'daemon', guard: 'route',
    reason: 'SIGTERMs the live daemon process' },
  { method: 'POST', route: '/api/reflect/:cycleId/answer', classification: 'refuse', action: 'spawn-agent', guard: 'route',
    reason: 'rerunReflector spawns a real reflector SDK agent turn' },
  { method: 'POST', route: '/api/studio/kbs/:id/maintenance (op=fix-agent)', classification: 'refuse', action: 'spawn-agent', guard: 'route',
    reason: 'spawnBrainFix dispatches a real agent-fix turn' },
  { method: 'POST', route: '/api/recovery/:id/abandon', classification: 'refuse', action: 'git-remote', guard: 'route',
    reason: 'removes the worktree/branch and pushes a remote branch delete' },
  { method: 'POST', route: '/api/recovery/:id/requeue', classification: 'refuse', action: 'git-remote', guard: 'route',
    reason: 'runRequeue performs real git ops on the project repo' },
  { method: 'POST', route: '/api/runs/:id/resume', classification: 'refuse', action: 'git-remote', guard: 'route',
    reason: 'delegates to the same runRequeue git ops as recovery/requeue' },
  { method: 'POST', route: '/api/studio/projects/:id/save-repo', classification: 'refuse', action: 'git-remote', guard: 'route',
    reason: 'saveProjectRepo merges + pushes the project default branch' },
  { method: 'PUT', route: '/api/studio/projects/:id', classification: 'refuse', action: 'git-remote', guard: 'route',
    reason: 'the durable save merges + pushes via saveProjectRepo after the local .forge/project.json write' },

  // ---- refuse: already-NO_SPAWN-guarded spawn routes --------------------
  // These six get the dry-bridge check ORed into their EXISTING internal
  // `FORGE_ARCHITECT_NO_SPAWN` early-return, not a new route-level 409 — the
  // local state (session/status files) still gets written, matching today's
  // NO_SPAWN behavior; only the spawn itself is skipped.
  { method: 'POST', route: '/api/architect/start', classification: 'refuse', action: 'spawn-agent', guard: 'spawn-helper',
    reason: 'spawnArchitectTurn already NO_SPAWN-guarded; dry-bridge ORs into the same guard' },
  { method: 'POST', route: '/api/architect/answer', classification: 'refuse', action: 'spawn-agent', guard: 'spawn-helper',
    reason: 'spawnArchitectTurn already NO_SPAWN-guarded; dry-bridge ORs into the same guard' },
  { method: 'POST', route: '/api/plan-verdict', classification: 'refuse', action: 'spawn-agent', guard: 'spawn-helper',
    reason: 'applyPlanVerdict spawns via the NO_SPAWN-guarded spawnArchitectTurn' },
  { method: 'POST', route: '/api/runs/:id/gates/plan', classification: 'refuse', action: 'spawn-agent', guard: 'spawn-helper',
    reason: 'same handler as /api/plan-verdict (applyPlanVerdict)' },
  { method: 'POST', route: '/api/instructions/brief', classification: 'refuse', action: 'spawn-agent', guard: 'spawn-helper',
    reason: 'spawnInstructionsTurn already NO_SPAWN-guarded; dry-bridge ORs into the same guard' },
  { method: 'POST', route: '/api/instructions/answer', classification: 'refuse', action: 'spawn-agent', guard: 'spawn-helper',
    reason: 'spawnInstructionsTurn already NO_SPAWN-guarded; dry-bridge ORs into the same guard' },
  { method: 'POST', route: '/api/instructions/verdict', classification: 'refuse', action: 'spawn-agent', guard: 'spawn-helper',
    reason: 'spawnInstructionsTurn already NO_SPAWN-guarded; dry-bridge ORs into the same guard' },
  { method: 'POST', route: '/api/project-brain/brief', classification: 'refuse', action: 'spawn-agent', guard: 'spawn-helper',
    reason: 'spawnProjectBrainTurn already NO_SPAWN-guarded; dry-bridge ORs into the same guard' },
  { method: 'POST', route: '/api/project-brain/approve', classification: 'refuse', action: 'spawn-agent', guard: 'spawn-helper',
    reason: 'spawnProjectBrainTurn already NO_SPAWN-guarded; dry-bridge ORs into the same guard' },
  { method: 'POST', route: '/api/demo-builder/brief', classification: 'refuse', action: 'spawn-agent', guard: 'spawn-helper',
    reason: 'spawnDemoBuilderTurn already NO_SPAWN-guarded; dry-bridge ORs into the same guard' },
  { method: 'POST', route: '/api/demo-builder/feedback', classification: 'refuse', action: 'spawn-agent', guard: 'spawn-helper',
    reason: 'spawnDemoBuilderTurn already NO_SPAWN-guarded; dry-bridge ORs into the same guard' },
  { method: 'POST', route: '/api/demo-builder/lock', classification: 'refuse', action: 'spawn-agent', guard: 'spawn-helper',
    reason: 'spawnDemoBuilderTurn already NO_SPAWN-guarded; dry-bridge ORs into the same guard' },
  { method: 'POST', route: '/api/demo-builder/abandon', classification: 'refuse', action: 'spawn-agent', guard: 'spawn-helper',
    reason: 'spawnDemoBuilderTurn already NO_SPAWN-guarded; dry-bridge ORs into the same guard' },
  { method: 'POST', route: '/api/studio/projects/:id/preflight/fix-agent', classification: 'refuse', action: 'spawn-agent', guard: 'spawn-helper',
    reason: 'spawnPreflightFix already NO_SPAWN-guarded (user-tier only; auto/agent-tier sub-branches never spawn)' },

  // ---- stub-actions: verdict-approve special case -----------------------
  { method: 'POST', route: '/api/verdict', classification: 'stub-actions',
    reason: 'approve path proceeds (state transition + artifact writes) but skips runReleaseFinalize/mergePr/finalizeAfterMerge — the exact incident actions' },
  { method: 'POST', route: '/api/runs/:id/gates/verdict', classification: 'stub-actions',
    reason: 'same handler as /api/verdict (applyReviewVerdict)' },

  // ---- exempt-local: mutates only local state ----------------------------
  { method: 'POST', route: '/api/scheduler/pause', classification: 'exempt-local', reason: 'flag file only, no process action' },
  { method: 'POST', route: '/api/scheduler/resume', classification: 'exempt-local', reason: 'flag file only, no process action' },
  { method: 'POST', route: '/api/studio/projects/:id/preflight/fix-auto', classification: 'exempt-local', reason: 'local git commit to forge-studio branch, no push' },
  { method: 'POST', route: '/api/studio/projects', classification: 'exempt-local', reason: 'onboard: local git init + file scaffolds only' },
  { method: 'POST', route: '/api/develop/start', classification: 'exempt-local', reason: 'manifest move only' },
  { method: 'POST', route: '/api/runs', classification: 'exempt-local', reason: 'manifest move only' },
  { method: 'POST', route: '/api/studio/kbs/:id/maintenance (op=lint|fix-auto|index)', classification: 'exempt-local', reason: 'local brain lint/fix/index only' },
  { method: 'POST', route: '/api/review-comments/:cycleId', classification: 'exempt-local', reason: 'appends to the local review-comments sidecar' },
  { method: 'POST', route: '/api/review-comments/:cycleId/resolve', classification: 'exempt-local', reason: 'marks a local review-comments sidecar entry resolved' },
  { method: 'PUT', route: '/api/studio/agents/:slug', classification: 'exempt-local', reason: 'writes a local SKILL.md' },
  { method: 'PUT', route: '/api/studio/flows/:id', classification: 'exempt-local', reason: 'writes a local flow.yaml' },
  { method: 'POST', route: '/api/studio/skills', classification: 'exempt-local', reason: 'writes a local skill definition' },
  { method: 'POST', route: '/api/studio/kbs', classification: 'exempt-local', reason: 'creates a local KB directory' },
  { method: 'PUT', route: '/api/studio/kbs/:id', classification: 'exempt-local', reason: 'updates local KB metadata' },
  { method: 'POST', route: '/api/studio/kbs/:id (delete)', classification: 'exempt-local', reason: 'removes a local KB directory' },
  { method: 'POST', route: '/api/studio/kbs/:id/guidance', classification: 'exempt-local', reason: 'writes a local guidance markdown file' },
  { method: 'POST', route: '/api/studio/kbs/:id/bootstrap', classification: 'exempt-local', reason: 'seeds local brain scaffolding' },
  { method: 'POST', route: '/api/initiatives', classification: 'exempt-local', reason: 'writeManifest — local queue write only' },
  { method: 'POST', route: '/api/instructions/start', classification: 'exempt-local', reason: 'creates local session state; the spawn is on brief/answer/verdict' },
  { method: 'POST', route: '/api/project-brain/start', classification: 'exempt-local', reason: 'creates local session state; the spawn is on brief/approve' },
  { method: 'POST', route: '/api/project-brain/abandon', classification: 'exempt-local', reason: 'writes local session status only — confirmed it does NOT call spawnProjectBrainTurn (only /approve does)' },
  { method: 'POST', route: '/api/demo-builder/start', classification: 'exempt-local', reason: 'creates local session state; the spawn is on brief/feedback/lock/abandon' },

  // ---- read-only ----------------------------------------------------------
  { method: 'GET', route: '*', classification: 'read-only', reason: 'all GET routes across the bridge are read-only by construction' },
] as const;

// ---------------------------------------------------------------------------
// refuseDryBridge — the typed 409 response + JSONL event for `refuse` routes
// ---------------------------------------------------------------------------

export type DryBridgeRefusalInput = {
  route: string;
  method: string;
  action: DryBridgeAction;
  logsRoot: string;
  /** JSONL bucket to log into. Defaults to the shared DRY_BRIDGE_LOG_BUCKET —
   *  most refuse routes have no natural per-resource cycleId. */
  bucket?: string;
};

/**
 * Write the typed 409 refusal AND emit a JSONL event. Never silent success.
 * Never throws — a logging failure must not prevent the HTTP response (the
 * response is written FIRST, the event emit is best-effort after).
 */
export function refuseDryBridge(res: ServerResponse, origin: string, input: DryBridgeRefusalInput): void {
  sendJson(res, 409, { error: 'dry-bridge', route: input.route, method: input.method, action: input.action }, origin);
  try {
    const bucket = input.bucket ?? DRY_BRIDGE_LOG_BUCKET;
    const logger = createLogger(bucket, input.logsRoot);
    logger.emit({
      initiative_id: bucket,
      phase: 'orchestrator',
      skill: 'dry-bridge',
      event_type: 'log',
      input_refs: [],
      output_refs: [],
      message: 'dry-bridge.refuse',
      metadata: { route: input.route, method: input.method, action: input.action },
    });
  } catch { /* best-effort — never break the refusal response on a logging failure */ }
}

// ---------------------------------------------------------------------------
// emitDryBridgeSkip — the stub-actions per-skip JSONL event (verdict-approve)
// ---------------------------------------------------------------------------

/**
 * Emit one JSONL event for a single skipped stub-action, into the SAME
 * cycle's events.jsonl the rest of that cycle's history lives in (the caller
 * already has a `createLogger`-derived logger for this cycle — reused here,
 * not re-derived).
 */
export function emitDryBridgeSkip(logger: EventLogger, initiativeId: string, action: DryBridgeStubAction): void {
  logger.emit({
    initiative_id: initiativeId,
    phase: 'orchestrator',
    skill: 'dry-bridge',
    event_type: 'log',
    input_refs: [],
    output_refs: [],
    message: 'dry-bridge.skip',
    metadata: { action },
  });
}
