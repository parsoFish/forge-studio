/**
 * Home dashboard — PURE derivation module (R6-07).
 *
 * THE DEFECT CLASS THIS MODULE KILLS: declared-data-fails-open. The mockup
 * (recorded in docs/reference/studio-copy.md) invented
 * `flow.status` / `agent.status` / `kb.status` fields that do not exist on
 * the real wire types (`Flow`, `Agent`, `Project`, `Kb` in ./studio-client —
 * none carry a `status` field). Live status on Home is DERIVED from the
 * run-model (`Run[]` from fetchRuns()) and the attention aggregate
 * (`ProjectAttentionItem[]` from fetchProjectAttention()), never read off a
 * fabricated field.
 *
 * PURITY CONTRACT (scripts/home-no-new-polling.test.ts enforces this at the
 * source level): no fetch, no API-path string, no async/promise-waiting
 * keyword, no subscribe. Every function here takes already-fetched data as
 * input and returns a value — all I/O and live-refresh wiring belongs to
 * the page (app/page.tsx).
 */

import type { Run, Flow, Agent, Project, Kb, KbLintSummary, SessionIndexRow } from './studio-client';
import type { ProjectAttentionItem } from './bridge-client';
import { type LedgerRow, sessionTerminalOutcome } from './history-ledger';
import { mergeRecentAgentRuns } from './agents-index';
import { sessionKindAgent } from './session-kind-meta';
import { KB_SEEDING_ANCHOR_PREFIX } from './session-shell-view';

/**
 * WI-1b (ON-7): declared as a closed const ARRAY (not a bare union) —
 * mirrors `session-lifecycle-client.ts`'s `SESSION_LIFECYCLE_STATES`
 * precedent — so a consumer's own exhaustiveness (e.g. `app/page.tsx`'s
 * `HOME_STATUS_FRAME: Record<HomeStatus, string>`) can be asserted against
 * THIS array at test time, not a hand-copied literal list that silently
 * drifts when a member is added.
 *
 * Order is the precedence `strongerStatus` (below) ranks by, DECREASING:
 * `active` beats everything (an actively-executing thing is the single most
 * CURRENT fact about an object — the pre-existing active-beats-gated rule,
 * now extended: it beats a failure too, since something is happening right
 * now, possibly already recovering from that very failure). `failed` beats
 * `gated`: `gated` means "the operator is asked to make a routine call",
 * nothing is broken; `failed` means something genuinely IS broken and is a
 * stronger claim on operator attention than a routine wait. `idle` is the
 * fail-closed floor — never a fabricated default. Pinned in
 * home-view.test.ts (WI-1b precedence tests).
 */
export const HOME_STATUSES = ['active', 'failed', 'gated', 'idle'] as const;
export type HomeStatus = (typeof HOME_STATUSES)[number];
export type HomeHexKind = 'flow' | 'agent' | 'project' | 'kb';

export type HomeHex = {
  id: string;
  kind: HomeHexKind;
  glyph: string;
  label: string;
  status: HomeStatus;
  href: string;
};

/**
 * forge-2am: widened to a discriminated union so the attention strip can
 * carry KB-lint rows alongside the pre-existing project-gate rows without
 * either kind borrowing fields it doesn't have (a 'kb' row has no
 * `projectId`; a 'gate' row has no `kbId`/`lint`). `id`/`text`/`sub`/`href`/
 * `status` stay common to both so the page can render most of the row
 * uniformly, branching only on `kind` for the kind-specific `data-*`
 * attributes and fields.
 */
export type HomeAttentionItem =
  | {
      id: string;
      kind: 'gate';
      text: string;
      sub: string;
      status: string;
      href: string;
      projectId: string;
    }
  | {
      id: string;
      kind: 'kb';
      text: string;
      sub: string;
      status: 'fail' | 'warn' | 'unknown';
      href: string;
      kbId: string;
      lint: KbLintSummary;
    }
  | {
      id: string;
      kind: 'kb-draft';
      text: string;
      sub: string;
      status: 'gated';
      href: string;
      sessionId: string;
      project: string;
    };

/**
 * forge-n5r: the ONE flow<->run matcher. A run "belongs" to a flow either
 * directly (`run.flowId`) or by having traversed it as part of a threaded
 * spine (`run.flowLineage`, e.g. architect -> develop -> reflect) —
 * ignoring lineage would leave a spine run's traversed flows permanently
 * 'idle'/quiet. Every consumer that needs "the runs for this flow"
 * (`deriveFlowStatus` below, `FlowCard` in `components/studio/LibraryCard.tsx`,
 * the flow monitor in `app/flows/[id]/page.tsx`) calls THIS function rather
 * than re-writing the predicate inline — two independently-written copies is
 * exactly how `FlowCard`'s `runs.filter(r => r.flowId === flow.id)` drifted
 * from the correct behaviour in the first place.
 */
export function runsForFlow(flowId: string, runs: Run[]): Run[] {
  return runs.filter((r) => r.flowId === flowId || r.flowLineage.includes(flowId));
}

/**
 * W7-C1 (flows-21): the flow monitor's own-vs-lineage split, BUILT ON the
 * same two facts `runsForFlow` matches (never a third predicate): `own` =
 * runs whose manifest flowId IS this flow; `lineage` = runs that merely
 * traversed this flow as part of another flow (their ledger rows link to
 * the run under its own flow). own ∪ lineage = runsForFlow, disjoint by
 * construction — so the monitor can render the second group under an
 * explanatory label instead of one undifferentiated 60-row ledger on every
 * monitor.
 */
export function splitRunsForFlow(flowId: string, runs: Run[]): { own: Run[]; lineage: Run[] } {
  const own: Run[] = [];
  const lineage: Run[] = [];
  for (const r of runs) {
    if (r.flowId === flowId) own.push(r);
    else if (r.flowLineage.includes(flowId)) lineage.push(r);
  }
  return { own, lineage };
}

/**
 * A flow's live status, built ON `runsForFlow` (never a second, independent
 * predicate). 'active' beats 'gated' when both are present (an active run
 * elsewhere on the flow is the more urgent fact); no matching run at all is
 * 'idle' — never a fabricated default.
 */
export function deriveFlowStatus(flowId: string, runs: Run[]): HomeStatus {
  const matching = runsForFlow(flowId, runs);
  if (matching.some((r) => r.status === 'active')) return 'active';
  if (matching.some((r) => r.status === 'gated')) return 'gated';
  return 'idle';
}

/**
 * WI-1b (ON-7) — Home's OWN flow-hex status. NOT `deriveFlowStatus` above:
 * a prior review round locked THAT function to 3 states (active|gated|idle)
 * on purpose — `FlowCard` (`components/studio/LibraryCard.tsx`) renders its
 * return value verbatim as the `data-flow-status` DOM contract, and
 * `lib/library-card-render.test.ts`'s "review round GAP 3" tests pin
 * `data-flow-status="idle"` even for a flow whose only matching run failed
 * (the real signal lives there on a SEPARATE `data-flow-failed-count`
 * attribute instead — see that file's own header). Widening
 * `deriveFlowStatus` in place would silently flip that pinned contract.
 *
 * Home's hex constellation carries no such lock and IS the actual ON-7 gap
 * this closes (a fully-failed flow read identically to a never-run one) —
 * so this is a second, thin derivation built on the SAME `runsForFlow`
 * matcher `deriveFlowStatus` itself is built on, adding exactly the one
 * precedence rung (`strongerStatus`'s active > failed > gated > idle) that
 * `deriveFlowStatus` deliberately omits for its own DOM contract.
 */
export function deriveFlowHomeStatus(flowId: string, runs: Run[]): HomeStatus {
  const matching = runsForFlow(flowId, runs);
  if (matching.some((r) => r.status === 'active')) return 'active';
  if (matching.some((r) => r.status === 'failed')) return 'failed';
  if (matching.some((r) => r.status === 'gated')) return 'gated';
  return 'idle';
}

// ---------------------------------------------------------------------------
// W7-B1 (home-sessions-14) — interactive sessions are a live-status source.
//
// Post-wave-6, sessions are the NORMAL way work happens, yet the
// constellation was wired exclusively to the flow-run model: 13 in-flight
// sessions with agents actively running read "0 live / all idle". These
// helpers fold the already-fetched sessions index (the SAME
// `fetchStudioSessions()` read Home already makes) into hex derivation —
// through the session's own bridge-derived `state`/`needsYou`
// (packages/sessions/bridge-studio-lifecycle.ts, never re-derived here) and the
// yaml-parity-pinned kind→agent mapping (`session-kind-meta.ts`).
// ---------------------------------------------------------------------------

/** What one session contributes to a hex it anchors on: a `working` runner
 *  is live activity ('active'); a session waiting on the OPERATOR —
 *  awaiting-operator, crashed, stalled (`needsYou`, the bridge's truthful
 *  verdict) — is attention ('gated'); WI-1b (ON-7): a TERMINAL session whose
 *  own phase genuinely failed (`sessionTerminalOutcome`, the SAME
 *  classification `session-lifecycle-client.ts`'s
 *  `data-lifecycle-terminal-outcome` DOM attribute uses — one source, never
 *  a second copy that could disagree) is 'failed'. A terminal session that
 *  merely succeeded or was cancelled by the operator contributes NOTHING —
 *  fail closed, never a fabricated light (a clean finish or a deliberate
 *  stop is not an alarm). */
function sessionContribution(s: SessionIndexRow): HomeStatus | null {
  if (s.terminal || s.state === 'terminal') {
    return sessionTerminalOutcome(s.phase) === 'failed' ? 'failed' : null;
  }
  if (s.state === 'working') return 'active';
  if (s.needsYou) return 'gated';
  return null;
}

/** Precedence rank for `HomeStatus` — see `HOME_STATUSES`'s own doc comment
 *  for the active > failed > gated > idle reasoning. A `Record` keyed on
 *  the FULL union, so a future 5th member fails to COMPILE here until it is
 *  ranked, rather than silently sorting last (or first). */
const HOME_STATUS_RANK: Record<HomeStatus, number> = {
  idle: 0,
  gated: 1,
  failed: 2,
  active: 3,
};

/** The stronger of two statuses, by `HOME_STATUS_RANK`. */
function strongerStatus(a: HomeStatus, b: HomeStatus): HomeStatus {
  return HOME_STATUS_RANK[a] >= HOME_STATUS_RANK[b] ? a : b;
}

/** Fold every matching session's contribution into one status. */
function sessionsStatus(sessions: readonly SessionIndexRow[], matches: (s: SessionIndexRow) => boolean): HomeStatus {
  let status: HomeStatus = 'idle';
  for (const s of sessions) {
    if (!matches(s)) continue;
    const contribution = sessionContribution(s);
    if (contribution !== null) status = strongerStatus(status, contribution);
    if (status === 'active') break; // nothing can beat it
  }
  return status;
}

/**
 * An agent's live status: 'active' iff some `active` run has an `active`
 * phase on a flow node this agent owns (matched by `node.agent === agent.id`,
 * keyed by that node's own `id` against `run.phases`) — OR (W7-B1,
 * home-sessions-14) an in-flight session whose kind this agent drives
 * (`sessionKindAgent`, the yaml-parity-pinned mapping) is `working`;
 * a needs-you session marks it 'gated'. WI-1b (ON-7): 'failed' iff an owned
 * node's own phase reads 'failed' on ANY run (a per-node fact, independent
 * of that run's overall `status` — a node can fail while the run as a whole
 * is still finishing up elsewhere) — OR a terminal session driven by this
 * agent's kind genuinely failed (folded in via `sessionsStatus`, same as
 * every other contribution). An agent that maps to no flow node AND no
 * session kind fails CLOSED to 'idle' — it must never default to 'active'
 * (or 'failed') just because it exists.
 */
export function deriveAgentStatus(agent: Agent, flows: Flow[], runs: Run[], sessions: SessionIndexRow[] = []): HomeStatus {
  const fromSessions = sessionsStatus(sessions, (s) => sessionKindAgent(s.kind) === agent.id);
  if (fromSessions === 'active') return 'active';

  const ownedNodeIds = new Set<string>();
  for (const flow of flows) {
    for (const node of flow.nodes) {
      if (node.agent === agent.id) ownedNodeIds.add(node.id);
    }
  }

  let fromNodes: HomeStatus = 'idle';
  for (const run of runs) {
    for (const nodeId of ownedNodeIds) {
      const phase = run.phases[nodeId];
      if (run.status === 'active' && phase === 'active') return 'active';
      if (phase === 'failed') fromNodes = strongerStatus(fromNodes, 'failed');
    }
  }

  return strongerStatus(fromNodes, fromSessions);
}

/**
 * A project's live status, read from its row in the attention aggregate
 * (never a fabricated `project.status` — `Project` carries none) — merged
 * (W7-B1, home-sessions-14) with the in-flight sessions anchored on this
 * project: a `working` session is 'active', a needs-you one 'gated'. WI-1b
 * (ON-7): a TERMINAL session whose own phase genuinely failed contributes
 * 'failed' (`sessionContribution`). All folded through `strongerStatus`'s
 * active > failed > gated > idle precedence. A project absent from the
 * attention list with no sessions fails closed to 'idle', not to a guessed
 * state.
 */
export function deriveProjectStatus(projectId: string, attention: ProjectAttentionItem[], sessions: SessionIndexRow[] = []): HomeStatus {
  const row = attention.find((a) => a.projectId === projectId);
  const fromAttention: HomeStatus = !row ? 'idle' : row.gated > 0 ? 'gated' : row.inFlight > 0 ? 'active' : 'idle';
  const fromSessions = sessionsStatus(sessions, (s) => s.project === projectId);
  return strongerStatus(fromAttention, fromSessions);
}

/**
 * W7-B1 (home-sessions-14): a KB's live status — the kb-cleanup/seeding
 * sessions anchored under its own `.kb-<id>` pseudo-project
 * (KB_SEEDING_ANCHOR_PREFIX, the bridge's own anchor rule) are a REAL
 * live-status source for the KB hex. A project-BOUND KB's sessions anchor
 * under the real project instead and light that project's hex — attributing
 * them to the KB too would need the binding join; fail closed rather than
 * guess. WI-1b (ON-7): a terminal seeding session that genuinely failed
 * contributes 'failed' (`sessionContribution`), never lumped in with a
 * clean finish. No matching session = 'idle', never fabricated.
 */
export function deriveKbStatus(kbId: string, sessions: SessionIndexRow[] = []): HomeStatus {
  return sessionsStatus(sessions, (s) => s.project === `${KB_SEEDING_ANCHOR_PREFIX}${kbId}`);
}

/**
 * Assemble the full hex-constellation: one hex per flow, agent, project, and
 * KB, in that order. Status is ALWAYS derived (never read off a `.status`
 * field the real types don't carry). W7-B1 (home-sessions-14): the
 * already-fetched in-flight `sessions` index feeds agent/project/KB hexes
 * alongside the flow-run model — a working session lights its agent, its
 * anchor project, or (via the `.kb-<id>` anchor) its KB; a needs-you
 * session marks them 'gated'. Omitted/empty `sessions` keeps the pre-W7
 * derivation byte-identical — absence of data never fabricates a light.
 */
export function buildConstellation(input: {
  flows: Flow[];
  agents: Agent[];
  projects: Project[];
  kbs: Kb[];
  runs: Run[];
  attention: ProjectAttentionItem[];
  sessions?: SessionIndexRow[];
}): HomeHex[] {
  const { flows, agents, projects, kbs, runs, attention, sessions = [] } = input;
  const hexes: HomeHex[] = [];

  for (const flow of flows) {
    hexes.push({
      id: flow.id,
      kind: 'flow',
      glyph: '⬡',
      label: flow.name,
      // WI-1b (ON-7): deriveFlowHomeStatus, NOT deriveFlowStatus — see that
      // function's own doc comment for why the two must stay separate.
      status: deriveFlowHomeStatus(flow.id, runs),
      href: `/flows/${flow.id}`,
    });
  }

  for (const agent of agents) {
    hexes.push({
      id: agent.id,
      kind: 'agent',
      glyph: '⬢',
      label: agent.name,
      status: deriveAgentStatus(agent, flows, runs, sessions),
      href: `/agents/${agent.id}`,
    });
  }

  for (const project of projects) {
    hexes.push({
      id: project.id,
      kind: 'project',
      glyph: '◆',
      label: project.name,
      status: deriveProjectStatus(project.id, attention, sessions),
      href: `/projects/${project.id}`,
    });
  }

  for (const kb of kbs) {
    hexes.push({
      id: kb.id,
      kind: 'kb',
      glyph: '◈',
      // W7-B1: the `.kb-<id>`-anchored sessions ARE a live-status source
      // for a KB now (deriveKbStatus) — no matching session stays 'idle',
      // never fabricated.
      label: kb.name,
      status: deriveKbStatus(kb.id, sessions),
      href: `/knowledge?id=${kb.id}`,
    });
  }

  return hexes;
}

/**
 * Cross-project "what needs me" rows, mirroring the R4-11-F4 attention
 * strip's own real-condition rule: a row fires only when it has an actual
 * gated or flagged count, never on the mere existence of a project. Rows
 * with neither are omitted entirely — an empty result honestly means
 * nothing needs attention right now.
 */
export function buildHomeAttention(attention: ProjectAttentionItem[]): HomeAttentionItem[] {
  const items: HomeAttentionItem[] = [];

  for (const row of attention) {
    if (row.gated <= 0 && row.flagged <= 0) continue;

    const parts: string[] = [];
    if (row.gated > 0) parts.push(`${row.gated} awaiting review`);
    if (row.flagged > 0) parts.push(`${row.flagged} flagged`);

    items.push({
      id: `gate-${row.projectId}`,
      kind: 'gate',
      text: `${row.name} · ${parts.join(' · ')}`,
      sub: `${row.planned} planned · ${row.inFlight} in-flight · ${row.merged} merged`,
      status: row.gated > 0 ? 'gated' : 'flagged',
      href: row.link,
      projectId: row.projectId,
    });
  }

  return items;
}

/**
 * forge-2am: KB-lint rows for the attention strip, mirroring
 * `buildHomeAttention`'s own real-condition rule above — a row fires ONLY
 * on an honest signal from the KB's OWN `lint` summary, never from mere
 * existence, and `lint === null` (no data) is never folded into a
 * fabricated clean verdict. Precedence: `lint.error` (the lint run itself
 * threw) beats a real errors/flags count — an "unknown" verdict is more
 * honest than reporting stale/partial numbers next to a run that failed to
 * complete. Otherwise `errors > 0` -> 'fail' beats `flags > 0` -> 'warn'.
 * A KB with `checksRun < checksTotal` (not every check inspected this KB —
 * see `Kb.lint`'s header) still fires normally; the n/a-invariant is
 * surfaced on the row's `lint` object verbatim, not smoothed over.
 */
export function buildKbAttention(kbs: Kb[]): HomeAttentionItem[] {
  const items: HomeAttentionItem[] = [];

  for (const kb of kbs) {
    const lint = kb.lint;
    if (lint === null) continue;

    let status: 'fail' | 'warn' | 'unknown' | null = null;
    if (lint.error) status = 'unknown';
    else if (lint.errors > 0) status = 'fail';
    else if (lint.flags > 0) status = 'warn';
    if (status === null) continue; // an all-clean lint fires no row

    const parts: string[] = [];
    if (lint.error) {
      parts.push('lint run failed');
    } else {
      if (lint.errors > 0) parts.push(`${lint.errors} lint error${lint.errors === 1 ? '' : 's'}`);
      if (lint.flags > 0) parts.push(`${lint.flags} flagged`);
    }

    items.push({
      id: `kb-${kb.id}`,
      kind: 'kb',
      text: `${kb.name} · ${parts.join(' · ')}`,
      sub: `${lint.checksRun}/${lint.checksTotal} checks run`,
      status,
      // Deep-link straight into the Health tab — this row exists BECAUSE of
      // a lint finding, so the click should land where that finding lives,
      // not the default Explore tab the operator would then have to find
      // their own way out of.
      href: `/knowledge?id=${kb.id}&tab=health`,
      kbId: kb.id,
      lint,
    });
  }

  return items;
}

/**
 * W8-B2 (ON-4) — brain edits waiting on the operator.
 *
 * Operator note ON-4: "the review draft button for edits to the brains is so
 * unnoticeable it's insane." It was an 11px text link inside a round-grouped
 * finding row on the Health tab of one KB — and a pending drain draft appeared
 * in NO Home attention row at all, so a KB holding an unreviewed, unapplied
 * edit to a real brain theme looked identical on Home to one that had never
 * been drained.
 *
 * DERIVED, with nothing added to the wire. A drain-gated edit is parked as a
 * `kb-cleanup` session in `awaiting-approval`, and the bridge already computes
 * the truthful `needsYou` verdict for every session row
 * (`packages/sessions/bridge-studio-lifecycle.ts`). So the condition is exactly "a kb-cleanup
 * session that needs you" — read off the SAME already-fetched sessions array
 * Home's constellation and sessions strip use. No new fetch, no new poll, and
 * no `pendingDraft` boolean for some writer to forget to set.
 *
 * The row links to the SESSION, not to the KB: approving the draft is the
 * action, and the KB's Health tab cannot perform it.
 *
 * Deliberately narrow: `kb-cleanup` is the kind that carries an unapplied edit
 * to brain content. Widening this to every needs-you session would duplicate
 * the sessions strip directly below it.
 */
export function buildKbDraftAttention(sessions: readonly SessionIndexRow[]): HomeAttentionItem[] {
  const items: HomeAttentionItem[] = [];
  for (const s of sessions) {
    if (s.kind !== 'kb-cleanup') continue;
    if (!s.needsYou) continue; // fires on the bridge's real verdict, never on mere existence
    items.push({
      id: `kb-draft-${s.project}-${s.sessionId}`,
      kind: 'kb-draft',
      text: `${s.project} · a brain edit is waiting for your review`,
      sub: `kb-cleanup · ${s.phase}`,
      status: 'gated',
      href: s.href,
      sessionId: s.sessionId,
      project: s.project,
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// WI-1b (ON-7) — HOME_STATUS_FRAME
// ---------------------------------------------------------------------------

/**
 * Maps `HomeStatus` (this module's own 4-state vocab: active/failed/gated/
 * idle) onto the shared `.hex-frame`/`.status-dot` CSS's 5-state vocab
 * (pending/active/complete/retrying/failed, `lib/status-colors.ts`) for
 * STYLING ONLY — `app/page.tsx`'s `data-hex-status` DOM-contract attribute
 * always carries the real `HomeStatus` value untouched; this map is
 * consulted ONLY for the hex's visual `.hex-frame`/`.status-dot`
 * `data-status`. `failed` -> 'failed', the shared red terminal-failure
 * token — never an invented colour.
 *
 * Lives HERE, not in `app/page.tsx` (where it originally sat): a Next.js
 * App Router `page.tsx` may only export its own reserved fields (`default`,
 * `metadata`, `generateStaticParams`, ...) — an arbitrary named export like
 * a frame-map const fails `next build`'s page-export validation (found
 * running this lane's own build gate). Mirrors `GATE_ATTENTION_STATUS_
 * FRAME`'s own established "styling-only frame map lives in home-view.ts"
 * pattern below. `Record<HomeStatus, string>` means a future `HomeStatus`
 * member fails to COMPILE here until mapped — pinned exhaustively, over
 * `HOME_STATUSES` (not a hand-copied literal list), by
 * `lib/home-status-frame-render.test.ts`.
 */
export const HOME_STATUS_FRAME: Record<HomeStatus, string> = {
  active: 'active',
  failed: 'failed',
  gated: 'retrying',
  idle: 'pending',
};

// ---------------------------------------------------------------------------
// W6-IA-4 sweep finding C1#3 — GATE_ATTENTION_STATUS_FRAME
// ---------------------------------------------------------------------------

/**
 * forge-w6ia4: styling-only mapping for a 'gate' HomeAttentionItem's own
 * real status vocabulary ('gated' | 'flagged', built by buildHomeAttention
 * above) onto the shared 5-state status-dot CSS vocabulary
 * (pending/active/complete/retrying/failed) — mirrors KB_ATTENTION_STATUS_
 * FRAME's own established pattern (app/page.tsx) exactly, for the SAME
 * reason: `data-attention-status` must always carry the real
 * HomeAttentionItem value untouched (never this frame's output), so this
 * map is consulted ONLY for the visual `.status-dot`'s `data-status`.
 * 'gated' -> 'retrying' (awaiting review is the normal, recoverable-in-
 * progress case — the same mapping the page previously hardcoded for every
 * gate row); 'flagged' -> 'failed' (a review actually flagged something —
 * a real defect, not a routine wait), matching KB_ATTENTION_STATUS_FRAME's
 * own errors->failed / warn->retrying precedent. An unrecognised status
 * (the type is deliberately open-ended, `string`, on the 'gate' variant)
 * fails closed to 'pending' rather than guessing.
 */
export const GATE_ATTENTION_STATUS_FRAME: Record<string, string> = {
  gated: 'retrying',
  flagged: 'failed',
};

/** Never a fabricated guess for an attention status this frame doesn't
 *  recognise — 'pending' is the honest "no stronger visual claim" default,
 *  the same fail-closed shape `deriveProjectStatus`/`deriveAgentStatus`
 *  above already establish for their own absent-data cases. */
export function gateAttentionStatusDot(status: string): string {
  return GATE_ATTENTION_STATUS_FRAME[status] ?? 'pending';
}

// ---------------------------------------------------------------------------
// W6-IA-4 sweep finding C1#2 — deriveWatchLiveRunHref
// ---------------------------------------------------------------------------

/**
 * The Home header's "Watch live run" CTA used to hardcode `/flows/forge-
 * develop`, rendered unconditionally regardless of whether anything was
 * actually running there. This derives the REAL target: the flow behind an
 * ACTUAL live run, never a fabricated default. 'active' beats 'gated' (an
 * actively-executing run is a more useful "live" destination than one
 * merely parked on a gate); ties within a status keep `runs`' own order
 * (the caller's already-sorted/fetched order, never re-sorted here). No
 * active/gated run at all falls back to the flows index — never a
 * specific-but-fabricated flow id.
 */
export function deriveWatchLiveRunHref(runs: Run[]): string {
  const active = runs.find((r) => r.status === 'active');
  if (active) return `/flows/${encodeURIComponent(active.flowId)}`;
  const gated = runs.find((r) => r.status === 'gated');
  if (gated) return `/flows/${encodeURIComponent(gated.flowId)}`;
  return '/flows';
}

/**
 * W7-B1 (home-sessions-15): the CTA's caller must KNOW whether the derived
 * href points at something actually live — the old string-only shape let
 * the fallback `/flows` render under a primary "Watch live run" label, a
 * promise the click could not keep. `live: true` iff a real active/gated
 * run exists (the same two states `deriveWatchLiveRunHref` already treats
 * as watchable); the page demotes the button to a plain "Browse flows"
 * otherwise. Built ON `deriveWatchLiveRunHref` — one derivation, one flag,
 * never a second predicate that could drift.
 */
export function deriveWatchLiveRun(runs: Run[]): { href: string; live: boolean } {
  const href = deriveWatchLiveRunHref(runs);
  return { href, live: href !== '/flows' };
}

// ---------------------------------------------------------------------------
// W6-IA-4 — the Home merged everything-ledger (flow runs + agent runs)
// ---------------------------------------------------------------------------

/** A single named constant (never a literal repeated at call sites) bounding
 *  Home's merged ledger — mirrors `agents-index.ts`'s own
 *  `RECENT_AGENT_RUNS_LIMIT` convention. */
export const HOME_LEDGER_LIMIT = 30;

/**
 * Home's own "everything ledger": interleaves the flow-run rows Home already
 * derives (`deriveFlowLedgerRows(runs)`, unchanged) with the recent
 * standalone/flow-node agent rows `lib/agents-index.ts`'s
 * `fetchRecentAgentRuns` resolves, into ONE newest-first, deduped, bounded
 * list — reusing `mergeRecentAgentRuns` UNCHANGED (D2, the reuse seam that
 * module's own header documents: a generic "flatten + sort + dedupe-by-id +
 * bound" merge, not agent-specific despite its name).
 *
 * Passing `flowRows` FIRST is deliberate: `mergeRecentAgentRuns`'s dedupe
 * keeps the FIRST-seen row for a given id after a stable newest-first sort,
 * so a run that is BOTH a flow run (Home's own `runs`) AND a participant in
 * some agent's own history (a flow-node row sharing the SAME run id) always
 * surfaces as its flow-level row — one row per run, attributed to the flow,
 * never double-listed. Only genuinely standalone/session agent rows (no
 * colliding flow-run id) survive as their own rows.
 */
export function buildHomeLedgerRows(
  flowRows: LedgerRow[],
  agentRows: LedgerRow[],
  limit: number = HOME_LEDGER_LIMIT,
): LedgerRow[] {
  return mergeRecentAgentRuns([flowRows, agentRows], limit);
}

// ---------------------------------------------------------------------------
// W6-B11 — the Home active-sessions strip (recorded in
// docs/reference/studio-copy.md as the "Home active-sessions strip" variant)
// ---------------------------------------------------------------------------

/** The strip's card budget before overflow — mirrors the mock's own "4-card
 *  budget, needs-you first, overflow to /sessions" decision (mockup decision
 *  point №11). */
export const HOME_SESSIONS_STRIP_LIMIT = 4;

export type HomeSessionsStrip = {
  /** At most `limit` rows, needs-you first — a straight `.slice`, never
   *  re-sorted here: the bridge's aggregate sessions-index route already
   *  returns rows needs-you-first-then-newest
   *  (`sortAndCapSessionIndexRows`, apps/forge/ui-bridge.ts), and this derivation
   *  stays pure by trusting that server-side order rather than re-deriving
   *  it (declared-data-fails-open discipline: don't re-sort by a field this
   *  module would have to re-implement the SAME derivation for). */
  cards: SessionIndexRow[];
  /** Count of ALL in-flight sessions whose phase carries a derivable
   *  operator affordance (`needsYou`) — NOT just the ones that made the
   *  card budget, so the strip header's "N need you" stays honest even when
   *  needs-you sessions exceed the 4-card slice. */
  needsYouCount: number;
  /** Total in-flight session count — the strip's "all sessions (N)" overflow
   *  link reads this, never `cards.length` (which is capped at `limit`). */
  totalCount: number;
};

/**
 * Home's active-sessions strip derivation — takes the already-fetched,
 * already-sorted `sessions` (the SAME `SessionIndexRow[]`
 * `useStudioHomeData()` fetches via `fetchStudioSessions()`, `?active=1`
 * default — in-flight only, per the operator-locked "never terminal
 * history" rule) and slices it to the card budget, alongside the two counts
 * the strip header needs. Pure — no I/O, no re-fetch, no re-sort — matching
 * every other builder in this module.
 */
export function buildHomeSessionsStrip(
  sessions: SessionIndexRow[],
  limit: number = HOME_SESSIONS_STRIP_LIMIT,
): HomeSessionsStrip {
  return {
    cards: sessions.slice(0, limit),
    needsYouCount: sessions.filter((s) => s.needsYou).length,
    totalCount: sessions.length,
  };
}
