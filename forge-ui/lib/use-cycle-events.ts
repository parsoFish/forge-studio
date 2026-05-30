'use client';

import { useEffect, useRef, useState } from 'react';

import { fetchEvents, subscribe, type BridgeMessage, type EventLogEntry } from './bridge-client';

/**
 * Event tail for a single cycle/session: snapshots `fetchEvents(cycleId)` then
 * streams live `event` messages, deduped by `event_id` against the initial
 * fetch (the live tail replays from offset 0). Every non-`event` bridge
 * message (snapshot / cycle-list-changed / architect-list-changed) is handed
 * to `onSignal` so the caller can refresh its own data on the trigger it
 * cares about. Shared by the three focused screens (architect / review /
 * reflect), which previously each inlined this subscribe+dedup block.
 */
export function useCycleEvents(
  cycleId: string,
  onSignal?: (msg: BridgeMessage) => void,
): EventLogEntry[] {
  const [events, setEvents] = useState<EventLogEntry[]>([]);
  // Capture onSignal in a ref so a fresh closure each render doesn't churn the
  // subscription (which is keyed on cycleId only).
  const signalRef = useRef(onSignal);
  signalRef.current = onSignal;

  useEffect(() => {
    let cancelled = false;
    setEvents([]);
    fetchEvents(cycleId).then((rows) => { if (!cancelled) setEvents(rows); }).catch(() => {});
    const sub = subscribe({
      onMessage: (msg) => {
        if (msg.type === 'event') {
          if (msg.cycleId === cycleId) {
            setEvents((prev) =>
              prev.some((e) => e.event_id === msg.event.event_id) ? prev : [...prev, msg.event],
            );
          }
        } else {
          signalRef.current?.(msg);
        }
      },
    });
    return () => { cancelled = true; sub.close(); };
  }, [cycleId]);

  return events;
}
