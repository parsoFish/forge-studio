/**
 * Demo-agent pipeline (R4-07) — the orchestrator bands around the one-shot
 * demo-agent spawn.
 *
 * Band order: derive (diffStat/headSha — injected, never trusted from an
 * inherited demo.json) → spawn (`runAgent`, `lifecycle: 'caller'`) → validate
 * (schema + injected-diffStat equality; ONE bounded retry with the errors in
 * the prompt — authoring bugs only) → render (in-process `renderDemoBundle`;
 * the agent never runs `forge demo render`) → orchestrated capture (reused
 * ADR-036 machinery: producibility preflight, nonce, commit; tooling
 * unavailability is a HARD failure, never a silent `met`) → judgment (F2:
 * `partial|missed` acEvaluations require agent-authored fix proposals,
 * persisted as the `demo-fix-spec` artifact for the R4-10-F1 fix executor —
 * judgment only, nothing is dispatched or enqueued here).
 *
 * Failure classes are deliberately distinct event vocabularies (a missing-
 * evidence environment failure must never look like a code bug):
 * `demo.author.invalid` (retryable ×1) / `demo.capture.tooling-unavailable`
 * (hard) / `demo.capture` (outcome, incl. nonce verification) /
 * `demo.ac-miss` + `demo.fix-spec.authored` (judgment, NOT failures) /
 * `demo.complete`.
 *
 * Not wired into any seed flow — R4-10 assembles the successor flow; the
 * input shape mirrors the flow-node executors so wrapping this as a
 * NodeExecutor is mechanical.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  coerceDemoModel,
  renderDemoBundle,
  stripScratchFromDiffStat,
  validateDemoModel,
  type AcEvaluation,
  type DemoModel,
} from '../../cli/demo-model.ts';
import {
  validateDemoFixSpec,
  writeDemoFixSpecJson,
  type DemoFixProposal,
  type DemoFixSpecRecord,
} from '../flow-artifacts.ts';
import { worktreeDemoDir, worktreeDemoRelDir, DEMO_JSON_BASENAME } from '../demo-paths.ts';
import type { EventLogger } from '../logging.ts';
import type { StreamQueryFn } from '../pinned-sdk-query.ts';
import { loadProjectConfig } from '../project-config.ts';
import { runAgent } from '../run-agent.ts';
import { skillPath } from '../skill-path.ts';
import { listDemoElements, loadAgentDefinition } from '../studio/registry.ts';
import { FORGE_ROOT } from '../studio/derive.ts';
import { readWorkItemsFromDir } from '../work-item.ts';
import {
  buildDemoAgentSystemPrompt,
  renderDemoAgentUserPrompt,
  FIX_PROPOSALS_FILENAME,
} from './demo-agent-binding.ts';
import {
  buildDemoCaptureArgv,
  CAPTURE_NONCE_ENV,
  demoJsonWantsCapture,
  generateCaptureNonce,
  preflightDemoCaptureCommands,
  resolveDemoCaptureTimeoutMs,
  runOrchestratorCommand,
  commitOrchestratedCaptureArtifacts,
} from './orchestrated-capture.ts';

const DEMO_AGENT_SLUG = 'demo-agent';

/** Authoring-bug retries only — capture/tooling failures never re-spawn the agent. */
const MAX_AUTHOR_ATTEMPTS = 2;

export type DemoAgentPipelineInput = {
  initiativeId: string;
  worktreePath: string;
  cycleId: string;
  logsRoot: string;
  /** Initiative cost budget (manifest `cost_budget_usd`) — resolves declared share caps. */
  costBudgetUsd?: number;
  /** Capture argv override (tests substitute a fake engine); default = the forge CLI. */
  orchestratedCapture?: { argv: string[]; timeoutMs?: number };
  /** Root carrying `studio/demo-elements/` — defaults to the forge repo root. */
  forgeRoot?: string;
};

export type DemoAgentPipelineResult =
  | { status: 'complete'; demoJsonPath: string }
  | { status: 'complete-with-misses'; demoJsonPath: string; misses: AcEvaluation[]; fixSpecPath: string }
  | {
      status: 'failed';
      reason:
        | 'derive-failed'
        | 'author-invalid'
        | 'tooling-unavailable'
        | 'capture-failed'
        | 'nonce-mismatch'
        | 'spawn-suppressed'
        | 'spawn-failed';
      detail: string;
    };

export async function runDemoAgentPipeline(
  input: DemoAgentPipelineInput,
  logger: EventLogger,
  opts: { queryFn?: StreamQueryFn; signal?: AbortSignal } = {},
): Promise<DemoAgentPipelineResult> {
  const emit = (
    message: string,
    metadata: Record<string, unknown> = {},
    extra: { event_type?: 'log' | 'error'; cost_usd?: number } = {},
  ): void => {
    logger.emit({
      initiative_id: input.initiativeId,
      phase: 'orchestrator',
      skill: DEMO_AGENT_SLUG,
      event_type: extra.event_type ?? 'log',
      input_refs: [],
      output_refs: [],
      ...(extra.cost_usd !== undefined ? { cost_usd: extra.cost_usd } : {}),
      message,
      metadata: { agent_slug: DEMO_AGENT_SLUG, ...metadata },
    });
  };

  // Caller-lifecycle spawns bypass runAgent's own env guard — the pipeline owns
  // suppression (run-agent.ts module doc). An injected queryFn (tests) is not a
  // real spawn, so it proceeds.
  if (!opts.queryFn && (process.env.FORGE_DRY_BRIDGE === '1' || process.env.FORGE_ARCHITECT_NO_SPAWN === '1')) {
    emit('demo.spawn-suppressed', {
      reason: process.env.FORGE_DRY_BRIDGE === '1' ? 'FORGE_DRY_BRIDGE' : 'FORGE_ARCHITECT_NO_SPAWN',
    });
    return { status: 'failed', reason: 'spawn-suppressed', detail: 'spawn suppressed by harness env — no demo authored (never faked)' };
  }

  const def = loadAgentDefinition(skillPath(DEMO_AGENT_SLUG));
  if (def.budgets.maxTurns === undefined) {
    throw new Error('demo-agent SKILL.md must declare budgets.maxTurns — the live turn cap is frontmatter data (ADR-039)');
  }
  if (def.budgets.maxBudgetUsd === undefined && def.budgets.maxBudgetUsdShare === undefined) {
    throw new Error(
      'demo-agent SKILL.md must declare a budget cap (budgets.maxBudgetUsd and/or maxBudgetUsdShare) — an uncapped unattended agent re-opens the F-42/F-43 silent-spend vector',
    );
  }

  // Band 1 — derive branch state. Injected into the prompt; the authored
  // demo.json must echo it (stale-after-fanin theme: never trust inherited).
  const gitTimeout = 60_000;
  const diffStatRes = runOrchestratorCommand(['git', 'diff', '--stat', 'main...HEAD'], {
    cwd: input.worktreePath,
    timeoutMs: gitTimeout,
  });
  const headShaRes = runOrchestratorCommand(['git', 'rev-parse', 'HEAD'], {
    cwd: input.worktreePath,
    timeoutMs: gitTimeout,
  });
  if (!diffStatRes.ok || !headShaRes.ok) {
    const detail = `git derivation failed: ${diffStatRes.ok ? '' : diffStatRes.stderrTail} ${headShaRes.ok ? '' : headShaRes.stderrTail}`.trim();
    emit('demo.derive.failed', { detail }, { event_type: 'error' });
    return { status: 'failed', reason: 'derive-failed', detail };
  }
  const diffStat = diffStatRes.stdoutTail.trim();
  const headSha = headShaRes.stdoutTail.trim();

  const demoDirRel = worktreeDemoRelDir(input.worktreePath, input.initiativeId);
  const demoDirAbs = worktreeDemoDir(input.worktreePath, input.initiativeId);
  const demoJsonAbs = join(demoDirAbs, DEMO_JSON_BASENAME);
  const proposalsAbs = join(demoDirAbs, FIX_PROPOSALS_FILENAME);
  // Stale judgment from a prior pass must never leak into this one.
  if (existsSync(proposalsAbs)) unlinkSync(proposalsAbs);

  // Band 2 — assemble the briefing from develop output + project config.
  const cfg = (() => {
    try {
      return loadProjectConfig(input.worktreePath);
    } catch {
      return null;
    }
  })();
  const qualityGateCmd = cfg?.quality_gate_cmd ?? ['npm', 'test'];
  const demoProcess = cfg?.demoProcess ?? [];
  const wiDir = join(input.worktreePath, '.forge', 'work-items');
  const workItems: Array<{ id: string; title: string; status: string }> = [];
  const acceptanceCriteria: string[] = [];
  if (existsSync(wiDir)) {
    const { items } = readWorkItemsFromDir(wiDir);
    for (const wi of items) {
      workItems.push({ id: wi.work_item_id, title: wi.body.split('\n')[0] ?? wi.work_item_id, status: wi.status });
      for (const ac of wi.acceptance_criteria) {
        acceptanceCriteria.push(`(${wi.work_item_id}) GIVEN ${ac.given.trim()} WHEN ${ac.when.trim()} THEN ${ac.then.trim()}`);
      }
    }
  }
  const library = listDemoElements(input.forgeRoot ?? FORGE_ROOT);
  const elementIds = new Set(demoProcess.map((s) => s.element).filter(Boolean) as string[]);
  const elements =
    elementIds.size > 0
      ? demoProcess
          .filter((s): s is typeof s & { element: string } => Boolean(s.element))
          .map((s) => library.find((e) => e.id === s.element))
          .filter((e): e is NonNullable<typeof e> => Boolean(e))
      : library;

  emit('demo.input.derived', {
    diff_stat: diffStat,
    head_sha: headSha,
    acceptance_criteria: acceptanceCriteria.length,
    work_items: workItems.length,
    demo_process_steps: demoProcess.length,
    composed_elements: elementIds.size,
  });

  const basePrompt = renderDemoAgentUserPrompt({
    initiativeId: input.initiativeId,
    acceptanceCriteria,
    workItems,
    qualityGateCmd,
    diffStat,
    headSha,
    demoDir: demoDirRel,
    demoProcess,
    elements,
  });
  const systemPrompt = buildDemoAgentSystemPrompt();

  let lastErrors: string[] = [];
  for (let attempt = 1; attempt <= MAX_AUTHOR_ATTEMPTS; attempt += 1) {
    const prompt =
      attempt === 1
        ? basePrompt
        : `${basePrompt}\n\n## Previous attempt rejected (fix EXACTLY these, change nothing else)\n\n${lastErrors.map((e) => `- ${e}`).join('\n')}`;

    // Band 3 — the one-shot spawn. Caller lifecycle: this pipeline owns events.
    let spawn;
    try {
      spawn = await runAgent(def, {
        runId: input.initiativeId,
        workdir: input.worktreePath,
        cwd: input.worktreePath,
        prompt,
        systemPrompt,
        lifecycle: 'caller',
        streamGuard: { label: DEMO_AGENT_SLUG, signal: opts.signal },
        bindings: {
          initiative: { id: input.initiativeId, costBudgetUsd: input.costBudgetUsd },
        },
        queryFn: opts.queryFn,
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      emit('demo.spawn.failed', { detail, attempt }, { event_type: 'error' });
      return { status: 'failed', reason: 'spawn-failed', detail };
    }
    emit('demo.agent-pass', { attempt, result_subtype: spawn.resultSubtype }, { cost_usd: spawn.costUsd });

    // Band 4 — validate the authored demo.json against contract + injected state.
    const validation = validateAuthoredDemo(demoJsonAbs, demoDirRel, diffStat);
    if (!validation.ok) {
      lastErrors = validation.errors;
      emit('demo.author.invalid', { attempt, errors: validation.errors });
      continue;
    }
    const model = validation.model;

    // Band 5 — render (orchestrator-owned; live evidence back-fill included).
    const render = renderDemoBundle(demoDirAbs, input.worktreePath);
    if (!render.ok) {
      lastErrors = render.errors;
      emit('demo.author.invalid', { attempt, errors: render.errors, band: 'render' });
      continue;
    }

    // Band 6 — orchestrated capture (ADR-036). Environment failures are hard —
    // they must never surface as another authoring retry or a silent pass.
    if (demoJsonWantsCapture(demoJsonAbs)) {
      const preflight = preflightDemoCaptureCommands(demoJsonAbs, input.worktreePath);
      if (!preflight.ok) {
        emit('demo.capture.tooling-unavailable', { problems: preflight.problems, failure_kind: 'environment' }, { event_type: 'error' });
        return {
          status: 'failed',
          reason: 'tooling-unavailable',
          detail: `demo capture command(s) not producible: ${preflight.problems.join('; ')}`,
        };
      }
      const nonce = generateCaptureNonce();
      const argv = input.orchestratedCapture?.argv ?? buildDemoCaptureArgv(input.initiativeId);
      const timeoutMs = input.orchestratedCapture?.timeoutMs ?? resolveDemoCaptureTimeoutMs();
      const cap = runOrchestratorCommand(argv, {
        cwd: input.worktreePath,
        timeoutMs,
        env: { ...process.env, [CAPTURE_NONCE_ENV]: nonce },
      });
      if (!cap.ok) {
        emit(
          'demo.capture',
          {
            capture_ok: false,
            exit_code: cap.exitCode,
            timed_out: cap.timedOut,
            failure_kind: cap.timedOut || cap.errored ? 'environment' : 'command',
            stderr_tail: cap.stderrTail.slice(-500),
          },
          { event_type: 'error' },
        );
        return { status: 'failed', reason: 'capture-failed', detail: `orchestrated capture failed (exit ${cap.exitCode}): ${cap.stderrTail.slice(-500)}` };
      }
      const stamped = readStampedNonce(demoJsonAbs);
      if (stamped !== nonce) {
        emit('demo.capture', { capture_ok: true, nonce_match: false, capture_nonce: nonce, stamped_nonce: stamped ?? null }, { event_type: 'error' });
        return {
          status: 'failed',
          reason: 'nonce-mismatch',
          detail: 'demo.json capture.nonce does not match this orchestrated run — the evidence was not produced by this capture (stale, replayed, or hand-written)',
        };
      }
      const committed = commitOrchestratedCaptureArtifacts(input.worktreePath, demoDirRel, input.initiativeId);
      emit('demo.capture', { capture_ok: true, nonce_match: true, capture_nonce: nonce, exit_code: 0, committed, duration_ms: cap.durationMs });
    }

    // Band 7 — F2 judgment: misses require scoped fix proposals.
    const finalModel = readFinalModel(demoJsonAbs) ?? model;
    const misses = (finalModel.acEvaluations ?? []).filter((e) => e.verdict !== 'met');
    if (misses.length === 0) {
      emit('demo.complete', { ac_evaluations: finalModel.acEvaluations?.length ?? 0 });
      return { status: 'complete', demoJsonPath: join(demoDirRel, DEMO_JSON_BASENAME) };
    }
    const judgment = harvestFixProposals(proposalsAbs, misses, input, join(demoDirRel, DEMO_JSON_BASENAME));
    if (!judgment.ok) {
      lastErrors = judgment.errors;
      emit('demo.author.invalid', { attempt, errors: judgment.errors, band: 'judgment' });
      continue;
    }
    for (const m of misses) emit('demo.ac-miss', { criterion: m.criterion, verdict: m.verdict });
    emit('demo.fix-spec.authored', { proposal_count: judgment.record.proposals.length, path: judgment.fixSpecPath });
    unlinkSync(proposalsAbs); // never left untracked in the worktree (merge-blocker theme)
    return {
      status: 'complete-with-misses',
      demoJsonPath: join(demoDirRel, DEMO_JSON_BASENAME),
      misses,
      fixSpecPath: judgment.fixSpecPath,
    };
  }

  return { status: 'failed', reason: 'author-invalid', detail: lastErrors.join('; ') };
}

function validateAuthoredDemo(
  demoJsonAbs: string,
  demoDirRel: string,
  expectedDiffStat: string,
): { ok: true; model: DemoModel } | { ok: false; errors: string[] } {
  if (!existsSync(demoJsonAbs)) {
    return { ok: false, errors: [`demo.json not found — author it at ${demoDirRel}/${DEMO_JSON_BASENAME}`] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(demoJsonAbs, 'utf8'));
  } catch (err) {
    return { ok: false, errors: [`demo.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`] };
  }
  const { model: coerced, changed } = coerceDemoModel(raw);
  const errors = validateDemoModel(coerced);
  if (errors.length > 0) return { ok: false, errors };
  const model = coerced as DemoModel;
  if (stripScratchFromDiffStat(model.diffStat) !== stripScratchFromDiffStat(expectedDiffStat)) {
    return {
      ok: false,
      errors: [
        `demo.json diffStat does not match the injected branch state — use the injected value verbatim. authored: "${model.diffStat}" expected: "${expectedDiffStat}"`,
      ],
    };
  }
  if (changed) writeFileSync(demoJsonAbs, JSON.stringify(coerced, null, 2) + '\n');
  return { ok: true, model };
}

function readStampedNonce(demoJsonAbs: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(demoJsonAbs, 'utf8')) as { capture?: { nonce?: unknown } };
    return typeof parsed.capture?.nonce === 'string' ? parsed.capture.nonce : null;
  } catch {
    return null;
  }
}

function readFinalModel(demoJsonAbs: string): DemoModel | null {
  try {
    const { model } = coerceDemoModel(JSON.parse(readFileSync(demoJsonAbs, 'utf8')));
    return validateDemoModel(model).length === 0 ? (model as DemoModel) : null;
  } catch {
    return null;
  }
}

function harvestFixProposals(
  proposalsAbs: string,
  misses: AcEvaluation[],
  input: DemoAgentPipelineInput,
  demoJsonRelPath: string,
):
  | { ok: true; record: DemoFixSpecRecord; fixSpecPath: string }
  | { ok: false; errors: string[] } {
  if (!existsSync(proposalsAbs)) {
    return {
      ok: false,
      errors: [
        `acEvaluations carry ${misses.length} non-met verdict(s) but ${FIX_PROPOSALS_FILENAME} was not authored — every partial/missed criterion needs a scoped fix proposal (never soften a verdict to avoid this)`,
      ],
    };
  }
  let proposals: unknown;
  try {
    proposals = JSON.parse(readFileSync(proposalsAbs, 'utf8'));
  } catch (err) {
    return { ok: false, errors: [`${FIX_PROPOSALS_FILENAME} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`] };
  }
  if (!Array.isArray(proposals)) {
    return { ok: false, errors: [`${FIX_PROPOSALS_FILENAME} must be a JSON array of proposals`] };
  }
  const record: DemoFixSpecRecord = {
    initiative_id: input.initiativeId,
    cycleId: input.cycleId,
    demoJsonPath: demoJsonRelPath,
    authoredAt: new Date().toISOString(),
    proposals: proposals as DemoFixProposal[],
  };
  const errors = validateDemoFixSpec(record);
  const missCriteria = new Set(misses.map((m) => m.criterion));
  for (const [i, p] of (proposals as DemoFixProposal[]).entries()) {
    if (p && typeof p === 'object' && typeof p.criterion === 'string' && !missCriteria.has(p.criterion)) {
      errors.push(`proposals[${i}].criterion does not match any non-met acEvaluations entry (verbatim match required): "${p.criterion}"`);
    }
  }
  const proposedCriteria = new Set((proposals as DemoFixProposal[]).map((p) => p?.criterion).filter((c): c is string => typeof c === 'string'));
  for (const m of misses) {
    if (!proposedCriteria.has(m.criterion)) {
      errors.push(`non-met criterion has no fix proposal: "${m.criterion}"`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  const fixSpecPath = writeDemoFixSpecJson(input.logsRoot, record);
  if (!fixSpecPath) return { ok: false, errors: ['failed to persist demo-fix-spec.json (IO error)'] };
  return { ok: true, record, fixSpecPath };
}
