/**
 * Bead forge-mfv5.1.25 — gathers the facts `isAwaitingKickoff`
 * (`@forge/contracts`) decides on, from disk. The bridge roadmap, the run
 * model and the develop enqueue all call this one reader, so the Kickoff gate
 * has one derivation and one fact source.
 *
 * Work items come from the first location holding WI files, the same order the
 * decomposition evidence uses: the cycle's `work-items-snapshot`, the
 * manifest's worktree, then the forge-managed `_worktrees/<id>/`. A WI that
 * fails to parse counts as `unreadable`, which is "built": the gate fails closed.
 */
import { join } from 'node:path';

import { isAwaitingKickoff, kickoffBuiltReason, type KickoffFacts } from '@forge/contracts';
import type { InitiativeManifest } from './manifest.ts';
import { hasWorkItemFiles, readWorkItemsFromDir } from './work-item.ts';
import { branchHasCommittedWork } from './requeue-resume.ts';

export type KickoffSource = {
  queueDir: string;
  manifest: InitiativeManifest;
  /** `_logs` root holding `<cycle_id>/work-items-snapshot`. */
  logsRoot: string;
  /** Forge root holding `_worktrees/`. */
  forgeRoot: string;
};

function workItemStatuses(s: KickoffSource): string[] {
  const m = s.manifest;
  const dirs = [
    m.cycle_id ? join(s.logsRoot, m.cycle_id, 'work-items-snapshot') : null,
    m.worktree_path ? join(m.worktree_path, '.forge', 'work-items') : null,
    join(s.forgeRoot, '_worktrees', m.initiative_id, '.forge', 'work-items'),
  ];
  const dir = dirs.find((d): d is string => d !== null && hasWorkItemFiles(d));
  if (dir === undefined) return [];
  const { items, parseErrors } = readWorkItemsFromDir(dir);
  return [...items.map((w) => w.status), ...Object.keys(parseErrors).map(() => 'unreadable')];
}

export function readKickoffFacts(s: KickoffSource): KickoffFacts {
  const m = s.manifest;
  return {
    queueDir: s.queueDir,
    flowId: m.flow_id ?? null,
    workItemStatuses: workItemStatuses(s),
    branchHasCommits: () => branchHasCommittedWork(m.project_repo_path, `forge/${m.initiative_id}`),
    resumeFrom: m.resume_from ?? null,
    reviewRounds: m.review_rounds ?? 0,
  };
}

export function manifestAwaitsKickoff(s: KickoffSource): boolean {
  // Cheap placement facts first, so a non-candidate never reads WIs or runs git.
  if (s.queueDir !== 'ready-for-review') return false;
  return isAwaitingKickoff(readKickoffFacts(s));
}

export { kickoffBuiltReason };
