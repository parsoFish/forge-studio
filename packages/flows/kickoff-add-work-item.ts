/**
 * Bead forge-nk1y.12 (D-48) — add a plan work item at the Kickoff gate, before
 * the first build. No `origin` (an origin makes the D-20 drain treat it as a fix
 * WI), never `resume_from`, never `review_rounds`. Validated as a set; D-47
 * coverage (injected — `@forge/stations` ranks above flows) is reported, never a
 * refusal. Re-checked under the manifest lock the verdict handler takes.
 */
import { dirname } from 'node:path';
import lockfile from 'proper-lockfile';

import { createLogger, guardedFile, guardedReadFile, guardedWriteFile } from '@forge/kernel';
import { KICKOFF_SOURCE_FLOW_ID, kickoffBuiltReason } from '@forge/contracts';
import { parseManifest, persistManifestSpecs, type InitiativeManifest } from './manifest.ts';
import { isCanonicalInitiativeId } from './initiative-id.ts';
import { validateManifestPathFields } from './manifest-path-guard.ts';
import { manifestAwaitsKickoff, readKickoffFacts } from './kickoff-facts.ts';
import { nextDevWorkItemId } from './fix-work-items.ts';
import { readWorkItemsFromDir, serializeWorkItem, validateWorkItemSet, writeWorkItem, type AcceptanceCriterion, type WorkItem } from './work-item.ts';

export type KickoffWorkItemSource = { summary: string; acceptanceCriteria: AcceptanceCriterion[]; qualityGateCmd: string[]; filesInScope: string[] };
export type KickoffCoverage = (acs: ReadonlyArray<{ when: string }>, items: ReadonlyArray<WorkItem>) => string[];
export type AddKickoffWorkItemArgs = { forgeRoot: string; logsRoot: string; initiativeId: string; source: KickoffWorkItemSource; coverage: KickoffCoverage };
type Refusal = { status: 'not-found' | 'not-at-kickoff' | 'invalid' | 'unsafe'; detail: string };
export type AddKickoffWorkItemResult = { status: 'added'; workItemId: string; uncoveredAcceptanceCriteria: string[] } | Refusal;

/** The manifest (from ready-for-review only) at the Kickoff gate, its real path and WI dir, or a refusal. */
function atKickoff(a: AddKickoffWorkItemArgs): Refusal | { manifest: InitiativeManifest; manifestPath: string; wiDir: string } {
  if (!isCanonicalInitiativeId(a.initiativeId)) return { status: 'not-found', detail: 'initiativeId is not a valid INIT-YYYY-MM-DD-slug' };
  const segs = ['_queue', 'ready-for-review', `${a.initiativeId}.md`];
  const manifestPath = guardedFile(a.forgeRoot, segs, 'read');
  const text = guardedReadFile(a.forgeRoot, segs);
  if (manifestPath === null || text === null) return { status: 'not-found', detail: `${a.initiativeId} is not in ready-for-review` };
  const manifest = parseManifest(text);
  const unsafe = manifest.initiative_id !== a.initiativeId ? ['initiative_id does not match the manifest file'] : validateManifestPathFields(manifest, { forgeRoot: a.forgeRoot });
  if (unsafe.length > 0) return { status: 'unsafe', detail: unsafe.join('; ') };
  const src = { queueDir: 'ready-for-review', manifest, logsRoot: a.logsRoot, forgeRoot: a.forgeRoot };
  if (!manifestAwaitsKickoff(src)) {
    const why = manifest.flow_id !== KICKOFF_SOURCE_FLOW_ID ? 'not a forge-architect kickoff' : kickoffBuiltReason(readKickoffFacts(src)) ?? 'no decomposed work items';
    return { status: 'not-at-kickoff', detail: `not at the kickoff gate (${why})` };
  }
  const wiDir = guardedFile(a.forgeRoot, ['_worktrees', a.initiativeId, '.forge', 'work-items'], 'readdir');
  if (wiDir === null) return { status: 'unsafe', detail: 'the initiative worktree work-items dir is absent or fails the path guard' };
  return { manifest, manifestPath, wiDir };
}

/** Median of the existing WIs' estimated_iterations, rounded up; at least 1. */
function medianIterations(items: readonly WorkItem[]): number {
  const s = items.map((w) => w.estimated_iterations).sort((x, y) => x - y);
  if (s.length === 0) return 1;
  const mid = Math.floor(s.length / 2);
  return Math.max(1, Math.ceil(s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2));
}

/** Pure: an operator-authored plan WI (no `origin`) beside `existing`, or every set-validation error. */
export function buildPlanWorkItem(existing: readonly WorkItem[], id: string, initiativeId: string, source: KickoffWorkItemSource): { workItem: WorkItem } | { errors: string[] } {
  const workItem: WorkItem = {
    work_item_id: id, initiative_id: initiativeId, status: 'pending', depends_on: [],
    acceptance_criteria: source.acceptanceCriteria, files_in_scope: [...source.filesInScope],
    quality_gate_cmd: [...source.qualityGateCmd], estimated_iterations: medianIterations(existing), body: source.summary,
  };
  const set = validateWorkItemSet([...existing, workItem]);
  const errors = [...set.setErrors, ...Object.entries(set.perItem).flatMap(([wid, es]) => es.map((e) => `${wid}: ${e}`))];
  return errors.length > 0 ? { errors } : { workItem };
}

export async function addKickoffWorkItem(a: AddKickoffWorkItemArgs): Promise<AddKickoffWorkItemResult> {
  const outer = atKickoff(a);
  if ('status' in outer) return outer;
  // realpath:false on the guard's real path: the same `<path>.lock` the verdict
  // handler takes, and still lockable once a Start development moved the file.
  const release = await lockfile.lock(outer.manifestPath, { realpath: false, retries: { retries: 5, minTimeout: 50 } });
  try {
    const g = atKickoff(a); // re-check inside the lock: Start development may have landed
    if ('status' in g && g.status === 'not-found') return { status: 'not-at-kickoff', detail: 'not at the kickoff gate (the manifest left ready-for-review while the add waited on its lock)' };
    if ('status' in g) return g;
    const worktree = dirname(dirname(g.wiDir));
    const existing = readWorkItemsFromDir(g.wiDir).items;
    const built = buildPlanWorkItem(existing, nextDevWorkItemId(worktree), a.initiativeId, a.source);
    if ('errors' in built) return { status: 'invalid', detail: built.errors.join('; ') };
    const wi = built.workItem;
    writeWorkItem(wi, worktree, { workItemsDir: g.wiDir });
    const cycleId = g.manifest.cycle_id ?? a.initiativeId;
    if (guardedFile(a.logsRoot, [cycleId, 'work-items-snapshot'], 'readdir') !== null) {
      guardedWriteFile(a.logsRoot, [cycleId, 'work-items-snapshot', `${wi.work_item_id}.md`], serializeWorkItem(wi));
    }
    persistManifestSpecs(g.manifestPath, [...(g.manifest.specs ?? []), wi.work_item_id]);
    const uncovered = a.coverage(g.manifest.acceptance_criteria ?? [], [...existing, wi]);
    createLogger(cycleId, a.logsRoot).emit({
      initiative_id: a.initiativeId, phase: 'orchestrator', skill: 'kickoff-gate', event_type: 'log',
      input_refs: [g.manifestPath], output_refs: [`.forge/work-items/${wi.work_item_id}.md`],
      message: 'kickoff.work-item-added', metadata: { work_item_id: wi.work_item_id, uncovered_acceptance_criteria: uncovered },
    });
    return { status: 'added', workItemId: wi.work_item_id, uncoveredAcceptanceCriteria: uncovered };
  } finally {
    await release();
  }
}
