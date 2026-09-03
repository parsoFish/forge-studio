/**
 * The REAL brain-fix turn, bound HERE because this is the one place that may
 * import both sides (M4 ruling 86, amended).
 *
 * `packages/knowledge` is rank 2 and `packages/sessions` is rank 4, so the KB
 * drain and the consolidate loop may not import the turn they dispatch. They
 * declare a PORT instead — `KbDrainRunFixTurnFn` and its input/result, in
 * knowledge's own vocabulary — and this file supplies the implementation.
 *
 * The direction matters and is why nothing was lifted into `@forge/contracts`:
 * sessions importing knowledge's `KbEditGateResult` is DOWNWARD and legal (and
 * `kinds/brain-fix.ts` does exactly that), so the shared shape needed no
 * neutral home. Only knowledge's upward declaration had to stop. Lifting the
 * result type would have dragged `KbEditGateResult`, `KbEditChange` and
 * `KbEditUnsoundness` — knowledge's brain-edit vocabulary, named across six of
 * its files — out of the package that owns them.
 *
 * `apps/forge` is unranked assembly and may import both, which is what makes
 * this the honest seam rather than a workaround. The assignment below is also
 * the CONFORMANCE CHECK: `realKbDrainFixTurn` is typed as the port, so if
 * sessions' turn and knowledge's port ever drift, this file fails to compile.
 * It only bites under the repo-wide `npm run build` — `apps/` is outside every
 * package tsconfig (§15.71) — which is stated so the check is not mistaken for
 * one a package typecheck would catch.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { runBrainFixTurn } from '@forge/sessions/kinds/brain-fix.ts';
import type { KbDrainRunFixTurnFn } from '@forge/knowledge';

/**
 * Reads a brain-fix sub-turn's own terminal `cost_usd` back out of its event
 * log.
 *
 * This moved here from `bridge-studio-kb-drain.ts` with ruling 86, and the
 * move is the point: the function encodes the TURN's log layout
 * (`_logs/_brainfix-<runId>/events.jsonl`, the `brain-fix.end` message, the
 * `cost_usd` field), which is knowledge of the turn rather than of the drain.
 * It belongs beside the turn's binding, not inside its consumer.
 *
 * `subRunId` is NEVER request-derived — the drain always synthesizes it as
 * `` `${runId}__r${round}__${i}` ``, never the route's own `runId` — so no
 * curated taint-list name reaches this sink. Mirrors `readBrainFixState`'s
 * scan-backward shape but extracts `cost_usd` instead of the cleared/failed
 * state. Returns 0 on any read/parse failure or a crashed turn: a failed turn
 * accrues zero cost toward the ceiling, matching the turn's own crash path,
 * which never reaches the cost-bearing `end` event.
 */
function readBrainFixTurnCostUsd(forgeRoot: string, subRunId: string): number {
  const evPath = join(forgeRoot, '_logs', `_brainfix-${subRunId}`, 'events.jsonl');
  if (!existsSync(evPath)) return 0;
  let raw: string;
  try {
    raw = readFileSync(evPath, 'utf8');
  } catch {
    return 0;
  }
  for (const line of raw.split('\n').reverse()) {
    if (!line.trim()) continue;
    let ev: { event_type?: string; message?: string; cost_usd?: number };
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.event_type === 'end' || ev.message?.startsWith('brain-fix.end')) {
      return typeof ev.cost_usd === 'number' ? ev.cost_usd : 0;
    }
    if (ev.event_type === 'error' || ev.message === 'brain-fix.crashed') return 0;
  }
  return 0;
}

/**
 * The real fix turn, plus the cost the turn itself does not return.
 *
 * Typed as `KbDrainRunFixTurnFn` on purpose — see the header: this annotation
 * is the drift check between sessions' turn and knowledge's port.
 */
export const realKbDrainFixTurn: KbDrainRunFixTurnFn = async (input) => {
  const result = await runBrainFixTurn(input);
  const costUsd = readBrainFixTurnCostUsd(input.forgeRoot, input.runId);
  return { ...result, costUsd };
};
