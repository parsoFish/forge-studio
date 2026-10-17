/** forge-nk1y.12 (D-48): add a plan WI (no `origin`) at the Kickoff gate, under the manifest lock; D-47 coverage injected, reported only.
 *  forge-mfv5.1.36: an added WI depends on the plan's leaves unless `dependsOn` is set.
 *  forge-nk1y.32: a WI ADDED at the gate (its `kickoff.work-item-added` event) is edited in full or deleted; a plan WI's
 *  dependencies only; every submitted scope entry is one relative path (`scopeEntryErrors`).
 *  forge-mfv5.1.52: and is judged against the worktree (`scopeEntryWorktreeErrors`) — a directory needs its trailing `/`. */
import { dirname } from 'node:path';
import lockfile from 'proper-lockfile';

import { createLogger, guardedFile, guardedReadFile, guardedUnlink, guardedWriteFile } from '@forge/kernel';
import { KICKOFF_SOURCE_FLOW_ID, kickoffBuiltReason, leafWorkItemIds, scopeEntryErrors } from '@forge/contracts';
import { parseManifest, persistManifestSpecs, type InitiativeManifest } from './manifest.ts';
import { isCanonicalInitiativeId } from './initiative-id.ts';
import { validateManifestPathFields } from './manifest-path-guard.ts';
import { manifestAwaitsKickoff, readKickoffFacts } from './kickoff-facts.ts';
import { nextDevWorkItemId } from './fix-work-items.ts';
import { missingCheckErrors } from './acceptance-check.ts';
import { createsEntryWorktreeErrors, scopeEntryWorktreeErrors } from './scope-entry-worktree.ts';
import { readCycleEvents } from './legacy-fix-gate.ts';
import { readWorkItemsFromDir, serializeWorkItem, validateWorkItemSet, writeWorkItem, type AcceptanceCriterion, type WorkItem } from './work-item.ts';

/** `dependsOn` absent = the plan's leaf work items (D-48 amended); `[]` = a root. */
export type KickoffWorkItemSource = {
  summary: string;
  acceptanceCriteria: AcceptanceCriterion[];
  qualityGateCmd: string[];
  filesInScope: string[];
  creates?: string[];
  dependsOn?: readonly string[];
};
/** Absent = unchanged; `creates: []` clears it. Any field but `dependsOn` needs a kickoff-added work item. */
export type KickoffWorkItemEdit = Partial<Omit<KickoffWorkItemSource, 'dependsOn'>> & { dependsOn?: readonly string[] };
export type KickoffCoverage = (acs: ReadonlyArray<{ when: string }>, items: ReadonlyArray<WorkItem>) => string[];
type GateArgs = { forgeRoot: string; logsRoot: string; initiativeId: string };
export type AddKickoffWorkItemArgs = GateArgs & { source: KickoffWorkItemSource; coverage: KickoffCoverage };
type RefusalStatus = 'not-found' | 'not-at-kickoff' | 'invalid' | 'unsafe' | 'not-a-kickoff-work-item' | 'has-dependents';
type Refusal = { status: RefusalStatus; detail: string };
export type AddKickoffWorkItemResult = { status: 'added'; workItemId: string; uncoveredAcceptanceCriteria: string[] } | Refusal;

type AtKickoff = { manifest: InitiativeManifest; manifestPath: string; wiDir: string };

function atKickoff(a: GateArgs): Refusal | AtKickoff {
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

function medianIterations(items: readonly WorkItem[]): number { // rounded up; at least 1
  const s = items.map((w) => w.estimated_iterations).sort((x, y) => x - y), mid = Math.floor(s.length / 2);
  return s.length === 0 ? 1 : Math.max(1, Math.ceil(s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2));
}

/** Pure: an operator-authored plan WI (no `origin`) beside `existing`, or every set-validation error. */
export function buildPlanWorkItem(existing: readonly WorkItem[], id: string, initiativeId: string, source: KickoffWorkItemSource): { workItem: WorkItem } | { errors: string[] } {
  const workItem: WorkItem = {
    work_item_id: id, initiative_id: initiativeId, status: 'pending', acceptance_criteria: source.acceptanceCriteria,
    depends_on: [...(source.dependsOn ?? leafWorkItemIds(existing.map((w) => ({ id: w.work_item_id, dependsOn: w.depends_on }))))],
    files_in_scope: [...source.filesInScope], quality_gate_cmd: [...source.qualityGateCmd], estimated_iterations: medianIterations(existing), body: source.summary,
    ...(source.creates?.length ? { creates: [...source.creates] } : {}),
  };
  const errors = gateSetErrors([...existing, workItem], workItem);
  return errors.length > 0 ? { errors } : { workItem };
}

/** The path rule on the work item authored at the gate, then the whole set. */
function gateSetErrors(set: WorkItem[], authored: WorkItem | null, criteriaAuthored = authored !== null): string[] {
  const pathErrors = authored === null ? [] : [
    ...scopeEntryErrors('files_in_scope', authored.files_in_scope),
    ...scopeEntryErrors('creates', authored.creates ?? []),
    ...(criteriaAuthored ? missingCheckErrors(authored.acceptance_criteria) : []), // forge-mfv5.1.43: criteria the operator authors carry a check each
  ];
  return [...pathErrors, ...setErrorList(validateWorkItemSet(set))];
}

/** forge-mfv5.1.52: the authored scope against the worktree; an absent entry passes only when `creates` lists it. */
const worktreeScopeErrors = (worktree: string, wi: WorkItem): string[] => [
  ...scopeEntryWorktreeErrors(worktree, wi.files_in_scope, { door: 'kickoff', creates: wi.creates ?? [] }),
  ...createsEntryWorktreeErrors(worktree, wi.creates ?? []),
];

const setErrorList = (set: ReturnType<typeof validateWorkItemSet>): string[] =>
  [...set.setErrors, ...Object.entries(set.perItem).flatMap(([wid, es]) => es.map((e) => `${wid}: ${e}`))];

/** The gate check, then the manifest lock, then the SAME check again inside it (Start development may have landed). */
async function underKickoffLock<R>(a: GateArgs, fn: (g: AtKickoff) => R): Promise<R | Refusal> {
  const outer = atKickoff(a);
  if ('status' in outer) return outer;
  // realpath:false on the guard's real path: the verdict handler's / develop enqueue's `<path>.lock`.
  const release = await lockfile.lock(outer.manifestPath, { realpath: false, retries: { retries: 5, minTimeout: 50 } });
  try {
    const g = atKickoff(a); // re-check inside the lock
    if ('status' in g) return g.status !== 'not-found' ? g : { status: 'not-at-kickoff', detail: 'not at the kickoff gate (the manifest left ready-for-review while the request waited on its lock)' };
    return fn(g);
  } finally { await release(); }
}

const cycleIdOf = (a: GateArgs, g: AtKickoff): string => g.manifest.cycle_id ?? a.initiativeId;
function emitKickoff(a: GateArgs, g: AtKickoff, message: string, metadata: Record<string, unknown>): void {
  createLogger(cycleIdOf(a, g), a.logsRoot).emit({
    initiative_id: a.initiativeId,
    phase: 'orchestrator',
    skill: 'kickoff-gate',
    event_type: 'log',
    input_refs: [g.manifestPath],
    output_refs: [`.forge/work-items/${String(metadata.work_item_id)}.md`],
    message,
    metadata,
  });
}

/** Rewrite into the cycle's work-items snapshot too, when it exists (the roadmap reads it first). */
function writeSnapshotCopy(a: GateArgs, g: AtKickoff, wi: WorkItem): void {
  const snap = [cycleIdOf(a, g), 'work-items-snapshot'];
  if (guardedFile(a.logsRoot, snap, 'readdir') !== null) guardedWriteFile(a.logsRoot, [...snap, `${wi.work_item_id}.md`], serializeWorkItem(wi));
}

export async function addKickoffWorkItem(a: AddKickoffWorkItemArgs): Promise<AddKickoffWorkItemResult> {
  return underKickoffLock(a, (g): AddKickoffWorkItemResult => {
    const worktree = dirname(dirname(g.wiDir)), existing = readWorkItemsFromDir(g.wiDir).items;
    const built = buildPlanWorkItem(existing, nextDevWorkItemId(worktree), a.initiativeId, a.source);
    if ('errors' in built) return { status: 'invalid', detail: built.errors.join('; ') };
    const wi = built.workItem;
    const scopeErrors = worktreeScopeErrors(worktree, wi);
    if (scopeErrors.length > 0) return { status: 'invalid', detail: scopeErrors.join('; ') };
    writeWorkItem(wi, worktree, { workItemsDir: g.wiDir });
    if (!persistManifestSpecs(g.manifestPath, [...(g.manifest.specs ?? []), wi.work_item_id])) {
      guardedUnlink(a.forgeRoot, ['_worktrees', a.initiativeId, '.forge', 'work-items', `${wi.work_item_id}.md`]); // no stray WI
      return { status: 'not-at-kickoff', detail: 'not at the kickoff gate (the manifest could not record the work item — vanished or unwritable; nothing added)' };
    }
    writeSnapshotCopy(a, g, wi);
    const uncovered = a.coverage(g.manifest.acceptance_criteria ?? [], [...existing, wi]);
    emitKickoff(a, g, 'kickoff.work-item-added', { work_item_id: wi.work_item_id, uncovered_acceptance_criteria: uncovered });
    return { status: 'added', workItemId: wi.work_item_id, uncoveredAcceptanceCriteria: uncovered };
  });
}

/** The ids added at the gate, from their `kickoff.work-item-added` events; an unreadable log is named (fail closed). */
function kickoffAddedIds(logsRoot: string, cycleId: string): Set<string> | { unreadable: string } {
  const evs = readCycleEvents(logsRoot, cycleId);
  if ('unreadable' in evs) return evs;
  const added = evs.filter((e) => e.skill === 'kickoff-gate' && e.message === 'kickoff.work-item-added');
  return new Set(added.map((e) => e.metadata?.work_item_id).filter((id): id is string => typeof id === 'string'));
}

function kickoffAddedRefusal(logsRoot: string, cycleId: string, id: string): Refusal | null {
  const ids = kickoffAddedIds(logsRoot, cycleId);
  if (!(ids instanceof Set)) {
    return { status: 'not-a-kickoff-work-item', detail: `cannot show ${id} was added at the Kickoff gate: ${ids.unreadable}` };
  }
  if (ids.has(id)) return null;
  const detail = `${id} is a plan work item — at the Kickoff gate only its dependsOn can be edited, and it cannot be deleted`;
  return { status: 'not-a-kickoff-work-item', detail };
}

const EDIT_FIELDS = ['summary', 'acceptanceCriteria', 'qualityGateCmd', 'filesInScope', 'creates', 'dependsOn'] as const;
export type KickoffWorkItemFields = Required<KickoffWorkItemSource>;
function editableOf(w: WorkItem): KickoffWorkItemFields {
  return {
    summary: w.body.trim(),
    acceptanceCriteria: w.acceptance_criteria,
    qualityGateCmd: w.quality_gate_cmd ?? [],
    filesInScope: w.files_in_scope,
    creates: w.creates ?? [],
    dependsOn: w.depends_on,
  };
}

/**
 * Studio's prefill (served on the roadmap at the gate): each work item added
 * at the gate, by id, with its editable fields; none when the log is unreadable.
 */
export function kickoffAddedWorkItemFields(a: GateArgs & { cycleId: string | null }): Record<string, KickoffWorkItemFields> {
  const ids = kickoffAddedIds(a.logsRoot, a.cycleId ?? a.initiativeId);
  if (!isCanonicalInitiativeId(a.initiativeId) || !(ids instanceof Set) || ids.size === 0) return {};
  const dir = guardedFile(a.forgeRoot, ['_worktrees', a.initiativeId, '.forge', 'work-items'], 'readdir');
  if (dir === null) return {};
  const added = readWorkItemsFromDir(dir).items.filter((w) => ids.has(w.work_item_id));
  return Object.fromEntries(added.map((w) => [w.work_item_id, editableOf(w)]));
}

function applyEdit(w: WorkItem, e: KickoffWorkItemEdit): WorkItem {
  const { creates, ...rest } = w;
  const nextCreates = e.creates ?? creates;
  return {
    ...rest,
    ...(nextCreates?.length ? { creates: [...nextCreates] } : {}),
    ...(e.qualityGateCmd ? { quality_gate_cmd: [...e.qualityGateCmd] } : {}),
    body: e.summary ?? w.body,
    acceptance_criteria: e.acceptanceCriteria ?? w.acceptance_criteria,
    files_in_scope: [...(e.filesInScope ?? w.files_in_scope)],
    depends_on: [...(e.dependsOn ?? w.depends_on)],
  };
}

export type EditKickoffWorkItemArgs = GateArgs & { workItemId: string; edit: KickoffWorkItemEdit };
export type EditKickoffWorkItemResult = { status: 'edited'; workItemId: string; dependsOn: string[]; fields: string[] } | Refusal;

/**
 * forge-mfv5.1.36 / forge-nk1y.32 (D-48 amended): edit one work item at the
 * Kickoff gate, under the add's lock and in-lock re-check. `dependsOn` alone:
 * any work item (row 11). Any other field: only one added at the gate, and the
 * path rule holds on its scope. The resulting SET is validated before the
 * validated writer rewrites the worktree file and the snapshot copy.
 */
export async function editKickoffWorkItem(a: EditKickoffWorkItemArgs): Promise<EditKickoffWorkItemResult> {
  return underKickoffLock(a, (g): EditKickoffWorkItemResult => {
    const worktree = dirname(dirname(g.wiDir)), existing = readWorkItemsFromDir(g.wiDir).items;
    const current = existing.find((w) => w.work_item_id === a.workItemId);
    if (!current) return { status: 'not-found', detail: `${a.workItemId} is not a work item of ${a.initiativeId}` };
    const full = Object.keys(a.edit).some((k) => k !== 'dependsOn');
    const refused = full ? kickoffAddedRefusal(a.logsRoot, cycleIdOf(a, g), a.workItemId) : null;
    if (refused) return refused;
    const wi = applyEdit(current, a.edit);
    const scopeEdited = a.edit.filesInScope !== undefined || a.edit.creates !== undefined;
    const errors = [
      ...gateSetErrors(existing.map((w) => (w === current ? wi : w)), full ? wi : null, a.edit.acceptanceCriteria !== undefined),
      ...(full && scopeEdited ? worktreeScopeErrors(worktree, wi) : []),
    ];
    if (errors.length > 0) return { status: 'invalid', detail: errors.join('; ') };
    writeWorkItem(wi, worktree, { workItemsDir: g.wiDir });
    writeSnapshotCopy(a, g, wi);
    const was = editableOf(current), now = editableOf(wi);
    const fields = EDIT_FIELDS.filter((f) => a.edit[f] !== undefined && JSON.stringify(was[f]) !== JSON.stringify(now[f]));
    emitKickoff(a, g, 'kickoff.work-item-edited', { work_item_id: wi.work_item_id, fields });
    return { status: 'edited', workItemId: wi.work_item_id, dependsOn: wi.depends_on, fields };
  });
}

export type DeleteKickoffWorkItemResult = { status: 'deleted'; workItemId: string } | Refusal;

/**
 * forge-nk1y.32 (D-48 amended): delete one work item added at the gate, while
 * nothing is built and nothing depends on it. Manifest `specs` first, under the
 * lock; a worktree removal that fails restores them; a snapshot copy that
 * cannot be removed is named, never silent.
 */
export async function deleteKickoffWorkItem(a: GateArgs & { workItemId: string }): Promise<DeleteKickoffWorkItemResult> {
  return underKickoffLock(a, (g): DeleteKickoffWorkItemResult => {
    const id = a.workItemId, existing = readWorkItemsFromDir(g.wiDir).items;
    if (!existing.some((w) => w.work_item_id === id)) {
      return { status: 'not-found', detail: `${id} is not a work item of ${a.initiativeId}` };
    }
    const refused = kickoffAddedRefusal(a.logsRoot, cycleIdOf(a, g), id);
    if (refused) return refused;
    const dependents = existing.filter((w) => w.depends_on.includes(id)).map((w) => w.work_item_id);
    if (dependents.length > 0) {
      return { status: 'has-dependents', detail: `${id} is a dependency of ${dependents.join(', ')} — edit their dependencies first` };
    }
    const specs = g.manifest.specs ?? [];
    if (!persistManifestSpecs(g.manifestPath, specs.filter((s) => s !== id))) {
      const why = 'the manifest could not record the deletion — vanished or unwritable; nothing deleted';
      return { status: 'not-at-kickoff', detail: `not at the kickoff gate (${why})` };
    }
    if (!guardedUnlink(a.forgeRoot, ['_worktrees', a.initiativeId, '.forge', 'work-items', `${id}.md`])) {
      const restored = persistManifestSpecs(g.manifestPath, specs)
        ? 'the manifest specs were restored — nothing deleted'
        : 'the manifest specs could NOT be restored — re-add the id by hand';
      return { status: 'unsafe', detail: `${id}.md could not be removed from the worktree; ${restored}` };
    }
    const snap = [cycleIdOf(a, g), 'work-items-snapshot', `${id}.md`];
    const snapLeft = guardedFile(a.logsRoot, snap, 'read') !== null && !guardedUnlink(a.logsRoot, snap);
    emitKickoff(a, g, 'kickoff.work-item-deleted', { work_item_id: id });
    if (!snapLeft) return { status: 'deleted', workItemId: id };
    const left = `its snapshot copy ${snap.join('/')} could not be removed — remove it by hand`;
    return { status: 'unsafe', detail: `${id} was deleted from the worktree and the manifest specs, but ${left}` };
  });
}
