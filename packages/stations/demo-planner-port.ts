/**
 * The demo planner port (forge-mfv5.1.19, D-45). A factory that wires one (`createPhaseExecutor({ demoPlanner })`)
 * is asked, for a `capture: 'checkpoints'` class, which evidence form each checkpoint takes and what the change
 * enables. The answer is inert data: the band validates it by name, merges it into the ONE demo.json (D-07), and
 * captures and compares the evidence itself (D-15). A factory that wires none keeps the derived checkpoints.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { extractDrivableCommand, type AgentDefinition } from '@forge/contracts';
import { preflightDemoCommands, projectRunPrefixes, worktreeDemoDir } from '@forge/flows';
import type { EventLogger } from '@forge/kernel';
import { allowedDemoMeans, validateDemoPlan, type AllowedDemoMeans, type DemoPlan, type ProjectConfig } from '@forge/projects';

import type { DemoModel } from './demo-model.ts';
import { gateOutputText, renderAcceptanceCriterion, type DerivedDemoInput } from './phases/derive-demo-model.ts';
import type { IntegrateBandInput } from './phases/integrate.ts';

/** The validated plan, recorded beside demo.json and committed with it. */
export const DEMO_PLAN_BASENAME = 'demo-plan.json';

export type DemoPlannerInput = {
  initiativeId: string; cycleId: string; worktreePath: string; title: string;
  /** A work item's body carries its user story. */
  workItems: ReadonlyArray<{ id: string; title: string; story: string }>;
  acceptanceCriteria: readonly string[]; diffStat: string; changedFiles: readonly string[]; allowed: AllowedDemoMeans;
  /** Set on the ONE revise turn: why the previous plan was sent back, with the facts that sent it;
   *  on a repair turn (forge-mfv5.1.41) also the refused plan itself, as JSON. */
  revise?: { reason: string; details: readonly string[]; invalidPlan?: string };
};
export type DemoPlannerOutcome =
  | { ok: true; raw: unknown; costUsd: number }
  | { ok: false; reason: 'spawn-suppressed' | 'spawn-failed' | 'no-plan'; detail: string; costUsd?: number };
export type DemoPlannerPort = {
  plan(def: AgentDefinition, input: DemoPlannerInput, logger: EventLogger, signal?: AbortSignal): Promise<DemoPlannerOutcome>;
};

/** The plan's checkpoints replace the derived ones; `test-evidence` carries the gate output. Pure. */
export function mergeDemoPlan(model: DemoModel, plan: DemoPlan, gateOutput: string): DemoModel {
  const checkpoints = plan.checkpoints.map(({ acRef, ...cp }, i) => ({
    label: `Plan ${i + 1}: ${acRef ?? cp.form}`, ...cp, ...(cp.form === 'test-evidence' ? { afterOutput: gateOutput } : {}),
    ...(cp.form === 'screenshot' ? { kind: 'screenshot' as const } : {}), // capture keys a browser checkpoint on its kind
  }));
  return { ...model, checkpoints, narrative: plan.narrative };
}

type Emit = (message: string, metadata?: Record<string, unknown>, extra?: { event_type?: 'log' | 'error'; cost_usd?: number }) => void;

/** Ask the planner, validate by name, record the plan, merge. Any failure fails the band — no fallback. */
export async function planDemo(
  planner: NonNullable<IntegrateBandInput['planner']>,
  ctx: { input: IntegrateBandInput; derivedInput: DerivedDemoInput; cfg: ProjectConfig | null; model: DemoModel; logger: EventLogger },
  emit: Emit,
  /** The band's own revise (forge-nk1y.43): the first ask carries it, and it is the plan's one revise. */
  revise?: DemoPlannerInput['revise'],
): Promise<{ ok: true; model: DemoModel } | { ok: false; reason: 'plan-failed' | 'plan-invalid'; detail: string }> {
  const { input, derivedInput: d, cfg } = ctx;
  const processCommands = (cfg?.demoProcess ?? []).filter((s) => s.kind === 'capture').map((s) => extractDrivableCommand(s.text)).flatMap((r) => (r.ok ? [r.command] : []));
  const allowed = allowedDemoMeans(cfg?.demoMeans, d.acceptanceCriteria, processCommands);
  emit('demo.plan.start', { commands: allowed.commands.length, routes: allowed.routes.length, api_paths: allowed.apiPaths.length, api_commands: allowed.apiCommands.length });
  const base: DemoPlannerInput = {
    initiativeId: input.initiativeId, cycleId: planner.cycleId, worktreePath: input.worktreePath, title: d.title,
    workItems: d.workItems.map((wi) => ({ id: wi.id, title: wi.title, story: wi.story ?? '' })),
    acceptanceCriteria: d.acceptanceCriteria.map(renderAcceptanceCriterion), diffStat: d.diffStat, changedFiles: d.changedFiles, allowed,
  };
  // forge-mfv5.1.41 (D-49 shape): ONE repair turn per planning call, spent on the first refused plan.
  const repair = { used: false };
  const first = await askRepairing(planner, revise ? { ...base, revise } : base, ctx.logger, emit, repair);
  if (!first.ok) return first;
  let plan = first.plan;
  // forge-nk1y.42: a command that would not run the tree under capture is sent
  // back ONCE, with the refusal by name. A plan still refused after it reaches
  // the band's own preflight, which fails `tooling-unavailable` by name.
  const refused = unproducible(plan, input.worktreePath);
  if (refused.length > 0 && !revise) {
    emit('demo.plan.revise', { reason: 'unproducible', problems: refused });
    const second = await askRepairing(planner, { ...base, revise: { reason: 'checkpoint command(s) not producible from the tree under capture', details: refused } }, ctx.logger, emit, repair);
    if (!second.ok) return second;
    plan = second.plan;
  }
  const demoDir = worktreeDemoDir(input.worktreePath, input.initiativeId);
  mkdirSync(demoDir, { recursive: true });
  writeFileSync(join(demoDir, DEMO_PLAN_BASENAME), `${JSON.stringify(plan, null, 2)}\n`);
  return { ok: true, model: mergeDemoPlan(ctx.model, plan, gateOutputText(d.gateEvidence)) };
}

/** The plan's command checkpoints the preflight refuses, each named. */
function unproducible(plan: DemoPlan, worktreePath: string): string[] {
  const prefixes = projectRunPrefixes(worktreePath);
  if (!prefixes.ok) return [prefixes.reason];
  const commands = plan.checkpoints.flatMap((cp, i) => (cp.command ? [{ label: `Plan ${i + 1}`, command: cp.command }] : []));
  return preflightDemoCommands(commands, worktreePath, { runPrefixes: prefixes.runPrefixes }).problems;
}

/** A refused plan shown back to the planner is bounded: the validator caps its rows, this caps the echo. */
const INVALID_PLAN_MAX_CHARS = 8000;

type Asked = { ok: true; plan: DemoPlan } | { ok: false; reason: 'plan-failed' | 'plan-invalid'; detail: string; errors?: string[]; raw?: unknown };

/**
 * Ask; on a refused plan spend the call's ONE repair turn (forge-mfv5.1.41, D-49 shape): the planner is shown
 * the validator's errors verbatim, the refused plan and — as on every ask — the declared means, and its answer
 * is validated the same way (D-45 unchanged). A second refusal fails by name with both outputs and the recovery act.
 */
async function askRepairing(
  planner: NonNullable<IntegrateBandInput['planner']>,
  plannerInput: DemoPlannerInput,
  logger: EventLogger,
  emit: Emit,
  repair: { used: boolean },
): Promise<Asked> {
  const first = await askAndValidate(planner, plannerInput, logger, emit, repair.used ? 2 : 1);
  if (first.ok || first.reason !== 'plan-invalid' || repair.used) return first;
  repair.used = true;
  const errors = first.errors ?? [];
  emit('demo.plan.repair-turn', { errors });
  const invalidPlan = (JSON.stringify(first.raw, null, 2) ?? String(first.raw)).slice(0, INVALID_PLAN_MAX_CHARS);
  const earlier = plannerInput.revise ? ` (it was itself a revise: ${plannerInput.revise.reason})` : '';
  const second = await askAndValidate(planner, {
    ...plannerInput,
    revise: { reason: `your last plan failed validation${earlier} — fix every row below, naming only the allowed means verbatim`, details: errors, invalidPlan },
  }, logger, emit, 2);
  if (second.ok || second.reason !== 'plan-invalid') return second;
  return {
    ok: false, reason: 'plan-invalid',
    detail: `Demo plan invalid after a repair turn: ${second.detail} (first plan: ${first.detail}) — Resume from integrate re-runs the planner`,
  };
}

/** Write the refused plan beside the cycle's events so a refusal is diagnosable; a failed write is named, never silent. */
function persistInvalidPlan(raw: unknown, logger: EventLogger, attempt: number, emit: Emit): string | null {
  try {
    const dir = dirname(logger.logFilePath);
    mkdirSync(dir, { recursive: true });
    // A later planning call in the same cycle (the band's no-change revise) never overwrites an earlier record.
    let n = attempt;
    while (existsSync(join(dir, `demo-plan-invalid-${n}.json`))) n += 1;
    const path = join(dir, `demo-plan-invalid-${n}.json`);
    writeFileSync(path, `${JSON.stringify(raw, null, 2) ?? String(raw)}\n`);
    return path;
  } catch (err) {
    emit('demo.plan.raw-persist-failed', { attempt, detail: err instanceof Error ? err.message : String(err) }, { event_type: 'error' });
    return null;
  }
}

async function askAndValidate(
  planner: NonNullable<IntegrateBandInput['planner']>,
  plannerInput: DemoPlannerInput,
  logger: EventLogger,
  emit: Emit,
  attempt: number,
): Promise<Asked> {
  const out = await planner.port.plan(planner.def, plannerInput, logger, planner.signal);
  const cost = out.costUsd !== undefined ? { cost_usd: out.costUsd } : {};
  if (!out.ok) {
    emit('demo.plan.failed', { reason: out.reason, detail: out.detail }, { event_type: 'error', ...cost });
    return { ok: false, reason: 'plan-failed', detail: `${out.reason}: ${out.detail}` };
  }
  const v = validateDemoPlan(out.raw, plannerInput.allowed);
  if (!v.ok) {
    const rawPlanPath = persistInvalidPlan(out.raw, logger, attempt, emit);
    emit('demo.plan.invalid', { errors: v.errors, attempt, raw_plan_path: rawPlanPath }, { event_type: 'error', ...cost });
    return { ok: false, reason: 'plan-invalid', detail: v.errors.join('; '), errors: v.errors, raw: out.raw };
  }
  emit('demo.plan.validated', { forms: v.plan.checkpoints.map((c) => c.form), ...(plannerInput.revise ? { revise: true } : {}) }, cost);
  return { ok: true, plan: v.plan };
}
