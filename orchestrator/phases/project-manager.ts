/**
 * Project-manager phase runner.
 *
 * Invokes the PM skill via the Claude Agent SDK, validates the emitted work
 * items, and emits decomposition telemetry.
 */

import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pinnedSdkQuery as sdkQuery } from '../pinned-sdk-query.ts';

import type { EventLogger } from '../logging.ts';
import { parseManifest, persistManifestSpecs, type InitiativeManifest } from '../manifest.ts';
import {
  PM_ALLOWED_TOOLS,
  PM_DISALLOWED_TOOLS,
  PM_MODEL,
  PM_BRAIN_ACCESS,
  PM_ALWAYS_RELEVANT_THEMES,
  DECOMPOSITION_STATE_FILENAME,
  buildPmSystemPrompt,
  parseDecompositionState,
  renderPmUserPrompt,
  tallyToolUse,
  type PmToolUseSummary,
} from '../pm-invocation.ts';
import {
  readWorkItemsFromDir,
  serializeWorkItem,
  validateWorkItemSet,
  type CouplingPair,
  type WorkItem,
} from '../work-item.ts';
import { loadProjectConfig, type ProjectConfig } from '../project-config.ts';
import { releaseDraftAcs } from '../release-process.ts';
import { recordBrainGateResult, type CycleInput } from '../cycle-context.ts';
import { makeToolEventSink, extractLiveToolDetails } from '../tool-event-emit.ts';
import { deriveGateRecipe, renderGateRecipeBlock } from '../gate-recipes.ts';
import { withIdleDeadline } from '../stream-deadline.ts';
import { compileWorkItemSpecs } from './wi-spec-compile.ts';
import { checkDecomposeCompleteness } from './decompose-completeness.ts';

/**
 * Injection seam for tests. The live cycle uses `sdkQuery` from the
 * Claude Agent SDK; tests supply a stub that returns a canned PM session
 * per call so we can exercise the pass without hitting the network.
 */
export type PmQueryFn = (params: {
  prompt: string;
  options?: Record<string, unknown>;
}) => AsyncIterable<unknown>;

export type RunProjectManagerOptions = {
  queryFn?: PmQueryFn;
  /**
   * Optional wedge-kill abort signal threaded from flow-runner's raceWithWedge.
   * When fired, the PM's internal abortController is chained to propagate the
   * cancel into the SDK stream loop. Best-effort — the stream may not respond
   * immediately, but the race has already rejected so the cycle moves on.
   */
  signal?: AbortSignal;
  /**
   * ADR 037 test seam (same DI category as `queryFn`): overrides the root the
   * wi-spec-compiler loads `forge:constraint` sources from
   * (`<root>/brain/projects/<project>/…`). Defaults to the forge repo root.
   */
  constraintSourcesRoot?: string;
};

/**
 * Defaults for the live PM invocation. Higher budget + turn cap than the bench
 * (real worktrees are richer than fixtures); the bench enforces 0.5 USD / 30
 * turns to keep iteration cheap.
 */
const PM_LIVE_MAX_TURNS = 70;
// F-42: PM budget floor bumped from $1.00 → $2.50. The 22:17
// simplification-source cycle hit $1.01 and emitted 0 WIs
// (pm-budget-exhausted). At trafficGame's scale (251 files) $1.00 wasn't
// enough headroom; $2.50 is generous there (PM peaks ~$1.50).
//
// F-43: $2.50 was a FLAT constant, so the classifier's pm-budget-exhausted
// recommendation ("increase cost_budget_usd in the manifest") was inert —
// the cap ignored the manifest entirely. terraform-provider-betterado (286
// *_test.go + a huge vendored tree) proved larger than any project tuned
// for: its PM blew $2.50 on the brain-first mandate + worktree exploration
// before emitting any WIs, failing INIT 01/03 and stalling 18 dependents.
// Fix: derive the cap from the initiative's own declared budget so big
// initiatives (which already declare big budgets) get proportional PM
// planning headroom, while $2.50 stays the floor (small projects + the PM
// bench, which pins its own 2.5, are unchanged — no regression). This also
// makes the classifier's existing recommendation actually true.
const PM_LIVE_MAX_BUDGET_USD_FLOOR = 2.5;
const PM_BUDGET_FRACTION_OF_INITIATIVE = 0.2;
// Plan 2.11 part 3: emit `pm.turn-budget-warning` once when the streamed
// assistant-turn count crosses this fraction of the live turn cap.
const PM_TURN_WARNING_FRACTION = 0.8;
function pmMaxBudgetUsd(initiativeCostBudgetUsd: number): number {
  return Math.max(
    PM_LIVE_MAX_BUDGET_USD_FLOOR,
    initiativeCostBudgetUsd * PM_BUDGET_FRACTION_OF_INITIATIVE,
  );
}

export async function runProjectManager(
  input: CycleInput,
  logger: EventLogger,
  options: RunProjectManagerOptions = {},
): Promise<void> {
  const start = logger.emit({
    initiative_id: input.initiativeId,
    phase: 'project-manager',
    skill: 'project-manager',
    event_type: 'start',
    input_refs: [input.manifestPath],
    output_refs: [],
  });

  const manifestRaw = readFileSync(input.manifestPath, 'utf8');
  const manifest = parseManifest(manifestRaw);
  const queryFn = options.queryFn ?? (sdkQuery as unknown as PmQueryFn);

  const result = await runOnePmPass({
    input,
    logger,
    manifest,
    manifestRaw,
    parentEventId: start.event_id,
    queryFn,
    signal: options.signal,
    constraintSourcesRoot: options.constraintSourcesRoot,
  });

  if (result.kind === 'success') return;
  throw new Error(`project-manager phase failed: ${result.summary}`);
}

type PmPassInput = {
  input: CycleInput;
  logger: EventLogger;
  manifest: InitiativeManifest;
  /** Raw manifest markdown — inlined into the PM prompt (plan 2.11). */
  manifestRaw: string;
  parentEventId: string;
  queryFn: PmQueryFn;
  signal?: AbortSignal;
  /** ADR 037 test seam — see RunProjectManagerOptions.constraintSourcesRoot. */
  constraintSourcesRoot?: string;
};

type PmPassOutcome =
  | { kind: 'success' }
  | { kind: 'failure'; summary: string };

/**
 * Run the PM pass against the SDK, validate the emitted work-items, and
 * emit telemetry. Returns a discriminated outcome rather than throwing so
 * the outer orchestrator can decide how to handle failure.
 */
async function runOnePmPass(p: PmPassInput): Promise<PmPassOutcome> {
  const { input, logger, manifest, manifestRaw, parentEventId, queryFn, signal } = p;

  // F-21: wipe any stale `.forge/work-items/` inherited from the project's
  // base branch. The dev-loop's pre-review boundary snapshot historically
  // committed cycle scratch into project repos; without this wipe, the PM
  // agent sees pre-existing WI files and emits stale content (wrong
  // initiative_id, wrong work) instead of starting from a clean canvas.
  // Idempotent — missing dir is fine; gitignore is the structural fix,
  // this is the runtime backstop.
  const stalePmScratch = resolve(input.worktreePath, '.forge', 'work-items');
  if (existsSync(stalePmScratch)) {
    rmSync(stalePmScratch, { recursive: true, force: true });
  }

  const forgeRoot = resolve(import.meta.dirname, '..', '..');
  const systemPrompt = buildPmSystemPrompt(forgeRoot);
  // 2026-05-25 (claude-harness cycle 8 audit): read the project-shape
  // context off-disk and inject it into the prompt. PM was hallucinating
  // tooling (jest in a node:test project, npm run build with no build
  // script) because "go read package.json" wasn't load-bearing —
  // inlining the contents makes it so.
  const projectContext = readProjectContext(input.worktreePath);
  // betterado #2: derive the language-specific scoped-gate recipe from the
  // worktree so the PM writes a discriminating per-WI gate (e.g. Go's
  // `-tags all -run <NewPrefix> ./pkg/`) instead of the operator hand-encoding it.
  const gateRecipe = renderGateRecipeBlock(deriveGateRecipe(input.worktreePath));
  // M2: best-effort load of project config to inject standing instructions.
  // A separate load from the one in runUnifier (which runs later) — kept
  // isolated here so a config-read failure doesn't abort the PM pass.
  let projectConfigForPrompt: ProjectConfig | null = null;
  try { projectConfigForPrompt = loadProjectConfig(input.worktreePath); } catch { /* best-effort */ }
  // Plan 2.11 (G8 rescoped — env-pin at the SDK seam): inline everything the
  // orchestrator already knows so the PM spends turns DECIDING, not
  // re-discovering. Evidence (2026-07-10-pm-error-max-turns-new-api-
  // exploration.md): the PM's first run burned its budget on brain reads +
  // 6 tree Globs + manifest/profile reads before writing any WI; the
  // successful re-queue read the manifest then wrote immediately.
  const brainContext = readPmBrainContext(forgeRoot, manifest.project);
  const prompt = renderPmUserPrompt({
    initiativeId: input.initiativeId,
    manifestRelPath: input.manifestPath,
    manifestContent: manifestRaw,
    worktreeRelPath: input.worktreePath,
    projectName: manifest.project,
    projectContext,
    brainContext,
    gateRecipe,
    instructions: projectConfigForPrompt?.instructions,
    northStar: projectConfigForPrompt?.northStar,
  });
  logger.emit({
    initiative_id: input.initiativeId,
    parent_event_id: parentEventId,
    phase: 'project-manager',
    skill: 'project-manager',
    event_type: 'log',
    input_refs: brainContext.map((b) => b.path),
    output_refs: [],
    message: 'pm.context-injected',
    metadata: {
      brain_files: brainContext.map((b) => b.path),
      manifest_inlined: true,
      tree_listing: Boolean(projectContext.treeListing),
    },
  });

  const opts: Record<string, unknown> = {
    // F-37: PM runs with cwd = the worktree, NOT forgeRoot. Previously
    // the PM agent's `Glob({pattern: 'src/**'})` resolved against forge's
    // own root (which has no src/ directory) — getting zero results, then
    // fabricating plausible paths from training-data priors (e.g.,
    // src/engine/physics.test.ts on a project that has no src/engine/).
    // With cwd at the worktree, every relative-path tool call sees the
    // actual project. The system prompt's brain content is captured at
    // build time so it's unaffected by the cwd switch.
    cwd: input.worktreePath,
    systemPrompt,
    model: PM_MODEL,
    permissionMode: 'acceptEdits',
    allowedTools: PM_ALLOWED_TOOLS,
    disallowedTools: PM_DISALLOWED_TOOLS,
    maxTurns: PM_LIVE_MAX_TURNS,
    maxBudgetUsd: pmMaxBudgetUsd(manifest.cost_budget_usd),
  };
  // Idle-deadline safety net: a stalled stream (usage limit / network) aborts +
  // throws into cycle.ts → classifier (transient) instead of hanging the queue.
  // betterado roadmap run stalled exactly here mid-PM (known-gaps 2026-06-01).
  const abortController = new AbortController();
  // Chain the optional wedge-kill signal so a raceWithWedge abort propagates
  // into the SDK stream loop (best-effort — race has already rejected by then).
  if (signal) {
    signal.addEventListener('abort', () => abortController.abort(signal.reason), { once: true });
  }
  opts.abortController = abortController;

  const toolUseSummary: PmToolUseSummary = { brainReads: 0, writes: 0 };
  let costUsd = 0;
  let durationMs = 0;
  let resultSubtype: string | undefined;
  // Plan 2.11 part 3: the SDK exposes turn counts only on the terminal result
  // message (`num_turns`) — no mid-run remaining-turns surface. But this loop
  // IS the mid-run surface: each streamed assistant message is one turn, so
  // the orchestrator counts them itself and emits a single near-exhaustion
  // warning at the threshold (observability for the operator + the event log;
  // the skill-side `_decomposition-state.md` checkpoint is the recovery half).
  let observedTurns = 0;
  let turnWarningEmitted = false;
  const turnWarningThreshold = Math.ceil(PM_LIVE_MAX_TURNS * PM_TURN_WARNING_FRACTION);

  // Phase A — per-tool live telemetry for the PM (no work-item yet).
  // The PM drives its own stream loop, so it feeds the sink manually via
  // `extractLiveToolDetails` rather than `createClaudeAgent`'s `onToolUse`.
  const pmToolSink = makeToolEventSink(logger, {
    initiativeId: input.initiativeId,
    parentEventId,
    phase: 'project-manager',
    skill: 'project-manager',
  });
  let pmToolSeq = 0;

  for await (const msg of withIdleDeadline(queryFn({ prompt, options: opts }) as AsyncIterable<unknown>, {
    label: 'project-manager',
    abortController,
  })) {
    if (typeof msg !== 'object' || msg === null) continue;
    const m = msg as { type?: string; message?: { content?: Array<{ type?: string; name?: string; input?: unknown }> }; subtype?: string; total_cost_usd?: number; duration_ms?: number };
    if (m.type === 'assistant') {
      observedTurns += 1;
      if (!turnWarningEmitted && observedTurns >= turnWarningThreshold) {
        turnWarningEmitted = true;
        logger.emit({
          initiative_id: input.initiativeId,
          parent_event_id: parentEventId,
          phase: 'project-manager',
          skill: 'project-manager',
          event_type: 'log',
          input_refs: [],
          output_refs: [],
          message: 'pm.turn-budget-warning',
          metadata: { observed_turns: observedTurns, max_turns: PM_LIVE_MAX_TURNS },
        });
      }
      tallyToolUse(m.message, toolUseSummary);
      for (const detail of extractLiveToolDetails(m.message, pmToolSeq)) {
        pmToolSink.onToolUse(detail);
        pmToolSeq = detail.seq;
      }
      continue;
    }
    if (m.type !== 'result') continue;
    if (typeof m.duration_ms === 'number') durationMs = m.duration_ms;
    if (typeof m.total_cost_usd === 'number') costUsd = m.total_cost_usd;
    resultSubtype = m.subtype ?? 'success';
    break;
  }
  // PM is single-pass (not iterative); flush the coalesced remainder once.
  pmToolSink.flushIteration(0);

  for (let i = 0; i < toolUseSummary.brainReads; i++) {
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: parentEventId,
      phase: 'project-manager',
      skill: 'project-manager',
      event_type: 'tool_use',
      input_refs: ['brain/'],
      output_refs: [],
      message: 'pm.brain-query',
    });
  }

  // F-13 / F-19: enforce the brain-first mandate at the orchestrator when the
  // agent's brainAccess is 'mandatory'. If the PM agent skipped brain-query
  // entirely, fail fast with a distinct error (rather than continuing into
  // validateWorkItemSet, where the brain-skip's downstream effect — incomplete
  // frontmatter — surfaces instead, masking the real cause).
  // M2-3: gate is conditional on PM_BRAIN_ACCESS so a hypothetical advisory
  // agent would not abort on 0 reads. PM IS mandatory, so behaviour is
  // identical in production.
  // Plan 2.11 (G8 rescoped): brain files the orchestrator INJECTED into the
  // prompt count toward the mandate — the knowledge is structurally in
  // context, so 0 agent-side Read turns is the intended fast path, not a
  // skip. The behavioural gate remains as a backstop for the case where
  // injection came up empty (no profile, themes missing) AND the agent read
  // nothing.
  if (
    PM_BRAIN_ACCESS === 'mandatory' &&
    !recordBrainGateResult(
      'project-manager',
      'project-manager',
      toolUseSummary.brainReads + brainContext.length,
      {
        initiativeId: input.initiativeId,
        logger,
        parentEventId,
      },
    )
  ) {
    return {
      kind: 'failure',
      summary:
        'brain-first mandate not honoured (0 brain-query calls). The system prompt requires reading from `brain/...` (forge themes + project themes) before producing work items.',
    };
  }

  const workItemsDir = resolve(input.worktreePath, '.forge', 'work-items');
  const read = readWorkItemsFromDir(workItemsDir);
  let items = read.items;
  const parseErrors = read.parseErrors;

  for (const item of items) {
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: parentEventId,
      phase: 'project-manager',
      skill: 'project-manager',
      event_type: 'log',
      input_refs: [input.manifestPath],
      output_refs: [resolve(workItemsDir, `${item.work_item_id}.md`)],
      message: 'pm.work-item-emitted',
      metadata: {
        work_item_id: item.work_item_id,
        // Carried for the Studio hex-detail drawer + the WI dependency graph
        // (observability #11): the WI's deps, scope size, and a one-line task.
        depends_on: item.depends_on,
        files_in_scope: item.files_in_scope.length,
        ac_count: item.acceptance_criteria.length,
        task: item.acceptance_criteria[0]
          ? `Given ${item.acceptance_criteria[0].given} — Then ${item.acceptance_criteria[0].then}`
          : item.files_in_scope.join(', '),
      },
    });
  }

  // Load the project's forge config (best-effort) for the A2 testing-contract
  // checks. A malformed config is surfaced + fail-closed elsewhere (the
  // dev-loop loads it); here we skip the EXTRA checks rather than break the PM
  // pass on a config problem unrelated to decomposition quality.
  let projectConfig: ProjectConfig | null = null;
  try {
    projectConfig = loadProjectConfig(input.worktreePath);
  } catch {
    projectConfig = null;
  }

  // A2b (2026-06-06): inject the project's standing acceptance criteria into
  // every WI body as a fixed contract section. Static + automatic — removes
  // the per-WI PM judgment that kept varying. Body-only (frontmatter stays
  // byte-stable), idempotent (skips a WI already carrying the section).
  //
  // WS-A (release): a project that declares `releaseProcess` also gets the
  // in-cycle draft-changelog requirement folded into the SAME standing-AC
  // section — so every WI in a release-bearing initiative carries it. A project
  // without `releaseProcess` adds nothing (releaseDraftAcs → []), keeping the
  // non-opted-in path byte-for-byte unchanged.
  const standingAcs = [
    ...(projectConfig?.standing_work_item_acs ?? []),
    ...releaseDraftAcs(projectConfig?.releaseProcess),
  ];
  if (standingAcs.length > 0) {
    items = appendStandingAcs(workItemsDir, items, standingAcs);
  }

  // ADR 037 (wi-spec-compiler, deterministic core): parse profile.md + the
  // project's Brain-3 themes for `forge:constraint` blocks, inject every
  // matching clause verbatim into the WI(s) it applies to, compile any
  // resolvable hidden-coupling overlap into an explicit `depends_on` edge
  // (F-05 upgraded reject → compile), and enforce the `creates:`
  // mandatory-with-escape + sizing invariants. Sequenced right after
  // appendStandingAcs and before validateWorkItemSet, the same seam
  // appendStandingAcs already occupies. A compiler THROW (malformed
  // constraint source, unreadable file) is a loud-but-controlled failure:
  // it funnels into compileErrors → setErrors → the same failure outcome +
  // final error event every other validation failure uses — runOnePmPass's
  // no-throw contract holds.
  let compileErrors: string[] = [];
  let couplingViolations: CouplingPair[] = [];
  if (items.length > 0) {
    try {
      const compiled = compileWorkItemSpecs({
        forgeRoot: p.constraintSourcesRoot ?? forgeRoot,
        projectName: manifest.project,
        manifest,
        workItemsDir,
        // ralph-spec-lint (ADR 037 / REFINEMENT-PLAN §7) searches the PROJECT
        // tree for existing/created test files — that's the worktree, not
        // forgeRoot (which has no project source at all).
        projectRoot: input.worktreePath,
        items,
        logger,
        initiativeId: input.initiativeId,
        parentEventId,
      });
      items = compiled.items;
      couplingViolations = compiled.unresolvedCoupling;
      compileErrors = compiled.compileErrors;
    } catch (err) {
      compileErrors = [`wi-spec-compile: ${(err as Error).message}`];
    }
  }

  const { perItem, setErrors: validationSetErrors } = validateWorkItemSet(items, {
    expectedInitiativeId: manifest.initiative_id,
  });
  const setErrors = [...validationSetErrors, ...compileErrors];
  const itemErrorCount = Object.values(perItem).reduce((acc, errs) => acc + errs.length, 0);

  // A2a (2026-06-06): live-acceptance-WI requirement (contract C7). When the
  // project declares `acceptance_gate.required`, the decomposition MUST include
  // ≥1 WI whose `quality_gate_cmd` targets the acceptance suite — so every
  // initiative is proven by a real acceptance test, not an offline proxy. An
  // initiative shipped with NO acceptance WI is a hard PM failure.
  let accGateViolation: string | null = null;
  const accGate = projectConfig?.acceptance_gate;
  if (accGate?.required && items.length > 0) {
    const hasLiveAccWi = items.some((it) =>
      (it.quality_gate_cmd ?? []).some((tok) => tok.includes(accGate.match)),
    );
    if (!hasLiveAccWi) {
      // Derive the wording from the project's own gate config: a gate that
      // requires env vars proves the change against a real external system (so
      // call it the "live acceptance suite"); a creds-free gate is just "the
      // acceptance suite". No project-flavoured language is hardcoded here.
      const requiresEnv = (accGate.requires_env ?? []).length > 0;
      const suiteName = requiresEnv
        ? `the live acceptance suite (proving the change against the real external system; ` +
          `requires ${accGate.requires_env!.join(', ')})`
        : 'the acceptance suite';
      accGateViolation =
        `no acceptance work item: this project requires ≥1 WI whose quality_gate_cmd targets ` +
        `"${accGate.match}" — ${suiteName}. Add an acceptance WI whose gate runs that suite.`;
    }
  }

  // Operator sanity-check surface: a greppable WI list so a human can eyeball
  // at a glance whether each WI got plausible scope (and spot off-target scope —
  // e.g. a WI touching brain/ for a code initiative).
  writeDecompositionDoc(workItemsDir, manifest, items);

  // Terminal: zero work items emitted → pm-empty-decomposition.
  if (items.length === 0) {
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: parentEventId,
      phase: 'project-manager',
      skill: 'project-manager',
      event_type: 'error',
      input_refs: [input.manifestPath],
      output_refs: [],
      message: 'pm.empty-decomposition',
      metadata: { result_subtype: resultSubtype },
    });
  }

  // Plan 2.11 parts 2+3: the skill writes WIs incrementally and keeps a
  // checkbox checkpoint (`_decomposition-state.md`) — so a turn/budget cap
  // mid-flight leaves a partial graph the orchestrator can CLASSIFY instead
  // of nothing. Read the checkpoint best-effort: planned > emitted WI files
  // means the set is incomplete even when every written WI validates cleanly.
  const capped = resultSubtype === 'error_max_turns' || resultSubtype === 'error_max_budget_usd';
  let decompState: { planned: number; emitted: number } | null = null;
  try {
    decompState = parseDecompositionState(
      readFileSync(join(workItemsDir, DECOMPOSITION_STATE_FILENAME), 'utf8'),
    );
  } catch {
    decompState = null; // no checkpoint — the PM never got that far, or pre-2.11 skill
  }
  const plannedCount = decompState?.planned ?? null;
  const checkpointIncomplete = capped && plannedCount !== null && plannedCount > items.length;

  const failed =
    items.length === 0 ||
    Object.keys(parseErrors).length > 0 ||
    setErrors.length > 0 ||
    itemErrorCount > 0 ||
    couplingViolations.length > 0 ||
    accGateViolation !== null ||
    checkpointIncomplete;

  // Partial-but-usable signal (plan 2.11): a capped run that DID write WIs is
  // a different failure class from an empty decomposition — the classifier
  // treats `usable: true` (≥1 valid WI) as transient (the 07-10 evidence shows
  // a re-queue succeeds), while empty/degenerate stays terminal.
  if (capped && items.length > 0 && failed) {
    const validCount = items.filter((it) => (perItem[it.work_item_id] ?? []).length === 0).length;
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: parentEventId,
      phase: 'project-manager',
      skill: 'project-manager',
      event_type: 'error',
      input_refs: [input.manifestPath],
      output_refs: [workItemsDir],
      message: 'pm.partial-decomposition',
      metadata: {
        result_subtype: resultSubtype,
        work_item_count: items.length,
        valid_count: validCount,
        planned_count: plannedCount,
        usable: validCount > 0,
      },
    });
  }

  logger.emit({
    initiative_id: input.initiativeId,
    parent_event_id: parentEventId,
    phase: 'project-manager',
    skill: 'project-manager',
    event_type: 'log',
    input_refs: [input.manifestPath],
    output_refs: [resolve(workItemsDir, '_graph.md')],
    message: 'pm.graph-emitted',
    metadata: {},
  });

  logger.emit({
    initiative_id: input.initiativeId,
    parent_event_id: parentEventId,
    phase: 'project-manager',
    skill: 'project-manager',
    event_type: failed ? 'error' : 'end',
    input_refs: [input.manifestPath],
    output_refs: [workItemsDir],
    duration_ms: durationMs,
    cost_usd: costUsd,
    metadata: {
      work_item_count: items.length,
      result_subtype: resultSubtype,
      tool_use: toolUseSummary,
      parse_errors: parseErrors,
      set_errors: setErrors,
      per_item_error_count: itemErrorCount,
      hidden_coupling_violations: couplingViolations,
      ...(plannedCount !== null ? { planned_count: plannedCount } : {}),
      ...(accGateViolation ? { acceptance_gate_violation: accGateViolation } : {}),
    },
  });

  if (!failed) {
    // R4-05-F2: persist the initiative→specs back-reference now that
    // decomposition has actually COMPLETED — this is the pass's own
    // success path (the same `!failed` check that returns `kind: 'success'`
    // below), i.e. a clean WI set with no parse/set/per-item/coupling/gate
    // errors and no incomplete checkpoint. A failed or invalid pass never
    // reaches here, so the manifest's specs list is left untouched (never
    // overwritten with partial or rejected WI ids). Overwrites on every
    // successful pass (a re-decomposition replaces the list).
    persistManifestSpecs(input.manifestPath, items.map((item) => item.work_item_id));

    // R4-05-T4: non-blocking decompose-completeness check (operator decision
    // 2026-07-17). The delivery gate catches under-*delivery*; this catches
    // under-*planning* — scope stated in the initiative body but never
    // decomposed into a WI at all. Runs ONLY here, on the pass's own success
    // path, AFTER the WI set is final. It NEVER affects `failed`, the pass
    // outcome, or dispatch — a flagged decomposition still returns
    // `{ kind: 'success' }` below and proceeds to develop exactly as before.
    // `plan.completeness`'s `metadata` shape is the R4-11-F4 contract (a
    // later PR's attention-strip consumer): keep `stated_units`,
    // `covered_units`, `uncovered: string[]`, `flagged: boolean` stable.
    const completeness = checkDecomposeCompleteness(manifest.body, items);
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: parentEventId,
      phase: 'project-manager',
      skill: 'project-manager',
      event_type: 'log',
      input_refs: [input.manifestPath],
      output_refs: [workItemsDir],
      message: 'plan.completeness',
      metadata: {
        stated_units: completeness.statedUnits,
        covered_units: completeness.coveredUnits,
        uncovered: completeness.uncovered,
        flagged: completeness.flagged,
      },
    });

    return { kind: 'success' };
  }

  const summary = [
    items.length === 0 ? 'no work items emitted' : null,
    Object.keys(parseErrors).length > 0 ? `parse errors: ${Object.keys(parseErrors).join(', ')}` : null,
    setErrors.length > 0 ? `set errors: ${setErrors.join('; ')}` : null,
    itemErrorCount > 0 ? `${itemErrorCount} per-item validation errors` : null,
    couplingViolations.length > 0
      ? `${couplingViolations.length} hidden-coupling pair(s): ${couplingViolations.map((pair) => `${pair.a}↔${pair.b} share ${pair.sharedFiles.join(',')}`).join('; ')}`
      : null,
    checkpointIncomplete
      ? `decomposition capped mid-flight (${resultSubtype}): checkpoint plans ${plannedCount} WI(s) but only ${items.length} emitted`
      : null,
    accGateViolation,
  ]
    .filter((s): s is string => s !== null)
    .join('; ');

  return { kind: 'failure', summary };
}

/** Heading for the project-contract standing-AC section injected per WI. */
const STANDING_ACS_HEADER = '## Standing acceptance criteria (project contract)';

/**
 * A2b (2026-06-06) — append the project's `standing_work_item_acs` to every WI
 * body as a fixed contract section, then re-serialise the file. Body-only
 * (frontmatter byte-stable via `serializeWorkItem`), idempotent (a WI already
 * carrying the header is left untouched — safe on resume). Best-effort per
 * file: a write error leaves that WI unchanged rather than failing the PM pass.
 * Returns the items with their in-memory bodies updated to match disk.
 */
function appendStandingAcs(
  workItemsDir: string,
  items: ReadonlyArray<WorkItem>,
  standingAcs: ReadonlyArray<string>,
): WorkItem[] {
  const section = [
    STANDING_ACS_HEADER,
    '',
    'These project-wide testing invariants apply to **every** work item in this initiative, in addition to the work-specific acceptance criteria above. The dev-loop must satisfy them and the reviewer must confirm them:',
    '',
    ...standingAcs.map((ac) => `- ${ac}`),
  ].join('\n');
  return items.map((item) => {
    if (item.body.includes(STANDING_ACS_HEADER)) return item; // idempotent
    const updated: WorkItem = { ...item, body: `${item.body.replace(/\s+$/, '')}\n\n${section}\n` };
    try {
      writeFileSync(join(workItemsDir, `${item.work_item_id}.md`), serializeWorkItem(updated));
      return updated;
    } catch {
      return item; // best-effort — never fail the PM pass on a write error
    }
  });
}

/**
 * Write `.forge/work-items/_decomposition.md` — a greppable WI list for a
 * fast operator sanity check. Lists each WI (id + the files it touches, so
 * off-target scope is obvious). Excluded from `readWorkItemsFromDir` so it
 * is never parsed as a WI.
 */
function writeDecompositionDoc(
  workItemsDir: string,
  manifest: InitiativeManifest,
  items: ReadonlyArray<WorkItem>,
): void {
  const lines: string[] = [
    `# Work-item decomposition — ${manifest.initiative_id}`,
    '',
    `${items.length} work item(s) emitted.`,
    '',
  ];

  // A1 advisory (2026-06-06): a top-level-scope summary so the operator can
  // eyeball off-target decomposition AT A GLANCE. If the PM mis-grounds (e.g.
  // hallucinates off the title and touches `releases/`, `docs/`, or `brain/`
  // instead of the project's source tree), the stray top-level dir shows up
  // here immediately. Advisory only — not a hard gate (a legit WI may touch
  // docs/examples); the teeth are the restate-the-target step + the live-acc-WI
  // requirement.
  const topLevel = new Map<string, number>();
  for (const item of items) {
    for (const f of item.files_in_scope) {
      const seg = f.split('/')[0] || f;
      topLevel.set(seg, (topLevel.get(seg) ?? 0) + 1);
    }
  }
  if (topLevel.size > 0) {
    lines.push('## Top-level scope (eyeball for off-target dirs)');
    for (const [seg, count] of [...topLevel.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`- \`${seg}/\` — ${count} file ref(s)`);
    }
    lines.push('');
  }

  for (const item of items) {
    lines.push(`## ${item.work_item_id}`);
    for (const f of item.files_in_scope) lines.push(`- ${f}`);
    lines.push('');
  }
  try {
    writeFileSync(join(workItemsDir, '_decomposition.md'), lines.join('\n'));
  } catch {
    /* best-effort telemetry artifact — never fail the PM pass on a write error */
  }
}

/**
 * Read the project-shape context files off the worktree. Each is
 * optional — skipped if the file isn't present. Caps each file at
 * 8 KB so a freak large CLAUDE.md / package.json doesn't blow the
 * prompt budget; trims aren't ideal but the agent only needs enough
 * to identify the tooling.
 *
 * Surfaced 2026-05-25 by the claude-harness cycle 8 audit: PM was
 * hallucinating `jest` in a `node:test` project. Inlining
 * package.json's actual scripts makes it impossible to ignore.
 */
function readProjectContext(worktreePath: string): {
  packageJson?: string;
  pyprojectToml?: string;
  cargoToml?: string;
  forgeProjectJson?: string;
  claudeMd?: string;
  treeListing?: string;
} {
  const safeRead = (rel: string): string | undefined => {
    const p = resolve(worktreePath, rel);
    if (!existsSync(p)) return undefined;
    try {
      const raw = readFileSync(p, 'utf8');
      return raw.length > 8192 ? raw.slice(0, 8192) + '\n… (truncated)' : raw;
    } catch {
      return undefined;
    }
  };
  return {
    packageJson: safeRead('package.json'),
    pyprojectToml: safeRead('pyproject.toml'),
    cargoToml: safeRead('Cargo.toml'),
    forgeProjectJson: safeRead('.forge/project.json'),
    claudeMd: safeRead('CLAUDE.md'),
    treeListing: buildTreeListing(worktreePath),
  };
}

/**
 * Plan 2.11 (G8 rescoped): pre-fetch the brain files EVERY PM run needs —
 * the project profile + the always-relevant themes SKILL.md Step 0 names —
 * so they ride in the prompt instead of costing agent turns. Domain-specific
 * project themes stay agent-discovered (the navigation index in the system
 * prompt covers them); only the deterministic reads are pinned here.
 * Best-effort per file (missing profile on a new project is fine); each
 * capped at 8 KB like the project-context reads.
 */
function readPmBrainContext(
  forgeRoot: string,
  projectName: string,
): Array<{ path: string; content: string }> {
  const rels = [
    `brain/projects/${projectName}/profile.md`,
    ...PM_ALWAYS_RELEVANT_THEMES,
  ];
  const out: Array<{ path: string; content: string }> = [];
  for (const rel of rels) {
    const p = resolve(forgeRoot, rel);
    if (!existsSync(p)) continue;
    try {
      const raw = readFileSync(p, 'utf8');
      out.push({
        path: rel,
        content: raw.length > 8192 ? raw.slice(0, 8192) + '\n… (truncated)' : raw,
      });
    } catch {
      /* best-effort — an unreadable theme is skipped, not fatal */
    }
  }
  return out;
}

/** Bounds for the injected worktree listing (plan 2.11 — closes the
 *  six-broad-Globs gap from the 07-10 max-turns theme). */
const TREE_LISTING_MAX_DEPTH = 3;
const TREE_LISTING_MAX_ENTRIES = 400;
const TREE_LISTING_SKIP_DIRS = new Set([
  'node_modules', 'vendor', 'dist', 'build', 'out', 'coverage',
  '.git', '.next', '.forge', '.terraform', '__pycache__', 'target',
]);

/**
 * Depth- and entry-capped worktree listing, injected into the PM prompt so
 * the agent structurally sees the tree instead of re-deriving it with
 * repeated broad Globs (the 2026-07-10 theme recorded 6 Glob scans before
 * any WI write). Dot-entries and dependency/build dirs are skipped; deeper
 * paths remain reachable via targeted Glob.
 */
function buildTreeListing(worktreePath: string): string | undefined {
  const lines: string[] = [];
  const walk = (dir: string, rel: string, depth: number): void => {
    if (depth > TREE_LISTING_MAX_DEPTH || lines.length >= TREE_LISTING_MAX_ENTRIES) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (lines.length >= TREE_LISTING_MAX_ENTRIES) return;
      if (entry.name.startsWith('.') || TREE_LISTING_SKIP_DIRS.has(entry.name)) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        lines.push(`${childRel}/`);
        walk(join(dir, entry.name), childRel, depth + 1);
      } else {
        lines.push(childRel);
      }
    }
  };
  walk(worktreePath, '', 1);
  if (lines.length === 0) return undefined;
  const suffix =
    lines.length >= TREE_LISTING_MAX_ENTRIES
      ? `\n… (truncated at ${TREE_LISTING_MAX_ENTRIES} entries — use targeted Glob for deeper paths)`
      : '';
  return lines.join('\n') + suffix;
}
