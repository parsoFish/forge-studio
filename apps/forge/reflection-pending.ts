/**
 * Reflections waiting on the operator, derived at read time (D-26) from the
 * cycle log dirs — never stored.
 *
 * forge-nk1y.3: stranger attempt 2's interactive reflector wrote its questions
 * and the cycle went to `done/`, but no Studio surface listed the unanswered
 * reflection. A cycle is pending when ALL of:
 *   - `reflect-mode.json` says `interactive` (written at reflector start since
 *     R4-09-F3; a cycle without it predates reflect modes and is not listed),
 *   - `user-questions.json` exists (the reflector reached its post-exit
 *     derivation; a still-running reflector has none yet),
 *   - neither `user-feedback.md` (answered) nor `reflection-closed.json`
 *     (closed with no questions) exists.
 *
 * Status: `awaiting` (questions to answer) · `unasked` (the reflector asked
 * nothing — Studio offers the one close act) · `unreadable` (a questions or
 * mode file that does not parse — named, never dropped).
 */
import { existsSync, readdirSync } from 'node:fs';

import { guardedFile, guardedReadFile } from '@forge/kernel';

/** Written by the gate's close act for a reflection that asked nothing. Its
 *  own file, not `user-feedback.md`: the boot reconcile re-runs the reflector
 *  for fresh feedback, and a close is not feedback. */
export const REFLECTION_CLOSED_FILE = 'reflection-closed.json';

export type PendingReflectionStatus = 'awaiting' | 'unasked' | 'unreadable';

export type PendingReflection = {
  cycleId: string;
  initiativeId: string;
  questions: number;
  status: PendingReflectionStatus;
};

/** `<timestamp>_<initiativeId>` → `<initiativeId>`; a name with no `_` is its own id. */
function initiativeOf(cycleId: string): string {
  const cut = cycleId.indexOf('_');
  return cut === -1 ? cycleId : cycleId.slice(cut + 1);
}

function parse(raw: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

/** One cycle dir's pending row, or null when it is not waiting on the operator. */
export function pendingReflectionOf(logsRoot: string, cycleId: string): PendingReflection | null {
  // Answered or closed first: the cheap existence checks before any read.
  if (guardedFile(logsRoot, [cycleId, 'user-feedback.md'], 'read') !== null) return null;
  if (guardedFile(logsRoot, [cycleId, REFLECTION_CLOSED_FILE], 'read') !== null) return null;
  const modeRaw = guardedReadFile(logsRoot, [cycleId, 'reflect-mode.json']);
  if (modeRaw === null) return null;
  const questionsRaw = guardedReadFile(logsRoot, [cycleId, 'user-questions.json']);
  if (questionsRaw === null) return null;

  const initiativeId = initiativeOf(cycleId);
  const mode = parse(modeRaw);
  const questions = parse(questionsRaw);
  if (!mode.ok || !questions.ok || !Array.isArray(questions.value)) {
    return { cycleId, initiativeId, questions: 0, status: 'unreadable' };
  }
  if ((mode.value as { mode?: unknown } | null)?.mode !== 'interactive') return null;
  const count = questions.value.length;
  return { cycleId, initiativeId, questions: count, status: count > 0 ? 'awaiting' : 'unasked' };
}

/**
 * Every pending reflection under `logsRoot`, newest cycle first. A `_`-prefixed
 * dir (`_sessions`, `_bridge-*`, `_agent-*`) is never a cycle. A logs root not
 * created yet (no cycle has run) holds nothing; one that exists but cannot be
 * listed throws (readdirSync) — the route answers 500, never an empty
 * "nothing waiting".
 */
export function listPendingReflections(logsRoot: string): PendingReflection[] {
  // `logsRoot` is the host's own trusted root (bridge-cycle-scan.ts lists it
  // the same way); each listed name is then read only through the per-segment
  // guard, so a symlinked cycle dir or leaf is refused, never followed.
  if (!existsSync(logsRoot)) return [];
  const names = readdirSync(logsRoot);
  const rows: PendingReflection[] = [];
  for (const name of names) {
    if (name.startsWith('_') || name.startsWith('.')) continue;
    const row = pendingReflectionOf(logsRoot, name);
    if (row !== null) rows.push(row);
  }
  return rows.sort((a, b) => (a.cycleId < b.cycleId ? 1 : a.cycleId > b.cycleId ? -1 : 0));
}
