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
 * the flow's band executor runs, against an EXISTING initiative's worktree, so a
 * standalone run produces the same artifacts a flow run does (the diagram's
 * ship-both principle). developer-ralph's standalone unit is `runDeveloperLoop`
 * (the dev node); this module covers the two one-shot band pipelines.
 *
 * ISOLATION (R4-10-F3 review, 2026-08-03). A standalone run must NOT corrupt the
 * initiative's real cycle:
 *   - It runs under the dispatch `runId`, not the initiative's `cycle_id`: the
 *     pipeline's events + `_logs/<runId>/artifacts/` (demo-fix-spec /
 *     review-findings) land under the runId — so the bridge's run-status endpoint
 *     (which keys on runId) resolves the run, and the real cycle's authoritative
 *     event log + artifacts are never appended to / overwritten.
 *   - It REFUSES an in-flight (or pending) initiative — a live scheduler cycle
 *     owns that worktree; a second writer on the same `.git` index would race /
 *     clobber it. Only terminal-ish states with a settled worktree
 *     (ready-for-review / failed / done / merged) are runnable.
 *   - `initiativeId` is validated (it is joined into a manifest path) and
 *     `worktree_path` is bounds-checked (a tampered manifest can't redirect the
 *     spawn cwd / git target outside the forge roots).
 * The initiative's demo bundle (demo.json/DEMO.md at `demo/<initiativeId>/`) is
 * still authored on its own branch — a standalone demo re-run legitimately
 * refreshes the initiative's demo; only the cross-cycle `_logs` record is isolated.
 * NO gate/CI runs here (ADR-036 posture, same as `dispatchAgentRun`).
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';

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

/** Safe manifest-file stem — no path separators / traversal (it is joined into a queue path). */
const SAFE_INITIATIVE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export type BandAgentStandaloneResult =
  | { kind: 'demo'; slug: string; initiativeId: string; runId: string; result: DemoAgentPipelineResult }
  | { kind: 'review'; slug: string; initiativeId: string; runId: string; result: AdversarialReviewResult };

export type RunBandAgentStandaloneOpts = {
  slug: string;
  initiativeId: string;
  /**
   * The dispatch run identity — the run's events + `_logs/<runId>/artifacts/`
   * land under THIS (never the initiative's cycle_id), so the run is isolated
   * from the real cycle and the bridge's runId-keyed status endpoint resolves it.
   */
  runId: string;
  /** `_logs` root; default `<cwd>/_logs`. */
  logsRoot?: string;
  /** Root carrying `studio/` + `brain/` + the queue/worktree roots; default `<cwd>`. */
  forgeRoot?: string;
  /** Queue root; default `<forgeRoot ?? cwd>/_queue`. */
  queueRoot?: string;
  /** Test-injection only (see `runAgent`'s `queryFn`). */
  queryFn?: StreamQueryFn;
};

/** True iff `slug` is a band-hook agent this surface can run standalone. */
export function isStandaloneBandAgent(slug: string): boolean {
  return slug in STANDALONE_BAND_SLUGS;
}

/** worktree_path must resolve INSIDE the forge project/worktree roots — a tampered
 *  manifest cannot redirect the spawn cwd + git operations to an arbitrary path. */
function assertWorktreeInBounds(worktreePath: string, forgeRoot: string): void {
  const resolved = resolve(worktreePath);
  const roots = [resolve(forgeRoot, 'projects'), resolve(forgeRoot, '_worktrees')];
  if (!roots.some((r) => resolved === r || resolved.startsWith(r + sep))) {
    throw new Error(
      `runBandAgentStandalone: worktree_path ${JSON.stringify(worktreePath)} is outside the forge roots ` +
        `(${roots.join(', ')}) — refusing to run against it`,
    );
  }
}

/**
 * Locate an initiative's manifest across the queue and parse the fields the band
 * pipelines need. Throws a clear boundary error when the initiative isn't in the
 * queue, is owned by a LIVE cycle (in-flight / pending), or its worktree is gone
 * / out of bounds.
 */
function resolveInitiativeContext(
  initiativeId: string,
  queueRoot: string,
  forgeRoot: string,
): { worktreePath: string; projectRepoPath: string; costBudgetUsd?: number } {
  if (!SAFE_INITIATIVE_RE.test(initiativeId)) {
    throw new Error(`runBandAgentStandalone: invalid initiative id ${JSON.stringify(initiativeId)} (a manifest-file stem: [A-Za-z0-9._-])`);
  }
  const paths = getPaths(queueRoot);
  // Settled states are runnable; in-flight/pending are owned by a live cycle.
  const runnable: Array<{ dir: string; state: string }> = [
    { dir: paths.readyForReview, state: 'ready-for-review' },
    { dir: paths.failed, state: 'failed' },
    { dir: paths.done, state: 'done' },
    { dir: paths.merged, state: 'merged' },
  ];
  const owned: Array<{ dir: string; state: string }> = [
    { dir: paths.inFlight, state: 'in-flight' },
    { dir: paths.pending, state: 'pending' },
  ];
  for (const { dir, state } of owned) {
    if (existsSync(join(dir, `${initiativeId}.md`))) {
      throw new Error(
        `runBandAgentStandalone: initiative "${initiativeId}" is ${state} — a live scheduler cycle owns its worktree; ` +
          `refusing to run standalone against it (would race the cycle). Re-run once it settles (ready-for-review / failed / done).`,
      );
    }
  }
  let manifestPath: string | null = null;
  for (const { dir } of runnable) {
    const candidate = join(dir, `${initiativeId}.md`);
    if (existsSync(candidate)) { manifestPath = candidate; break; }
  }
  if (!manifestPath) {
    throw new Error(
      `runBandAgentStandalone: no runnable manifest for initiative "${initiativeId}" (searched ready-for-review / failed / done / merged) — ` +
        `a standalone demo/review runs against an existing, settled post-develop branch`,
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
  assertWorktreeInBounds(worktreePath, forgeRoot);
  return { worktreePath, projectRepoPath: m.project_repo_path ?? '', costBudgetUsd: m.cost_budget_usd };
}

/**
 * Run one band-hook node agent standalone through its FLOW pipeline (parity),
 * against an existing initiative's settled worktree. Isolated under `runId`.
 */
export async function runBandAgentStandalone(
  opts: RunBandAgentStandaloneOpts,
): Promise<BandAgentStandaloneResult> {
  const kind = STANDALONE_BAND_SLUGS[opts.slug];
  if (!kind) {
    const def = loadAgentDefinition(skillPath(opts.slug));
    const hook = resolveBandHook(def);
    throw new Error(
      `runBandAgentStandalone: agent "${opts.slug}" is not a standalone-runnable band agent` +
        (hook ? ` (band hook "${hook}" has no standalone pipeline surface)` : ' (no band hook)'),
    );
  }
  if (!opts.runId) throw new Error('runBandAgentStandalone: runId is required (the isolated run identity)');
  const forgeRoot = opts.forgeRoot ? resolve(opts.forgeRoot) : resolve('.');
  const logsRoot = opts.logsRoot ? resolve(opts.logsRoot) : join(forgeRoot, '_logs');
  const queueRoot = opts.queueRoot ? resolve(opts.queueRoot) : join(forgeRoot, '_queue');
  const ctx = resolveInitiativeContext(opts.initiativeId, queueRoot, forgeRoot);

  // Isolate under the runId: events + _logs artifacts land under _logs/<runId>/,
  // NOT the initiative's cycle_id — so the run-status endpoint resolves it and
  // the real cycle's authoritative log/artifacts are never touched. Wrap the
  // logger to sum cost_usd so the terminal `end` carries the run's total (the
  // "events/cost visible" AC the run surface exists for).
  const base = createLogger(opts.runId, logsRoot);
  let costUsd = 0;
  const logger: typeof base = {
    ...base,
    emit(partial) {
      const entry = base.emit(partial);
      if (typeof entry.cost_usd === 'number' && entry.cost_usd > 0) costUsd += entry.cost_usd;
      return entry;
    },
  };

  // Terminal `start`/`end` boundary (phase:'orchestrator', event_type:'start'/'end')
  // so the runId-keyed status endpoint resolves the run to 'done' + a cost — the
  // band pipelines emit only 'log'/'error', never the 'end' the endpoint reads.
  base.emit({
    initiative_id: opts.initiativeId,
    phase: 'orchestrator',
    skill: opts.slug,
    event_type: 'start',
    input_refs: [ctx.worktreePath],
    output_refs: [],
    metadata: { agent_slug: opts.slug, standalone: true, initiative_id: opts.initiativeId },
  });

  let result: DemoAgentPipelineResult | AdversarialReviewResult;
  if (kind === 'demo') {
    result = await runDemoAgentPipeline(
      { initiativeId: opts.initiativeId, worktreePath: ctx.worktreePath, cycleId: opts.runId, logsRoot, costBudgetUsd: ctx.costBudgetUsd, forgeRoot },
      logger,
      { queryFn: opts.queryFn },
    );
  } else {
    result = await runAdversarialReview(
      {
        initiativeId: opts.initiativeId, worktreePath: ctx.worktreePath, cycleId: opts.runId, logsRoot, costBudgetUsd: ctx.costBudgetUsd,
        ...(ctx.projectRepoPath ? { projectName: basename(ctx.projectRepoPath) } : {}),
        forgeRoot,
      },
      logger,
      { queryFn: opts.queryFn },
    );
  }

  base.emit({
    initiative_id: opts.initiativeId,
    phase: 'orchestrator',
    skill: opts.slug,
    event_type: 'end',
    input_refs: [],
    output_refs: [],
    cost_usd: costUsd,
    metadata: { agent_slug: opts.slug, standalone: true, kind, pipeline_status: result.status },
  });

  return kind === 'demo'
    ? { kind: 'demo', slug: opts.slug, initiativeId: opts.initiativeId, runId: opts.runId, result: result as DemoAgentPipelineResult }
    : { kind: 'review', slug: opts.slug, initiativeId: opts.initiativeId, runId: opts.runId, result: result as AdversarialReviewResult };
}
