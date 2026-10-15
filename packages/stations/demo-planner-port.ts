/**
 * The demo planner port (forge-mfv5.1.19, D-45). A factory that wires one (`createPhaseExecutor({ demoPlanner })`)
 * is asked, for a `capture: 'checkpoints'` class, which evidence form each checkpoint takes and what the change
 * enables. The answer is inert data: the band validates it by name, merges it into the ONE demo.json (D-07), and
 * captures and compares the evidence itself (D-15). A factory that wires none keeps the derived checkpoints.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
  /** Set on the ONE revise turn: why the previous plan was sent back, with the facts that sent it. */
  revise?: { reason: string; details: readonly string[] };
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
  const first = await askAndValidate(planner, revise ? { ...base, revise } : base, ctx.logger, emit);
  if (!first.ok) return first;
  let plan = first.plan;
  // forge-nk1y.42: a command that would not run the tree under capture is sent
  // back ONCE, with the refusal by name. A plan still refused after it reaches
  // the band's own preflight, which fails `tooling-unavailable` by name.
  const refused = unproducible(plan, input.worktreePath);
  if (refused.length > 0 && !revise) {
    emit('demo.plan.revise', { reason: 'unproducible', problems: refused });
    const second = await askAndValidate(planner, { ...base, revise: { reason: 'checkpoint command(s) not producible from the tree under capture', details: refused } }, ctx.logger, emit);
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

async function askAndValidate(
  planner: NonNullable<IntegrateBandInput['planner']>,
  plannerInput: DemoPlannerInput,
  logger: EventLogger,
  emit: Emit,
): Promise<{ ok: true; plan: DemoPlan } | { ok: false; reason: 'plan-failed' | 'plan-invalid'; detail: string }> {
  const out = await planner.port.plan(planner.def, plannerInput, logger, planner.signal);
  const cost = out.costUsd !== undefined ? { cost_usd: out.costUsd } : {};
  if (!out.ok) {
    emit('demo.plan.failed', { reason: out.reason, detail: out.detail }, { event_type: 'error', ...cost });
    return { ok: false, reason: 'plan-failed', detail: `${out.reason}: ${out.detail}` };
  }
  const v = validateDemoPlan(out.raw, plannerInput.allowed);
  if (!v.ok) {
    emit('demo.plan.invalid', { errors: v.errors }, { event_type: 'error', ...cost });
    return { ok: false, reason: 'plan-invalid', detail: v.errors.join('; ') };
  }
  emit('demo.plan.validated', { forms: v.plan.checkpoints.map((c) => c.form), ...(plannerInput.revise ? { revise: true } : {}) }, cost);
  return { ok: true, plan: v.plan };
}
