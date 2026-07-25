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
 *  - `target.kind: 'agent'` → throws until R4-09 wires the standalone-agent
 *    dispatch; the request is retained (surfaced every sweep, never dropped).
 */
import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { enqueueFlowRun } from './enqueue-flow-run.ts';
import { mintTriggeredInitiative } from './mint-triggered-initiative.ts';
import type { TriggerTarget } from './studio/types.ts';
import type { TriggerPayload } from './trigger-payload.ts';

export type FlowRunRequestOrigin = 'trigger' | 'cron' | 'webhook';

export type FlowRunRequest = {
  /** What to start (ADR-041). Legacy pre-target requests are skipped loudly. */
  target: TriggerTarget;
  origin: FlowRunRequestOrigin;
  triggeredBy: string;
  /** The initiative the source flow ran — repointed at the target by the drain.
   *  Absent on cron/webhook origination (the drain mints a fresh one). */
  sourceInitiativeId?: string;
  /** External kinds only: the typed, extraction-validated payload (data, not prompt text). */
  payload?: TriggerPayload;
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

export type FlowRunDrainStatus = 'dispatched' | 'skipped-no-initiative' | 'skipped-malformed' | 'error';
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
    // A CHAINING request (origin 'trigger') without a source initiative has no
    // coherent claim target — drop it so it doesn't accumulate. Only external
    // origination (cron/webhook) legitimately arrives source-less (→ mint).
    if (!req.sourceInitiativeId && req.origin === 'trigger') {
      out.push({ target: req.target, status: 'skipped-no-initiative' });
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
