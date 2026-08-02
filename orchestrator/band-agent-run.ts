/**
 * band-agent-run.ts — standalone isolation surface for the band-hook node
 * agents (R4-10-F3, ADR-039).
 *
 * The develop flow's two successor agents — `demo-agent` and
 * `adversarial-review` — are "banded": in the flow they run through their
 * orchestrator-band pipelines (`runDemoAgentPipeline` / `runAdversarialReview`),
 * NOT the bare `runAgent` primitive the generic `dispatchAgentRun` uses. So
 * running one "standalone" through the generic dispatch would spawn the bare
 * SKILL.md with none of the pipeline's bands (derive / validate / orchestrated
 * capture / judgment / harvest) — different, weaker artifacts. This module is
 * the isolation surface that keeps PARITY: it runs the SAME pipeline function
 * the flow's band executor runs, against an EXISTING initiative's worktree, so
 * a standalone run produces exactly the artifacts a flow run does (the diagram's
 * ship-both principle — the agents are valuable in isolation, not only in a
 * flow). developer-ralph's standalone unit is `runDeveloperLoop` (already the
 * dev node); this module covers the two one-shot band pipelines.
 *
 * The worktree/cycle context is resolved from the initiative's manifest in the
 * queue (a standalone demo/review only makes sense against a post-develop
 * branch — the pipelines derive from the git diff). NO gate/CI runs here
 * (ADR-036 posture, same as `dispatchAgentRun`) — the pipeline judges + the
 * orchestrated capture runs its own commands, nothing more.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { parseManifest } from './manifest.ts';
import { getPaths } from './queue.ts';
import { createLogger } from './logging.ts';
import { loadAgentDefinition } from './studio/registry.ts';
import { skillPath } from './skill-path.ts';
import { resolveBandHook } from './agent-bands.ts';
import { runDemoAgentPipeline, type DemoAgentPipelineResult } from './phases/demo-agent.ts';
import { runAdversarialReview, type AdversarialReviewResult } from './phases/adversarial-review.ts';
import type { StreamQueryFn } from './pinned-sdk-query.ts';

/** The two band-hook slugs runnable standalone here → their pipeline kind. */
const STANDALONE_BAND_SLUGS: Record<string, 'demo' | 'review'> = {
  'demo-agent': 'demo',
  'adversarial-review': 'review',
};

export type BandAgentStandaloneResult =
  | { kind: 'demo'; slug: string; initiativeId: string; result: DemoAgentPipelineResult }
  | { kind: 'review'; slug: string; initiativeId: string; result: AdversarialReviewResult };

export type RunBandAgentStandaloneOpts = {
  slug: string;
  initiativeId: string;
  /** `_logs` root; default `<cwd>/_logs`. */
  logsRoot?: string;
  /** Root carrying `studio/` + `brain/`; default `<cwd>`. */
  forgeRoot?: string;
  /** Queue root; default `<cwd>/_queue`. */
  queueRoot?: string;
  /** Test-injection only (see `runAgent`'s `queryFn`). */
  queryFn?: StreamQueryFn;
};

/** True iff `slug` is a band-hook agent this surface can run standalone. */
export function isStandaloneBandAgent(slug: string): boolean {
  return slug in STANDALONE_BAND_SLUGS;
}

/**
 * Locate an initiative's manifest across the queue (any state) and parse the
 * fields the band pipelines need. Throws a clear boundary error when the
 * initiative isn't in the queue or its worktree is gone (a standalone
 * demo/review has nothing to derive from).
 */
function resolveInitiativeContext(
  initiativeId: string,
  queueRoot?: string,
): { worktreePath: string; cycleId: string; projectRepoPath: string; costBudgetUsd?: number } {
  const paths = getPaths(queueRoot);
  const dirs = [paths.readyForReview, paths.inFlight, paths.pending, paths.merged, paths.done, paths.failed];
  let manifestPath: string | null = null;
  for (const dir of dirs) {
    const candidate = join(dir, `${initiativeId}.md`);
    if (existsSync(candidate)) { manifestPath = candidate; break; }
  }
  if (!manifestPath) {
    throw new Error(
      `runBandAgentStandalone: no manifest for initiative "${initiativeId}" in any queue state — ` +
        `a standalone demo/review runs against an existing post-develop branch`,
    );
  }
  const m = parseManifest(readFileSync(manifestPath, 'utf8'));
  const worktreePath = m.worktree_path ?? '';
  if (!worktreePath || !existsSync(worktreePath)) {
    throw new Error(
      `runBandAgentStandalone: initiative "${initiativeId}" has no live worktree (worktree_path=${JSON.stringify(m.worktree_path)}) — ` +
        `its develop phase must have produced a branch to demo/review`,
    );
  }
  return {
    worktreePath,
    cycleId: m.cycle_id ?? initiativeId,
    projectRepoPath: m.project_repo_path ?? '',
    costBudgetUsd: m.cost_budget_usd,
  };
}

/**
 * Run one band-hook node agent standalone through its FLOW pipeline (parity),
 * against an existing initiative's worktree. Returns the pipeline result.
 */
export async function runBandAgentStandalone(
  opts: RunBandAgentStandaloneOpts,
): Promise<BandAgentStandaloneResult> {
  const kind = STANDALONE_BAND_SLUGS[opts.slug];
  if (!kind) {
    // Belt-and-suspenders: the caller should have checked isStandaloneBandAgent.
    const def = loadAgentDefinition(skillPath(opts.slug));
    const hook = resolveBandHook(def);
    throw new Error(
      `runBandAgentStandalone: agent "${opts.slug}" is not a standalone-runnable band agent` +
        (hook ? ` (band hook "${hook}" has no standalone pipeline surface)` : ' (no band hook)'),
    );
  }
  const logsRoot = opts.logsRoot ? resolve(opts.logsRoot) : resolve('_logs');
  const forgeRoot = opts.forgeRoot;
  const ctx = resolveInitiativeContext(opts.initiativeId, opts.queueRoot);
  const logger = createLogger(ctx.cycleId, logsRoot);

  if (kind === 'demo') {
    const result = await runDemoAgentPipeline(
      {
        initiativeId: opts.initiativeId,
        worktreePath: ctx.worktreePath,
        cycleId: ctx.cycleId,
        logsRoot,
        costBudgetUsd: ctx.costBudgetUsd,
        ...(forgeRoot ? { forgeRoot } : {}),
      },
      logger,
      { queryFn: opts.queryFn },
    );
    return { kind: 'demo', slug: opts.slug, initiativeId: opts.initiativeId, result };
  }

  const result = await runAdversarialReview(
    {
      initiativeId: opts.initiativeId,
      worktreePath: ctx.worktreePath,
      cycleId: ctx.cycleId,
      logsRoot,
      costBudgetUsd: ctx.costBudgetUsd,
      ...(ctx.projectRepoPath ? { projectName: basename(ctx.projectRepoPath) } : {}),
      ...(forgeRoot ? { forgeRoot } : {}),
    },
    logger,
    { queryFn: opts.queryFn },
  );
  return { kind: 'review', slug: opts.slug, initiativeId: opts.initiativeId, result };
}
