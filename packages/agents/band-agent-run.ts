/**
 * band-agent-run.ts — standalone isolation surface for the band-guard node
 * agents (R4-10-F3, ADR-039). Carved out of `orchestrator/band-agent-run.ts`.
 *
 * The develop flow's two successor agents — `demo-agent` and
 * `adversarial-review` — are "banded": in the flow they run through their
 * band pipelines (`runDemoAgentPipeline` / `runAdversarialReview`), NOT the
 * bare `runAgent` primitive the generic `dispatchAgentRun` uses. So running one
 * "standalone" through the generic dispatch would spawn the bare SKILL.md with
 * none of the pipeline's bands (derive / validate / orchestrated capture /
 * judgment / harvest) — different, weaker artifacts. This module is the
 * isolation surface that keeps PARITY: it runs the SAME pipeline function the
 * flow's band executor runs, against an EXISTING initiative's worktree, so a
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
 *
 * THE PORT, AND WHY IT IS NOT `PhaseExecutor` (measured 2026-09-03, M4-agents).
 * This package is rank 3; the two pipelines are `@forge/factory` (rank 7) and the
 * queue/manifest readers are `@forge/flows` (rank 6). None of the three may be
 * imported here, so all three arrive as `BandAgentDeps`, bound at
 * `apps/forge/cli.ts`. The plan named `packages/kernel/ports.ts`'s
 * `PhaseExecutor` for the pipelines; it does not fit and was not forced.
 * `PhaseExecutor.run` returns `CycleOutcome`, which is
 * `'merged' | 'pr-open' | 'ready-for-review'` (`packages/contracts/index.ts:138`)
 * — a whole-cycle verdict. What crosses this seam is a PIPELINE status
 * (`complete` / `complete-with-misses` / `failed`), which the run's terminal
 * `end` event, the CLI's summary line and three tests all read. Routing it
 * through `PhaseExecutor` would either discard that status or require a cast
 * that lies about the value (COMMON §15.66). So the port is declared here, at
 * the package that owns the seam (ruling 59's shape: the deps type belongs to
 * the package whose surface needs it), and it is narrow: one call, one status.
 *
 * What did NOT leave: every guard. The initiative-id charset check, the
 * in-flight refusal and the worktree bounds check stay in this module — a carve
 * that exported a guard-bearing helper "for the duration" would be a
 * security-invariant breach, not a smaller diff (COMMON §15.47).
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';

import { createLogger, type EventLogger } from '@forge/kernel';
import { loadAgentDefinition } from './studio/agent-registry.ts';
import { skillPath } from './skill-path.ts';
import { resolveBandGuard } from './agent-bands.ts';
import type { StreamQueryFn } from './pinned-sdk-query.ts';

/** The two band-guard slugs runnable standalone here → their pipeline kind. */
const STANDALONE_BAND_SLUGS: Record<string, BandPipelineKind> = {
  'demo-agent': 'demo',
  'adversarial-review': 'review',
};

/** Safe manifest-file stem — no path separators / traversal (it is joined into a queue path). */
const SAFE_INITIATIVE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export type BandPipelineKind = 'demo' | 'review';

/**
 * The six queue state directories this surface reads. Declared with every field
 * REQUIRED and by name, so the real `getPaths` from `@forge/flows/queue.ts`
 * satisfies it structurally at the assembly site and a rename there breaks the
 * repo-wide typecheck rather than passing a fake in this package's own tests
 * (COMMON §15.71).
 */
export type BandQueuePaths = {
  pending: string;
  inFlight: string;
  readyForReview: string;
  merged: string;
  done: string;
  failed: string;
};

/** The three manifest fields the band surface reads; `parseManifest`'s result satisfies it. */
export type BandInitiativeFields = {
  worktree_path?: string | undefined;
  project_repo_path?: string | undefined;
  cost_budget_usd?: number | undefined;
};

/** What the injected pipeline runner is handed — the union of the two pipelines' inputs. */
export type BandPipelineInput = {
  initiativeId: string;
  worktreePath: string;
  /** The RUN id, never the initiative's `cycle_id` — this is the isolation. */
  cycleId: string;
  logsRoot: string;
  costBudgetUsd?: number | undefined;
  /** Review only: the managed-project name for the Brain-3 advisory context. */
  projectName?: string | undefined;
  forgeRoot: string;
};

export type BandPipelineCall = {
  kind: BandPipelineKind;
  input: BandPipelineInput;
  logger: EventLogger;
  queryFn?: StreamQueryFn | undefined;
};

/**
 * The status the pipelines report. Narrower than either pipeline's full result
 * type (which names factory-owned artifact paths this package has no use for):
 * the status is what the run's `end` event, the CLI summary and the callers read.
 */
export type BandPipelineOutcome = { status: 'complete' | 'complete-with-misses' | 'failed' };

/** Everything above this package's rank, bound once at `apps/forge/cli.ts`. */
export type BandAgentDeps = {
  /** `@forge/factory/phases/{demo-agent,adversarial-review}.ts`, behind one call. */
  runPipeline(call: BandPipelineCall): Promise<BandPipelineOutcome>;
  /** `getPaths` from `@forge/flows/queue.ts`. */
  queuePaths(queueRoot: string): BandQueuePaths;
  /** `parseManifest` from `@forge/flows/manifest.ts`. */
  parseInitiativeManifest(content: string): BandInitiativeFields;
};

export type BandAgentStandaloneResult = {
  kind: BandPipelineKind;
  slug: string;
  initiativeId: string;
  runId: string;
  result: BandPipelineOutcome;
};

export type RunBandAgentStandaloneOpts = {
  slug: string;
  initiativeId: string;
  /**
   * The dispatch run identity — the run's events + `_logs/<runId>/artifacts/`
   * land under THIS (never the initiative's cycle_id), so the run is isolated
   * from the real cycle and the bridge's runId-keyed status endpoint resolves it.
   */
  runId: string;
  /** `_logs` root; default `<forgeRoot>/_logs`. */
  logsRoot?: string;
  /** Root carrying `studio/` + `brain/` + the queue/worktree roots; default `<cwd>`. */
  forgeRoot?: string;
  /** Queue root; default `<forgeRoot ?? cwd>/_queue`. */
  queueRoot?: string;
  /** Test-injection only (see `runAgent`'s `queryFn`). */
  queryFn?: StreamQueryFn;
};

/** True iff `slug` is a band-guard agent this surface can run standalone. */
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
  deps: BandAgentDeps,
): { worktreePath: string; projectRepoPath: string; costBudgetUsd?: number } {
  if (!SAFE_INITIATIVE_RE.test(initiativeId)) {
    throw new Error(`runBandAgentStandalone: invalid initiative id ${JSON.stringify(initiativeId)} (a manifest-file stem: [A-Za-z0-9._-])`);
  }
  const paths = deps.queuePaths(resolve(queueRoot));
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
  const m = deps.parseInitiativeManifest(readFileSync(manifestPath, 'utf8'));
  const worktreePath = m.worktree_path ?? '';
  if (!worktreePath || !existsSync(worktreePath)) {
    throw new Error(
      `runBandAgentStandalone: initiative "${initiativeId}" has no live worktree (worktree_path=${JSON.stringify(m.worktree_path)}) — ` +
        `its develop phase must have produced a branch to demo/review`,
    );
  }
  assertWorktreeInBounds(worktreePath, forgeRoot);
  return {
    worktreePath,
    projectRepoPath: m.project_repo_path ?? '',
    ...(m.cost_budget_usd === undefined ? {} : { costBudgetUsd: m.cost_budget_usd }),
  };
}

/**
 * Run one band-guard node agent standalone through its FLOW pipeline (parity),
 * against an existing initiative's settled worktree. Isolated under `runId`.
 */
export async function runBandAgentStandalone(
  opts: RunBandAgentStandaloneOpts,
  deps: BandAgentDeps,
): Promise<BandAgentStandaloneResult> {
  const kind = STANDALONE_BAND_SLUGS[opts.slug];
  if (!kind) {
    const def = loadAgentDefinition(skillPath(opts.slug));
    const guard = resolveBandGuard(def);
    throw new Error(
      `runBandAgentStandalone: agent "${opts.slug}" is not a standalone-runnable band agent` +
        (guard ? ` (band guard "${guard}" has no standalone pipeline surface)` : ' (no band guard)'),
    );
  }
  if (!opts.runId) throw new Error('runBandAgentStandalone: runId is required (the isolated run identity)');
  const forgeRoot = opts.forgeRoot ? resolve(opts.forgeRoot) : resolve('.');
  const logsRoot = opts.logsRoot ? resolve(opts.logsRoot) : join(forgeRoot, '_logs');
  const queueRoot = opts.queueRoot ? resolve(opts.queueRoot) : join(forgeRoot, '_queue');
  const ctx = resolveInitiativeContext(opts.initiativeId, queueRoot, forgeRoot, deps);

  // Isolate under the runId: events + _logs artifacts land under _logs/<runId>/,
  // NOT the initiative's cycle_id — so the run-status endpoint resolves it and
  // the real cycle's authoritative log/artifacts are never touched. Wrap the
  // logger to sum cost_usd so the terminal `end` carries the run's total (the
  // "events/cost visible" AC the run surface exists for).
  const base = createLogger(opts.runId, logsRoot);
  let costUsd = 0;
  const logger: EventLogger = {
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

  const result = await deps.runPipeline({
    kind,
    input: {
      initiativeId: opts.initiativeId,
      worktreePath: ctx.worktreePath,
      cycleId: opts.runId,
      logsRoot,
      ...(ctx.costBudgetUsd === undefined ? {} : { costBudgetUsd: ctx.costBudgetUsd }),
      ...(kind === 'review' && ctx.projectRepoPath ? { projectName: basename(ctx.projectRepoPath) } : {}),
      forgeRoot,
    },
    logger,
    queryFn: opts.queryFn,
  });

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

  return { kind, slug: opts.slug, initiativeId: opts.initiativeId, runId: opts.runId, result };
}

/** What `forge agent dispatch` needs back from the band branch. */
export type StandaloneBandDispatch =
  | { ok: false; usage: string }
  | { ok: true; summary: string };

/**
 * The `forge agent dispatch <band-slug>` branch, in one place: the usage
 * refusal, the missing-binding refusal, the run, and the summary line.
 *
 * Two refusals with deliberately different shapes. A missing
 * `--input initiative=<id>` is an OPERATOR mistake — `{ ok: false }`, so the
 * caller prints usage and exits 2 like every other argument failure, before the
 * run exists. An absent `band` binding is a BUILD mistake — it throws, so the
 * caller's catch records the run's terminal failure marker (bead 5.38: a
 * requested run that cannot proceed still owes the bridge a terminus) and exits
 * 1. Neither ever falls through to the generic dispatch: that would spawn the
 * bare SKILL.md with none of the pipeline's bands and report success, which is
 * the weaker-artifacts failure this whole module exists to prevent.
 */
export async function dispatchStandaloneBand(
  args: { slug: string; initiativeId: string | undefined; runId: string; forgeRoot: string },
  band: BandAgentDeps | undefined,
): Promise<StandaloneBandDispatch> {
  if (!args.initiativeId) {
    return { ok: false, usage: `standalone "${args.slug}" needs --input initiative=<id> (the post-develop initiative to run against)` };
  }
  if (!band) {
    throw new Error(
      `standalone "${args.slug}" runs its FLOW pipeline, and this invocation was built without the band ` +
        'pipelines injected (deps.band) — refusing rather than spawning the bare SKILL.md, which would ' +
        'produce band-less artifacts. The CLI entry point (apps/forge/cli.ts) binds them.',
    );
  }
  const out = await runBandAgentStandalone(
    { slug: args.slug, initiativeId: args.initiativeId, runId: args.runId, forgeRoot: args.forgeRoot, queryFn: undefined },
    band,
  );
  return {
    ok: true,
    summary: `agent dispatch complete — ${out.slug} (standalone ${out.kind} pipeline) run ${out.runId} on ${out.initiativeId} → ${out.result.status}`,
  };
}
