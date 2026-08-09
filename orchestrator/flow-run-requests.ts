/**
 * R2-04 (ADR-041) — claimable flow-run requests: the ONE dispatch path for
 * every trigger-originated run.
 *
 * All trigger kinds converge here: `on: flow-complete` chaining (the
 * flow-runner stages a request on terminal success), cron fires (the
 * scheduler's croner arm stages), and webhook receipts (the bridge's
 * signature-verified /api/hooks route stages). Staging is always a local file
 * write; DISPATCH happens only in the daemon's sweep — so dry-bridge /
 * FORGE_ARCHITECT_NO_SPAWN hold structurally for external kinds (no dispatch
 * path exists outside the guarded daemon).
 *
 * Requests live in `_queue/flow-runs/`, a sibling of `pending/` — deliberately
 * OUTSIDE pending/ so the scheduler's initiative claim (`listPending` reads
 * `pending/*.md`) can never mis-read a request as an initiative manifest.
 *
 * Dispatch cases:
 *  - `target.kind: 'flow'` + a source initiative → `enqueueFlowRun` repoints
 *    that initiative at the target flow (chaining).
 *  - `target.kind: 'flow'` + NO source initiative (cron/webhook origination) →
 *    mint a fresh initiative manifest for the target flow's project.
 *  - `target.kind: 'agent'` → throws (the request is retained, surfaced every
 *    sweep, never dropped). This module has no production `startAgentRun`
 *    injector: the only production caller (the scheduler) never supplies
 *    one, so an `agent`-target request always surfaces as a retained error
 *    here.
 *
 * R4-09's real standalone reflect dispatch lives elsewhere: its own inline
 * band-guarded arm in `finalize-merged.ts`, a completely different seam from
 * this queue. `agent-complete` (R2-08-F2) targets FLOWS, which
 * `startFlowRun` already handles — it does not touch this gap.
 */
import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { enqueueFlowRun } from './enqueue-flow-run.ts';
import { mintTriggeredInitiative } from './mint-triggered-initiative.ts';
import { getPaths } from './queue.ts';
import { parseManifest } from './manifest.ts';
import type { TriggerTarget } from './studio/types.ts';
import type { TriggerPayload } from './trigger-payload.ts';

export type FlowRunRequestOrigin = 'trigger' | 'cron' | 'webhook' | 'agent-complete';

export type FlowRunRequest = {
  /** What to start (ADR-041). Legacy pre-target requests are skipped loudly. */
  target: TriggerTarget;
  origin: FlowRunRequestOrigin;
  triggeredBy: string;
  /** The initiative the source flow ran — repointed at the target by the drain.
   *  Absent on cron/webhook/agent-complete origination (the drain mints a fresh one). */
  sourceInitiativeId?: string;
  /** External kinds only: the typed, extraction-validated payload (data, not prompt text). */
  payload?: TriggerPayload;
  /**
   * cron only (ADR-041 §2): overrun policy carried from the trigger so the
   * drain can enforce it at origination. Absent ⇒ `forbid` (skip minting a new
   * run while a prior triggered run of the same target flow is still active).
   * `replace` is enum-reserved (lint-blocked) — treated as `forbid` here.
   */
  concurrency?: 'allow' | 'forbid' | 'replace';
  /**
   * R2-08-F1 (ADR-027 amendment): a snapshot of the firing trigger's OWN
   * `projects:` declaration, carried onto the staged request — never
   * re-derived from prose at drain time. Absent ⇒ unscoped; `[]` ⇒ scoped to
   * nothing. The two states are never collapsed.
   */
  projects?: string[];
  /**
   * R2-08-F1: the project id THIS event resolved to. `null`/absent ⇒
   * unresolved. Matched by strict identity against `projects` — never folded
   * into a filesystem path (ADR-027 R2-08 amendment, rule 5).
   */
  eventProject?: string | null;
  /** R2-08-F2: the completed agent slug that staged this request (agent-complete origin only). */
  sourceAgent?: string;
  /**
   * R2-08-F4 (round-2): the DECLARING flow's id (cron + webhook origins).
   * `triggeredBy` deliberately keeps its own kind-prefixed shape
   * (`cron:<flowId>` / `webhook:<hookId>`) for its own pre-existing readers
   * (notify messages, concurrency lookups) — this field is the ONE
   * mechanism trigger-provenance derivation reads instead, so a future
   * change to `triggeredBy`'s format can never silently corrupt `source`.
   * webhook has NO fallback when this is absent (`findWebhookTrigger`
   * already resolves it at every real call site; a hook id is never a
   * substitute definition id — round-2 ruling). cron has NO fallback either
   * (forge-76y, T1 ruling): `cron-triggers.ts`'s `makeFireFn` always threads
   * this field, so the `triggeredBy`-parsing fallback arm that used to exist
   * was deleted — symmetric with webhook. Absent for `agent-complete` — its
   * declaring definition is `sourceAgent`.
   */
  sourceFlowId?: string;
  /**
   * R2-08-F3 (adversarial-review fix): the DECLARATION-sourced `TRIGGER_KINDS`
   * registry id that actually fired this request (the firing trigger's own
   * `on:` value) — deliberately SEPARATE from `origin`, which describes the
   * mint/transport mechanism only. Needed because `origin: 'webhook'` now
   * covers THREE distinct registry kinds (`webhook`, `pr-merged`,
   * `issue-raised` all share the signature-verified `/api/hooks/:hookId`
   * receiver) — `mint-triggered-initiative.ts`'s `deriveTriggerFields` reads
   * THIS for `Run.trigger.kind`, never `origin`, so the three no longer
   * collapse onto one reported value. Sourced from trusted flow.yaml config
   * (the trigger declaration), NEVER from `req.payload` — external/attacker
   * data must never flow into `trigger` (the same exclusion `sourceFlowId`/
   * `sourceAgent` already honour). Absent ⇒ `deriveTriggerFields` falls back
   * to `origin` (cron/agent-complete origins are already unambiguous 1:1 with
   * their registry kind, so they never need to set this).
   */
  triggerKind?: string;
  createdAt: string;
};

export type FlowRunQueueOpts = { queueRoot?: string };

/** `<queueRoot>/flow-runs` — a sibling of pending/in-flight, NOT inside pending/. */
export function flowRunsDir(queueRoot?: string): string {
  const root = queueRoot
    ? resolve(queueRoot)
    : resolve(dirname(fileURLToPath(import.meta.url)), '..', '_queue');
  return join(root, 'flow-runs');
}

/** Stage one claimable flow-run request. Returns the written file path. */
export function stageFlowRunRequest(
  req: Omit<FlowRunRequest, 'createdAt'> & { createdAt?: string },
  opts: FlowRunQueueOpts = {},
): string {
  const dir = flowRunsDir(opts.queueRoot);
  mkdirSync(dir, { recursive: true });
  const createdAt = req.createdAt ?? new Date().toISOString();
  const ts = createdAt.replace(/[:.]/g, '-');
  const file = join(dir, `flow-run-${req.target.ref}-${ts}.json`);
  writeFileSync(file, JSON.stringify({ ...req, createdAt }, null, 2));
  return file;
}

export function listFlowRunRequests(
  opts: FlowRunQueueOpts = {},
): Array<{ path: string; req: FlowRunRequest }> {
  const dir = flowRunsDir(opts.queueRoot);
  if (!existsSync(dir)) return [];
  const out: Array<{ path: string; req: FlowRunRequest }> = [];
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const path = join(dir, name);
    try {
      out.push({ path, req: JSON.parse(readFileSync(path, 'utf8')) as FlowRunRequest });
    } catch {
      /* skip a malformed request rather than wedge the whole drain */
    }
  }
  return out;
}

export type FlowRunDrainStatus =
  | 'dispatched'
  | 'skipped-no-initiative'
  | 'skipped-malformed'
  | 'skipped-concurrency'
  | 'skipped-out-of-scope'
  | 'error';
export type FlowRunDrainResult = {
  target?: TriggerTarget;
  sourceInitiativeId?: string;
  status: FlowRunDrainStatus;
  detail?: string;
};

export type DrainFlowRunDeps = {
  queueRoot?: string;
  /** Forge root for the origination mint (flow defs + projects + _logs).
   *  Defaults to the repo root two levels above this module. */
  forgeRoot?: string;
  /** Dispatch one request. Default: chaining → enqueueFlowRun; origination →
   *  mintTriggeredInitiative. Injectable so tests need no real manifests. */
  startFlowRun?: (req: FlowRunRequest) => void;
  /** R4-09 seam: dispatch a standalone-agent target. Default throws (request
   *  retained) until the reflect cutover wires it. */
  startAgentRun?: (req: FlowRunRequest) => void;
  notify?: (msg: string) => void;
};

/**
 * Claim + dispatch every staged flow-run request. Mirrors the scheduler's other
 * best-effort sweeps (runFinalizeSweep / runDrainSweep). A dispatched request is
 * removed; a malformed request (no target — e.g. a pre-ADR-041 straggler) is
 * dropped loudly; a dispatch error leaves the request in place and is surfaced,
 * never silently swallowed.
 */
export function drainFlowRunRequests(deps: DrainFlowRunDeps = {}): FlowRunDrainResult[] {
  const startFlowRun = deps.startFlowRun ?? defaultStartFlowRun(deps.queueRoot, deps.forgeRoot);
  const startAgentRun =
    deps.startAgentRun ??
    ((req: FlowRunRequest) => {
      throw new Error(
        `no standalone-agent dispatch for target "${req.target.ref}" — lands with R4-09; request retained`,
      );
    });
  const out: FlowRunDrainResult[] = [];
  for (const { path, req } of listFlowRunRequests({ queueRoot: deps.queueRoot })) {
    if (!req.target || typeof req.target.ref !== 'string' || !req.target.ref) {
      out.push({ status: 'skipped-malformed', detail: `request ${path} has no target — dropped` });
      deps.notify?.(`flow-trigger: dropped malformed request (no target): ${path}`);
      rmSync(path, { force: true });
      continue;
    }
    // R2-08-F1 (ADR-027 amendment) — per-project scope, enforced at the
    // dispatch point (rule 2: "the dispatch point is the enforcement point;
    // lint is defense in depth"). `projects === undefined` ⇒ unscoped, the
    // pre-existing cross-project behaviour, completely unaffected. A DECLARED
    // scope (including `[]`) requires a resolved `eventProject` that is an
    // IDENTITY match (never prefix/substring/case-insensitive — plain
    // Array.includes on strings) against the snapshot list; anything else —
    // an unresolved event or a non-member id — fails closed as a typed skip,
    // never a silent drop and never dispatched (rules 3 + 4). This is a pure
    // identity comparison, not a path operation: an out-of-scope
    // `eventProject` is never folded into a filesystem path (rule 5).
    if (req.projects !== undefined) {
      const eventProject = req.eventProject;
      const inScope = eventProject !== undefined && eventProject !== null && req.projects.includes(eventProject);
      if (!inScope) {
        out.push({ target: req.target, sourceInitiativeId: req.sourceInitiativeId, status: 'skipped-out-of-scope' });
        deps.notify?.(
          `flow-trigger: ${req.triggeredBy} → ${req.target.kind}:${req.target.ref} SKIPPED (out of scope — event project ` +
            `${eventProject == null ? '(unresolved)' : `"${eventProject}"`} not in [${req.projects.join(', ')}])`,
        );
        rmSync(path, { force: true });
        continue;
      }
    }
    // A CHAINING request (origin 'trigger') without a source initiative has no
    // coherent claim target — drop it so it doesn't accumulate. Only external
    // origination (cron/webhook) legitimately arrives source-less (→ mint).
    if (!req.sourceInitiativeId && req.origin === 'trigger') {
      out.push({ target: req.target, status: 'skipped-no-initiative' });
      rmSync(path, { force: true });
      continue;
    }
    // ADR-041 §2 concurrency: `concurrency` is a CRON field (webhooks fire on
    // discrete real pushes — each legitimately mints its own run, guarded
    // against same-instant id collisions in mintTriggeredInitiative). For a
    // cron origination the default `forbid` policy skips minting a fresh run
    // while a prior triggered run of the SAME target flow is still active
    // (pending / in-flight / awaiting its gate) — the K8s-style overrun guard
    // the field promises, enforced HERE per the module doc. `allow` opts out;
    // `replace` (enum-reserved) falls through to forbid. Only meaningful with a
    // real queue root (injected-startFlowRun tests run against empty dirs ⇒ no
    // active run ⇒ never skipped).
    if (
      !req.sourceInitiativeId &&
      req.origin === 'cron' &&
      req.target.kind === 'flow' &&
      (req.concurrency ?? 'forbid') !== 'allow' &&
      hasActiveTriggeredRun(deps.queueRoot, req.target.ref)
    ) {
      out.push({ target: req.target, status: 'skipped-concurrency' });
      deps.notify?.(`flow-trigger: ${req.triggeredBy} → ${req.target.ref} SKIPPED (concurrency: forbid — a prior triggered run is still active)`);
      rmSync(path, { force: true });
      continue;
    }
    try {
      if (req.target.kind === 'agent') {
        startAgentRun(req);
      } else {
        startFlowRun(req);
      }
      rmSync(path, { force: true });
      deps.notify?.(
        `flow-trigger: ${req.triggeredBy} → ${req.target.kind}:${req.target.ref}` +
          (req.sourceInitiativeId ? ` on ${req.sourceInitiativeId}` : ' (originated)'),
      );
      out.push({ target: req.target, sourceInitiativeId: req.sourceInitiativeId, status: 'dispatched' });
    } catch (err) {
      out.push({
        target: req.target,
        sourceInitiativeId: req.sourceInitiativeId,
        status: 'error',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}

/**
 * True if an `origin: 'triggered'` initiative for `flowId` is currently active
 * — sitting in pending / in-flight / ready-for-review (a completed run has
 * moved to done/ or failed/, so it no longer counts). The concurrency guard's
 * "is a prior run still running?" predicate. Best-effort: an unreadable
 * manifest is skipped, not treated as active.
 */
function hasActiveTriggeredRun(queueRoot: string | undefined, flowId: string): boolean {
  const paths = getPaths(queueRoot ?? '_queue');
  for (const dir of [paths.pending, paths.inFlight, paths.readyForReview]) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
      try {
        const m = parseManifest(readFileSync(join(dir, name), 'utf8'));
        if (m.origin === 'triggered' && m.flow_id === flowId) return true;
      } catch {
        /* unreadable manifest — don't let it block or falsely satisfy the guard */
      }
    }
  }
  return false;
}

function defaultStartFlowRun(queueRoot?: string, forgeRoot?: string): (req: FlowRunRequest) => void {
  return (req) => {
    if (req.sourceInitiativeId) {
      // Chaining: repoint the source initiative at the target flow. Non-enqueued
      // outcomes (already-running, not-planned, not-found) are surfaced as
      // dispatch errors so the request is retained + retried/inspected, never
      // silently dropped.
      const r = enqueueFlowRun(req.sourceInitiativeId, req.target.ref, { queueRoot });
      if (r.status !== 'enqueued') {
        throw new Error(`enqueue ${req.target.ref} on ${req.sourceInitiativeId}: ${r.status}${r.detail ? ` (${r.detail})` : ''}`);
      }
      return;
    }
    // Origination (cron/webhook): mint a fresh initiative for the target flow.
    // A pure queue/fs operation — the guarded scheduler claim is the only path
    // from here to an agent spawn (ADR-041 queue-only dispatch invariant).
    const minted = mintTriggeredInitiative(req, {
      queueRoot,
      ...(forgeRoot ? { forgeRoot, logsRoot: join(forgeRoot, '_logs') } : {}),
    });
    if (minted.status !== 'minted') {
      throw new Error(`mint for ${req.target.ref}: ${minted.status}${minted.detail ? ` (${minted.detail})` : ''}`);
    }
  };
}
