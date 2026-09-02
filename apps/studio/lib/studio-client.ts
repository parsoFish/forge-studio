/**
 * Client-side fetch helpers for the Studio bridge routes (M1-2).
 *
 * Mirrors the server-side types from orchestrator/run-model.ts and
 * orchestrator/studio/types.ts — re-declared client-side so they can be
 * imported into 'use client' components without pulling in Node.js modules.
 * Same pattern as EventLogEntry declared in bridge-client.ts.
 *
 * W7-A1 (home-sessions-V01 / crosscut-01 / crosscut-26): every helper rides
 * bridge-client's ONE transport (`bridgeFetch` — URL resolution + the W6-P4
 * port correction, shared, never a second copy) and NO read resolves with a
 * caller-supplied empty fallback any more. Reads either THROW `BridgeReadError`
 * (`studioRead`) or map a 404 to `null` where "no such object" is a real
 * answer (`studioReadOr404`); status-shaped reads (`{ok, …}`) carry `ok:false`
 * + the bridge's own `error` text. A caller can therefore never mistake
 * "bridge unreachable / refused" for "genuinely empty" — the exact swallow the
 * walkthrough found behind every pillar's false zero-state.
 */

import { Cron } from 'croner';

import { bridgeFetch } from './bridge-client';
import {
  readBridgeJson,
  unwrapBridgeRead,
  unwrapBridgeReadOr404,
  BridgeReadError,
  type BridgeReadResult,
} from './bridge-result';
// R6-01 WI-4: the standing-trigger wire type + its boundary validation live
// in their own module (with the agent-selection rule they belong to); this
// module only adds the fetch. The import is one-way — standing-triggers.ts
// never imports back from here.
import { parseStandingTriggers, type StandingTrigger } from './standing-triggers';
// R4-12-F1: the project-page "contract buildout" checklist reads the same rows
// the session-shell's contract-buildout artifact does — REUSE that row type +
// its parser (session-client.ts's exported `parseContractStageRow`), never a
// third client-side mirror. The import is one-way (session-client never imports
// back from here).
import { parseContractStageRow, type ContractStageRow } from './session-client';

// ---------------------------------------------------------------------------
// Types mirroring server shapes
// ---------------------------------------------------------------------------

export type RunStatus = 'planned' | 'active' | 'gated' | 'complete' | 'failed';
export type RunPhaseStatus = 'pending' | 'active' | 'complete' | 'retrying' | 'failed';

/**
 * forge-3oq: the server's own per-object provenance token — Flow / Agent /
 * Project / Kb each carry one on the wire now. `'unknown'` is an HONEST wire
 * value ("the server cannot attest"), not a client-guessed default; every
 * parser below normalises an absent/malformed token to `'unknown'` rather
 * than defaulting to `'operator'` (which would silently claim knowledge the
 * server never asserted) or `'ootb'` (which would fabricate a shipped claim).
 * The client STOPS inferring provenance from other fields (e.g. Flow.origin
 * — see `provenanceOfFlowOrigin`'s removal from `components/ProvenanceBadge.tsx`).
 */
export type Provenance = 'ootb' | 'operator' | 'unknown';

/**
 * forge-2am: one KB's lint summary, folded into `GET /api/studio/kbs` by the
 * server (`cli/bridge-studio-kbs.ts`, landing alongside this seam). `error`
 * is present only when the underlying lint run itself threw (mirrors
 * `KbHealth.healthError`'s "whole run threw" convention above) — its
 * presence, not its absence, is the "unknown" signal for a KB row.
 */
export type KbLintSummary = {
  errors: number;
  flags: number;
  checksRun: number;
  checksTotal: number;
  error?: string;
};

/**
 * Parse the server's provenance token. An absent/unrecognised value
 * normalises to the honest `'unknown'` — never a fabricated `'operator'`
 * default. The ONE parser every Flow/Agent/Project/Kb wire boundary below
 * reuses, so provenance is read off the wire in exactly one place.
 */
export function parseProvenance(raw: unknown): Provenance {
  return raw === 'ootb' || raw === 'operator' ? raw : 'unknown';
}

/**
 * Parse the per-KB lint summary (forge-2am). Absent or malformed (wrong
 * shape, wrong field types) parses to `null` — an honest "no data" — NEVER a
 * fabricated `{errors:0,flags:0,...}` "clean" verdict; that exact
 * fabrication is the declared-data-fails-open shape this seam exists to
 * close (`buildKbAttention` in `home-view.ts` treats `null` as "no row",
 * never as "clean").
 *
 * Review round (GAP 1/GAP 2, R6-07 batch-H honesty pass): two more ways this
 * boundary was failing open, both fixed here —
 *
 *  - GAP 1: `error`'s PRESENCE (not its absence) is the server's "the lint
 *    run itself threw" signal (see `KbLintSummary`'s header above). The
 *    prior `typeof l.error === 'string' ? {error} : {}` silently DROPPED a
 *    present-but-wrong-typed `error` instead of rejecting the object — that
 *    fabricates exactly the all-clean verdict this parser exists to refuse.
 *    A present-but-non-string `error` now invalidates the WHOLE object to
 *    `null`. `error: null` (and an absent key) both mean "no error was
 *    reported" and stay valid, with no `error` key on the result — `null`
 *    is not itself a rejection reason, only a wrong-typed non-null value is.
 *  - GAP 2: `typeof x === 'number'` alone admits NaN/Infinity/negative/
 *    non-integer counts, and nothing checked `checksRun <= checksTotal` —
 *    together these could reach the DOM as `data-attention-lint-errors="NaN"`
 *    or an inverted "50/10 checks ran". All four counts must now be finite,
 *    non-negative integers with `checksRun <= checksTotal`.
 */
export function parseKbLintSummary(raw: unknown): KbLintSummary | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const l = raw as Partial<KbLintSummary>;

  const isValidCount = (x: unknown): x is number =>
    typeof x === 'number' && Number.isInteger(x) && x >= 0;

  if (
    !isValidCount(l.errors) ||
    !isValidCount(l.flags) ||
    !isValidCount(l.checksRun) ||
    !isValidCount(l.checksTotal) ||
    l.checksRun > l.checksTotal
  ) {
    return null;
  }

  // A present-but-non-string, non-null `error` is a malformed payload —
  // reject the WHOLE object rather than silently dropping just this field
  // (GAP 1 above). `undefined` (absent) and `null` both mean "no error".
  if (l.error !== undefined && l.error !== null && typeof l.error !== 'string') {
    return null;
  }

  return {
    errors: l.errors,
    flags: l.flags,
    checksRun: l.checksRun,
    checksTotal: l.checksTotal,
    ...(typeof l.error === 'string' ? { error: l.error } : {}),
  };
}

export type RunPhaseMeta = {
  costUsd: number;
  retries: number;
  model?: string;
  lastProgressAt?: string;
  /** R6-01 WI-1 F1: mirrors orchestrator/run-model.ts's RunPhaseMeta.lastEventAt
   *  — latest event of ANY type attributed to this node (unlike lastProgressAt,
   *  not filtered to progress types). Drives lib/phase-log-refresh.ts. */
  lastEventAt?: string;
  wedged?: boolean;
  iter?: number;
  iterBudget?: number;
  brainReads?: number;
  delivered?: { files: number; insertions: number; commits: number };
  gateChecks?: { id: string; pass: boolean; detail?: string }[];
  /**
   * R6-05 WI-1: mirrors orchestrator/run-model.ts's RunPhaseMeta.findings —
   * the adversarial-review node's finding counts, carried verbatim over the
   * wire. Honest-absent: present only when a real review.findings.authored
   * event fired (a genuine all-zero clean pass still populates it).
   */
  findings?: { total: number; blocker: number; major: number; minor: number; info: number };
};

export type Run = {
  id: string;
  flowId: string;
  initiativeId: string;
  initiative: string;
  /**
   * W6-SW-3 (sweep C8#1): the manifest's project slug, carried through so
   * GateBar can thread it into `postGate` for plan gates — mirrors
   * orchestrator/run-model.ts's `Run.project`. Optional: absent for a
   * degraded (corrupt-manifest) run.
   */
  project?: string;
  /**
   * W8-A3 (`flows-23`): the architect session that produced this initiative —
   * mirrors `orchestrator/run-model.ts`'s `Run.architectSessionId`, straight
   * off the manifest. Absent when the manifest names none; never fabricated.
   */
  architectSessionId?: string;
  status: RunStatus;
  /** W7-C3 (forge-cv9): mirrors orchestrator/run-model.ts VALID_ORIGINS —
   *  'triggered' is a real, producible origin since R2-08-F4; the narrower
   *  client type forced consumers to handle only two of three cases. */
  origin: 'architect' | 'human-directed' | 'triggered';
  costUsd: number;
  startedAt?: string;
  /**
   * W7-A3 (flows-29): the real cycle-end instant, mirrored from
   * orchestrator/run-model.ts's `Run.completedAt` (W6-RV-2). Absent for a
   * still-open run — never fabricated. MonitorSummary's ELAPSED stops here.
   */
  completedAt?: string;
  phases: Record<string, RunPhaseStatus>;
  phaseMeta: Record<string, RunPhaseMeta>;
  artifactsReady: Partial<Record<
    'plan' | 'work-items' | 'pr' | 'demo' | 'verdict' | 'reflection',
    'view' | 'gate'
  >>;
  gate?: string;
  gateNote?: string;
  failedAt?: string;
  failNote?: string;
  /**
   * W8-A2 (ON-7 defect 2) — mirrors orchestrator/run-model.ts's
   * `Run.stopOnBudget` verbatim. The server has served this on the wire
   * (`sendJson(res, 200, { run }, ...)` — the WHOLE aggregated `Run`, no
   * field allowlist) since `stopOnBudget` first landed; this client TYPE
   * simply never declared it, so `parseRun` silently dropped it — the same
   * declared-data-fails-open class `trigger`/`reflectionLost`/`prUrl` below
   * were already fixed for. `RunControls`/`RunRail` need this to tell a
   * clean, resumable budget stop apart from an ordinary crash.
   */
  stopOnBudget?: { spentUsd: number; ceilingUsd: number; resumable: true; completedWorkItems: number; totalWorkItems: number; stoppedBeforeNode?: string };
  /** 2.10: the merged cycle's reflection was lost (cause) — mirrors orchestrator/run-model.ts. */
  reflectionLost?: string;
  reflectionLostNote?: string;
  /**
   * W7-B7 (artifact-plan-17): the run's pull-request URL, derived server-side
   * from its own `reviewer.pr-opened` event — mirrors
   * orchestrator/run-model.ts's `Run.prUrl`. Absent when the cycle never
   * opened a PR; never fabricated.
   */
  prUrl?: string;
  workItems?: { id: string; status: RunPhaseStatus; costUsd?: number; task?: string; dependsOn?: string[]; delivered?: { files: number; insertions: number; commits: number } }[];
  /**
   * The seed flows this run traversed (derived from its phases ∩ each flow's nodes).
   * A threaded spine run carries [forge-architect, forge-develop] so it
   * surfaces under both flow monitors (each rendering its own slice). A single-flow
   * run carries just its own flow id.
   */
  flowLineage: string[];
  /**
   * R2-08-F4 (ADR-027 amendment) / R6-01 WI-2: what started this run —
   * mirrors `orchestrator/run-model.ts`'s `Run.trigger` verbatim. Absent
   * when the run carries no derivable provenance (a plain
   * architect-originated run) — NEVER a fabricated default. `kind` is left
   * as `string` rather than importing `TriggerKindId` (an orchestrator-side
   * type this client-only module cannot pull in — see this file's header
   * for the re-declare-client-side convention).
   */
  trigger?: {
    kind: string;
    source: string;
    scope: string | null;
  };
};

export type AgentRuntime = {
  sdk: string;
  strategy: string;
  model: string | null;
  range: string[];
  label?: string;
  loopStrategy?: string; // A7: 'ralph' | 'one-shot' (dev-loop strategy)
};

/**
 * Server-computed per-agent capability descriptor (R2-02-F1,
 * orchestrator/studio/derive.ts `agentCapabilityDescriptor`). Re-declared
 * client-side per this file's header convention — threaded onto the wire by
 * the bridge (GET /api/studio/agents, GET /api/studio/starters) and carried
 * through as-is by `parseAgentDefinition`; NEVER re-derived here (a
 * capability fact computed only in UI code is the exact thing R2-02-F1
 * forbids).
 */
export type AgentCapabilityDescriptor = {
  interactive: boolean;
  runtimeSdks: string[];
  /** R2-03-F2 — true iff the agent declares a `fanout:` block. */
  fanoutCapable: boolean;
};

/** W6-B6 — client mirror of `orchestrator/phase-agent.ts`'s `ModelTier`
 *  (re-declared per this file's own convention, header). */
export type ModelTier = 'haiku' | 'sonnet' | 'opus';

/** R2-03-F2 — client mirror of the server AgentDefinition.fanout block. */
export type AgentFanout = {
  drivingArtifact: string;
  isolation: string;
  concurrencyCap?: number;
  perItemGate?: string;
};

export type Agent = {
  id: string;
  name: string;
  purpose: string;
  skills: string[];
  tools: string[];
  mcps: string[];
  guards: string[];
  // Library hook ids this agent carries (R3-03-F4) — a DISTINCT vocabulary
  // from `guards` (ADR-027 R3-03 amendment: composition.hooks holds library
  // hook ids, composition.guards holds the fixed platform dispatch-key set).
  hooks: string[];
  /**
   * R2-09 D1/D2 — the closed set of upload kinds (see MATERIAL_KINDS below)
   * this agent declares it accepts. `undefined` = not declared on the wire
   * payload (parse failure or genuinely absent — parseMaterials collapses
   * both, see its header); `[]` = declared-empty ("accepts nothing"), a
   * meaningful value distinct from absence. Never fabricate one from the
   * other.
   */
  materials?: string[];
  interactivity?: string;
  process?: string;
  runtime?: AgentRuntime;
  brainAccess?: string;
  phase?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  capability?: AgentCapabilityDescriptor;
  /** R2-03-F2 — the agent's declared fanout block (drives the node fanOut binding). */
  fanout?: AgentFanout;
  /**
   * R6-04 WI-3 — server-computed FACT (orchestrator/studio/derive.ts
   * `agentCapabilityDescriptor().costCeilingEnforceable`), read directly off
   * the wire's `capability` object rather than through `parseCapability`
   * (whose 3-key return shape is pinned byte-for-byte by
   * `studio-client.test.ts`'s existing `toEqual` assertions — adding a 4th
   * key there would break those unrelated, already-green pins). Mirrors the
   * SAME "own top-level field, parsed independently of `capability`"
   * precedent `materials` already established above. Absent/malformed wire
   * payload degrades to `false` — never fabricated as enforceable.
   */
  costCeilingEnforceable?: boolean;
  /** W7-B5 (agents-21): the agent's own declared `budgets.maxBudgetUsd`
   *  (its default standalone-run ceiling — docs/agent-cost-ceilings.md).
   *  Absent = the agent declares none; the run-level policy default
   *  applies. */
  declaredMaxBudgetUsd?: number;
  /**
   * W6-B6 (ADR-043 2026-08-15 amendment §3) — server-computed FACT
   * (`orchestrator/studio/derive.ts`'s `agentCapabilityDescriptor().
   * allowedTiers`), read directly off the wire's `capability` object —
   * SAME "own top-level field, parsed independently of `capability`"
   * precedent `costCeilingEnforceable` establishes immediately above (its
   * doc explains why: `capability`'s 3-key return shape is pinned
   * byte-for-byte by `studio-client.test.ts`'s existing `toEqual` pins).
   * Present ONLY for a `strategy:range` skill (the full SKILL-declared tier
   * envelope, cheapest-first); absent for `strategy:fixed` — the kickoff
   * page's model-tier picker renders a radio group when present, a
   * read-only chip naming `runtime.model` when absent. Absent/malformed
   * wire payload degrades to `undefined` (no picker), never a fabricated
   * single-tier array.
   */
  allowedTiers?: ModelTier[];
  /**
   * forge-3oq: server-sourced provenance (see `Provenance`'s header above).
   * Optional on the client TYPE (not the wire payload) so pre-existing empty/
   * fallback Agent literals elsewhere in forge-ui keep compiling —
   * `parseAgentDefinition` always attaches a real value (`'unknown'` at
   * worst) for every agent that actually came off the wire.
   */
  provenance?: Provenance;
};

export type FlowNode = {
  id: string;
  agent?: string;
  x?: number;
  y?: number;
  lane?: string;
  kind?: string;
  gate?: string;    // gate id (e.g. 'plan', 'verdict') — node blocks until approved
  fanOut?: string;  // upstream artifact name driving runtime multiplicity (mirrors server type)
  resumable?: boolean; // node can be resumed after a crash/ceiling
};

export type FlowEdge = {
  from: string;
  to: string;
  artifact?: string;
};

/** R2-04 (ADR-041): what a trigger starts. `agent` targets are the R4-09
 *  standalone-reflect extension — schema-accepted, but not authorable in the
 *  UI yet (the kind selector below always builds `{kind:'flow', ref}`). */
export type TriggerTarget = { kind: 'flow' | 'agent'; ref: string };

/**
 * `pull_request`/`issues` (R2-08-F3) back `on: pr-merged` / `on: issue-raised`
 * and are GitHub-only in practice (cli/bridge-hooks.ts never resolves either
 * header for gitea/gitlab); `push`/`release` back `on: webhook`. Mirrors
 * orchestrator/studio/types.ts's `WebhookTriggerConfig.events` element union
 * verbatim — forge-ui cannot import orchestrator TS directly (see this
 * file's header convention).
 */
export type WebhookEventName = 'push' | 'release' | 'pull_request' | 'issues';

/** R2-04 (ADR-041): a webhook trigger's receive/trust config. Secrets are
 *  env-var NAMES — the values live in the operator's environment, never in
 *  flow.yaml or this client. */
export type WebhookTriggerConfig = {
  id: string;
  provider: 'github' | 'gitea' | 'gitlab';
  events: Array<WebhookEventName>;
  secretEnv: string;
  secretEnvPrevious?: string;
  sources: string[];
};

/**
 * R2-04 (ADR-041): a declared trigger row — mirrors
 * orchestrator/studio/types.ts's server shape verbatim (the `flow: string`
 * shape this replaced was a pre-registry skew; every consumer now reads
 * `target.ref`, never a top-level `.flow`).
 */
export type FlowTrigger = {
  on: string;
  target: TriggerTarget;
  /** cron only: a croner-parseable pattern. */
  schedule?: string;
  /** cron only: K8s-style overrun policy. Default `forbid`; `replace` is enum-reserved. */
  concurrency?: 'allow' | 'forbid' | 'replace';
  /** webhook only. */
  webhook?: WebhookTriggerConfig;
  /** agent-complete only: the source agent slug whose completion fires this row
   *  (orchestrator/studio/validate-triggers.ts's trigger-agent-complete check
   *  requires this be non-empty — an absent agent never means "fires for all"). */
  agent?: string;
  note?: string;
};

/**
 * R2-04 (ADR-041): the shipped trigger kinds authorable in the UI today.
 * Mirrors orchestrator/flow-trigger.ts's `SHIPPED_TRIGGER_KIND_IDS` — the
 * server-side SSOT (registry rows-as-data). forge-ui cannot import
 * orchestrator TS directly, so this is a hand-kept mirror; keep it in
 * lockstep with the registry when a new kind ships (or one is retired).
 * All 7 shipped ids today: flow-complete, agent-complete, merged, pr-merged,
 * issue-raised, cron, webhook. `manual` | `feed` are registry-reserved (no
 * runtime yet) and intentionally absent — FlowHeader's kind selector must
 * never offer them.
 */
export const SHIPPED_TRIGGER_KINDS = [
  'flow-complete',
  'agent-complete',
  'merged',
  'pr-merged',
  'issue-raised',
  'cron',
  'webhook',
] as const;
export type ShippedTriggerKind = (typeof SHIPPED_TRIGGER_KINDS)[number];

/**
 * zyc review finding 1: the `on:` kinds that carry the `webhook:` config
 * block. `pr-merged` / `issue-raised` (R2-08-F3, ADR-027's amendment) reuse
 * the SAME `webhook:` shape `on: webhook` uses — own `on:` value, never a
 * sub-event under `on: webhook` — so `cli/bridge-hooks.ts`'s
 * `findWebhookTrigger` (which scans every flow for a trigger whose
 * `webhook.id === hookId`, regardless of which of the three kinds declared
 * it) can resolve a delivery for them. Mirrors
 * orchestrator/studio/validate-triggers.ts's `WEBHOOK_FAMILY_KIND_IDS`
 * verbatim (forge-ui cannot import orchestrator TS directly — see this
 * file's header convention).
 */
export const WEBHOOK_FAMILY_TRIGGER_KINDS: readonly ShippedTriggerKind[] = ['webhook', 'pr-merged', 'issue-raised'];

/**
 * zyc review finding 1: `pr-merged` / `issue-raised` are GitHub-only by
 * ruled design (`cli/bridge-hooks.ts`'s `resolveEventName` only maps
 * `pull_request`/`issues` under `provider === 'github'` — gitea/gitlab stay
 * schema-reserved with zero stub handlers for those two kinds). `webhook`
 * keeps all 3 shipped providers (push/release ARE shipped for gitea/gitlab).
 * Mirrors validate-triggers.ts's `WEBHOOK_PROVIDERS_BY_KIND` verbatim — kept
 * `Partial` (never widened to a total `Record`) so a lookup for a
 * non-webhook-family kind honestly returns `undefined`, not a fabricated
 * empty/default list.
 */
export const WEBHOOK_PROVIDERS_BY_KIND: Readonly<
  Partial<Record<ShippedTriggerKind, readonly WebhookTriggerConfig['provider'][]>>
> = {
  webhook: ['github', 'gitea', 'gitlab'],
  'pr-merged': ['github'],
  'issue-raised': ['github'],
};

/**
 * zyc review finding 1: each webhook-family kind accepts only its OWN event
 * name — never a shared set, or `on: webhook` could declare
 * `events: [pull_request]` (a header bridge-hooks.ts never resolves for that
 * kind). Mirrors validate-triggers.ts's `WEBHOOK_EVENTS_BY_KIND` verbatim.
 */
export const WEBHOOK_EVENTS_BY_KIND: Readonly<
  Partial<Record<ShippedTriggerKind, readonly WebhookEventName[]>>
> = {
  webhook: ['push', 'release'],
  'pr-merged': ['pull_request'],
  'issue-raised': ['issues'],
};

/** Client-side cron syntax check (UX only) — same croner engine as the
 *  server's `trigger-cron` lint (orchestrator/studio/validate.ts), which
 *  remains authoritative on save. Empty/blank counts as invalid (nothing to
 *  add yet), not a thrown error. */
export function isValidCronSchedule(schedule: string): boolean {
  if (!schedule.trim()) return false;
  try {
    new Cron(schedule, { paused: true });
    return true;
  } catch {
    return false;
  }
}

/** Inputs FlowHeader's per-kind trigger fields collect, fed to
 *  `buildTriggerDeclaration`. */
export type TriggerBuilderFields = {
  targetId: string;
  /** cron only. */
  schedule?: string;
  /** cron only; default `forbid` when omitted. */
  concurrency?: 'allow' | 'forbid';
  /** webhook-family only (webhook / pr-merged / issue-raised). */
  webhookId?: string;
  webhookProvider?: 'github' | 'gitea' | 'gitlab';
  webhookEvents?: Array<WebhookEventName>;
  webhookSecretEnv?: string;
  /** webhook-family only — comma-separated `owner/repo` list, split here. */
  webhookSources?: string;
  /** agent-complete only: the source agent slug whose completion fires this trigger. */
  agentSlug?: string;
};

/**
 * Build a `FlowTrigger` declaration from FlowHeader's kind selector + its
 * per-kind fields. Pure — no DOM — so it's unit-testable without mounting the
 * component (studio-client.test.ts). Returns `null` when the kind's required
 * fields are incomplete; FlowHeader keeps "+ add" disabled in that case, but
 * this re-validates rather than trusting the caller.
 *
 * The target is always `{kind:'flow', ref: fields.targetId}` for every kind —
 * agent targets are not authorable yet (R4-09; the request shape is schema-
 * ready per ADR-041, just not reachable from this UI).
 */
export function buildTriggerDeclaration(
  kind: ShippedTriggerKind,
  fields: TriggerBuilderFields,
): FlowTrigger | null {
  if (!fields.targetId) return null;
  const target: TriggerTarget = { kind: 'flow', ref: fields.targetId };
  if (kind === 'cron') {
    const schedule = fields.schedule?.trim();
    if (!schedule) return null;
    return { on: kind, target, schedule, concurrency: fields.concurrency ?? 'forbid' };
  }
  // zyc review finding 1: `pr-merged` / `issue-raised` reuse the SAME
  // `webhook:` config block `on: webhook` does (WEBHOOK_FAMILY_TRIGGER_KINDS
  // above) — before this fix only `kind === 'webhook'` reached this branch,
  // so a pr-merged/issue-raised trigger fell through to the generic
  // `{on, target}` fallback below with NO webhook block: authorable in the
  // UI, but cli/bridge-hooks.ts's `findWebhookTrigger` can only resolve a
  // delivery by scanning for `trigger.webhook.id === hookId` — a row with no
  // webhook block can never be addressed by any hook URL, permanently dead.
  if (WEBHOOK_FAMILY_TRIGGER_KINDS.includes(kind)) {
    const sources = (fields.webhookSources ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const events = fields.webhookEvents ?? [];
    if (!fields.webhookId || !fields.webhookProvider || !fields.webhookSecretEnv) return null;
    if (sources.length === 0 || events.length === 0) return null;
    return {
      on: kind,
      target,
      webhook: {
        id: fields.webhookId,
        provider: fields.webhookProvider,
        events,
        secretEnv: fields.webhookSecretEnv,
        sources,
      },
    };
  }
  if (kind === 'agent-complete') {
    const agent = fields.agentSlug?.trim();
    if (!agent) return null;
    return { on: kind, target, agent };
  }
  return { on: kind, target };
}

/**
 * zyc review finding 2 (guard-asymmetry): whether `existing` already
 * declares the SAME trigger identity as `(kind, targetRef[, forAgent])`.
 * FlowHeader's add-dedup and its target-flow dropdown filter both need this
 * "already declared" test and had drifted to two independently-written
 * (on,target)-only comparisons — silently excluding a valid SECOND
 * `agent-complete` row aimed at the same target flow with a DIFFERENT
 * source agent (the server has always supported this:
 * `orchestrator/flow-trigger.ts`'s `fireAgentCompleteTriggers` matches each
 * row independently by `trigger.agent === completedAgentSlug`, so two rows
 * differing only in `agent` are two genuinely distinct, both-real triggers).
 * A single shared definition here means both call sites can never drift
 * apart again.
 *
 * Every OTHER kind stays (on,target)-only: their dispatch never
 * differentiates a second identity (a second `flow-complete`/`cron`/
 * `webhook`/… row at the same target IS a real duplicate), so widening the
 * compare for them would silently allow one through.
 */
export function isSameTriggerIdentity(
  existing: Pick<FlowTrigger, 'on' | 'target' | 'agent'>,
  kind: string,
  targetRef: string,
  forAgent: string,
): boolean {
  if (existing.on !== kind || existing.target.ref !== targetRef) return false;
  if (kind === 'agent-complete') return (existing.agent ?? '') === forAgent;
  return true;
}

/** Stage C — per-flow kickoff kind; drives which launch surface the UI renders. */
export type FlowKickoff = {
  kind: 'idea' | 'initiative-select' | 'trigger-only';
};

export type Flow = {
  id: string;
  name: string;
  goal: string;
  project?: string;
  kb?: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  triggers: FlowTrigger[];
  /** Stage C — how this flow is launched (idea / initiative-select / trigger-only). */
  kickoff?: FlowKickoff;
  costCeilingUsd?: number;
  /**
   * Provenance of the flow. The bundled OOTB palette ships `seed` /
   * `ootb-library`; a flow authored in-app via PUT /api/studio/flows is
   * stamped `studio`. The first-run onramp keys off this to tell apart
   * shipped flows (don't suppress the onramp) from user-authored content.
   */
  origin?: string;
  /**
   * The flow's REAL derived band vocabulary (cli/flow-band-vocab.ts's
   * listFlowBandIds, R1-06 WI-1) — the distinct band ids its own
   * agent-bearing nodes declare via `composition.guards`. `[]` for a
   * bandless (or underivable) flow, never absent — GET /api/studio/flows
   * (cli/bridge-studio.ts) always attaches this per row (R1-06 WI-2).
   * Optional on the client TYPE (not the wire payload) so existing Flow
   * fixtures elsewhere in forge-ui that predate this field keep compiling;
   * `deriveKbBandOptions` below treats an absent value as `[]`.
   */
  bands?: string[];
  /**
   * forge-3oq: server-sourced provenance (see `Provenance`'s header above).
   * REPLACES the client-side `provenanceOfFlowOrigin(origin)` inference —
   * `origin` stays on the type (the first-run onramp still reads it, see
   * `app/library/page.tsx`), but provenance itself now comes from the wire,
   * never re-derived from `origin` client-side. Optional on the TYPE (not
   * the wire payload) so pre-existing empty/fallback Flow literals elsewhere
   * in forge-ui (e.g. `EMPTY_FLOW`) keep compiling; both `fetchStudioFlows`
   * (list) and `fetchFlow` (detail — forge-3oq review) always attach a real
   * value (`'unknown'` at worst) for every flow that actually came off the
   * wire.
   */
  provenance?: Provenance;
};

export type DemoStep = {
  kind: 'capture' | 'verify' | 'present';
  text: string;
  /** Library element-kind id when this step is composed from a forge demo element. */
  element?: string;
};

export type Project = {
  id: string;
  name: string;
  northStar?: string;
  instructions?: string;
  /** Source of `instructions`: the agent-instruction file (single source) or the
   *  legacy project.json field. When file-bound the editor is read-only. */
  instructionsSource?: 'AGENTS.md' | 'CLAUDE.md' | 'project.json';
  demoProcess?: DemoStep[];
  skills: string[];
  kb?: string;
  /** True when a reproducible demo is locked in the repo (.forge/demo/demo.lock.json). */
  hasLockedDemo?: boolean;
  /**
   * forge-3oq: server-sourced provenance (see `Provenance`'s header above).
   * Optional on the client TYPE (not the wire payload) so pre-existing
   * empty/fallback Project literals elsewhere in forge-ui keep compiling;
   * `fetchStudioProjects` always attaches a real value (`'unknown'` at
   * worst) for every project that actually came off the wire.
   */
  provenance?: Provenance;
  /**
   * W8-C3 (projects-08 / forge-j1e): the server's per-request contract-health
   * verdict for this project — derived by running `.forge/project.json`
   * through the SAME validator the orchestrator runs the project through
   * (`validateProjectConfig`), never persisted anywhere.
   *
   * Optional on the client TYPE (not the wire payload) so pre-existing
   * `Project` literals elsewhere in forge-ui keep compiling;
   * `fetchStudioProjects` always attaches a real value — `{ state: 'unknown' }`
   * at worst — for every project that actually came off the wire. `'unknown'`
   * is the honest fail-CLOSED normalisation of an absent/garbage field; it is
   * NEVER rounded up to `'ok'` (see `parseProjectConfigHealth`).
   */
  configHealth?: ProjectConfigHealth;
  /**
   * W8-C3 (projects-06 / projects-43): the ids of skills that live INSIDE this
   * project (`.forge/skills/<id>/SKILL.md`), derived from disk by the bridge on
   * every read. Optional on the TYPE so pre-existing `Project` literals keep
   * compiling; `fetchStudioProjects` always attaches a real array (`[]` at
   * worst) for every project that came off the wire.
   */
  localSkills?: string[];
};

/**
 * The client-side mirror of the bridge's `ProjectConfigHealth`
 * (`cli/bridge-studio.ts`), plus the one state only a client can be in:
 * `'unknown'`, meaning the wire carried nothing this boundary could parse.
 */
export type ProjectConfigHealth = {
  state: 'ok' | 'unconfigured' | 'invalid' | 'unknown';
  /** The judging component's OWN message. Absent when there is nothing to say. */
  reason?: string;
};

const PROJECT_CONFIG_HEALTH_STATES = ['ok', 'unconfigured', 'invalid', 'unknown'] as const;

/**
 * Parse the server's contract-health verdict. Fail CLOSED: an absent field, a
 * non-object, or an unrecognised state token all normalise to
 * `{ state: 'unknown' }` — an honest "we do not know" — and NEVER to `'ok'`.
 * Defaulting an unknown to healthy is the identical fabrication
 * `parseKbLint` exists to refuse (`{errors:0,flags:0}` invented for an absent
 * summary), and it would silently restore the exact defect W8-C3 closes.
 *
 * A non-string `reason` is DROPPED rather than carried: the UI renders it as
 * text, and an object reaching a text slot is a render crash, not a message.
 */
export function parseProjectConfigHealth(raw: unknown): ProjectConfigHealth {
  if (typeof raw !== 'object' || raw === null) return { state: 'unknown' };
  const obj = raw as Record<string, unknown>;
  const state = PROJECT_CONFIG_HEALTH_STATES.find((s) => s === obj['state']);
  if (state === undefined) return { state: 'unknown' };
  const reason = obj['reason'];
  return typeof reason === 'string' && reason !== '' ? { state, reason } : { state };
}

/**
 * Parse a wire list of skill ids. Absent / non-array normalises to `[]`, and
 * non-string elements are dropped rather than carried — the honest empty is
 * "we looked and found none", and a malformed element must never become a
 * bindable id.
 */
export function parseSkillIdList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
}

export type KbBinding =
  | {
      kind: 'flow';
      ref: string;
      /**
       * Optional band scope (R1-06, ADR-010 amendment "R1-06 band-scoped
       * reviewer grant") — mirrors orchestrator/studio/types.ts's KbBinding.
       * Meaningless off a `flow` binding. Absent ⇒ unscoped.
       */
      band?: string;
    }
  | { kind: 'project'; ref: string }
  | { kind: 'unique' };

export type Kb = {
  id: string;
  name: string;
  desc?: string;
  binding: KbBinding;
  counts: { index: number; themes: number; raw: number };
  /**
   * forge-2am: the per-KB lint summary folded into `GET /api/studio/kbs`
   * (see `KbLintSummary`'s header above). `null` is the honest "no data"
   * value — REQUIRED (not optional) precisely so a caller cannot skip
   * setting it and accidentally leave it `undefined`, which `buildKbAttention`
   * would then have to treat as a THIRD ambiguous state instead of the two
   * real ones (a real summary, or honestly none).
   */
  lint: KbLintSummary | null;
  /**
   * forge-3oq: server-sourced provenance (see `Provenance`'s header above).
   * REQUIRED (not optional) — every KB that reaches the client passes
   * through `parseProvenance` at its wire boundary, always attaching a real
   * value (`'unknown'` at worst), whether it arrived via `fetchStudioKbs`
   * (list) or `fetchKb` (detail — forge-3oq review closed the gap where the
   * detail route cast the wire value straight through instead of parsing
   * it); there is no legitimate "KB with no provenance opinion" state the
   * way there is for a bare fallback Flow/Agent/Project literal elsewhere in
   * forge-ui.
   */
  provenance: Provenance;
};

export type KbLayer = 'index' | 'theme' | 'raw' | 'guidance';

export type KbNode = {
  id: string;
  title: string;
  layer: KbLayer;
  category?: string;
  updatedAt?: string;
};

export type KbEdge = { from: string; to: string };

/** W8-B2 (forge-9kr) — a declared `related_themes` edge whose target is a REAL
 *  theme in ANOTHER KB. It cannot be drawn here (this graph has no node for
 *  it), but it exists, and used to be dropped with no signal at all. Optional
 *  on the wire: a status written before this field existed simply has none. */
export type KbExternalEdge = { from: string; toSlug: string };

export type KbGraph = { nodes: KbNode[]; edges: KbEdge[]; externalEdges?: KbExternalEdge[] };

/** R6-08 WI-1 — one per-check itemization row (see cli/bridge-studio-kbs.ts's
 *  buildKbHealth). `status: 'unknown'` only ever appears when the whole lint
 *  run threw (RULING 3), reflected via the sibling `KbHealth.healthError`.
 *  R6-08 4on — `status: 'n/a'` means this check never actually inspected
 *  THIS kb (neither the shared full-scope scan nor this kb's own theme files
 *  cover it) — the honest alternative to a declared-data-fails-open 'pass'. */
export type KbHealthCheck = {
  check: string;
  status: 'pass' | 'warn' | 'fail' | 'unknown' | 'n/a';
  errorCount: number;
  flagCount: number;
};

export type KbHealth = {
  layerBalance: { index: number; theme: number; raw: number };
  /** Degree-0 nodes EXCLUDING the raw layer (W7-B2, knowledge-28). */
  orphans: number;
  /** Degree-0 RAW-layer nodes — unlinked by design, reported neutrally.
   *  Optional: pre-W7 responses/fixtures don't carry it. */
  unlinkedRaw?: number;
  linkDensity: number;
  staleness: { staleRawCount: number; staleThemeCount: number };
  lintFlags: number;
  lintErrors: number;
  /** R6-08 WI-1 — optional for older fixtures/tests that don't set it; a
   *  real bridge response always includes one entry per CHECK_NAMES. */
  checks?: KbHealthCheck[];
  /** R6-08 WI-1 RULING 3 — present iff the server's lint run threw. */
  healthError?: string;
};

export type KbNodeArticle = {
  id: string;
  title: string;
  layer: KbLayer;
  category?: string;
  body: string;
  inbound: { id: string; title: string }[];
  outbound: { id: string; title: string }[];
  touchedBy?: string;
};

export type KbDetail = {
  kb: Kb;
  graph: KbGraph;
  health: KbHealth;
  /** W7-B2 (knowledge-29): pinned guidance notes awaiting an ingest pass —
   *  file names under the KB's own `_guidance/`. Optional pre-W7. */
  guidance?: Array<{ file: string; at: string }>;
};

export type CatalogItem = {
  id: string;
  name: string;
  desc?: string;
  [key: string]: unknown;
};

export type Catalog = {
  skills?: CatalogItem[];
  tools?: CatalogItem[];
  mcps?: CatalogItem[];
  guards?: CatalogItem[];
  // Real library hooks (studio/hooks/<id>/), filesystem-scanned rather than
  // catalog rows — unioned in server-side by the /api/studio/catalog route
  // the same way listPlainSkills is unioned into `skills` (R3-03-F4).
  hooks?: CatalogItem[];
  artifacts?: CatalogItem[];
  models?: CatalogItem[];
  sdks?: CatalogItem[];
};

export type PhaseLogLine = {
  at: string;
  kind: 'info' | 'tool' | 'cost' | 'stderr' | 'retry' | 'reasoning';
  text: string;
  /** Expandable detail (M3): reasoning text, tool inputs, error reason, raw metadata. */
  detail?: string;
};

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

/**
 * W7-A1 — GET a Studio bridge route as an explicit `BridgeReadResult`.
 * `{ok:false,status,error,body}` when the bridge answered non-2xx (its own
 * `error`/`message` verbatim — a 409's migration instructions reach the
 * operator, crosscut-12), `{ok:false,error}` (no status) when the transport
 * threw. Shares `bridge-client`'s `bridgeFetch` (crosscut-26) and
 * `bridge-result`'s classification with `bridgeRead`.
 */
async function studioGet<T>(path: string): Promise<BridgeReadResult<T>> {
  return readBridgeJson<T>(() => bridgeFetch(path));
}

/** GET as a value; THROWS `BridgeReadError` on any failure. */
async function studioRead<T>(path: string): Promise<T> {
  return unwrapBridgeRead(path, await studioGet<T>(path));
}

/** GET as a value where 404 is a real answer (→ null); other failures throw. */
async function studioReadOr404<T>(path: string): Promise<T | null> {
  return unwrapBridgeReadOr404(path, await studioGet<T>(path));
}

async function studioSend(
  method: 'PUT' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> }> {
  try {
    const res = await bridgeFetch(path, {
      method,
      headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; message?: string } & Record<string, unknown>;
    // W7-B4 (flows-10): the failure body rides along — the bridge's 400
    // carries per-node validation `findings` the caller must not lose.
    if (!res.ok) return { ok: false, error: data.error ?? data.message ?? `HTTP ${res.status}`, data };
    // A 2xx is success; an explicit `ok: false` overrides. A 2xx that omits `ok`
    // (e.g. the lint maintenance op) is success — not a silent failure.
    return { ok: typeof data.ok === 'boolean' ? data.ok : true, data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function studioDelete(
  path: string,
): Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> }> {
  return studioSend('DELETE', path);
}

async function studioPut(
  path: string,
  body: unknown,
): Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> }> {
  return studioSend('PUT', path, body);
}

export async function studioPost(
  path: string,
  body: unknown,
): Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> }> {
  return studioSend('POST', path, body);
}

/** Fetch all runs (optionally filtered by flowId). */
export async function fetchRuns(flowId?: string): Promise<Run[]> {
  const qs = flowId ? `?flow=${encodeURIComponent(flowId)}` : '';
  const body = await studioRead<{ runs?: unknown[] }>(`/api/runs${qs}`);
  return (body.runs ?? []).map(parseRun);
}

/** Stage C — a decomposed, not-yet-running initiative the develop flow can launch. */
export type PlannedInitiative = {
  initiativeId: string;
  project: string | null;
  title: string;
  ready: boolean;
  blockedBy: string[];
};

/** Fetch the develop-able (planned) initiatives for the initiative-select kickoff. */
export async function fetchPlannedInitiatives(): Promise<PlannedInitiative[]> {
  const body = await studioRead<{ planned?: PlannedInitiative[] }>('/api/runs/planned');
  return body.planned ?? [];
}

/**
 * W7-FIX-A3 (round-2 finding 2) — a run lookup with the bridge's PER-RUN
 * existence fact attached. `run: null` says the queue knows no such run;
 * `onDisk` says whether anything exists on disk for the id (the 404 body's
 * guarded `_logs/<id>` probe). The artifact page's not-found rule needs both,
 * and neither may be inferred from whichever artifact a given `?type=` read.
 * A 404 is a real answer here; every other failure still throws (an outage
 * must never read as "no such run").
 */
export type RunLookup = { run: Run | null; onDisk: boolean };

export async function fetchRunLookup(id: string): Promise<RunLookup> {
  const path = `/api/runs/${encodeURIComponent(id)}`;
  const r = await studioGet<{ run?: unknown }>(path);
  if (r.ok) {
    return r.data?.run ? { run: parseRun(r.data.run), onDisk: true } : { run: null, onDisk: false };
  }
  if (r.status === 404) {
    const body = r.body as { onDisk?: unknown } | undefined;
    return { run: null, onDisk: body?.onDisk === true };
  }
  throw new BridgeReadError(path, r);
}

/** Fetch a single run by id. 404 → null; any other failure throws. */
export async function fetchRun(id: string): Promise<Run | null> {
  return (await fetchRunLookup(id)).run;
}

/** Fetch phase log lines for a run's node. */
export async function fetchPhaseLog(
  runId: string,
  nodeId: string,
  stderr?: boolean,
  wiId?: string,
): Promise<PhaseLogLine[]> {
  const params = new URLSearchParams();
  if (stderr) params.set('stderr', '1');
  if (wiId) params.set('wiId', wiId); // per-WI scoping (#11)
  const qs = params.toString() ? `?${params.toString()}` : '';
  // 404 = "no events.jsonl for run" (a planned run that hasn't started) — an
  // honest empty log; every other failure throws.
  const body = await studioReadOr404<{ lines?: PhaseLogLine[] }>(
    `/api/runs/${encodeURIComponent(runId)}/phases/${encodeURIComponent(nodeId)}/log${qs}`,
  );
  return body?.lines ?? [];
}

/**
 * Normalise a raw server Run, filling in any missing sub-shapes so
 * downstream components never crash on an incomplete response.
 */
export function parseRun(raw: unknown): Run {
  const r = (raw ?? {}) as Partial<Run>;
  return {
    id:            r.id            ?? '',
    flowId:        r.flowId        ?? '',
    initiativeId:  r.initiativeId  ?? '',
    initiative:    r.initiative    ?? '',
    status:        r.status        ?? 'planned',
    origin:        r.origin        ?? 'human-directed',
    costUsd:       r.costUsd       ?? 0,
    startedAt:     r.startedAt,
    // W7-A3 (flows-29): served since W6-RV-2, dropped here until now — the
    // declared-data-fails-open class the field-parity pin exists for.
    ...(r.completedAt !== undefined ? { completedAt: r.completedAt } : {}),
    phases:        r.phases        ?? {},
    phaseMeta:     r.phaseMeta     ?? {},
    artifactsReady: r.artifactsReady ?? {},
    gate:          r.gate,
    gateNote:      r.gateNote,
    failedAt:      r.failedAt,
    failNote:      r.failNote,
    // W8-A2 (ON-7 defect 2): same declared-data-fails-open guard as
    // trigger/reflectionLost/prUrl below — stopOnBudget was already served
    // on the wire but silently dropped here before RunControls/RunRail
    // ever saw it.
    ...(r.stopOnBudget !== undefined ? { stopOnBudget: r.stopOnBudget } : {}),
    workItems:     r.workItems     ?? [],
    flowLineage:   r.flowLineage   ?? [],
    // R6-01 WI-2: carried through, never defaulted — an absent `trigger` key
    // must stay absent (declared-data-fails-open guard: this field was
    // parsed and served end-to-end already, then silently dropped here).
    ...(r.trigger !== undefined ? { trigger: r.trigger } : {}),
    // R6-05 WI-1: same declared-data-fails-open guard, applied to
    // reflectionLost/reflectionLostNote — both are declared on the Run type
    // and already consumed by RunRail.tsx, but were never listed here, so a
    // real reflector crash/budget/max-turns loss was silently dropped before
    // reaching the client. Each carried independently — a lost reflection
    // with no note must not be paired away.
    ...(r.reflectionLost !== undefined ? { reflectionLost: r.reflectionLost } : {}),
    ...(r.reflectionLostNote !== undefined ? { reflectionLostNote: r.reflectionLostNote } : {}),
    // W6-SW-3 (sweep C8#1): declared-data-fails-open guard, same pattern as
    // trigger/reflectionLost above — project is parsed and served, must not
    // be silently dropped here (GateBar depends on it reaching the client).
    ...(r.project !== undefined ? { project: r.project } : {}),
    // W7-B7 (artifact-plan-17): same guard — the PR artifact page's link
    // depends on prUrl reaching the client.
    ...(r.prUrl !== undefined ? { prUrl: r.prUrl } : {}),
    // W8-A3 (flows-23): same guard again — the run detail page's link back to
    // the architect session that produced the initiative. Carried, never
    // defaulted: an absent key must stay absent so nothing fabricates a
    // session id for a run that names none.
    ...(r.architectSessionId !== undefined ? { architectSessionId: r.architectSessionId } : {}),
  };
}

/**
 * Parse a raw `capability` field (server shape, R2-02-F1) into the client
 * `AgentCapabilityDescriptor` type. Carries the server-computed value
 * through verbatim — no capability fact is derived here. Returns undefined
 * if the field is absent or malformed (e.g. an older bridge payload).
 * Exported for direct unit testing (AC3: the value is carried, not
 * re-derived — see `studio-client.test.ts`).
 */
export function parseCapability(raw: unknown): AgentCapabilityDescriptor | undefined {
  const c = raw as Partial<AgentCapabilityDescriptor> | undefined;
  if (!c || typeof c.interactive !== 'boolean' || !Array.isArray(c.runtimeSdks)) return undefined;
  // fanoutCapable is optional-tolerant: an older bridge payload without it
  // degrades to false (not the whole descriptor to undefined).
  return { interactive: c.interactive, runtimeSdks: c.runtimeSdks as string[], fanoutCapable: c.fanoutCapable === true };
}

/** R2-03-F2 — carry the raw AgentDefinition.fanout block through; undefined if absent/malformed. */
export function parseFanout(raw: unknown): AgentFanout | undefined {
  const f = raw as Partial<AgentFanout> | undefined;
  if (!f || typeof f.drivingArtifact !== 'string' || typeof f.isolation !== 'string') return undefined;
  return {
    drivingArtifact: f.drivingArtifact,
    isolation: f.isolation,
    ...(typeof f.concurrencyCap === 'number' ? { concurrencyCap: f.concurrencyCap } : {}),
    ...(typeof f.perItemGate === 'string' ? { perItemGate: f.perItemGate } : {}),
  };
}

const MODEL_TIER_VALUES: readonly ModelTier[] = ['haiku', 'sonnet', 'opus'];

/** W6-B6 — carry `capability.allowedTiers` through verbatim; `undefined` for
 *  an absent/malformed value (an older bridge payload, or a `strategy:fixed`
 *  skill that never carries the key at all) — never a fabricated single-tier
 *  array. Every element must be a real `ModelTier`; ANY unrecognised element
 *  degrades the WHOLE array to `undefined` rather than silently dropping
 *  just that one entry (a partial tier list would let the kickoff picker
 *  offer a narrower-than-real range without any signal something's wrong). */
/** W8-B3 — the single-tier sibling of `parseAllowedTiers` below: a value
 *  outside the closed `ModelTier` vocabulary is refused, never coerced. */
function isModelTier(raw: unknown): raw is ModelTier {
  return typeof raw === 'string' && (MODEL_TIER_VALUES as readonly string[]).includes(raw);
}

function parseAllowedTiers(raw: unknown): ModelTier[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  if (!raw.every((t): t is ModelTier => typeof t === 'string' && (MODEL_TIER_VALUES as readonly string[]).includes(t))) return undefined;
  return raw;
}

/**
 * Map a raw AgentDefinition (server shape) to the client Agent type.
 * Server: slug, composition.{skills,tools,mcps,guards}, body, name, purpose,
 *         interactivity, brainAccess, runtime, phase, allowedTools, disallowedTools, capability
 * Client: id, skills, tools, mcps, guards, process, name, purpose,
 *         interactivity, brainAccess, runtime, phase, allowedTools, disallowedTools, capability
 */
function parseAgentDefinition(raw: unknown): Agent {
  const r = (raw ?? {}) as Record<string, unknown>;
  const comp = (r['composition'] ?? {}) as Record<string, unknown>;
  const rt = (r['runtime'] ?? {}) as Partial<AgentRuntime>;
  const cap = (r['capability'] ?? {}) as Record<string, unknown>;
  return {
    id:             typeof r['slug']          === 'string' ? r['slug']          : '',
    name:           typeof r['name']          === 'string' ? r['name']          : '',
    purpose:        typeof r['purpose']       === 'string' ? r['purpose']       : '',
    skills:         Array.isArray(comp['skills'])  ? (comp['skills']  as string[]) : [],
    tools:          Array.isArray(comp['tools'])   ? (comp['tools']   as string[]) : [],
    mcps:           Array.isArray(comp['mcps'])    ? (comp['mcps']    as string[]) : [],
    guards:         Array.isArray(comp['guards'])  ? (comp['guards']  as string[]) : [],
    hooks:          Array.isArray(comp['hooks'])   ? (comp['hooks']   as string[]) : [],
    process:        typeof r['body']          === 'string' ? r['body']          : '',
    interactivity:  typeof r['interactivity'] === 'string' ? r['interactivity'] : '',
    brainAccess:    typeof r['brainAccess']   === 'string' ? r['brainAccess']   : 'none',
    phase:          typeof r['phase']         === 'string' ? r['phase']         : undefined,
    allowedTools:   Array.isArray(r['allowedTools'])    ? (r['allowedTools']    as string[]) : [],
    disallowedTools:Array.isArray(r['disallowedTools']) ? (r['disallowedTools'] as string[]) : [],
    capability:     parseCapability(r['capability']),
    fanout:         parseFanout(r['fanout']),
    materials:      parseMaterials(r['materials']),
    costCeilingEnforceable: cap['costCeilingEnforceable'] === true,
    // W7-B5 (agents-21): the agent's OWN declared default ceiling
    // (SKILL.md `budgets.maxBudgetUsd`) — seeds the kickoff field ahead of
    // the run-level policy default. Absent stays absent.
    declaredMaxBudgetUsd: typeof (r['budgets'] as Record<string, unknown> | undefined)?.['maxBudgetUsd'] === 'number'
      ? ((r['budgets'] as Record<string, unknown>)['maxBudgetUsd'] as number)
      : undefined,
    allowedTiers:   parseAllowedTiers(cap['allowedTiers']),
    provenance:     parseProvenance(r['provenance']),
    runtime: {
      sdk:           typeof rt.sdk           === 'string' ? rt.sdk           : 'claude-code',
      strategy:      (rt.strategy === 'fixed' || rt.strategy === 'range') ? rt.strategy : 'fixed',
      model:         typeof rt.model         === 'string' ? rt.model         : null,
      range:         Array.isArray(rt.range)             ? rt.range          : [],
      loopStrategy:  typeof rt.loopStrategy  === 'string' ? rt.loopStrategy  : undefined,
    },
  };
}

/** Fetch all agent definitions. */
export async function fetchStudioAgents(): Promise<Agent[]> {
  return (await fetchStudioAgentsWithMeta()).agents;
}

/**
 * R6-04 WI-3 — `GET /api/studio/agents`'s full payload, including
 * `defaultCostCeilingUsd` (a RUN-LEVEL policy value, `cli/bridge-studio.ts`
 * — resolved from `forge.config.json`'s `runs.defaultCostCeilingUsd`,
 * falling back to the server's own default constant). Never a literal in
 * any component: RunPanel's cost-ceiling field is pre-filled from THIS
 * value, fetched here, not guessed at client-side. A missing/malformed
 * field on the wire degrades to `0` — an obviously-off value, never a
 * fabricated plausible-looking default.
 */
export async function fetchStudioAgentsWithMeta(): Promise<{ agents: Agent[]; defaultCostCeilingUsd: number }> {
  const body = await studioRead<{ agents?: unknown[]; defaultCostCeilingUsd?: unknown }>('/api/studio/agents');
  return {
    agents: (body.agents ?? []).map(parseAgentDefinition),
    defaultCostCeilingUsd: typeof body.defaultCostCeilingUsd === 'number' ? body.defaultCostCeilingUsd : 0,
  };
}

/**
 * W6-B6 fix (wave-6 final gate, journey demo-builder DB-4) — the FULL server
 * `AgentCapabilityDescriptor` (orchestrator/studio/derive.ts), fetched
 * directly for ONE named slug via `fetchAgentCapability` below. NOT the
 * roster's 3-key `capability` field `parseCapability` above parses (whose
 * shape is pinned separately — see that function's own header for why); this
 * type carries every key the server descriptor has, `allowedTiers` included.
 *
 * Exists because `/api/studio/agents`' roster (`fetchStudioAgents`) filters
 * out every `library: false` agent (orchestrator/studio/registry.ts's
 * `isStudioAgent`) — every kickoff-only system agent (demo-builder,
 * instructions-creator, brain-maintenance, creation-agent,
 * project-brain-builder) sets that flag, so NONE of them were ever
 * resolvable through the roster. This type/fetch pair resolves ONE agent
 * directly against the bridge's UNFILTERED per-slug capability route
 * instead.
 */
export type AgentCapability = {
  interactive: boolean;
  runtimeSdks: string[];
  fanoutCapable: boolean;
  materials: string[];
  costCeilingEnforceable: boolean;
  allowedTiers?: ModelTier[];
  /**
   * W8-B3 (sessions-kinds-R06) — the ONE tier a `strategy:fixed` agent can
   * run on, server-derived off its SKILL.md `runtime.model`. The exact
   * mirror of `allowedTiers`: present only for `fixed`, absent for `range`,
   * so precisely one of the two keys ever arrives and the PRESENCE carries
   * the fact. The kickoff picker names it in the read-only chip instead of
   * printing the literal string "fixed · read-only", which is why the three
   * fixed-tier session kinds never named their model anywhere.
   */
  fixedTier?: ModelTier;
};

/** Parse `GET /api/studio/agents/:slug/capability`'s `capability` field.
 *  Returns `null` for an absent/malformed payload (unknown slug, older
 *  bridge, or the no-bridge-configured fallback `{}`) — never a fabricated
 *  stand-in descriptor. Exported for direct unit testing, same precedent as
 *  `parseCapability` above. */
export function parseAgentCapability(raw: unknown): AgentCapability | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  if (typeof c['interactive'] !== 'boolean' || !Array.isArray(c['runtimeSdks'])) return null;
  const allowedTiers = parseAllowedTiers(c['allowedTiers']);
  return {
    interactive: c['interactive'] as boolean,
    runtimeSdks: c['runtimeSdks'] as string[],
    fanoutCapable: c['fanoutCapable'] === true,
    materials: Array.isArray(c['materials']) ? (c['materials'] as string[]) : [],
    costCeilingEnforceable: c['costCeilingEnforceable'] === true,
    // Omit the key entirely when absent (never `allowedTiers: undefined`) —
    // same discipline as the server's own AgentCapabilityDescriptor
    // (orchestrator/studio/derive.ts) and PhaseAgentSpec.allowedTiers.
    ...(allowedTiers ? { allowedTiers } : {}),
    // W8-B3 — same discipline; a malformed/absent value stays absent rather
    // than becoming a fabricated tier.
    ...(isModelTier(c['fixedTier']) ? { fixedTier: c['fixedTier'] } : {}),
  };
}

/**
 * Fetch ONE agent's server-computed capability descriptor by slug — the
 * UNFILTERED counterpart to `fetchStudioAgents()`'s roster (W6-B6 fix). The
 * session-kickoff page (app/sessions/[kind]/new/page.tsx) uses this for
 * `KICKOFF_KINDS[kind].agentSlug`: a `library:false` kickoff-only agent is
 * never in the roster `fetchStudioAgents()` returns, but still has a real
 * SKILL.md-declared tier envelope this route reads directly. Returns `null`
 * for an unknown slug or a malformed/absent bridge response — never a
 * fabricated fixed-tier stand-in.
 */
export async function fetchAgentCapability(slug: string): Promise<AgentCapability | null> {
  const body = await studioReadOr404<{ capability?: unknown }>(
    `/api/studio/agents/${encodeURIComponent(slug)}/capability`,
  );
  return parseAgentCapability(body?.capability);
}

/** Fetch the curated OOTB starter agents (ADR-033) for the New-Agent picker. */
export async function fetchStarters(): Promise<Agent[]> {
  const body = await studioRead<{ starters?: unknown[] }>('/api/studio/starters');
  return (body.starters ?? []).map(parseAgentDefinition);
}

/** Fetch the curated starter flow (plan → dev → review) the New-Flow canvas seeds from. */
export async function fetchStarterFlow(): Promise<Flow | null> {
  const body = await studioRead<{ flow?: Flow | null }>('/api/studio/starters');
  return body.flow ?? null;
}

/**
 * Fetch all flow definitions. Every other field is carried through as the
 * wire sent it (an existing cast, unchanged); `provenance` (forge-3oq) is
 * the one field REAL-parsed at this boundary rather than cast — an
 * absent/garbage wire value must normalise to `'unknown'`, never pass
 * through raw or default to `'operator'`.
 */
export async function fetchStudioFlows(): Promise<Flow[]> {
  const body = await studioRead<{ flows?: unknown[] }>('/api/studio/flows');
  return (body.flows ?? []).map((raw) => ({
    ...(raw as Flow),
    provenance: parseProvenance((raw as Record<string, unknown> | null)?.['provenance']),
  }));
}

/**
 * Derive the `[data-field="kb-binding-band"]` select's options (R1-06 WI-2
 * group A) — pure, DOM-free so it's unit-testable without mounting
 * `/knowledge/new` (see studio-client.test.ts's block comment for why a
 * render test can't observe this page's state transitions).
 *
 * - `kind !== 'flow'` -> `null`: the field must not render at all for a
 *   project (or unique) binding — band scope is meaningless there.
 * - `kind === 'flow'` -> the bound flow's REAL derived `bands` (never the
 *   whole flow roster's union), `[]` when unbound (`ref` doesn't match any
 *   flow) or the matched flow is bandless. Never throws.
 */
export function deriveKbBandOptions(
  kind: 'flow' | 'project',
  flows: Pick<Flow, 'id' | 'name' | 'bands'>[],
  ref: string,
): string[] | null {
  if (kind !== 'flow') return null;
  const bound = flows.find((f) => f.id === ref);
  return bound?.bands ?? [];
}

/**
 * R6-01 WI-4 — fetch every standing trigger declared across the whole flow
 * roster (`GET /api/triggers`, a pure read).
 *
 * Shares this module's read convention exactly like `fetchStudioFlows`/
 * `fetchStudioProjects` (W7-A1): a bridge that is unreachable or refuses
 * THROWS `BridgeReadError` — a caller's `Promise.all` rejects and renders the
 * shared failure state rather than a false empty roster.
 *
 * The rows are validated at this boundary (`parseStandingTriggers`) rather
 * than cast, because they are rendered inside the agent page's React tree —
 * an unvalidated malformed row would throw during render.
 */
export async function fetchStandingTriggers(): Promise<StandingTrigger[]> {
  const body = await studioRead<{ triggers?: unknown }>('/api/triggers');
  return parseStandingTriggers(body.triggers);
}

/**
 * Fetch all projects. Every other field is carried through as the wire sent
 * it (an existing cast, unchanged); `provenance` (forge-3oq) and
 * `configHealth` (W8-C3) are the TWO fields REAL-parsed at this boundary
 * rather than cast — an absent/garbage wire value must normalise to the
 * honest `'unknown'` in both cases, never pass through raw, never default to
 * `'operator'`, and never default to `'ok'`.
 */
export async function fetchStudioProjects(): Promise<Project[]> {
  const body = await studioRead<{ projects?: unknown[] }>('/api/studio/projects');
  return (body.projects ?? []).map((raw) => ({
    ...(raw as Project),
    provenance: parseProvenance((raw as Record<string, unknown> | null)?.['provenance']),
    // W8-C3: the SECOND field real-parsed at this boundary rather than cast —
    // an absent/garbage verdict must normalise to the honest `'unknown'`,
    // never pass through raw and never default to `'ok'`.
    configHealth: parseProjectConfigHealth((raw as Record<string, unknown> | null)?.['configHealth']),
    // W8-C3: parsed, not cast. A non-array or an array with non-string
    // elements must not reach the picker — a `{}` in a skill-id slot renders
    // as `[object Object]` and binds nothing.
    localSkills: parseSkillIdList((raw as Record<string, unknown> | null)?.['localSkills']),
  }));
}

/**
 * Fetch all knowledge bases. Every other field is carried through as the
 * wire sent it (an existing cast, unchanged); `provenance` and `lint`
 * (forge-3oq/forge-2am) are REAL-parsed at this boundary rather than cast —
 * an absent/garbage `provenance` normalises to `'unknown'`, an absent/
 * malformed `lint` normalises to `null` — never a fabricated
 * `{errors:0,flags:0}` "clean" verdict.
 */
export async function fetchStudioKbs(): Promise<Kb[]> {
  const body = await studioRead<{ kbs?: unknown[] }>('/api/studio/kbs');
  return (body.kbs ?? []).map((raw) => ({
    ...(raw as Kb),
    provenance: parseProvenance((raw as Record<string, unknown> | null)?.['provenance']),
    lint: parseKbLintSummary((raw as Record<string, unknown> | null)?.['lint']),
  }));
}

/**
 * W6-B11 — one row of the aggregate `GET /api/studio/sessions` index. Mirrors
 * `cli/ui-bridge.ts`'s `SessionIndexRow` wire shape verbatim (server-sourced,
 * never re-derived client-side): `terminal`/`needsYou` are the bridge's own
 * `isTerminalPhase`/`deriveSessionAffordances` derivations, threaded through
 * as-is so the client never re-implements either vocabulary.
 */
export type SessionIndexRow = {
  kind: string;
  sessionId: string;
  project: string;
  phase: string;
  terminal: boolean;
  /** W7-A2 — the bridge's TRUTHFUL lifecycle verdict (operator gate open,
   *  or crashed/stalled) — never re-derived client-side. */
  needsYou: boolean;
  /** W7-A2 — `cli/bridge-studio-lifecycle.ts`'s derived state (mirrored in
   *  `lib/session-lifecycle-client.ts`'s SESSION_LIFECYCLE_STATES). */
  state: 'working' | 'awaiting-operator' | 'crashed' | 'stalled' | 'terminal';
  /** W7-A2 — the runner's crash message for a `crashed` row, else null. */
  error: string | null;
  /** W7-A2 — ms since the last on-disk sign of life, or null (no log dir). */
  idleMs: number | null;
  modelTier: string | null;
  updatedAt: string;
  href: string;
};

/**
 * Fetch the aggregate in-flight sessions index (W6-B11) — every registered
 * session kind, across every project, flattened by the bridge's
 * `collectStudioSessionIndexRows` + `sortAndCapSessionIndexRows`
 * (needs-you-first, then newest). `activeOnly` (default `true`, the shape
 * every current caller — the /sessions page, Home's active-sessions strip —
 * wants: operator-locked, in-flight sessions ONLY, never terminal history)
 * maps onto the bridge's `?active=1` query param; pass `false` for the rare
 * caller that genuinely wants terminal rows included too. Same read
 * discipline as every other `fetchStudio*` read here (W7-A1): a bridge that
 * is unreachable or refuses THROWS `BridgeReadError` — /sessions and Home
 * render the shared failure state, never "No sessions in flight"
 * (home-sessions-29/-30).
 */
export async function fetchStudioSessions(activeOnly: boolean = true): Promise<SessionIndexRow[]> {
  const path = activeOnly ? '/api/studio/sessions?active=1' : '/api/studio/sessions';
  const body = await studioRead<{ sessions?: SessionIndexRow[] }>(path);
  return body.sessions ?? [];
}

/**
 * Fetch a single KB with its graph and health. Returns null if not found.
 *
 * `body.kb` arrives via `studioReadOr404`'s unchecked `as T` cast (same as every
 * other wire boundary in this module) — `provenance` and `lint` are
 * REAL-parsed here through the same `parseProvenance`/`parseKbLintSummary`
 * helpers `fetchStudioKbs` uses (forge-3oq review), so a detail-fetched KB
 * can never carry a garbage or absent wire value straight through despite
 * `Kb.provenance`/`Kb.lint` being declared REQUIRED.
 */
export async function fetchKb(id: string): Promise<KbDetail | null> {
  const body = await studioReadOr404<{ kb?: Kb; graph?: KbGraph; health?: KbHealth }>(
    `/api/studio/kbs/${encodeURIComponent(id)}`,
  );
  if (!body?.kb || !body.graph || !body.health) return null;
  const rawKb = body.kb as unknown as Record<string, unknown>;
  const kb: Kb = {
    ...body.kb,
    provenance: parseProvenance(rawKb['provenance']),
    lint: parseKbLintSummary(rawKb['lint']),
  };
  return { kb, graph: body.graph, health: body.health };
}

/** Fetch a single KB node article. Returns null if not found. */
export async function fetchKbNode(id: string, nodeId: string): Promise<KbNodeArticle | null> {
  const body = await studioReadOr404<{ node?: KbNodeArticle }>(
    `/api/studio/kbs/${encodeURIComponent(id)}/nodes/${encodeURIComponent(nodeId)}`,
  );
  return body?.node ?? null;
}

/** R6-08 WI-2 — one real `reflect.kb-ingest` event, read-only. */
export type KbIngestEvent = {
  kb: string;
  freshThemes: number;
  impl: string;
  cycleId: string;
};

/** Fetch a KB's read-only ingest-activity feed (R6-08 WI-2). GET-only — this
 *  never triggers an ingest; it only lists past `reflect.kb-ingest` events. */
export async function fetchKbIngestActivity(id: string): Promise<KbIngestEvent[]> {
  const body = await studioRead<{ events?: KbIngestEvent[] }>(
    `/api/studio/kbs/${encodeURIComponent(id)}/ingest-activity`,
  );
  return body.events ?? [];
}

/** Fetch the studio catalog. */
export async function fetchStudioCatalog(): Promise<Catalog> {
  const body = await studioRead<{ catalog?: Catalog }>('/api/studio/catalog');
  return body.catalog ?? {};
}

/** Save (PUT) an agent definition by slug. The FAILURE path carries the
 *  bridge's validation `findings` too (W7-B4 — same rule as saveFlow). */
export async function saveAgent(
  slug: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string; findings?: unknown[] }> {
  const r = await studioPut(`/api/studio/agents/${encodeURIComponent(slug)}`, body);
  if (!r.ok) {
    return {
      ok: false,
      error: r.error,
      ...(Array.isArray(r.data?.findings) ? { findings: r.data!.findings as unknown[] } : {}),
    };
  }
  return { ok: true, findings: Array.isArray(r.data?.findings) ? r.data!.findings : [] };
}

/** W7-B4 (agents-09) — delete an agent. The bridge refuses (409, naming the
 *  referrers) while a flow node or session-kind descriptor still uses it. */
export async function deleteAgent(slug: string): Promise<{ ok: boolean; error?: string }> {
  const r = await studioDelete(`/api/studio/agents/${encodeURIComponent(slug)}`);
  return { ok: r.ok, error: r.error };
}

/** Save (PUT) a project's config fields. */
export async function saveProject(
  id: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string; demoDesignNeeded?: boolean }> {
  const r = await studioPut(`/api/studio/projects/${encodeURIComponent(id)}`, body);
  return {
    ok: r.ok,
    error: r.error,
    // F5: set when demoProcess was saved — the demo-design skill should be run.
    demoDesignNeeded: r.data?.demoDesignNeeded === true,
  };
}

/** Author a plain composable skill (P2): writes skills/<slug>/SKILL.md. */
export async function createSkill(
  body: { name: string; description: string; body?: string },
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const r = await studioPost('/api/studio/skills', body);
  return { ok: r.ok, id: typeof r.data?.id === 'string' ? r.data.id : undefined, error: r.error };
}

/** Reattach discovery for a KB's most recent `op:'consolidate'` run (W6-B14):
 *  `GET /api/studio/kbs/:id/consolidate/active`. A consolidate runId is
 *  minted server-side (`\`${kbId}-consolidate-<stamp>\``) and its terminal
 *  state already lives on disk (`_logs/_brainfix-<runId>/events.jsonl`,
 *  `readBrainFixState` — the SAME reader {@link getAgentFixStatus}'s route
 *  uses); this is the one piece that was missing: a way to REDISCOVER that
 *  runId after a client forgot it (nav-away, reload). `runId: null` means
 *  this kb has never consolidated. The returned `state`/`cleared` are the
 *  SAME shape `getAgentFixStatus` returns, so the caller feeds this
 *  straight into {@link pollAgentFix} to resume live polling. */
export async function fetchActiveOrLatestConsolidate(
  kbId: string,
): Promise<{ ok: boolean; runId: string | null; state: AgentFixStatus['state'] | null; cleared: boolean; error?: string }> {
  const r = await studioGet<{ ok?: boolean; runId?: string | null; state?: AgentFixStatus['state'] | null; cleared?: boolean }>(
    `/api/studio/kbs/${encodeURIComponent(kbId)}/consolidate/active`,
  );
  if (!r.ok) return { ok: false, runId: null, state: null, cleared: false, error: r.error };
  return {
    ok: r.data.ok !== false,
    runId: r.data.runId ?? null,
    state: r.data.state ?? null,
    cleared: r.data.cleared === true,
  };
}

/** Run a manual brain-maintenance op on a KB (K3): 'lint', 'index', or
 *  'consolidate' (R1-06 WI-3 — drains the FULL agent-tier finding set as one
 *  async session; dispatched the same way as 'index'/'lint', but its `data`
 *  carries a `runId` pollable via the existing `getAgentFixStatus` helper
 *  below, which already targets the shared GET .../fix-agent/:runId route). */
export async function runKbMaintenance(
  id: string,
  op: 'lint' | 'index' | 'consolidate',
): Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> }> {
  const r = await studioPost(`/api/studio/kbs/${encodeURIComponent(id)}/maintenance`, { op });
  return { ok: r.ok, error: r.error, data: r.data };
}

// --- Per-finding agent fix turn (W6-B13: the ONE surviving piece of the old
// LintResolutionPanel — dispatching one agent turn for a USER-tier finding,
// the operator decision the drain-to-green loop itself never makes). ---

export type ResolutionCounts = { auto: number; agent: number; user: number };

/** Dispatch ONE agent-tier fix turn. `fixHint` carries the operator's decision
 *  for a user-tier finding (else the finding's own default hint). */
export async function dispatchAgentFix(
  id: string,
  finding: { file: string; check: string; kind: string; fixHint?: string; message?: string },
): Promise<{ ok: boolean; error?: string; runId?: string }> {
  const r = await studioPost(`/api/studio/kbs/${encodeURIComponent(id)}/maintenance`, {
    op: 'fix-agent',
    file: finding.file,
    check: finding.check,
    kind: finding.kind,
    fixHint: finding.fixHint,
    message: finding.message ?? '',
  });
  // W7-B4: a failed dispatch never hands back a runId to trust (studioSend
  // now carries failure bodies for callers that need them — this per-function
  // guard preserves the old transport-level drop for run ids).
  return { ok: r.ok, error: r.error, runId: r.ok && typeof r.data?.runId === 'string' ? r.data.runId : undefined };
}

/** W7-FIX-A1 (A1-10): `'unknown'` is BOTH the bridge's own honest "no state
 *  recorded" (`ok:true`) AND the failed-read shape (`ok:false` + `error`, the
 *  bridge's text verbatim / "bridge unreachable (…)") — never a fabricated
 *  `'running'`. `agent-dispatch.ts`'s poll wrappers keep watching on `ok:false`
 *  (bounded), so a blip is a visible read failure, not a stopped run. */
export type AgentFixStatus = {
  ok: boolean;
  state: 'running' | 'cleared' | 'not-cleared' | 'failed' | 'unknown';
  cleared: boolean;
  /** Present only for a `consolidate` run's terminal status — the bridge's
   *  `readBrainFixState` threads them through from the terminal event's own
   *  metadata (W8-F1 / knowledge-42). A per-finding `fix-agent` run never
   *  writes these, so they stay genuinely absent for it — never fabricated. */
  total?: number;
  clearedCount?: number;
  /** Present only on a failed read (`ok:false`). */
  error?: string;
  /** On a failed read: the HTTP status iff the bridge ANSWERED (a 404 "no
   *  such run" is a definitive answer, not a blip); absent = transport. */
  status?: number;
};

function parseAgentFixStatus(r: BridgeReadResult<{ state?: string; cleared?: boolean; total?: number; clearedCount?: number }>): AgentFixStatus {
  if (!r.ok) return { ok: false, state: 'unknown', cleared: false, error: r.error, ...(r.status !== undefined ? { status: r.status } : {}) };
  return {
    ok: true,
    state: (r.data.state as AgentFixStatus['state']) ?? 'unknown',
    cleared: r.data.cleared === true,
    ...(typeof r.data.total === 'number' ? { total: r.data.total } : {}),
    ...(typeof r.data.clearedCount === 'number' ? { clearedCount: r.data.clearedCount } : {}),
  };
}

/** Poll a dispatched agent-fix run's state (status-shaped: never throws;
 *  a failed read is `{ok:false, state:'unknown', error}`). */
export async function getAgentFixStatus(id: string, runId: string): Promise<AgentFixStatus> {
  return parseAgentFixStatus(await studioGet<{ state?: string; cleared?: boolean; total?: number; clearedCount?: number }>(
    `/api/studio/kbs/${encodeURIComponent(id)}/fix-agent/${encodeURIComponent(runId)}`,
  ));
}

// --- KB drain-to-green (W6-B13) ---------------------------------------------
//
// Client for the W6-B12 bridge job (`cli/bridge-studio-kb-drain.ts`): ONE
// button drives every auto+agent lint finding on a KB to a fixed point,
// server-side, surviving nav-away by construction (the run's own progress
// lives in `_logs/_kb-drain-<runId>/status.json`, not client state — this
// module is a pure OBSERVER: dispatch, then read back what the server
// already decided). Mirrors `KbDrainStatus`/`KbDrainState`/`KbDrainPerFinding`
// from `cli/bridge-studio-kb-drain.ts` verbatim (re-declared client-side per
// this file's own header convention — no Node import across the forge-ui
// boundary).

export type KbDrainState =
  | 'running'
  | 'green'
  | 'needs-you'
  | 'no-progress'
  | 'round-cap'
  | 'cost-ceiling'
  | 'cancelled'
  | 'failed';

/** W8-B2 (ON-3) — mirrors `cli/bridge-studio-kb-drain.ts`'s type of the same
 *  name: what the fix turn proposed for one file, and what became of it. */
export type KbDrainProposedChange = {
  /** Path relative to forgeRoot. */
  file: string;
  /** Unified diff of the proposal. */
  diff: string;
  /** True when `diff` was cut at the server's line cap. */
  diffTruncated?: boolean;
  disposition: 'applied' | 'repaired' | 'refused' | 'drafted';
  /** The soundness audit's reasons, verbatim. Empty for `applied`. */
  reasons?: string[];
};

export type KbDrainPerFinding = {
  key: string;
  check: string;
  kind: string;
  file: string;
  message: string;
  tier: 'auto' | 'agent' | 'user';
  /** W8-B2 — `pending` is the honest in-flight value: the turn ran and the
   *  round's post-fix lint (the sole authority on whether a finding cleared)
   *  has not. Every terminal value is derived there, never self-reported. */
  outcome: 'cleared' | 'not-cleared' | 'needs-you' | 'pending';
  /** W7-B2 (knowledge-12) — which round recorded this entry. Optional:
   *  pre-W7 status files don't carry it. */
  round?: number;
  /** W7-B2 (orch-01) — set when the fix was gated into a kb-cleanup draft. */
  draftSession?: { id: string; project: string };
  /** W8-B2 — the fix turn threw. Separate from `outcome` by construction. */
  turnError?: string;
  /** W8-B2 (ON-3) — every file the turn proposed to change, with its diff. */
  proposedChanges?: KbDrainProposedChange[];
  /** W8-B2 (ON-3) — the targeted instruction the fix turn was given. */
  fixHint?: string;
};

export type KbDrainStatus = {
  ok: boolean;
  runId: string | null;
  state: KbDrainState;
  round: number;
  counts: ResolutionCounts;
  perFinding: KbDrainPerFinding[];
  costUsd: number;
  updatedAt: string;
  kbId?: string;
  error?: string;
  /** W7-B2 (knowledge-14) — elapsed ticker + real budget display. Optional:
   *  pre-W7 status files don't carry them. */
  startedAt?: string;
  maxRounds?: number;
  maxCostUsd?: number;
  /** HTTP status of a FAILED read — CLIENT-ONLY (set by
   *  {@link failedKbDrainStatus}; never present in a server-written
   *  status.json). The drain vocab has no 'unknown' token, so a failed read
   *  fabricates `state:'running'`; this field is how `pollKbDrain` and the
   *  panel's display derivation tell a bridge-ANSWERED 4xx (a terminal fact
   *  — "unknown drain run") apart from a transport blip / 5xx (transient,
   *  keep watching). Mirrors `isStillWatching`'s A1-10 rule. */
  status?: number;
};

/** W7-A1: the failed-read shape for a drain-status poll — `ok:false` plus the
 *  bridge's OWN error text (a 404's "unknown drain run", a transport failure's
 *  "bridge unreachable (…)") — never a fabricated terminal state, and never a
 *  neutral string when the server said something specific. */
function failedKbDrainStatus(runId: string | null, error: string, status?: number): KbDrainStatus {
  return {
    ok: false, runId, state: 'running', round: 0,
    counts: { auto: 0, agent: 0, user: 0 }, perFinding: [], costUsd: 0,
    updatedAt: new Date(0).toISOString(), error,
    ...(status !== undefined ? { status } : {}),
  };
}

/** Dispatch a drain-to-green run: `POST /api/studio/kbs/:id/drain`. A 409
 *  (a run is already active for this kb) surfaces as `{ok:false, error}` —
 *  the failure path NEVER hands back a `runId` to trust (W7-B4: `studioSend`
 *  now carries failure BODIES for callers that need them, e.g. saveFlow's
 *  findings, so this per-function guard replaces the old transport-level
 *  drop), so a caller that hits this must recover the ACTUAL active run via
 *  {@link fetchActiveOrLatestKbDrain} rather than trust anything parsed off
 *  this call's own error path. */
export async function dispatchKbDrain(id: string): Promise<{ ok: boolean; error?: string; runId?: string }> {
  const r = await studioPost(`/api/studio/kbs/${encodeURIComponent(id)}/drain`, {});
  return { ok: r.ok, error: r.error, runId: r.ok && typeof r.data?.runId === 'string' ? r.data.runId : undefined };
}

/** Poll one specific drain run's status: `GET /api/studio/kbs/:id/drain/:runId`. */
export async function fetchKbDrainRun(id: string, runId: string): Promise<KbDrainStatus> {
  const r = await studioGet<KbDrainStatus>(
    `/api/studio/kbs/${encodeURIComponent(id)}/drain/${encodeURIComponent(runId)}`,
  );
  return r.ok ? r.data : failedKbDrainStatus(runId, r.error, r.status);
}

/** Reattach to the active-or-latest drain run for a kb:
 *  `GET /api/studio/kbs/:id/drain` — `runId: null` when none has ever run.
 *  This is what makes nav-away-and-back a true reattach: the panel calls
 *  this on mount instead of assuming a fresh, run-less state. */
export async function fetchActiveOrLatestKbDrain(id: string): Promise<KbDrainStatus> {
  const r = await studioGet<KbDrainStatus>(
    `/api/studio/kbs/${encodeURIComponent(id)}/drain`,
  );
  return r.ok ? r.data : failedKbDrainStatus(null, r.error, r.status);
}

/** W7-B2 (knowledge-14): cancel the ACTIVE drain run for a kb.
 *  `mode:'requested'` = a live loop will honor the flag between turns;
 *  `mode:'forced'` = the run was dead (no heartbeat) and was terminated
 *  directly. A 409 (`ok:false`) = nothing active to cancel. */
export async function cancelKbDrain(id: string): Promise<{ ok: boolean; error?: string; runId?: string; mode?: 'requested' | 'forced' }> {
  const r = await studioPost(`/api/studio/kbs/${encodeURIComponent(id)}/drain/cancel`, {});
  return {
    ok: r.ok,
    error: r.error,
    runId: typeof r.data?.runId === 'string' ? r.data.runId : undefined,
    mode: r.data?.mode === 'forced' || r.data?.mode === 'requested' ? r.data.mode : undefined,
  };
}

/** W7-B2 (knowledge-05): the per-KB active-job fact the action group gates
 *  on — the SAME derivation every mutating KB route 409s with. Status-shaped
 *  (never throws): a failed read is `{ok:false, job:null, error}`. */
export type KbActiveJob = { kind: 'drain' | 'consolidate'; runId: string } | null;

export async function fetchKbActiveJob(id: string): Promise<{ ok: boolean; job: KbActiveJob; reason?: string; error?: string }> {
  const r = await studioGet<{ job: KbActiveJob; reason?: string }>(`/api/studio/kbs/${encodeURIComponent(id)}/active-job`);
  if (!r.ok) return { ok: false, job: null, error: r.error };
  return { ok: true, job: r.data.job ?? null, reason: r.data.reason };
}

/** W7-B2 (knowledge-20): every drain / consolidate / kb-cleanup run recorded
 *  for one KB — the RecentRuns widget's data source. */
export type KbRunRow = {
  kind: 'drain' | 'consolidate' | 'cleanup';
  id: string;
  when: string;
  status: string;
  costUsd: number | null;
  detail: string | null;
  project?: string;
};

export async function fetchKbRuns(id: string): Promise<{ ok: boolean; runs: KbRunRow[]; error?: string; status?: number }> {
  const r = await studioGet<{ runs: KbRunRow[] }>(`/api/studio/kbs/${encodeURIComponent(id)}/runs`);
  if (!r.ok) return { ok: false, runs: [], error: r.error, ...(r.status !== undefined ? { status: r.status } : {}) };
  return { ok: true, runs: Array.isArray(r.data.runs) ? r.data.runs : [] };
}

/** Parse the RunPanel inputs textarea — one `key: value` per line — into the
 *  flat inputs map the generic run host accepts (R2-01-F3 / R4-02-F1). Blank
 *  lines are ignored; the FIRST ':' splits key from value, so a value may itself
 *  contain ':' (e.g. a `repo: https://…` URL). Exported for unit coverage. */
export function parseRunInputs(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const eq = t.indexOf(':');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    const value = t.slice(eq + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

/** One agent-kickoff upload, base64-encoded (R6-04-F2 WI-1 wire shape:
 *  `POST /api/agents/:slug/run`'s `materials` field — `filename` +
 *  `contentBase64`; the kind is always derived server-side, never
 *  client-supplied). */
export type MaterialUpload = { filename: string; contentBase64: string };

/** Dispatch a non-interactive roster agent standalone (R2-01-F3). Returns the
 *  runId whose events/cost land under `_logs/<runId>/` — poll via
 *  {@link getAgentRunStatus}.
 *
 *  `costCeilingUsd` and `materials` (R6-04 WI-2/WI-1) are optional,
 *  additive fields on the same route — the caller (RunPanel.tsx) is
 *  responsible for having already gated them client-side via
 *  `resolveCostCeilingForDispatch` / `validateMaterialsClientSide`
 *  (./run-panel-view.ts); this function does not re-derive either — the
 *  SERVER remains the authority and re-validates both regardless. */
export async function dispatchAgentRun(
  slug: string,
  opts?: {
    project?: string;
    inputs?: Record<string, string>;
    costCeilingUsd?: number;
    materials?: MaterialUpload[];
  },
): Promise<{ ok: boolean; error?: string; runId?: string }> {
  const r = await studioPost(`/api/agents/${encodeURIComponent(slug)}/run`, {
    ...(opts?.project ? { project: opts.project } : {}),
    ...(opts?.inputs ? { inputs: opts.inputs } : {}),
    ...(opts?.costCeilingUsd !== undefined ? { costCeilingUsd: opts.costCeilingUsd } : {}),
    ...(opts?.materials && opts.materials.length > 0 ? { materials: opts.materials } : {}),
  });
  // W7-B4: a failed dispatch never hands back a runId to trust (see
  // dispatchKbDrain's identical guard).
  return { ok: r.ok, error: r.error, runId: r.ok && typeof r.data?.runId === 'string' ? r.data.runId : undefined };
}

export type AgentRunStatus = {
  ok: boolean;
  /** `'unknown'` with `ok:true` = the bridge answered with no state recorded;
   *  with `ok:false` = the READ failed (`error` carries the bridge's text /
   *  "bridge unreachable (…)") — W7-FIX-A1 A1-10 keeps the two distinct.
   *  W7-B5 adds `'cancelled'` (the sticky operator-cancel terminal) and
   *  `'budget-exceeded'` (the SDK ceiling stop — served by the bridge since
   *  R6-04 but previously collapsed to 'unknown' by this parser's cast).
   *  W8-A2 (ON-7 defect 4) adds `'stalled'` — mirrors `StandaloneRunState
   *  ['state']` (cli/ui-bridge.ts). This field is parsed via an unchecked
   *  `as` cast (`getAgentRunStatus` below), not a runtime allowlist, so a
   *  'stalled' wire value was never REJECTED before this — only mistyped.
   *  `isStillWatching`/`pollDisplayState` (agent-dispatch.ts) already treat
   *  any non-'running' state as "stop watching" via a loose `{state:
   *  string}` parameter, which is the CORRECT behaviour for 'stalled' too
   *  (no fix needed there) — this is a type-honesty fix, not a behaviour
   *  change. */
  state: 'running' | 'done' | 'suppressed' | 'failed' | 'budget-exceeded' | 'cancelled' | 'stalled' | 'unknown';
  costUsd: number;
  events: number;
  /** W7-B5 (agents-19): the run's own recorded failure reason
   *  (`agent-dispatch.failed` metadata.error), verbatim off the wire —
   *  absent when the run never failed. Distinct from `error` (a READ
   *  failure). */
  errorText?: string;
  /** W7-B5 (agents-06): the run's real output references (end event
   *  `output_refs`). */
  outputRefs?: string[];
  /** W7-B5 (agents-31): the ceiling in force, recorded from dispatch time. */
  ceilingUsd?: number;
  /** Present only on a failed read (`ok:false`). */
  error?: string;
  /** On a failed read: the HTTP status iff the bridge ANSWERED (R6-04 D22: a
   *  404 = "never dispatched" is a definitive, terminal answer); absent =
   *  transport failure. */
  status?: number;
};

/** Poll a dispatched generic agent run's state (reads its `_logs/<runId>/`
 *  event log server-side). Status-shaped: never throws; a failed read is
 *  `{ok:false, state:'unknown', error, status?}`. */
export async function getAgentRunStatus(runId: string): Promise<AgentRunStatus> {
  const r = await studioGet<{ state?: string; costUsd?: number; events?: number; errorText?: string; outputRefs?: unknown; ceilingUsd?: number }>(`/api/agents/runs/${encodeURIComponent(runId)}`);
  if (!r.ok) return { ok: false, state: 'unknown', costUsd: 0, events: 0, error: r.error, ...(r.status !== undefined ? { status: r.status } : {}) };
  return {
    ok: true,
    state: (r.data.state as AgentRunStatus['state']) ?? 'unknown',
    costUsd: typeof r.data.costUsd === 'number' ? r.data.costUsd : 0,
    events: typeof r.data.events === 'number' ? r.data.events : 0,
    ...(typeof r.data.errorText === 'string' && r.data.errorText.length > 0 ? { errorText: r.data.errorText } : {}),
    ...(Array.isArray(r.data.outputRefs)
      ? { outputRefs: (r.data.outputRefs as unknown[]).filter((x): x is string => typeof x === 'string') }
      : {}),
    ...(typeof r.data.ceilingUsd === 'number' ? { ceilingUsd: r.data.ceilingUsd } : {}),
  };
}

/** W7-B5 (agents-30): cancel a dispatched standalone run —
 *  `POST /api/agents/runs/:runId/cancel`. 409 (already terminal) and 404
 *  surface as `{ok:false, error}` with the bridge's own text. */
export async function cancelAgentRun(runId: string): Promise<{ ok: boolean; killed?: boolean; error?: string }> {
  const r = await studioPost(`/api/agents/runs/${encodeURIComponent(runId)}/cancel`, {});
  return {
    ok: r.ok,
    ...(typeof r.data?.killed === 'boolean' ? { killed: r.data.killed as boolean } : {}),
    ...(r.error !== undefined ? { error: r.error } : {}),
  };
}

/** One row of `GET /api/agents/runs/recent` (W7-B5, agents-03/04/39) — the
 *  server-side aggregate: run-level status/cost plus the participating
 *  agent slug(s) per row. */
export type RecentAgentRunWireRow = {
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

/** Fetch the aggregate recent-runs rows — ONE bounded request replacing the
 *  old one-history-fetch-per-roster-agent fan-out (agents-39: 1.33 MB / 13
 *  requests to render 20 rows). THROWS on a failed read (fail-closed, A1). */
export async function fetchRecentAgentRunsAggregate(
  limit?: number,
  kind?: 'flow' | 'standalone' | 'all',
): Promise<RecentAgentRunWireRow[]> {
  const params = new URLSearchParams();
  if (limit !== undefined) params.set('limit', String(limit));
  // Review round 1: a caller that already holds one half of the ledger asks
  // for the other half, so the bound is not spent on rows it will discard.
  if (kind !== undefined && kind !== 'all') params.set('kind', kind);
  const qs = params.toString() === '' ? '' : `?${params.toString()}`;
  const body = await studioRead<{ ok?: boolean; rows?: unknown }>(`/api/agents/runs/recent${qs}`);
  const rows = Array.isArray(body.rows) ? (body.rows as Record<string, unknown>[]) : [];
  return rows
    .filter((r) => typeof r['id'] === 'string' && typeof r['href'] === 'string')
    .map((r) => ({
      id: r['id'] as string,
      when: typeof r['when'] === 'string' ? (r['when'] as string) : '',
      what: typeof r['what'] === 'string' ? (r['what'] as string) : '',
      agents: Array.isArray(r['agents']) ? (r['agents'] as unknown[]).filter((a): a is string => typeof a === 'string') : [],
      status: typeof r['status'] === 'string' ? (r['status'] as string) : 'unknown',
      costUsd: typeof r['costUsd'] === 'number' ? (r['costUsd'] as number) : null,
      href: r['href'] as string,
      linkKind: r['linkKind'] === 'standalone' ? 'standalone' as const : 'flow' as const,
      ...(typeof r['errorText'] === 'string' ? { errorText: r['errorText'] as string } : {}),
    }));
}

/** One row of `GET /api/agents/:slug/history`'s standalone-dispatch shape —
 *  narrowed to the fields {@link fetchLatestStandaloneRun} actually needs;
 *  the route's full `AgentHistoryRow` union (flow-node/standalone/session,
 *  `cli/ui-bridge.ts`) is server-internal and never re-declared client-side. */
export type StandaloneHistoryRow = { id: string; status: string; when: string };

/** The most recent standalone-dispatch row for `slug` — ANY status
 *  (⚑ W7-B5, agents-26: the reattach used to filter `status === 'running'`,
 *  so a finished/failed run vanished from the panel on reload; the panel now
 *  reattaches to the LAST run regardless and shows its real terminal state
 *  + link, while a still-running row resumes polling exactly as before).
 *  `GET /api/agents/:slug/history` already joins flow-node/standalone/
 *  session execution paths into one ledger (R6-06 WI-1); this reads only
 *  the `linkKind:'standalone'` rows (a bare dispatch from THIS panel, never
 *  a flow-node run) and returns the one with the latest `when`, or `null`
 *  if the agent has never been dispatched standalone. The row's `id` IS the
 *  runId {@link pollAgentRun} needs — no separate lookup. */
export async function fetchLatestStandaloneRun(slug: string): Promise<StandaloneHistoryRow | null> {
  const body = await studioRead<{ ok?: boolean; rows?: Array<Record<string, unknown>> }>(
    `/api/agents/${encodeURIComponent(slug)}/history`,
  );
  const standalone = (body.rows ?? []).filter(
    (r) => r['linkKind'] === 'standalone' && typeof r['id'] === 'string' && typeof r['status'] === 'string',
  );
  if (standalone.length === 0) return null;
  standalone.sort((a, b) => String(b['when'] ?? '').localeCompare(String(a['when'] ?? '')));
  const top = standalone[0];
  return { id: top['id'] as string, status: top['status'] as string, when: String(top['when'] ?? '') };
}

/** Reattach discovery for a project's most recent onboarding-agent dispatch
 *  (W6-B14): `GET /api/studio/projects/:id/onboarding/active`. The
 *  onboarding session's OWN `status.json` (written by `POST /api/studio/
 *  onboarding/start`, then updated to a terminal phase by
 *  `writeSessionTerminalPhase`, cli/agent-run.ts) already carries the
 *  `runId` pollable via {@link getAgentRunStatus} — this finds the most
 *  recent `_onboarding/<sessionId>` for the project and reads it back.
 *  `sessionId: null` means this project has never run onboarding. */
export async function fetchActiveOnboarding(
  projectId: string,
): Promise<{ ok: boolean; sessionId: string | null; runId: string | null; phase: string | null; error?: string }> {
  const r = await studioGet<{ ok?: boolean; sessionId?: string | null; runId?: string | null; phase?: string | null }>(
    `/api/studio/projects/${encodeURIComponent(projectId)}/onboarding/active`,
  );
  if (!r.ok) return { ok: false, sessionId: null, runId: null, phase: null, error: r.error };
  return {
    ok: r.data.ok !== false,
    sessionId: r.data.sessionId ?? null,
    runId: r.data.runId ?? null,
    phase: r.data.phase ?? null,
  };
}

/**
 * Kick off the onboarding session (R4-17): `POST /api/studio/onboarding/start`
 * `{project, inputs?}` → `{ok, sessionId, runId, project}`. D6: spawns the
 * IDENTICAL `spawnAgentDispatch(...)` the generic {@link dispatchAgentRun}
 * hits, so `runId` remains pollable via {@link getAgentRunStatus} exactly as
 * before — the only difference is a real, staged session dir (`sessionId`)
 * the operator can follow at `/sessions/onboarding/<sessionId>`.
 */
export async function startOnboardingSession(
  project: string,
  inputs?: Record<string, string>,
): Promise<{ ok: boolean; error?: string; sessionId?: string; runId?: string; project?: string }> {
  const r = await studioPost('/api/studio/onboarding/start', {
    project,
    ...(inputs ? { inputs } : {}),
  });
  const data = r.data;
  return {
    ok: r.ok,
    error: r.error,
    sessionId: typeof data?.sessionId === 'string' ? data.sessionId : undefined,
    runId: typeof data?.runId === 'string' ? data.runId : undefined,
    project: typeof data?.project === 'string' ? data.project : undefined,
  };
}

/** A preflight clause the onboarded project still fails (surfaced to the UI). */
export type FailingClause = { id: string; title: string; detail: string };

/**
 * Onboard (create) a new project: scaffolds `.forge/project.json` + the C4
 * contract artifacts (roadmap.md + brain/profile.md stubs), git-inits if
 * needed, then preflights. Surfaces `ready` (every hard clause green),
 * `scaffolded` (relative paths the server created), and `failingClauses` (the
 * hard clauses still red) so the form can either celebrate or hand off to the
 * forge-onboard-project skill.
 */
export async function createProject(
  body: Record<string, unknown>,
): Promise<{
  ok: boolean;
  id?: string;
  error?: string;
  ready?: boolean;
  scaffolded?: string[];
  failingClauses?: FailingClause[];
}> {
  const r = await studioPost('/api/studio/projects', body);
  const data = r.data;
  return {
    ok: r.ok,
    id: typeof data?.id === 'string' ? data.id : undefined,
    error: r.error,
    ready: typeof data?.ready === 'boolean' ? data.ready : undefined,
    scaffolded: Array.isArray(data?.scaffolded) ? (data.scaffolded as string[]) : undefined,
    failingClauses: Array.isArray(data?.failingClauses) ? (data.failingClauses as FailingClause[]) : undefined,
  };
}

/** The curated greenfield app-type templates (R4-03). */
export async function fetchProjectStarters(): Promise<string[]> {
  const data = await studioRead<{ appTypes?: string[] }>('/api/studio/projects/starters');
  return Array.isArray(data.appTypes) ? data.appTypes : [];
}

/** Create a greenfield project from a framework template (R4-03). */
export async function createGreenfieldProject(input: {
  name: string;
  appType: string;
  language?: string;
  northStar: string;
  architecture?: string;
}): Promise<{ ok: boolean; error?: string; id?: string; ready?: boolean; failingClauses?: FailingClause[] }> {
  const r = await studioPost('/api/studio/projects/create', input);
  const data = r.data;
  return {
    ok: r.ok,
    error: r.error,
    id: typeof data?.id === 'string' ? data.id : undefined,
    ready: data?.ready === true,
    failingClauses: Array.isArray(data?.failingClauses) ? (data.failingClauses as FailingClause[]) : undefined,
  };
}

/**
 * Fetch a single flow definition by id. `provenance` is REAL-parsed through
 * the same `parseProvenance` helper `fetchStudioFlows` uses (forge-3oq
 * review) rather than cast straight through — matches the fix at `fetchKb`.
 */
export async function fetchFlow(id: string): Promise<Flow | null> {
  const body = await studioReadOr404<{ flow?: Flow }>(
    `/api/studio/flows/${encodeURIComponent(id)}`,
  );
  if (!body?.flow) return null;
  return {
    ...body.flow,
    provenance: parseProvenance((body.flow as unknown as Record<string, unknown>)['provenance']),
  };
}

/** Save (PUT) a flow definition by id. Bumps version server-side (a no-op
 *  save is answered `noop: true` and bumps nothing). W7-B4 (flows-10): the
 *  FAILURE path carries the bridge's per-node validation `findings` — the
 *  client used to throw them away, leaving only the words "validation
 *  failed". Pass `create: true` in the body for the /flows/new path so a
 *  duplicate id 409s instead of silently overwriting (flows-13). */
export async function saveFlow(
  id: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; version?: number; error?: string; findings?: unknown[] }> {
  const r = await studioPut(`/api/studio/flows/${encodeURIComponent(id)}`, body);
  if (!r.ok) {
    return {
      ok: false,
      error: r.error,
      ...(Array.isArray(r.data?.findings) ? { findings: r.data!.findings as unknown[] } : {}),
    };
  }
  return {
    ok: true,
    version: typeof r.data?.version === 'number' ? (r.data.version as number) : undefined,
    findings: Array.isArray(r.data?.findings) ? (r.data!.findings as unknown[]) : [],
  };
}

/** W7-B4 (flows-11) — delete an authored flow. The bridge refuses a shipped
 *  seed (403) and an in-flight flow (423). */
export async function deleteFlow(id: string): Promise<{ ok: boolean; error?: string }> {
  const r = await studioDelete(`/api/studio/flows/${encodeURIComponent(id)}`);
  return { ok: r.ok, error: r.error };
}

export type ClauseResolution = 'auto' | 'agent' | 'user';
export type ClauseRoute = 'instructions' | 'demo-builder' | 'brain-fix' | 'preflight-fix';

export type PreflightClause = {
  id: string;
  title: string;
  hard: boolean;
  pass: boolean;
  detail: string;
  /** Stage D — resolution tier + (agent-tier) route + hint, from the server classifier. */
  resolution?: ClauseResolution;
  route?: ClauseRoute;
  fixHint?: string;
};

export type PreflightResult = {
  clauses: PreflightClause[];
  ready: boolean;
};

export async function fetchPreflight(projectId: string): Promise<PreflightResult | null> {
  return studioReadOr404<PreflightResult>(
    `/api/studio/projects/${encodeURIComponent(projectId)}/preflight`,
  );
}

/**
 * R4-12-F1 — fetch a project's five-stage contract-buildout presence report
 * (`GET /api/studio/projects/:id/contract-stages`, a pure read served by
 * cli/bridge-studio.ts from cli/contract-stages.ts's `deriveContractStages`).
 * The 200 body is `{ok, project, stages, sourcesScanned}`; the rows are
 * validated at THIS boundary via session-client's `parseContractStageRow` —
 * the SAME parser + row type the session-shell's contract-buildout artifact
 * uses, never a re-derived client mirror. W7-A1 (crosscut-12 / projects-03):
 * exactly ONE GET is issued and any failure THROWS `BridgeReadError` carrying
 * the bridge's own text — a 409 "project-config: … migrate: …" reaches the
 * operator instead of collapsing into an empty checklist.
 */
export async function fetchContractStages(id: string): Promise<ContractStageRow[]> {
  const body = await studioRead<{ stages?: unknown[] }>(
    `/api/studio/projects/${encodeURIComponent(id)}/contract-stages`,
  );
  return (body.stages ?? []).map((row, i) => parseContractStageRow(row, i));
}

// --- R1-2 — project-repo write transaction (forge-studio branch) ------------

/** Whether the project repo has forge-UI changes accumulated on forge-studio,
 *  pending a merge to main. */
export async function fetchRepoStatus(projectId: string): Promise<{ pending: boolean; branch: string }> {
  return studioRead<{ pending: boolean; branch: string }>(
    `/api/studio/projects/${encodeURIComponent(projectId)}/repo-status`,
  );
}

/** Merge the accumulated forge-studio changes into the project's default branch + push. */
export async function saveProjectRepo(
  projectId: string,
): Promise<{ ok: boolean; merged: boolean; pushed: boolean; detail: string; error?: string }> {
  const r = await studioPost(`/api/studio/projects/${encodeURIComponent(projectId)}/save-repo`, {});
  return {
    ok: r.ok,
    error: r.error,
    merged: r.data?.merged === true,
    pushed: r.data?.pushed === true,
    detail: typeof r.data?.detail === 'string' ? r.data.detail : '',
  };
}

// --- Stage D — preflight resolution -----------------------------------------

/** Apply every deterministic AUTO-tier preflight fix, then return updated clauses. */
export async function preflightFixAuto(
  projectId: string,
): Promise<{ ok: boolean; error?: string; applied: Array<{ clause: string; detail: string; cleared: boolean }>; skipped: Array<{ clause: string; reason: string }>; clauses: PreflightClause[]; ready: boolean }> {
  const r = await studioPost(`/api/studio/projects/${encodeURIComponent(projectId)}/preflight/fix-auto`, {});
  return {
    ok: r.ok,
    error: r.error,
    applied: (r.data?.applied as Array<{ clause: string; detail: string; cleared: boolean }>) ?? [],
    skipped: (r.data?.skipped as Array<{ clause: string; reason: string }>) ?? [],
    clauses: (r.data?.clauses as PreflightClause[]) ?? [],
    ready: r.data?.ready === true,
  };
}

/** Dispatch resolution for one agent/user-tier clause. Agent-tier returns a
 *  `route` (the UI navigates to the builder); user-tier spawns the preflight-fix
 *  agent with the operator's `instruction` and returns a `runId` to poll. */
export async function preflightFixAgent(
  projectId: string,
  body: { clauseId: string; instruction?: string },
): Promise<{ ok: boolean; error?: string; resolution?: ClauseResolution; route?: ClauseRoute; runId?: string }> {
  const r = await studioPost(`/api/studio/projects/${encodeURIComponent(projectId)}/preflight/fix-agent`, body);
  return {
    ok: r.ok,
    error: r.error,
    resolution: r.data?.resolution as ClauseResolution | undefined,
    route: r.data?.route as ClauseRoute | undefined,
    runId: typeof r.data?.runId === 'string' ? r.data.runId : undefined,
  };
}

/** Poll a dispatched preflight-fix (user-tier) run's state — the same
 *  `AgentFixStatus` shape as `getAgentFixStatus` (status-shaped: never
 *  throws; a failed read is `{ok:false, state:'unknown', error}`). */
export async function preflightFixStatus(projectId: string, runId: string): Promise<AgentFixStatus> {
  return parseAgentFixStatus(await studioGet<{ state?: string; cleared?: boolean }>(
    `/api/studio/projects/${encodeURIComponent(projectId)}/preflight/fix-agent/${encodeURIComponent(runId)}`,
  ));
}

/**
 * Pin a human guidance note to a KB.
 *
 * Posts to POST /api/studio/kbs/:id/guidance {text, targetNode?}.
 * On success, the guidance file is written under brain/<kb-id>/_guidance/
 * and will appear as an amber-diamond node in the KB graph on the next fetch.
 * brain-ingest consumes and deletes it on the next ingest pass.
 */
export async function pinGuidance(
  kbId: string,
  text: string,
  targetNode?: string,
): Promise<{ ok: boolean; file?: string; error?: string }> {
  const body: Record<string, unknown> = { text };
  if (targetNode) body['targetNode'] = targetNode;
  const r = await studioPost(`/api/studio/kbs/${encodeURIComponent(kbId)}/guidance`, body);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, file: typeof r.data?.file === 'string' ? (r.data.file as string) : undefined };
}

/**
 * Resolve which KB owns a given node id.
 * Calls GET /api/studio/kbs/resolve-node/:nodeId → { kbId: string }.
 * Returns null if the node is not found or the bridge is offline.
 */
export async function resolveKbNode(nodeId: string): Promise<{ kbId: string } | null> {
  const body = await studioReadOr404<{ kbId?: string }>(
    `/api/studio/kbs/resolve-node/${encodeURIComponent(nodeId)}`,
  );
  if (!body?.kbId) return null;
  return { kbId: body.kbId };
}

/** Create a new KB (scaffold brain/<id>/ + kb.yaml + themes/ + _raw/). */
export async function createKb(body: {
  id: string;
  name: string;
  binding: KbBinding;
  desc: string;
}): Promise<{ ok: boolean; id?: string; error?: string; sessionId?: string; project?: string }> {
  const r = await studioPost('/api/studio/kbs', body);
  if (!r.ok) return { ok: false, error: r.error };
  return {
    ok: true,
    id: typeof r.data?.id === 'string' ? (r.data.id as string) : body.id,
    // W7-B2 (knowledge-23): the seeding session the create spawns — the form
    // TELLS the operator about it instead of silently discarding it.
    sessionId: typeof r.data?.sessionId === 'string' ? (r.data.sessionId as string) : undefined,
    project: typeof r.data?.project === 'string' ? (r.data.project as string) : undefined,
  };
}

/** R4-19-F2: start a kb-cleanup session for KB `id` (`POST .../kbs/:id/
 *  cleanup/start`, cli/ui-bridge.ts). Returns BOTH `sessionId` AND `project`
 *  on success — a non-project-bound KB anchors its session under a
 *  server-minted `.kb-<id>` scratch project (the route's
 *  KB_SEEDING_ANCHOR_PREFIX carve-out), never the KB's own `id`. A caller
 *  that builds the session-page URL from `id` instead of the `project` this
 *  route hands back would navigate every non-project-bound KB's cleanup
 *  session straight to a 404. */
export async function startKbCleanup(
  id: string,
  /** W6-B6 (ADR-043 2026-08-15 amendment §3) — an operator-chosen kickoff
   *  model tier, validated server-side against brain-maintenance's own
   *  SKILL.md-declared envelope (`resolveKickoffModelTier`). Omit for the
   *  spec's spawn-default tier. */
  modelTier?: string,
): Promise<{ ok: true; sessionId: string; project: string } | { ok: false; error: string }> {
  const r = await studioPost(`/api/studio/kbs/${encodeURIComponent(id)}/cleanup/start`, {
    ...(modelTier ? { modelTier } : {}),
  });
  if (!r.ok) return { ok: false, error: r.error ?? 'failed to start kb-cleanup session' };
  const sessionId = r.data?.sessionId;
  const project = r.data?.project;
  if (typeof sessionId !== 'string' || typeof project !== 'string') {
    return { ok: false, error: 'malformed kb-cleanup start response: missing sessionId/project' };
  }
  return { ok: true, sessionId, project };
}

/** Delete a knowledge base (removes its brain/<id>/ dir). The forge-owned core
 *  brains (cycles, forge-dev) are server-guarded against deletion. */
export async function deleteKb(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await bridgeFetch(`/api/studio/kbs/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'x-forge-csrf': '1' },
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    return { ok: data.ok !== false };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// materials + instructions-draft (R2-09 D1/D8/D9)
// ---------------------------------------------------------------------------

/**
 * The closed, frozen materials vocabulary (R2-09 D1-D4). Mirrors
 * orchestrator/studio/materials.ts's `MATERIAL_KINDS` verbatim — forge-ui
 * cannot import orchestrator TS directly (see the `SHIPPED_TRIGGER_KINDS`
 * mirror above for the same hand-kept-mirror convention), so this is the
 * SINGLE named constant every forge-ui consumer of the vocabulary imports;
 * do not re-declare the list anywhere else client-side. Order is
 * significant (surfaced verbatim in the builder's materials toggles and the
 * YAML preview) — keep it in lockstep with the server list if it ever
 * changes.
 */
export const MATERIAL_KINDS = ['images', 'documents', 'audio', 'data-files'] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

/**
 * Parse a raw `materials` field (server AgentDefinition.materials shape,
 * orchestrator/studio/materials.ts) client-side. Mirrors the server parser's
 * D1/D2 semantics exactly: an array of strings — including `[]` — parses
 * as-is (D2: declared-empty is a real, meaningful value, distinct from
 * absence); `undefined`/`null` (the field genuinely absent) parses to
 * `undefined`; any other shape — a non-array, or an array containing a
 * non-string entry — is a parse FAILURE and also returns `undefined`.
 *
 * That last case is deliberately NOT the same `undefined` as "absent" from a
 * caller's perspective in one sense (both collapse to the same return value
 * here, matching `parseCapability`'s "malformed degrades to absent, never
 * throws" convention) but it must never be upgraded into a fabricated `[]` —
 * a prior finding in this campaign was exactly a client turning a malformed/
 * missing field into an invented default, destroying the guarantee D2 gives
 * "declared-empty" its meaning. Never coerces a partial list.
 */
export function parseMaterials(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) return undefined;
  if (!raw.every((v) => typeof v === 'string')) return undefined;
  return raw as string[];
}

/** Self-describing manifest of what an instructions draft was composed from
 *  (orchestrator/studio/instructions-draft.ts `InstructionsDraftDerivation`,
 *  re-declared client-side per this file's header convention). Carried
 *  through verbatim — never re-derived here. */
export type InstructionsDraftDerivation = {
  sources: Array<{ field: string; present: boolean }>;
};

/** Result of POST /api/studio/agents/:slug/instructions-draft (R2-09 D8/D9). */
export type InstructionsDraftResult =
  | { ok: true; draft: string; derivation: InstructionsDraftDerivation }
  | { ok: false; error: string };

/**
 * Pure parse of the instructions-draft response (status + parsed JSON body)
 * into `InstructionsDraftResult`. Mirrors `parseCapability`'s
 * carry-through-or-fail convention: a non-2xx status surfaces the server's
 * `error` (never smoothed into an empty draft), and a malformed 200 payload
 * — missing `draft` or `derivation` — is ALSO an error, never a fabricated
 * empty draft (the exact "declared data must not fail open" failure class
 * this campaign exists to close). Split out from the async fetch wrapper
 * below (`requestInstructionsDraft`) so the parse logic is directly unit-
 * testable without a network mock.
 *
 * 2026-08-05 adversarial-review round 2, finding E/12: `studioPut`/
 * `studioPost` in this same file both respect the response BODY's own `ok`
 * field (`typeof data.ok === 'boolean' ? data.ok : true`) — an explicit
 * `ok:false` in a 2xx body is a real failure signal, not decoration. This
 * function used to ignore `p['ok']` entirely and derive success purely from
 * HTTP status + shape presence, so a 200 body carrying
 * `{ok:false, draft:'x', ...}` was misreported as a successful draft. The
 * body's `ok:false` is now checked BEFORE the shape check, matching the
 * sibling parsers.
 *
 * 2026-08-05 adversarial-review round 3, finding D/7: `derivation` is typed
 * `InstructionsDraftDerivation` ({sources: Array<...>}) but this parser used
 * to only guard `undefined`/`null` before casting `p['derivation'] as
 * InstructionsDraftDerivation` — the SHAPE was never checked, so
 * `derivation: 42` or `{}` sailed through as a "valid" derivation. Fixed by
 * shape-validating: `derivation` must be a plain object carrying a `sources`
 * ARRAY. A malformed `derivation` is now a parse FAILURE, matching
 * `parseMaterials`'s "never fabricate a substitute value" convention — a
 * prior defect in this campaign turned a missing/malformed declared field
 * into an invented default, destroying the exact guarantee the field's
 * presence was supposed to provide. This function does the same for
 * `derivation` that it already does for `draft`: absence or malformation is
 * reported, never silently smoothed into a fabricated `{sources: []}`.
 */
function isValidDerivation(v: unknown): v is InstructionsDraftDerivation {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const d = v as Record<string, unknown>;
  return Array.isArray(d['sources']);
}

export function parseInstructionsDraftResponse(status: number, payload: unknown): InstructionsDraftResult {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (status < 200 || status >= 300) {
    return { ok: false, error: typeof p['error'] === 'string' ? p['error'] : `HTTP ${status}` };
  }
  if (p['ok'] === false) {
    return {
      ok: false,
      error: typeof p['error'] === 'string' ? p['error'] : 'instructions-draft response reported ok:false',
    };
  }
  if (typeof p['draft'] !== 'string' || !isValidDerivation(p['derivation'])) {
    return { ok: false, error: 'malformed instructions-draft response: missing draft or derivation' };
  }
  return { ok: true, draft: p['draft'], derivation: p['derivation'] };
}

/**
 * Request a deterministic instructions draft for the CURRENT (possibly
 * unsaved) builder state — never auto-saved (D9). Thin, untestable-by-design
 * I/O shell around the testable `parseInstructionsDraftResponse` core: this
 * function itself is not directly exercised by studio-client.test.ts (it has
 * no logic of its own beyond resolving the bridge URL and calling fetch —
 * exactly the same shape as `studioPut`/`studioPost` above, which are
 * likewise untested directly).
 */
export async function requestInstructionsDraft(
  slug: string,
  body: Record<string, unknown>,
): Promise<InstructionsDraftResult> {
  try {
    const res = await bridgeFetch(`/api/studio/agents/${encodeURIComponent(slug)}/instructions-draft`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => undefined);
    return parseInstructionsDraftResponse(res.status, data);
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
