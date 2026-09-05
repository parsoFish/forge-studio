/**
 * Adversarial-review pipeline (R4-08-F1) — the orchestrator bands around the
 * one-shot critique spawn.
 *
 * Band order: assemble (orchestrator-derived diff.patch / diffstat /
 * changed-files into `.forge/review-input/` + head SHA — ADR-036: the agent
 * judges, evidence assembly is orchestrator-owned) → spawn (`runAgent`,
 * `lifecycle: 'caller'`) → harvest (`.forge/review-findings.json`: schema +
 * identity-echo verification, ONE bounded authoring retry) → persist (the
 * `review-findings` artifact under `_logs/<cycleId>/artifacts/`) → scrub
 * (review-input dir + worktree findings copy deleted — nothing untracked is
 * ever left to block a later merge).
 *
 * Mechanical guards mirror the demo-agent pipeline (same review-lesson class):
 * a pre/post `git status` diff hard-fails any write outside the findings file
 * (`review.scope-violation`); budget-killed spawns (`error_max_*`) fail loud,
 * never retried; declared budget caps + the no-Edit tool posture are asserted
 * fail-loud at startup.
 *
 * The findings are agent CLAIMS weighed by the operator at the verdict gate —
 * never a gate by themselves (ADR-021: approve IS the merge). Not wired into
 * any seed flow; R4-10 assembles. Input mirrors the flow-node executor shape.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { profileFor, type ChangeClass } from '../class-profiles.ts';
import { writeRootFenceOptions } from '@forge/sessions/session-write-fence.ts';
import { projectBrainDir } from '@forge/knowledge/brain-paths.ts';
import {
  validateReviewFindings,
  writeReviewFindingsJson,
  type ReviewFinding,
  type ReviewFindingsExpectation,
  type ReviewFindingsRecord,
} from '@forge/flows/flow-artifacts.ts';
import type { EventLogger } from '@forge/kernel';
import type { StreamQueryFn } from '@forge/agents/pinned-sdk-query.ts';
import { runAgent } from '@forge/agents/run-agent.ts';
import { skillPath } from '@forge/agents/skill-path.ts';
import { loadAgentDefinition } from '@forge/agents/studio/agent-registry.ts';
import { FORGE_ROOT } from '@forge/agents/studio/derive.ts';
import { readWorkItemsFromDir } from '@forge/flows/work-item.ts';
import {
  buildAdversarialReviewSystemPrompt,
  renderAdversarialReviewUserPrompt,
  REVIEW_FINDINGS_FILENAME,
  REVIEW_INPUT_REL_DIR,
} from './adversarial-review-binding.ts';
import { takeScopeSnapshot, scopeViolations } from '@forge/agents/phases/agent-scope-guard.ts';

const AGENT_SLUG = 'adversarial-review';
const BASE_REF = 'main';
const MAX_AUTHOR_ATTEMPTS = 2;

export type AdversarialReviewInput = {
  initiativeId: string;
  worktreePath: string;
  cycleId: string;
  logsRoot: string;
  /**
   * The initiative's change class (ADR 051). It selects the review lenses from
   * the class → gate-profile table — the whole reason this pipeline is ONE agent
   * rather than a fixed four-lens critique (spec §5 item 5).
   */
  changeClass: ChangeClass;
  /** Initiative cost budget — resolves declared share caps. */
  costBudgetUsd?: number;
  /** Managed-project name for the Brain-3 advisory context (skipped when absent). */
  projectName?: string;
  /** Root carrying `brain/projects/` — defaults to the forge repo root. */
  forgeRoot?: string;
};

export type AdversarialReviewResult =
  | { status: 'complete'; findingsPath: string; counts: Record<string, number> }
  | {
      status: 'failed';
      reason:
        | 'derive-failed'
        | 'author-invalid'
        | 'scope-violation'
        | 'budget-exhausted'
        | 'spawn-suppressed'
        | 'spawn-failed';
      detail: string;
    };

/** ADR-039 declared-data fail-loud guard (exported so tests pin the throws). */
/**
 * The reviewer's entire tool set. Read-only by construction: it can look at the
 * tree and write its one findings file, and there is nothing here through which
 * a command, a cell, a subagent or the network can be reached.
 */
export const REVIEW_ALLOWED_TOOLS: readonly string[] = ['Read', 'Grep', 'Glob'];

/**
 * `Write` is FENCE-GATED, not granted and not forbidden: it must appear on
 * neither list. On `allowed-tools` the SDK pre-approves it and never consults
 * the write fence; on `disallowed-tools` the reviewer cannot author its own
 * findings file at all. Its one legal destination is decided per call by
 * `writeRootFenceOptions` (T1 ruling 249).
 */
export const REVIEW_FENCED_TOOL = 'Write';

/** Every way to execute something, each of which must be refused BY NAME. */
export const REVIEW_EXECUTION_TOOLS: readonly string[] = [
  'Bash',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Task',
  'Agent',
  'WebFetch',
  'WebSearch',
];

export function assertAdversarialReviewDeclaration(def: {
  budgets: { maxTurns?: number; maxBudgetUsd?: number; maxBudgetUsdShare?: number };
  allowedTools: string[];
  disallowedTools: string[];
}): void {
  if (def.budgets.maxTurns === undefined) {
    throw new Error('adversarial-review SKILL.md must declare budgets.maxTurns — the live turn cap is frontmatter data (ADR-039)');
  }
  if (def.budgets.maxBudgetUsd === undefined && def.budgets.maxBudgetUsdShare === undefined) {
    throw new Error(
      'adversarial-review SKILL.md must declare a budget cap (budgets.maxBudgetUsd and/or maxBudgetUsdShare) — an uncapped unattended agent re-opens the F-42/F-43 silent-spend vector',
    );
  }
  if (def.allowedTools.includes(REVIEW_FENCED_TOOL) || def.disallowedTools.includes(REVIEW_FENCED_TOOL)) {
    throw new Error(
      `adversarial-review SKILL.md must leave ${REVIEW_FENCED_TOOL} off BOTH lists — pre-approving it skips the write fence entirely, and forbidding it leaves the reviewer unable to author its findings; the fence decides per call (T1 ruling 249)`,
    );
  }

  // ALLOWLIST, not a denylist of three names (spec §5 item 5, containment review
  // 2026-09-05). The previous guard refused `Edit`, `MultiEdit` and `Bash` — and
  // would have passed `Task` or `Agent`, either of which reaches execution by
  // DELEGATION to a subagent that has Bash, and `NotebookEdit`, which executes
  // cells. A denylist over an open tool vocabulary is decorative: every tool the
  // SDK gains is granted by default until someone remembers to name it. This
  // closes the class instead of chasing it — anything not on the read-only set
  // is refused, including a tool that does not exist yet.
  const extra = def.allowedTools.filter((t) => !REVIEW_ALLOWED_TOOLS.includes(t));
  if (extra.length > 0) {
    throw new Error(
      `adversarial-review SKILL.md grants ${extra.join(', ')} — the reviewer judges and never runs or edits, so its tools are exactly ${REVIEW_ALLOWED_TOOLS.join(', ')} (ADR 036). Execution reached by delegation (Task/Agent) or by a cell (NotebookEdit) is still execution.`,
    );
  }
  for (const t of REVIEW_EXECUTION_TOOLS) {
    if (!def.disallowedTools.includes(t)) {
      throw new Error(
        `adversarial-review SKILL.md must DISALLOW ${t} explicitly — an empty allow-list is not a fence when the runtime's default tool set is not empty (ADR 036)`,
      );
    }
  }
}

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

export async function runAdversarialReview(
  input: AdversarialReviewInput,
  logger: EventLogger,
  opts: { queryFn?: StreamQueryFn; signal?: AbortSignal } = {},
): Promise<AdversarialReviewResult> {
  const emit = (
    message: string,
    metadata: Record<string, unknown> = {},
    extra: { event_type?: 'log' | 'error'; cost_usd?: number } = {},
  ): void => {
    logger.emit({
      initiative_id: input.initiativeId,
      phase: 'orchestrator',
      skill: AGENT_SLUG,
      event_type: extra.event_type ?? 'log',
      input_refs: [],
      output_refs: [],
      ...(extra.cost_usd !== undefined ? { cost_usd: extra.cost_usd } : {}),
      message,
      metadata: { agent_slug: AGENT_SLUG, ...metadata },
    });
  };

  // Caller-lifecycle spawns bypass runAgent's env guard — the pipeline owns
  // suppression; an injected queryFn (tests) is not a real spawn.
  if (!opts.queryFn && (process.env.FORGE_DRY_BRIDGE === '1' || process.env.FORGE_ARCHITECT_NO_SPAWN === '1')) {
    emit('review.spawn-suppressed', {
      reason: process.env.FORGE_DRY_BRIDGE === '1' ? 'FORGE_DRY_BRIDGE' : 'FORGE_ARCHITECT_NO_SPAWN',
    });
    return { status: 'failed', reason: 'spawn-suppressed', detail: 'spawn suppressed by harness env — no review authored (never faked)' };
  }

  const def = loadAgentDefinition(skillPath(AGENT_SLUG));
  assertAdversarialReviewDeclaration(def);

  // Band 1 — assemble the review inputs (orchestrator-owned; full stdout).
  const diff = gitCapture(input.worktreePath, ['diff', `${BASE_REF}...HEAD`]);
  const diffStat = gitCapture(input.worktreePath, ['diff', '--stat', `${BASE_REF}...HEAD`]);
  const changedFilesRes = gitCapture(input.worktreePath, ['diff', '--name-only', `${BASE_REF}...HEAD`]);
  const headShaRes = gitCapture(input.worktreePath, ['rev-parse', 'HEAD']);
  if (!diff.ok || !diffStat.ok || !changedFilesRes.ok || !headShaRes.ok) {
    const detail = `git derivation error: ${[diff, diffStat, changedFilesRes, headShaRes].filter((r) => !r.ok).map((r) => r.err).join(' ')}`.trim();
    // Event name deliberately avoids the 'review'+'failed' substring pair —
    // failure-classifier.ts's reviewer signature would misclassify it as a
    // terminal reviewer-convergence failure (adversarial review finding #12).
    emit('review.input.derive-error', { detail }, { event_type: 'error' });
    return { status: 'failed', reason: 'derive-failed', detail };
  }
  const headSha = headShaRes.out.trim();
  const changedFiles = changedFilesRes.out.trim().split('\n').filter(Boolean);
  const inputDirAbs = join(input.worktreePath, REVIEW_INPUT_REL_DIR);
  mkdirSync(inputDirAbs, { recursive: true });
  writeFileSync(join(inputDirAbs, 'diff.patch'), diff.out);
  writeFileSync(join(inputDirAbs, 'diffstat.txt'), diffStat.out);
  writeFileSync(join(inputDirAbs, 'changed-files.txt'), changedFiles.join('\n') + '\n');
  emit('review.input.assembled', { changed_files: changedFiles.length, head_sha: headSha, base_ref: BASE_REF });

  const findingsAbs = join(input.worktreePath, '.forge', REVIEW_FINDINGS_FILENAME);
  const findingsRel = `.forge/${REVIEW_FINDINGS_FILENAME}`;
  const scrub = (): void => {
    try {
      if (existsSync(findingsAbs)) unlinkSync(findingsAbs);
      rmSync(inputDirAbs, { recursive: true, force: true });
    } catch {
      /* best-effort — the boundary sweep would catch leftovers */
    }
  };

  // Everything from here is scrub-covered — a throw anywhere below must never
  // strand .forge/review-input/ or a findings copy untracked in the worktree.
  let lastErrors: string[] = [];
  try {
    // ── The write fence (T1 ruling 249) ─────────────────────────────────────
    //
    // A tool-name allowlist is not a fence. `Write` used to be pre-approved on
    // this agent, which meant the ONE agent that judges an initiative could
    // write anywhere in the worktree it was judging — including the source it
    // was reviewing. The scope guard below CATCHES that after the fact; this
    // stops it happening, using the same three-setting shape
    // `packages/sessions/session-write-fence.ts` paid for with a live escape:
    // `permissionMode: 'default'`, `Write` NOT pre-approved (so the SDK routes
    // the call through the handler) and never on `disallowedTools` (so it stays
    // callable), and `canUseTool` deciding per call against one root.
    //
    // The root is the run's own `.forge/` directory — the reviewer's single
    // legal output lives there and nothing else it could write is wanted.
    const fenceRoot = join(input.worktreePath, '.forge');
    mkdirSync(fenceRoot, { recursive: true });
    const writeFence = writeRootFenceOptions({
      writeRoots: [realpathSync(fenceRoot)],
      allowedTools: def.allowedTools,
      cwd: input.worktreePath,
    });

    // The class's lenses (spec §5 item 5). Read ONCE, here, and threaded to both
    // the prompt (what to critique under) and the validator (what a finding may
    // claim) — one source, so a record cannot be judged against a set the agent
    // was never shown.
    const lenses = profileFor(input.changeClass).reviewLenses;

    // Band 2 — briefing inputs from the develop output.
    const wiDir = join(input.worktreePath, '.forge', 'work-items');
    const workItems: Array<{ id: string; title: string; status: string }> = [];
    const acceptanceCriteria: string[] = [];
    if (existsSync(wiDir)) {
      const { items, parseErrors } = readWorkItemsFromDir(wiDir);
      if (Object.keys(parseErrors).length > 0) {
        emit('review.input.wi-parse-errors', { errors: parseErrors }, { event_type: 'error' });
      }
      for (const wi of items) {
        workItems.push({ id: wi.work_item_id, title: wi.body.split('\n')[0] ?? wi.work_item_id, status: wi.status });
        for (const ac of wi.acceptance_criteria) {
          acceptanceCriteria.push(`(${wi.work_item_id}) GIVEN ${ac.given.trim()} WHEN ${ac.when.trim()} THEN ${ac.then.trim()}`);
        }
      }
    }
    const brainContext: Array<{ path: string; content: string }> = [];
    if (input.projectName) {
      const profileAbs = join(projectBrainDir(input.forgeRoot ?? FORGE_ROOT, input.projectName), 'profile.md');
      if (existsSync(profileAbs)) {
        try {
          brainContext.push({ path: `brain/projects/${input.projectName}/profile.md`, content: readFileSync(profileAbs, 'utf8') });
        } catch {
          /* advisory only — skip unreadable */
        }
      }
    }

    const basePrompt = renderAdversarialReviewUserPrompt({
      initiativeId: input.initiativeId,
      cycleId: input.cycleId,
      baseRef: BASE_REF,
      headSha,
      acceptanceCriteria,
      workItems,
      changedFiles,
      lenses,
      brainContext,
    });
    const systemPrompt = buildAdversarialReviewSystemPrompt();

    // Guard integrity fails LOUD in both directions (finding #1): a failed
    // pre-snapshot must not blame the agent for orchestrator files, and a
    // failed post-snapshot must not silently bypass the guard.
    const preSnap = takeScopeSnapshot(input.worktreePath);
    if (!preSnap.ok) {
      emit('review.scope-guard-degraded', { when: 'pre-spawn', error: preSnap.error }, { event_type: 'error' });
      return { status: 'failed', reason: 'derive-failed', detail: `scope-guard pre-snapshot unavailable: ${preSnap.error}` };
    }

    for (let attempt = 1; attempt <= MAX_AUTHOR_ATTEMPTS; attempt += 1) {
      if (existsSync(findingsAbs)) unlinkSync(findingsAbs); // fresh attempt = fresh judgment
      const prompt =
        attempt === 1
          ? basePrompt
          : `${basePrompt}\n\n## Previous attempt rejected (fix EXACTLY these, change nothing else)\n\n${lastErrors.map((e) => `- ${e}`).join('\n')}`;

      // Band 3 — the one-shot spawn (caller lifecycle: this pipeline owns events).
      let spawn;
      try {
        spawn = await runAgent(def, {
          runId: input.initiativeId,
          workdir: input.worktreePath,
          cwd: input.worktreePath,
          prompt,
          systemPrompt,
          lifecycle: 'caller',
          streamGuard: { label: AGENT_SLUG, signal: opts.signal },
          bindings: { initiative: { id: input.initiativeId, costBudgetUsd: input.costBudgetUsd } },
          queryFn: opts.queryFn,
          ...writeFence,
        });
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        // 'spawn-error' (not '…failed') — the failure-classifier's reviewer
        // signature matches 'review'+'failed' substrings (finding #12).
        emit('review.spawn-error', { detail, attempt }, { event_type: 'error' });
        return { status: 'failed', reason: 'spawn-failed', detail };
      }
      emit('review.agent-pass', { attempt, result_subtype: spawn.resultSubtype }, { cost_usd: spawn.costUsd });

      // Only budget/turn kills are exhaustion; other error_* subtypes (e.g.
      // error_during_execution) are spawn failures — telling the operator to
      // raise budgets for those is a misdiagnosis (finding #3).
      if (spawn.resultSubtype && spawn.resultSubtype.startsWith('error_max_')) {
        emit('review.budget-exhausted', { result_subtype: spawn.resultSubtype, attempt }, { event_type: 'error' });
        return {
          status: 'failed',
          reason: 'budget-exhausted',
          detail: `adversarial-review spawn terminated by the SDK (${spawn.resultSubtype}) — raise the declared budgets or shrink the diff before re-running`,
        };
      }
      if (spawn.resultSubtype && spawn.resultSubtype.startsWith('error_')) {
        emit('review.spawn-error', { result_subtype: spawn.resultSubtype, attempt }, { event_type: 'error' });
        return {
          status: 'failed',
          reason: 'spawn-failed',
          detail: `adversarial-review spawn ended with SDK subtype ${spawn.resultSubtype} (execution failure, not a budget kill)`,
        };
      }

      // Mechanical scope guard: the reviewer's only legal write is the
      // findings file (review-input was pipeline-written pre-snapshot; the
      // snapshot layers cover untracked-dir collapse + gitignored .forge —
      // agent-scope-guard.ts).
      const postSnap = takeScopeSnapshot(input.worktreePath);
      if (!postSnap.ok) {
        emit('review.scope-guard-degraded', { when: 'post-spawn', error: postSnap.error }, { event_type: 'error' });
        return { status: 'failed', reason: 'derive-failed', detail: `scope-guard post-snapshot unavailable: ${postSnap.error}` };
      }
      const newDirt = scopeViolations(preSnap, postSnap, (p) => p === findingsRel);
      if (newDirt.length > 0) {
        emit('review.scope-violation', { paths: newDirt }, { event_type: 'error' });
        return {
          status: 'failed',
          reason: 'scope-violation',
          detail: `adversarial-review wrote outside ${findingsRel}: ${newDirt.join(', ')} — the reviewer judges, it never edits`,
        };
      }

      // Band 4 — harvest + validate (+ identity-echo verification).
      const harvest = harvestFindings(
        findingsAbs,
        findingsRel,
        { initiative_id: input.initiativeId, cycleId: input.cycleId, baseRef: BASE_REF, headSha },
        { lenses, criteria: acceptanceCriteria },
      );
      if (!harvest.ok) {
        lastErrors = harvest.errors;
        emit('review.author.invalid', { attempt, errors: harvest.errors });
        continue;
      }

      // Band 5 — persist + scrub.
      const persisted = writeReviewFindingsJson(input.logsRoot, harvest.record);
      if (!persisted) {
        return { status: 'failed', reason: 'author-invalid', detail: 'failed to persist review-findings.json (IO error)' };
      }
      const counts: Record<string, number> = { total: harvest.record.findings.length, blocker: 0, major: 0, minor: 0, info: 0 };
      for (const f of harvest.record.findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
      emit('review.findings.authored', { ...counts, path: persisted, head_sha: headSha });
      return { status: 'complete', findingsPath: persisted, counts };
    }
    return { status: 'failed', reason: 'author-invalid', detail: lastErrors.join('; ') };
  } finally {
    scrub();
  }
}

function harvestFindings(
  findingsAbs: string,
  findingsRel: string,
  identity: { initiative_id: string; cycleId: string; baseRef: string; headSha: string },
  expected: ReviewFindingsExpectation,
): { ok: true; record: ReviewFindingsRecord } | { ok: false; errors: string[] } {
  if (!existsSync(findingsAbs)) {
    return {
      ok: false,
      errors: [
        `${findingsRel} was not authored — an all-clean review still writes it with findings: [] and an honest summary; a missing file is never a clean pass`,
      ],
    };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(findingsAbs, 'utf8'));
  } catch (err) {
    return { ok: false, errors: [`${findingsRel} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`] };
  }
  const errors = validateReviewFindings(raw, expected);
  if (errors.length > 0) return { ok: false, errors };
  const record = raw as ReviewFindingsRecord;
  // Identity-echo verification — a record claiming a different run identity is
  // a stale/replayed artifact, exactly what headSha exists to guard against.
  for (const key of ['initiative_id', 'cycleId', 'baseRef', 'headSha'] as const) {
    if (record[key] !== identity[key]) {
      errors.push(`${key} mismatch — authored "${record[key]}", this run is "${identity[key]}" (echo the injected identity verbatim)`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  const findings: ReviewFinding[] = record.findings;
  return { ok: true, record: { ...record, findings } };
}
