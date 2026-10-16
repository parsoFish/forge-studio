/**
 * forge-mfv5.1.47 (D-06 + D-20): a develop resume whose `.forge/work-items/` is gone restores it from
 * `_logs/<cycleId>/` — the `work-items-snapshot/`, then every send-back item it lacks, re-minted from the
 * typed `reviewer.verdict.send-back` event — validated as a set first; a gap is a refusal by name: a
 * `work-items.restore-refused` event and a throw, never the unclassified "no work items found".
 */
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FORGE_ROOT, isSafeSegment, type EventLogger } from '@forge/kernel';
import { buildFixWorkItem, DEFAULT_FIX_WI_ITERATIONS, devWorkItemsDir, FIX_WI_ORIGINS, readWorkItemsFromDir, validateWorkItemSet, writeWorkItem, type CycleInput, type FixWiOrigin, type WorkItem } from '@forge/flows';

type AcceptanceCriterion = WorkItem['acceptance_criteria'][number];

export function restoreDevWorkItemsAtResume(input: CycleInput, logger: EventLogger): void {
  if (input.resumeFrom !== 'develop') return;
  const logsRoot = input.logsRoot ? resolve(input.logsRoot) : join(FORGE_ROOT, '_logs');
  const restored = restoreWorkItemsForResume({ worktreePath: input.worktreePath, initiativeId: input.initiativeId, cycleId: logger.cycleId, logsRoot });
  if (restored.status === 'present') return;
  const emit = (eventType: 'log' | 'error', message: string, metadata: Record<string, unknown>): void => {
    logger.emit({ initiative_id: input.initiativeId, phase: 'developer-loop', skill: 'developer-loop', event_type: eventType, input_refs: [join(logsRoot, logger.cycleId)], output_refs: ['.forge/work-items'], message, metadata });
  };
  if (restored.status === 'refused') {
    emit('error', 'work-items.restore-refused', { reason: restored.reason });
    throw new Error(`developer-loop: ${restored.reason}`);
  }
  emit('log', 'work-items.restored', { from_snapshot: restored.fromSnapshot, reminted: restored.reminted });
}

export type RestoreWorkItemsResult =
  | { status: 'present' }
  | { status: 'restored'; fromSnapshot: string[]; reminted: string[] }
  | { status: 'refused'; reason: string };

const refuse = (reason: string): RestoreWorkItemsResult => ({ status: 'refused', reason: `work items not restorable: ${reason}` });
const strings = (v: unknown): string[] | null => (Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === 'string' && s.length > 0) ? (v as string[]) : null);

export function restoreWorkItemsForResume(opts: { worktreePath: string; initiativeId: string; cycleId: string; logsRoot: string }): RestoreWorkItemsResult {
  const dir = devWorkItemsDir(opts.worktreePath);
  if (existsSync(dir) && readdirSync(dir).length > 0) return { status: 'present' };
  if (!isSafeSegment(opts.cycleId)) return refuse('the cycle id is not a safe log directory name');
  const linked = [join(opts.worktreePath, '.forge'), dir].find((p) => existsSync(p) && lstatSync(p).isSymbolicLink());
  if (linked !== undefined) return refuse(`${linked} is a symlink — never followed`); // the worktree is agent-writable
  const snap = join(opts.logsRoot, opts.cycleId, 'work-items-snapshot');
  const logPath = join(opts.logsRoot, opts.cycleId, 'events.jsonl');
  const sendBacks = existsSync(logPath)
    ? readFileSync(logPath, 'utf8').split('\n').flatMap((l) => { try { const e = JSON.parse(l); return e?.message === 'reviewer.verdict.send-back' ? [e.metadata ?? {}] : []; } catch { return []; } })
    : [];
  const snapshot = existsSync(snap) ? readWorkItemsFromDir(snap) : { items: [] as WorkItem[], parseErrors: {} };
  if (snapshot.items.length === 0) {
    return refuse(`no work-items-snapshot with work items at _logs/${opts.cycleId}/work-items-snapshot${sendBacks.length > 0 ? ' — the send-back record alone cannot rebuild the dev work items it builds on' : ' and no send-back record'}`);
  }
  const bad = Object.entries(snapshot.parseErrors);
  if (bad.length > 0) return refuse(`the snapshot has unparseable work items: ${bad.map(([f, e]) => `${f}: ${e}`).join('; ')}`);
  const items = [...snapshot.items];
  const reminted: WorkItem[] = [];
  for (const m of sendBacks as Array<Record<string, unknown>>) {
    const ids = strings(m.appended_work_items);
    const acs = Array.isArray(m.acceptance_criteria) && m.acceptance_criteria.length > 0 ? (m.acceptance_criteria as AcceptanceCriterion[]) : null;
    const origin = FIX_WI_ORIGINS.includes(m.origin as FixWiOrigin) ? (m.origin as FixWiOrigin) : null;
    if (ids === null || acs === null || origin === null) return refuse('a send-back event lacks its appended ids, criteria or origin');
    // The gate the item actually got (recorded since forge-mfv5.1.47), else the concern's own.
    const gateCmd = strings(m.work_item_gate_cmd) ?? strings(m.quality_gate_cmd);
    const iters = typeof m.estimated_iterations === 'number' && m.estimated_iterations > 0 ? m.estimated_iterations : DEFAULT_FIX_WI_ITERATIONS;
    for (const id of ids.filter((x) => !items.some((w) => w.work_item_id === x))) {
      if (gateCmd === null) return refuse(`${id}: the send-back event carries no quality_gate_cmd — it cannot be re-minted exactly`);
      const source = { origin, rationale: typeof m.rationale === 'string' ? m.rationale : '', acceptanceCriteria: acs, concernKind: m.concern_kind === 'packaging' ? ('packaging' as const) : ('code-fix' as const), filesInScope: strings(m.files_in_scope) ?? undefined };
      const fix = buildFixWorkItem({ worktreePath: opts.worktreePath, initiativeId: opts.initiativeId, id, source, acceptanceCriteria: acs, gateCmd, estimatedIterations: iters, existing: items });
      items.push(fix);
      reminted.push(fix);
    }
  }
  const { perItem, setErrors } = validateWorkItemSet(items);
  const errors = [...Object.entries(perItem).flatMap(([id, e]) => e.map((x) => `${id}: ${x}`)), ...setErrors];
  if (errors.length > 0) return refuse(`the restored set does not validate: ${errors.join('; ')}`);
  const staging = `${dir}.restore-staging`;
  try {
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    for (const f of readdirSync(snap).filter((n) => n.endsWith('.md'))) cpSync(join(snap, f), join(staging, f));
    for (const w of reminted) writeWorkItem(w, opts.worktreePath, { workItemsDir: staging });
    rmSync(dir, { recursive: true, force: true }); // empty or absent — checked above
    renameSync(staging, dir);
  } catch (err) {
    rmSync(staging, { recursive: true, force: true });
    return refuse(`could not write the restored work items: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { status: 'restored', fromSnapshot: snapshot.items.map((w) => w.work_item_id), reminted: reminted.map((w) => w.work_item_id) };
}
