/**
 * Pure mapper from a real orchestrator event (`EventLogEntry`,
 * `./bridge-client.ts` — the same client-side shape `EventTail.tsx` already
 * consumes) to the shared run-view display vocabulary: exactly THREE kinds —
 * `think | tool | out` — never a fourth. See `./run-log-line.test.ts`'s
 * header for the full rationale: `orchestrator/logging.ts`'s real `EventType`
 * union has 11 members; this maps ONTO the mockup's 3-bucket display
 * vocabulary, it never invents a new event-type vocabulary of its own.
 *
 * Mapping (11 real types -> 3 display kinds):
 *   - `tool_use`                          -> 'tool'   (an actual tool call)
 *   - `iteration`                         -> 'think'  (closest real analogue
 *                                             to the mockup's reasoning-step
 *                                             entries)
 *   - `start` / `end`                     -> 'out'    (session terminals —
 *                                             the REAL terminals; there is no
 *                                             separate 'SessionStart' type)
 *   - `error`                             -> 'out'    (surfaced as output —
 *                                             its real `message` is ALWAYS
 *                                             preserved verbatim, never
 *                                             replaced by a generic string)
 *   - `phase_transition`                  -> 'think'  (an orchestrator-level
 *                                             deliberation boundary, not a
 *                                             concrete tool call or a final
 *                                             output)
 *   - `agent_heartbeat`                   -> 'think'  (a liveness pulse
 *                                             during a silent SDK call — the
 *                                             agent is "thinking", not
 *                                             producing output or invoking a
 *                                             tool)
 *   - `brain-query`                       -> 'tool'   (a planner querying the
 *                                             brain index is, mechanically, a
 *                                             tool-shaped lookup)
 *   - `file_change` / `test_run`          -> 'tool'   (both are effects of a
 *                                             tool invocation — Edit/Write,
 *                                             or a test-runner command)
 *   - `log` (incl. materials-staged, spawn-suppressed, dispatch-failed
 *     markers)                            -> 'out'    (freeform narration —
 *                                             never filtered out of the
 *                                             mapped stream)
 *   - anything outside the 11-member union -> 'out'    (unrecognised — never
 *                                             crashes, never vanishes; the
 *                                             raw `event_type` stays visible
 *                                             both structurally, via
 *                                             `eventType`, and in `text`)
 */

import type { EventLogEntry } from './bridge-client.ts';

export type RunLogLine = {
  kind: 'think' | 'tool' | 'out';
  text: string;
  /** The RAW event_type this line was derived from — never dropped, even
   *  for a type outside the real 11-member union. */
  eventType: string;
};

const TOOL_TYPES = new Set(['tool_use', 'brain-query', 'file_change', 'test_run']);
const THINK_TYPES = new Set(['iteration', 'phase_transition', 'agent_heartbeat']);

function kindFor(eventType: string): RunLogLine['kind'] {
  if (TOOL_TYPES.has(eventType)) return 'tool';
  if (THINK_TYPES.has(eventType)) return 'think';
  return 'out';
}

/** W7-B5 (agents-19): the structured failure reason a server-side marker
 *  records (`agent-dispatch.failed` → `metadata.error`) — previously
 *  UNREACHABLE from this renderer, so a failed run's only visible trace was
 *  the bare marker name. Appended verbatim to the line body whenever an
 *  event carries one. */
function metadataError(event: EventLogEntry): string | null {
  const err = event.metadata?.['error'];
  return typeof err === 'string' && err.length > 0 ? err : null;
}

function textFor(event: EventLogEntry): string {
  const detail = metadataError(event);
  switch (event.event_type) {
    case 'start':
      return `start · ${event.skill}`;
    case 'end':
      return `end · ${event.skill}${typeof event.cost_usd === 'number' ? ` · $${event.cost_usd.toFixed(4)}` : ''}`;
    case 'error': {
      // The real failure detail is never discarded — no "an error occurred"
      // placeholder even when `message` happens to be present.
      const base = event.message ? `error: ${event.message}` : `error (${event.skill})`;
      return detail !== null && detail !== event.message ? `${base} — ${detail}` : base;
    }
    default: {
      const base = event.message ?? `${event.event_type} (${event.skill})`;
      return detail !== null ? `${base} — ${detail}` : base;
    }
  }
}

/** Map one real orchestrator event onto the shared 3-kind display vocabulary. */
export function deriveLogLine(event: EventLogEntry): RunLogLine {
  return {
    kind: kindFor(event.event_type),
    text: textFor(event),
    eventType: event.event_type,
  };
}
