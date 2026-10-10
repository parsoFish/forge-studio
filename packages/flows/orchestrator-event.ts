/**
 * The scheduler's one best-effort orchestrator-event append, shared by `scheduler-run-one.ts`
 * and `scheduler-sweeps.ts` (the sweep must not import run-one: run-one imports the sweeps).
 */

import { existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * SPEC §2 (M3-6) + bead forge-8vfn.8.1.8: append an event to the
 * initiative's JSONL log. Best-effort — the cycle logger isn't open yet at
 * either call site. Missing dir is created on the fly. `logsRoot` (forge-8vfn.8.1.10) is ALREADY the `_logs` root.
 */
export function emitOrchestratorEvent(
  logsRoot: string,
  initiativeId: string,
  eventType: 'error' | 'log',
  message: string,
  metadata: Record<string, unknown>,
): void {
  try {
    const logDir = resolve(logsRoot, initiativeId);
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
    const entry = {
      event_id: `${message}-${Date.now()}`,
      cycle_id: initiativeId,
      initiative_id: initiativeId,
      started_at: new Date().toISOString(),
      phase: 'orchestrator',
      skill: 'scheduler',
      event_type: eventType,
      input_refs: [] as string[],
      output_refs: [] as string[],
      message,
      metadata,
    };
    const logPath = join(logDir, 'events.jsonl');
    appendFileSync(logPath, JSON.stringify(entry) + '\n');
  } catch {
    /* best-effort — never throw from a refusal/hygiene path */
  }
}
