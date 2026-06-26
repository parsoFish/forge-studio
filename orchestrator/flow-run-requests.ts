/**
 * Stage C — claimable flow-run requests for `on: complete` triggers.
 *
 * When a flow completes and declares an `on: complete` trigger, the flow-runner
 * stages a request here (replacing the dead M3 marker). A request carries the
 * SOURCE initiative so a drain can repoint that initiative at the target flow and
 * make it claimable — a coherent "also run flow B on the same initiative"
 * (e.g. a future architect-complete → develop chain).
 *
 * Requests live in `_queue/flow-runs/`, a sibling of `pending/` — deliberately
 * OUTSIDE pending/ so the scheduler's initiative claim (`listPending` reads
 * `pending/*.md`) can never mis-read a request as an initiative manifest.
 *
 * No seed flow declares an `on: complete` trigger today (reflect fires on
 * `merged`, via finalize-merged), so the default drain handler covers only
 * forge-develop (the one coherent target); other targets surface rather than
 * silently drop. The generic staging + drain are unit-tested and ready for the
 * first real `on: complete` consumer.
 */
import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { enqueueDevelopRun, DEVELOP_FLOW_ID } from './enqueue-develop-run.ts';

export type FlowRunRequest = {
  flowId: string;
  origin: string;
  triggeredBy: string;
  /** The initiative the source flow ran — repointed at `flowId` by the drain. */
  sourceInitiativeId?: string;
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
  const file = join(dir, `flow-run-${req.flowId}-${ts}.json`);
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

export type FlowRunDrainStatus = 'dispatched' | 'skipped-no-initiative' | 'error';
export type FlowRunDrainResult = {
  flowId: string;
  sourceInitiativeId?: string;
  status: FlowRunDrainStatus;
  detail?: string;
};

export type DrainFlowRunDeps = {
  queueRoot?: string;
  /** Dispatch one request. Default repoints the source initiative at the target
   *  flow + makes it claimable. Injectable so tests need no real manifests. */
  startFlowRun?: (req: FlowRunRequest) => void;
  notify?: (msg: string) => void;
};

/**
 * Claim + dispatch every staged flow-run request. Mirrors the scheduler's other
 * best-effort sweeps (runFinalizeSweep / runDrainSweep). A dispatched request is
 * removed; a context-free request (no source initiative — no coherent claim
 * target) is dropped so it doesn't accumulate; a dispatch error leaves the
 * request in place and is surfaced, never silently swallowed.
 */
export function drainFlowRunRequests(deps: DrainFlowRunDeps = {}): FlowRunDrainResult[] {
  const startFlowRun = deps.startFlowRun ?? defaultStartFlowRun(deps.queueRoot);
  const out: FlowRunDrainResult[] = [];
  for (const { path, req } of listFlowRunRequests({ queueRoot: deps.queueRoot })) {
    if (!req.sourceInitiativeId) {
      out.push({ flowId: req.flowId, status: 'skipped-no-initiative' });
      rmSync(path, { force: true });
      continue;
    }
    try {
      startFlowRun(req);
      rmSync(path, { force: true });
      deps.notify?.(`flow-trigger: ${req.triggeredBy} → ${req.flowId} on ${req.sourceInitiativeId}`);
      out.push({ flowId: req.flowId, sourceInitiativeId: req.sourceInitiativeId, status: 'dispatched' });
    } catch (err) {
      out.push({
        flowId: req.flowId,
        sourceInitiativeId: req.sourceInitiativeId,
        status: 'error',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}

function defaultStartFlowRun(queueRoot?: string): (req: FlowRunRequest) => void {
  return (req) => {
    if (!req.sourceInitiativeId) return;
    if (req.flowId === DEVELOP_FLOW_ID) {
      // forge-develop has a dedicated, guard-rich claimable enqueue — reuse it.
      enqueueDevelopRun(req.sourceInitiativeId, { queueRoot });
      return;
    }
    // Other targets have no claim handler yet. Surface it (the request stays);
    // a per-flow claimable enqueue lands with the first real on:complete consumer.
    throw new Error(`no claimable enqueue for flow "${req.flowId}" — request staged, not dispatched`);
  };
}
