/**
 * test-guard.mjs — the suite's half of the symmetric lock refusal.
 *
 * Bead `forge-8vfn.7.6.13`, T1 ruling 634. `npm test` writes into `projects/`
 * (`packages/agents/tests/integration/agent-run-dispatch.test.ts` builds a
 * fixture there and sweeps it), and that is the directory a story run hashes
 * before and after to prove its ground did not drift. The two took different
 * locks, so they overlapped by construction.
 *
 * This runs BEFORE the first test file, so a refused suite costs nothing. It
 * never sleeps and never retries: the refusal is one line naming the holder,
 * and the lane's own Monitor is what waits (§15.335).
 *
 * `gate.sh` inherits this for free, because its list comes from `ci.yml` and
 * `ci.yml` runs `npm test` (§15.353 — the file is the list).
 */

import { runLockVerdict, EXIT_LOCK_REFUSED } from './stories/lock-guard.mjs';

const verdict = runLockVerdict();
if (!verdict.ok) {
  console.error(`[test-guard] ${verdict.reason}`);
  process.exit(EXIT_LOCK_REFUSED);
}
// The configured-and-clear case says so; the not-configured case says THAT,
// because a guard that is silent when it is not enforcing is indistinguishable
// from one that checked.
console.log(`[test-guard] ${verdict.reason}`);
