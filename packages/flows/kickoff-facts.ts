/**
 * Bead forge-mfv5.1.25 — the ONE reader of the facts `isAwaitingKickoff`
 * (`@forge/contracts`) decides on; the run model and the develop enqueue call it.
 * WIs come from EVERY dir holding any (snapshot, worktree, `_worktrees/<id>/`); an unparseable WI, a status
 * outside the enum, or path fields that fail the manifest guard count as `unreadable`, i.e. built — fails closed.
 */
import { join } from 'node:path';

import { isAwaitingKickoff, type KickoffFacts } from '@forge/contracts';
import type { InitiativeManifest } from './manifest.ts';
import { hasWorkItemFiles, rawWorkItemStatuses } from './work-item.ts';
import { isCanonicalInitiativeId } from './initiative-id.ts';
import { validateManifestPathFields } from './manifest-path-guard.ts';
import { branchHasCommittedWork } from './requeue-resume.ts';

export type KickoffSource = {
  queueDir: string;
  manifest: InitiativeManifest;
  logsRoot: string;
  forgeRoot: string;
};

function workItemStatuses(s: KickoffSource): string[] {
  const m = s.manifest;
  const dirs = [
    m.cycle_id ? join(s.logsRoot, m.cycle_id, 'work-items-snapshot') : null,
    m.worktree_path ? join(m.worktree_path, '.forge', 'work-items') : null,
    join(s.forgeRoot, '_worktrees', m.initiative_id, '.forge', 'work-items'),
  ];
  return [...new Set(dirs)].filter((d): d is string => d !== null && hasWorkItemFiles(d)).flatMap(rawWorkItemStatuses);
}

export function readKickoffFacts(s: KickoffSource): KickoffFacts {
  const m = s.manifest;
  const unsafe = !isCanonicalInitiativeId(m.initiative_id) || validateManifestPathFields(m, { forgeRoot: s.forgeRoot }).length > 0;
  if (unsafe) return { queueDir: s.queueDir, flowId: m.flow_id ?? null, workItemStatuses: ['unreadable'], branchHasCommits: () => true, resumeFrom: null, reviewRounds: 0 };
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
  return s.queueDir === 'ready-for-review' && isAwaitingKickoff(readKickoffFacts(s)); // no disk read otherwise
}
