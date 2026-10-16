/**
 * forge-mfv5.1.47 (D-06 + D-20): a develop resume whose `.forge/work-items/` is gone restores it from
 * `_logs/<cycleId>/` — the `work-items-snapshot/`, then every send-back item it lacks, re-minted from the
 * typed `reviewer.verdict.send-back` event — validated as a set first; a gap is a refusal by name: a
 * `work-items.restore-refused` event and a throw, never the unclassified "no work items found".
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FORGE_ROOT, isSafeSegment, type EventLogger } from '@forge/kernel';
import { WORK_ITEM_FILE_PATTERN } from '@forge/contracts';
import { devWorkItemsDir, parseManifest, readWorkItemsFromDir, remintSendBackItems, validateWorkItemSet, writeWorkItem, writeWorkItemStatus, type CycleInput, type WorkItem } from '@forge/flows';

export function restoreDevWorkItemsAtResume(input: CycleInput, logger: EventLogger): void {
  if (input.resumeFrom !== 'develop') return;
  const logsRoot = input.logsRoot ? resolve(input.logsRoot) : join(FORGE_ROOT, '_logs');
  let restored: RestoreWorkItemsResult;
  try {
    const specs = parseManifest(readFileSync(input.manifestPath, 'utf8')).specs; // the current lineage's work-item ids
    restored = restoreWorkItemsForResume({ worktreePath: input.worktreePath, initiativeId: input.initiativeId, cycleId: logger.cycleId, logsRoot, specs });
  } catch (err) {
    restored = refuse(`could not read the manifest's specs: ${err instanceof Error ? err.message : String(err)}`);
  }
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

export function restoreWorkItemsForResume(opts: { worktreePath: string; initiativeId: string; cycleId: string; logsRoot: string; specs?: readonly string[] }): RestoreWorkItemsResult {
  const dir = devWorkItemsDir(opts.worktreePath);
  if (existsSync(dir)) {
    const live = readWorkItemsFromDir(dir);
    if (live.items.length > 0 || Object.keys(live.parseErrors).length > 0) return { status: 'present' };
  }
  if (!isSafeSegment(opts.cycleId)) return refuse('the cycle id is not a safe log directory name');
  const linked = [join(opts.worktreePath, '.forge'), dir].find((p) => existsSync(p) && lstatSync(p).isSymbolicLink());
  if (linked !== undefined) return refuse(`${linked} is a symlink — never followed`); // the worktree is agent-writable
  // The current lineage only: a fresh requeue keeps the cycle id, and the manifest's specs name its items.
  const inLineage = (id: string): boolean => opts.specs === undefined || opts.specs.includes(id);
  const snap = join(opts.logsRoot, opts.cycleId, 'work-items-snapshot');
  const logPath = join(opts.logsRoot, opts.cycleId, 'events.jsonl');
  const sendBacks = existsSync(logPath)
    ? readFileSync(logPath, 'utf8').split('\n').flatMap((l) => { try { const e = JSON.parse(l); return e?.message === 'reviewer.verdict.send-back' ? [e.metadata ?? {}] : []; } catch { return []; } })
    : [];
  const snapshot = existsSync(snap) ? readWorkItemsFromDir(snap) : { items: [] as WorkItem[], parseErrors: {} };
  const kept = snapshot.items.filter((w) => inLineage(w.work_item_id));
  if (kept.length === 0) {
    return refuse(`no work-items-snapshot with work items at _logs/${opts.cycleId}/work-items-snapshot${sendBacks.length > 0 ? ' — the send-back record alone cannot rebuild the dev work items it builds on' : ' and no send-back record'}`);
  }
  const bad = Object.entries(snapshot.parseErrors);
  if (bad.length > 0) return refuse(`the snapshot has unparseable work items: ${bad.map(([f, e]) => `${f}: ${e}`).join('; ')}`);
  // The snapshot predates a crash; this initiative's own `wi(<id>): merge` commits (never a dependency's on main) say what was delivered since.
  const git = (args: string[]): string => execFileSync('git', ['-C', opts.worktreePath, ...args], { encoding: 'utf8', stdio: 'pipe' });
  let log: string;
  try { log = git(['log', '--format=%s', `${['origin/main', 'main', 'origin/master', 'master'].find((r) => { try { return git(['rev-parse', '--verify', '--quiet', r]) !== ''; } catch { return false; } }) ?? 'NO-BASE-REF'}..HEAD`]); } catch (err) {
    return refuse(`could not read the branch's delivery record (git log <main>..HEAD): ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
  }
  const delivered = new Set(log.split('\n').flatMap((l) => /^wi\((.+)\): merge$/.exec(l)?.[1] ?? []));
  const items = kept.map((w) => (delivered.has(w.work_item_id) ? { ...w, status: 'complete' as const } : w));
  const reminted: WorkItem[] = [];
  for (const m of sendBacks as Array<Record<string, unknown>>) {
    const fixes = remintSendBackItems(m, { worktreePath: opts.worktreePath, initiativeId: opts.initiativeId, existing: items, want: inLineage });
    if ('refused' in fixes) return refuse(fixes.refused);
    for (const fix of fixes) {
      items.push(delivered.has(fix.work_item_id) ? { ...fix, status: 'complete' } : fix);
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
    const keptFiles = readdirSync(snap).filter((n) => n.endsWith('.md') && (!WORK_ITEM_FILE_PATTERN.test(n) || kept.some((w) => `${w.work_item_id}.md` === n)));
    for (const f of keptFiles) cpSync(join(snap, f), join(staging, f));
    for (const w of kept) if (delivered.has(w.work_item_id) && w.status !== 'complete') writeWorkItemStatus(join(staging, `${w.work_item_id}.md`), 'complete');
    for (const w of items.filter((i) => reminted.some((r) => r.work_item_id === i.work_item_id))) writeWorkItem(w, opts.worktreePath, { workItemsDir: staging });
    mkdirSync(dir, { recursive: true }); // holds no work item (checked above); a leftover _graph.md etc. is kept
    for (const f of readdirSync(staging)) if (!existsSync(join(dir, f))) renameSync(join(staging, f), join(dir, f));
    rmSync(staging, { recursive: true, force: true });
  } catch (err) {
    rmSync(staging, { recursive: true, force: true });
    return refuse(`could not write the restored work items: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { status: 'restored', fromSnapshot: kept.map((w) => w.work_item_id), reminted: reminted.map((w) => w.work_item_id) };
}
