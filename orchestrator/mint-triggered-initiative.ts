/**
 * R2-04 (ADR-041) — mint a fresh initiative for a cron/webhook-originated
 * flow-run request (no source initiative to repoint).
 *
 * The target flow's `project` binding supplies the project; lint requires it
 * non-null on flows targeted by external triggers, and the mint fail-louds if
 * it is absent anyway (defence in depth). The initiative id is generated from
 * VALIDATED fields only — never payload free-text (prompt-injection posture:
 * external text must not reach id/path space). Budgets come from the
 * `triggers` section of forge.config.json. The typed payload is persisted as
 * `_logs/<cycleId>/artifacts/trigger-payload.json` — the read-as-data artifact
 * agents may consult; prompts never interpolate it.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { defaultConfigPath, loadConfig, resolveProjectsDir, resolveTriggeredRunBudgets } from './config.ts';
import { writeManifest, mintAndPersistManifestCycleId, readManifestCycleId, type InitiativeManifest } from './manifest.ts';
import { getPaths } from './queue.ts';
import { loadFlowDefinition } from './studio/registry.ts';
import type { FlowRunRequest } from './flow-run-requests.ts';

export type MintTriggeredResult = {
  status: 'minted' | 'no-project' | 'error';
  initiativeId?: string;
  detail?: string;
};

/** True if `<id>.md` already exists in ANY queue state dir (collision guard). */
function idExistsInQueue(paths: ReturnType<typeof getPaths>, id: string): boolean {
  const file = `${id}.md`;
  return [paths.pending, paths.inFlight, paths.readyForReview, paths.merged, paths.done, paths.failed].some(
    (d) => existsSync(join(d, file)),
  );
}

/** Lowercase-slugify a validated token for the initiative id (never free text). */
function idToken(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'run';
}

/**
 * R2-08-F4 (ADR-027 amendment): derive the trigger-provenance fields to
 * persist on the minted manifest, from the staged request alone — never
 * from `req.payload` (free-text/external data; the attacker-payload
 * acceptance test pins that `trigger` never carries payload text). `source`
 * is always a DEFINITION id:
 *   - `agent-complete` → the completed agent's own slug (`sourceAgent`).
 *   - `webhook`        → the declaring flow id, threaded by the caller onto
 *     `sourceFlowId` (bridge-hooks.ts's `findWebhookTrigger` resolves it;
 *     `triggeredBy` deliberately stays the hook-id slug for its own readers).
 *     Every real production caller sets it now; a caller that doesn't falls
 *     back to `triggeredBy`'s own `webhook:<hookId>` shape below — a
 *     structured, non-prose token, not the correct definition id, but never
 *     a fabricated one either.
 *   - `cron`           → recovered from `triggeredBy`'s own
 *     `cron:<declaringFlowId>` shape (cron-triggers.ts's `makeFireFn` — no
 *     separate field needed).
 * Only these three origins ever reach this function (drainFlowRunRequests
 * routes chaining's `origin: 'trigger'` through `enqueueFlowRun` instead,
 * never through mint). Returns `null` when no honest source is derivable at
 * all — never a fabricated placeholder.
 */
function deriveTriggerFields(req: FlowRunRequest): { kind: string; source: string; scope?: string } | null {
  let source: string | undefined;
  if (req.origin === 'agent-complete') {
    source = req.sourceAgent;
  } else if (req.origin === 'webhook') {
    source = req.sourceFlowId;
  }
  // Fallback (cron always lands here; webhook falls back only when a caller
  // omits `sourceFlowId`): recover the definition id from `triggeredBy`'s own
  // `<origin>:<id>` shape — a structured, non-prose token every real call
  // site already writes, never a fabricated placeholder.
  if (!source) {
    const prefix = `${req.origin}:`;
    source = req.triggeredBy.startsWith(prefix) ? req.triggeredBy.slice(prefix.length) : undefined;
  }
  if (!source) return null;
  return {
    kind: req.origin,
    source,
    ...(req.eventProject !== undefined && req.eventProject !== null ? { scope: req.eventProject } : {}),
  };
}

export function mintTriggeredInitiative(
  req: FlowRunRequest,
  opts: { queueRoot?: string; forgeRoot?: string; logsRoot?: string } = {},
): MintTriggeredResult {
  try {
    const forgeRoot = opts.forgeRoot ?? resolve(import.meta.dirname, '..');
    const flowId = req.target.ref;
    const flow = loadFlowDefinition(join(forgeRoot, 'studio', 'flows', flowId, 'flow.yaml'));
    if (!flow.project) {
      return { status: 'no-project', detail: `flow "${flowId}" has no project binding — external triggers need one (lint: trigger-cron/trigger-webhook)` };
    }
    const cfg = loadConfig(defaultConfigPath(forgeRoot));
    const projectRepoPath = join(resolveProjectsDir(forgeRoot, cfg), flow.project);
    if (!existsSync(projectRepoPath)) {
      return { status: 'error', detail: `project repo not found at ${projectRepoPath}` };
    }

    const budgets = resolveTriggeredRunBudgets(cfg);
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const hms = now.toISOString().slice(11, 19).replace(/:/g, '');
    // The queue root MUST be derived from `forgeRoot` (already resolved above —
    // either the caller's explicit, trusted `opts.forgeRoot`, or this module's
    // own on-disk location), never from a bare `'_queue'` relative default.
    // `writeManifest` (below) independently re-derives forgeRoot as
    // `dirname(resolve(queueRoot))` to run `assertManifestPathFields`'
    // containment check — a caller that omits `opts.queueRoot` (the production
    // daemon's `runFlowTriggerSweep`, which passes `forgeRoot` but not
    // `queueRoot`) would otherwise fall back to `resolve('_queue')`, i.e.
    // `<process.cwd()>/_queue`. That is only equal to `<forgeRoot>/_queue` when
    // the daemon's cwd happens to equal forgeRoot — an incidental, unenforced
    // property, not an invariant (a service manager, cron wrapper, or an
    // operator invoking `forge serve` from a project subdirectory can all break
    // it). A cwd/forgeRoot mismatch would make `writeManifest` validate
    // containment against the WRONG root, silently accepting a project outside
    // the real forgeRoot's `projects/` — the exact defect this fix closes,
    // reopened through the back door. Anchoring explicitly on `forgeRoot` makes
    // the mint correct by construction rather than by incidental cwd alignment.
    const queueRoot = opts.queueRoot ?? join(forgeRoot, '_queue');
    const paths = getPaths(queueRoot);
    // Id from validated tokens only: kind + flow ref + a time suffix. Two
    // origination fires for the SAME flow within one second would otherwise
    // collide (identical date/origin/flow/hms) and the second write would
    // silently clobber the first's manifest — so append the smallest numeric
    // suffix that is free across EVERY queue state dir (a `-2` slug stays
    // INIT_ID_RE-valid). Deterministic + no reliance on sub-second clock
    // resolution.
    const baseId = `INIT-${date}-${idToken(req.origin)}-${idToken(flowId)}-${hms}`;
    let initiativeId = baseId;
    for (let n = 2; idExistsInQueue(paths, initiativeId); n++) {
      initiativeId = `${baseId}-${n}`;
    }

    // R2-08-F4: trigger provenance, derived from the staged request alone
    // and persisted onto the manifest's own frontmatter (never a new stored
    // object — run-model.ts reads it straight off this SAME manifest).
    const triggerFields = deriveTriggerFields(req);

    const manifest: InitiativeManifest = {
      initiative_id: initiativeId,
      project: flow.project,
      project_repo_path: projectRepoPath,
      created_at: now.toISOString(),
      iteration_budget: budgets.defaultIterationBudget,
      cost_budget_usd: budgets.defaultCostBudgetUsd,
      phase: 'pending',
      origin: 'triggered',
      flow_id: flowId,
      ...(triggerFields
        ? {
            trigger_kind: triggerFields.kind,
            trigger_source: triggerFields.source,
            ...(triggerFields.scope !== undefined ? { trigger_scope: triggerFields.scope } : {}),
          }
        : {}),
      body: [
        `# ${initiativeId}`,
        '',
        `Originated by an external trigger (${req.origin}: ${req.triggeredBy}) targeting flow \`${flowId}\`.`,
        'The typed trigger payload is persisted as the `trigger-payload` artifact in the cycle log',
        '(data, never prompt text — ADR-041).',
      ].join('\n'),
    };
    // SEC-03 (Defect 3): route through the single write choke point
    // (`writeManifest`, orchestrator/manifest.ts) rather than
    // `serializeManifest` + `writeFileSync` directly. `writeManifest` runs
    // full `validateManifest` AND `assertManifestPathFields` (the SEC-02
    // containment guard on `project` / `project_repo_path` / `worktree_path` /
    // `cycle_id`) BEFORE any bytes land on disk, and creates `pending/` itself
    // — the old `mkdirSync(paths.pending, ...)` above is therefore dead and
    // has been removed rather than kept as false assurance. `writeManifest`
    // throws on a rejected manifest; that throw is caught by this function's
    // own try/catch (below) and surfaces as `{status:'error', detail}` — fail
    // closed, never a silently-written unsafe manifest.
    const manifestPath = writeManifest(manifest, { queueRoot });
    mintAndPersistManifestCycleId(manifestPath, initiativeId);

    // Persist the typed payload beside the cycle's artifacts (read-as-data).
    if (req.payload) {
      const cycleId = readManifestCycleId(manifestPath) ?? initiativeId;
      const logsRoot = opts.logsRoot ?? join(forgeRoot, '_logs');
      const artDir = join(logsRoot, cycleId, 'artifacts');
      mkdirSync(artDir, { recursive: true });
      writeFileSync(join(artDir, 'trigger-payload.json'), JSON.stringify(req.payload, null, 2) + '\n');
    }
    return { status: 'minted', initiativeId };
  } catch (err) {
    return { status: 'error', detail: err instanceof Error ? err.message : String(err) };
  }
}
