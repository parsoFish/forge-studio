/**
 * Adversarial-review pipeline (R4-08-F1) — the orchestrator bands around the
 * one-shot critique spawn.
 *
 * Band order: assemble (orchestrator-derived diff.patch / diffstat /
 * changed-files into `.forge/review-input/` + head SHA — D-15: the agent
 * judges, evidence assembly is orchestrator-owned) → spawn (`runAgent`,
 * `lifecycle: 'caller'`) → harvest (`.forge/review-findings.json`: schema +
 * identity-echo verification, ONE bounded authoring retry) → persist (the
 * `review-findings` artifact under `_logs/<cycleId>/artifacts/`) → scrub
 * (review-input dir + worktree findings copy deleted — nothing untracked is
 * ever left to block a later merge).
 *
 * The findings are agent CLAIMS weighed by the operator at the verdict gate —
 * never a gate by themselves (D-07: approve IS the merge).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { requireClassProfiles, type ChangeClass, type ClassProfilePort } from '../class-profile-port.ts';
import { reviewCeilingUsd } from './review-budget.ts';
import { requireCycleId } from './cycle-id.ts';
import { writeRootFenceOptions } from '@forge/sessions';
import { projectBrainDir } from '@forge/knowledge';
import {
  validateReviewFindings,
  writeReviewFindingsJson,
  writeReviewOutcomeJson,
  readWorkItemsFromDir,
  worktreeDemoRelDir,
  type ReviewFindingsRecord,
  type WorkItem,
} from '@forge/flows';
import { FORGE_ROOT, type EventLogger } from '@forge/kernel';
import {
  runAgent,
  makeToolEventSink,
  takeScopeSnapshot,
  scopeViolations,
  type StreamQueryFn,
  type HeartbeatTimers,
} from '@forge/agents';
import type { AgentDefinition } from '@forge/contracts';
import { chunkLabel, mergeChunkRecords, partitionChangedFiles, type ReviewChunk,
  splitChunkPerFile, mergeSplitRecords, diffSha, readChunkRecord, writeChunkRecord,
} from './review-chunks.ts';
import { criterionCommands, deliveredSince, escalateAcFindings, recordedDeliveries, runCriterion } from './review-truth.ts';
import {
  buildAdversarialReviewSystemPrompt,
  renderAdversarialReviewUserPrompt,
  REVIEW_FINDINGS_FILENAME,
  REVIEW_INPUT_REL_DIR,
} from './adversarial-review-binding.ts';
import { trackSpawnRefusal, spawnRefusalFailure, harvestFindings } from './review-refusal.ts';
import { REVIEW_GIT_MAX_BUFFER_BYTES, agentTouchedPaths, parseNumstatZ, scopeChunks } from './review-input-scope.ts';
import { capDetail, isCapExhaustion, partialChunk, unreviewedRecord } from './review-partial.ts';
import type { PartialChunk } from '@forge/flows';

const BASE_REF = 'main';
const MAX_AUTHOR_ATTEMPTS = 2;

export type AdversarialReviewInput = {
  initiativeId: string;
  worktreePath: string;
  cycleId: string;
  logsRoot: string;
  /**
   * The initiative's change class (D-34). It selects the review lenses from
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
  flowReview?: { flowId: string; lenses: readonly string[] }; // seam F6 (ruling 97): flow's review-lens narrowing
};

export type AdversarialReviewResult =
  | { status: 'complete'; findingsPath: string; counts: Record<string, number> }
  | {
      status: 'failed';
      reason:
        | 'derive-failed' | 'author-invalid' | 'scope-violation'
        | 'spawn-suppressed' | 'spawn-failed' | 'lens-narrowing-invalid' | 'rate-limited';
      detail: string;
    };

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
    throw new Error('adversarial-review SKILL.md must declare budgets.maxTurns — the live turn cap is frontmatter data (SPEC §1)');
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

  // ALLOWLIST, not a denylist (spec §5 item 5, containment review 2026-09-05): a denylist over an
  // open tool vocabulary passes `Task`/`Agent` (execution by delegation) and every tool the SDK gains.
  const extra = def.allowedTools.filter((t) => !REVIEW_ALLOWED_TOOLS.includes(t));
  if (extra.length > 0) {
    throw new Error(
      `adversarial-review SKILL.md grants ${extra.join(', ')} — the reviewer judges and never runs or edits, so its tools are exactly ${REVIEW_ALLOWED_TOOLS.join(', ')} (D-15). Execution reached by delegation (Task/Agent) or by a cell (NotebookEdit) is still execution.`,
    );
  }
  for (const t of REVIEW_EXECUTION_TOOLS) {
    if (!def.disallowedTools.includes(t)) {
      throw new Error(
        `adversarial-review SKILL.md must DISALLOW ${t} explicitly — an empty allow-list is not a fence when the runtime's default tool set is not empty (D-15)`,
      );
    }
  }
}

function gitCapture(worktreePath: string, args: string[]): { ok: boolean; out: string; err: string } {
  try {
    const out = execFileSync('git', args, { cwd: worktreePath, stdio: 'pipe', encoding: 'utf8', timeout: 60_000, maxBuffer: REVIEW_GIT_MAX_BUFFER_BYTES });
    return { ok: true, out, err: '' };
  } catch (e) {
    const err = e as { stderr?: Buffer | string; message?: string; code?: string };
    if (err.code === 'ENOBUFS') {
      return { ok: false, out: '', err: `git ${args.find((a) => !a.startsWith('-'))} output exceeded the review's ${REVIEW_GIT_MAX_BUFFER_BYTES / (1024 * 1024)} MiB buffer (ENOBUFS)` };
    }
    const stderr = err.stderr ? (typeof err.stderr === 'string' ? err.stderr : err.stderr.toString('utf8')) : (err.message ?? '');
    return { ok: false, out: '', err: stderr.slice(-500) };
  }
}

/** One chunk's review: its record (with any chunk that hit its cap named), or the failure that ends the review. */
type ChunkOutcome =
  | { ok: true; record: ReviewFindingsRecord; partials: PartialChunk[] }
  | { ok: false; failure: AdversarialReviewResult };

type ReviewOpts = {
  queryFn?: StreamQueryFn;
  signal?: AbortSignal;
  classProfiles?: ClassProfilePort;
  agentDef: AgentDefinition; // seam F4: the executing node's own def, no fallback
  // 8.1.30 — test-injection, mirrors RunContext.heartbeatTimers.
  heartbeatTimers?: HeartbeatTimers;
};

/** The review, its OUTCOME recorded on every attempt — findings are written only on success (forge-nk1y.39). */
export async function runAdversarialReview(
  input: AdversarialReviewInput,
  logger: EventLogger,
  opts: ReviewOpts,
): Promise<AdversarialReviewResult> {
  const head = gitCapture(input.worktreePath, ['rev-parse', 'HEAD']);
  const record = (status: 'complete' | 'failed', reason: string | null, detail: string | null): void => {
    const at = writeReviewOutcomeJson(input.logsRoot, { cycleId: input.cycleId, headSha: head.ok ? head.out.trim() : null, status, reason, detail, at: new Date().toISOString() });
    if (at === null) {
      logger.emit({ initiative_id: input.initiativeId, phase: 'orchestrator', skill: opts.agentDef.slug, event_type: 'error', input_refs: [], output_refs: [],
        message: 'review.outcome.write-error', metadata: { status, reason } });
    }
  };
  let result: AdversarialReviewResult;
  try {
    result = await reviewInitiative(input, logger, opts);
  } catch (err) {
    record('failed', 'threw', err instanceof Error ? err.message : String(err)); // a throw is a failed attempt too
    throw err;
  }
  record(result.status, result.status === 'failed' ? result.reason : null, result.status === 'failed' ? result.detail : null);
  return result;
}

async function reviewInitiative(
  input: AdversarialReviewInput,
  logger: EventLogger,
  opts: ReviewOpts,
): Promise<AdversarialReviewResult> {
  const def = opts.agentDef;
  // The one port (items 81/83): the class table is the example's. Read once, so
  // every profileFor() below reads the SAME bound table.
  const classProfiles = requireClassProfiles(opts.classProfiles, 'adversarial-review');
  const emit = (
    message: string,
    metadata: Record<string, unknown> = {},
    extra: { event_type?: 'log' | 'error'; cost_usd?: number } = {},
  ): void => {
    logger.emit({
      initiative_id: input.initiativeId,
      phase: 'orchestrator',
      skill: def.slug,
      event_type: extra.event_type ?? 'log',
      input_refs: [],
      output_refs: [],
      ...(extra.cost_usd !== undefined ? { cost_usd: extra.cost_usd } : {}),
      message,
      metadata: { agent_slug: def.slug, ...metadata },
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

  assertAdversarialReviewDeclaration(def);

  // Band 1 — assemble the review inputs (orchestrator-owned). The diff is captured per chunk (bead forge-8vfn.6.10.24).
  // `-z`: unquoted paths, so a name with unusual bytes reaches the pathspec as itself.
  const changedFilesRes = gitCapture(input.worktreePath, ['diff', '--name-only', '-z', `${BASE_REF}...HEAD`]);
  // The CHANGE SIZE (review ceiling, bead forge-8vfn.6.10.24: never the patch itself) and the binaries, in one read.
  const numstatRes = gitCapture(input.worktreePath, ['diff', '--numstat', '-z', `${BASE_REF}...HEAD`]);
  const logRes = gitCapture(input.worktreePath, ['log', '--no-merges', '--format=%x01%ae', '--name-only', '-z', `${BASE_REF}..HEAD`]);
  const headShaRes = gitCapture(input.worktreePath, ['rev-parse', 'HEAD']);
  if (!changedFilesRes.ok || !headShaRes.ok || !numstatRes.ok || !logRes.ok) {
    const detail = `git derivation error: ${[changedFilesRes, headShaRes, numstatRes, logRes].filter((r) => !r.ok).map((r) => r.err).join(' ')}`.trim();
    // Event name deliberately avoids the 'review'+'failed' substring pair —
    // failure-classifier.ts's reviewer signature would misclassify it as a
    // terminal reviewer-convergence failure (adversarial review finding #12).
    emit('review.input.derive-error', { detail }, { event_type: 'error' });
    return { status: 'failed', reason: 'derive-failed', detail };
  }
  const headSha = headShaRes.out.trim();
  const changedFiles = changedFilesRes.out.split('\0').filter(Boolean);
  const numstat = parseNumstatZ(numstatRes.out);
  const inputDirAbs = join(input.worktreePath, REVIEW_INPUT_REL_DIR);
  mkdirSync(inputDirAbs, { recursive: true });
  emit('review.input.assembled', { changed_files: changedFiles.length, head_sha: headSha, base_ref: BASE_REF });

  // Beads `forge-gefz` / `forge-jb7i` (operator rulings 475 + 526). ONE ceiling
  // for the whole initiative, derived from its total change size and bounded by
  // the operator's per-class wall, handed to EVERY chunk unchanged — ruling
  // 290's byte-identical option bags are preserved exactly. `undefined` when
  // the agent declares no flat budget: nothing is invented and
  // `resolveOneShotBudgetUsd`'s share-based resolution stands, as before.
  // A numstat that could not be read is a derive failure above — never a zero-line change.
  const initiativeChangedLines = numstat.changedLines;
  const ceilingUsd = reviewCeilingUsd(def.budgets.maxBudgetUsd, initiativeChangedLines, classProfiles.profileFor(input.changeClass).reviewCeilingUsd);
  emit('review.ceiling', {
    declared_usd: def.budgets.maxBudgetUsd ?? null,
    changed_lines: initiativeChangedLines,
    class_max_usd: classProfiles.profileFor(input.changeClass).reviewCeilingUsd,
    ceiling_usd: ceilingUsd ?? null,
  });

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
    const classLenses = classProfiles.profileFor(input.changeClass).reviewLenses;
    let lenses: readonly string[] = classLenses; // seam F6 (ruling 97): flowReview narrows this
    if (input.flowReview !== undefined) {
      const { flowId, lenses: declared } = input.flowReview;
      const unknownLens = declared.find((l) => !classLenses.includes(l));
      if (unknownLens !== undefined) {
        const detail = `flow ${flowId} narrows review to lens ${unknownLens}, which class ${input.changeClass} does not have; the class's lenses are ${classLenses.join(', ')}`;
        emit('review.lens-narrowing-refused', { flow_id: flowId, unknown_lens: unknownLens }, { event_type: 'error' });
        return { status: 'failed', reason: 'lens-narrowing-invalid', detail };
      }
      lenses = classLenses.filter((l) => declared.includes(l)); // intersection, class table's order
    }

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
    const criterionOf = (wi: WorkItem, ac: WorkItem['acceptance_criteria'][number]): string =>
      `(${wi.work_item_id}) GIVEN ${ac.given.trim()} WHEN ${ac.when.trim()} THEN ${ac.then.trim()}`;
    const criteriaOf = (wi: WorkItem): string[] => wi.acceptance_criteria.map((ac) => criterionOf(wi, ac));
    // forge-mfv5.1.30: recorded deliveries, and every runnable criterion RUN at this head (D-15).
    const git = (args: string[]): { ok: boolean; out: string } => gitCapture(input.worktreePath, args);
    const delivered = recordedDeliveries(git, BASE_REF);
    if (delivered === null) {
      emit('review.input.derive-error', { detail: 'could not read the recorded work-item merges' }, { event_type: 'error' });
      return { status: 'failed', reason: 'derive-failed', detail: `could not read the wi(<id>): merge commits on ${BASE_REF}..HEAD` };
    }
    const ran = new Map<string, { workItemId: string; verdict: 'met' | 'missed'; evidence: string }>();
    const byCommand = new Map<string, { verdict: 'met' | 'missed'; evidence: string }>();
    for (const w of wiRecords) for (const ac of w.acceptance_criteria) {
      const cmds = criterionCommands(ac);
      if (cmds === null) continue;
      const k = JSON.stringify(cmds);
      if (!byCommand.has(k)) byCommand.set(k, runCriterion(input.worktreePath, input.initiativeId, headSha, cmds));
      ran.set(criterionOf(w, ac), { workItemId: w.work_item_id, ...byCommand.get(k)! });
    }
    emit('review.criteria.run', { criteria: ran.size, commands: byCommand.size, missed: [...ran.values()].filter((r) => r.verdict === 'missed').length });
    const agentCriteriaOf = (wi: WorkItem): string[] => criteriaOf(wi).filter((c) => !ran.has(c));
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

    const systemPrompt = buildAdversarialReviewSystemPrompt(def);

    // Bounded by construction: one review per WORK ITEM (bead 6.10.24 — G2's one whole-diff spawn
    // hit error_max_turns); unclaimed files form one `unattributed` chunk. forge-nk1y.39: cut by
    // CLAIM over every changed file, THEN strip what is named, not derived.
    const scope = scopeChunks(partitionChangedFiles(changedFiles, wiRecords.map((w) =>
      (w.origin === undefined ? w : { ...w, delivered: delivered.get(w.work_item_id) ?? [] }))), {
      binaries: numstat.binaries, demoRelDir: worktreeDemoRelDir(input.worktreePath, input.initiativeId), agentTouched: agentTouchedPaths(logRes.out),
    });
    const planned = scope.chunks;
    const emptied = new Map(scope.emptied.map((e) => [e.workItemId, e.files] as const));
    emit('review.input.excluded', {
      binary: scope.notReviewed.filter((n) => n.reason === 'binary').length,
      demo_bundle: scope.notReviewed.filter((n) => n.reason === 'demo-bundle').length,
      emptied_work_items: [...emptied.keys()],
    });
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

    // Criteria no agent is shown — a work item with no chunk, or one RUN above —
    // carry the orchestrator's verdict into the merge (`mergeChunkRecords`).
    const chunked = new Set(chunks.map((c) => c.workItemId).filter((id): id is string => id !== null));
    const unjudgedCriteria = [
      ...wiRecords.filter((w) => !chunked.has(w.work_item_id)).flatMap((w) => agentCriteriaOf(w).map((criterion) => ({
        criterion, workItemId: w.work_item_id,
        ...(emptied.has(w.work_item_id) ? { verdict: 'partial' as const, evidence: `not judged: every file ${w.work_item_id} changed is a binary or the orchestrator's demo bundle (${emptied.get(w.work_item_id)!.join(', ')}) — weigh it at the gate (verdict authored by the orchestrator, not by a review agent)` } : {}),
        ...(w.origin === undefined || emptied.has(w.work_item_id) ? {} : { evidence: `no \`wi(${w.work_item_id}): merge\` commit on ${BASE_REF}..HEAD changed a file in this diff — the dev loop recorded no delivery for this fix work item (verdict authored by the orchestrator, not by a review agent)` }),
      }))),
      ...[...ran].map(([criterion, r]) => ({ criterion, ...r })),
    ];

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
        // Agent-authored names are paths, never pathspec magic (`:(exclude)…`, `*`).
        ? gitCapture(input.worktreePath, ['--literal-pathspecs', 'diff', `${BASE_REF}...HEAD`, '--', ...chunk.files])
        : { ok: true, out: '', err: '' };
      const st = chunk.files.length > 0
        ? gitCapture(input.worktreePath, ['--literal-pathspecs', 'diff', '--stat', `${BASE_REF}...HEAD`, '--', ...chunk.files])
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
    const restamp = (record: ReviewFindingsRecord): ReviewFindingsRecord =>
      ({ ...record, ...runIdentity, summary: `(judged at ${record.headSha.slice(0, 12)}; no work item delivered since) ${record.summary}` });
    /** forge-mfv5.1.30: a stored record is reused only while no work item has delivered since the head it judged. */
    const fresh = (record: ReviewFindingsRecord | null, label: string): ReviewFindingsRecord | null => {
      if (record === null || !deliveredSince(git, record.headSha)) return record;
      emit('review.chunk.reuse-refused', { chunk: label, judged_at: record.headSha, head_sha: headSha });
      return null;
    };

    /** A partial record is kept flagged: it marks a known split, and is re-bought, never reused. */
    const persist = (key: string, label: string, sha: string, o: { record: ReviewFindingsRecord; partials: PartialChunk[] }): void => {
      const at = writeChunkRecord(input.logsRoot, input.cycleId, key, { label, diffSha: sha, headSha, record: o.record, ...(o.partials.length > 0 ? { partial: true } : {}) });
      emit('review.chunk.persisted', { chunk: label, index: key, partial: o.partials.length > 0, path: at ?? '(not persisted — this chunk will be re-reviewed)' });
    };

    const reviewChunk = async (
      chunk: ReviewChunk,
      derived: { diff: string; stat: string },
      // A per-file sub-chunk is named by its FILE in every event, prompt and
      // failure message: once the split has bottomed out, the file is the only
      // actionable fact left, and inheriting the work item's label would report
      // the same anonymous failure ruling 290 exists to forbid.
      labelOverride?: string,
    ): Promise<ChunkOutcome> => {
      const label = labelOverride ?? chunkLabel(chunk);
      const wi = chunk.workItemId === null ? undefined : byId.get(chunk.workItemId);
      const criteria = wi ? agentCriteriaOf(wi) : [];

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
        maxTurns: def.budgets.maxTurns!, // asserted declared by assertAdversarialReviewDeclaration
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
        // `ceilingUsd` is the INITIATIVE's, derived once above and identical for every
        // chunk (ruling 526) — `kickoffCeilingUsd` wins over the agent's own budget.
        let spawn;
        const refusalTracker = trackSpawnRefusal();
        const toolSink = makeToolEventSink(logger, { initiativeId: input.initiativeId, parentEventId: input.cycleId, phase: 'orchestrator', skill: def.slug });
        try {
          spawn = await runAgent(def, {
            runId: requireCycleId(input, 'adversarialReview'),
            workdir: input.worktreePath,
            cwd: input.worktreePath,
            prompt,
            systemPrompt,
            lifecycle: 'caller',
            logger, // forge-8vfn.8.1.10: lets runAgent root the spawn marker at this pipeline's own logger, not <FORGE_ROOT>/_logs.
            turnSink: toolSink,
            ...(opts.heartbeatTimers !== undefined ? { heartbeatTimers: opts.heartbeatTimers } : {}),
            streamGuard: { label: def.slug, signal: opts.signal },
            bindings: { initiative: { id: input.initiativeId, costBudgetUsd: input.costBudgetUsd } },
            ...(ceilingUsd !== undefined ? { kickoffCeilingUsd: ceilingUsd } : {}),
            queryFn: opts.queryFn,
            onMessage: refusalTracker.onMessage,
            ...writeFence,
          });
        } catch (err) {
          toolSink.flushIteration(attempt);
          const detail = err instanceof Error ? err.message : String(err);
          // 'spawn-error' (not '…failed') — the failure-classifier's reviewer
          // signature matches 'review'+'failed' substrings (finding #12).
          emit('review.spawn-error', { detail, attempt, chunk: label }, { event_type: 'error' });
          return { ok: false, failure: { status: 'failed', reason: 'spawn-failed', detail } };
        }
        toolSink.flushIteration(attempt); // what the sampler dropped is said, never silent
        emit('review.agent-pass', { attempt, chunk: label, result_subtype: spawn.resultSubtype, tool_use_count: spawn.toolUseCount ?? 0 }, { cost_usd: spawn.costUsd });

        // Only a turn/budget cap degrades (forge-mfv5.1.61, below); every other error_* subtype
        // (e.g. error_during_execution) is a spawn failure (finding #3).
        const capped = isCapExhaustion(spawn.resultSubtype);
        if (!capped && spawn.resultSubtype && spawn.resultSubtype.startsWith('error_')) {
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
        const refused = spawnRefusalFailure(refusalTracker.signal(), { attempt, chunk: label }, emit);
        if (refused) return { ok: false, failure: refused }; // never retried, never author-invalid

        // Mechanical scope guard: the reviewer's only legal write is the findings
        // file (review-input was pipeline-written pre-snapshot; the snapshot layers
        // cover untracked-dir collapse + gitignored .forge — agent-scope-guard.ts).
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
        const harvest = harvestFindings(findingsAbs, findingsRel, runIdentity, { lenses, criteria, scope: `chunk ${label}` });
        if (capped) {
          // forge-mfv5.1.61: the cap ends this chunk PARTIAL, never the review — the agent's own early
          // file when it is valid, else the orchestrator's `unreviewed` finding naming the files.
          const capSpawn = { ...spawn, resultSubtype: spawn.resultSubtype! };
          const detail = capDetail(label, capSpawn);
          const partial = partialChunk(label, chunk, capSpawn, harvest.ok ? 'agent' : 'orchestrator');
          emit('review.chunk.partial', { chunk: label, work_item_id: chunk.workItemId, files: chunk.files, result_subtype: spawn.resultSubtype,
            tool_use_count: partial.toolUses, last_tools: partial.lastTools, source: partial.source, attempt, detail }, { event_type: 'error' });
          const record = harvest.ok ? harvest.record : unreviewedRecord({ identity: runIdentity, files: chunk.files, criteria, lenses, detail });
          return { ok: true, record, partials: [partial] };
        }
        if (!harvest.ok) {
          lastErrors = harvest.errors;
          emit('review.author.invalid', { attempt, chunk: label, errors: harvest.errors });
          continue;
        }
        return { ok: true, record: harvest.record, partials: [] };
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
    ): Promise<ChunkOutcome> => {
      const subs: Array<{ label: string; record: ReviewFindingsRecord }> = [];
      const partials: PartialChunk[] = [];
      for (const [subIndex, sub] of splitChunkPerFile(chunk).entries()) {
        const subLabel = sub.files[0]!;
        const subKey = `${index}.${subIndex}`;
        const subDerived = deriveChunkDiff(sub, subLabel);
        if (!subDerived.ok) return { ok: false, failure: subDerived.failure };
        const subDiffSha = diffSha(subDerived.diff);
        const cached = fresh(readChunkRecord(input.logsRoot, input.cycleId, subKey, { label: subLabel, diffSha: subDiffSha }), subLabel);
        if (cached !== null) {
          emit('review.chunk.reused', { chunk: subLabel, index: subKey });
          subs.push({ label: subLabel, record: restamp(cached) });
          continue;
        }
        const subOutcome = await reviewChunk(sub, subDerived, subLabel);
        if (!subOutcome.ok) return { ok: false, failure: subOutcome.failure };
        // forge-mfv5.1.61: a file that hits the cap is PARTIAL and the split goes on — the
        // files after it are each their own bounded spawn, and stopping here discarded them.
        persist(subKey, subLabel, subDiffSha, subOutcome);
        subs.push({ label: subLabel, record: subOutcome.record });
        partials.push(...subOutcome.partials);
      }
      return { ok: true, record: mergeSplitRecords(subs), partials };
    };

    const chunkRecords: Array<{ label: string; record: ReviewFindingsRecord }> = [];
    const partialChunks: PartialChunk[] = [];
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
      const reused = fresh(readChunkRecord(input.logsRoot, input.cycleId, key, { label, diffSha: chunkDiffSha }), label);
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
        readChunkRecord(input.logsRoot, input.cycleId, `${index}.0`, { label: firstFile!, diffSha: diffSha(firstSub.diff) }, { acceptPartial: true }) !== null;

      let outcome: ChunkOutcome;
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
        if (outcome.ok && outcome.partials.length > 0 && chunk.files.length > 1) {
          emit('review.chunk.split', { chunk: label, files: chunk.files.length });
          outcome = await reviewSplit(chunk, index);
        }
      }

      if (!outcome.ok) return outcome.failure;
      // Persisted the moment it is finished, never at the end: the chunk AFTER
      // this one is exactly what might fail, and that is the case this exists
      // for.
      persist(key, label, chunkDiffSha, outcome);
      chunkRecords.push({ label, record: outcome.record });
      partialChunks.push(...outcome.partials);
    }

    // Band 5 — merge into the ONE artifact the verdict gate reads, validate the
    // MERGED record against the whole initiative's criteria (each chunk was only
    // validated against its own), persist, scrub.
    const mergedChunks = mergeChunkRecords(chunkRecords, unjudgedCriteria);
    const merged: ReviewFindingsRecord = {
      ...mergedChunks,
      findings: escalateAcFindings(mergedChunks.findings, acceptanceCriteria), // forge-mfv5.1.43
      ...(scope.notReviewed.length > 0 ? { notReviewed: scope.notReviewed } : {}),
      ...(partialChunks.length > 0 ? { partialChunks } : {}),
    };
    const mergedErrors = validateReviewFindings(merged, { lenses, criteria: acceptanceCriteria, scope: 'the initiative' });
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
    emit('review.findings.authored', { ...counts, path: persisted, head_sha: headSha, chunks: chunkRecords.length, partial_chunks: partialChunks.map((p) => p.chunk) });
    return { status: 'complete', findingsPath: persisted, counts };
  } finally {
    scrub();
  }
}
