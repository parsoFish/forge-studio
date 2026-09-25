/**
 * pm-rejected-set.ts — what happens to a work-item set the PM's own validation
 * rejected. Bead forge-8vfn.6.1 (P0).
 *
 * THE DEFECT THIS CLOSES, in one sentence: the project-manager phase validated
 * the set it had written, failed it, returned `{kind: 'failure'}` — and the
 * dev-loop ran that set anyway, merged it to a real project and cut a release,
 * because every downstream claimant reads the work-items DIRECTORY while the
 * only thing the failure path withheld was the manifest's `specs` pointer.
 * Reproduced live by G1 run 3 (2026-09-04): `WI-3: creates is required (ADR 037)`
 * at 15:38:26, `WI-1 dev started` at 15:38:35, merged as gitpulse #15 at 16:05.
 *
 * §15.167 — the gate was on the wrong artifact. Withholding a pointer while
 * leaving the payload readable is not a gate; it is a note. So the payload moves.
 *
 * MOVED, NOT DELETED. A rejected set is the best evidence anyone has about why
 * the decomposition failed, and deleting it would trade one silent failure for
 * another. It goes to a timestamped sibling directory with the set errors beside
 * it, which also means two failed passes cannot overwrite each other.
 *
 * This function never throws. It runs on a path that is ALREADY failing, and a
 * quarantine error must not replace the real summary with its own.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { EventLogger } from '@forge/kernel';
import { WORK_ITEM_FILE_PATTERN } from '@forge/flows/work-item.ts';

/** What `rejectWorkItemSet` needs in order to record the quarantine itself. */
export type RejectionEvent = {
  logger: EventLogger;
  initiativeId: string;
  parentEventId?: string;
};

export type QuarantineResult = {
  /** Absolute path of the directory the set was moved to, or null if there was nothing to move. */
  movedTo: string | null;
  /** How many work-item files were moved. */
  count: number;
};

/** Filename of the record placed beside a quarantined set. */
export const REJECTION_REASON_FILENAME = 'REJECTED.md';

/**
 * Move every file out of `workItemsDir` into a timestamped
 * `work-items-rejected-<stamp>` sibling, writing `setErrors` beside them, so that
 * `hasWorkItemFiles(workItemsDir)` — the predicate `enqueue-flow-run.ts`,
 * `cycle.ts`, `fix-work-items.ts` and `requeue-resume.ts` all claim on — is false.
 */
export function quarantineRejectedSet(workItemsDir: string, setErrors: readonly string[]): QuarantineResult {
  try {
    if (!existsSync(workItemsDir)) return { movedTo: null, count: 0 };
    const names = readdirSync(workItemsDir);
    if (names.length === 0) return { movedTo: null, count: 0 };

    // A monotonic suffix, so a second failed pass in the same second still gets
    // its own directory rather than colliding with the first one's evidence.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    let dest = join(dirname(workItemsDir), `work-items-rejected-${stamp}`);
    for (let n = 2; existsSync(dest); n++) dest = join(dirname(workItemsDir), `work-items-rejected-${stamp}-${n}`);
    mkdirSync(dest, { recursive: true });

    let count = 0;
    for (const name of names) {
      try {
        renameSync(join(workItemsDir, name), join(dest, name));
        if (WORK_ITEM_FILE_PATTERN.test(name)) count += 1;
      } catch { /* one unmovable file must not strand the rest */ }
    }

    try {
      writeFileSync(
        join(dest, REJECTION_REASON_FILENAME),
        [
          '# Rejected work-item set',
          '',
          'This set failed the project-manager phase\'s own validation and was moved here so that',
          'nothing downstream could claim it. It is kept, not deleted, because it is the evidence',
          'for why the decomposition failed.',
          '',
          '## Set errors',
          '',
          ...setErrors.map((e) => `- ${e}`),
          '',
        ].join('\n'),
      );
    } catch { /* the move is the guarantee; the note is a courtesy */ }

    return { movedTo: dest, count };
  } catch {
    // Never throw from a failing path.
    return { movedTo: null, count: 0 };
  }
}

/**
 * The ONLY way the project-manager phase fails after it has read a set.
 *
 * §15.80 — a convention documented beside a call site is a defect waiting for the
 * next copy. "Return failure AND remember to quarantine" is a pair someone will
 * eventually half-apply, which is how forge-8vfn.6.1 shipped in the first place:
 * the failure return and the withheld pointer were right, and the payload was
 * simply forgotten. Fusing the two leaves nothing to forget — a caller cannot
 * express "fail without quarantining" because this function is the failure.
 */
export function rejectWorkItemSet(
  workItemsDir: string,
  summary: string,
  ev?: RejectionEvent,
): { kind: 'failure'; summary: string } {
  const q = quarantineRejectedSet(workItemsDir, [summary]);
  if (q.movedTo && ev) {
    // Emitted HERE, not by the caller: the event is part of the act. A caller that
    // has to remember to log the quarantine is the same half-applicable pair the
    // fusion above exists to remove.
    try {
      ev.logger.emit({
        initiative_id: ev.initiativeId,
        parent_event_id: ev.parentEventId,
        phase: 'project-manager',
        skill: 'project-manager',
        event_type: 'error',
        input_refs: [workItemsDir],
        output_refs: [q.movedTo],
        message: 'pm.rejected-set-quarantined',
        metadata: { work_items_moved: q.count, moved_to: q.movedTo },
      });
    } catch { /* never throw from a failing path */ }
  }
  return {
    kind: 'failure',
    summary: q.movedTo ? `${summary} — the rejected set was moved to ${q.movedTo} and is not claimable` : summary,
  };
}
