/**
 * R2-04 (ADR-041) — cron triggers: the scheduler's temporal arm.
 *
 * A flow declares `on: cron` triggers (`schedule` + `target`) in its
 * `flow.yaml`. This module is armed exclusively by the SCHEDULER — never the
 * bridge — mirroring the daemon-only dispatch perimeter every other trigger
 * kind respects (webhook receipts and `on: flow-complete` chaining also only
 * ever STAGE a claimable request; see flow-run-requests.ts).
 *
 * `syncCronTriggers` scans every registered flow, collects its declared cron
 * triggers, and diffs them against a live-armed `Map<key, Cron>`: triggers no
 * longer declared are stopped + removed; newly declared ones are armed with a
 * fresh `croner` `Cron` job. The key
 * (`${flowId}#${index}#${schedule}#${target.kind}:${target.ref}`) folds in
 * every field the job's identity depends on — editing any one of them (e.g.
 * retargeting a trigger, or just fixing its schedule) is a new key, so the
 * stale job is cleanly stopped and a fresh one armed rather than mutated in
 * place. A flow whose `flow.yaml` fails to load is skipped (loudly, via
 * `notify`) rather than aborting the whole sweep — one broken flow must never
 * stop every other flow's cron triggers from staying armed.
 *
 * A fire NEVER dispatches directly or spawns an agent — it stages a claimable
 * flow-run request via `stageFlowRunRequest` (`origin: 'cron'`), exactly like
 * every other trigger kind. Dispatch happens only in the daemon's drain sweep
 * (`drainFlowRunRequests`), which is where FORGE_ARCHITECT_NO_SPAWN / the
 * dry-bridge perimeter hold. `deps.onFire` (the scheduler wires this to
 * `runFlowTriggerSweep`) is an in-process nudge for promptness only — it does
 * not bypass the queue file; the fire has already landed on disk before
 * `onFire` runs.
 *
 * Concurrency policy (`FlowTrigger.concurrency: allow|forbid|replace`) is
 * enforced at DRAIN time, not here — deliberately NOT implemented in this
 * module. `croner`'s `protect: true` only prevents the SAME armed job's
 * callback from overlapping its own previous firing; it says nothing about a
 * manually-kicked or chained run of the same target already in flight. That
 * check belongs to the drain sweep (flow-run-requests.ts), which has visibility
 * into what's actually claimed/in-flight.
 */
import { join, resolve } from 'node:path';
import { Cron } from 'croner';

import { normalizeProjectId } from '@forge/kernel';
import { listFlowIds, loadFlowDefinition } from '../../orchestrator/studio/registry.ts';
import { stageFlowRunRequest } from './flow-run-requests.ts';
import type { TriggerTarget } from '@forge/contracts/studio/types.ts';

/**
 * Module-level default armed register — one Node process, one live set of
 * cron jobs. Tests (and any future multi-instance caller) inject their own
 * `Map` via `deps.armed` so they never touch this shared state.
 */
const DEFAULT_ARMED_CRON_TRIGGERS = new Map<string, Cron>();

export type SyncCronTriggersDeps = {
  /** Absolute forge root — `studio/flows/*` is scanned relative to this. */
  forgeRoot: string;
  queueRoot?: string;
  /** Injectable armed register; defaults to the module-level one. */
  armed?: Map<string, Cron>;
  notify?: (msg: string) => void;
  /** Fired once per fire, after the request is staged — an in-process nudge
   *  for promptness, not a dispatch path. */
  onFire?: () => void;
};

export type SyncCronTriggersResult = {
  /** Keys newly armed by this sync call. */
  armed: string[];
  /** Keys stopped + removed by this sync call (no longer declared). */
  stopped: string[];
  /** Total keys armed after this sync call (steady-state size of `armed`). */
  active: number;
};

/** A cron trigger as declared on disk, resolved to its identity key. */
type DeclaredCronTrigger = {
  key: string;
  flowId: string;
  schedule: string;
  target: TriggerTarget;
  concurrency: 'allow' | 'forbid' | 'replace';
  /** R2-08-F1: the trigger's own `projects:` declaration. Absent ⇒ unscoped. */
  projects?: string[];
  /** R2-08-F1: the declaring flow's own `project:` binding (T1 ruling: cron
   *  has no external event, so eventProject is the declaring flow's own
   *  project) — `null`/absent stays unresolved. */
  eventProject: string | null;
};

function cronKey(flowId: string, index: number, schedule: string, target: TriggerTarget): string {
  return `${flowId}#${index}#${schedule}#${target.kind}:${target.ref}`;
}

/**
 * Scan every registered flow's `flow.yaml` and collect its declared `on:
 * cron` triggers with a non-empty `schedule`. A flow that fails to load
 * (malformed YAML, a missing required field, …) is skipped with a `notify`
 * call rather than thrown — one broken flow definition must not take down
 * every other flow's cron arming.
 */
function scanDeclaredCronTriggers(forgeRoot: string, notify: (msg: string) => void): DeclaredCronTrigger[] {
  const out: DeclaredCronTrigger[] = [];
  const root = resolve(forgeRoot);
  for (const flowId of listFlowIds(root)) {
    let flowDef;
    try {
      const flowYamlPath = join(root, 'studio', 'flows', flowId, 'flow.yaml');
      flowDef = loadFlowDefinition(flowYamlPath);
    } catch (err) {
      notify(
        `cron-triggers: skipping ${flowId} — flow.yaml failed to load: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    // R2-08-F1: cron has no external event to resolve a project from — T1's
    // ruling is the DECLARING flow's own `project:` binding. N1 (round-4):
    // `flow.project` is a raw path segment (per isSafeProjectName's own doc —
    // it becomes `resolve('projects', m.project)` at the scheduler's manifest
    // fallback), not guaranteed pre-normalized, so it is run through the SAME
    // `normalizeProjectId` `discoverProjects` uses before comparison — lint
    // and dispatch must read identical evidence (rule 2).
    const eventProject = flowDef.project !== null ? normalizeProjectId(flowDef.project) : null;
    flowDef.triggers.forEach((t, index) => {
      if (t.on !== 'cron') return;
      if (typeof t.schedule !== 'string' || t.schedule.trim() === '') return;
      out.push({
        key: cronKey(flowId, index, t.schedule, t.target),
        flowId,
        schedule: t.schedule,
        target: t.target,
        concurrency: t.concurrency ?? 'forbid',
        projects: t.projects,
        eventProject,
      });
    });
  }
  return out;
}

/**
 * The fire callback staged behind every armed `Cron` job: stage a claimable
 * flow-run request (never dispatch, never spawn) and nudge the scheduler's
 * in-process trigger sweep for promptness. Wrapped in try/catch so a staging
 * failure (e.g. an unwritable `_queue/`) surfaces via `notify` rather than
 * becoming an uncaught rejection inside croner's timer.
 */
function makeFireFn(
  d: DeclaredCronTrigger,
  queueRoot: string | undefined,
  notify: (msg: string) => void,
  onFire: (() => void) | undefined,
): () => void {
  return () => {
    try {
      stageFlowRunRequest(
        {
          target: d.target,
          origin: 'cron',
          triggeredBy: `cron:${d.flowId}`,
          // R2-08-F4 (round-2): thread the declaring flow id through the SAME
          // dedicated field webhook uses, so trigger-provenance derivation
          // reads one mechanism per kind rather than parsing it back out of
          // `triggeredBy` — `triggeredBy` keeps its own `cron:<flowId>` shape
          // unchanged for its own (pre-existing) readers.
          sourceFlowId: d.flowId,
          concurrency: d.concurrency,
          payload: { kind: 'cron', schedule: d.schedule, firedAt: new Date().toISOString() },
          // R2-08-F1: absent stays absent — never coerce `undefined` to `[]`.
          ...(d.projects !== undefined ? { projects: d.projects } : {}),
          ...(d.eventProject !== null ? { eventProject: d.eventProject } : {}),
        },
        { queueRoot },
      );
    } catch (err) {
      notify(
        `cron-triggers: ${d.flowId} fire failed to stage a flow-run request: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    onFire?.();
  };
}

/**
 * Diff the declared cron triggers (scanned fresh from disk) against the live
 * armed set, stopping jobs no longer declared and arming jobs newly declared.
 * An unchanged declaration (same key already armed) is left untouched — no
 * re-arm, no job churn. Never throws: a broken flow or an invalid schedule is
 * reported via `notify` and skipped.
 */
export function syncCronTriggers(deps: SyncCronTriggersDeps): SyncCronTriggersResult {
  const notify = deps.notify ?? (() => {});
  const armed = deps.armed ?? DEFAULT_ARMED_CRON_TRIGGERS;

  const declared = scanDeclaredCronTriggers(deps.forgeRoot, notify);
  const declaredKeys = new Set(declared.map((d) => d.key));

  const stopped: string[] = [];
  for (const [key, job] of armed) {
    if (declaredKeys.has(key)) continue;
    try {
      job.stop();
    } catch {
      /* best-effort — the key is removed from the register regardless */
    }
    armed.delete(key);
    stopped.push(key);
  }

  const newlyArmed: string[] = [];
  for (const d of declared) {
    if (armed.has(d.key)) continue; // unchanged declaration — no re-arm
    try {
      const job = new Cron(
        d.schedule,
        { protect: true },
        makeFireFn(d, deps.queueRoot, notify, deps.onFire),
      );
      armed.set(d.key, job);
      newlyArmed.push(d.key);
    } catch (err) {
      notify(
        `cron-triggers: ${d.flowId} — invalid cron schedule "${d.schedule}" — skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { armed: newlyArmed, stopped, active: armed.size };
}

/**
 * Stop + clear every armed cron job — shutdown/test teardown. Defaults to
 * the module-level register so the scheduler can call this bare on exit.
 */
export function stopAllCronTriggers(armed: Map<string, Cron> = DEFAULT_ARMED_CRON_TRIGGERS): void {
  for (const [, job] of armed) {
    try {
      job.stop();
    } catch {
      /* best-effort */
    }
  }
  armed.clear();
}
