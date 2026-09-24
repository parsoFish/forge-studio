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
