/**
 * forge-mfv5.1.47 (row 3, D-06 + D-20) — the dev loop's first act on a develop
 * RESUME: if `.forge/work-items/` is gone, restore it from the cycle's own
 * record (`restoreWorkItemsForResume`, @forge/flows) before the queue is read,
 * or refuse by name — a `work-items.restore-refused` event and a throw naming
 * the missing source, never the unclassified "no work items found". A run that
 * is not a develop resume, or whose queue is present, is never touched.
 */
import { join, resolve } from 'node:path';
import { FORGE_ROOT, type EventLogger } from '@forge/kernel';
import { restoreWorkItemsForResume, type CycleInput } from '@forge/flows';

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
