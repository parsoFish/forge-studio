/**
 * bridge-studio-session-index.ts — `GET /api/studio/sessions`, the ONE list
 * that spans every session kind, plus the per-kind readers it aggregates.
 *
 * WHY THIS IS ITS OWN MODULE AND CARVES LAST. The collector flattens every
 * registered kind (`studio/session-kinds.yaml` via `loadSessionKinds` — never a
 * hardcoded list), and for the four kinds that have their own list route it
 * reuses THAT route's reader verbatim rather than re-deriving rows. So it
 * depends on all four families at once, which put it above the helper layer and
 * made it the last thing that could move: until architect, instructions,
 * project-brain and demo had all carved, this module would have had to import
 * its readers back out of the host.
 *
 * THREE INJECTED DEPS COLLAPSE HERE. While the families carved one at a time,
 * `listInstructionsSessions`, `listProjectBrainSessions` and `listDemoSessions`
 * were passed in through `SessionsRouteDeps` — the inject-then-collapse the
 * carve spec §8.2 used for the shared helpers — precisely because the host's
 * collector was still their last caller. That caller is now here, so the three
 * readers move for real and the three deps go away. Copying them into the
 * package earlier would have left two definitions of one reader; the injection
 * was what avoided that.
 *
 * `listArchitectSessions` is NOT here: it already lives in
 * `architect-runner.ts` and is imported directly.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { allowedOrigin, parseQuery, pathOnly, sanitizeError, sendJson } from '@forge/kernel';
import { resolveGuardedPath } from '@forge/kernel/path-guard.ts';

import { listArchitectSessions } from './kinds/architect.ts';
import type { SessionLifecycleState } from './bridge-studio-lifecycle.ts';
import { sessionShellHref } from './bridge-studio-sessions.ts';
import {
  deriveRowLifecycle,
  guardedSessionDir,
  type SessionRootsContext,
} from './bridge-studio-session-helpers.ts';
import type { DemoBuilderStatus } from './kinds/demo-builder.ts';
import type { InstructionsStatus } from './kinds/instructions.ts';
import { guardedReadSessionStatus } from './interactive-session.ts';
import type { ProjectBrainRow as ProjectBrainStatus } from './bridge-studio-project-brain.ts';
import { fixedTierForSessionKind } from './session-model-tier.ts';
import { loadSessionKinds } from './studio/session-kinds.ts';
import type { SessionKindDescriptor } from './studio/session-kinds.ts';

export const SESSION_INDEX_MAX_ROWS = 200;

/** What the index route reads off the bridge. */
export type SessionIndexRouteContext = SessionRootsContext;


/** One row of the aggregate `GET /api/studio/sessions` index: every in-flight
 *  (or, without `?active=1`, every) interactive session across ALL registry
 *  kinds and every project, flattened to the fields the /sessions index page
 *  + Home's active-sessions strip both need. */
export type SessionIndexRow = {
  kind: string;
  sessionId: string;
  project: string;
  phase: string;
  /** Derived via `isTerminalPhase` (cli/bridge-studio-sessions.ts) — the
   *  SAME derivation the single-session route's tail-gating already uses,
   *  never a second, hand-kept terminal-phase notion. */
  terminal: boolean;
  /** W7-A2 — TRUTHFUL in both directions: `deriveSessionLifecycle(...)
   *  .needsYou` (cli/bridge-studio-lifecycle.ts) — true iff an operator
   *  gate is open (`awaits: questions|verdict` on the phase row, or the
   *  LEGACY_SESSION_AWAITS_PHASES table for architect/project-brain) OR the
   *  runner crashed/stalled. An agent that is merely working (a `step:
   *  agent` row's staged-review/next-turn affordances) is NOT "needs you" —
   *  the pre-W7 derivation (`deriveSessionAffordances(...).length > 0`)
   *  counted those and inverted the signal for four of eight kinds
   *  (home-sessions-08, sessions-kinds-15). */
  needsYou: boolean;
  /** W7-A2 — the derived lifecycle state (`working` | `awaiting-operator` |
   *  `crashed` | `stalled` | `terminal`); see cli/bridge-studio-lifecycle.ts. */
  state: SessionLifecycleState;
  /** W7-A2 — the runner's crash message read live off
   *  `_logs/_<kind>-<sid>/stderr.log` for a `crashed` row; `null` otherwise. */
  error: string | null;
  /** W7-A2 — ms since the last on-disk sign of life; `null` when the
   *  session has no log dir (no liveness signal). */
  idleMs: number | null;
  modelTier: string | null;
  /** ISO timestamp of the session's last known write, or `''` — honest-absent,
   *  never fabricated — when the kind's status.json carries no timestamp
   *  field at all (kb-cleanup's shape today). */
  updatedAt: string;
  href: string;
};
/** Generic phase/model/timestamp read for a session-kind with no dedicated
 *  per-kind list route (onboarding, authoring, kb-cleanup, and any future
 *  kind registered the same way) — the SAME guarded choke point
 *  (`resolveGuardedPath`) `readGuardedSessionStatus` (above) uses, just
 *  widened to the extra fields the aggregate index needs; not a second,
 *  independently-invented containment mechanism. `updatedAt` prefers
 *  `updated_at` (the four legacy kinds' own field name, in case a future
 *  kind reuses it), falls back to `startedAt` (onboarding's/authoring's own
 *  field — `writeOnboardingSession`/`writeAuthoringSession`, this file), and
 *  is `''` — honest-absent, never fabricated — when neither exists
 *  (kb-cleanup's status.json carries no timestamp field at all today). */
function readGuardedSessionIndexSummary(
  projectsRoot: string,
  project: string,
  kindDirName: string,
  sessionId: string,
): { phase: string; modelTier: string | null; updatedAt: string } | null {
  const guarded = resolveGuardedPath(projectsRoot, [project, kindDirName, sessionId, 'status.json']);
  if (!guarded.ok || !guarded.exists) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(guarded.realPath, 'utf8'));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.phase !== 'string') return null;
  return {
    phase: obj.phase,
    modelTier: typeof obj.modelTier === 'string' ? obj.modelTier : null,
    updatedAt: typeof obj.updated_at === 'string' ? obj.updated_at : typeof obj.startedAt === 'string' ? obj.startedAt : '',
  };
}
/** Discover every instructions session under `projects/<name>/_instructions/<sid>/`
 *  — used by the bridge's `GET /api/instructions/sessions`. Best-effort; never
 *  throws on a malformed dir. Mirrors architect-runner's `listArchitectSessions`,
 *  kept local to the bridge (not added to the runner). */
export function listInstructionsSessions(projectsRoot: string): InstructionsStatus[] {
  const out: InstructionsStatus[] = [];
  if (!existsSync(projectsRoot)) return out;
  let projects: string[];
  try { projects = readdirSync(projectsRoot); } catch { return out; }
  for (const project of projects) {
    const instrDir = join(projectsRoot, project, '_instructions');
    if (!existsSync(instrDir)) continue;
    let sids: string[];
    try {
      sids = readdirSync(instrDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch { continue; }
    for (const sid of sids) {
      if (sid.startsWith('_')) continue; // skip _archived/
      // SEC-04 (AT-47) — resolve through the per-segment identity guard so a
      // symlinked `_instructions` (git-plantable inside any onboarded project's
      // own repo) cannot fold this enumeration onto a victim dir outside root.
      const dir = guardedSessionDir(projectsRoot, project, '_instructions', sid);
      if (!dir) continue;
      // SEC-04 (bd forge-ebj) — route the status.json READ through the guarded
      // leaf sibling so a symlinked `status.json` inside a real session dir is
      // refused, not followed (the dir guard alone did not cover the leaf).
      const status = guardedReadSessionStatus<InstructionsStatus>(projectsRoot, [project, '_instructions', sid]);
      if (status) out.push(status);
    }
  }
  return out;
}
/** R1-3b — list every project-brain session with its current state. */
export function listProjectBrainSessions(projectsRoot: string): ProjectBrainStatus[] {
  const out: ProjectBrainStatus[] = [];
  if (!existsSync(projectsRoot)) return out;
  let projects: string[];
  try { projects = readdirSync(projectsRoot); } catch { return out; }
  for (const project of projects) {
    const base = join(projectsRoot, project, '_project-brain');
    if (!existsSync(base)) continue;
    let sids: string[];
    try { sids = readdirSync(base); } catch { continue; }
    for (const sid of sids) {
      // SEC-04 (AT-47) — resolve through the per-segment identity guard so a
      // symlinked `_project-brain` cannot fold this enumeration onto a victim
      // dir outside root.
      const dir = guardedSessionDir(projectsRoot, project, '_project-brain', sid);
      if (!dir) continue;
      // SEC-04 (bd forge-ebj) — status.json READ through the guarded leaf
      // sibling (leaf-symlink close; the dir guard did not cover the leaf).
      const status = guardedReadSessionStatus<ProjectBrainStatus>(projectsRoot, [project, '_project-brain', sid]);
      if (status) out.push(status);
    }
  }
  return out;
}
/** Discover every demo-builder session under `projects/<name>/_demo/<sid>/`
 *  — used by the bridge's `GET /api/demo-builder/sessions`. Best-effort; never
 *  throws on a malformed dir. Mirrors `listInstructionsSessions`. */
export function listDemoSessions(projectsRoot: string): DemoBuilderStatus[] {
  const out: DemoBuilderStatus[] = [];
  if (!existsSync(projectsRoot)) return out;
  let projects: string[];
  try { projects = readdirSync(projectsRoot); } catch { return out; }
  for (const project of projects) {
    const demoDir = join(projectsRoot, project, '_demo');
    if (!existsSync(demoDir)) continue;
    let sids: string[];
    try {
      sids = readdirSync(demoDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch { continue; }
    for (const sid of sids) {
      if (sid.startsWith('_')) continue; // skip _archived/
      // SEC-04 (AT-47) — resolve through the per-segment identity guard so a
      // symlinked `_demo` cannot fold this enumeration onto a victim dir
      // outside root.
      const dir = guardedSessionDir(projectsRoot, project, '_demo', sid);
      if (!dir) continue;
      // SEC-04 (bd forge-ebj) — status.json READ through the guarded leaf
      // sibling (leaf-symlink close; the dir guard did not cover the leaf).
      const status = guardedReadSessionStatus<DemoBuilderStatus>(projectsRoot, [project, '_demo', sid]);
      if (status) out.push(status);
    }
  }
  return out;
}
function collectStudioSessionIndexRows(ctx: { forgeRoot: string; projectsRoot: string; logsRoot: string }): SessionIndexRow[] {
  const descriptors = loadSessionKinds(ctx.forgeRoot);
  const rows: SessionIndexRow[] = [];
  // W8-B3 (sessions-kinds-R06/31) — resolved ONCE PER KIND for this request,
  // not once per row. The tier is a property of the KIND's agent, so a
  // per-row lookup would re-read the same SKILL.md for every session of that
  // kind — 24+ file reads on today's corpus, on a polled index route, for at
  // most 8 distinct answers. Request-scoped and thrown away afterwards, so it
  // is still derived at read time and a re-pointed SKILL.md is picked up on
  // the very next request; nothing is cached across requests.
  const tierByKind = new Map<string, string | null>();
  const fixedTierFor = (descriptor: SessionKindDescriptor): string | null => {
    const hit = tierByKind.get(descriptor.id);
    if (hit !== undefined) return hit;
    const resolved = fixedTierForSessionKind(ctx.forgeRoot, descriptor);
    tierByKind.set(descriptor.id, resolved);
    return resolved;
  };

  const pushRow = (
    descriptor: SessionKindDescriptor,
    sessionId: string,
    project: string,
    phase: string,
    modelTier: string | null,
    updatedAt: string,
  ): void => {
    // `SessionIndexRow.needsYou`'s own header: "a derivable operator
    // affordance exists at this phase" — a terminal session, by
    // definition, needs nothing further from the operator; `deriveRowLifecycle`
    // derives `terminal` before `lifecycle` so that is true structurally.
    const { terminal, lifecycle } = deriveRowLifecycle(ctx, descriptor, phase, project, sessionId);
    // W8-B3 (sessions-kinds-R06/31) — the SAME read-time fixed-tier fallback
    // the session shell applies (cli/session-model-tier.ts), so the index
    // MODEL column and the session's own chip can never disagree about what a
    // fixed-tier kind ran on. The index used to show "—" for every architect
    // and project-brain row for exactly this reason.
    const resolvedTier = modelTier ?? fixedTierFor(descriptor);
    rows.push({
      kind: descriptor.id,
      sessionId,
      project,
      phase,
      terminal,
      needsYou: lifecycle.needsYou,
      state: lifecycle.state,
      error: lifecycle.error,
      idleMs: lifecycle.idleMs,
      modelTier: resolvedTier,
      updatedAt,
      // W8-F6 (bead forge-6gv.27) — the ONE server-side builder of a session
      // address (cli/bridge-studio-sessions.ts), so the index and the route it
      // links to can never disagree about where a session lives. Every row
      // here is status.json-backed by construction (`readGuardedSessionIndexSummary`
      // above, and the four bespoke per-kind listers), i.e. already
      // `resolveReadableSession`'s `source:'status'` arm — pinned rather than
      // re-probed at runtime, which would be a guard that can never fail.
      href: sessionShellHref(descriptor.id, sessionId, project),
    });
  };

  for (const descriptor of descriptors) {
    if (descriptor.id === 'architect') {
      for (const s of listArchitectSessions(ctx.projectsRoot)) {
        pushRow(descriptor, s.session_id, s.project, s.phase, s.modelTier ?? null, s.updated_at ?? '');
      }
    } else if (descriptor.id === 'instructions') {
      for (const s of listInstructionsSessions(ctx.projectsRoot)) {
        pushRow(descriptor, s.session_id, s.project, s.phase, s.modelTier ?? null, s.updated_at ?? '');
      }
    } else if (descriptor.id === 'demo') {
      for (const s of listDemoSessions(ctx.projectsRoot)) {
        pushRow(descriptor, s.session_id, s.project, s.phase, s.modelTier ?? null, s.updated_at);
      }
    } else if (descriptor.id === 'project-brain') {
      for (const s of listProjectBrainSessions(ctx.projectsRoot)) {
        pushRow(descriptor, s.session_id, s.project, s.phase, s.modelTier ?? null, s.updated_at);
      }
    } else {
      const kindDirName = `_${descriptor.id}`;
      let projects: string[];
      try {
        projects = existsSync(ctx.projectsRoot) ? readdirSync(ctx.projectsRoot) : [];
      } catch {
        projects = [];
      }
      for (const project of projects) {
        const kindDir = join(ctx.projectsRoot, project, kindDirName);
        if (!existsSync(kindDir)) continue;
        let sessionIds: string[];
        try {
          sessionIds = readdirSync(kindDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
        } catch {
          continue;
        }
        for (const sessionId of sessionIds) {
          if (sessionId.startsWith('_')) continue; // skip _archived/, mirrors collectSessionRows
          const summary = readGuardedSessionIndexSummary(ctx.projectsRoot, project, kindDirName, sessionId);
          if (summary === null) continue; // unreadable/missing/escaping/hardlinked -> not a real session row
          pushRow(descriptor, sessionId, project, summary.phase, summary.modelTier, summary.updatedAt);
        }
      }
    }
  }
  return rows;
}

/** Deterministic ordering + bound for the aggregate sessions index —
 *  needs-you rows first, then newest-`updatedAt` first within each group;
 *  capped to the newest `cap` rows. Pure (no I/O), so it is unit-testable in
 *  isolation from the filesystem (ADR 042's "a pure function with an
 *  explicit error contract may be exported for direct tests" boundary).
 *  ISO-8601 timestamps compare correctly as plain strings; a `''`
 *  honest-absent `updatedAt` (kb-cleanup's shape today) sorts LAST within its
 *  needsYou group — an empty string is always lexically smaller than any real
 *  timestamp — never mistaken for "newest". */
export function sortAndCapSessionIndexRows(
  rows: readonly SessionIndexRow[],
  cap: number = SESSION_INDEX_MAX_ROWS,
): SessionIndexRow[] {
  return [...rows]
    .sort((a, b) => {
      if (a.needsYou !== b.needsYou) return a.needsYou ? -1 : 1;
      if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? -1 : 1;
      return 0;
    })
    .slice(0, cap);
}
/**
 * GET /api/studio/sessions[?active=1] — the aggregate sessions index backing
 * the /sessions page + Home's active-sessions strip. No path segments
 * (distinguishes it from `GET /api/studio/sessions/:kind/:id`,
 * bridge-studio-sessions.ts's single-session route — that regex requires
 * exactly two further path segments, this route requires none). Read-only —
 * covered by BRIDGE_ROUTE_CLASSIFICATION's blanket `{method:'GET',
 * route:'*'}` row (cli/dry-bridge.ts); no per-route table entry is needed
 * for a GET.
 *
 * `?active=1` filters to non-terminal rows only — the shape the /sessions
 * page and Home strip both request (operator-locked: in-flight sessions
 * ONLY, never terminal history). Omitting the query param returns every row
 * (terminal included), kept for testability and any future consumer that
 * genuinely wants the unfiltered set.
 */
export async function handleStudioSessionsIndex(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: SessionIndexRouteContext,
  url: string,
  method: string,
): Promise<boolean> {
  if (method !== 'GET' || pathOnly(url) !== '/api/studio/sessions') return false;
  const origin = allowedOrigin(req);
  try {
    const activeOnly = parseQuery(url).get('active') === '1';
    const allRows = collectStudioSessionIndexRows({ forgeRoot: ctx.forgeRoot, projectsRoot: ctx.projectsRoot, logsRoot: ctx.logsRoot });
    const filtered = activeOnly ? allRows.filter((r) => !r.terminal) : allRows;
    const sessions = sortAndCapSessionIndexRows(filtered);
    sendJson(res, 200, { sessions, cap: SESSION_INDEX_MAX_ROWS }, origin);
  } catch (err) {
    sendJson(res, 500, { error: sanitizeError(err) }, origin);
  }
  return true;
}