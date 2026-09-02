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

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  coerceDemoModel,
  renderDemoBundle,
  stripScratchFromDiffStat,
  validateDemoModel,
  type AcEvaluation,
  type DemoModel,
} from '../demo-model.ts';
import {
  validateDemoFixSpec,
  writeDemoFixSpecJson,
  type DemoFixProposal,
  type DemoFixSpecRecord,
} from '@forge/flows/flow-artifacts.ts';
import { worktreeDemoDir, worktreeDemoRelDir, DEMO_JSON_BASENAME } from '@forge/flows/demo-paths.ts';
import type { EventLogger } from '@forge/kernel';
import type { StreamQueryFn } from '@forge/agents/pinned-sdk-query.ts';
import { loadProjectConfig } from '@forge/projects/project-config.ts';
import { runAgent } from '@forge/agents/run-agent.ts';
import { skillPath } from '@forge/agents/skill-path.ts';
import { loadAgentDefinition } from '../../../orchestrator/studio/registry.ts';
import { listDemoElements } from '@forge/library/studio/artifact-registry.ts';
import { FORGE_ROOT } from '@forge/agents/studio/derive.ts';
import { readWorkItemsFromDir } from '@forge/flows/work-item.ts';
import {
  buildDemoAgentSystemPrompt,
  renderDemoAgentUserPrompt,
  FIX_PROPOSALS_FILENAME,
  PR_DESCRIPTION_REL,
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
} from '@forge/flows/phases/orchestrated-capture.ts';
import { takeScopeSnapshot, scopeViolations } from '@forge/agents/phases/agent-scope-guard.ts';

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
        | 'scope-violation'
        | 'budget-exhausted'
        | 'spawn-suppressed'
        | 'spawn-failed';
      detail: string;
    };

/**
 * ADR-039 declared-data fail-loud guard (exported so tests pin the throws —
 * a declared cap that fails open re-opens the F-42/F-43 silent-spend vector,
 * and a demo-agent def without the `demo` contract skill would spawn against
 * a system prompt whose composition it no longer declares).
 */
export function assertDemoAgentDeclaration(def: {
  budgets: { maxTurns?: number; maxBudgetUsd?: number; maxBudgetUsdShare?: number };
  composition: { skills: string[] };
  allowedTools?: string[];
}): void {
  if (def.budgets.maxTurns === undefined) {
    throw new Error('demo-agent SKILL.md must declare budgets.maxTurns — the live turn cap is frontmatter data (ADR-039)');
  }
  if (def.budgets.maxBudgetUsd === undefined && def.budgets.maxBudgetUsdShare === undefined) {
    throw new Error(
      'demo-agent SKILL.md must declare a budget cap (budgets.maxBudgetUsd and/or maxBudgetUsdShare) — an uncapped unattended agent re-opens the F-42/F-43 silent-spend vector',
    );
  }
  if (!def.composition.skills.includes('demo')) {
    throw new Error(
      'demo-agent SKILL.md must declare composition.skills: [demo] — the binding inlines the demo contract the composition claims',
    );
  }
  if (def.allowedTools?.includes('Bash')) {
    throw new Error(
      'demo-agent SKILL.md must not grant Bash — arbitrary execution defeats the mechanical scope guard and the ADR-036 authors-never-runs posture',
    );
  }
}

/** Full-stdout git capture — runOrchestratorCommand's 4096-char tail would
 * truncate a roadmap-scale `--stat`; the derive band needs exact values.
 * `out` is RAW (porcelain's first line starts with a significant space —
 * trimming here once ate a status column); callers trim where safe. */
function gitCapture(worktreePath: string, args: string[]): { ok: boolean; out: string; err: string } {
  try {
    const out = execFileSync('git', args, { cwd: worktreePath, stdio: 'pipe', encoding: 'utf8', timeout: 60_000 });
    return { ok: true, out, err: '' };
  } catch (e) {
    const err = e as { stderr?: Buffer | string; message?: string };
    const stderr = err.stderr ? (typeof err.stderr === 'string' ? err.stderr : err.stderr.toString('utf8')) : (err.message ?? '');
    return { ok: false, out: '', err: stderr.slice(-500) };
  }
}


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
  assertDemoAgentDeclaration(def);

  // Band 1 — derive branch state (full stdout, never the 4096-char tail).
  // `--shortstat` is the summary line the demo contract's diffStat carries —
  // injected into the prompt; the authored demo.json must echo it verbatim
  // (stale-after-fanin theme: never trust inherited).
  const diffStatRes = gitCapture(input.worktreePath, ['diff', '--shortstat', 'main...HEAD']);
  const headShaRes = gitCapture(input.worktreePath, ['rev-parse', 'HEAD']);
  if (!diffStatRes.ok || !headShaRes.ok) {
    const detail = `git derivation failed: ${diffStatRes.ok ? '' : diffStatRes.err} ${headShaRes.ok ? '' : headShaRes.err}`.trim();
    emit('demo.input.derive-error', { detail }, { event_type: 'error' });
    return { status: 'failed', reason: 'derive-failed', detail };
  }
  const diffStat = diffStatRes.out.trim();
  const headSha = headShaRes.out.trim();
  // The branch's changed-file list — anchors the PR-body What/How so the agent
  // (which has no Bash) names only files the diff actually contains. Best-effort:
  // a failure just yields an empty list (the PR body degrades to intent-only).
  const changedFilesRes = gitCapture(input.worktreePath, ['diff', '--name-only', 'main...HEAD']);
  const changedFiles = changedFilesRes.ok ? changedFilesRes.out.trim().split('\n').filter(Boolean) : [];

  const demoDirRel = worktreeDemoRelDir(input.worktreePath, input.initiativeId);
  const demoDirAbs = worktreeDemoDir(input.worktreePath, input.initiativeId);
  const demoJsonAbs = join(demoDirAbs, DEMO_JSON_BASENAME);
  const proposalsAbs = join(demoDirAbs, FIX_PROPOSALS_FILENAME);
  const prDescriptionAbs = join(input.worktreePath, PR_DESCRIPTION_REL);
  // Pre-spawn scope snapshot (shared agent-scope-guard: porcelain -uall +
  // .forge/ walk — covers untracked-dir collapse and gitignored .forge trees).
  // Guard integrity fails LOUD: no snapshot, no spawn.
  const preSnap = takeScopeSnapshot(input.worktreePath);
  if (!preSnap.ok) {
    emit('demo.scope-guard-degraded', { when: 'pre-spawn', error: preSnap.error }, { event_type: 'error' });
    return { status: 'failed', reason: 'derive-failed', detail: `scope-guard pre-snapshot unavailable: ${preSnap.error}` };
  }

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
    const { items, parseErrors } = readWorkItemsFromDir(wiDir);
    if (Object.keys(parseErrors).length > 0) {
      // A malformed WI's ACs would silently vanish from the judging rubric —
      // surface loudly (the demo still runs on the parseable set).
      emit('demo.input.wi-parse-errors', { errors: parseErrors }, { event_type: 'error' });
    }
    for (const wi of items) {
      workItems.push({ id: wi.work_item_id, title: wi.body.split('\n')[0] ?? wi.work_item_id, status: wi.status });
      for (const ac of wi.acceptance_criteria) {
        acceptanceCriteria.push(`(${wi.work_item_id}) GIVEN ${ac.given.trim()} WHEN ${ac.when.trim()} THEN ${ac.then.trim()}`);
      }
    }
  }
  const library = listDemoElements(input.forgeRoot ?? FORGE_ROOT);
  const elementIds = new Set(demoProcess.map((s) => s.element).filter(Boolean) as string[]);
  const unknownElementIds = [...elementIds].filter((id) => !library.some((e) => e.id === id));
  if (unknownElementIds.length > 0) {
    // A typo'd/retired element id in .forge/project.json must not degrade the
    // briefing silently — the binding renders an explicit unresolved note too.
    emit('demo.input.unknown-element', { ids: unknownElementIds }, { event_type: 'error' });
  }
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
    changedFiles,
    demoDir: demoDirRel,
    demoProcess,
    elements,
  });
  const systemPrompt = buildDemoAgentSystemPrompt();

  // Freshness (R4-10-F1): unlike demo.json (anchored to the injected diffStat),
  // the PR body has no staleness anchor and `.forge/` is gitignored + reused
  // across fix-loop re-entries — a round-N-1 body would otherwise satisfy
  // validatePrDescription and ship stale. Delete it up front so every run
  // (fresh or re-entry) forces the agent to re-author it against THIS branch.
  if (existsSync(prDescriptionAbs)) unlinkSync(prDescriptionAbs);

  let lastErrors: string[] = [];
  for (let attempt = 1; attempt <= MAX_AUTHOR_ATTEMPTS; attempt += 1) {
    // Fresh attempt = fresh judgment: a proposals file authored during a
    // rejected attempt must never survive into this one (a later all-met
    // pass would return 'complete' with a stale untracked judgment file —
    // the untracked-merge-blocker theme).
    if (existsSync(proposalsAbs)) unlinkSync(proposalsAbs);
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
      emit('demo.spawn-error', { detail, attempt }, { event_type: 'error' });
      return { status: 'failed', reason: 'spawn-failed', detail };
    }
    emit('demo.agent-pass', { attempt, result_subtype: spawn.resultSubtype }, { cost_usd: spawn.costUsd });

    // A budget/turn-killed spawn is an exhaustion failure, not an authoring
    // bug — retrying it spends up to the full cap again for the same outcome.
    // Only error_max_* is exhaustion; other error_* subtypes (e.g.
    // error_during_execution) are spawn failures — 'raise the budgets' would
    // be a misdiagnosis for those.
    if (spawn.resultSubtype && spawn.resultSubtype.startsWith('error_max_')) {
      emit('demo.budget-exhausted', { result_subtype: spawn.resultSubtype, attempt }, { event_type: 'error' });
      return {
        status: 'failed',
        reason: 'budget-exhausted',
        detail: `demo-agent spawn terminated by the SDK (${spawn.resultSubtype}) — raise the declared budgets or shrink the briefing before re-running`,
      };
    }
    if (spawn.resultSubtype && spawn.resultSubtype.startsWith('error_')) {
      emit('demo.spawn-error', { result_subtype: spawn.resultSubtype, attempt }, { event_type: 'error' });
      return {
        status: 'failed',
        reason: 'spawn-failed',
        detail: `demo-agent spawn ended with SDK subtype ${spawn.resultSubtype} (execution failure, not a budget kill)`,
      };
    }

    // Mechanical scope guard (ADR-036): NEW dirt outside the demo dir means
    // the agent edited project code — the F2 AC forbids exactly this, and the
    // orchestrated capture would produce evidence from code not on the branch.
    // Hard failure, never a retry (an agent that edits code is not negotiated
    // with). Shared agent-scope-guard covers untracked-dir collapse +
    // gitignored .forge trees; guard integrity fails loud.
    const postSnap = takeScopeSnapshot(input.worktreePath);
    if (!postSnap.ok) {
      emit('demo.scope-guard-degraded', { when: 'post-spawn', error: postSnap.error }, { event_type: 'error' });
      return { status: 'failed', reason: 'derive-failed', detail: `scope-guard post-snapshot unavailable: ${postSnap.error}` };
    }
    // The demo agent's ONLY legal writes: its demo dir, and the relocated PR
    // body (R4-10-F1). Anything else is project-code editing (the F2 AC forbids
    // it) — a hard failure, never a retry.
    const inDemoScope = (raw: string): boolean => {
      const p = raw.replace(/\/$/, '');
      return p === demoDirRel || p.startsWith(demoDirRel + '/') || p === PR_DESCRIPTION_REL;
    };
    const newDirt = scopeViolations(preSnap, postSnap, inDemoScope);
    if (newDirt.length > 0) {
      emit('demo.scope-violation', { paths: newDirt }, { event_type: 'error' });
      return {
        status: 'failed',
        reason: 'scope-violation',
        detail: `demo-agent wrote outside its demo dir (${demoDirRel}) and ${PR_DESCRIPTION_REL}: ${newDirt.join(', ')} — fixes are proposals for the develop agent, never demo-agent edits`,
      };
    }

    // Band 4 — validate the authored demo.json against contract + injected state.
    const validation = validateAuthoredDemo(demoJsonAbs, demoDirRel, diffStat, acceptanceCriteria);
    if (!validation.ok) {
      lastErrors = validation.errors;
      emit('demo.author.invalid', { attempt, errors: validation.errors });
      continue;
    }
    const model = validation.model;

    // R4-10-F1: the relocated PR body is a HARD authoring requirement.
    // openPrInline reads `.forge/pr-description.md` via `--body-file`, so a
    // missing/empty/section-less one means no PR ever opens — treat it exactly
    // like an invalid demo.json (retryable, with the gap named in the retry
    // prompt), never a silent pass.
    const prErrors = validatePrDescription(prDescriptionAbs);
    if (prErrors.length > 0) {
      lastErrors = prErrors;
      emit('demo.author.invalid', { attempt, errors: prErrors, band: 'pr-description' });
      continue;
    }

    // Band 5 — render (orchestrator-owned; live evidence back-fill included).
    const render = renderDemoBundle(demoDirAbs, input.worktreePath);
    if (!render.ok) {
      lastErrors = render.errors;
      emit('demo.author.invalid', { attempt, errors: render.errors, band: 'render' });
      continue;
    }

    // Band 6 — orchestrated capture (ADR-036). Environment failures are hard —
    // they must never surface as another authoring retry or a silent pass.
    let captureRan = false;
    if (demoJsonWantsCapture(demoJsonAbs)) {
      captureRan = true;
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
    } else {
      // Notes-only demos skip capture but their artifacts must still land ON
      // the branch — the unifier used to commit these in its own loop; the
      // demo agent has no Bash, so the pipeline owns the commit either way.
      const committed = commitOrchestratedCaptureArtifacts(
        input.worktreePath,
        demoDirRel,
        input.initiativeId,
        `chore(demo): demo artifacts (${input.initiativeId})`,
      );
      emit('demo.artifacts.committed', { committed });
    }

    // Band 7 — F2 judgment: misses require scoped fix proposals. After a
    // capture, the post-capture demo.json is authoritative — if the capture
    // invalidated it (e.g. oversized command output), that is a capture
    // failure, never a silent fall-back to the stale pre-capture model.
    let finalModel = model;
    if (captureRan) {
      const reread = readFinalModel(demoJsonAbs);
      if (!reread.model) {
        emit('demo.capture', { capture_ok: true, post_capture_valid: false, errors: reread.errors }, { event_type: 'error' });
        return {
          status: 'failed',
          reason: 'capture-failed',
          detail: `post-capture demo.json failed validation: ${reread.errors.join('; ')}`,
        };
      }
      finalModel = reread.model;
    }
    const misses = (finalModel.acEvaluations ?? []).filter((e) => e.verdict !== 'met');
    if (misses.length === 0) {
      if (existsSync(proposalsAbs)) {
        // All-met with a proposals file = a contract inconsistency; discard
        // loudly rather than leaving a stale untracked judgment behind.
        unlinkSync(proposalsAbs);
        emit('demo.stale-proposals-discarded', {});
      }
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

/**
 * Normalize an acceptance-criterion string for MATCHING ONLY (never for storage
 * or display). The pipeline compiles injected criteria with a `(WI-N)` label
 * prefix (the `acceptanceCriteria` build above), but the demo agent systematically
 * authors the criterion text WITHOUT that label — and long, bracket-dense criteria
 * also pick up incidental whitespace differences. A raw exact-string coverage
 * check then rejects a demo whose content is fully correct (verify:cycle
 * gitpulse-coupling, 2026-08-03: 33/33 criteria authored, 0 matched by exact
 * string — every miss was only the dropped `(WI-N)` label). Strip a leading
 * `(WI-…)` label and collapse internal whitespace so matching keys on CONTENT.
 * The agent still cannot fake coverage: it must reproduce each criterion's text.
 */
export function normalizeCriterion(c: string): string {
  return c.replace(/^\(WI-[^)]*\)\s*/i, '').replace(/\s+/g, ' ').trim();
}

/** Lowercased word-token set of a normalized criterion, for tolerant coverage. */
function criterionTokens(c: string): Set<string> {
  return new Set(normalizeCriterion(c).toLowerCase().split(' ').filter(Boolean));
}

/** Jaccard overlap of two token sets (1 when both empty). */
function tokenJaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/**
 * AC-coverage minimum similarity. The coverage check exists to catch an agent
 * that SKIPS a criterion (dodging fix-proposal work), NOT to police verbatim
 * transcription. Requiring byte-exact reproduction is brittle plumbing: the demo
 * agent reliably authors the CONTENT of each criterion but, on a long data-dense
 * criterion (300–700+ chars of embedded expected-output), makes an incidental
 * transcription slip — e.g. one wrong filename deep in the string (verify:cycle
 * gitpulse-coupling run3, 2026-08-03: 20/21 exact, the 1 miss was `beta.ts` where
 * the criterion said `gamma.ts` at char 711 of ~720). A high token-overlap
 * threshold covers a transcription slip while a genuinely-skipped criterion (no
 * corresponding authored entry) still falls below it. Matching is bijective (one
 * authored entry covers at most one injected criterion) so the guarantee holds.
 */
export const AC_COVERAGE_MIN_SIMILARITY = 0.8;

/**
 * Which injected criteria are NOT covered by the authored acEvaluations, under a
 * tolerant + bijective token-similarity match. Empty ⇒ full coverage.
 */
export function uncoveredCriteria(injectedCriteria: string[], authoredCriteria: string[]): string[] {
  const authored = authoredCriteria.map((a) => criterionTokens(a));
  const used = new Array(authored.length).fill(false);
  const uncovered: string[] = [];
  for (const c of injectedCriteria) {
    const ct = criterionTokens(c);
    let bestIdx = -1;
    let bestSim = 0;
    for (let i = 0; i < authored.length; i += 1) {
      if (used[i]) continue;
      const sim = tokenJaccard(ct, authored[i]);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestSim >= AC_COVERAGE_MIN_SIMILARITY) used[bestIdx] = true;
    else uncovered.push(c);
  }
  return uncovered;
}

function validateAuthoredDemo(
  demoJsonAbs: string,
  demoDirRel: string,
  expectedDiffStat: string,
  injectedCriteria: string[],
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
  // AC-coverage enforcement: an agent that omits acEvaluations (or covers only a
  // subset of the injected criteria) would otherwise sail to a vacuous 'complete'
  // — the cheapest way to avoid writing fix proposals. Every injected criterion
  // must be addressed, but matching is TOLERANT (bijective token-similarity, not
  // byte-exact): the gate catches a SKIPPED criterion, it does not police
  // verbatim transcription of a long data-dense criterion (see
  // AC_COVERAGE_MIN_SIMILARITY).
  if (injectedCriteria.length > 0) {
    const uncovered = uncoveredCriteria(injectedCriteria, (model.acEvaluations ?? []).map((e) => e.criterion));
    if (uncovered.length > 0) {
      return {
        ok: false,
        errors: uncovered.map(
          (c) => `acEvaluations has no entry addressing this criterion (author one, judge met|partial|missed): "${c}"`,
        ),
      };
    }
  }
  if (changed) writeFileSync(demoJsonAbs, JSON.stringify(coerced, null, 2) + '\n');
  return { ok: true, model };
}

/**
 * Validate the relocated PR body (R4-10-F1). It must exist, be non-empty, and
 * carry the three Why/What/How sections `openPrInline` + the demo-append expect.
 * Returns human-readable errors (empty ⇒ valid) that feed the authoring retry.
 */
function validatePrDescription(prDescAbs: string): string[] {
  if (!existsSync(prDescAbs)) {
    return [
      `${PR_DESCRIPTION_REL} was not authored — the PR body is required (openPrInline reads it via --body-file, so a missing one means no PR opens). Author "## Why", "## What", and "## How".`,
    ];
  }
  let body: string;
  try {
    body = readFileSync(prDescAbs, 'utf8');
  } catch (err) {
    return [`${PR_DESCRIPTION_REL} is unreadable: ${err instanceof Error ? err.message : String(err)}`];
  }
  if (body.trim().length === 0) {
    return [`${PR_DESCRIPTION_REL} is empty — author the "## Why", "## What", and "## How" sections.`];
  }
  const errors: string[] = [];
  for (const section of ['## Why', '## What', '## How']) {
    if (!body.includes(section)) {
      errors.push(`${PR_DESCRIPTION_REL} is missing the "${section}" section (author all three: Why/What/How).`);
    }
  }
  return errors;
}

function readStampedNonce(demoJsonAbs: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(demoJsonAbs, 'utf8')) as { capture?: { nonce?: unknown } };
    return typeof parsed.capture?.nonce === 'string' ? parsed.capture.nonce : null;
  } catch {
    return null;
  }
}

/** Re-read + validate the post-capture demo.json; errors kept so a capture
 * that invalidated the artifact fails loud instead of falling back silently. */
function readFinalModel(demoJsonAbs: string): { model: DemoModel | null; errors: string[] } {
  try {
    const { model } = coerceDemoModel(JSON.parse(readFileSync(demoJsonAbs, 'utf8')));
    const errors = validateDemoModel(model);
    return errors.length === 0 ? { model: model as DemoModel, errors: [] } : { model: null, errors };
  } catch (err) {
    return { model: null, errors: [err instanceof Error ? err.message : String(err)] };
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
  const missCriteria = new Set(misses.map((m) => normalizeCriterion(m.criterion)));
  for (const [i, p] of (proposals as DemoFixProposal[]).entries()) {
    if (p && typeof p === 'object' && typeof p.criterion === 'string' && !missCriteria.has(normalizeCriterion(p.criterion))) {
      errors.push(`proposals[${i}].criterion does not match any non-met acEvaluations entry (content match required): "${p.criterion}"`);
    }
  }
  const proposedCriteria = new Set(
    (proposals as DemoFixProposal[]).map((p) => p?.criterion).filter((c): c is string => typeof c === 'string').map(normalizeCriterion),
  );
  for (const m of misses) {
    if (!proposedCriteria.has(normalizeCriterion(m.criterion))) {
      errors.push(`non-met criterion has no fix proposal: "${m.criterion}"`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  const fixSpecPath = writeDemoFixSpecJson(input.logsRoot, record);
  if (!fixSpecPath) return { ok: false, errors: ['failed to persist demo-fix-spec.json (IO error)'] };
  return { ok: true, record, fixSpecPath };
}
