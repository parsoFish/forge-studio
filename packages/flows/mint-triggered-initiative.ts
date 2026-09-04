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

import { defaultConfigPath, guardedFile, loadConfig, resolveProjectsDir, resolveTriggeredRunBudgets } from '@forge/kernel';
import { writeManifest, mintAndPersistManifestCycleId, readManifestCycleId, type InitiativeManifest } from './manifest.ts';
import { getPaths } from './queue.ts';
import { loadFlowDefinition } from '../../orchestrator/studio/registry.ts';
import type { FlowRunRequest } from './flow-run-requests.ts';
import { FLOW_ID_RE } from './enqueue-flow-run.ts';

export type MintTriggeredResult = {
  status: 'minted' | 'no-project' | 'error';
  initiativeId?: string;
  detail?: string;
};

/**
 * True if `<id>.md` already exists in ANY queue state dir (collision guard).
 *
 * Bead forge-8vfn.5.36 widened the raw-fs lint's taint set with the bare
 * parameter name `id`, which made this site visible for the first time. It was
 * already safe — `id` reaches here only from `idToken()`, which slugifies to
 * `[a-z0-9-]` and caps at 24 characters, so no separator and no dot can
 * survive — but "safe because a slugify forty lines up says so" is an
 * invariant held by a comment. Routed through `guardedFile` so the guard holds
 * it instead: the id rides as a SEGMENT under a config-derived queue root,
 * never folded into the root.
 */
function idExistsInQueue(paths: ReturnType<typeof getPaths>, id: string): boolean {
  const file = `${id}.md`;
  return [paths.pending, paths.inFlight, paths.readyForReview, paths.merged, paths.done, paths.failed].some(
    (d) => guardedFile(d, [file], 'read') !== null,
  );
}

/** Lowercase-slugify a validated token for the initiative id (never free text). */
function idToken(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'run';
}

/**
 * R2-08-F4 (ADR-027 amendment; round-2 correction): derive the
 * trigger-provenance fields to persist on the minted manifest, from the
 * staged request alone — never from `req.payload` (free-text/external data;
 * the attacker-payload acceptance test pins that `trigger` never carries
 * payload text). `source` is always a DEFINITION id:
 *   - `agent-complete` → the completed agent's own slug (`sourceAgent`).
 *   - `webhook`        → ONLY `sourceFlowId` — the declaring flow, threaded
 *     by the caller (bridge-hooks.ts's `findWebhookTrigger` resolves it;
 *     `triggeredBy` deliberately stays the hook-id slug `webhook:<hookId>`
 *     for its own readers, and a hook id is NOT a definition id). NO
 *     fallback: a webhook request with no resolved declaring flow has no
 *     honest provenance at all — `null`, never a degraded trigger whose
 *     `source` is a hook-id slug (round-2 ruling; the earlier fallback that
 *     stripped `webhook:` off `triggeredBy` produced exactly that forbidden
 *     shape and is deleted).
 *   - `cron`           → ONLY `sourceFlowId` (every real `cron-triggers.ts`
 *     fire sets it, for the same one-mechanism-per-field reason as webhook).
 *     NO fallback (forge-76y, T1 ruling — arm 1 deletion): an earlier version
 *     of this arm recovered the declaring flow id by parsing `triggeredBy`'s
 *     `cron:<flowId>` prefix when `sourceFlowId` was absent, but no real
 *     caller ever omits it — only pre-fix hand-built test fixtures did, and
 *     the fixture builder (`orchestrator/test-fixtures/flow-run-request.ts`)
 *     now threads it by default. Same no-fallback posture as webhook above.
 * Only these three origins ever reach this function (drainFlowRunRequests
 * routes chaining's `origin: 'trigger'` through `enqueueFlowRun` instead,
 * never through mint). Returns `null` when no honest source is derivable at
 * all — never a fabricated placeholder.
 *
 * `kind` (adversarial-review fix, R2-08-F3): reads `req.triggerKind` — the
 * DECLARATION's own `on:` value — falling back to `req.origin` only when
 * absent. `origin` alone is NOT `kind`: it describes the mint/transport
 * mechanism, and `origin: 'webhook'` now covers THREE distinct registry
 * kinds (`webhook`, `pr-merged`, `issue-raised` all share the
 * signature-verified `/api/hooks/:hookId` receiver — R2-08-F3). Reading
 * `req.origin` directly here would collapse all three onto the single
 * reported value `'webhook'`, contradicting ADR-027's "kind: the registry
 * id, the declaration that fired" contract. `cron`/`agent-complete` origins
 * stay unambiguously 1:1 with their registry kind (there is no `on: cron`
 * sub-vocabulary), so their real callers never need to set `triggerKind` —
 * the fallback covers them exactly as before. NEVER sourced from
 * `req.payload` (external/attacker data) — same exclusion `source` above
 * already honours.
 */
function deriveTriggerFields(req: FlowRunRequest): { kind: string; source: string; scope?: string } | null {
  let source: string | undefined;
  if (req.origin === 'agent-complete') {
    source = req.sourceAgent;
  } else if (req.origin === 'webhook') {
    source = req.sourceFlowId;
  } else if (req.origin === 'cron') {
    // forge-76y (T1 ruling, arm 1 deletion): every real cron fire
    // (cron-triggers.ts's `makeFireFn`) always threads `sourceFlowId` — the
    // `?? parse(triggeredBy)` fallback this arm used to have was only ever
    // reached by hand-built test fixtures that omitted it, never by a real
    // caller. Deleted; a cron request with no `sourceFlowId` now has no
    // honest provenance, same as webhook's existing no-fallback rule.
    source = req.sourceFlowId;
  }
  if (!source) return null;
  return {
    kind: req.triggerKind ?? req.origin,
    source,
    ...(req.eventProject !== undefined && req.eventProject !== null ? { scope: req.eventProject } : {}),
  };
}

export function mintTriggeredInitiative(
  req: FlowRunRequest,
  opts: { queueRoot?: string; forgeRoot?: string; logsRoot?: string } = {},
): MintTriggeredResult {
  try {
    const forgeRoot = opts.forgeRoot ?? resolve(import.meta.dirname, '..', '..');
    const flowId = req.target.ref;
    // W8-F5 (bead forge-6gv.23): `flowId` is a PATH SEGMENT on the very next
    // line, and from there the value flows into projectRepoPath and artDir.
    // `enqueueFlowRun` already refuses a ref that is not a flow-id slug (its
    // FLOW_ID_RE is described as "a path-traversal guard on the flow ref"); the
    // mint path — reached from cron, the webhook receiver and agent-complete —
    // read the same field with no guard. Same rule, same regex, fail closed
    // through this function's existing typed error shape.
    if (!FLOW_ID_RE.test(flowId ?? '')) {
      return { status: 'error', detail: `target ref ${JSON.stringify(flowId ?? '')} is not a valid flow id slug` };
    }
    const flow = loadFlowDefinition(join(forgeRoot, 'studio', 'flows', flowId, 'flow.yaml'));
    if (!flow.project) {
      return { status: 'no-project', detail: `flow "${flowId}" has no project binding — external triggers need one (lint: trigger-cron/trigger-webhook/trigger-agent-complete)` };
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
      // W7-FIX-A4 (W7A4-01): a human title for the ONE display derivation
      // (`initiativeTitle`, manifest.ts) — the flow's name + how it fired —
      // so a triggered run never renders as its raw INIT id in a ledger.
      title: `${flow.name || flowId} (${req.origin} trigger)`,
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
