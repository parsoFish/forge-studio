/**
 * The unifier's own work-item queue (ADR 026).
 *
 * The unifier phase owns a queue at `<worktree>/.forge/unifier-items/UWI-<n>.md`,
 * structurally identical to the dev-loop's `.forge/work-items/` (same WorkItem
 * shape, reusing parse/serialize/validate/read/write/topo verbatim — only the id
 * prefix `UWI-` and the directory differ). It is SEEDED with one static
 * `UWI-1 = "unify & prep the PR"` (the unifier's current mission). Review feedback
 * later APPENDS `UWI-2, UWI-3, …` (one per concern) to the SAME worktree, so the
 * review↔unifier loop stays in one cycle (no requeue, one cycleId).
 *
 * This module is the queue's seed + read + next-id helpers; the runUnifier loop
 * (developer-loop.ts) and the verdict handler (ui-bridge.ts) consume them.
 */

import { join } from 'node:path';

import {
  readWorkItemsFromDir,
  topologicalOrder,
  validateWorkItemSet,
  writeWorkItem,
  type AcceptanceCriterion,
  type WorkItem,
} from './work-item.ts';

/**
 * ADR 026: the review-round / total-UWI cap. The unifier has no $ ceiling
 * (CONTRACTS.md C19), so this bounds how many review concerns a single cycle
 * can absorb before the operator is told to take over (it replaces the deleted
 * `send-back-cap-exhausted` backpressure). Counts every UWI including the
 * static UWI-1 and the auto-appended terminal re-prep UWIs.
 */
export const UNIFIER_MAX_TOTAL_ITEMS = 24;

/** `<worktree>/.forge/unifier-items` — sibling of `.forge/work-items`. */
export function unifierItemsDir(worktreePath: string): string {
  return join(worktreePath, '.forge', 'unifier-items');
}

/** Read the unifier queue (same parser/skip-`_`-prefix rule as the dev queue). */
export function readUnifierItems(worktreePath: string): {
  items: WorkItem[];
  parseErrors: Record<string, string>;
} {
  return readWorkItemsFromDir(unifierItemsDir(worktreePath));
}

/** Next free `UWI-<n>` id (append-only: max existing index + 1; never renumber). */
export function nextUnifierItemId(worktreePath: string): string {
  const { items } = readUnifierItems(worktreePath);
  let max = 0;
  for (const wi of items) {
    const m = /^UWI-(\d+)$/.exec(wi.work_item_id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `UWI-${max + 1}`;
}

/**
 * The UWIs the unifier still has to run, in dependency (topological) order:
 * everything whose `status` is exactly `pending`. On a fresh cycle this is just
 * the seeded `UWI-1`; on a review drain (ADR 026) the appended `UWI-2+` plus
 * the terminal re-prep UWI. `complete` UWIs are done; `failed` UWIs are NOT
 * re-run automatically (a failed concern is operator territory — re-running it
 * forever would be a retry loop). A dependency on an already-complete UWI
 * (filtered out here) is treated as a satisfied root by `topologicalOrder`, so a
 * concern UWI that `depends_on:[UWI-1]` still runs once UWI-1 is done.
 */
export function pendingUnifierItems(worktreePath: string): WorkItem[] {
  const { items } = readUnifierItems(worktreePath);
  const pending = items.filter((w) => w.status === 'pending');
  return topologicalOrder(pending);
}

/** True if any UWI in the queue is in a `failed` state (drain must defer to the
 *  operator rather than auto-retry — see {@link pendingUnifierItems}). */
export function hasFailedUnifierItem(worktreePath: string): boolean {
  return readUnifierItems(worktreePath).items.some((w) => w.status === 'failed');
}

export type SeedStaticUnifierItemInput = {
  initiativeId: string;
  estimatedIterations: number;
  /**
   * The project quality gate the unifier runs against branch tip. Carried on
   * UWI-1 so it satisfies the WorkItem contract; at runtime the unifier wraps it
   * as gate 1 of the composed unifier gate (the other gates assert demo/PR/sync).
   */
  qualityGateCmd: string[];
};

/**
 * The static UWI-1 = "unify & prep the PR" — the unifier's current mission
 * expressed as one work item. Idempotent: if UWI-1 already exists (a re-entrant
 * cycle), it is left untouched. Returns the UWI-1 path (existing or written).
 */
export function seedStaticUnifierItem(
  worktreePath: string,
  input: SeedStaticUnifierItemInput,
): string {
  const dir = unifierItemsDir(worktreePath);
  const existing = readWorkItemsFromDir(dir).items.find((w) => w.work_item_id === 'UWI-1');
  if (existing) return join(dir, 'UWI-1.md');

  const uwi1: WorkItem = {
    work_item_id: 'UWI-1',
    initiative_id: input.initiativeId,
    status: 'pending',
    depends_on: [],
    acceptance_criteria: [
      {
        given: 'every dev work item is committed on the initiative branch',
        when: 'the unifier integrates the branch into one cohesive, self-contained PR',
        then:
          'the project quality gate passes against branch tip, demo/' +
          input.initiativeId +
          '/demo.json + .forge/pr-description.md exist and are valid, every dev-WI creates[] path appears in the diff, and the local branch == origin HEAD',
      },
    ],
    files_in_scope: ['.forge/pr-description.md', 'demo/' + input.initiativeId + '/demo.json'],
    quality_gate_cmd: [...input.qualityGateCmd],
    kind: 'packaging',
    estimated_iterations: Math.max(1, input.estimatedIterations),
    body: [
      '# UWI-1 — Unify & prep the PR',
      '',
      'The static first unifier work item. Treat the whole initiative branch as ONE PR:',
      '',
      '- Prove every dev-WI acceptance criterion against branch tip (the project quality gate).',
      '- Author `demo/' + input.initiativeId + '/demo.json` (the structured demo) and `.forge/pr-description.md` (## Why / ## What / ## How).',
      '- Integrate, do NOT re-implement — every dev WI is already committed.',
      '- Commit (`feat(' + input.initiativeId + '): unify and demo`) and push so origin == local HEAD.',
      '- Do NOT open or merge the PR — the review phase does that.',
      '',
      'Review feedback will append UWI-2+ after this; you only own UWI-1 here.',
    ].join('\n'),
  };

  return writeWorkItem(uwi1, worktreePath, { workItemsDir: dir });
}

/**
 * One review send-back, ready to become unifier work-items. The verdict form
 * collects exactly this (`rationale` + ≥1 GIVEN/WHEN/THEN AC); `kind` +
 * `qualityGateCmd` are forward-compat fields the step-7 form will populate.
 */
export type ReviewConcern = {
  rationale: string;
  acceptanceCriteria: AcceptanceCriterion[];
  /** Default `code-fix` — a behavioural concern held to dev-grade rigor. */
  kind?: 'packaging' | 'code-fix';
  /**
   * A SHARP gate that fails on the current branch until the concern is
   * addressed (the write-a-failing-test-first discipline). Absent ⇒ fall back
   * to the project gate (the suite must stay green; the dev-role prompt asks
   * the agent to add the failing test first, but enforcement is softer — the
   * operator should supply a sharp gate for true dev-grade rigor).
   */
  qualityGateCmd?: string[];
};

export type AppendReviewUnifierItemsInput = {
  worktreePath: string;
  initiativeId: string;
  concern: ReviewConcern;
  /** Fallback gate (the project `quality_gate_cmd`). Required + non-empty. */
  projectGateCmd: string[];
  /** Iteration budget stamped onto the appended UWIs. */
  estimatedIterations: number;
  /** Override the total-UWI cap (defaults to {@link UNIFIER_MAX_TOTAL_ITEMS}). */
  maxTotalItems?: number;
};

export class UnifierItemsCapError extends Error {}
export class ReviewConcernInvalidError extends Error {}

/**
 * ADR 026 — append a review send-back to the unifier's queue (the drain then
 * runs them, in one cycle). One send-back becomes ONE concern UWI carrying all
 * the form's GIVEN/WHEN/THEN ACs (`depends_on:[UWI-1]`); a `code-fix` concern
 * also gets a terminal `packaging` re-prep UWI so `demo.json` + the PR body
 * reflect the now-final branch (never approve a stale demo). Append-only ids
 * (never renumbered → stable hex id). Validates the whole set before writing —
 * a malformed payload throws (the HTTP handler returns a clean 4xx) and never
 * corrupts the queue.
 */
export function appendReviewUnifierItems(
  input: AppendReviewUnifierItemsInput,
): { appended: string[] } {
  const { worktreePath, initiativeId, concern } = input;
  const dir = unifierItemsDir(worktreePath);
  const maxTotal = input.maxTotalItems ?? UNIFIER_MAX_TOTAL_ITEMS;

  // Validate the concern's ACs (non-empty GWT) before touching the queue.
  const acs = (concern.acceptanceCriteria ?? []).filter(
    (a) => a && a.given?.trim() && a.when?.trim() && a.then?.trim(),
  );
  if (acs.length === 0) {
    throw new ReviewConcernInvalidError('a review concern needs at least one complete GIVEN/WHEN/THEN acceptance criterion');
  }
  if (!input.projectGateCmd || input.projectGateCmd.length === 0) {
    throw new ReviewConcernInvalidError('projectGateCmd is required to back a review UWI gate');
  }

  const kind: 'packaging' | 'code-fix' = concern.kind === 'packaging' ? 'packaging' : 'code-fix';
  const gateCmd = concern.qualityGateCmd && concern.qualityGateCmd.length > 0 ? concern.qualityGateCmd : input.projectGateCmd;
  const estIters = Math.max(1, input.estimatedIterations);

  // The concern UWI's scope ceiling = the union of every dev-WI's files_in_scope
  // (the initiative's touched code) ∪ the demo/PR paths, so a code-fix can reach
  // whatever the initiative built. Falls back to the demo/PR paths alone.
  const devScope = devWorkItemScopeUnion(worktreePath);
  const packagingScope = ['.forge/pr-description.md', `demo/${initiativeId}/demo.json`];
  const concernScope = Array.from(new Set([...devScope, ...packagingScope]));

  // Count existing UWIs against the cap (the concern + optional re-prep must fit).
  const existing = readWorkItemsFromDir(dir).items;
  const toAdd = kind === 'code-fix' ? 2 : 1;
  if (existing.length + toAdd > maxTotal) {
    throw new UnifierItemsCapError(
      `unifier review-UWI cap reached (${existing.length} existing + ${toAdd} > ${maxTotal}). ` +
        `Take the worktree over manually (forge review) — too many review rounds for one autonomous cycle.`,
    );
  }

  const appended: string[] = [];

  // 1. The concern UWI.
  const concernId = nextUnifierItemId(worktreePath);
  const concernUwi: WorkItem = {
    work_item_id: concernId,
    initiative_id: initiativeId,
    status: 'pending',
    depends_on: ['UWI-1'],
    acceptance_criteria: acs,
    files_in_scope: concernScope,
    quality_gate_cmd: [...gateCmd],
    kind,
    estimated_iterations: estIters,
    body: reviewConcernBody(concernId, kind, concern.rationale, acs),
  };
  validateAppend([...existing, concernUwi]);
  writeWorkItem(concernUwi, worktreePath, { workItemsDir: dir });
  appended.push(concernId);

  // 2. Terminal re-prep (packaging) UWI — only when the concern changed code;
  //    a packaging concern already re-authors the demo/PR itself.
  if (kind === 'code-fix') {
    const reprepId = nextUnifierItemId(worktreePath);
    const reprep: WorkItem = {
      work_item_id: reprepId,
      initiative_id: initiativeId,
      status: 'pending',
      depends_on: [concernId],
      acceptance_criteria: [
        {
          given: `${concernId} addressed the review concern on the branch`,
          when: 're-prepping the PR after the code fix',
          then: `demo/${initiativeId}/demo.json + .forge/pr-description.md reflect the now-final branch and the composed unifier gate passes`,
        },
      ],
      files_in_scope: packagingScope,
      quality_gate_cmd: [...input.projectGateCmd],
      kind: 'packaging',
      estimated_iterations: estIters,
      body: reprepBody(reprepId, concernId, initiativeId),
    };
    validateAppend([...existing, concernUwi, reprep]);
    writeWorkItem(reprep, worktreePath, { workItemsDir: dir });
    appended.push(reprepId);
  }

  return { appended };
}

/** Union of every dev work-item's files_in_scope (the initiative's touched code). */
function devWorkItemScopeUnion(worktreePath: string): string[] {
  const devDir = join(worktreePath, '.forge', 'work-items');
  const scope = new Set<string>();
  for (const wi of readWorkItemsFromDir(devDir).items) {
    for (const f of wi.files_in_scope) scope.add(f);
  }
  return [...scope];
}

/** Cross-check the appended set (no dup ids, no dependency cycle) before writing. */
function validateAppend(items: WorkItem[]): void {
  const { setErrors } = validateWorkItemSet(items);
  if (setErrors.length > 0) {
    throw new ReviewConcernInvalidError(`review UWI append would corrupt the queue: ${setErrors.join('; ')}`);
  }
}

function reviewConcernBody(
  id: string,
  kind: 'packaging' | 'code-fix',
  rationale: string,
  acs: AcceptanceCriterion[],
): string {
  const checklist = acs
    .map((a, i) => `- [ ] AC${i + 1}: GIVEN ${a.given.trim()} WHEN ${a.when.trim()} THEN ${a.then.trim()}`)
    .join('\n');
  return [
    `# ${id} — review concern (${kind})`,
    '',
    '> Appended from a review send-back (ADR 026). Address it on the EXISTING branch',
    '> — this is the SAME cycle, not a fresh one. Do NOT re-run prior work items.',
    '',
    '## Operator rationale',
    '',
    rationale.trim() || '_(none provided)_',
    '',
    '## Acceptance criteria to satisfy',
    '',
    checklist,
    '',
    ...(kind === 'code-fix'
      ? [
          '## How (code-fix discipline)',
          '',
          '1. **Write a failing test FIRST** that encodes the acceptance criteria above (red).',
          '2. Make the minimal code change so it passes (green); keep the rest of the suite green.',
          '3. Commit. The terminal re-prep UWI re-authors the demo + PR after you.',
        ]
      : [
          '## How (packaging)',
          '',
          'Re-author the demo / PR description to satisfy the criteria. Do NOT re-implement code.',
        ]),
  ].join('\n');
}

function reprepBody(id: string, concernId: string, initiativeId: string): string {
  return [
    `# ${id} — terminal re-prep (packaging)`,
    '',
    `> Auto-appended after ${concernId} (ADR 026). The code fix may have changed`,
    '> behaviour, so the demo + PR description must reflect the FINAL branch.',
    '',
    `- Re-author \`demo/${initiativeId}/demo.json\` (and re-render DEMO.md/DEMO.html).`,
    '- Update `.forge/pr-description.md` Why/What/How to match the now-final diff.',
    '- Do NOT re-implement code — integrate + re-prove the composed unifier gate.',
  ].join('\n');
}
