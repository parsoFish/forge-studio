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
 * bead forge-8vfn.5.30: `RouteEntry.dryClassification` (packages/kernel/
 * route-entry.ts) already classifies every carved route — every
 * `packages/<pkg>/routes.ts` table entry states it, non-optionally, right
 * beside its `method`/`path`. A hand-written row HERE for the same route was
 * a second, unenforced copy of that same fact, free to drift from it with
 * nothing to notice. `HAND_ROUTE_CLASSIFICATION` below now carries ONLY the
 * routes `deriveCarvedRouteClassification` structurally cannot produce: a
 * route with no `RouteEntry` at all (still dispatched from an if-chain in
 * `apps/forge/*.ts`), or one where the hand row states something a
 * `RouteEntry` cannot — the 409 body's `action` (refuse rows) or WHERE the
 * suppression lives (`guard`), or a body-field-multiplexed sub-classification
 * (the KB-maintenance `op=` rows: one `RouteEntry`, several real behaviours,
 * T1 ruling 29). `BRIDGE_ROUTE_CLASSIFICATION` — the table every consumer
 * still imports — is the union of that hand table and the derived rows;
 * `apps/forge/tests/contract/dry-bridge-coverage.test.ts` proves the union
 * carries no redundant hand row and drops nothing a `RouteEntry` declares.
 *
 * Never silent success/skip:
 * - every `refuse` route writes both a typed 409 HTTP response (via
 *   `refuseDryBridge`) AND a JSONL event;
 * - every `stub-actions` route proceeds with its local bookkeeping but marks
 *   each skipped real-acting step — `dryBridge: { skipped: [...] }` on the
 *   200 body plus one `dry-bridge.skip` JSONL event per step (the verdict's
 *   three incident actions via `emitDryBridgeSkip`; the spawn families'
 *   agent turn via `dryBridgeAgentTurnMarker`);
 * - the one non-HTTP spawn path (the boot-time reflect-reconcile) has no
 *   response to type, so its JSONL event (`emitDryBridgeRefusal`) IS the
 *   typed refusal.
 * All event emission reuses the existing `orchestrator/logging.ts`
 * `createLogger` pattern rather than inventing a new logging path.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The env gate and the typed refusal moved to `@forge/kernel` (M4-knowledge
// s5): five packages consumed them and could only reach them by importing
// `cli/`. Re-exported here so this file's own callers, and the classification
// table below, are untouched. The rest of the dry-bridge model — the route
// table, the per-skip events, the agent-turn marker — stays here, because it
// is a table ABOUT this bridge's routes and the coverage guard reads it here.
export {
  DRY_BRIDGE_ENV,
  DRY_BRIDGE_LOG_BUCKET,
  isDryBridge,
  emitDryBridgeRefusal,
  refuseDryBridge,
  type DryBridgeAction,
  type DryBridgeRefusalInput,
} from '@forge/kernel';
import type { DryBridgeAction } from '@forge/kernel';


export type DryBridgeClassification = 'refuse' | 'stub-actions' | 'exempt-local' | 'read-only';

export type RouteClassification = {
  // 'DELETE' added W7-B4. The two rows that still multiplexed a delete over
  // POST — carrying a ` (delete)` suffix the coverage test canonicalized —
  // were re-keyed to this method in M4-library's route carve (T1 ruling 28),
  // and that canonicalization is gone with them. A delete is declared here as
  // DELETE; no route string encodes a method.
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | '*';
  /** Route path. `:id`-style segments are literal placeholders (documentation,
   *  not a router pattern). A `(op=...)` suffix distinguishes routes that
   *  multiplex behavior over a body field (e.g. KB maintenance). `*` for the
   *  GET wildcard row (all GET routes are read-only by construction). */
  route: string;
  classification: DryBridgeClassification;
  /** Required when classification is 'refuse'; the 409 body's `action` field. */
  action?: DryBridgeAction;
  /** Where the dry-mode enforcement lives. 'route' = a route-level 409 via
   *  `refuseDryBridge`, before any processing (refuse rows). 'spawn-helper' =
   *  the spawn-family stub-actions rows, whose suppression is ORed into the
   *  EXISTING FORGE_ARCHITECT_NO_SPAWN early-return inside a private
   *  spawn-helper function — the route still 200s with its session
   *  bookkeeping done, plus the explicit `dryBridge.skipped` marker + skip
   *  event added at the route's response. */
  guard?: 'route' | 'spawn-helper';
  /** One-line reason: what real-acting thing this route does (or why it's safe). */
  reason: string;
};

// ---------------------------------------------------------------------------
// The hand table — ONLY routes `deriveCarvedRouteClassification` (below)
// cannot produce: no `RouteEntry` exists (still dispatched from an if-chain),
// or the row states an `action`/`guard` a `RouteEntry` has no field for, or a
// body-multiplexed `op=` sub-classification finer than the route's one
// `RouteEntry.dryClassification`. Every other carved route's row is derived.
// ---------------------------------------------------------------------------

export const HAND_ROUTE_CLASSIFICATION: readonly RouteClassification[] = [
  // ---- refuse: full route-level 409, no RouteEntry (still an if-chain arm) -
  { method: 'POST', route: '/api/scheduler/start', classification: 'refuse', action: 'daemon', guard: 'route',
    reason: 'spawns the detached forge serve daemon (spawnServeDetached)' },
  { method: 'POST', route: '/api/scheduler/stop', classification: 'refuse', action: 'daemon', guard: 'route',
    reason: 'SIGTERMs the live daemon process' },
  { method: 'POST', route: '/api/recovery/:id/abandon', classification: 'refuse', action: 'git-remote', guard: 'route',
    reason: 'removes the worktree/branch and pushes a remote branch delete' },
  { method: 'POST', route: '/api/recovery/:id/requeue', classification: 'refuse', action: 'git-remote', guard: 'route',
    reason: 'runRequeue performs real git ops on the project repo' },
  { method: 'POST', route: '/api/runs/:id/resume', classification: 'refuse', action: 'git-remote', guard: 'route',
    reason: 'delegates to the same runRequeue git ops as recovery/requeue' },

  // ---- refuse: has a RouteEntry, but the row states an `action`/`guard` no
  // RouteEntry field carries — kept hand, not a duplicate. -------------------
  { method: 'POST', route: '/api/studio/community/refresh', classification: 'refuse', action: 'network', guard: 'route',
    reason: 'calls api.github.com / registry.npmjs.org / registry.modelcontextprotocol.io with the operator\'s GH_TOKEN and rewrites studio/community/registry.yaml from the answers' },
  { method: 'POST', route: '/api/studio/projects/:id/save-repo', classification: 'refuse', action: 'git-remote', guard: 'route',
    reason: 'saveProjectRepo merges + pushes the project default branch' },
  { method: 'PUT', route: '/api/studio/projects/:id', classification: 'refuse', action: 'git-remote', guard: 'route',
    reason: 'the durable save merges + pushes via saveProjectRepo after the local .forge/project.json write' },
  // The SAME handler has always answered POST on this URL — its legacy entry
  // gate was `method !== 'DELETE'`, not `method === 'PUT'` — but only the PUT
  // row was ever classified here, so the POST path reached the same
  // push-to-remote code with no dry-bridge row governing it.
  { method: 'POST', route: '/api/studio/projects/:id', classification: 'refuse', action: 'git-remote', guard: 'route',
    reason: 'identical code path to the PUT row above — same handler, same saveProjectRepo merge + push' },

  // ---- stub-actions: the spawn-route families — every row states `guard:
  // 'spawn-helper'`, a fact no `RouteEntry` field carries, so all are kept
  // hand rather than derived. Session bookkeeping (status/prompt/answers
  // files) proceeds exactly as under FORGE_ARCHITECT_NO_SPAWN today, but
  // never silently: the suppressed agent turn is explicit — `dryBridge: {
  // skipped: ['agent-turn'] }` on the 200 body + one `dry-bridge.skip` event
  // (dryBridgeAgentTurnMarker). ----------------------------------------------
  { method: 'POST', route: '/api/architect/start', classification: 'stub-actions', guard: 'spawn-helper',
    reason: 'spawnArchitectTurn — bookkeeping proceeds; the agent turn is skipped with marker + event' },
  { method: 'POST', route: '/api/architect/answer', classification: 'stub-actions', guard: 'spawn-helper',
    reason: 'spawnArchitectTurn — bookkeeping proceeds; the agent turn is skipped with marker + event' },
  { method: 'POST', route: '/api/architect/rerun', classification: 'stub-actions', guard: 'spawn-helper',
    reason: 'spawnArchitectTurn — StuckWarning re-run; re-spawns the existing session as-is (no round/answers mutation), the agent turn is skipped with marker + event' },
  { method: 'POST', route: '/api/plan-verdict', classification: 'stub-actions', guard: 'spawn-helper',
    reason: 'applyPlanVerdict → spawnArchitectTurn — marker on approve/revise (reject never spawns); no RouteEntry — still an if-chain arm' },
  { method: 'POST', route: '/api/runs/:id/gates/plan', classification: 'stub-actions', guard: 'spawn-helper',
    reason: 'same handler as /api/plan-verdict (applyPlanVerdict); no RouteEntry — still an if-chain arm' },
  { method: 'POST', route: '/api/instructions/brief', classification: 'stub-actions', guard: 'spawn-helper',
    reason: 'spawnInstructionsTurn — bookkeeping proceeds; the agent turn is skipped with marker + event' },
  { method: 'POST', route: '/api/instructions/answer', classification: 'stub-actions', guard: 'spawn-helper',
    reason: 'spawnInstructionsTurn — bookkeeping proceeds; the agent turn is skipped with marker + event' },
  { method: 'POST', route: '/api/instructions/verdict', classification: 'stub-actions', guard: 'spawn-helper',
    reason: 'spawnInstructionsTurn — bookkeeping proceeds; the agent turn is skipped with marker + event' },
  { method: 'POST', route: '/api/project-brain/brief', classification: 'stub-actions', guard: 'spawn-helper',
    reason: 'spawnProjectBrainTurn — bookkeeping proceeds; the agent turn is skipped with marker + event' },
  { method: 'POST', route: '/api/project-brain/approve', classification: 'stub-actions', guard: 'spawn-helper',
    reason: 'spawnProjectBrainTurn — marker on approve (the shared abandon branch never spawns)' },
  { method: 'POST', route: '/api/demo-builder/brief', classification: 'stub-actions', guard: 'spawn-helper',
    reason: 'spawnDemoBuilderTurn — bookkeeping proceeds; the agent turn is skipped with marker + event' },
  { method: 'POST', route: '/api/demo-builder/feedback', classification: 'stub-actions', guard: 'spawn-helper',
    reason: 'spawnDemoBuilderTurn — bookkeeping proceeds; the agent turn is skipped with marker + event' },
  { method: 'POST', route: '/api/demo-builder/lock', classification: 'stub-actions', guard: 'spawn-helper',
    reason: 'spawnDemoBuilderTurn — bookkeeping proceeds; the agent turn is skipped with marker + event' },
  { method: 'POST', route: '/api/demo-builder/abandon', classification: 'stub-actions', guard: 'spawn-helper',
    reason: 'spawnDemoBuilderTurn — bookkeeping proceeds; the agent turn is skipped with marker + event' },
  { method: 'POST', route: '/api/studio/projects/:id/preflight/fix-agent', classification: 'stub-actions', guard: 'spawn-helper',
    reason: 'spawnPreflightFix — marker on the user-tier spawn branch (auto/agent-tier branches never spawn)' },
  { method: 'POST', route: '/api/agents/:id/run', classification: 'stub-actions', guard: 'spawn-helper',
    reason: 'spawnAgentDispatch (R2-01-F3 generic run host) — validation + runId proceed; the agent dispatch is skipped with marker + event' },
  { method: 'POST', route: '/api/studio/onboarding/start', classification: 'stub-actions', guard: 'spawn-helper',
    reason: 'spawnAgentDispatch (R4-17 staged onboarding session) — the session dir, status.json and prompt.md are REAL bookkeeping and still land; only the agent dispatch is skipped with marker + event, exactly as the generic run host above' },
  { method: 'POST', route: '/api/studio/authoring/start', classification: 'stub-actions', guard: 'spawn-helper',
    reason: 'spawnAgentTurn (R4-21 phase 2 — the authoring session, riding the generic runInteractiveTurn spine) — the session dir, status.json and prompt.md are REAL bookkeeping and still land; only the agent turn is skipped with marker + event, exactly as the onboarding-start row above' },
  { method: 'POST', route: '/api/studio/kbs/:id/cleanup/start', classification: 'stub-actions', guard: 'spawn-helper',
    reason: 'spawnAgentTurn (R4-19-F2 — the kb-cleanup session, riding the generic runInteractiveTurn spine) — the session dir, status.json (kb_id/kb_binding/findings) are REAL bookkeeping and still land; only the agent turn is skipped with marker + event, exactly as the authoring/onboarding-start rows above' },

  // ---- stub-actions: verdict-approve / reflect-answer special cases — no
  // RouteEntry (still if-chain arms in apps/forge/ui-bridge.ts) --------------
  { method: 'POST', route: '/api/verdict', classification: 'stub-actions',
    reason: 'approve path proceeds (state transition + artifact writes) but skips runReleaseFinalize/mergePr/finalizeAfterMerge — the exact incident actions' },
  { method: 'POST', route: '/api/runs/:id/gates/verdict', classification: 'stub-actions',
    reason: 'same handler as /api/verdict (applyReviewVerdict)' },
  { method: 'POST', route: '/api/reflect/:cycleId/answer', classification: 'stub-actions', action: 'spawn-agent',
    reason: 'feedback bookkeeping proceeds; reflector rerun is the skipped agent turn' },

  // ---- KB maintenance: ONE RouteEntry (`POST /api/studio/kbs/:id/maintenance`,
  // dryClassification 'stub-actions' — see packages/knowledge/routes.ts), body
  // field `op` multiplexes FIVE real behaviours the route pattern cannot see
  // (`matches: (url) => boolean` never reads the body — T1 ruling 29). These
  // two rows are the finer-grained classification the RouteEntry structurally
  // cannot express; `deriveCarvedRouteClassification` also emits the plain
  // (un-suffixed) 'stub-actions' row for the RouteEntry itself, so all three
  // coexist without duplicating one another (op-suffixed route strings never
  // exact-match the bare RouteEntry path). ------------------------------------
  { method: 'POST', route: '/api/studio/kbs/:id/maintenance (op=fix-agent)', classification: 'refuse', action: 'spawn-agent', guard: 'route',
    reason: 'spawnBrainFix dispatches a real agent-fix turn' },
  { method: 'POST', route: '/api/studio/kbs/:id/maintenance (op=lint|fix-auto|index)', classification: 'exempt-local', reason: 'local brain lint/fix/index only' },

  // ---- exempt-local: no RouteEntry (still if-chain arms) -------------------
  { method: 'POST', route: '/api/scheduler/pause', classification: 'exempt-local', reason: 'flag file only, no process action' },
  { method: 'POST', route: '/api/scheduler/resume', classification: 'exempt-local', reason: 'flag file only, no process action' },
  { method: 'POST', route: '/api/develop/start', classification: 'exempt-local', reason: 'manifest move only' },
  { method: 'POST', route: '/api/initiatives/:id/plan', classification: 'exempt-local', reason: 'plan enqueue: manifest move only (scheduler decomposes, no in-request spawn)' },
  { method: 'POST', route: '/api/flows/:id/run', classification: 'exempt-local', reason: 'W7-A3 per-flow enqueue: manifest move only (enqueueFlowRun); the scheduler claims it later, no in-request spawn' },
  { method: 'POST', route: '/api/runs', classification: 'exempt-local', reason: 'manifest move only' },
  { method: 'POST', route: '/api/review-comments/:cycleId', classification: 'exempt-local', reason: 'appends to the local review-comments sidecar' },
  { method: 'POST', route: '/api/review-comments/:cycleId/resolve', classification: 'exempt-local', reason: 'marks a local review-comments sidecar entry resolved' },
  { method: 'POST', route: '/api/review-comments/:cycleId/edit', classification: 'exempt-local', reason: 'rewrites one local review-comments sidecar entry (W7-B7 artifact-plan-15)' },
  { method: 'POST', route: '/api/review-comments/:cycleId/delete', classification: 'exempt-local', reason: 'removes one local review-comments sidecar entry (W7-B7 artifact-plan-15)' },
  { method: 'PUT', route: '/api/studio/flows/:id', classification: 'exempt-local', reason: 'writes a local flow.yaml' },
  { method: 'DELETE', route: '/api/studio/flows/:id', classification: 'exempt-local', reason: 'removes a local flow directory (seed flows 403, active run 423)' },
  { method: 'POST', route: '/api/studio/starters/seed', classification: 'exempt-local', reason: 'copies starter agent packages already committed in this repo (studio/starters/agents/) into skills/ — local filesystem only, no network, no spawn; the closed slug set is server-controlled and an existing skills/<slug> is never overwritten (ruling 384)' },
  { method: 'POST', route: '/api/initiatives', classification: 'exempt-local', reason: 'writeManifest — local queue write only' },
  { method: 'POST', route: '/api/hooks/:hookId', classification: 'exempt-local', reason: 'signature-verified webhook receipt: stages a claimable flow-run request file only — dispatch happens in the daemon sweep behind NO_SPAWN/dry-bridge' },

  // ---- RED SCAFFOLD (bead forge-8vfn.5.30): these 42 rows are exact
  // duplicates of a carved RouteEntry.dryClassification, temporarily
  // reinstated so the new coverage test can prove it fails for the right
  // reason before the fix removes them. Removed in the very next commit.
  { method: 'POST', route: '/api/studio/connections/:id/install', classification: 'stub-actions',
    reason: 'a CONFIRMED request runs a real `npm install` (network + child process); FORGE_DRY_BRIDGE=1 or FORGE_ARCHITECT_NO_SPAWN=1 suppress it and return {suppressed:true, wouldInstall} instead (D7, mirrors run-agent.ts\'s own double env check). An unconfirmed request never reaches this at all — it returns {ok:true, preview} (forge-6gv.8.2)' },
  { method: 'POST', route: '/api/studio/community/:kind/:id/install', classification: 'stub-actions',
    reason: 'mcp/tool items route to the same real `npm install` path as /api/studio/connections/:id/install (same suppression, D7); an already-vendored skill/hook only copies local bytes, never real-acting; a NOT-yet-vendored skill fetches its package from GitHub with the operator credential and is REFUSED outright by that arm (action: network, ruling 477)' },
  { method: 'POST', route: '/api/studio/projects/:id/preflight/fix-auto', classification: 'exempt-local', reason: 'local git commit to forge-studio branch, no push' },
  { method: 'POST', route: '/api/studio/projects/:id/contract-reset', classification: 'exempt-local', reason: 'computes the drift report (computeContractDrift) from the request body\'s optional appType override — writes nothing at all, no spawn, no remote (a POST only because the app-type override arrives as a body)' },
  { method: 'POST', route: '/api/studio/projects/:id/contract-reset/apply', classification: 'exempt-local', reason: 'applyContractReset commits locally to the project\'s forge-studio branch (withStudioWrite/commitStudioChange) — no push, no spawn, no remote' },
  { method: 'POST', route: '/api/studio/projects', classification: 'exempt-local', reason: 'onboard: local git init + file scaffolds only' },
  { method: 'POST', route: '/api/studio/projects/create', classification: 'exempt-local', reason: 'greenfield create (R4-03): local template scaffold + brain seed, no spawn/remote' },
  { method: 'POST', route: '/api/studio/kbs/:id/drain', classification: 'exempt-local',
    reason: 'runs the KB drain-to-green loop (runKbDrain) — that loop already self-suppresses its own agent-tier spawn under dry-bridge, so this route is never suppressed further (mirrors op=consolidate|lint|fix-auto|index and /cleanup/apply above)' },
  { method: 'POST', route: '/api/studio/kbs/:id/drain/cancel', classification: 'exempt-local',
    reason: 'W7-B2 (knowledge-14): writes the local cancel flag (_logs/_kb-drain-<runId>/cancel.json) a live drain loop honors between turns, or force-terminates a DEAD run by rewriting its local status.json — local files only, no agent spawn, no network; the loop it stops is the same self-suppressing runKbDrain above' },
  { method: 'PUT', route: '/api/studio/agents/:slug', classification: 'exempt-local', reason: 'writes a local SKILL.md' },
  { method: 'DELETE', route: '/api/studio/agents/:slug', classification: 'exempt-local', reason: 'removes a local skills/<slug>/ package (409 while referenced by a flow node or session kind)' },
  { method: 'PUT', route: '/api/studio/skills/:id', classification: 'exempt-local', reason: 'rewrites a local SKILL.md (name/description/body) — no spawn/remote' },
  { method: 'DELETE', route: '/api/studio/skills/:id', classification: 'exempt-local', reason: 'removes a local skill package (409 while used by agents)' },
  { method: 'PUT', route: '/api/studio/hooks/:id', classification: 'exempt-local', reason: 'rewrites a local hook.yaml + scripts/run.sh; hash change honestly re-enters needs-review' },
  { method: 'DELETE', route: '/api/studio/hooks/:id', classification: 'exempt-local', reason: 'removes a local hook package (409 while carried by agents)' },
  { method: 'POST', route: '/api/studio/hooks/:id/revoke-approval', classification: 'exempt-local', reason: 'moves the local hook-approvals.yaml ledger entry approved→revoked — no spawn/remote' },
  { method: 'POST', route: '/api/studio/templates', classification: 'exempt-local', reason: 'writes a local template file under studio/artifact-templates|demo-elements (validated by the category loader)' },
  { method: 'PUT', route: '/api/studio/templates/:id', classification: 'exempt-local', reason: 'rewrites a local planning|demo-output template file (scaffold category 400)' },
  { method: 'DELETE', route: '/api/studio/templates/:id', classification: 'exempt-local', reason: 'removes a local template file (409 while used by flows; scaffold 400)' },
  { method: 'POST', route: '/api/studio/skills', classification: 'exempt-local', reason: 'writes a local skill definition' },
  { method: 'POST', route: '/api/studio/skills/install', classification: 'exempt-local', reason: 'installs an already-materialised local skill package (D2: no network call in this initiative)' },
  { method: 'POST', route: '/api/studio/skills/:id/approve', classification: 'exempt-local', reason: 'flips a draft skill\'s frontmatter status locally — no spawn/remote' },
  { method: 'POST', route: '/api/studio/hooks', classification: 'exempt-local', reason: 'writes a local hook.yaml + scripts/run.sh package — no spawn/remote' },
  { method: 'POST', route: '/api/studio/hooks/:id/approve', classification: 'exempt-local', reason: 'writes a local hook-approvals.yaml ledger entry — no spawn/remote' },
  { method: 'POST', route: '/api/studio/hooks/:id/override', classification: 'exempt-local', reason: 'writes a local hook-approvals.yaml ledger entry (overridden:true) — no spawn/remote' },
  { method: 'POST', route: '/api/studio/hooks/:id/decline', classification: 'exempt-local', reason: 'writes a local hook-approvals.yaml ledger entry (declined) — no spawn/remote (forge-8vfn.5.2)' },
  { method: 'POST', route: '/api/studio/connections/:id/probe', classification: 'exempt-local', reason: 'R3-04 D3/D11 — spawns a declared, credential-stripped local presence/version check only; deliberately NEVER suppressed by dry-bridge (readiness must stay real, D3) — no git-remote/daemon/agent-turn' },
  { method: 'POST', route: '/api/studio/authoring/finalize', classification: 'exempt-local', reason: 'lands an authoring session\'s staged package into the local library — the `committing` turn performs NO SDK spawn at all — it runs copyStagingToLibrary, per bridge-studio-authoring.ts step 5, and the install writes local skills/<id>/ or studio/hooks/<id>/ bytes through the guarded-path helpers; no spawn, no remote, no daemon' },
  { method: 'POST', route: '/api/studio/agents/:slug/instructions-draft', classification: 'exempt-local', reason: 'composes an instructions draft from the request body and confirms the agent exists via a guarded SKILL.md existence check — writes nothing at all, no spawn, no remote (a POST only because the draft input arrives as a body)' },
  { method: 'POST', route: '/api/studio/kbs', classification: 'exempt-local', reason: 'creates a local KB directory' },
  { method: 'DELETE', route: '/api/studio/kbs/:id', classification: 'exempt-local', reason: 'removes a local KB directory' },
  { method: 'POST', route: '/api/studio/community/registry/items', classification: 'exempt-local', reason: 'adds a row to the local community registry file' },
  { method: 'PUT', route: '/api/studio/community/registry/items/:id', classification: 'exempt-local', reason: 'edits a local community registry row in place' },
  { method: 'DELETE', route: '/api/studio/community/registry/items/:id', classification: 'exempt-local', reason: 'removes a local community registry row' },
  { method: 'POST', route: '/api/studio/kbs/:id/guidance', classification: 'exempt-local', reason: 'writes a local guidance markdown file' },
  { method: 'POST', route: '/api/instructions/start', classification: 'exempt-local', reason: 'creates local session state; the spawn is on brief/answer/verdict' },
  { method: 'POST', route: '/api/project-brain/start', classification: 'exempt-local', reason: 'creates local session state; the spawn is on brief/approve' },
  { method: 'POST', route: '/api/project-brain/abandon', classification: 'exempt-local', reason: 'writes local session status only — confirmed it does NOT call spawnProjectBrainTurn (only /approve does)' },
  { method: 'POST', route: '/api/demo-builder/start', classification: 'exempt-local', reason: 'creates local session state; the spawn is on brief/feedback/lock/abandon' },
  { method: 'POST', route: '/api/studio/sessions/:kind/:sessionId/cancel', classification: 'exempt-local', reason: 'writes local session status (phase=cancelled) + SIGTERMs an owned live turn pid when one is tracked — no spawn/remote/daemon' },
  { method: 'POST', route: '/api/studio/sessions/:kind/:sessionId/:affordance', classification: 'stub-actions', reason: 'the generic session-affordance WRITE endpoint: its verdict/answer arms spawn the next agent turn, so the dry bridge skips the spawn and the 200 carries the dryBridge disclosure. First classified when M4 row 37 carved the dispatch into packages/sessions/routes.ts — while it was a host arm its matcher was a named const, which this table\'s cli scan cannot derive, so the route ran unclassified' },
  { method: 'POST', route: '/api/agents/runs/:runId/cancel', classification: 'exempt-local', reason: 'W7-B5 (agents-30): appends a local agent-dispatch.cancelled marker event + SIGTERMs an owned live dispatch pid when one is tracked (ownership proven via the runId in its argv) — no spawn/remote/daemon' },
  // ---- read-only ----------------------------------------------------------
  { method: 'GET', route: '*', classification: 'read-only', reason: 'all GET routes across the bridge are read-only by construction' },
] as const;

// ---------------------------------------------------------------------------
// Derivation — every OTHER carved route's row comes straight from its
// `RouteEntry.dryClassification`, read from each package's `routes.ts`
// SOURCE rather than by importing + invoking the route-table factories
// (which need real bridge deps — session ports, spawn closures — a
// classification table has no business constructing). Mirrors
// `dry-bridge-coverage.test.ts`'s own `extractRouteTableCandidates`
// (comment-stripped, line-based regex scan — no AST dependency); GET routes
// are skipped (blanket-covered by the wildcard read-only row), and a route
// whose exact (method, route) already has a `HAND_ROUTE_CLASSIFICATION` row
// (the op-suffixed KB-maintenance rows) is skipped so the union never
// carries two rows that both claim to be the SAME table entry.
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Strip `//` and block comments so a prose mention of `dryClassification:`
 *  can never be mistaken for the real field. Duplicated locally rather than
 *  imported from the test's copy — matching that file's own precedent of not
 *  sharing a cross-cutting helper module for a single small function. */
function stripComments(source: string): string {
  let out = '';
  let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code';
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (state === 'code') {
      if (ch === '/' && next === '/') { state = 'line'; out += '  '; i += 1; }
      else if (ch === '/' && next === '*') { state = 'block'; out += '  '; i += 1; }
      else if (ch === "'") { state = 'single'; out += ch; }
      else if (ch === '"') { state = 'double'; out += ch; }
      else if (ch === '`') { state = 'template'; out += ch; }
      else out += ch;
    } else if (state === 'line') {
      out += ch === '\n' ? '\n' : ' ';
      if (ch === '\n') state = 'code';
    } else if (state === 'block') {
      out += ch === '\n' ? '\n' : ' ';
      if (ch === '*' && next === '/') { out += ' '; i += 1; state = 'code'; }
    } else {
      out += ch;
      if (ch === '\\') { out += next ?? ''; i += 1; }
      else if ((state === 'single' && ch === "'") || (state === 'double' && ch === '"') || (state === 'template' && ch === '`')) {
        state = 'code';
      }
    }
  }
  return out;
}

const ROUTE_TABLE_ENTRY_RE =
  /method:\s*'(GET|POST|PUT|PATCH|DELETE)'\s*,\s*\n?\s*path:\s*'([^']+)'[\s\S]*?dryClassification:\s*'(refuse|stub-actions|exempt-local)'/g;

/** Every `packages/<pkg>/routes.ts` on disk, auto-discovered so a package that
 *  carves its routes tomorrow is picked up with no edit here — mirrors
 *  `dry-bridge-coverage.test.ts`'s own `DISPATCH_SCAN_DIRS` reasoning. */
function discoverRouteTableFiles(): readonly string[] {
  return readdirSync(join(REPO_ROOT, 'packages'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join('packages', e.name, 'routes.ts'))
    .filter((rel) => existsSync(join(REPO_ROOT, rel)))
    .sort();
}

/**
 * Every carved route's classification, read straight from its `RouteEntry`.
 * Exported (not just used to build `BRIDGE_ROUTE_CLASSIFICATION`) so the
 * coverage test can assert on it directly without re-implementing the scan.
 */
export function deriveCarvedRouteClassification(
  handRows: readonly RouteClassification[] = HAND_ROUTE_CLASSIFICATION,
): RouteClassification[] {
  const handKeys = new Set(handRows.map((r) => `${r.method} ${r.route}`));
  const seen = new Set<string>();
  const out: RouteClassification[] = [];
  for (const relFile of discoverRouteTableFiles()) {
    const clean = stripComments(readFileSync(join(REPO_ROOT, relFile), 'utf8'));
    ROUTE_TABLE_ENTRY_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ROUTE_TABLE_ENTRY_RE.exec(clean))) {
      const [, method, rawPath, classification] = m;
      if (method === 'GET') continue; // blanket-covered by the read-only wildcard row
      const route = rawPath.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ':id');
      const key = `${method} ${route}`;
      if (handKeys.has(key) || seen.has(key)) continue;
      seen.add(key);
      out.push({
        method: method as RouteClassification['method'],
        route,
        classification: classification as DryBridgeClassification,
        reason: `derived from ${relFile}'s RouteEntry.dryClassification (${rawPath})`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The coverage table — every bridge route, classified. Data, not prose.
// The union other modules/tests import: hand rows the derivation cannot
// produce, plus every carved route's derived row.
// ---------------------------------------------------------------------------

export const BRIDGE_ROUTE_CLASSIFICATION: readonly RouteClassification[] = [
  ...HAND_ROUTE_CLASSIFICATION,
  ...deriveCarvedRouteClassification(),
];
