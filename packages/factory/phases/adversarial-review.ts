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
import { guardedReadFile, guardedWriteFile } from '@forge/kernel';
import { createHash } from 'node:crypto';
import type { StreamQueryFn } from '@forge/agents/pinned-sdk-query.ts';
import { runAgent } from '@forge/agents/run-agent.ts';
import { skillPath } from '@forge/agents/skill-path.ts';
import { loadAgentDefinition } from '@forge/agents/studio/agent-registry.ts';
import { FORGE_ROOT } from '@forge/agents/studio/derive.ts';
import { readWorkItemsFromDir, type WorkItem } from '@forge/flows/work-item.ts';
import { chunkLabel, mergeChunkRecords, partitionChangedFiles, type ReviewChunk,
  splitChunkPerFile,
  mergeSplitRecords,
} from './review-chunks.ts';
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
  // The DIFF itself is captured per chunk, not here: the whole-initiative patch
  // this used to write was overwritten by the first chunk's before any agent
  // read it (bead forge-8vfn.6.10.24), so writing it was three dead file writes
  // and three extra request-reachable path sinks for a file nobody consumed.
  const changedFilesRes = gitCapture(input.worktreePath, ['diff', '--name-only', `${BASE_REF}...HEAD`]);
  const headShaRes = gitCapture(input.worktreePath, ['rev-parse', 'HEAD']);
  if (!changedFilesRes.ok || !headShaRes.ok) {
    const detail = `git derivation error: ${[changedFilesRes, headShaRes].filter((r) => !r.ok).map((r) => r.err).join(' ')}`.trim();
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

    // Band 2 — briefing inputs from the develop output. The FULL records are
    // kept, not just the display list: the partition below cuts the diff by the
    // paths each work item declared (bead forge-8vfn.6.10.24).
    const wiDir = join(input.worktreePath, '.forge', 'work-items');
    const wiRecords: WorkItem[] = [];
    if (existsSync(wiDir)) {
      const { items, parseErrors } = readWorkItemsFromDir(wiDir);
      if (Object.keys(parseErrors).length > 0) {
        emit('review.input.wi-parse-errors', { errors: parseErrors }, { event_type: 'error' });
      }
      wiRecords.push(...items);
    }
    const displayOf = (wi: WorkItem): { id: string; title: string; status: string } => ({
      id: wi.work_item_id, title: wi.body.split('\n')[0] ?? wi.work_item_id, status: wi.status,
    });
    const criteriaOf = (wi: WorkItem): string[] =>
      wi.acceptance_criteria.map((ac) => `(${wi.work_item_id}) GIVEN ${ac.given.trim()} WHEN ${ac.when.trim()} THEN ${ac.then.trim()}`);
    const acceptanceCriteria = wiRecords.flatMap(criteriaOf);
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

    const systemPrompt = buildAdversarialReviewSystemPrompt();

    // ── Bounded by construction: one review per WORK ITEM (bead 6.10.24) ─────
    //
    // G2 died here — `error_max_turns`, no findings artifact, no verdict gate,
    // no merge — because one spawn read the whole initiative's diff: its work
    // scaled with the change while its budget did not. The chunk is the work
    // item, which introduces NO NEW NUMBER: the PM already bounded it, one agent
    // authored it, and its gate already ran over it. Files no work item claims
    // become one `unattributed` chunk, so nothing in the diff escapes review.
    const planned = partitionChangedFiles(changedFiles, wiRecords);
    // An empty diff keeps the pre-chunking shape — one chunk of nothing, which
    // the prompt renderer already words as "empty diff — say so in the summary".
    const chunks: ReviewChunk[] = planned.length > 0 ? planned : [{ workItemId: null, files: [] }];
    const byId = new Map(wiRecords.map((w) => [w.work_item_id, w] as const));
    emit('review.chunks.planned', {
      chunks: chunks.length,
      changed_files: changedFiles.length,
      labels: chunks.map(chunkLabel),
      unattributed_files: chunks.find((c) => c.workItemId === null)?.files.length ?? 0,
    });

    // Work items whose declared files are absent from this diff produce no
    // chunk, so no agent is ever shown their criteria. They are judged by the
    // orchestrator at merge time — see `mergeChunkRecords`.
    const chunked = new Set(chunks.map((c) => c.workItemId).filter((id): id is string => id !== null));
    const unjudgedCriteria = wiRecords
      .filter((w) => !chunked.has(w.work_item_id))
      .flatMap((w) => criteriaOf(w).map((criterion) => ({ criterion, workItemId: w.work_item_id })));

    /**
     * One chunk's review: the same spawn, the same write fence, the same class
     * lenses and the same scope guard the whole-diff review used — only the
     * evidence it is given is narrower.
     */
    /**
     * One chunk's evidence, derived ONCE: the reuse key and the bytes the agent
     * is shown are the same value, so they cannot disagree.
     */
    const deriveChunkDiff = (
      chunk: ReviewChunk,
      label: string,
    ): { ok: true; diff: string; stat: string } | { ok: false; failure: AdversarialReviewResult } => {
      const d = chunk.files.length > 0
        ? gitCapture(input.worktreePath, ['diff', `${BASE_REF}...HEAD`, '--', ...chunk.files])
        : { ok: true, out: '', err: '' };
      const st = chunk.files.length > 0
        ? gitCapture(input.worktreePath, ['diff', '--stat', `${BASE_REF}...HEAD`, '--', ...chunk.files])
        : { ok: true, out: '', err: '' };
      if (!d.ok || !st.ok) {
        const detail = `git derivation error for chunk ${label}: ${[d, st].filter((r) => !r.ok).map((r) => r.err).join(' ')}`.trim();
        emit('review.input.derive-error', { detail, chunk: label }, { event_type: 'error' });
        return { ok: false, failure: { status: 'failed', reason: 'derive-failed', detail } };
      }
      return { ok: true, diff: d.out, stat: st.out };
    };

    /** This run's identity — stamped onto a REUSED record, because
     *  `mergeChunkRecords` takes it from the first record and would otherwise
     *  publish a review of a head nobody is merging. */
    const runIdentity = { initiative_id: input.initiativeId, cycleId: input.cycleId, baseRef: BASE_REF, headSha };
    const restamp = (record: ReviewFindingsRecord): ReviewFindingsRecord => ({ ...record, ...runIdentity });

    const reviewChunk = async (
      chunk: ReviewChunk,
      derived: { diff: string; stat: string },
      // A per-file sub-chunk is named by its FILE in every event, prompt and
      // failure message: once the split has bottomed out, the file is the only
      // actionable fact left, and inheriting the work item's label would report
      // the same anonymous failure ruling 290 exists to forbid.
      labelOverride?: string,
    ): Promise<{ ok: true; record: ReviewFindingsRecord } | { ok: false; failure: AdversarialReviewResult }> => {
      const label = labelOverride ?? chunkLabel(chunk);
      const wi = chunk.workItemId === null ? undefined : byId.get(chunk.workItemId);
      const criteria = wi ? criteriaOf(wi) : [];

      // This chunk's evidence, written where the whole diff used to be. Scrubbed
      // with the rest of `.forge/review-input/` in the `finally` below.
      writeFileSync(join(inputDirAbs, 'diff.patch'), derived.diff);
      writeFileSync(join(inputDirAbs, 'diffstat.txt'), derived.stat);
      writeFileSync(join(inputDirAbs, 'changed-files.txt'), chunk.files.join('\n') + '\n');

      const basePrompt = renderAdversarialReviewUserPrompt({
        initiativeId: input.initiativeId,
        cycleId: input.cycleId,
        baseRef: BASE_REF,
        headSha,
        acceptanceCriteria: criteria,
        workItems: wi ? [displayOf(wi)] : [],
        changedFiles: [...chunk.files],
        lenses,
        brainContext,
      });

      // Guard integrity fails LOUD in both directions (finding #1): a failed
      // pre-snapshot must not blame the agent for orchestrator files, and a
      // failed post-snapshot must not silently bypass the guard. Taken PER
      // CHUNK, after this chunk's inputs are written, so the pipeline's own
      // writes are never attributable to the agent.
      const preSnap = takeScopeSnapshot(input.worktreePath);
      if (!preSnap.ok) {
        emit('review.scope-guard-degraded', { when: 'pre-spawn', chunk: label, error: preSnap.error }, { event_type: 'error' });
        return { ok: false, failure: { status: 'failed', reason: 'derive-failed', detail: `scope-guard pre-snapshot unavailable: ${preSnap.error}` } };
      }

      let lastErrors: string[] = [];
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
          emit('review.spawn-error', { detail, attempt, chunk: label }, { event_type: 'error' });
          return { ok: false, failure: { status: 'failed', reason: 'spawn-failed', detail } };
        }
        emit('review.agent-pass', { attempt, chunk: label, result_subtype: spawn.resultSubtype }, { cost_usd: spawn.costUsd });

        // Only budget/turn kills are exhaustion; other error_* subtypes (e.g.
        // error_during_execution) are spawn failures — telling the operator to
        // raise budgets for those is a misdiagnosis (finding #3).
        if (spawn.resultSubtype && spawn.resultSubtype.startsWith('error_max_')) {
          emit('review.budget-exhausted', { result_subtype: spawn.resultSubtype, attempt, chunk: label }, { event_type: 'error' });
          // Ruling 290: name the chunk. A budget kill on ONE work item is a
          // fact about that work item's diff, and reporting it anonymously is
          // what made G2's failure unactionable. Never skipped, never retried
          // with a wider budget.
          return {
            ok: false,
            failure: {
              status: 'failed',
              reason: 'budget-exhausted',
              detail:
                `${label} is too large for review: its spawn was terminated by the SDK (${spawn.resultSubtype}). ` +
                (chunk.files.length === 1
                  // Bottomed out: one file's own diff exceeded the pass. There is
                  // no smaller unit to cut to, so the fact worth reporting is the
                  // FILE — and the action is still upstream, never the budget.
                  ? `The chunk is a SINGLE file and cannot be split further: ${chunk.files[0]}. ` +
                    `Split the work item, not the budget.`
                  : `${chunk.files.length} file(s) in this chunk. Split the work item, not the budget.`),
            },
          };
        }
        if (spawn.resultSubtype && spawn.resultSubtype.startsWith('error_')) {
          emit('review.spawn-error', { result_subtype: spawn.resultSubtype, attempt, chunk: label }, { event_type: 'error' });
          return {
            ok: false,
            failure: {
              status: 'failed',
              reason: 'spawn-failed',
              detail: `adversarial-review spawn for ${label} ended with SDK subtype ${spawn.resultSubtype} (execution failure, not a budget kill)`,
            },
          };
        }

        // Mechanical scope guard: the reviewer's only legal write is the
        // findings file (review-input was pipeline-written pre-snapshot; the
        // snapshot layers cover untracked-dir collapse + gitignored .forge —
        // agent-scope-guard.ts).
        const postSnap = takeScopeSnapshot(input.worktreePath);
        if (!postSnap.ok) {
          emit('review.scope-guard-degraded', { when: 'post-spawn', chunk: label, error: postSnap.error }, { event_type: 'error' });
          return { ok: false, failure: { status: 'failed', reason: 'derive-failed', detail: `scope-guard post-snapshot unavailable: ${postSnap.error}` } };
        }
        const newDirt = scopeViolations(preSnap, postSnap, (p) => p === findingsRel);
        if (newDirt.length > 0) {
          emit('review.scope-violation', { paths: newDirt, chunk: label }, { event_type: 'error' });
          return {
            ok: false,
            failure: {
              status: 'failed',
              reason: 'scope-violation',
              detail: `adversarial-review wrote outside ${findingsRel}: ${newDirt.join(', ')} — the reviewer judges, it never edits`,
            },
          };
        }

        // Band 4 — harvest + validate (+ identity-echo verification).
        const harvest = harvestFindings(
          findingsAbs,
          findingsRel,
          { initiative_id: input.initiativeId, cycleId: input.cycleId, baseRef: BASE_REF, headSha },
          { lenses, criteria },
        );
        if (!harvest.ok) {
          lastErrors = harvest.errors;
          emit('review.author.invalid', { attempt, chunk: label, errors: harvest.errors });
          continue;
        }
        return { ok: true, record: harvest.record };
      }
      return { ok: false, failure: { status: 'failed', reason: 'author-invalid', detail: `${label}: ${lastErrors.join('; ')}` } };
    };

    /**
     * One work item, reviewed a FILE at a time — bead 6.10.26, with its parts
     * bought once — bead `forge-6fvw`. Each per-file record persists on its own
     * key (`<chunk>.<file>`) the moment it completes, and a later pass reuses
     * it: G2's second resume measured a per-file review at $0.9142, and a run
     * stopped mid-split used to discard every one of them.
     */
    const reviewSplit = async (
      chunk: ReviewChunk,
      index: number,
    ): Promise<{ ok: true; record: ReviewFindingsRecord } | { ok: false; failure: AdversarialReviewResult }> => {
      const subs: Array<{ label: string; record: ReviewFindingsRecord }> = [];
      for (const [subIndex, sub] of splitChunkPerFile(chunk).entries()) {
        const subLabel = sub.files[0]!;
        const subKey = `${index}.${subIndex}`;
        const subDerived = deriveChunkDiff(sub, subLabel);
        if (!subDerived.ok) return { ok: false, failure: subDerived.failure };
        const subDiffSha = diffSha(subDerived.diff);
        const cached = readChunkRecord(input.logsRoot, input.cycleId, subKey, { label: subLabel, diffSha: subDiffSha });
        if (cached !== null) {
          emit('review.chunk.reused', { chunk: subLabel, index: subKey });
          subs.push({ label: subLabel, record: restamp(cached) });
          continue;
        }
        const subOutcome = await reviewChunk(sub, subDerived, subLabel);
        // A file that exhausts on its own has bottomed out — reported by
        // `reviewChunk` with the file named, and NOT ground through the
        // remaining files, which would buy nothing and cost a spawn each.
        if (!subOutcome.ok) return { ok: false, failure: subOutcome.failure };
        const at = writeChunkRecord(input.logsRoot, input.cycleId, subKey, { label: subLabel, diffSha: subDiffSha, headSha, record: subOutcome.record });
        emit('review.chunk.persisted', { chunk: subLabel, index: subKey, path: at ?? '(not persisted — this file will be re-reviewed)' });
        subs.push({ label: subLabel, record: subOutcome.record });
      }
      return { ok: true, record: mergeSplitRecords(subs) };
    };

    const chunkRecords: Array<{ label: string; record: ReviewFindingsRecord }> = [];
    for (const [index, chunk] of chunks.entries()) {
      const label = chunkLabel(chunk);
      const key = String(index);

      const derived = deriveChunkDiff(chunk, label);
      if (!derived.ok) return derived.failure;
      const chunkDiffSha = diffSha(derived.diff);

      // Bead 6.10.27: a chunk whose review already completed against THIS DIFF
      // is not bought again. Every not-an-exact-match reads as a miss, so the
      // worst case is the cost the review already had. Re-stamped, because the
      // record carries the identity it was authored under.
      const reused = readChunkRecord(input.logsRoot, input.cycleId, key, { label, diffSha: chunkDiffSha });
      if (reused !== null) {
        emit('review.chunk.reused', { chunk: label, index: key });
        chunkRecords.push({ label, record: restamp(reused) });
        continue;
      }

      // A chunk whose FIRST per-file record already exists was split against
      // this diff, so the whole-work-item spawn has exactly one possible
      // outcome — the exhaustion already recorded — at full price ($0.7594 on
      // G2's second resume). Re-enter the split instead of re-deriving it.
      const firstFile = chunk.files[0];
      const firstSub = chunk.files.length > 1 && firstFile !== undefined
        ? deriveChunkDiff({ workItemId: chunk.workItemId, files: [firstFile] }, firstFile)
        : null;
      const knownSplit =
        firstSub !== null && firstSub.ok &&
        readChunkRecord(input.logsRoot, input.cycleId, `${index}.0`, { label: firstFile!, diffSha: diffSha(firstSub.diff) }) !== null;

      let outcome: { ok: true; record: ReviewFindingsRecord } | { ok: false; failure: AdversarialReviewResult };
      if (knownSplit) {
        emit('review.chunk.split', { chunk: label, files: chunk.files.length, reentered: true });
        outcome = await reviewSplit(chunk, index);
      } else {
        outcome = await reviewChunk(chunk, derived);
        // Bead 6.10.26: the work item is the FIRST cut, not the only one. A
        // budget kill on a multi-file chunk re-reviews that work item one FILE
        // at a time — same criteria, same fence, narrower evidence. Measured on
        // G2: `WI-2` exhausted 50 turns on eight files while `WI-1` passed, so
        // the work item's own size, not the reviewer, was the bound.
        if (!outcome.ok && outcome.failure.status === 'failed' && outcome.failure.reason === 'budget-exhausted' && chunk.files.length > 1) {
          emit('review.chunk.split', { chunk: label, files: chunk.files.length });
          outcome = await reviewSplit(chunk, index);
        }
      }

      if (!outcome.ok) return outcome.failure;
      // Persisted the moment it is finished, never at the end: the chunk AFTER
      // this one is exactly what might fail, and that is the case this exists
      // for.
      const at = writeChunkRecord(input.logsRoot, input.cycleId, key, { label, diffSha: chunkDiffSha, headSha, record: outcome.record });
      emit('review.chunk.persisted', { chunk: label, index: key, path: at ?? '(not persisted — this chunk will be re-reviewed)' });
      chunkRecords.push({ label, record: outcome.record });
    }

    // Band 5 — merge into the ONE artifact the verdict gate reads, validate the
    // MERGED record against the whole initiative's criteria (each chunk was only
    // validated against its own), persist, scrub.
    const merged = mergeChunkRecords(chunkRecords, unjudgedCriteria);
    const mergedErrors = validateReviewFindings(merged, { lenses, criteria: acceptanceCriteria });
    if (mergedErrors.length > 0) {
      emit('review.merged.invalid', { errors: mergedErrors, chunks: chunkRecords.length }, { event_type: 'error' });
      return { status: 'failed', reason: 'author-invalid', detail: `merged review-findings invalid: ${mergedErrors.join('; ')}` };
    }
    const persisted = writeReviewFindingsJson(input.logsRoot, merged);
    if (!persisted) {
      return { status: 'failed', reason: 'author-invalid', detail: 'failed to persist review-findings.json (IO error)' };
    }
    const counts: Record<string, number> = { total: merged.findings.length, blocker: 0, major: 0, minor: 0, info: 0 };
    for (const f of merged.findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
    emit('review.findings.authored', { ...counts, path: persisted, head_sha: headSha, chunks: chunkRecords.length });
    return { status: 'complete', findingsPath: persisted, counts };
  } finally {
    scrub();
  }
}

// ---------------------------------------------------------------------------
// One chunk's finished review, kept — bead forge-8vfn.6.10.27.
//
// G2's resume paid for `WI-1`, `WI-2` exhausted, and the pipeline returned a
// failure — so `WI-1`'s completed record died with it and every retry re-buys
// every chunk that already succeeded: the resume problem the cycle solves one
// level up, unsolved one level down.
//
// Keyed by chunk INDEX, not by label: a label is a work-item id today and a FILE
// PATH inside a split, and a path is not a filename. The index is generated
// here, and the read/write go through `guardedReadFile`/`guardedWriteFile`, so
// this adds neither a path-safety predicate nor a raw sink on a bridge-reachable
// module. Label and head SHA live INSIDE the file and are checked on read, so an
// index that has come to mean something else is a MISS, not a wrong answer.
// ---------------------------------------------------------------------------

type StoredChunk = {
  label: string;
  /** sha256 of the exact diff this chunk was reviewed FROM — the reuse key. */
  diffSha: string;
  /** The head it was first reviewed at. Provenance only: never the reuse key. */
  headSha: string;
  record: ReviewFindingsRecord;
};

/**
 * The reuse key: what a review is a review OF.
 *
 * It was `headSha`, and G2 measured that wrong (ledger, 2026-09-06): the
 * integrate band commits TWICE on every run — `chore(developer-loop): pre-review
 * boundary snapshot` and `chore(demo): demo artifacts` — so the head differed on
 * every attempt and every persisted record was rejected as stale by the guard
 * that exists to stop a review of code nobody is merging. The store worked
 * perfectly within one pass and was dead across the only boundary that matters.
 *
 * The diff is the honest key: a chunk whose diff is byte-identical has already
 * been reviewed, whatever the orchestrator wrote to the branch since, and a
 * chunk whose diff moved is refused exactly as before.
 */
function diffSha(diff: string): string {
  return createHash('sha256').update(diff).digest('hex');
}

/**
 * The key is built here from integers only — a chunk's ordinal, and for a
 * split's part its parent's ordinal and its own (`"3.5"`). It is never
 * caller-supplied, so it cannot carry a separator or a `..`; the guarded
 * wrappers below still resolve every segment.
 */
const chunkSegments = (cycleId: string, key: string): string[] => [cycleId, 'artifacts', 'review-chunks', `chunk-${key}.json`];

/**
 * The persisted record for this chunk, or `null` — and `null` for EVERY reason
 * that is not an exact match: rejected path, no file, unreadable, a different
 * label at this index, or a record authored against a different head. A stale
 * reuse would be a review of code nobody is merging; a miss costs only what the
 * review already costs, so the miss is always the safe answer.
 */
export function readChunkRecord(
  logsRoot: string,
  cycleId: string,
  key: string,
  expect: { label: string; diffSha: string },
): ReviewFindingsRecord | null {
  const raw = guardedReadFile(logsRoot, chunkSegments(cycleId, key));
  if (raw === null) return null;
  try {
    const stored = JSON.parse(raw) as Partial<StoredChunk>;
    if (stored.label !== expect.label || stored.diffSha !== expect.diffSha) return null;
    if (stored.record === undefined) return null;
    return stored.record;
  } catch {
    return null;
  }
}

/** Persist one finished chunk; the written path, or `null` if the guard refused
 *  or the write failed — a durable record must never break the review that
 *  produced it. */
export function writeChunkRecord(logsRoot: string, cycleId: string, key: string, entry: StoredChunk): string | null {
  return guardedWriteFile(logsRoot, chunkSegments(cycleId, key), JSON.stringify(entry, null, 2) + '\n');
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
