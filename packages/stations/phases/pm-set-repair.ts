/**
 * forge-mfv5.1.34 (D-49) — the PM's set validation as ONE list of named errors,
 * and the bounded REPAIR turns a failing set earns. Replaces row 157's one-shot
 * revise, which fired only when the acceptance gate was the SOLE error (gitweave
 * I2 failed on a D-18 bound AND a D-47 criterion; the PM saw neither). What a
 * repair turn does is agent intent — SKILL.md "Repair turn" (SPEC §1); the
 * prompt here is data only.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { EventLogger } from '@forge/kernel';
import { runAgent, resolveOneShotBudgetUsd, type StreamQueryFn } from '@forge/agents';
import type { AgentDefinition } from '@forge/contracts';
import type { AcceptanceGateConfig } from '@forge/projects';
import { readWorkItemsFromDir, validateWorkItemSet, type CouplingPair, type CycleInput, type WorkItem } from '@forge/flows';
import { acceptanceGateViolation, runCompileStage, type RunCompileStageOptions } from './pm-acceptance-gate.ts';
import { acceptanceCriteriaViolation } from './decompose-completeness.ts';
import { quarantineRejectedSet } from './pm-rejected-set.ts';
import { requireClassProfiles, type ClassProfilePort } from '../class-profile-port.ts';
import { requireCycleId } from './cycle-id.ts';

/** At most this many repair turns per PM pass; the budget stop may allow fewer. */
export const REPAIR_TURNS_MAX = 2;
/** A repair turn's spend ceiling, as a share of the PM's own resolved cap. */
const REPAIR_BUDGET_FRACTION = 0.5;
/** A repair turn writes this file when an error needs the plan changed (D-49: refuse, never re-plan). */
export const NEEDS_REPLAN_FILENAME = '_needs-replan.md';
/** Agent-written text reaches the summary and the event log: bounded. */
const NEEDS_REPLAN_MAX_CHARS = 2000;

export type PmSetValidation = {
  items: WorkItem[];
  parseErrors: Record<string, string>;
  setErrors: string[];
  perItem: Record<string, string[]>;
  itemErrorCount: number;
  couplingViolations: CouplingPair[];
  /** The acceptance gate + D-47 coverage messages joined (event-metadata shape). */
  accGateViolation: string | null;
  /** EVERY error above, one named line each — what a repair turn is fed and the manifest records. */
  errors: string[];
};

export type ValidatePmSetOptions = Omit<RunCompileStageOptions, 'items'> & {
  accGate: AcceptanceGateConfig | undefined;
  classProfiles: ClassProfilePort | undefined;
  skill: string;
};

/** Compile stage + set validation + acceptance gate + D-47 coverage over one read of the set. */
export function validatePmSet(
  o: ValidatePmSetOptions,
  read: { items: WorkItem[]; parseErrors: Record<string, string> },
): PmSetValidation {
  const stage = runCompileStage({ ...o, items: read.items });
  const items = stage.items;
  const { perItem, setErrors: validationSetErrors } = validateWorkItemSet(items, { expectedInitiativeId: o.manifest.initiative_id });
  const setErrors = [...validationSetErrors, ...stage.compileErrors];
  let gate: string | null = null;
  if (o.accGate && items.length > 0) {
    const acceptance = requireClassProfiles(o.classProfiles, 'project-manager').profileFor(o.manifest.class).acceptance;
    if (acceptance === 'advisory') {
      o.logger.emit({
        initiative_id: o.manifest.initiative_id, parent_event_id: o.parentEventId,
        phase: 'project-manager', skill: o.skill, event_type: 'log',
        input_refs: [], output_refs: [], message: 'pm.acceptance-wi-not-required',
        metadata: { change_class: o.manifest.class, reason: "the class profile's acceptance is advisory" },
      });
    } else {
      gate = acceptanceGateViolation(items, acceptance, o.accGate);
    }
  }
  const coverage = items.length > 0 ? acceptanceCriteriaViolation(o.manifest.acceptance_criteria, items) : null;
  const errors = [
    ...(items.length === 0 && Object.keys(read.parseErrors).length === 0 ? ['the work-item set is empty'] : []),
    ...Object.entries(read.parseErrors).map(([file, msg]) => `${file}: unparseable — ${msg}`),
    ...setErrors,
    ...Object.entries(perItem).flatMap(([id, errs]) => errs.map((e) => `${id}: ${e}`)),
    ...stage.couplingViolations.map((c) => `hidden coupling: ${c.a}↔${c.b} share ${c.sharedFiles.join(',')}`),
    ...[gate, coverage].filter((v): v is string => v !== null),
  ];
  return {
    items, parseErrors: read.parseErrors, setErrors, perItem,
    itemErrorCount: Object.values(perItem).reduce((acc, errs) => acc + errs.length, 0),
    couplingViolations: stage.couplingViolations,
    accGateViolation: [gate, coverage].filter((v): v is string => v !== null).join(' ') || null,
    errors,
  };
}

export type RepairStop = 'resolved' | 'exhausted' | 'budget' | 'needs-replan' | 'quarantine-failed' | 'no-prior-set';

export type PmRepairLoopInput = {
  input: CycleInput;
  logger: EventLogger;
  parentEventId: string;
  def: AgentDefinition;
  queryFn: StreamQueryFn;
  systemPrompt: string;
  workItemsDir: string;
  costBudgetUsd: number;
  /** What this PM pass has already spent — the budget stop counts it. */
  spentUsd: number;
  initial: PmSetValidation;
  revalidate: (read: { items: WorkItem[]; parseErrors: Record<string, string> }) => PmSetValidation;
  signal?: AbortSignal;
};

export type PmRepairLoopResult = {
  stop: RepairStop;
  validation: PmSetValidation;
  costUsd: number;
  durationMs: number;
  turns: number;
  /** needs-replan: the agent's own reason, verbatim. */
  detail?: string;
};

function renderRepairPrompt(turn: number, v: PmSetValidation, previousSetRel: string): string {
  const gate = (it: WorkItem): string => (it.quality_gate_cmd ?? []).join(' ') || '(none)';
  return [
    `# Repair turn ${turn} of ${REPAIR_TURNS_MAX}`,
    '',
    'Your work-item set failed validation. Follow the "Repair turn" section of your instructions: ' +
      'write a FULL replacement set into `.forge/work-items/` (it is empty now).',
    '',
    '## Validation errors (verbatim)',
    '',
    ...v.errors.map((e, i) => `${i + 1}. ${e}`),
    '',
    `## Your previous set — moved to \`${previousSetRel}/\``,
    '',
    ...v.items.map((it) => `- ${it.work_item_id}.md — creates ${(it.creates ?? []).length}, gate \`${gate(it)}\``),
    ...Object.keys(v.parseErrors).map((file) => `- ${file} — unparseable`),
  ].join('\n');
}

/** At most `REPAIR_TURNS_MAX` turns: quarantine the failing set (evidence AND the
 *  turn's reference), spawn one capped turn fed every error, re-validate through
 *  the SAME `revalidate`. Stops before a turn that would breach `costBudgetUsd`. */
export async function runPmRepairLoop(p: PmRepairLoopInput): Promise<PmRepairLoopResult> {
  const { input, logger, parentEventId, def } = p;
  const passCap = resolveOneShotBudgetUsd(def.budgets, { id: input.initiativeId, costBudgetUsd: p.costBudgetUsd });
  if (passCap === undefined) throw new Error('pm repair: the project-manager declares no budget cap (budgets.maxBudgetUsd / maxBudgetUsdShare)');
  const ceiling = passCap * REPAIR_BUDGET_FRACTION;
  const emit = (message: string, metadata: Record<string, unknown>): void => {
    logger.emit({
      initiative_id: input.initiativeId, parent_event_id: parentEventId, phase: 'project-manager',
      skill: def.slug, event_type: 'log', input_refs: [], output_refs: [], message, metadata,
    });
  };
  let v = p.initial;
  let costUsd = 0;
  let durationMs = 0;
  let turns = 0;
  let previousSet: string | null = null;
  const done = (stop: RepairStop, detail?: string): PmRepairLoopResult =>
    ({ stop, validation: v, costUsd, durationMs, turns, ...(detail !== undefined ? { detail } : {}) });
  while (v.errors.length > 0) {
    if (turns >= REPAIR_TURNS_MAX) return done('exhausted');
    if (p.spentUsd + costUsd + ceiling > p.costBudgetUsd) return done('budget');
    // A set on disk is moved aside (evidence + this turn's reference); an empty
    // dir (a turn that wrote nothing) reuses the last one.
    const onDisk = existsSync(p.workItemsDir) && readdirSync(p.workItemsDir).length > 0;
    if (onDisk) {
      const moved = quarantineRejectedSet(p.workItemsDir, v.errors).movedTo;
      if (moved === null) return done('quarantine-failed');
      previousSet = moved;
    }
    if (previousSet === null) return done('no-prior-set');
    turns += 1;
    emit('pm.repair.start', { turn: turns, of: REPAIR_TURNS_MAX, errors: v.errors, previous_set: previousSet, ceiling_usd: ceiling });
    const spawn = await runAgent(def, {
      runId: `${requireCycleId(input, 'runPmRepairLoop')}-pm-repair-${turns}`,
      workdir: input.worktreePath,
      cwd: input.worktreePath,
      prompt: renderRepairPrompt(turns, v, relative(input.worktreePath, previousSet)),
      systemPrompt: p.systemPrompt,
      lifecycle: 'caller',
      logger,
      streamGuard: { label: 'project-manager-repair', signal: p.signal },
      kickoffCeilingUsd: ceiling,
      bindings: { initiative: { id: input.initiativeId, manifestPath: input.manifestPath, costBudgetUsd: p.costBudgetUsd } },
      queryFn: p.queryFn,
    });
    costUsd += spawn.costUsd;
    durationMs += spawn.durationMs ?? 0;
    const marker = join(p.workItemsDir, NEEDS_REPLAN_FILENAME);
    if (existsSync(marker)) {
      const reason = readFileSync(marker, 'utf8').trim().slice(0, NEEDS_REPLAN_MAX_CHARS) || '(the needs-replan marker gave no reason)';
      emit('pm.repair.end', { turn: turns, cost_usd: spawn.costUsd, result_subtype: spawn.resultSubtype, resolved: false, needs_replan: reason });
      return done('needs-replan', reason);
    }
    const before = v;
    v = p.revalidate(readWorkItemsFromDir(p.workItemsDir));
    // Fail closed: a turn that wrote nothing keeps the errors it was fed; a turn
    // cut off by its cap (or with no result) may have left a truncated set that validates.
    if (v.items.length === 0 && Object.keys(v.parseErrors).length === 0) v = { ...before, errors: ['the repair turn wrote no work items', ...before.errors] };
    else if (spawn.resultSubtype !== 'success') v = { ...v, errors: [...v.errors, `repair turn ${turns} ended ${spawn.resultSubtype ?? 'without a result'} — its set may be truncated`] };
    emit('pm.repair.end', { turn: turns, cost_usd: spawn.costUsd, result_subtype: spawn.resultSubtype, resolved: v.errors.length === 0, errors: v.errors });
  }
  return done('resolved');
}
