/**
 * Project-manager phase runner. Extracted from cycle.ts (Phase 3.4c step 3).
 *
 * Invokes the PM skill via the Claude Agent SDK, validates the emitted work
 * items, and emits decomposition telemetry. Behaviour is identical to the
 * prior in-cycle implementation — this module only relocates the code so the
 * orchestration spine stays thin.
 */

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';

import type { EventLogger } from '../logging.ts';
import { parseManifest } from '../manifest.ts';
import {
  PM_ALLOWED_TOOLS,
  PM_DISALLOWED_TOOLS,
  PM_MODEL,
  buildPmSystemPrompt,
  renderPmUserPrompt,
  tallyToolUse,
  type PmToolUseSummary,
} from '../pm-invocation.ts';
import {
  detectHiddenCoupling,
  readWorkItemsFromDir,
  validateWorkItemSet,
} from '../work-item.ts';
import { recordBrainGateResult, type CycleInput } from '../cycle-context.ts';

/**
 * Defaults for the live PM invocation. Higher budget + turn cap than the bench
 * (real worktrees are richer than fixtures); the bench enforces 0.5 USD / 30
 * turns to keep iteration cheap.
 */
const PM_LIVE_MAX_TURNS = 50;
// F-42: PM budget bumped from $1.00 → $2.50. The 22:17 simplification-source
// cycle hit $1.01 and emitted 0 WIs (pm-budget-exhausted). At trafficGame's
// scale (251 files; source-extraction WIs need to read ~2,600 LOC across 5
// large modules before emitting reasonable files_in_scope), $1.00 wasn't
// enough headroom. $2.50 is generous for the biggest projects without being
// open-ended; PM rarely uses more than $1.50 even at scale (Phase 1 averaged
// $0.70-1.00). Also raised because PM now runs with cwd=worktree (F-37),
// which means it correctly globs real project trees — more useful tool calls
// means slightly higher cost per cycle, in exchange for not fabricating.
const PM_LIVE_MAX_BUDGET_USD = 2.5;

export async function runProjectManager(input: CycleInput, logger: EventLogger): Promise<void> {
  const start = logger.emit({
    initiative_id: input.initiativeId,
    phase: 'project-manager',
    skill: 'project-manager',
    event_type: 'start',
    input_refs: [input.manifestPath],
    output_refs: [],
  });

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

  const manifest = parseManifest(readFileSync(input.manifestPath, 'utf8'));
  const featureCountByFeatureId = new Map<string, number>();
  for (const f of manifest.features) featureCountByFeatureId.set(f.feature_id, 0);

  const forgeRoot = resolve(import.meta.dirname, '..', '..');
  const systemPrompt = buildPmSystemPrompt(forgeRoot);
  const prompt = renderPmUserPrompt({
    initiativeId: input.initiativeId,
    manifestRelPath: input.manifestPath,
    worktreeRelPath: input.worktreePath,
    projectName: manifest.project,
    minWorkItems: Math.max(manifest.features.length, 2),
    maxWorkItems: Math.max(manifest.features.length * 4, 6),
    parallelFractionAtLeast: 0.3,
  });

  const options: Record<string, unknown> = {
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
    maxBudgetUsd: PM_LIVE_MAX_BUDGET_USD,
  };

  const toolUseSummary: PmToolUseSummary = { brainReads: 0, writes: 0, bashCalls: 0 };
  let costUsd = 0;
  let durationMs = 0;
  let resultSubtype: string | undefined;

  for await (const msg of sdkQuery({ prompt, options }) as AsyncIterable<unknown>) {
    if (typeof msg !== 'object' || msg === null) continue;
    const m = msg as { type?: string; message?: { content?: Array<{ type?: string; name?: string; input?: unknown }> }; subtype?: string; total_cost_usd?: number; duration_ms?: number };
    if (m.type === 'assistant') {
      tallyToolUse(m.message, toolUseSummary);
      continue;
    }
    if (m.type !== 'result') continue;
    if (typeof m.duration_ms === 'number') durationMs = m.duration_ms;
    if (typeof m.total_cost_usd === 'number') costUsd = m.total_cost_usd;
    resultSubtype = m.subtype ?? 'success';
    break;
  }

  for (let i = 0; i < toolUseSummary.brainReads; i++) {
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: start.event_id,
      phase: 'project-manager',
      skill: 'project-manager',
      event_type: 'tool_use',
      input_refs: ['brain/'],
      output_refs: [],
      message: 'pm.brain-query',
    });
  }

  // F-13 / F-19: enforce the brain-first mandate at the orchestrator. If the
  // PM agent skipped brain-query entirely, fail fast with a distinct error
  // (rather than continuing into validateWorkItemSet, where the
  // brain-skip's downstream effect — incomplete frontmatter — surfaces
  // instead, masking the real cause).
  if (
    !recordBrainGateResult('project-manager', 'project-manager', toolUseSummary.brainReads, {
      initiativeId: input.initiativeId,
      logger,
      parentEventId: start.event_id,
    })
  ) {
    throw new Error(
      'project-manager phase failed: brain-first mandate not honoured (0 brain-query calls). The system prompt requires reading from `brain/...` (forge themes + project themes) before producing work items.',
    );
  }

  const workItemsDir = resolve(input.worktreePath, '.forge', 'work-items');
  const { items, parseErrors } = readWorkItemsFromDir(workItemsDir);

  for (const item of items) {
    const prev = featureCountByFeatureId.get(item.feature_id) ?? 0;
    featureCountByFeatureId.set(item.feature_id, prev + 1);
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: start.event_id,
      phase: 'project-manager',
      skill: 'project-manager',
      event_type: 'log',
      input_refs: [input.manifestPath],
      output_refs: [resolve(workItemsDir, `${item.work_item_id}.md`)],
      message: 'pm.work-item-emitted',
      metadata: { work_item_id: item.work_item_id, feature_id: item.feature_id },
    });
  }

  for (const [featureId, count] of featureCountByFeatureId.entries()) {
    logger.emit({
      initiative_id: input.initiativeId,
      parent_event_id: start.event_id,
      phase: 'project-manager',
      skill: 'project-manager',
      event_type: 'log',
      input_refs: [input.manifestPath],
      output_refs: [],
      message: 'pm.feature-decomposed',
      metadata: { feature_id: featureId, work_item_count: count },
    });
  }

  const knownFeatureIds = new Set(manifest.features.map((f) => f.feature_id));
  const { perItem, setErrors } = validateWorkItemSet(items, {
    expectedInitiativeId: manifest.initiative_id,
    knownFeatureIds,
  });
  const itemErrorCount = Object.values(perItem).reduce((acc, errs) => acc + errs.length, 0);

  // F-05: hidden-coupling check. Two WIs whose `files_in_scope` overlap
  // without a `depends_on` edge between them will conflict at merge time.
  // The bench has scored this since pass-1; production didn't enforce it
  // until now. Failures here surface as a distinct error so the operator
  // sees the structural cause rather than a generic "PM phase failed".
  const couplingViolations = items.length > 0 ? detectHiddenCoupling(items) : [];

  // F-39: F-36 path validation REMOVED. The original failure mode (PM
  // fabricating `src/engine/` directories that don't exist) was caused by
  // PM running with cwd=forgeRoot — F-37 fixed that structurally by moving
  // PM into the worktree. With cwd=worktree, the PM can no longer easily
  // fabricate non-existent paths because it's globbing the real project.
  //
  // The F-36 validator was kept as belt-and-suspenders, but at trafficGame
  // scale it produces too many false positives: legitimate WIs that create
  // new test files describe behaviour in their THEN clauses ("tests assert
  // flowEfficiency is 100...") rather than re-listing the filename. The
  // validator couldn't tell apart fabrication from legitimate new-file
  // creation and was blocking real work.
  //
  // The function is kept in work-item.ts for the unit tests + future use;
  // it's just no longer called from the cycle. If a path is genuinely
  // wrong, the dev-loop will fail naturally when the agent can't operate
  // on it — and we have F-23 telemetry + F-27 classification to diagnose
  // that downstream failure cleanly.

  const failed =
    items.length === 0 ||
    Object.keys(parseErrors).length > 0 ||
    setErrors.length > 0 ||
    itemErrorCount > 0 ||
    couplingViolations.length > 0;

  logger.emit({
    initiative_id: input.initiativeId,
    parent_event_id: start.event_id,
    phase: 'project-manager',
    skill: 'project-manager',
    event_type: 'log',
    input_refs: [input.manifestPath],
    output_refs: [resolve(workItemsDir, '_graph.md')],
    message: 'pm.graph-emitted',
  });

  logger.emit({
    initiative_id: input.initiativeId,
    parent_event_id: start.event_id,
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
    },
  });

  if (failed) {
    const summary = [
      items.length === 0 ? 'no work items emitted' : null,
      Object.keys(parseErrors).length > 0 ? `parse errors: ${Object.keys(parseErrors).join(', ')}` : null,
      setErrors.length > 0 ? `set errors: ${setErrors.join('; ')}` : null,
      itemErrorCount > 0 ? `${itemErrorCount} per-item validation errors` : null,
      couplingViolations.length > 0
        ? `${couplingViolations.length} hidden-coupling pair(s): ${couplingViolations.map((p) => `${p.a}↔${p.b} share ${p.sharedFiles.join(',')}`).join('; ')}`
        : null,
    ]
      .filter((s): s is string => s !== null)
      .join('; ');
    throw new Error(`project-manager phase failed: ${summary}`);
  }
}
