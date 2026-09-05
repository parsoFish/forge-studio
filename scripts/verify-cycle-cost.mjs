/**
 * verify-cycle-cost.mjs — what one verify-cycle RUN cost, across both of its logs.
 * Bead forge-8vfn.18.
 *
 * `sumCycleCost(cycleId)` read `_logs/<cycleId>/events.jsonl` and nothing else, so
 * `--cost-ceiling` bounded stages 2-3 only. Stage 1 lives in
 * `_logs/_architect-<sessionId>/events.jsonl`, and `driveArchitect` has always
 * RETURNED that session id — the caller destructured `{ initiatives }` and dropped
 * it. Two funded G1 runs therefore reported a stage-2/3 figure as their total, and
 * run 4, which aborted after stage 1, reported no cost at all for a run that had
 * spent one.
 *
 * `logsRoot` is a parameter so this is testable against a fixture rather than only
 * reachable by a funded run (§15.163). Every path resolves from it; nothing here
 * reads cwd (§15.148).
 *
 * Bead forge-8vfn.6.10.22 corrected the other half of the same number: summing
 * BOTH logs over-counts, because the cycle log already restates stage 1.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { costBreakdownFromLines } from './lib/verify-outcomes.mjs';

function readLog(dir) {
  try {
    return costBreakdownFromLines(readFileSync(join(dir, 'events.jsonl'), 'utf8').split('\n'));
  } catch {
    // A log that does not exist is 0 spend, not an error: an aborted run may have
    // one of the two, and the honest total is what did happen.
    return { totalUsd: 0, architectUsd: 0 };
  }
}

/**
 * @param {string} cycleId                     the develop cycle's log directory name
 * @param {string|null} architectSessionId     stage 1's session id, or null
 * @param {string} logsRoot                    absolute path to `_logs`
 * @returns {number} authoritative spend across both logs
 */
export function sumRunCost(cycleId, architectSessionId, logsRoot) {
  const cycle = cycleId ? readLog(join(logsRoot, cycleId)) : { totalUsd: 0, architectUsd: 0 };
  // Bead forge-8vfn.6.10.22: the cycle log already carries stage 1's spend, so
  // adding the architect's session log on top counts it twice — half of the
  // harness's $28.64 against G2's real $23.9721. Add stage 1 only when the cycle
  // log does not carry it, keeping bead 18's case (aborted after stage 1, no
  // cycle log at all). Keyed on DOLLARS, not on an architect row's presence: a
  // legacy manifest still gets a ZERO-cost synthetic pair, and keying on
  // presence would drop a real session for exactly those runs.
  const architect =
    architectSessionId && cycle.architectUsd === 0
      ? readLog(join(logsRoot, `_architect-${architectSessionId}`)).totalUsd
      : 0;
  return Number((cycle.totalUsd + architect).toFixed(10));
}
