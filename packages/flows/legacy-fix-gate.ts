/**
 * forge-nk1y.22 — a pre-#1172 gate-fix WI carries the no-op gate `['true']`. On both re-entry paths (drain,
 * requeue) rewrite a pending/in-progress `origin: gate-fix` WI whose gate is EXACTLY that to the failing gate's
 * command, recovered from the cycle's events (the compiled event's `gate_cmd`, else the `cycle.merge-gate` row the
 * compile followed) — never guessed; an unrecoverable WI stays as built and is NAMED in the event.
 */
import { createLogger, guardedReadFile } from '@forge/kernel';
import { devWorkItemsDir, readPendingFixWorkItems } from './fix-work-items.ts';
import { writeWorkItem } from './work-item.ts';
const LEGACY_NOOP_GATE: readonly string[] = ['true'];
export const LEGACY_GATE_NORMALISED_MESSAGE = 'fix-loop.legacy-gate.normalised';
export type CycleEvent = { message?: unknown; phase?: unknown; skill?: unknown; metadata?: Record<string, unknown> };
export type LegacyGateReport = { rewritten: Array<{ work_item_id: string; cmd: string[] }>; unresolved: Array<{ work_item_id: string; reason: string }> };

const isCmd = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === 'string' && s.length > 0);
const isNoop = (cmd: readonly string[] | undefined): boolean => cmd !== undefined && cmd.length === LEGACY_NOOP_GATE.length && cmd.every((s, i) => s === LEGACY_NOOP_GATE[i]);

/** Parse a cycle's `events.jsonl` (path-guarded); a torn line is skipped, an absent/refused file is named. */
export function readCycleEvents(logsRoot: string, cycleId: string): CycleEvent[] | { unreadable: string } {
  const text = guardedReadFile(logsRoot, [cycleId, 'events.jsonl']);
  if (text === null) return { unreadable: `${cycleId}/events.jsonl is absent or refused by the path guard` };
  const out: CycleEvent[] = [];
  for (const line of text.split('\n')) if (line.trim()) try { out.push(JSON.parse(line) as CycleEvent); } catch { /* a torn line is not evidence */ }
  return out;
}

/** The recovered gate command for `id`, or the named reason it cannot be. */
function recoverGateCmd(id: string, events: readonly CycleEvent[]): { cmd: string[] } | { reason: string } {
  const cycleEvent = (e: CycleEvent, message: string) => e.phase === 'orchestrator' && e.skill === 'cycle' && e.message === message;
  let at = -1;
  for (let i = events.length - 1; i >= 0 && at < 0; i--) {
    const e = events[i]!;
    const ids = e.metadata?.appended_work_items;
    if (cycleEvent(e, 'merge-gate.fix-loop.compiled') && Array.isArray(ids) && ids.includes(id)) at = i;
  }
  if (at < 0) return { reason: 'no merge-gate.fix-loop.compiled event in the cycle log names this work item' };
  const compiled = events[at]!.metadata ?? {};
  if (compiled.gate_cmd !== undefined) {
    return isCmd(compiled.gate_cmd) ? { cmd: [...compiled.gate_cmd] } : { reason: 'the compiled event carries a malformed gate_cmd' };
  }
  const failed = compiled.failed_gate;
  if (failed !== 'local' && failed !== 'ci') {
    return { reason: `failed_gate ${JSON.stringify(failed ?? null)} has no recorded command (no gate_cmd on the compiled event)` };
  }
  // 'local': the local gate that went red. 'ci': the LOCAL gate the fix WI would run (any verdict).
  for (let i = at - 1; i >= 0; i--) {
    const m = events[i]!.metadata;
    if (!cycleEvent(events[i]!, 'cycle.merge-gate') || m?.gate !== 'local' || (failed === 'local' && m.ok !== false)) continue;
    return isCmd(m.cmd) ? { cmd: [...m.cmd] } : { reason: 'the cycle.merge-gate local event carries no usable cmd' };
  }
  return { reason: failed === 'local' ? 'no red local cycle.merge-gate event precedes the compile' : 'no local cycle.merge-gate event precedes the CI-gate compile (no local gate to run)' };
}

/** Rewrite each legacy no-op gate-fix WI the events still name; never throws, untouched WIs unreported. */
export function normaliseLegacyFixGates(a: { worktreePath: string; events: readonly CycleEvent[] | { unreadable: string } }): LegacyGateReport {
  const report: LegacyGateReport = { rewritten: [], unresolved: [] };
  const pending = readPendingFixWorkItems(a.worktreePath);
  if (!Array.isArray(pending)) return { rewritten: [], unresolved: [{ work_item_id: '(work-items)', reason: `fix work-item queue unreadable: ${pending.unreadable}` }] };
  for (const wi of pending) {
    if (wi.origin !== 'gate-fix' || !isNoop(wi.quality_gate_cmd)) continue;
    const id = wi.work_item_id;
    const found = 'unreadable' in a.events ? { reason: `events.jsonl unreadable: ${a.events.unreadable}` } : recoverGateCmd(id, a.events);
    if ('reason' in found) { report.unresolved.push({ work_item_id: id, reason: found.reason }); continue; }
    if (isNoop(found.cmd)) { report.unresolved.push({ work_item_id: id, reason: 'the recorded gate command is itself the no-op' }); continue; }
    try {
      writeWorkItem({ ...wi, quality_gate_cmd: found.cmd }, a.worktreePath, { workItemsDir: devWorkItemsDir(a.worktreePath) });
      report.rewritten.push({ work_item_id: id, cmd: found.cmd });
    } catch (err) {
      report.unresolved.push({ work_item_id: id, reason: `rewrite refused: ${err instanceof Error ? err.message.split('\n').join(' ') : String(err)}` });
    }
  }
  return report;
}

/** Re-entry: normalise and emit ONE named event if anything changed (`error` if unresolved); never blocks re-entry. */
export function normaliseLegacyFixGatesAtReentry(a: { worktreePath: string; initiativeId: string; cycleId: string; logsRoot: string }): LegacyGateReport {
  try {
    const report = normaliseLegacyFixGates({ worktreePath: a.worktreePath, events: readCycleEvents(a.logsRoot, a.cycleId) });
    if (report.rewritten.length === 0 && report.unresolved.length === 0) return report;
    createLogger(a.cycleId, a.logsRoot).emit({
      initiative_id: a.initiativeId, phase: 'review-loop', skill: 'fix-loop-drain',
      event_type: report.unresolved.length > 0 ? 'error' : 'log', input_refs: [a.worktreePath],
      output_refs: report.rewritten.map((r) => `.forge/work-items/${r.work_item_id}.md`),
      message: LEGACY_GATE_NORMALISED_MESSAGE, metadata: { rewritten: report.rewritten, unresolved: report.unresolved },
    });
    return report;
  } catch (err) {
    // Hygiene, not a gate: a failed emit must not block the re-entry — but it is said, not swallowed.
    console.error(`[fix-loop] legacy-gate normalisation failed for ${a.initiativeId}: ${err instanceof Error ? err.message : String(err)}`);
    return { rewritten: [], unresolved: [] };
  }
}
