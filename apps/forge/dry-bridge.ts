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

import { createLogger, type EventLogger, isDryBridge, DRY_BRIDGE_ENV, DRY_BRIDGE_LOG_BUCKET } from '@forge/kernel';

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

/** The real-acting sub-steps a `stub-actions` route can individually skip in
 *  dry-bridge mode. The first three are `applyReviewVerdict`'s approve chain —
 *  exactly the actions that self-merged the PR on 2026-07-16. `agent-turn` is
 *  the spawn families' suppressed SDK-agent/runner turn (architect,
 *  instructions, project-brain, demo-builder, preflight-fix). */
export type DryBridgeStubAction = 'release-finalize' | 'merge-pr' | 'finalize-after-merge' | 'agent-turn';

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
// The coverage table — every bridge route, classified. Data, not prose.
// ---------------------------------------------------------------------------

export const BRIDGE_ROUTE_CLASSIFICATION: readonly RouteClassification[] = [
  // ---- refuse: full route-level 409 -------------------------------------
  { method: 'POST', route: '/api/scheduler/start', classification: 'refuse', action: 'daemon', guard: 'route',
    reason: 'spawns the detached forge serve daemon (spawnServeDetached)' },
  { method: 'POST', route: '/api/scheduler/stop', classification: 'refuse', action: 'daemon', guard: 'route',
    reason: 'SIGTERMs the live daemon process' },
  // W8-B5 (exit row E7) — the deterministic community-registry refresh. The
  // ONLY route in the bridge that calls a third-party API, and it calls it
  // with the operator's real GH_TOKEN. Refused outright rather than
  // stub-actioned: there is no local-bookkeeping half to keep (the network
  // call IS the route), and a harness run that silently spent the operator's
  // GitHub rate limit — or wrote live upstream numbers into the repo-tracked
  // registry — is the 2026-07-16 incident shape.
  { method: 'POST', route: '/api/studio/community/refresh', classification: 'refuse', action: 'network', guard: 'route',
    reason: 'calls api.github.com / registry.npmjs.org / registry.modelcontextprotocol.io with the operator\'s GH_TOKEN and rewrites studio/community/registry.yaml from the answers' },
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
  // The SAME handler has always answered POST on this URL — its legacy entry
  // gate was `method !== 'DELETE'`, not `method === 'PUT'` — but only the PUT
  // row was ever classified here, so the POST path reached the same
  // push-to-remote code with no dry-bridge row governing it. The M4 route
  // carve surfaced it: a table's `method` is singular, so the two methods
  // became two rows, and this guard immediately reported the missing one.
  { method: 'POST', route: '/api/studio/projects/:id', classification: 'refuse', action: 'git-remote', guard: 'route',
    reason: 'identical code path to the PUT row above — same handler, same saveProjectRepo merge + push' },

  // ---- stub-actions: the spawn-route families ----------------------------
  // Session bookkeeping (status/prompt/answers files) proceeds exactly as
  // under FORGE_ARCHITECT_NO_SPAWN today, but never silently: the suppressed
  // agent turn is explicit — `dryBridge: { skipped: ['agent-turn'] }` on the
  // 200 body + one `dry-bridge.skip` event (dryBridgeAgentTurnMarker). The
  // suppression itself is ORed into each helper's EXISTING internal NO_SPAWN
  // early-return (guard: 'spawn-helper'); NO_SPAWN-only keeps its legacy
  // silent-skip semantics byte-identical (no marker, no event).
  { method: 'POST', route: '/api/architect/start', classification: 'stub-actions', guard: 'spawn-helper',
    reason: 'spawnArchitectTurn — bookkeeping proceeds; the agent turn is skipped with marker + event' },
  { method: 'POST', route: '/api/architect/answer', classification: 'stub-actions', guard: 'spawn-helper',
    reason: 'spawnArchitectTurn — bookkeeping proceeds; the agent turn is skipped with marker + event' },
  { method: 'POST', route: '/api/architect/rerun', classification: 'stub-actions', guard: 'spawn-helper',
    reason: 'spawnArchitectTurn — StuckWarning re-run; re-spawns the existing session as-is (no round/answers mutation), the agent turn is skipped with marker + event' },
  { method: 'POST', route: '/api/plan-verdict', classification: 'stub-actions', guard: 'spawn-helper',
    reason: 'applyPlanVerdict → spawnArchitectTurn — marker on approve/revise (reject never spawns)' },
  { method: 'POST', route: '/api/runs/:id/gates/plan', classification: 'stub-actions', guard: 'spawn-helper',
    reason: 'same handler as /api/plan-verdict (applyPlanVerdict)' },
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


  // ---- stub-actions: connections install (R3-04, D6/D7; forge-6gv.8.2) ---
  // installArgvFor derives the real `npm install` argv from the catalog pin
  // ONLY — the request body is read for the `confirm` flag alone and never
  // for package/version/registry (D6). The suppression check is inline in
  // the route (mirrors verdict-approve/reflect-answer below, not a named
  // spawn-helper), so this row carries no `guard`. An UNCONFIRMED request
  // (forge-6gv.8.2) never reaches the suppression check at all — it returns
  // a preview and executes nothing, confirmed or not.
  { method: 'POST', route: '/api/studio/connections/:id/install', classification: 'stub-actions',
    reason: 'a CONFIRMED request runs a real `npm install` (network + child process); FORGE_DRY_BRIDGE=1 or FORGE_ARCHITECT_NO_SPAWN=1 suppress it and return {suppressed:true, wouldInstall} instead (D7, mirrors run-agent.ts\'s own double env check). An unconfirmed request never reaches this at all — it returns {ok:true, preview} (forge-6gv.8.2)' },

  // ---- stub-actions: community install (R3-07, D2/D9) --------------------
  // For a mcp/tool item this route delegates to the SAME connection-install
  // path as /api/studio/connections/:id/install above (byte-identical
  // suppression check, argv derivation, and executor) — a skill/hook item
  // never reaches a real-acting call at all (installSkillPackage /
  // installCommunityHookPackage only copy already-vendored local bytes).
  { method: 'POST', route: '/api/studio/community/:kind/:id/install', classification: 'stub-actions',
    reason: 'mcp/tool items route to the same real `npm install` path as /api/studio/connections/:id/install (same suppression, D7); skill/hook items only copy already-vendored local bytes, never real-acting' },

  // ---- stub-actions: verdict-approve special case -----------------------
  { method: 'POST', route: '/api/verdict', classification: 'stub-actions',
    reason: 'approve path proceeds (state transition + artifact writes) but skips runReleaseFinalize/mergePr/finalizeAfterMerge — the exact incident actions' },
  { method: 'POST', route: '/api/runs/:id/gates/verdict', classification: 'stub-actions',
    reason: 'same handler as /api/verdict (applyReviewVerdict)' },

  // ---- stub-actions: reflect-answer special case -------------------------
  // Task A-finalfix FIX 1: the handler does two things — writing
  // user-feedback.md (bookkeeping) and detached-firing rerunReflector (the
  // agent turn). Only the latter is suppressed, inline via
  // dryBridgeAgentTurnMarker (no spawn-helper mkdir/spawn pair exists here),
  // so — like verdict-approve — this row carries no `guard`.
  { method: 'POST', route: '/api/reflect/:cycleId/answer', classification: 'stub-actions', action: 'spawn-agent',
    reason: 'feedback bookkeeping proceeds; reflector rerun is the skipped agent turn' },

  // ---- exempt-local: mutates only local state ----------------------------
  { method: 'POST', route: '/api/scheduler/pause', classification: 'exempt-local', reason: 'flag file only, no process action' },
  { method: 'POST', route: '/api/scheduler/resume', classification: 'exempt-local', reason: 'flag file only, no process action' },
  { method: 'POST', route: '/api/studio/projects/:id/preflight/fix-auto', classification: 'exempt-local', reason: 'local git commit to forge-studio branch, no push' },
  // S3 (1.0.md §3) — "Rebuild contract" (M4-projects, packages/projects/
  // bridge-studio-project-reset.ts). Dry-run computes computeContractDrift
  // from the request body's optional appType and writes NOTHING — a POST
  // only because the app-type override arrives as a body, same shape as
  // /api/studio/agents/:slug/instructions-draft below.
  { method: 'POST', route: '/api/studio/projects/:id/contract-reset', classification: 'exempt-local', reason: 'computes the drift report (computeContractDrift) from the request body\'s optional appType override — writes nothing at all, no spawn, no remote (a POST only because the app-type override arrives as a body)' },
  // applyContractReset writes ONLY via withStudioWrite/commitStudioChange —
  // a local commit to the project's own forge-studio branch, never a push
  // (saveProjectRepo, refused above, is the only route that pushes) — same
  // shape as preflight/fix-auto directly above.
  { method: 'POST', route: '/api/studio/projects/:id/contract-reset/apply', classification: 'exempt-local', reason: 'applyContractReset commits locally to the project\'s forge-studio branch (withStudioWrite/commitStudioChange) — no push, no spawn, no remote' },
  { method: 'POST', route: '/api/studio/projects', classification: 'exempt-local', reason: 'onboard: local git init + file scaffolds only' },
  { method: 'POST', route: '/api/studio/projects/create', classification: 'exempt-local', reason: 'greenfield create (R4-03): local template scaffold + brain seed, no spawn/remote' },
  { method: 'POST', route: '/api/develop/start', classification: 'exempt-local', reason: 'manifest move only' },
  { method: 'POST', route: '/api/initiatives/:id/plan', classification: 'exempt-local', reason: 'plan enqueue: manifest move only (scheduler decomposes, no in-request spawn)' },
  { method: 'POST', route: '/api/flows/:id/run', classification: 'exempt-local', reason: 'W7-A3 per-flow enqueue: manifest move only (enqueueFlowRun); the scheduler claims it later, no in-request spawn' },
  { method: 'POST', route: '/api/runs', classification: 'exempt-local', reason: 'manifest move only' },
  { method: 'POST', route: '/api/studio/kbs/:id/maintenance (op=lint|fix-auto|index)', classification: 'exempt-local', reason: 'local brain lint/fix/index only' },
  // ---- exempt-local: kb drain-to-green (W6-B12) --------------------------
  // Same reasoning as /api/studio/kbs/:id/cleanup/apply above: this route
  // dispatches runKbDrain (packages/knowledge/bridge-studio-kb-drain.ts), which carries its
  // OWN noSpawn guard (`FORGE_ARCHITECT_NO_SPAWN === '1' || isDryBridge()`,
  // mirroring runBrainConsolidateNow's identical guard) — under dry-bridge
  // the drain loop still runs its local auto-tier fixes and lint scans to a
  // real (honest) terminal state, just with agent-tier turns skipped rather
  // than the whole route refusing outright.
  { method: 'POST', route: '/api/studio/kbs/:id/drain', classification: 'exempt-local',
    reason: 'runs the KB drain-to-green loop (runKbDrain) — that loop already self-suppresses its own agent-tier spawn under dry-bridge, so this route is never suppressed further (mirrors op=consolidate|lint|fix-auto|index and /cleanup/apply above)' },
  { method: 'POST', route: '/api/studio/kbs/:id/drain/cancel', classification: 'exempt-local',
    reason: 'W7-B2 (knowledge-14): writes the local cancel flag (_logs/_kb-drain-<runId>/cancel.json) a live drain loop honors between turns, or force-terminates a DEAD run by rewriting its local status.json — local files only, no agent spawn, no network; the loop it stops is the same self-suppressing runKbDrain above' },
  { method: 'POST', route: '/api/review-comments/:cycleId', classification: 'exempt-local', reason: 'appends to the local review-comments sidecar' },
  { method: 'POST', route: '/api/review-comments/:cycleId/resolve', classification: 'exempt-local', reason: 'marks a local review-comments sidecar entry resolved' },
  { method: 'POST', route: '/api/review-comments/:cycleId/edit', classification: 'exempt-local', reason: 'rewrites one local review-comments sidecar entry (W7-B7 artifact-plan-15)' },
  { method: 'POST', route: '/api/review-comments/:cycleId/delete', classification: 'exempt-local', reason: 'removes one local review-comments sidecar entry (W7-B7 artifact-plan-15)' },
  { method: 'PUT', route: '/api/studio/agents/:slug', classification: 'exempt-local', reason: 'writes a local SKILL.md' },
  { method: 'PUT', route: '/api/studio/flows/:id', classification: 'exempt-local', reason: 'writes a local flow.yaml' },
  // W7-B4 — library authoring write surface: every route below edits or
  // removes an already-materialised LOCAL file package (skills/<id>/,
  // studio/hooks/<id>/, studio/artifact-templates|demo-elements, flow dirs)
  // through the same guarded-path helpers its POST siblings above use.
  // No spawn, no remote, no daemon — exempt-local like those siblings.
  { method: 'DELETE', route: '/api/studio/agents/:slug', classification: 'exempt-local', reason: 'removes a local skills/<slug>/ package (409 while referenced by a flow node or session kind)' },
  { method: 'DELETE', route: '/api/studio/flows/:id', classification: 'exempt-local', reason: 'removes a local flow directory (seed flows 403, active run 423)' },
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
  // M4 §4 step 2 — TWO ROUTES THIS TABLE HAD NEVER SEEN. Both already existed
  // and both are non-GET; neither was ever classified, because
  // `dry-bridge-coverage.test.ts` derives its candidates by reading
  // `url === '<literal>'` / `url.match(/…/)` arms and BOTH of these arms
  // compared against a module CONST instead (`FINALIZE_URL`,
  // `INSTRUCTIONS_DRAFT_ROUTE_RE`). Carving them into
  // `packages/library/routes.ts` states their method and path as DATA, which
  // is what makes them visible — the carve un-blinded the scanner rather than
  // adding routes. Same failure shape as COMMON §15.16's directory-list-scoped
  // guard: the check passed while its scope silently excluded real routes.
  { method: 'POST', route: '/api/studio/authoring/finalize', classification: 'exempt-local', reason: 'lands an authoring session\'s staged package into the local library — the `committing` turn performs NO SDK spawn at all — it runs copyStagingToLibrary, per bridge-studio-authoring.ts step 5, and the install writes local skills/<id>/ or studio/hooks/<id>/ bytes through the guarded-path helpers; no spawn, no remote, no daemon' },
  { method: 'POST', route: '/api/studio/agents/:slug/instructions-draft', classification: 'exempt-local', reason: 'composes an instructions draft from the request body and confirms the agent exists via a guarded SKILL.md existence check — writes nothing at all, no spawn, no remote (a POST only because the draft input arrives as a body)' },
  { method: 'POST', route: '/api/studio/kbs', classification: 'exempt-local', reason: 'creates a local KB directory' },
  { method: 'DELETE', route: '/api/studio/kbs/:id', classification: 'exempt-local', reason: 'removes a local KB directory' },
  // W7-B3 (community-23) — registry CRUD: all three write ONLY the local
  // repo-tracked studio/community/registry.yaml (fixed path, temp+rename,
  // re-parsed through loadCommunityRegistry before the rename); no spawn,
  // no network, no git action — the operator commits via their own flow.
  { method: 'POST', route: '/api/studio/community/registry/items', classification: 'exempt-local', reason: 'adds a row to the local community registry file' },
  { method: 'PUT', route: '/api/studio/community/registry/items/:id', classification: 'exempt-local', reason: 'edits a local community registry row in place' },
  { method: 'DELETE', route: '/api/studio/community/registry/items/:id', classification: 'exempt-local', reason: 'removes a local community registry row' },
  { method: 'POST', route: '/api/studio/kbs/:id/guidance', classification: 'exempt-local', reason: 'writes a local guidance markdown file' },
  { method: 'POST', route: '/api/initiatives', classification: 'exempt-local', reason: 'writeManifest — local queue write only' },
  { method: 'POST', route: '/api/instructions/start', classification: 'exempt-local', reason: 'creates local session state; the spawn is on brief/answer/verdict' },
  { method: 'POST', route: '/api/project-brain/start', classification: 'exempt-local', reason: 'creates local session state; the spawn is on brief/approve' },
  { method: 'POST', route: '/api/project-brain/abandon', classification: 'exempt-local', reason: 'writes local session status only — confirmed it does NOT call spawnProjectBrainTurn (only /approve does)' },
  { method: 'POST', route: '/api/demo-builder/start', classification: 'exempt-local', reason: 'creates local session state; the spawn is on brief/feedback/lock/abandon' },
  { method: 'POST', route: '/api/hooks/:hookId', classification: 'exempt-local', reason: 'signature-verified webhook receipt: stages a claimable flow-run request file only — dispatch happens in the daemon sweep behind NO_SPAWN/dry-bridge' },
  // W7-A2 — the generic session cancel: writes the universal `cancelled`
  // terminal phase onto the session's own status.json and SIGTERMs the
  // session's tracked turn pid IF one is alive and provably ours (a
  // journey/dry seed never has one). No spawn, no remote, no daemon.
  { method: 'POST', route: '/api/studio/sessions/:kind/:sessionId/cancel', classification: 'exempt-local', reason: 'writes local session status (phase=cancelled) + SIGTERMs an owned live turn pid when one is tracked — no spawn/remote/daemon' },
  { method: 'POST', route: '/api/studio/sessions/:kind/:sessionId/:affordance', classification: 'stub-actions', reason: 'the generic session-affordance WRITE endpoint: its verdict/answer arms spawn the next agent turn, so the dry bridge skips the spawn and the 200 carries the dryBridge disclosure. First classified when M4 row 37 carved the dispatch into packages/sessions/routes.ts — while it was a host arm its matcher was a named const, which this table\'s cli scan cannot derive, so the route ran unclassified' },
  { method: 'POST', route: '/api/agents/runs/:runId/cancel', classification: 'exempt-local', reason: 'W7-B5 (agents-30): appends a local agent-dispatch.cancelled marker event + SIGTERMs an owned live dispatch pid when one is tracked (ownership proven via the runId in its argv) — no spawn/remote/daemon' },

  // ---- read-only ----------------------------------------------------------
  { method: 'GET', route: '*', classification: 'read-only', reason: 'all GET routes across the bridge are read-only by construction' },
] as const;

// ---------------------------------------------------------------------------
// emitDryBridgeSkip — the stub-actions per-skip JSONL event (verdict-approve)
// ---------------------------------------------------------------------------

/**
 * Emit one JSONL event for a single skipped stub-action, into the SAME
 * cycle's events.jsonl the rest of that cycle's history lives in (the caller
 * already has a `createLogger`-derived logger for this cycle — reused here,
 * not re-derived). `extra` merges additional metadata (e.g. the route for
 * agent-turn skips, which log into the shared bucket). Never throws —
 * best-effort, matching its siblings (`emitDryBridgeRefusal`,
 * `dryBridgeAgentTurnMarker`): a logging failure must never fail the caller's
 * response (e.g. a verdict approve/merge already in flight).
 */
export function emitDryBridgeSkip(
  logger: EventLogger,
  initiativeId: string,
  action: DryBridgeStubAction,
  extra: Record<string, unknown> = {},
): void {
  try {
    logger.emit({
      initiative_id: initiativeId,
      phase: 'orchestrator',
      skill: 'dry-bridge',
      event_type: 'log',
      input_refs: [],
      output_refs: [],
      message: 'dry-bridge.skip',
      metadata: { action, ...extra },
    });
  } catch { /* best-effort — never break the caller on a logging failure */ }
}

// ---------------------------------------------------------------------------
// dryBridgeAgentTurnMarker — the stub-actions marker for the spawn families
// ---------------------------------------------------------------------------

/**
 * bead forge-8nw — the ONE `dryBridgeAgentTurnMarker` caller (POST
 * `/api/agents/:slug/run`, `apps/forge/ui-bridge.ts`) whose 3rd argument is not a
 * session id at all but the STANDALONE dispatch's own `runId` (minted
 * `` `_agent-${slug}-${stamp}` ``, then handed to this function verbatim as
 * `sessionId`). `runId` doubles as the run's OWN `_logs/` directory NAME —
 * the exact string `deriveStandaloneRunState`/`GET /api/agents/runs/:runId`
 * (`apps/forge/ui-bridge.ts`) reads back. Every OTHER call site (architect/
 * instructions/demo-builder/project-brain/onboarding/authoring/kb-cleanup —
 * see this file's `BRIDGE_ROUTE_CLASSIFICATION` table) passes a session id
 * whose own terminal state lives in `status.json`
 * (`writeSessionTerminalPhase`, `packages/agents/agent-run.ts`), not in an
 * events.jsonl any standalone-run deriver ever reads — so only THIS route
 * gets the extra write below.
 */
const STANDALONE_DISPATCH_ROUTE = '/api/agents/:slug/run';

/**
 * For the spawn-route families (classification 'stub-actions', guard
 * 'spawn-helper'): when dry-bridge is active, emit one `dry-bridge.skip`
 * agent-turn event and return the `dryBridge` fragment to spread into the
 * route's 200 body. When inactive — including under
 * FORGE_ARCHITECT_NO_SPAWN-only, whose legacy silent-skip semantics stay
 * byte-identical — returns `{}` and emits nothing. Call exactly once per
 * response, only on branches that would have spawned.
 *
 * bead forge-8nw / forge-720 — beyond the shared-bucket skip event above,
 * a standalone dispatch (`STANDALONE_DISPATCH_ROUTE`) ALSO gets a terminal
 * marker written into ITS OWN `<logsRoot>/<runId>/events.jsonl` — the file
 * `deriveStandaloneRunState` (`apps/forge/ui-bridge.ts`) actually reads to derive
 * `GET /api/agents/runs/:runId`'s state. Without this, a dispatch under
 * dry-bridge wrote only into the shared `DRY_BRIDGE_LOG_BUCKET`, so its own
 * run directory never recorded a terminal fact and the run derived
 * `state: 'running'` FOREVER — the measured root cause of the zombie
 * `_agent-onboarding-agent-*` / `_agent-w7-throwaway-agent-*` directories
 * bead forge-720 found on disk. The message reuses the EXACT literal
 * `'run-agent.spawn-suppressed'` a REAL (non-dry-bridge) suppressed spawn
 * already writes into this same run's log (`orchestrator/run-agent.ts`,
 * its own `FORGE_DRY_BRIDGE_ENV`/`FORGE_ARCHITECT_NO_SPAWN_ENV` early
 * return) — no new marker vocabulary, exactly what
 * `deriveStandaloneStateFromEvents` (`apps/forge/ui-bridge.ts`) already checks via
 * `parsed.some((e) => e['message'] === 'run-agent.spawn-suppressed')` to
 * derive `state: 'suppressed'`. `createLogger` appends (never truncates),
 * so this lands safely after the route's own t0 `agent-run.dispatched`
 * marker (`apps/forge/ui-bridge.ts`, written the instant `runId` is minted, before
 * this function is ever called).
 */
export function dryBridgeAgentTurnMarker(
  logsRoot: string,
  route: string,
  sessionId?: string,
): { dryBridge?: { skipped: DryBridgeStubAction[] } } {
  if (!isDryBridge()) return {};
  try {
    const logger = createLogger(DRY_BRIDGE_LOG_BUCKET, logsRoot);
    emitDryBridgeSkip(logger, DRY_BRIDGE_LOG_BUCKET, 'agent-turn', {
      route,
      ...(sessionId ? { sessionId } : {}),
    });
  } catch { /* best-effort — never break the route response on a logging failure */ }

  if (sessionId && route === STANDALONE_DISPATCH_ROUTE) {
    try {
      createLogger(sessionId, logsRoot).emit({
        initiative_id: sessionId,
        phase: 'orchestrator',
        skill: 'dry-bridge',
        event_type: 'log',
        input_refs: [],
        output_refs: [],
        message: 'run-agent.spawn-suppressed',
        metadata: { reason: DRY_BRIDGE_ENV, route },
      });
    } catch { /* best-effort — never break the route response on a logging failure */ }
  }

  return { dryBridge: { skipped: ['agent-turn'] } };
}
