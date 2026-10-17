/**
 * Fix work-items — the send-back loop's compiler + queue predicates (D-20).
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

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { guardedFile, guardedWriteFile } from '@forge/kernel';
import { worktreeDemoJsonRelPath } from './demo-paths.ts';
import { acLabel, missingCheckErrors } from './acceptance-check.ts';
import {
  DEV_WORK_ITEM_ID_PATTERN,
  devWorkItemIdStem,
  gateIsShellPipeline,
  readWorkItemsFromDir,
  topologicalOrder,
  validateWorkItemSet,
  writeWorkItem,
  writeWorkItemStatus,
  type AcceptanceCriterion,
  type FixWiOrigin,
  type WorkItem,
  FIX_WI_ORIGINS,
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
      '# Review fix-loop cap exhausted (D-20)',
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
  /** forge-mfv5.1.43: an operator-typed concern — every criterion must carry its falsifying check. */
  requireChecks?: boolean;
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
  /** Config-resolved caps (D-20 — `resolveReviewLoopCaps`). */
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
 * (packages/flows/work-item.ts) — this used to carry its own narrower `/^WI-(\d+)$/`.
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
 * territory (see {@link failedFixWorkItemIds}) — never auto-retried.
 * The finalize/drain sweeps arbitrate on this predicate (D-20 mutex).
 */
export function pendingFixWorkItems(worktreePath: string): WorkItem[] {
  const open = fixWorkItems(worktreePath).filter(
    (w) => w.status === 'pending' || w.status === 'in-progress',
  );
  return topologicalOrder(open);
}

/**
 * forge-mfv5.1.27 — `pendingFixWorkItems` that never throws (a dependency cycle,
 * ENOTDIR) and never follows a symlinked `.forge`/`work-items` (the path guard).
 */
export function readPendingFixWorkItems(worktreePath: string): WorkItem[] | { unreadable: string } {
  try {
    if (guardedFile(worktreePath, ['.forge', 'work-items'], 'readdir') !== null) return pendingFixWorkItems(worktreePath);
    return existsSync(devWorkItemsDir(worktreePath)) ? { unreadable: 'the work-items dir failed the path guard (a symlink is never followed)' } : [];
  } catch (err) { return { unreadable: err instanceof Error ? err.message : String(err) }; }
}

/**
 * forge-mfv5.1.57 (D-20): a failed fix WI below the newest fix WI on the queue (by numeric stem) is SUPERSEDED by it — the
 * operator's later send-back replaced it. Derived from the queue alone; the newest fix WI, failed or not, is never superseded.
 */
export function supersededFixWorkItems(worktreePath: string): { superseded: string[]; by: string | null } {
  return supersededFixWorkItemsIn(fixWorkItems(worktreePath));
}

/** {@link supersededFixWorkItems} over an already-read WI set (the dev loop's); non-fix WIs are ignored. */
export function supersededFixWorkItemsIn(items: readonly WorkItem[]): { superseded: string[]; by: string | null } {
  const fixItems = items.filter((w) => w.origin !== undefined);
  const stem = (w: WorkItem): number => devWorkItemIdStem(w.work_item_id) ?? -1;
  const newest = fixItems.reduce<WorkItem | null>((top, w) => (top === null || stem(w) > stem(top) ? w : top), null);
  if (newest === null) return { superseded: [], by: null };
  const superseded = fixItems.filter((w) => w.status === 'failed' && stem(w) < stem(newest)).sort((a, b) => stem(a) - stem(b)).map((w) => w.work_item_id);
  return { superseded, by: superseded.length > 0 ? newest.work_item_id : null };
}

/** The fix WIs no later send-back replaced — the ones the drain, Requeue and the dev loop still answer for. */
function liveFixWorkItems(worktreePath: string): WorkItem[] {
  const items = fixWorkItems(worktreePath);
  const { superseded } = supersededFixWorkItemsIn(items);
  return items.filter((w) => !superseded.includes(w.work_item_id));
}

/** forge-mfv5.1.56 (D-06): the failed fix WIs a halted round names — a Requeue re-arms them (a kept branch resumes at its tip); never a superseded one. */
export function resumableFixWorkItems(worktreePath: string, haltedIds: readonly string[]): WorkItem[] {
  return liveFixWorkItems(worktreePath).filter((w) => w.status === 'failed' && haltedIds.includes(w.work_item_id));
}

/** forge-mfv5.1.56: the Requeue of a halted round puts each of its failed fix WIs back to `pending` (`kept_branch` stays); returns their ids. */
export function rearmResumableFixWorkItems(worktreePath: string, haltedIds: readonly string[]): string[] {
  const items = resumableFixWorkItems(worktreePath, haltedIds);
  const bad = items.find((w) => !DEV_WORK_ITEM_ID_PATTERN.test(w.work_item_id));
  if (bad) throw new Error(`requeue: fix work item id ${JSON.stringify(bad.work_item_id)} is not a work-item id — refusing to re-arm it`);
  for (const w of items) writeWorkItemStatus(join(devWorkItemsDir(worktreePath), `${w.work_item_id}.md`), 'pending');
  return items.map((w) => w.work_item_id);
}

/** The failed fix WIs no later send-back superseded — the drain parks needs-operator on them, never retries. */
export function failedFixWorkItemIds(worktreePath: string): string[] {
  return liveFixWorkItems(worktreePath).filter((w) => w.status === 'failed').map((w) => w.work_item_id);
}

/** Total fix WIs ever compiled onto this queue (the `maxTotalFixWorkItems` count). */
export function fixWorkItemCount(worktreePath: string): number {
  return fixWorkItems(worktreePath).length;
}

/**
 * D-20 — compile one fix concern into a work item on the initiative's own
 * queue. Validates everything BEFORE writing (a malformed payload throws and
 * never corrupts the queue), enforces both caps, appends `WI-<max+1>` with
 * `origin` set and `depends_on: []` (prior WIs are complete — satisfied roots).
 * No terminal re-prep WI: the fix-loop drain re-arms the static UWI-1, whose
 * re-authorship of demo.json + the PR description is the legacy-spine re-demo.
 */
export function compileFixWorkItems(input: CompileFixWorkItemsInput): { appended: string[]; workItem: WorkItem; supersedes: string[] } {
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
  const missing = source.requireChecks === true ? missingCheckErrors(acs) : [];
  if (missing.length > 0) throw new FixConcernInvalidError(missing.join('; '));
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

  const gateCmd =
    source.qualityGateCmd && source.qualityGateCmd.length > 0
      ? source.qualityGateCmd
      : input.projectGateCmd;
  const existing = readWorkItemsFromDir(dir).items;
  const fixId = nextDevWorkItemId(worktreePath);
  const fixWi = buildFixWorkItem({ worktreePath, initiativeId, id: fixId, source, acceptanceCriteria: acs, gateCmd, estimatedIterations: input.estimatedIterations, existing });
  const { perItem, setErrors } = validateWorkItemSet([...existing, fixWi]);
  const errors = [...(perItem[fixId] ?? []), ...setErrors];
  if (errors.length > 0) {
    throw new FixConcernInvalidError(
      `fix work-item append would corrupt the queue: ${errors.join('; ')}`,
    );
  }
  writeWorkItem(fixWi, worktreePath, { workItemsDir: dir });
  return { appended: [fixId], workItem: fixWi, supersedes: supersededFixWorkItemsIn([...existing, fixWi]).superseded };
}

/** The ONE fix work-item builder (D-20): compile appends with it; a develop resume re-mints a send-back's item with it (forge-mfv5.1.47). */
export function buildFixWorkItem(o: { worktreePath: string; initiativeId: string; id: string; source: FixConcernSource; acceptanceCriteria: AcceptanceCriterion[]; gateCmd: string[]; estimatedIterations: number; existing: WorkItem[] }): WorkItem {
  const { source, acceptanceCriteria: acs } = o;
  const concernKind: 'packaging' | 'code-fix' = source.concernKind === 'packaging' ? 'packaging' : 'code-fix';
  // Scope: the concern's own when supplied (the demo-fix path), else the union of every dev-WI's
  // files_in_scope ∪ the demo/PR artifacts — a code fix can reach whatever the initiative built.
  const scope = source.filesInScope && source.filesInScope.length > 0
    ? [...source.filesInScope]
    : Array.from(new Set([...o.existing.flatMap((w) => w.files_in_scope), '.forge/pr-description.md', worktreeDemoJsonRelPath(o.worktreePath, o.initiativeId)]));
  return {
    work_item_id: o.id,
    initiative_id: o.initiativeId,
    status: 'pending',
    depends_on: [],
    acceptance_criteria: acs,
    files_in_scope: scope,
    quality_gate_cmd: [...o.gateCmd],
    estimated_iterations: Math.max(1, o.estimatedIterations),
    origin: source.origin,
    ...(concernKind === 'packaging' ? { behavior_preserving: true } : {}),
    body: fixConcernBody(o.id, source.origin, concernKind, source.rationale, acs),
  };
}

const strings = (v: unknown): string[] | null => (Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === 'string' && s.length > 0) ? (v as string[]) : null);

/** forge-mfv5.1.47: re-mint the fix items one `reviewer.verdict.send-back` event appended (those `want` keeps and `existing` lacks) from its typed fields. */
export function remintSendBackItems(m: Record<string, unknown>, ctx: { worktreePath: string; initiativeId: string; existing: WorkItem[]; want: (id: string) => boolean }): WorkItem[] | { refused: string } {
  const ids = strings(m.appended_work_items);
  const acs = Array.isArray(m.acceptance_criteria) && m.acceptance_criteria.length > 0 ? (m.acceptance_criteria as AcceptanceCriterion[]) : null;
  const origin = FIX_WI_ORIGINS.includes(m.origin as FixWiOrigin) ? (m.origin as FixWiOrigin) : null;
  if (ids === null || acs === null || origin === null) return { refused: 'a send-back event lacks its appended ids, criteria or origin' };
  const gateCmd = strings(m.work_item_gate_cmd) ?? strings(m.quality_gate_cmd); // the gate the item got (recorded since forge-mfv5.1.47), else the concern's own
  const estimatedIterations = typeof m.estimated_iterations === 'number' && m.estimated_iterations > 0 ? m.estimated_iterations : DEFAULT_FIX_WI_ITERATIONS;
  const source: FixConcernSource = { origin, rationale: typeof m.rationale === 'string' ? m.rationale : '', acceptanceCriteria: acs, concernKind: m.concern_kind === 'packaging' ? 'packaging' : 'code-fix', filesInScope: strings(m.files_in_scope) ?? undefined };
  const out: WorkItem[] = [];
  for (const id of ids.filter((x) => ctx.want(x) && !ctx.existing.some((w) => w.work_item_id === x))) {
    if (gateCmd === null) return { refused: `${id}: the send-back event carries no quality_gate_cmd — it cannot be re-minted exactly` };
    out.push(buildFixWorkItem({ worktreePath: ctx.worktreePath, initiativeId: ctx.initiativeId, id, source, acceptanceCriteria: acs, gateCmd, estimatedIterations, existing: [...ctx.existing, ...out] }));
  }
  return out;
}

function fixConcernBody(
  id: string,
  origin: FixWiOrigin,
  concernKind: 'packaging' | 'code-fix',
  rationale: string,
  acs: AcceptanceCriterion[],
): string {
  const checklist = acs
    .map((a, i) => `- [ ] ${acLabel(a, i)}: GIVEN ${a.given.trim()} WHEN ${a.when.trim()} THEN ${a.then.trim()}`)
    .join('\n');
  return [
    `# ${id} — ${origin} concern (${concernKind})`,
    '',
    '> Compiled from a post-develop fix loop (D-20). Address it on the EXISTING',
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
          ...(acs.some((a) => a.check) ? ['   Each criterion carries a falsifying check; forge runs every one at close and ticks its box — never tick them yourself.'] : []),
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
