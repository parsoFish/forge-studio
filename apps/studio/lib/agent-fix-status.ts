/**
 * The agent-fix run status read — the wire shape and its parse, shared by
 * `getAgentFixStatus` (a per-finding fix-agent run AND a consolidate run,
 * both `readBrainFixState` server-side) and `preflightFixStatus`.
 *
 * WHY THIS IS ITS OWN FILE. `studio-client.ts` is far over the 800-line cap
 * on a `file-size.json` exemption, and an exemption is a ceiling, not a
 * licence (see `studio-client-reset.ts`'s header for the same move). Row 201
 * (forge-8vfn.8.5.41) needed this shape to carry a consolidate batch's
 * `ceilingHit`/`spendUnknown`, so the shape moved here instead of growing the
 * monolith. `studio-client.ts` re-exports the type; the fetch stays there.
 */

import type { BridgeReadResult } from './bridge-result';

/** W7-FIX-A1 (A1-10): `'unknown'` is BOTH the bridge's own honest "no state
 *  recorded" (`ok:true`) AND the failed-read shape (`ok:false` + `error`, the
 *  bridge's text verbatim / "bridge unreachable (…)") — never a fabricated
 *  `'running'`. `agent-dispatch.ts`'s poll wrappers keep watching on `ok:false`
 *  (bounded), so a blip is a visible read failure, not a stopped run. */
export type AgentFixStatus = {
  ok: boolean;
  state: 'running' | 'cleared' | 'not-cleared' | 'failed' | 'unknown';
  cleared: boolean;
  /** Present only for a `consolidate` run's terminal status — the bridge's
   *  `readBrainFixState` threads them through from the terminal event's own
   *  metadata (W8-F1 / knowledge-42). A per-finding `fix-agent` run never
   *  writes these, so they stay genuinely absent for it — never fabricated. */
  total?: number;
  clearedCount?: number;
  /** Row 201 (forge-8vfn.8.5.41) — present only on a consolidate terminal
   *  that stopped on its cost ceiling (`ceilingHit`) or on a fix turn whose
   *  spend could not be priced (`spendUnknown`, which the server also marks
   *  `ceilingHit`). Threaded from `readBrainFixState`; never fabricated. */
  ceilingHit?: true;
  spendUnknown?: true;
  /** Present only on a failed read (`ok:false`). */
  error?: string;
  /** On a failed read: the HTTP status iff the bridge ANSWERED (a 404 "no
   *  such run" is a definitive answer, not a blip); absent = transport. */
  status?: number;
};

export type AgentFixWire = { state?: string; cleared?: boolean; total?: number; clearedCount?: number; ceilingHit?: unknown; spendUnknown?: unknown };

export function parseAgentFixStatus(r: BridgeReadResult<AgentFixWire>): AgentFixStatus {
  if (!r.ok) return { ok: false, state: 'unknown', cleared: false, error: r.error, ...(r.status !== undefined ? { status: r.status } : {}) };
  return {
    ok: true,
    state: (r.data.state as AgentFixStatus['state']) ?? 'unknown',
    cleared: r.data.cleared === true,
    ...(typeof r.data.total === 'number' ? { total: r.data.total } : {}),
    ...(typeof r.data.clearedCount === 'number' ? { clearedCount: r.data.clearedCount } : {}),
    ...(r.data.ceilingHit === true ? { ceilingHit: true as const } : {}),
    ...(r.data.spendUnknown === true ? { spendUnknown: true as const } : {}),
  };
}
