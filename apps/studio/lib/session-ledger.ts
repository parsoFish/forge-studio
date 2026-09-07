/**
 * Sessions as ledger rows — M6-A exit row 3, S9 beats 13-14.
 *
 * `/monitor` carries the one cross-run ledger forge keeps, and until now a
 * session an operator started from the spine could never appear in it: it is
 * fed by `GET /api/agents/runs/recent`, which joins flow runs and standalone
 * dispatches, and a session is neither. S9's own record put the consequence
 * in one sentence — *an operator can hand any of S1-S8 to the assistant and
 * there is no surface in Studio that will ever tell them what it cost.*
 *
 * WHICH SESSIONS, and why not all of them. S9 run 2 measured `/monitor` with
 * two live sessions and found `data-ledger-total="1"`, the row belonging to
 * `onboarding-agent`: onboarding dispatches through `spawnAgentDispatch`, so
 * it genuinely IS a standalone run and already has a row. Joining every
 * session would list that work twice and inflate the total the operator reads
 * as their spend. So this joins exactly the sessions the run host never saw —
 * `runId === null`, the ADR-043 spine ones — and leaves the rest to the row
 * they already have.
 */
import type { LedgerRow } from './history-ledger';
import type { SessionIndexRow } from './studio-client';

/**
 * One ledger row per SPINE session (`runId === null`), newest-first ordering
 * left to the caller's own merge — the same discipline `deriveFlowLedgerRows`
 * keeps.
 *
 * `costUsd` and `agent` are the server's, verbatim: the cost is the kernel
 * event-cost rule's figure (`null` where no priced row exists, which
 * `HistoryLedger` renders by OMITTING the attribute rather than showing
 * `0.00`), and the agent is the session kind's own descriptor field, so this
 * module never needs a second kind->agent map to disagree with.
 */
export function deriveSessionLedgerRows(sessions: readonly SessionIndexRow[]): LedgerRow[] {
  return sessions
    .filter((s) => s.runId === null)
    .map((s) => ({
      id: s.sessionId,
      when: s.updatedAt,
      what: s.kind,
      // No segment kind applies to a session — honest null, never filler.
      narrative: null,
      narrativeKinds: [],
      status: s.phase,
      costUsd: s.costUsd,
      href: s.href,
      linkKind: 'session' as const,
      agent: s.agent,
    }));
}
