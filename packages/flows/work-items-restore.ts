/**
 * forge-mfv5.1.47 (row 3, D-06 + D-20) — a develop resume whose
 * `.forge/work-items/` is gone restores it from the cycle's own durable record
 * instead of failing "developer-loop: no work items found" unclassified.
 *
 * The two sources, both under `_logs/<cycleId>/`:
 *   - `work-items-snapshot/` — the cycle's copy of the work-item queue (every
 *     `*.md`: the WI files, `_decomposition*`, `_graph.md`), statuses as of
 *     the snapshot;
 *   - `events.jsonl`'s `reviewer.verdict.send-back` events — the typed
 *     send-back (rationale, criteria with their falsifying checks, gate,
 *     concern kind) that appended a fix item, re-minted with the ONE fix
 *     builder for every appended id the snapshot does not hold.
 *
 * All or nothing: everything is staged beside the queue and validated as a set
 * before it replaces the (empty) queue dir; any gap is a refusal naming it.
 * A non-empty queue is never touched.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { isSafeSegment } from '@forge/kernel';

import { buildFixWorkItem, DEFAULT_FIX_WI_ITERATIONS, devWorkItemsDir } from './fix-work-items.ts';
import { FIX_WI_ORIGINS, readWorkItemsFromDir, validateWorkItemSet, writeWorkItem, type AcceptanceCriterion, type FixWiOrigin, type WorkItem } from './work-item.ts';

export type RestoreWorkItemsResult =
  | { status: 'present' }
  | { status: 'restored'; fromSnapshot: string[]; reminted: string[] }
  | { status: 'refused'; reason: string };

const SEND_BACK = 'reviewer.verdict.send-back';

type SendBackRecord = {
  rationale: string;
  acceptanceCriteria: AcceptanceCriterion[];
  concernKind: 'packaging' | 'code-fix';
  gateCmd: string[] | null;
  origin: FixWiOrigin;
  appended: string[];
  filesInScope?: string[];
  estimatedIterations?: number;
};

export function restoreWorkItemsForResume(opts: {
  worktreePath: string;
  initiativeId: string;
  cycleId: string;
  logsRoot: string;
}): RestoreWorkItemsResult {
  const dir = devWorkItemsDir(opts.worktreePath);
  if (existsSync(dir) && readdirSync(dir).length > 0) return { status: 'present' };
  if (!isSafeSegment(opts.cycleId)) return refuse(`the manifest's cycle_id is not a safe log directory name`);

  const cycleDir = join(opts.logsRoot, opts.cycleId);
  const snap = join(cycleDir, 'work-items-snapshot');
  const snapshot = existsSync(snap) ? readWorkItemsFromDir(snap) : { items: [] as WorkItem[], parseErrors: {} as Record<string, string> };
  const sendBacks = readSendBacks(join(cycleDir, 'events.jsonl'));
  if ('error' in sendBacks) return refuse(sendBacks.error);
  if (snapshot.items.length === 0) {
    return refuse(
      `no work-items-snapshot with work items at _logs/${opts.cycleId}/work-items-snapshot` +
        (sendBacks.records.length > 0 ? ' — the send-back record alone cannot rebuild the dev work items it builds on' : ' and no send-back record'),
    );
  }
  const parseErrors = Object.entries(snapshot.parseErrors);
  if (parseErrors.length > 0) return refuse(`the snapshot has unparseable work items: ${parseErrors.map(([f, e]) => `${f}: ${e}`).join('; ')}`);

  const items = [...snapshot.items];
  const reminted: WorkItem[] = [];
  for (const rec of sendBacks.records) {
    for (const id of rec.appended) {
      if (items.some((w) => w.work_item_id === id)) continue;
      if (rec.gateCmd === null) return refuse(`${id}: the send-back event carries no quality_gate_cmd — it cannot be re-minted exactly`);
      const fix = buildFixWorkItem({
        worktreePath: opts.worktreePath,
        initiativeId: opts.initiativeId,
        id,
        source: { origin: rec.origin, rationale: rec.rationale, acceptanceCriteria: rec.acceptanceCriteria, concernKind: rec.concernKind, filesInScope: rec.filesInScope },
        acceptanceCriteria: rec.acceptanceCriteria,
        gateCmd: rec.gateCmd,
        estimatedIterations: rec.estimatedIterations ?? DEFAULT_FIX_WI_ITERATIONS,
        existing: items,
      });
      items.push(fix);
      reminted.push(fix);
    }
  }
  const { perItem, setErrors } = validateWorkItemSet(items);
  const errors = [...Object.entries(perItem).flatMap(([id, e]) => e.map((m) => `${id}: ${m}`)), ...setErrors];
  if (errors.length > 0) return refuse(`the restored set does not validate: ${errors.join('; ')}`);

  const staging = `${dir}.restore-staging`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  try {
    for (const f of readdirSync(snap).filter((n) => n.endsWith('.md'))) cpSync(join(snap, f), join(staging, f));
    for (const w of reminted) writeWorkItem(w, opts.worktreePath, { workItemsDir: staging });
    rmSync(dir, { recursive: true, force: true }); // empty (or absent) — checked above
    renameSync(staging, dir);
  } catch (err) {
    rmSync(staging, { recursive: true, force: true });
    return refuse(`could not write the restored work items: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { status: 'restored', fromSnapshot: snapshot.items.map((w) => w.work_item_id), reminted: reminted.map((w) => w.work_item_id) };
}

function refuse(reason: string): RestoreWorkItemsResult {
  return { status: 'refused', reason: `work items not restorable: ${reason}` };
}

/** Every typed send-back in the cycle log, oldest first; a malformed one is an error, never skipped. */
function readSendBacks(logPath: string): { records: SendBackRecord[] } | { error: string } {
  if (!existsSync(logPath)) return { records: [] };
  const records: SendBackRecord[] = [];
  for (const line of readFileSync(logPath, 'utf8').split('\n')) {
    if (!line.includes(SEND_BACK)) continue;
    let e: { message?: unknown; metadata?: Record<string, unknown> };
    try { e = JSON.parse(line); } catch { continue; } // a torn line cannot be a complete record
    if (e.message !== SEND_BACK) continue;
    const m = e.metadata ?? {};
    const appended = m.appended_work_items;
    const acs = m.acceptance_criteria;
    const origin = m.origin;
    if (!Array.isArray(appended) || !appended.every((a) => typeof a === 'string' && a.length > 0)) return { error: 'a send-back event names no appended_work_items' };
    if (!Array.isArray(acs) || acs.length === 0) return { error: `the send-back for ${appended.join(', ')} carries no acceptance_criteria` };
    if (typeof origin !== 'string' || !FIX_WI_ORIGINS.includes(origin as FixWiOrigin)) return { error: `the send-back for ${appended.join(', ')} carries an unknown origin` };
    // The gate the item actually got (recorded since forge-mfv5.1.47), else the concern's own.
    const gate = Array.isArray(m.work_item_gate_cmd) ? m.work_item_gate_cmd : m.quality_gate_cmd;
    const files = m.files_in_scope;
    const iters = m.estimated_iterations;
    records.push({
      rationale: typeof m.rationale === 'string' ? m.rationale : '',
      acceptanceCriteria: acs as AcceptanceCriterion[],
      concernKind: m.concern_kind === 'packaging' ? 'packaging' : 'code-fix',
      gateCmd: Array.isArray(gate) && gate.length > 0 && gate.every((g) => typeof g === 'string' && g.length > 0) ? (gate as string[]) : null,
      origin: origin as FixWiOrigin,
      appended: appended as string[],
      ...(Array.isArray(files) && files.length > 0 && files.every((f) => typeof f === 'string') ? { filesInScope: files as string[] } : {}),
      ...(typeof iters === 'number' && Number.isInteger(iters) && iters > 0 ? { estimatedIterations: iters } : {}),
    });
  }
  return { records };
}
