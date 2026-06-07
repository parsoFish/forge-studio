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
  writeWorkItem,
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
