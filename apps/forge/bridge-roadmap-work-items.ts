/**
 * bridge-roadmap-work-items — the roadmap's work-item read, carved out of
 * `bridge-studio.ts` (forge-nk1y.32; the readers moved verbatim). Reads an
 * initiative's WI-*.md from the cycle snapshot or the live worktree, and at the
 * Kickoff gate adds each kickoff-added work item's editable fields
 * (`kickoffAddedWorkItemFields`, `@forge/flows`) for Studio's edit prefill.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { compareWorkItemIds } from '@forge/contracts';
import { kickoffAddedWorkItemFields, parseWorkItem, WORK_ITEM_FILE_PATTERN } from '@forge/flows';
import type { KickoffWorkItemFields, WorkItem } from '@forge/flows';

export type RoadmapWorkItem = {
  id: string;
  title: string;
  dependsOn: string[];
  /**
   * W6-RV-1: the WI's own status (`WorkItem['status']`, packages/flows/work-item.ts),
   * threaded through from `parseWorkItem` rather than discarded — feeds the
   * roadmap card's "done/total" micro-badge. Optional so a read that predates
   * this field (or a snapshot with no status) never fabricates one.
   */
  status?: WorkItem['status'];
  /**
   * forge-nk1y.32: served only at the Kickoff gate, for a work item ADDED
   * there — its editable fields, Studio's edit prefill.
   */
  kickoff?: KickoffWorkItemFields;
};

export type RoadmapRoots = { forgeRoot: string; logsRoot: string };

/**
 * The roadmap's work items for one initiative. `atGate` (awaiting kickoff):
 * each work item added at the gate also carries its editable fields.
 */
export function roadmapWorkItems(
  initId: string,
  cycleId: string | null,
  roots: RoadmapRoots,
  opts: { atGate: boolean },
): RoadmapWorkItem[] {
  const items = readWorkItemsForInitiative(initId, cycleId, roots.forgeRoot, roots.logsRoot);
  if (!opts.atGate) return items;
  const fields = kickoffAddedWorkItemFields({ ...roots, initiativeId: initId, cycleId });
  return items.map((w) => (fields[w.id] ? { ...w, kickoff: fields[w.id] } : w));
}

/**
 * Read work items for an initiative, independent of its queue status. Tries
 * the work-items-snapshot in `_logs/<cycleId>/` first (reliable for
 * done/in-flight); falls back to the live worktree spec if the snapshot
 * isn't present yet. Always returns an array — `[]` (never `undefined`)
 * when nothing is found, so callers decide what an empty result means.
 */
function readWorkItemsForInitiative(
  initId: string,
  cycleId: string | null,
  forgeRoot: string,
  logsRoot: string,
): RoadmapWorkItem[] {
  const logsRootAbs = resolve(logsRoot);
  const forgeRootAbs = resolve(forgeRoot);

  // 1. Snapshot path (post-PM, reliable for done cycles).
  if (cycleId) {
    const snapshotDir = join(logsRootAbs, cycleId, 'work-items-snapshot');
    const items = tryReadWorkItemDir(snapshotDir);
    if (items !== null) return items;
  }
  // 2. Also try discovering the cycleId from logs dir if not stamped on manifest.
  if (!cycleId) {
    const discovered = discoverCycleIdFromLogs(logsRootAbs, initId);
    if (discovered) {
      const snapshotDir = join(logsRootAbs, discovered, 'work-items-snapshot');
      const items = tryReadWorkItemDir(snapshotDir);
      if (items !== null) return items;
    }
  }
  // 3. Live worktree path (in-flight cycle, PM just ran).
  const liveDir = join(forgeRootAbs, '_worktrees', initId, '.forge', 'work-items');
  const items = tryReadWorkItemDir(liveDir);
  return items ?? [];
}

/** Try to read WI-*.md files from a directory; returns null if dir absent. */
function tryReadWorkItemDir(dir: string): RoadmapWorkItem[] | null {
  if (!existsSync(dir)) return null;
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => WORK_ITEM_FILE_PATTERN.test(f)); // SSOT: packages/flows/work-item.ts
  } catch {
    return null;
  }
  if (files.length === 0) return null;
  const items: RoadmapWorkItem[] = [];
  for (const file of files) {
    try {
      const raw = readFileSync(join(dir, file), 'utf8');
      const wi = parseWorkItem(raw);
      // Extract title from WI body: first heading line or fall back to id.
      const titleMatch = raw.match(/^##?\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1].trim() : wi.work_item_id;
      items.push({ id: wi.work_item_id, title, dependsOn: wi.depends_on, status: wi.status });
    } catch {
      // skip unparseable WI
    }
  }
  return items.sort((x, y) => compareWorkItemIds(x.id, y.id)); // forge-mfv5.1.36: readdir order is not an order
}

/** Scan _logs/ for the latest cycle dir belonging to initId. */
export function discoverCycleIdFromLogs(logsRoot: string, initId: string): string | null {
  if (!existsSync(logsRoot)) return null;
  try {
    const dirs = readdirSync(logsRoot).filter((d) => d.endsWith(`_${initId}`));
    if (dirs.length === 0) return null;
    dirs.sort();
    return dirs[dirs.length - 1] ?? null;
  } catch {
    return null;
  }
}
