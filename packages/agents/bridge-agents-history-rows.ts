/**
 * bridge-agents-history-rows.ts — the four collectors behind
 * `GET /api/agents/:slug/history` and `GET /api/agents/runs/recent`.
 *
 * Carved out of `apps/forge/ui-bridge.ts` (M4-agents, exit row 2). Like its sibling
 * `bridge-agents-run-state.ts`, every symbol here served the `/api/agents/*`
 * routes and nothing else — checked per symbol before the move.
 *
 * THESE ARE NOT THIN. An agent's history is an aggregation across three
 * sources that live in three different packages: flow-node rows come from
 * `@forge/flows`' run list, standalone rows from the guarded event logs
 * `@forge/sessions` parses, and session rows from the session-kind registry.
 * That is why the four handlers they back could not simply be lifted: moving
 * these collectors' SOURCE while they still called rank-4 and rank-5 modules
 * directly would have relocated four boundary violations rather than closing
 * them. They are pure functions of `AgentHistoryDeps` instead, bound once at
 * `apps/forge/routes.ts`.
 *
 * WHAT DID NOT CHANGE. Every honesty rule is carried verbatim, because each
 * one is a defect someone already paid for: a run whose flow never reached the
 * node produces NO row rather than a fabricated one; a standalone dir with no
 * events, or one the guard rejected, is honestly unattributable and produces
 * no row rather than a guess; `loadSessionKinds` is allowed to THROW on a
 * missing `session-kinds.yaml` so a misconfigured studio fails loudly instead
 * of degrading to a stale mirror; one malformed flow never sinks the whole
 * mapping; and rows are deduped by `id` because `HistoryLedger` keys on it.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { resolveGuardedPath } from '@forge/kernel';

import {
  deriveStandaloneStateFromEvents,
  standaloneRunMatchesSlug,
  withStandaloneLiveness,
  STANDALONE_RUN_DIR_PREFIX,
  type AgentFlowRun,
  type AgentHistoryRow,
  type AgentRunStateDeps,
} from './bridge-agents-run-state.ts';

/**
 * What the collectors need from above this package's rank, declared
 * STRUCTURALLY — a type-only import of `@forge/flows` or `@forge/sessions`
 * would still be an edge (`check-boundaries` runs with
 * `tsPreCompilationDeps: true`). `apps/forge/routes.ts` supplies the real
 * implementations.
 */
export type AgentHistoryDeps = AgentRunStateDeps & {
  /** `cachedListRuns` — ADR-044 P1's cached per-manifest derivation. */
  cachedListRuns(forgeRoot: string, nowMs: number): readonly AgentFlowRun[];
  /** `buildAgentSlugToNodeId` — agent slug → the node id it occupies. */
  buildAgentSlugToNodeId(forgeRoot: string): Map<string, string>;
  /** `loadFlowDefinition(flowPath)` — THROWS on a malformed flow, which the
   *  caller catches per flow so one bad file never sinks the mapping. Narrowed
   *  to the three fields read here; the host passes the real definition. */
  loadFlowDefinition(flowPath: string): { id: string; nodes: readonly { id: string; agent?: string }[] };
  /** `loadSessionKinds` — allowed to THROW; a misconfigured studio must fail
   *  loudly rather than degrade to a stale mirror. Narrowed to the four fields
   *  read here (`legacyRoutes[0]` is the per-kind href template). */
  loadSessionKinds(forgeRoot: string): readonly {
    id: string; agent: string; title: string; dir?: string; legacyRoutes: readonly string[];
  }[];
};

export function collectFlowNodeRows(deps: AgentHistoryDeps, forgeRoot: string, slug: string): AgentHistoryRow[] {
  const nodeId = deps.buildAgentSlugToNodeId(forgeRoot).get(slug);
  if (!nodeId) return [];
  const rows: AgentHistoryRow[] = [];
  // ADR-044 P1: cached per-manifest derivation — see packages/flows/run-list-cache.ts.
  for (const run of deps.cachedListRuns(forgeRoot, Date.now())) {
    const status = run.phases[nodeId];
    if (status === undefined) continue; // this run's flow never reached the node — no row, never fabricated
    rows.push({
      id: run.id,
      linkKind: 'flow-node',
      href: `/flows/${encodeURIComponent(run.flowId)}/run/${encodeURIComponent(run.id)}`,
      status,
      costUsd: run.phaseMeta[nodeId]?.costUsd ?? null,
      // R6-06 ROUND 8/9: the client's `AgentFlowNodeRunEntry` derives its own
      // when/what/narrative from the FULL run + which node — the same `run`
      // GET /api/runs already ships verbatim (D2 reuse), never a second,
      // independently-trimmed copy.
      run,
      nodeId,
    });
  }
  return rows;
}

/**
 * Path 2 — standalone-dispatch rows. D5: `logsRoot` is enumerated via
 * `readdirSync`; the caller-supplied `slug` is a FILTER applied to each
 * ENUMERATED entry's own on-disk content, never joined into a path. Identity
 * is exact-match on the run's own events (`standaloneRunMatchesSlug`, D4) —
 * a directory whose name merely starts with a similar-looking prefix is
 * never enough on its own (the alias trap).
 *
 * R6-06 round 6: the actual READ of each enumerated entry's `events.jsonl`
 * goes through `parseGuardedEventsJsonl` — `entry` is an untrusted NAME read
 * off disk (`readdirSync`'s result, not chosen by this function), and a
 * symlinked entry dir / symlinked `events.jsonl` / hardlinked `events.jsonl`
 * were all previously followed by a plain `statSync`+`existsSync`+
 * `readFileSync` chain with zero identity or nlink check. The guard's
 * "absent" collapse also subsumes the old explicit `isDirectory()` check —
 * a non-directory `entry` simply has no valid `events.jsonl` path beneath
 * it, so the guarded parse returns `null` for it exactly as it does for "no
 * events yet", with no separate check needed.
 */
export function collectStandaloneRows(deps: AgentHistoryDeps, logsRoot: string, slug: string): AgentHistoryRow[] {
  let entries: string[];
  try {
    entries = existsSync(logsRoot) ? readdirSync(logsRoot) : [];
  } catch {
    entries = [];
  }
  const rows: AgentHistoryRow[] = [];
  for (const entry of entries) {
    if (!entry.startsWith(STANDALONE_RUN_DIR_PREFIX)) continue;
    const parsed = deps.parseGuardedEventsJsonl(logsRoot, entry); // `entry` came from readdir, never from `slug`
    // No events at all (or a poisoned/rejected entry — indistinguishable by
    // design) -> nothing to prove identity against; honestly unattributable
    // to any slug, so it produces no row (never a guess, never a leak).
    if (parsed === null || !standaloneRunMatchesSlug(parsed, slug)) continue;
    // W8-A2 (ON-7 defect 4) — routed through the SAME staleness seam
    // `deriveStandaloneRunState` uses, so a zombie run shows 'stalled' here
    // too, not just on its own detail route.
    const derived = withStandaloneLiveness(deps, logsRoot, entry, deriveStandaloneStateFromEvents(parsed));
    // R6-06 ROUND 9 MEASUREMENT: `when` is this run's own FIRST event's
    // `started_at` — the same `parsed` array already in hand, no second
    // read. `what` is honestly absent server-side (run-agent.ts's own
    // events carry only the agent's own identity, never a project/task
    // description — a measured NEGATIVE RESULT, not a design choice), so
    // the agent's own slug is the smallest non-fabricated string available.
    const firstStartedAt = parsed[0]?.['started_at'];
    rows.push({
      id: entry,
      linkKind: 'standalone',
      href: `/agents/${encodeURIComponent(slug)}/run/${encodeURIComponent(entry)}`,
      status: derived.state,
      costUsd: derived.costUsd,
      when: typeof firstStartedAt === 'string' ? firstStartedAt : '',
      what: slug,
    });
  }
  return rows;
}

/**
 * W7-B5 (agents-03 / agents-04 / agents-39) — ONE row of the aggregate
 * `GET /api/agents/runs/recent` route. Two shapes:
 *   - `linkKind: 'flow'` — one row per FLOW RUN, carrying the RUN-level
 *     status/cost (never one node's slice attributed to the whole run — the
 *     exact defect the pre-B5 client-side merge shipped) plus `agents`, the
 *     slugs of every agent whose node this run actually reached.
 *   - `linkKind: 'standalone'` — one row per standalone dispatch, its OWN
 *     state/cost, attributed to its own slug (exact-match identity off the
 *     run's own events — D4, never a runId-prefix guess).
 * Sessions are deliberately NOT joined here: they have their own pillar
 * (`/sessions`) and their own per-agent history rows; "recent agent runs"
 * is the flow + standalone execution record.
 */
export type RecentAgentRunRow = {
  id: string;
  when: string;
  what: string;
  agents: string[];
  status: string;
  costUsd: number | null;
  href: string;
  linkKind: 'flow' | 'standalone';
  errorText?: string;
};

/** Default + hard cap for `GET /api/agents/runs/recent?limit=` — named, not
 *  scattered literals. */
export const RECENT_AGENT_RUNS_DEFAULT_LIMIT = 20;
export const RECENT_AGENT_RUNS_MAX_LIMIT = 100;

/** The slug a standalone run's own events attribute it to (D4's exact-match
 *  identity: `metadata.agent_slug` or top-level `skill` — first event that
 *  carries either wins). `null` = honestly unattributable (no row). */
function standaloneRunSlug(events: readonly Record<string, unknown>[]): string | null {
  for (const e of events) {
    const metadata = e['metadata'] as Record<string, unknown> | undefined;
    if (typeof metadata?.['agent_slug'] === 'string') return metadata['agent_slug'] as string;
    if (typeof e['skill'] === 'string' && (e['skill'] as string).length > 0) return e['skill'] as string;
  }
  return null;
}

/**
 * node id → agent slug, PER FLOW (review round 1). The first draft inverted
 * the GLOBAL `buildAgentSlugToNodeId` map, which is flat across every flow —
 * so two flows sharing a node id (`review`, `dev`, `demo`: entirely ordinary
 * once an operator authors a flow) collapsed onto ONE arbitrary agent, and
 * runs of the second flow were labelled with the first flow's agent. That is
 * precisely the wrong-agent attribution this route exists to fix; the OOTB
 * four just happen not to collide today, so it would have stayed silent
 * until a user authored a flow. Node ids are only unique WITHIN a flow, so
 * the map has to be keyed that way too.
 */
function buildFlowNodeToSlug(deps: AgentHistoryDeps, forgeRoot: string): Map<string, Map<string, string>> {
  const byFlow = new Map<string, Map<string, string>>();
  try {
    const flowsDir = join(resolve(forgeRoot), 'studio', 'flows');
    if (!existsSync(flowsDir)) return byFlow;
    for (const entry of readdirSync(flowsDir).sort()) {
      const flowPath = join(flowsDir, entry, 'flow.yaml');
      if (!existsSync(flowPath)) continue;
      let flow;
      try {
        flow = deps.loadFlowDefinition(flowPath);
      } catch {
        continue; // one malformed flow must never sink the whole mapping
      }
      const nodes = new Map<string, string>();
      for (const node of flow.nodes) {
        if (!node.agent) continue; // gate-only nodes have no agent
        if (!nodes.has(node.id)) nodes.set(node.id, node.agent);
      }
      byFlow.set(flow.id, nodes);
    }
  } catch {
    // Registry unavailable — an empty map means rows carry no `agents`
    // attribution, which is honest; it never fabricates one.
  }
  return byFlow;
}

export function collectRecentAgentRuns(
  deps: AgentHistoryDeps,
  forgeRoot: string,
  logsRoot: string,
  limit: number,
  kind: 'flow' | 'standalone' | 'all' = 'all',
): RecentAgentRunRow[] {
  // Flow runs — run-level facts, plus which agents participated, resolved
  // through the run's OWN flow (node ids are unique per flow, not globally).
  const flowNodeToSlug = buildFlowNodeToSlug(deps, forgeRoot);
  const rows: RecentAgentRunRow[] = [];
  // Review round 1: dedupe by `id`. `HistoryLedger` keys each rendered row on
  // `row.id` (`key={row.id}`) — an implicit contract every consumer of that
  // shared component must uphold, and the reason the client-side join this
  // route replaced documented its own dedupe as "REQUIRED, not cosmetic".
  // Two manifests resolving to the SAME cycle id (a threaded architect →
  // develop hand-off, a requeued initiative whose manifest exists in two
  // queue states) otherwise emit two rows with identical ids: a duplicate
  // React key and a double-listed run. First-seen wins — `cachedListRuns` is
  // already ordered, so that is the newer/canonical one.
  const seenIds = new Set<string>();
  for (const run of kind === 'standalone' ? [] : deps.cachedListRuns(forgeRoot, Date.now())) {
    if (seenIds.has(run.id)) continue;
    seenIds.add(run.id);
    const nodeToSlug = flowNodeToSlug.get(run.flowId);
    const agents = nodeToSlug === undefined ? [] : [...new Set(
      Object.keys(run.phases)
        .map((nodeId) => nodeToSlug.get(nodeId))
        .filter((slug): slug is string => slug !== undefined),
    )];
    rows.push({
      id: run.id,
      when: run.startedAt ?? '',
      what: run.initiative ?? '',
      agents,
      status: run.status,
      costUsd: run.costUsd ?? null,
      href: `/flows/${encodeURIComponent(run.flowId)}/run/${encodeURIComponent(run.id)}`,
      linkKind: 'flow',
    });
  }
  // Standalone dispatches — same guarded enumeration discipline as
  // collectStandaloneRows (entry names come from readdir, never a caller).
  let entries: string[];
  try {
    entries = existsSync(logsRoot) ? readdirSync(logsRoot) : [];
  } catch {
    entries = [];
  }
  for (const entry of kind === 'flow' ? [] : entries) {
    if (!entry.startsWith(STANDALONE_RUN_DIR_PREFIX)) continue;
    if (seenIds.has(entry)) continue; // same row-id contract as the flow half
    const parsed = deps.parseGuardedEventsJsonl(logsRoot, entry);
    if (parsed === null) continue;
    const slug = standaloneRunSlug(parsed);
    if (slug === null) continue; // unattributable — never a fabricated row
    // W8-A2 (ON-7 defect 4) — same staleness seam as collectStandaloneRows.
    const derived = withStandaloneLiveness(deps, logsRoot, entry, deriveStandaloneStateFromEvents(parsed));
    const firstStartedAt = parsed[0]?.['started_at'];
    seenIds.add(entry);
    rows.push({
      id: entry,
      when: typeof firstStartedAt === 'string' ? firstStartedAt : '',
      what: slug,
      agents: [slug],
      status: derived.state,
      costUsd: derived.costUsd,
      href: `/agents/${encodeURIComponent(slug)}/run/${encodeURIComponent(entry)}`,
      linkKind: 'standalone',
      ...(derived.errorText !== undefined ? { errorText: derived.errorText } : {}),
    });
  }
  // Newest first; rows with no usable `when` sort last (mirrors the client
  // ledger's own rule). Bounded.
  rows.sort((a, b) => {
    const aMs = a.when ? Date.parse(a.when) : NaN;
    const bMs = b.when ? Date.parse(b.when) : NaN;
    const aOk = Number.isFinite(aMs);
    const bOk = Number.isFinite(bMs);
    if (!aOk && !bOk) return 0;
    if (!aOk) return 1;
    if (!bOk) return -1;
    return bMs - aMs;
  });
  return rows.slice(0, Math.max(0, limit));
}

/** Cost + `when` facts read from a session's OWN log dir
 *  (`_logs/_<kind>-<sessionId>/events.jsonl`) — ONE guarded parse serving
 *  BOTH facts (replaces the former cost-only `readSessionCostUsd`, R6-06
 *  ROUND 9: `when` needs the exact same array, so a second guarded read for
 *  it would be a redundant re-parse of the same file, not a second
 *  independent cost summation — the "read never re-summed" rule is about
 *  `costUsd` specifically, unaffected here since the summation itself is
 *  unchanged). `costUsd` mirrors `readArchitectSessionStats`
 *  (orchestrator/architect-runner.ts)'s summing algorithm exactly,
 *  generalised over `kind` rather than hardcoded to `_architect-`; `null`
 *  when the log dir is absent (no cost has ever been recorded for this
 *  session — honest-absent, never a fabricated `0`). `when` is the FIRST
 *  event's own `started_at` (R6-06 ROUND 9 measurement) — `''` (the same
 *  honest-absent sentinel `flow-ledger.ts`'s own `run.startedAt ?? ''`
 *  convention uses, D7) when no event carries one. `_${kind}-${sessionId}`
 *  is ONE literal directory-entry name (a hyphen join, not a path
 *  separator), so it passes through the SAME guarded choke point as every
 *  other standalone-shaped log dir (R6-06 round 6) — `kind` comes from the
 *  live session-kind registry and `sessionId` from `readdirSync` in
 *  `collectSessionRows`, neither trusted enough to read through unguarded. */
function readSessionLogFacts(deps: AgentHistoryDeps, logsRoot: string, kind: string, sessionId: string): { costUsd: number | null; when: string } {
  const parsed = deps.parseGuardedEventsJsonl(logsRoot, `_${kind}-${sessionId}`);
  if (parsed === null || parsed.length === 0) return { costUsd: null, when: '' };
  let total = 0;
  let any = false;
  for (const e of parsed) {
    const cost = e['cost_usd'];
    if (typeof cost === 'number') { total += cost; any = true; }
  }
  const firstStartedAt = parsed[0]['started_at'];
  return { costUsd: any ? total : null, when: typeof firstStartedAt === 'string' ? firstStartedAt : '' };
}

/**
 * Guarded read of `<projectsRoot>/<project>/<kindDirName>/<sessionId>/status.json`
 * (R6-06 round 6 — replaces the former direct `readSessionStatus(join(kindDir,
 * sessionId))` call, a plain `existsSync`/`readFileSync` with zero identity
 * or nlink check).
 *
 * `project`, `kindDirName`, `sessionId` each arrive as their OWN element of
 * `resolveGuardedPath`'s `segments[]` — never folded into `root` — so the
 * per-segment IDENTITY walk catches a symlinked `_<kind>` dir (the P0: a
 * malicious project's `_<kind>` pointing at a victim project's) at the
 * segment it actually lives at, regardless of which `sessionId` is being
 * tried; a symlinked `status.json` leaf fails the same walk one segment
 * later; a hardlinked `status.json` leaf is caught by the guard's
 * `nlink===1` check once the whole chain otherwise resolves. This is the
 * SAME shared `resolveGuardedPath` this file's task brief names as the
 * repo's intended guard for this shape — attacked directly (root-folding,
 * intermediate-segment symlink, hardlinked leaf, legitimate near-miss
 * names) before being wired in here; see the task report for the executed
 * results.
 *
 * `root` (`projectsRoot`) is a fixed, config-derived constant
 * (`resolveProjectsDir`), never request-derived — satisfying
 * `resolveGuardedPath`'s own root-trust contract. A rejected guard, an
 * absent leaf, and a malformed/non-object JSON body all collapse into the
 * SAME `null` — indistinguishable outcomes, per the no-oracle rule this
 * route's other two collectors already follow. */
function readGuardedSessionStatus(projectsRoot: string, project: string, kindDirName: string, sessionId: string): { phase?: unknown } | null {
  const guarded = resolveGuardedPath(projectsRoot, [project, kindDirName, sessionId, 'status.json']);
  if (!guarded.ok || !guarded.exists) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(guarded.realPath, 'utf8'));
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as { phase?: unknown };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Path 3 — session rows. `slug` is matched against each session-kind
 * descriptor's OWN `agent` field (never joined into a path) to find which
 * kind(s) this agent drives; every project's `<project>/_<kind>/<sessionId>`
 * dir is then enumerated (mirrors `listInstructionsSessions`'s existing
 * cross-project enumeration pattern). Status is the session's OWN
 * `status.json.phase` string, verbatim (D12 — never coerced into a
 * RunStatus/RunPhaseStatus literal). Cost is read from the session's
 * SEPARATE log dir, never the state dir.
 */
export function collectSessionRows(deps: AgentHistoryDeps, ctx: { forgeRoot: string; projectsRoot: string; logsRoot: string }, slug: string): AgentHistoryRow[] {
  // `loadSessionKinds` throws on a missing/unreadable `studio/session-kinds.yaml`
  // — that is a misconfigured studio and must fail loudly (no fallback table:
  // CLAUDE.md "Never do"), so the error is left to propagate to this route's
  // existing 500 handler below rather than degrading to a stale mirror.
  const matching = deps.loadSessionKinds(ctx.forgeRoot).filter((d) => d.agent === slug);
  if (matching.length === 0) return [];

  let projects: string[];
  try {
    projects = existsSync(ctx.projectsRoot) ? readdirSync(ctx.projectsRoot) : [];
  } catch {
    projects = [];
  }

  const rows: AgentHistoryRow[] = [];
  for (const descriptor of matching) {
    const kindDirName = `_${descriptor.id}`;
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
        if (sessionId.startsWith('_')) continue; // skip _archived/, mirrors listInstructionsSessions
        const status = readGuardedSessionStatus(ctx.projectsRoot, project, kindDirName, sessionId);
        if (!status || typeof status.phase !== 'string') continue; // unreadable/missing/escaping/hardlinked phase -> not a real session row
        const template = descriptor.legacyRoutes[0];
        const href = template
          ? template.replace('[sessionId]', sessionId)
          : `/sessions/${encodeURIComponent(descriptor.id)}/${encodeURIComponent(sessionId)}?project=${encodeURIComponent(project)}`;
        // R6-06 ROUND 9 MEASUREMENT: `what` is the session-kind descriptor's
        // OWN `title` (e.g. 'Planning session') — a per-KIND, not per-
        // instance, label; `readGuardedSessionStatus`'s narrowed return type
        // doesn't expose the per-instance `project` field today, so a richer
        // "title · project" combination is a genuine (out-of-scope) future
        // change, not something already flowing (see the task report).
        const logFacts = readSessionLogFacts(deps, ctx.logsRoot, descriptor.id, sessionId);
        rows.push({
          id: sessionId,
          linkKind: 'session',
          href,
          status: status.phase,
          costUsd: logFacts.costUsd,
          when: logFacts.when,
          what: descriptor.title,
        });
      }
    }
  }
  return rows;
}
