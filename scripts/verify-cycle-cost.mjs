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
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sumAuthoritativeCostFromLines } from './lib/verify-outcomes.mjs';

function sumLog(dir) {
  try {
    return sumAuthoritativeCostFromLines(readFileSync(join(dir, 'events.jsonl'), 'utf8').split('\n'));
  } catch {
    // A log that does not exist is 0 spend, not an error: an aborted run may have
    // one of the two, and the honest total is what did happen.
    return 0;
  }
}

/**
 * @param {string} cycleId                     the develop cycle's log directory name
 * @param {string|null} architectSessionId     stage 1's session id, or null
 * @param {string} logsRoot                    absolute path to `_logs`
 * @returns {number} authoritative spend across both logs
 */
export function sumRunCost(cycleId, architectSessionId, logsRoot) {
  const cycle = cycleId ? sumLog(join(logsRoot, cycleId)) : 0;
  const architect = architectSessionId ? sumLog(join(logsRoot, `_architect-${architectSessionId}`)) : 0;
  return Number((cycle + architect).toFixed(10));
}
