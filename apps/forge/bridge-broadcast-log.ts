/**
 * The bridge's record of its own socket broadcasts — `forge-8vfn.7.6.35`
 * (T1 ruling 753(1), raised by M6-C from the other side).
 *
 * THE QUESTION THAT COULD NOT BE ANSWERED. S10 run 12's trace had to establish
 * whether the bridge broadcast `cycle-list-changed` when the daemon moved a
 * manifest through the queue, and it could not be answered at all: the run
 * booted its own bridge, left no `_bridge-*` dir, and `broadcast` recorded
 * nothing. The strongest available statement was "`watchQueue` watches all six
 * dirs, the manifest demonstrably moved, therefore it must have broadcast" — a
 * mechanism plus a disk state, not a measurement.
 *
 * SUBSCRIBER COUNT is what makes the record a DISCRIMINATOR rather than a note.
 * `type` and the timestamp say the bridge spoke; `subscribers` says whether
 * anyone was listening. A stale card with NO broadcast is a watcher defect
 * (`ui-bridge.ts`'s queue watch); a stale card WITH a broadcast and a
 * subscriber is a subscriber defect (`use-roadmap-live-refresh.ts`). Those are
 * different beads in different files and nothing on disk told them apart.
 *
 * NEVER GATED BEHIND `FORGE_BRIDGE_DEBUG`. The ws-lifecycle logging beside it is,
 * and that gate is precisely why run 12's bridge recorded nothing: a record that
 * exists only when someone thought to ask for it is the gap this closes. Volume
 * is bounded by real event production rather than by the 200 ms tail poll —
 * `pumpTail` returns early unless the file GREW — so there is nothing to cap.
 *
 * OPENED AT BOOT, NOT ON FIRST BROADCAST, and the reason is the story harness.
 * `isDispatchDir` (`scripts/stories/beats-agent-proc.mjs`) treats ANY
 * `_`-prefixed `_logs` entry as a dispatch dir, and a beat's agent-channel door
 * anchors on the newest one BORN AFTER a press. A lazily-opened bridge run
 * would be born mid-story on the very queue change a press caused, and door a
 * beat onto the bridge's own log. Born at boot it predates every press, and the
 * door filters by birth time. `emitGroundFileChanges` deliberately opens no run
 * for a no-op and this is the exception that proves its rule: for THIS question
 * an empty log is an ANSWER — "the bridge broadcast nothing" — where an absent
 * dir answers nothing at all.
 *
 * It lives in its own file because folding it into `ui-bridge.ts` grew that file
 * from 2276 to 2310 lines and `check-file-size` refused it: "an exemption is a
 * ceiling, not a licence". §15.412 — shrink the addition, not the cap.
 */

import { join } from 'node:path';

import { createLogger, bridgeCycleId, type EventLogger } from '@forge/kernel';

/** The shape `broadcast` is called with — structural, so this file never imports back into `ui-bridge.ts`. */
type Broadcastable = { type: string; cycleId?: string };

/**
 * Build the bridge's `broadcast`: send to every open client, then record what
 * was said and how many heard it. One function, so a caller cannot send without
 * recording — the convention this bead exists because nobody kept.
 */
export function makeRecordingBroadcast<T extends Broadcastable>(
  clients: Set<{ readyState: number; OPEN: number; send: (payload: string) => void }>,
  forgeRoot: string,
): (msg: T) => void {
  const log: EventLogger = createLogger(bridgeCycleId(), join(forgeRoot, '_logs'));
  return (msg: T): void => {
    const payload = JSON.stringify(msg);
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) {
        try { ws.send(payload); } catch { /* dropped client */ }
      }
    }
    try {
      log.emit({
        initiative_id: log.cycleId,
        phase: 'orchestrator',
        skill: 'bridge',
        event_type: 'log',
        input_refs: [],
        output_refs: [],
        message: `broadcast.${msg.type}`,
        metadata: {
          broadcast: true,
          type: msg.type,
          ...(msg.cycleId === undefined ? {} : { cycleId: msg.cycleId }),
          subscribers: clients.size,
        },
      });
    } catch { /* a bridge that cannot write its own log must still serve */ }
  };
}
