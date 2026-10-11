/**
 * Project-manager phase runner.
 *
 * Invokes the PM skill via the Claude Agent SDK, validates the emitted work
 * items, and emits decomposition telemetry.
 */

import { existsSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pinnedStreamQuery, type StreamQueryFn, type HeartbeatTimers } from '@forge/agents';

import type { EventLogger } from '@forge/kernel';
import { parseManifest, persistManifestPmValidationErrors, persistManifestSpecs } from '@forge/flows';
import type { InitiativeManifest, AgentDefinition } from '@forge/contracts';
import {
  PM_BRAIN_ACCESS,
  DECOMPOSITION_STATE_FILENAME,
  buildPmSystemPrompt,
  parseDecompositionState,
  renderPmUserPrompt,
  tallyToolUse,
  type PmToolUseSummary,
} from './pm-binding.ts';
import { readWorkItemsFromDir } from '@forge/flows';
import { loadProjectConfig, type ProjectConfig } from '@forge/projects';
import { PM_REPAIR_NEEDS_REPLAN_PREFIX, PM_SET_VALIDATION_UNREPAIRED_PREFIX } from '@forge/contracts';
import { describeAcceptanceRequirement } from './pm-acceptance-gate.ts';
import { runPmRepairLoop, validatePmSet } from './pm-set-repair.ts';
import { releaseDraftAcs } from '../release-process.ts';
import { recordBrainGateResult, type CycleInput } from '@forge/flows';
import { requireCycleId } from './cycle-id.ts';
import { makeToolEventSink, extractLiveToolDetails } from '@forge/agents';
import { deriveGateRecipe, renderGateRecipeBlock } from '@forge/projects';
import { runAgent } from '@forge/agents';
import { checkDecomposeCompleteness } from './decompose-completeness.ts';
import { rejectWorkItemSet } from './pm-rejected-set.ts';
import { writeDecompositionDoc } from './pm-decomposition-doc.ts';
import { readPmBrainContext, readProjectContext } from './pm-prompt-context.ts';
import { underDecomposedFlag } from './pm-class-set-rules.ts';
import type { ClassProfilePort } from '../class-profile-port.ts';
import { deriveKbIdFromBrainPath } from '@forge/knowledge';

/**
 * Injection seam for tests. The live cycle uses the pinned stream query;
 * tests supply a stub that returns a canned PM session per call so we can
 * exercise the pass without hitting the network. Alias of the one shared
 * stream-call shape (R4-01 review — no structural twin types).
 */
export type PmQueryFn = StreamQueryFn;

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
   * D-17 test seam (same DI category as `queryFn`): overrides the root the
   * wi-spec-compiler loads `forge:constraint` sources from
   * (`<root>/brain/projects/<project>/…`). Defaults to the forge repo root.
   */
  constraintSourcesRoot?: string;
  /**
   * The one port (operator ruling, items 81/83): threaded to
   * `underDecomposedFlag`, which reads it only when the decomposed set is
   * exactly one work item — see that function's own comment.
   */
  classProfiles?: ClassProfilePort;
  /** Seam F4: the executing node's own agent def. REQUIRED — no fallback. */
  agentDef: AgentDefinition;
  /** 8.1.30 — test-injection only, mirrors `runAgent`'s `RunContext.heartbeatTimers` (7.6.148). */
  heartbeatTimers?: HeartbeatTimers;
};

// The live turn/budget caps are DECLARED DATA now (R4-01-F2, SPEC §1):
// `budgets.maxTurns: 70` + `maxBudgetUsd: 2.5` + `maxBudgetUsdShare: 0.2` in
// skills/project-manager/SKILL.md, resolved by `runAgent`'s one-shot path as
// `max(2.50 floor, 0.2 × manifest.cost_budget_usd)`. History of the values
// (F-42 floor bump after a $1.01 pm-budget-exhausted 0-WI cycle; F-43
// proportional share after terraform-provider-betterado blew the flat floor
// and stalled 18 dependents) lives with the fields in the SKILL.md + SPEC §1.
//
// Plan 2.11 part 3: emit `pm.turn-budget-warning` once when the streamed
// assistant-turn count crosses this fraction of the declared turn cap.
const PM_TURN_WARNING_FRACTION = 0.8;

export async function runProjectManager(
  input: CycleInput,
  logger: EventLogger,
  options: RunProjectManagerOptions,
): Promise<void> {
  const start = logger.emit({
    initiative_id: input.initiativeId,
    phase: 'project-manager',
    skill: options.agentDef.slug,
    event_type: 'start',
    input_refs: [input.manifestPath],
    output_refs: [],
  });

  const manifestRaw = readFileSync(input.manifestPath, 'utf8');
  const manifest = parseManifest(manifestRaw);
  const queryFn = options.queryFn ?? pinnedStreamQuery;

  const result = await runOnePmPass({
    input,
    logger,
    manifest,
    manifestRaw,
    parentEventId: start.event_id,
    queryFn,
    signal: options.signal,
    constraintSourcesRoot: options.constraintSourcesRoot,
    classProfiles: options.classProfiles,
    agentDef: options.agentDef,
    heartbeatTimers: options.heartbeatTimers,
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
  /** D-17 test seam — see RunProjectManagerOptions.constraintSourcesRoot. */
  constraintSourcesRoot?: string;
  /** The one port (operator ruling, items 81/83) — see RunProjectManagerOptions.classProfiles. */
  classProfiles?: ClassProfilePort;
  /** Seam F4 — see RunProjectManagerOptions.agentDef. REQUIRED. */
  agentDef: AgentDefinition;
  /** 8.1.30 — see RunProjectManagerOptions.heartbeatTimers. */
  heartbeatTimers?: RunProjectManagerOptions['heartbeatTimers'];
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
  const { input, logger, manifest, manifestRaw, parentEventId, queryFn, signal, heartbeatTimers } = p;

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
  // D-49 Requeue REPAIR MODE: resumed at the plan node with errors the manifest
  // records → the last rejected set is restored and repaired; no decomposition
  // spawn, never a blind re-decompose. No rejected set → refused by name.
  const recordedErrors = input.resumeFrom === 'plan' ? manifest.pm_validation_errors ?? [] : [];
  if (recordedErrors.length > 0) {
    const prior = latestRejectedSet(resolve(input.worktreePath, '.forge'));
    if (prior === null) {
      return rejectWorkItemSet(stalePmScratch, `pm-repair-no-prior-set: Requeue repair mode found no rejected work-item set under .forge/ — recorded errors: ${recordedErrors.join('; ')}`);
    }
    renameSync(prior, stalePmScratch);
  }
  const repairMode = recordedErrors.length > 0;

  // Seam F4: no fallback — read once, before the prompt, for both it and the spawn.
  const def = p.agentDef;

  const forgeRoot = resolve(import.meta.dirname, '..', '..', '..');
  const systemPrompt = buildPmSystemPrompt(forgeRoot, def);
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
  // Row 157 (ruling 1873), part (a) BRIEF: state the class profile's
  // acceptance-gate requirement UP FRONT, from the SAME classProfiles port +
  // project config the post-hoc gate below reads — best-effort (never throws
  // pre-spawn): a missing table here just omits the brief, and the post-hoc
  // gate still refuses by name once real items exist (unchanged).
  const acceptanceRequirement =
    projectConfigForPrompt?.acceptance_gate && p.classProfiles
      ? describeAcceptanceRequirement(
          p.classProfiles.profileFor(manifest.class).acceptance,
          projectConfigForPrompt.acceptance_gate,
        )
      : null;
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
    acceptanceRequirement: acceptanceRequirement ?? undefined,
  });
  logger.emit({
    initiative_id: input.initiativeId,
    parent_event_id: parentEventId,
    phase: 'project-manager',
    skill: def.slug,
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
  // forge-8vfn.5.16 (M7-C U2) — the planner's brain READ, on the record.
  // `pm.context-injected` above lists raw paths; this names the KB each one
  // belongs to and how many files were read from it, so an operator (or a
  // story beat) can point at ONE event and say "the planner read KB X, N
  // files" rather than re-deriving it from a path list. Scoped to
  // brainContext (the deterministic pre-fetch every real pass performs) —
  // NOT the agent-driven ad hoc tool-use reads pm.brain-query already
  // counts, whose Read/Grep/Glob inputs are too varied (globs, directories)
  // to attribute to one KB reliably.
  const brainReadKbs = new Map<string, number>();
  for (const b of brainContext) {
    const kbId = deriveKbIdFromBrainPath(b.path);
    if (kbId) brainReadKbs.set(kbId, (brainReadKbs.get(kbId) ?? 0) + 1);
  }
  for (const [kbId, themeCount] of brainReadKbs) {
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: parentEventId,
      phase: 'project-manager',
      skill: def.slug,
      event_type: 'brain-query',
      input_refs: brainContext.filter((b) => b.path.startsWith(`brain/${kbId}/`) || b.path.startsWith(`brain/projects/${kbId}/`)).map((b) => b.path),
      output_refs: [],
      message: 'brain.read',
      metadata: { kbId, themeCount, reader: 'project-manager', runId: input.initiativeId },
    });
  }

  // R4-01-F2 (SPEC §1): the spawn goes through the generic one-shot primitive
  // with `lifecycle: 'caller'` — this pipeline owns the event lifecycle and
  // every judgment (brain gate, WI validation, checkpoint classification);
  // only the literal SDK call moved. Options are pinned byte-identical to the
  // previous inline build by the golden spawn-capture suite for the canonical
  // def (`def` resolved once, above, before the system prompt):
  //   - F-37 cwd = the worktree (Glob resolves against the actual project).
  //   - model/tools from the executing node's own def (seam F4).
  //   - caps from the declared budgets: max(2.50, 0.2 × manifest budget).
  //   - streamGuard = the idle-deadline safety net + wedge-signal chaining
  //     (a stalled stream aborts + classifies transient instead of hanging
  //     the queue — betterado roadmap run stalled exactly here mid-PM).
  const pmMaxTurns = def.budgets.maxTurns;
  if (pmMaxTurns === undefined) {
    throw new Error(
      'project-manager SKILL.md must declare budgets.maxTurns (R4-01-F2 — the live turn cap is frontmatter data)',
    );
  }
  if (def.budgets.maxBudgetUsd === undefined && def.budgets.maxBudgetUsdShare === undefined) {
    throw new Error(
      'project-manager SKILL.md must declare a budget cap (budgets.maxBudgetUsd and/or maxBudgetUsdShare) — an uncapped unattended PM re-opens the F-42/F-43 silent-spend vector',
    );
  }

  const toolUseSummary: PmToolUseSummary = { brainReads: 0, writes: 0 };
  // Plan 2.11 part 3: the SDK exposes turn counts only on the terminal result
  // message (`num_turns`) — no mid-run remaining-turns surface. But the
  // onMessage observer IS the mid-run surface: each streamed assistant
  // message is one turn, so the orchestrator counts them itself and emits a
  // single near-exhaustion warning at the threshold (observability for the
  // operator + the event log; the skill-side `_decomposition-state.md`
  // checkpoint is the recovery half).
  let observedTurns = 0;
  let turnWarningEmitted = false;
  const turnWarningThreshold = Math.ceil(pmMaxTurns * PM_TURN_WARNING_FRACTION);

  // Phase A — per-tool live telemetry for the PM (no work-item yet).
  // The PM feeds the sink manually via `extractLiveToolDetails` from the
  // onMessage observer rather than `createClaudeAgent`'s `onToolUse`.
  const pmToolSink = makeToolEventSink(logger, {
    initiativeId: input.initiativeId,
    parentEventId,
    phase: 'project-manager',
    skill: def.slug,
  });
  let pmToolSeq = 0;

  const spawn = repairMode ? { costUsd: 0, durationMs: 0, resultSubtype: 'success' } : await runAgent(def, {
    runId: requireCycleId(input, 'runProjectManager'),
    workdir: input.worktreePath,
    cwd: input.worktreePath,
    prompt,
    systemPrompt,
    lifecycle: 'caller',
    logger, // forge-8vfn.8.1.10: lets runAgent root the spawn marker at this pipeline's own logger, not <FORGE_ROOT>/_logs.
    // 8.1.30: the SAME sink `pmToolSink` above — turns on the heartbeat.
    turnSink: pmToolSink,
    ...(heartbeatTimers !== undefined ? { heartbeatTimers } : {}),
    streamGuard: { label: 'project-manager', signal },
    bindings: {
      initiative: {
        id: input.initiativeId,
        manifestPath: input.manifestPath,
        costBudgetUsd: manifest.cost_budget_usd,
      },
    },
    onMessage: (msg) => {
      if (typeof msg !== 'object' || msg === null) return;
      const m = msg as {
        type?: string;
        message?: { content?: Array<{ type?: string; name?: string; input?: unknown }> };
      };
      if (m.type !== 'assistant') return;
      observedTurns += 1;
      if (!turnWarningEmitted && observedTurns >= turnWarningThreshold) {
        turnWarningEmitted = true;
        logger.emit({
          initiative_id: input.initiativeId,
          parent_event_id: parentEventId,
          phase: 'project-manager',
          skill: def.slug,
          event_type: 'log',
          input_refs: [],
          output_refs: [],
          message: 'pm.turn-budget-warning',
          metadata: { observed_turns: observedTurns, max_turns: pmMaxTurns },
        });
      }
      tallyToolUse(m.message, toolUseSummary);
      for (const detail of extractLiveToolDetails(m.message, pmToolSeq)) {
        pmToolSink.onToolUse(detail);
        pmToolSeq = detail.seq;
      }
    },
    queryFn,
  });
  // `let` — the D-49 repair turns (below) fold their
  // own spend/duration into the pass's own accounting (their `lifecycle:
  // 'caller'` spawn emits no event of its own; this pass's end event must).
  let costUsd = spawn.costUsd;
  let durationMs = spawn.durationMs ?? 0;
  const resultSubtype = spawn.resultSubtype;
  // PM is single-pass (not iterative); flush the coalesced remainder once.
  pmToolSink.flushIteration(0);

  for (let i = 0; i < toolUseSummary.brainReads; i++) {
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: parentEventId,
      phase: 'project-manager',
      skill: def.slug,
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
    !repairMode &&
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
    // Second door: returns AFTER the agent's turn, so a set may already be claimable.
    return rejectWorkItemSet(resolve(input.worktreePath, '.forge', 'work-items'),
      'brain-first mandate not honoured (0 brain-query calls). The system prompt requires reading from `brain/...` (forge themes + project themes) before producing work items.');
  }

  const workItemsDir = resolve(input.worktreePath, '.forge', 'work-items');
  const read = readWorkItemsFromDir(workItemsDir);

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

  // D-17 compile + A2b standing-ACs + set validation + acceptance gate (D-34) + D-47
  // coverage as ONE list of named errors; the SAME call re-validates every repair turn.
  const validateOpts = {
    workItemsDir,
    standingAcs,
    constraintSourcesRoot: p.constraintSourcesRoot ?? forgeRoot,
    manifest,
    projectRoot: input.worktreePath,
    logger,
    initiativeId: input.initiativeId,
    parentEventId,
    accGate: projectConfig?.acceptance_gate,
    classProfiles: p.classProfiles,
    skill: def.slug,
  };
  let v = validatePmSet(validateOpts, read);
  // D-34 / ruling 229 half A — a FLAG, never a failure. The gate for this
  // column runs at the plan gate, on the declared criteria, before any spend.
  const underDecomposed = underDecomposedFlag(manifest, v.items, p.classProfiles);
  if (underDecomposed !== null) {
    logger.emit({
      initiative_id: manifest.initiative_id, parent_event_id: parentEventId,
      phase: 'project-manager', skill: def.slug, event_type: 'log',
      input_refs: [], output_refs: [], message: 'pm.under-decomposed',
      metadata: { change_class: manifest.class, work_item_count: v.items.length, detail: underDecomposed },
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
  const checkpointIncomplete = capped && plannedCount !== null && plannedCount > v.items.length;

  // D-49: a set that fails validation earns at most REPAIR_TURNS_MAX repair
  // turns fed every error verbatim (row 157's one-shot revise is folded in).
  // An empty or capped first pass keeps its own classification below.
  const repairable = (v.items.length > 0 || Object.keys(v.parseErrors).length > 0) && v.errors.length > 0 && !capped;
  // 8vfn.6.1: a turn that throws (operator stop, wedge abort) leaves no claimable
  // set behind; the original error still propagates for the classifier.
  const repair = repairable
    ? await runPmRepairLoop({
        input, logger, parentEventId, def, queryFn, systemPrompt, workItemsDir, signal,
        costBudgetUsd: manifest.cost_budget_usd,
        spentUsd: costUsd,
        initial: v,
        revalidate: (reread) => validatePmSet(validateOpts, reread),
      }).catch((err: unknown) => {
        rejectWorkItemSet(workItemsDir, `pm repair turn threw: ${(err as Error).message}`);
        throw err;
      })
    : null;
  if (repair) {
    costUsd += repair.costUsd;
    durationMs += repair.durationMs;
    v = repair.validation;
  }
  const items = v.items;
  for (const item of items) {
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: parentEventId,
      phase: 'project-manager',
      skill: def.slug,
      event_type: 'log',
      input_refs: [input.manifestPath],
      output_refs: [resolve(workItemsDir, `${item.work_item_id}.md`)],
      message: 'pm.work-item-emitted',
      metadata: {
        work_item_id: item.work_item_id,
        // historical: carried for the Studio hex-detail drawer (D-12 removed it)
        // + the WI dependency graph (observability #11): the WI's deps, scope size, and a one-line task.
        depends_on: item.depends_on,
        files_in_scope: item.files_in_scope.length,
        ac_count: item.acceptance_criteria.length,
        task: item.acceptance_criteria[0]
          ? `Given ${item.acceptance_criteria[0].given} — Then ${item.acceptance_criteria[0].then}`
          : item.files_in_scope.join(', '),
      },
    });
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
      skill: def.slug,
      event_type: 'error',
      input_refs: [input.manifestPath],
      output_refs: [],
      message: 'pm.empty-decomposition',
      metadata: { result_subtype: resultSubtype },
    });
  }

  const failed = items.length === 0 || v.errors.length > 0 || checkpointIncomplete;

  // Partial-but-usable signal (plan 2.11): a capped run that DID write WIs is
  // a different failure class from an empty decomposition — the classifier
  // treats `usable: true` (≥1 valid WI) as transient (the 07-10 evidence shows
  // a re-queue succeeds), while empty/degenerate stays terminal.
  if (capped && items.length > 0 && failed) {
    const validCount = items.filter((it) => (v.perItem[it.work_item_id] ?? []).length === 0).length;
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: parentEventId,
      phase: 'project-manager',
      skill: def.slug,
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
    skill: def.slug,
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
    skill: def.slug,
    event_type: failed ? 'error' : 'end',
    input_refs: [input.manifestPath],
    output_refs: [workItemsDir],
    duration_ms: durationMs,
    cost_usd: costUsd,
    metadata: {
      work_item_count: items.length,
      result_subtype: resultSubtype,
      tool_use: toolUseSummary,
      parse_errors: v.parseErrors,
      set_errors: v.setErrors,
      per_item_error_count: v.itemErrorCount,
      hidden_coupling_violations: v.couplingViolations,
      ...(plannedCount !== null ? { planned_count: plannedCount } : {}),
      ...(v.accGateViolation ? { acceptance_gate_violation: v.accGateViolation } : {}),
      ...(repair ? { repair_turns: repair.turns, repair_stop: repair.stop } : {}),
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

    // R4-05-T4: the body-text completeness check stays advisory (2026-07-17);
    // the structured-AC check is blocking above (D-47). The delivery gate catches under-*delivery*; this catches
    // under-*planning* — scope stated in the initiative body but never
    // decomposed into a WI at all. Runs ONLY here, on the pass's own success
    // path, AFTER the WI set is final. It NEVER affects `failed`, the pass
    // outcome, or dispatch — a flagged decomposition still returns
    // `{ kind: 'success' }` below and proceeds to develop exactly as before.
    // `plan.completeness`'s `metadata` shape is the R4-11-F4 contract (a
    // later PR's attention-strip consumer): keep `stated_units`,
    // `covered_units`, `uncovered: string[]`, `flagged: boolean` stable.
    // Best-effort: F6 is advisory telemetry — a completeness-check or emit
    // failure must NEVER reach the `return { kind: 'success' }` below, so the
    // non-blocking guarantee is structural (matching persistManifestSpecs and
    // the other success-path telemetry writers here). checkDecomposeCompleteness
    // is a total pure function on the validated success path, so this guard
    // never fires in practice — it just makes "never affects dispatch"
    // unconditional rather than incidental.
    try {
      const completeness = checkDecomposeCompleteness(manifest.body, items);
      logger.emit({
        initiative_id: input.initiativeId,
        parent_event_id: parentEventId,
        phase: 'project-manager',
        skill: def.slug,
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
    } catch {
      /* advisory only — swallow so F6 can never affect the pass outcome */
    }

    return { kind: 'success' };
  }

  // D-49: still failing after repair → fail by name, errors recorded for Requeue's
  // repair mode; a needs-replan declaration is terminal and not recorded.
  const repairStop = repair?.stop === 'budget'
    ? `pm-repair-budget-exhausted after ${repair.turns} repair turn(s)`
    : repair?.stop === 'quarantine-failed'
      ? `pm-repair-quarantine-failed after ${repair.turns} repair turn(s): the set could not be moved aside`
      : repair?.stop === 'no-prior-set'
        ? 'pm-repair-no-prior-set: no set to repair'
        : `after ${repair?.turns ?? 0} repair turn(s)`;
  const unrepaired = repair !== null && repair.stop !== 'needs-replan' && v.errors.length > 0;
  const recorded = unrepaired && persistManifestPmValidationErrors(input.manifestPath, v.errors);
  const summary = [
    items.length === 0 ? 'no work items emitted' : null,
    checkpointIncomplete
      ? `decomposition capped mid-flight (${resultSubtype}): checkpoint plans ${plannedCount} WI(s) but only ${items.length} emitted`
      : null,
    repair === null && (items.length > 0 || Object.keys(v.parseErrors).length > 0) && v.errors.length > 0 ? `set errors: ${v.errors.join('; ')}` : null,
    repair?.stop === 'needs-replan'
      ? `${PM_REPAIR_NEEDS_REPLAN_PREFIX} ${repair.detail} — errors: ${v.errors.join('; ')}`
      : null,
    // Prefixed so failure-classifier.ts resumes it at the plan node (repair mode).
    unrepaired
      ? `${PM_SET_VALIDATION_UNREPAIRED_PREFIX} ${repairStop}: ${v.errors.join('; ')}` +
        (recorded ? '' : ' (the errors could not be recorded in the manifest)')
      : null,
  ]
    .filter((s): s is string => s !== null)
    .join('; ');

  // 8vfn.6.1 / §15.167 — claimants read the DIRECTORY. Story: pm-rejected-set.ts.
  return rejectWorkItemSet(workItemsDir, summary, { logger, initiativeId: input.initiativeId, parentEventId, skill: def.slug }, v.errors.length > 0 ? v.errors : [summary]);
}

// `appendStandingAcs` moved to pm-acceptance-gate.ts (row 157, PURE MOVE) —
// it is now internal to that module's `runCompileStage`, this file's only caller.

/** D-49: the newest `work-items-rejected-<ISO stamp>` dir under `.forge/` (stamps sort lexically), or null. */
function latestRejectedSet(forgeDir: string): string | null {
  const dirs = existsSync(forgeDir) ? readdirSync(forgeDir).filter((d) => d.startsWith('work-items-rejected-')).sort() : [];
  return dirs.length > 0 ? join(forgeDir, dirs[dirs.length - 1]!) : null;
}
