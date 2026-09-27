/**
 * beats-priced-wait.mjs — `wait: { for: 'priced', upTo }`, ROW 109 (T1 1549).
 *
 * Split out of `beats-agent-proc.mjs` at the 800-line cap (T1 ruling 492:
 * SPLIT, NEVER BASELINE; bead `forge-8vfn.8.1.31`, T1 ruling 1693). That file
 * sat at 797/800 lines when the reflect-door fix (below, this ruling) needed
 * room for a new door beside `makeCycleTerminalDoor`/`makeCycleTerminalWatch`
 * — its natural neighbours — so this self-contained wait moved instead of the
 * new code being squeezed in or the new door finding a less cohesive home.
 *
 * A PURE MOVE: not one line of behaviour changed. `waitForPricedEvent`
 * imports only `run-observe.mjs`, `reap.mjs` and `beats-page-read.mjs`
 * directly, and `sessionLogDir` from `beats-agent-proc.mjs` — nothing in
 * THAT file calls back here, so the dependency still runs one way, exactly
 * as `beats-channel-scan.mjs` and `beats-queue-terminal.mjs` already do
 * beside it.
 */
import { readRunEvents } from './run-observe.mjs';
import { hasPricedEvent, collectAgentRuns, PID_READ_UNKNOWN } from './reap.mjs';
import { CONSEQUENCE_POLL_MS } from './beats-page-read.mjs';
import { sessionLogDir } from './beats-agent-proc.mjs';

/**
 * ROW 109 (T1 1549). S3's terminal beat follows the onboarding session it just
 * launched — "Follow View onboarding session and watch it work" — and its own
 * `expect.data` is satisfied the moment the session page renders, long before
 * that session's first turn prices itself. The run then ends and
 * `reap.mjs`'s own `FIRST_PRICED_EVENT_GRACE_MS` (<= 30 s) teardown grace is
 * not enough: run 2 measured "terminated before first priced event (30000
 * ms)". So spend read UNMEASURED by construction — not because nothing was
 * spent, but because nothing was given the chance to say so, one layer up
 * from the exact gap `FIRST_PRICED_EVENT_GRACE_MS` was minted for.
 *
 * `wait: { for: 'priced', upTo }` gives the beat itself a bounded, REAL
 * wall-clock chance to see a priced event before `driveBeat` returns and the
 * run moves on toward teardown — buying the session more total time to price
 * itself than the reap grace alone ever could.
 *
 * NEVER A VERDICT INPUT. This is evidence, full stop: it runs AFTER the
 * beat's own `expect.data` has already decided pass/fail (`beats-drive.mjs`
 * attaches its outcome onto an already-finished verdict) and never touches
 * `status` or `failures` either way — a beat that would have gone green does
 * not turn red because nothing priced within `upTo`, and one that would have
 * gone red is not rescued by a priced event landing.
 *
 * THE RESOLVER IS BORROWED, NOT DUPLICATED: `sessionLogDir`
 * (`beats-agent-proc.mjs`) turns the LIVE route the page is standing on into
 * the same log dir every other agent-evidence reader already resolves. THE
 * PREDICATE IS BORROWED TOO: `hasPricedEvent` (`reap.mjs`) is the exact
 * reading `waitForFirstPricedEvent` polls teardown with, so a non-priced
 * event row (a `start`, a phase change, anything with no genuine
 * `cost_usd`) can never be mistaken for the thing this wait exists to see.
 *
 * T1 1583 — THE SESSION DIR IS NOT WHERE THE MONEY LANDS. Measured live, S3
 * funded run 3: the session dir never carried a `cost_usd` row across the
 * WHOLE 180 s bound, while the agent this beat dispatched wrote exactly one
 * in ITS OWN dispatch dir (`_agent-onboarding-agent-<ts>-<rand>`) — a sibling
 * directory `sessionLogDir` never looks at. The wait never ended, so the
 * still-working agent went on writing and committing in the ground: a
 * containment red caused by watching the wrong directory.
 *
 * SO THIS ALSO WATCHES EVERY AGENT RUN THIS STORY DISPATCHED, discovered THE
 * SAME WAY TEARDOWN DISCOVERS THEM — `collectAgentRuns` (`reap.mjs`), never a
 * second discovery rule invented here. A run counts only when born AT OR
 * AFTER this wait's own anchor (`opts.sinceMs`, else this call's own start): a
 * dir born earlier belongs to a PREVIOUS dispatch, exactly as a stale
 * `_logs/` entry is not `collectAgentRuns`'s to reap. The session dir is
 * always a candidate too (the common case), and whichever candidate prices
 * FIRST ends the wait, named on the result (`dir`) so a reader never has to
 * guess which log actually carried the spend.
 *
 * FAIL-CLOSED ON A ROUTE THIS RUNNER CANNOT RESOLVE (§6.15) — `by:
 * 'unresolved'`, immediately, no poll at all; reading it as "not yet priced"
 * would burn the whole bound on a loop that could never succeed. THE SAME
 * RULE COVERS A `_logs/` SCAN THAT COULD NOT BE TRUSTED: `collectAgentRuns`
 * reports that as its `PID_READ_UNKNOWN` sentinel rather than throwing, and
 * this reads it as `by: 'unresolved'` too, immediately — never "nothing
 * found", which would silently narrow to the session dir alone and call that
 * patience rather than the blind spot it is. NEVER THROWS OTHERWISE: a read
 * that fails mid-poll (an injected fake, a torn file, a `collectRuns` call
 * that itself throws) is read as "not yet" and the poll continues — aborting
 * the whole beat over a wait that was only ever evidence is worse.
 *
 * @param {string|null} forgeRoot
 * @param {string|null} route the LIVE route the page is standing on
 * @param {number} upTo the beat's own declared bound, in ms
 * @param {{readEvents?: (dir: string) => object[], collectRuns?: (root: string, sinceMs: number) => {dir: string, pid: number|string, markers?: string[]}[], sinceMs?: number, pollMs?: number, sleep?: (ms: number) => Promise<void>, now?: () => number, log?: (line: string) => void}} [opts]
 * @returns {Promise<{by: 'event'|'timeout'|'unresolved', afterMs: number, dir: string|null}>}
 */
export async function waitForPricedEvent(forgeRoot, route, upTo, opts = {}) {
  const {
    readEvents: readEventsIn = readRunEvents,
    collectRuns = collectAgentRuns,
    sinceMs,
    pollMs = CONSEQUENCE_POLL_MS,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = () => Date.now(),
    log = (line) => console.error(line),
  } = opts;
  const dir = typeof forgeRoot === 'string' && forgeRoot !== '' ? sessionLogDir(forgeRoot, route) : null;
  const named = (by) => {
    const where = dir ?? `an unresolved session for route ${JSON.stringify(route ?? null)}`;
    log(`priced wait: no priced event from ${where} within ${upTo} ms — the spend line will say why`);
    return Object.freeze({ by, afterMs: by === 'unresolved' ? 0 : upTo, dir: null });
  };
  if (dir === null) return named('unresolved');
  const startedAt = now();
  const anchorMs = typeof sinceMs === 'number' ? sinceMs : startedAt;

  // Every dir worth asking THIS poll: the session dir first (the common
  // case), then every agent run `collectAgentRuns` admits since the anchor —
  // deduped, since an onboarding session's own dir carries a `turn.pid` too
  // (the exact shape `collectAgentRuns`'s own header names) and would
  // otherwise be read twice. `null` return means the scan itself could not be
  // trusted (`PID_READ_UNKNOWN`), carried as a named detail rather than a dir
  // list.
  const candidates = () => {
    let runs;
    try {
      runs = collectRuns(forgeRoot, anchorMs);
    } catch {
      return { dirs: [dir], scanFailed: null }; // a scan that could not even run is not evidence either way
    }
    const list = Array.isArray(runs) ? runs : [];
    const unreadable = list.find((r) => r?.pid === PID_READ_UNKNOWN);
    if (unreadable !== undefined) {
      return {
        dirs: [],
        scanFailed: `could not scan _logs/ for the agent run(s) this beat dispatched — ${unreadable.dir} could not be read`,
      };
    }
    const dirs = [dir];
    for (const run of list) if (typeof run?.dir === 'string' && !dirs.includes(run.dir)) dirs.push(run.dir);
    return { dirs, scanFailed: null };
  };
  const check = () => {
    const { dirs, scanFailed } = candidates();
    if (scanFailed !== null) return { unresolved: scanFailed };
    for (const candidate of dirs) {
      try {
        if (hasPricedEvent(readEventsIn(candidate))) return { dir: candidate };
      } catch {
        // A read that could not happen is not evidence of "not priced" either
        // way — try the remaining candidates, or the next poll.
      }
    }
    return null;
  };
  const unresolvedScan = (detail) => {
    log(`priced wait: ${detail} — the spend line will say why`);
    return Object.freeze({ by: 'unresolved', afterMs: 0, dir: null });
  };

  const first = check();
  if (first?.unresolved) return unresolvedScan(first.unresolved);
  if (first?.dir) return Object.freeze({ by: 'event', afterMs: 0, dir: first.dir });
  for (;;) {
    const elapsed = now() - startedAt;
    if (elapsed >= upTo) return named('timeout');
    await sleep(Math.min(pollMs, upTo - elapsed));
    const found = check();
    if (found?.unresolved) return unresolvedScan(found.unresolved);
    if (found?.dir) return Object.freeze({ by: 'event', afterMs: now() - startedAt, dir: found.dir });
  }
}
