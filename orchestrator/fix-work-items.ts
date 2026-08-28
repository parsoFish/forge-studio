/**
 * Fix work-items — the send-back loop's compiler + queue predicates (ADR 040).
 *
 * A review send-back (and, later, R4-10's demo-miss / merge-gate loops) compiles
 * operator feedback into ORDINARY work items on the initiative's own
 * `.forge/work-items/` queue, marked with `origin` so the loop machinery can
 * tell them from PM-authored WIs. The develop agent is the single fix executor
 * (R4-10-F1): the fix-loop drain re-enters the cycle with
 * `resume_from: 'develop'`, prior WIs fast-exit via the iter-0 already-complete
 * shortcut, and the fix WIs build.
 *
 * This module owns: compile-with-validation (a malformed concern never corrupts
 * the queue), the two config caps (rounds / total fix WIs — either exhausting
 * parks the initiative needs-operator), the queue predicates the finalize/drain
 * sweeps arbitrate on, and the loud cap-exhausted park marker.
 */

import { join } from 'node:path';

import { guardedFile, guardedWriteFile } from '../cli/studio-path-guard.ts';
import { worktreeDemoJsonRelPath } from './demo-paths.ts';
import {
  devWorkItemIdStem,
  gateIsShellPipeline,
  readWorkItemsFromDir,
  topologicalOrder,
  validateWorkItemSet,
  writeWorkItem,
  type AcceptanceCriterion,
  type FixWiOrigin,
  type WorkItem,
} from './work-item.ts';

/** `<worktree>/.forge/work-items` — the initiative's own queue (shared with PM WIs). */
export function devWorkItemsDir(worktreePath: string): string {
  return join(worktreePath, '.forge', 'work-items');
}

/**
 * `.forge/REVIEW-CAP-EXHAUSTED.md` — the greppable park marker (the
 * `POST-MERGE-CI-FAILED.md` pattern). Present ⇒ a send-back was rejected on a
 * cap and the initiative is parked needs-operator; the drain reports
 * needs-operator for a marker-bearing manifest without re-notifying every sweep.
 */
export const REVIEW_CAP_EXHAUSTED_FILENAME = 'REVIEW-CAP-EXHAUSTED.md';

export function reviewCapExhaustedPath(worktreePath: string): string {
  return join(worktreePath, '.forge', REVIEW_CAP_EXHAUSTED_FILENAME);
}

/**
 * `worktreePath` is the dev-loop agent's own checkout — a fixed root this
 * function receives, never a caller-composed string that folds an untrusted
 * value INTO the root. Routed through `guardedFile`'s `'read'` mode (the
 * `guardedReadFile` sibling, minus the redundant content read this predicate
 * doesn't need) so a `.forge` an agent planted as a symlink is refused the
 * same way the writer below refuses it, rather than this existence probe
 * following the symlink out of the worktree (finding 3, M0-A fix round 1).
 */
export function hasReviewCapExhaustedMarker(worktreePath: string): boolean {
  return guardedFile(worktreePath, ['.forge', REVIEW_CAP_EXHAUSTED_FILENAME], 'read') !== null;
}

/**
 * `.forge` is inside the dev-loop agent's own checkout — an agent that plants
 * it as a symlink would otherwise redirect this write outside the worktree
 * (an arbitrary-file-overwrite primitive). Routed through `guardedWriteFile`
 * (`cli/studio-path-guard.ts`) with the FIXED filename as its own `segments[]`
 * element — never folded into the `root` argument, which would bypass the
 * guard's per-segment identity check entirely (see that module's own CONTRACT
 * doc comment). `worktreePath` is the trusted root; `.forge` and the filename
 * are fixed literals, never request-derived. A rejected write (root contains a
 * symlinked `.forge`) fails closed — no marker is written, matching every
 * other best-effort caller of this function (finding 3, M0-A fix round 1).
 */
export function writeReviewCapExhaustedMarker(worktreePath: string, detail: string): void {
  guardedWriteFile(
    worktreePath,
    ['.forge', REVIEW_CAP_EXHAUSTED_FILENAME],
    [
      '# Review fix-loop cap exhausted (ADR 040)',
      '',
      detail.trim(),
      '',
      'The send-back was REJECTED and the initiative is parked needs-operator.',
      'Take the worktree over manually, or raise the caps in `forge.config.json`',
      '(`review.maxSendBackRounds` / `review.maxTotalFixWorkItems`) and re-submit.',
      'Delete this file after taking action — the fix-loop drain skips while it exists.',
    ].join('\n'),
  );
}

/**
 * `.forge/MERGE-GATE-CONFIG-ERROR.md` — the greppable park marker for a merge
 * gate that could not even read the project's `.forge/project.json`
 * (`runMergeBoundaryGate`'s `failedGate: 'config'` result, M0-A task 2).
 * Present ⇒ the merge-boundary gate cannot be evaluated for this initiative and
 * it is parked needs-operator; no gate-fix work item is ever compiled for this
 * case — a dev agent cannot fix the operator's own project config, so
 * queuing one would just burn iterations on a criterion that can never pass.
 */
export const MERGE_GATE_CONFIG_ERROR_FILENAME = 'MERGE-GATE-CONFIG-ERROR.md';

export function mergeGateConfigErrorPath(worktreePath: string): string {
  return join(worktreePath, '.forge', MERGE_GATE_CONFIG_ERROR_FILENAME);
}

/**
 * See `hasReviewCapExhaustedMarker`'s doc comment — same guard, same reason
 * (finding 3, M0-A fix round 1): a plain `existsSync(join(...))` follows a
 * symlinked `.forge` right out of the worktree.
 */
export function hasMergeGateConfigErrorMarker(worktreePath: string): boolean {
  return guardedFile(worktreePath, ['.forge', MERGE_GATE_CONFIG_ERROR_FILENAME], 'read') !== null;
}

/**
 * See `writeReviewCapExhaustedMarker`'s doc comment — same guard, same reason
 * (finding 3, M0-A fix round 1): this writer copied the unguarded
 * `mkdirSync`/`writeFileSync` pattern from that one, so it carried the same
 * arbitrary-file-overwrite primitive (a symlinked `.forge` redirects the
 * write outside the worktree) and gets the identical fix.
 */
export function writeMergeGateConfigErrorMarker(worktreePath: string, reason: string): void {
  guardedWriteFile(
    worktreePath,
    ['.forge', MERGE_GATE_CONFIG_ERROR_FILENAME],
    [
      '# Merge-boundary gate could not read the project config',
      '',
      reason.trim(),
      '',
      'The merge-boundary gate cannot be evaluated while the project config fails to',
      'load, so the cycle is parked needs-operator instead of reporting a green gate.',
      'No gate-fix work item was compiled — a dev agent cannot fix the operator\'s own',
      '`.forge/project.json`.',
      'Fix `.forge/project.json` on the project repo (see the reason above), then',
      're-submit the initiative.',
      'Delete this file after taking action — the fix-loop drain skips while it exists.',
    ].join('\n'),
  );
}

/**
 * Default iteration budget stamped on a compiled fix WI when the caller names
 * none (the review-fix path passes the unifier cap; the demo-fix path uses
 * this). A code-fix is a scoped remediation, not a fresh initiative — a handful
 * of iterations, not a whole build budget.
 */
export const DEFAULT_FIX_WI_ITERATIONS = 15;

/**
 * One post-develop fix concern, ready to compile into a work item. The verdict
 * form supplies the `review-fix` shape today; R4-10-F1 maps `DemoFixProposal`
 * (`demo-fix`) and gate-failure remediation (`gate-fix`) onto the same type.
 */
export type FixConcernSource = {
  origin: FixWiOrigin;
  rationale: string;
  acceptanceCriteria: AcceptanceCriterion[];
  /**
   * `code-fix` (default) keeps full dev-loop rigor. `packaging` compiles with
   * `behavior_preserving: true` (relaxes the fail-first-test gate) — the
   * classification maps to that marker, never to the UWI-only `kind` field.
   */
  concernKind?: 'packaging' | 'code-fix';
  /** A SHARP gate that fails until the concern is addressed. Absent ⇒ project gate. */
  qualityGateCmd?: string[];
  /** Explicit scope (the demo-fix path); absent ⇒ union of dev-WI scopes + demo/PR. */
  filesInScope?: string[];
};

export type FixLoopCaps = {
  maxSendBackRounds: number;
  maxTotalFixWorkItems: number;
};

export type CompileFixWorkItemsInput = {
  worktreePath: string;
  initiativeId: string;
  source: FixConcernSource;
  /** Fallback gate (the project `quality_gate_cmd`). Required + non-empty. */
  projectGateCmd: string[];
  /** Iteration budget stamped onto the compiled WI. */
  estimatedIterations: number;
  /** Config-resolved caps (ADR 040 — `resolveReviewLoopCaps`). */
  caps: FixLoopCaps;
  /** The round this compile belongs to (the verdict handler's `review_rounds + 1`). */
  currentRound: number;
};

/** Thrown when either fix-loop cap is exhausted (HTTP 409 + park needs-operator). */
export class FixLoopCapError extends Error {}
/** Thrown on a malformed concern (HTTP 400); the queue is never touched. */
export class FixConcernInvalidError extends Error {}

/**
 * Next free `WI-<n>` id over the initiative queue (append-only; never renumber).
 *
 * Counts from the numeric STEM, so a split sibling is visible here: with
 * `WI-4a` / `WI-4b` on disk the next id is `WI-5`, not a `WI-4` sitting
 * confusingly beside them. `devWorkItemIdStem` is the exported SSOT
 * (orchestrator/work-item.ts) — this used to carry its own narrower `/^WI-(\d+)$/`.
 */
export function nextDevWorkItemId(worktreePath: string): string {
  const { items } = readWorkItemsFromDir(devWorkItemsDir(worktreePath));
  let max = 0;
  for (const wi of items) {
    const stem = devWorkItemIdStem(wi.work_item_id);
    if (stem !== null) max = Math.max(max, stem);
  }
  return `WI-${max + 1}`;
}

/** Every WI compiled by a fix loop (any `origin`), regardless of status. */
export function fixWorkItems(worktreePath: string): WorkItem[] {
  const { items } = readWorkItemsFromDir(devWorkItemsDir(worktreePath));
  return items.filter((w) => w.origin !== undefined);
}

/**
 * The fix WIs the loop still owes work on, in dependency order: `pending`
 * (not yet built) and `in-progress` (a crashed run mid-build — the re-entered
 * dev-loop re-runs it). `complete` are done; `failed` fix WIs are operator
 * territory (see {@link hasFailedFixWorkItem}) — never auto-retried.
 * The finalize/drain sweeps arbitrate on this predicate (ADR 040 mutex).
 */
export function pendingFixWorkItems(worktreePath: string): WorkItem[] {
  const open = fixWorkItems(worktreePath).filter(
    (w) => w.status === 'pending' || w.status === 'in-progress',
  );
  return topologicalOrder(open);
}

/** True if any fix WI is `failed` — the drain parks needs-operator, never retries. */
export function hasFailedFixWorkItem(worktreePath: string): boolean {
  return fixWorkItems(worktreePath).some((w) => w.status === 'failed');
}

/** Total fix WIs ever compiled onto this queue (the `maxTotalFixWorkItems` count). */
export function fixWorkItemCount(worktreePath: string): number {
  return fixWorkItems(worktreePath).length;
}

/**
 * ADR 040 — compile one fix concern into a work item on the initiative's own
 * queue. Validates everything BEFORE writing (a malformed payload throws and
 * never corrupts the queue), enforces both caps, appends `WI-<max+1>` with
 * `origin` set and `depends_on: []` (prior WIs are complete — satisfied roots).
 * No terminal re-prep WI: the fix-loop drain re-arms the static UWI-1, whose
 * re-authorship of demo.json + the PR description is the legacy-spine re-demo.
 */
export function compileFixWorkItems(input: CompileFixWorkItemsInput): { appended: string[] } {
  const { worktreePath, initiativeId, source, caps } = input;
  const dir = devWorkItemsDir(worktreePath);

  // Validate the concern before touching the queue.
  const acs = (source.acceptanceCriteria ?? []).filter(
    (a) => a && a.given?.trim() && a.when?.trim() && a.then?.trim(),
  );
  if (acs.length === 0) {
    throw new FixConcernInvalidError(
      'a fix concern needs at least one complete GIVEN/WHEN/THEN acceptance criterion',
    );
  }
  if (!input.projectGateCmd || input.projectGateCmd.length === 0) {
    throw new FixConcernInvalidError('projectGateCmd is required to back a fix work-item gate');
  }
  // H1 parity with the superseded UWI append: a send-back must not inject a
  // `bash -c "… | …"` gate (RCE via shell pipeline/chain).
  if (source.qualityGateCmd !== undefined) {
    if (!source.qualityGateCmd.every((s) => typeof s === 'string' && s.length > 0)) {
      throw new FixConcernInvalidError('qualityGateCmd entries must be non-empty strings');
    }
    if (gateIsShellPipeline(source.qualityGateCmd)) {
      throw new FixConcernInvalidError(
        'qualityGateCmd must be ONE runnable command — not a shell pipeline or chain (bash -c "… | …", &&, ;)',
      );
    }
  }

  // Caps: either exhausting rejects (409) — the caller then parks loudly.
  if (input.currentRound > caps.maxSendBackRounds) {
    throw new FixLoopCapError(
      `send-back round cap reached (round ${input.currentRound} > ${caps.maxSendBackRounds}). ` +
        `The initiative is parked needs-operator — take the worktree over manually or raise review.maxSendBackRounds.`,
    );
  }
  const existingFixCount = fixWorkItemCount(worktreePath);
  if (existingFixCount + 1 > caps.maxTotalFixWorkItems) {
    throw new FixLoopCapError(
      `total fix work-item cap reached (${existingFixCount} existing + 1 > ${caps.maxTotalFixWorkItems}). ` +
        `The initiative is parked needs-operator — take the worktree over manually or raise review.maxTotalFixWorkItems.`,
    );
  }

  const concernKind: 'packaging' | 'code-fix' =
    source.concernKind === 'packaging' ? 'packaging' : 'code-fix';
  const gateCmd =
    source.qualityGateCmd && source.qualityGateCmd.length > 0
      ? source.qualityGateCmd
      : input.projectGateCmd;

  // Scope: the concern's own scope when supplied (the demo-fix path), else the
  // union of every dev-WI's files_in_scope ∪ the demo/PR artifacts — a code fix
  // can reach whatever the initiative built.
  const demoJsonRel = worktreeDemoJsonRelPath(worktreePath, initiativeId);
  const packagingScope = ['.forge/pr-description.md', demoJsonRel];
  const scope =
    source.filesInScope && source.filesInScope.length > 0
      ? [...source.filesInScope]
      : Array.from(new Set([...devWorkItemScopeUnion(worktreePath), ...packagingScope]));

  const existing = readWorkItemsFromDir(dir).items;
  const fixId = nextDevWorkItemId(worktreePath);
  const fixWi: WorkItem = {
    work_item_id: fixId,
    initiative_id: initiativeId,
    status: 'pending',
    depends_on: [],
    acceptance_criteria: acs,
    files_in_scope: scope,
    quality_gate_cmd: [...gateCmd],
    estimated_iterations: Math.max(1, input.estimatedIterations),
    origin: source.origin,
    ...(concernKind === 'packaging' ? { behavior_preserving: true } : {}),
    body: fixConcernBody(fixId, source.origin, concernKind, source.rationale, acs),
  };
  const { setErrors } = validateWorkItemSet([...existing, fixWi]);
  if (setErrors.length > 0) {
    throw new FixConcernInvalidError(
      `fix work-item append would corrupt the queue: ${setErrors.join('; ')}`,
    );
  }
  writeWorkItem(fixWi, worktreePath, { workItemsDir: dir });
  return { appended: [fixId] };
}

/** Union of every dev work-item's files_in_scope (the initiative's touched code). */
function devWorkItemScopeUnion(worktreePath: string): string[] {
  const scope = new Set<string>();
  for (const wi of readWorkItemsFromDir(devWorkItemsDir(worktreePath)).items) {
    for (const f of wi.files_in_scope) scope.add(f);
  }
  return [...scope];
}

function fixConcernBody(
  id: string,
  origin: FixWiOrigin,
  concernKind: 'packaging' | 'code-fix',
  rationale: string,
  acs: AcceptanceCriterion[],
): string {
  const checklist = acs
    .map((a, i) => `- [ ] AC${i + 1}: GIVEN ${a.given.trim()} WHEN ${a.when.trim()} THEN ${a.then.trim()}`)
    .join('\n');
  return [
    `# ${id} — ${origin} concern (${concernKind})`,
    '',
    '> Compiled from a post-develop fix loop (ADR 040). Address it on the EXISTING',
    '> branch — this is the SAME cycle, not a fresh one. Prior work items are',
    '> already complete; do NOT re-implement them.',
    '',
    '## Rationale',
    '',
    rationale.trim() || '_(none provided)_',
    '',
    '## Acceptance criteria to satisfy',
    '',
    checklist,
    '',
    ...(concernKind === 'code-fix'
      ? [
          '## How (code-fix discipline)',
          '',
          '1. **Write a failing test FIRST** that encodes the acceptance criteria above (red).',
          '2. Make the minimal code change so it passes (green); keep the rest of the suite green.',
          '3. Commit. The re-armed unify/prep pass re-authors the demo + PR after you.',
        ]
      : [
          '## How (packaging)',
          '',
          'Satisfy the criteria without behavioural code changes (demo / docs / PR',
          'wording). `behavior_preserving: true` relaxes the fail-first-test gate.',
        ]),
  ].join('\n');
}
