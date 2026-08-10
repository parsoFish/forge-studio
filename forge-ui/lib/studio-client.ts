/**
 * Client-side fetch helpers for the Studio bridge routes (M1-2).
 *
 * Mirrors the server-side types from orchestrator/run-model.ts and
 * orchestrator/studio/types.ts — re-declared client-side so they can be
 * imported into 'use client' components without pulling in Node.js modules.
 * Same pattern as EventLogEntry declared in bridge-client.ts.
 *
 * All helpers share the same no-bridge fallback pattern as bridge-client.ts:
 * returns the fallback value when the bridge URL is absent or the fetch fails.
 */

import { Cron } from 'croner';

import { resolveBridgeUrl } from './bridge-client';
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
  status: RunStatus;
  origin: 'architect' | 'human-directed';
  costUsd: number;
  startedAt?: string;
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
  /** 2.10: the merged cycle's reflection was lost (cause) — mirrors orchestrator/run-model.ts. */
  reflectionLost?: string;
  reflectionLostNote?: string;
  workItems?: { id: string; status: RunPhaseStatus; costUsd?: number; task?: string; dependsOn?: string[]; delivered?: { files: number; insertions: number; commits: number } }[];
  /**
   * The seed flows this run traversed (derived from its phases ∩ each flow's nodes).
   * A threaded spine run carries [forge-architect, forge-develop, forge-reflect] so it
   * surfaces under all three flow monitors (each rendering its own slice). A single-flow
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
};

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

export type KbGraph = { nodes: KbNode[]; edges: KbEdge[] };

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
  orphans: number;
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

async function studioGet<T>(path: string, fallback: T): Promise<T> {
  const base = await resolveBridgeUrl();
  if (!base) return fallback;
  try {
    const res = await fetch(`${base}${path}`);
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

async function studioPut(
  path: string,
  body: unknown,
): Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> }> {
  const base = await resolveBridgeUrl();
  if (!base) return { ok: false, error: 'no bridge configured' };
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string } & Record<string, unknown>;
    if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    // A 2xx is success; an explicit `ok: false` overrides. A 2xx that omits `ok`
    // (e.g. the lint maintenance op) is success — not a silent failure.
    return { ok: typeof data.ok === 'boolean' ? data.ok : true, data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function studioPost(
  path: string,
  body: unknown,
): Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> }> {
  const base = await resolveBridgeUrl();
  if (!base) return { ok: false, error: 'no bridge configured' };
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string } & Record<string, unknown>;
    if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    // A 2xx is success; an explicit `ok: false` overrides. A 2xx that omits `ok`
    // (e.g. the lint maintenance op) is success — not a silent failure.
    return { ok: typeof data.ok === 'boolean' ? data.ok : true, data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Fetch all runs (optionally filtered by flowId). */
export async function fetchRuns(flowId?: string): Promise<Run[]> {
  const qs = flowId ? `?flow=${encodeURIComponent(flowId)}` : '';
  const body = await studioGet<{ runs: unknown[] }>(`/api/runs${qs}`, { runs: [] });
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
  const body = await studioGet<{ planned: PlannedInitiative[] }>('/api/runs/planned', { planned: [] });
  return body.planned ?? [];
}

/** Fetch a single run by id. */
export async function fetchRun(id: string): Promise<Run | null> {
  const body = await studioGet<{ run: unknown } | null>(
    `/api/runs/${encodeURIComponent(id)}`,
    null,
  );
  if (!body?.run) return null;
  return parseRun(body.run);
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
  const body = await studioGet<{ lines: PhaseLogLine[] }>(
    `/api/runs/${encodeURIComponent(runId)}/phases/${encodeURIComponent(nodeId)}/log${qs}`,
    { lines: [] },
  );
  return body.lines;
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
    phases:        r.phases        ?? {},
    phaseMeta:     r.phaseMeta     ?? {},
    artifactsReady: r.artifactsReady ?? {},
    gate:          r.gate,
    gateNote:      r.gateNote,
    failedAt:      r.failedAt,
    failNote:      r.failNote,
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
  const body = await studioGet<{ agents: unknown[]; defaultCostCeilingUsd?: unknown }>(
    '/api/studio/agents',
    { agents: [] },
  );
  return {
    agents: (body.agents ?? []).map(parseAgentDefinition),
    defaultCostCeilingUsd: typeof body.defaultCostCeilingUsd === 'number' ? body.defaultCostCeilingUsd : 0,
  };
}

/** Fetch the curated OOTB starter agents (ADR-033) for the New-Agent picker. */
export async function fetchStarters(): Promise<Agent[]> {
  const body = await studioGet<{ starters: unknown[] }>('/api/studio/starters', { starters: [] });
  return (body.starters ?? []).map(parseAgentDefinition);
}

/** Fetch the curated starter flow (plan → dev → review) the New-Flow canvas seeds from. */
export async function fetchStarterFlow(): Promise<Flow | null> {
  const body = await studioGet<{ flow?: Flow | null }>('/api/studio/starters', { flow: null });
  return body.flow ?? null;
}

/** Fetch all flow definitions. */
export async function fetchStudioFlows(): Promise<Flow[]> {
  const body = await studioGet<{ flows: Flow[] }>('/api/studio/flows', { flows: [] });
  return body.flows;
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
 * Shares this module's `studioGet` error convention exactly like
 * `fetchStudioFlows`/`fetchStudioProjects`: no bridge configured, a non-2xx,
 * or a thrown fetch all degrade to the empty fallback instead of rejecting,
 * so one unavailable endpoint can never reject a caller's `Promise.all` and
 * blank the surfaces fed by the sibling fetches.
 *
 * The rows are validated at this boundary (`parseStandingTriggers`) rather
 * than cast, because they are rendered inside the agent page's React tree —
 * an unvalidated malformed row would throw during render.
 */
export async function fetchStandingTriggers(): Promise<StandingTrigger[]> {
  const body = await studioGet<{ triggers?: unknown }>('/api/triggers', { triggers: [] });
  return parseStandingTriggers(body.triggers);
}

/** Fetch all projects. */
export async function fetchStudioProjects(): Promise<Project[]> {
  const body = await studioGet<{ projects: Project[] }>('/api/studio/projects', { projects: [] });
  return body.projects;
}

/** Fetch all knowledge bases. */
export async function fetchStudioKbs(): Promise<Kb[]> {
  const body = await studioGet<{ kbs: Kb[] }>('/api/studio/kbs', { kbs: [] });
  return body.kbs;
}

/** Fetch a single KB with its graph and health. Returns null if not found. */
export async function fetchKb(id: string): Promise<KbDetail | null> {
  const body = await studioGet<{ kb?: Kb; graph?: KbGraph; health?: KbHealth } | null>(
    `/api/studio/kbs/${encodeURIComponent(id)}`,
    null,
  );
  if (!body?.kb || !body.graph || !body.health) return null;
  return { kb: body.kb, graph: body.graph, health: body.health };
}

/** Fetch a single KB node article. Returns null if not found. */
export async function fetchKbNode(id: string, nodeId: string): Promise<KbNodeArticle | null> {
  const body = await studioGet<{ node?: KbNodeArticle } | null>(
    `/api/studio/kbs/${encodeURIComponent(id)}/nodes/${encodeURIComponent(nodeId)}`,
    null,
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
  const body = await studioGet<{ events?: KbIngestEvent[] }>(
    `/api/studio/kbs/${encodeURIComponent(id)}/ingest-activity`,
    { events: [] },
  );
  return body.events ?? [];
}

/** Fetch the studio catalog. */
export async function fetchStudioCatalog(): Promise<Catalog> {
  const body = await studioGet<{ catalog?: Catalog }>('/api/studio/catalog', {});
  return body.catalog ?? {};
}

/** Save (PUT) an agent definition by slug. */
export async function saveAgent(
  slug: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string; findings?: unknown[] }> {
  const r = await studioPut(`/api/studio/agents/${encodeURIComponent(slug)}`, body);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, findings: Array.isArray(r.data?.findings) ? r.data!.findings : [] };
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

// --- Guided lint-resolution (the Knowledge page resolver) ---

export type LintFinding = {
  category: 'error' | 'flag' | 'auto-fix';
  file: string;
  message: string;
  check?: string;
  kind?: string;
  resolution?: 'auto' | 'agent' | 'user';
  fixHint?: string;
};
export type ResolutionCounts = { auto: number; agent: number; user: number };
const ZERO_COUNTS: ResolutionCounts = { auto: 0, agent: 0, user: 0 };

/** Run lint for a kb → classified findings + per-tier counts. */
export async function lintKb(
  id: string,
): Promise<{ ok: boolean; error?: string; findings: LintFinding[]; counts: ResolutionCounts }> {
  const r = await studioPost(`/api/studio/kbs/${encodeURIComponent(id)}/maintenance`, { op: 'lint' });
  return {
    ok: r.ok,
    error: r.error,
    findings: (r.data?.findings as LintFinding[]) ?? [],
    counts: (r.data?.counts as ResolutionCounts) ?? ZERO_COUNTS,
  };
}

/** Apply every deterministic AUTO-tier fix, then re-lint. */
export async function fixAutoKb(
  id: string,
): Promise<{ ok: boolean; error?: string; applied: Array<{ kind: string; file: string; detail: string }>; skipped: Array<{ kind: string; file: string; reason: string }>; rounds: number; remaining: LintFinding[]; counts: ResolutionCounts }> {
  const r = await studioPost(`/api/studio/kbs/${encodeURIComponent(id)}/maintenance`, { op: 'fix-auto' });
  return {
    ok: r.ok,
    error: r.error,
    applied: (r.data?.applied as Array<{ kind: string; file: string; detail: string }>) ?? [],
    skipped: (r.data?.skipped as Array<{ kind: string; file: string; reason: string }>) ?? [],
    rounds: typeof r.data?.rounds === 'number' ? r.data.rounds : 1,
    remaining: (r.data?.remaining as LintFinding[]) ?? [],
    counts: (r.data?.counts as ResolutionCounts) ?? ZERO_COUNTS,
  };
}

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
  return { ok: r.ok, error: r.error, runId: typeof r.data?.runId === 'string' ? r.data.runId : undefined };
}

/** Poll a dispatched agent-fix run's state. */
export async function getAgentFixStatus(
  id: string,
  runId: string,
): Promise<{ ok: boolean; state: 'running' | 'cleared' | 'not-cleared' | 'failed'; cleared: boolean }> {
  const base = await resolveBridgeUrl();
  if (!base) return { ok: false, state: 'running', cleared: false };
  try {
    const res = await fetch(`${base}/api/studio/kbs/${encodeURIComponent(id)}/fix-agent/${encodeURIComponent(runId)}`);
    const data = (await res.json()) as { state?: string; cleared?: boolean };
    return {
      ok: res.ok,
      state: (data.state as 'running' | 'cleared' | 'not-cleared' | 'failed') ?? 'running',
      cleared: data.cleared === true,
    };
  } catch {
    return { ok: false, state: 'running', cleared: false };
  }
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
  return { ok: r.ok, error: r.error, runId: typeof r.data?.runId === 'string' ? r.data.runId : undefined };
}

export type AgentRunStatus = {
  ok: boolean;
  state: 'running' | 'done' | 'suppressed' | 'failed' | 'unknown';
  costUsd: number;
  events: number;
};

/** Poll a dispatched generic agent run's state (reads its `_logs/<runId>/`
 *  event log server-side). */
export async function getAgentRunStatus(runId: string): Promise<AgentRunStatus> {
  const base = await resolveBridgeUrl();
  if (!base) return { ok: false, state: 'unknown', costUsd: 0, events: 0 };
  try {
    const res = await fetch(`${base}/api/agents/runs/${encodeURIComponent(runId)}`);
    const data = (await res.json()) as { state?: string; costUsd?: number; events?: number };
    return {
      ok: res.ok,
      state: (data.state as AgentRunStatus['state']) ?? 'unknown',
      costUsd: typeof data.costUsd === 'number' ? data.costUsd : 0,
      events: typeof data.events === 'number' ? data.events : 0,
    };
  } catch {
    return { ok: false, state: 'unknown', costUsd: 0, events: 0 };
  }
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
  const base = await resolveBridgeUrl();
  if (!base) return [];
  try {
    const res = await fetch(`${base}/api/studio/projects/starters`);
    const data = (await res.json()) as { appTypes?: string[] };
    return Array.isArray(data.appTypes) ? data.appTypes : [];
  } catch {
    return [];
  }
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

/** Fetch a single flow definition by id. */
export async function fetchFlow(id: string): Promise<Flow | null> {
  const body = await studioGet<{ flow?: Flow } | null>(
    `/api/studio/flows/${encodeURIComponent(id)}`,
    null,
  );
  return body?.flow ?? null;
}

/** Save (PUT) a flow definition by id. Bumps version server-side. */
export async function saveFlow(
  id: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; version?: number; error?: string; findings?: unknown[] }> {
  const r = await studioPut(`/api/studio/flows/${encodeURIComponent(id)}`, body);
  if (!r.ok) return { ok: false, error: r.error };
  return {
    ok: true,
    version: typeof r.data?.version === 'number' ? (r.data.version as number) : undefined,
    findings: Array.isArray(r.data?.findings) ? (r.data!.findings as unknown[]) : [],
  };
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
  const body = await studioGet<PreflightResult | null>(
    `/api/studio/projects/${encodeURIComponent(projectId)}/preflight`,
    null,
  );
  return body;
}

/**
 * R4-12-F1 — fetch a project's five-stage contract-buildout presence report
 * (`GET /api/studio/projects/:id/contract-stages`, a pure read served by
 * cli/bridge-studio.ts from cli/contract-stages.ts's `deriveContractStages`).
 * The 200 body is `{ok, project, stages, sourcesScanned}`; the rows are
 * validated at THIS boundary via session-client's `parseContractStageRow` —
 * the SAME parser + row type the session-shell's contract-buildout artifact
 * uses, never a re-derived client mirror. Shares this module's `studioGet`
 * error convention (no bridge / non-2xx / thrown fetch all degrade to the
 * empty fallback), so exactly ONE GET is issued and a missing checklist never
 * rejects a caller's render.
 */
export async function fetchContractStages(id: string): Promise<ContractStageRow[]> {
  const body = await studioGet<{ stages?: unknown[] }>(
    `/api/studio/projects/${encodeURIComponent(id)}/contract-stages`,
    { stages: [] },
  );
  return (body.stages ?? []).map((row, i) => parseContractStageRow(row, i));
}

// --- R1-2 — project-repo write transaction (forge-studio branch) ------------

/** Whether the project repo has forge-UI changes accumulated on forge-studio,
 *  pending a merge to main. */
export async function fetchRepoStatus(projectId: string): Promise<{ pending: boolean; branch: string }> {
  return studioGet<{ pending: boolean; branch: string }>(
    `/api/studio/projects/${encodeURIComponent(projectId)}/repo-status`,
    { pending: false, branch: 'forge-studio' },
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

/** Poll a dispatched preflight-fix (user-tier) run's state. */
export async function preflightFixStatus(
  projectId: string,
  runId: string,
): Promise<{ ok: boolean; state: 'running' | 'cleared' | 'not-cleared' | 'failed'; cleared: boolean }> {
  const base = await resolveBridgeUrl();
  if (!base) return { ok: false, state: 'running', cleared: false };
  try {
    const res = await fetch(`${base}/api/studio/projects/${encodeURIComponent(projectId)}/preflight/fix-agent/${encodeURIComponent(runId)}`);
    const data = (await res.json()) as { state?: string; cleared?: boolean };
    return {
      ok: res.ok,
      state: (data.state as 'running' | 'cleared' | 'not-cleared' | 'failed') ?? 'running',
      cleared: data.cleared === true,
    };
  } catch {
    return { ok: false, state: 'running', cleared: false };
  }
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
  const body = await studioGet<{ kbId?: string } | null>(
    `/api/studio/kbs/resolve-node/${encodeURIComponent(nodeId)}`,
    null,
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
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const r = await studioPost('/api/studio/kbs', body);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, id: typeof r.data?.id === 'string' ? (r.data.id as string) : body.id };
}

/** Delete a knowledge base (removes its brain/<id>/ dir). The forge-owned core
 *  brains (cycles, forge-dev) are server-guarded against deletion. */
export async function deleteKb(id: string): Promise<{ ok: boolean; error?: string }> {
  const base = await resolveBridgeUrl();
  if (!base) return { ok: false, error: 'no bridge configured' };
  try {
    const res = await fetch(`${base}/api/studio/kbs/${encodeURIComponent(id)}`, {
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
  const base = await resolveBridgeUrl();
  if (!base) return { ok: false, error: 'no bridge configured' };
  try {
    const res = await fetch(`${base}/api/studio/agents/${encodeURIComponent(slug)}/instructions-draft`, {
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
