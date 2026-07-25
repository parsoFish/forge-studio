/**
 * The unifier's own work-item queue — the static UWI-1 mission (ADR 026, as
 * superseded by ADR 040).
 *
 * The unifier phase owns a queue at `<worktree>/.forge/unifier-items/UWI-<n>.md`,
 * structurally identical to the dev-loop's `.forge/work-items/` (same WorkItem
 * shape — only the id prefix `UWI-` and the directory differ). It is SEEDED
 * with one static `UWI-1 = "unify & prep the PR"` (the unifier's mission), and
 * — since ADR 040 — that is ALL it holds: review feedback compiles fix
 * work-items onto the initiative's own `.forge/work-items/` queue instead
 * (`fix-work-items.ts`), and the fix-loop drain RE-ARMS UWI-1 so each round
 * re-authors demo.json + the PR description against the fixed branch. This
 * module survives until R4-01-F4 retires the unifier node.
 */

import { join } from 'node:path';

import { worktreeDemoJsonRelPath } from './demo-paths.ts';
import {
  readWorkItemsFromDir,
  topologicalOrder,
  writeWorkItem,
  writeWorkItemStatus,
  type WorkItem,
} from './work-item.ts';

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

/**
 * The UWIs the unifier still has to run, in dependency (topological) order:
 * everything whose `status` is exactly `pending`. On a fresh cycle this is the
 * seeded `UWI-1`; on an ADR-040 fix-loop re-entry it is the RE-ARMED `UWI-1`
 * (see {@link rearmStaticUnifierItem}). `complete` UWIs are done; `failed`
 * UWIs are NOT re-run automatically (a failed mission is operator territory —
 * re-running it forever would be a retry loop).
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

  // Demo path via the SSOT (plan 2.5 / N3): the scope ceiling + prose must name
  // the artifactRoot-resolved path the composed gate checks, or the agent is
  // instructed to author the demo somewhere the gate never looks.
  const demoJsonRel = worktreeDemoJsonRelPath(worktreePath, input.initiativeId);

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
          'the project quality gate passes against branch tip, ' +
          demoJsonRel +
          ' + .forge/pr-description.md exist and are valid, every dev-WI creates[] path appears in the diff, and the local branch == origin HEAD',
      },
    ],
    files_in_scope: ['.forge/pr-description.md', demoJsonRel],
    quality_gate_cmd: [...input.qualityGateCmd],
    kind: 'packaging',
    estimated_iterations: Math.max(1, input.estimatedIterations),
    body: [
      '# UWI-1 — Unify & prep the PR',
      '',
      'The static first unifier work item. Treat the whole initiative branch as ONE PR:',
      '',
      '- Prove every dev-WI acceptance criterion against branch tip (the project quality gate).',
      '- Author `' + demoJsonRel + '` (the structured demo) and `.forge/pr-description.md` (## Why / ## What / ## How).',
      '- Integrate, do NOT re-implement — every dev WI is already committed.',
      '- Commit (`feat(' + input.initiativeId + '): unify and demo`) and push so origin == local HEAD.',
      '- Do NOT open or merge the PR — the review phase does that.',
      '',
      'Review feedback compiles fix work-items onto the dev queue (ADR 040) and re-arms this mission; you only own UWI-1 here.',
    ].join('\n'),
  };

  return writeWorkItem(uwi1, worktreePath, { workItemsDir: dir });
}

/**
 * ADR 040 — re-arm the static UWI-1 to `pending` ahead of a fix-loop re-entry,
 * so the unifier node re-authors `demo.json` + the PR description against the
 * now-fixed branch (the legacy-spine re-demo; replaces ADR-026's terminal
 * re-prep UWI). Idempotent + crash-safe: an already-pending UWI-1 or a missing
 * queue is a no-op — the next sweep simply repeats it. Returns true if UWI-1
 * was flipped to pending (or already was), false if no UWI-1 exists.
 */
export function rearmStaticUnifierItem(worktreePath: string): boolean {
  const dir = unifierItemsDir(worktreePath);
  const existing = readWorkItemsFromDir(dir).items.find((w) => w.work_item_id === 'UWI-1');
  if (!existing) return false;
  if (existing.status !== 'pending') {
    writeWorkItemStatus(join(dir, 'UWI-1.md'), 'pending');
  }
  return true;
}
