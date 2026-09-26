/**
 * beats-queue-terminal.mjs — the queue's own terminal, read by IDENTITY, BY
 * MTIME, and BY NAME (a dispatch dir's own `_queue/` row).
 *
 * Split out of `beats-agent-proc.mjs` at the 800-line cap (T1 ruling 492:
 * SPLIT, NEVER BASELINE). `makeCycleTerminalDoor`/`makeAgentChannelDoor` there
 * import `queueManifestTerminal`/`channelTerminalState`; nothing here calls
 * back, so the dependency runs one way.
 *
 * T1 1503 (row 98, S10 run 27). MEASURED. `makeCycleTerminalDoor`'s `cycleOf`
 * form only ever reads a terminal once `cycleStartedSince` finds a
 * `cycle.start` at or after the beat's anchor. S10 run 27's develop cycle
 * failed at 20:53:47Z, `_queue/failed/` held the manifest, and the wait NEVER
 * ENDED: the develop run's own `cycle.start` was stamped 20:44:07.280Z while
 * the beat's anchor read ~20:44:08.0Z, so `started` stayed false forever and
 * the door never got as far as reading the queue at all.
 *
 * THE GATE IS THE WRONG QUESTION FOR A TERMINAL THE PRODUCT ALREADY WROTE.
 * `cycleStartedSince` exists to stop a STALE terminal — the architect run's
 * leftover `ready-for-review`, S10 run 22's hazard (T1 1231) — from reading as
 * THIS press's verdict. But a manifest the product moves into a terminal
 * `_queue/` directory carries its OWN timestamp: the file's mtime, set the
 * moment the product wrote it there. That is exactly as trustworthy a stamp as
 * `cycle.start`'s `started_at` — both are the product's own word, not the
 * runner's guess — so the same rule applies without waiting on a SEPARATE
 * event to corroborate it first. This reads the queue directly, BY IDENTITY,
 * never re-deriving an initiative name from a dispatch dir's own filename the
 * way `channelTerminalState` must for the born-after-the-anchor form —
 * `cycleOf` already names it.
 *
 * `>= sinceMs` WINS; `< sinceMs` IS IGNORED, on purpose, and both matter:
 *
 *   >= sinceMs   the product moved this initiative into a terminal state at or
 *                after THIS press's own anchor — nothing else could have
 *                written it, so it is this press's verdict, whether or not
 *                `cycle.start` ever proved a run "started" for the same
 *                anchor.
 *   <  sinceMs   the S10 run 22 hazard, one layer down: a terminal the
 *                PREVIOUS run left sitting in the queue, older than this
 *                press. Reading it would be exactly the mistake T1 1231
 *                already ruled out, so it is left for the started-gate to
 *                handle as it already does.
 *
 * UNREADABLE IS NAMED, NEVER SILENT (§15.504). A queue this could not read
 * reports `unknown: true` with the path and the OS error; the caller treats
 * that exactly as "no queue terminal found here" and falls through to the
 * started-gate — an unreadable queue must never MANUFACTURE a false terminal,
 * so it only ever forfeits the early exit this adds, never fabricates one.
 *
 * AMENDED BY T1 RULING 1637 (amending 1636; bead `forge-8vfn.8.1.27`), S10
 * PROOF RUN 32 — mtime is NOT safe for `ready-for-review`. Closure moved a
 * manifest there at 16:57:07.823Z, before the NEXT press's own anchor; that
 * press's `send-back` REWROTE the same manifest file IN PLACE at ~16:57:11.2 —
 * no rename, no new file — and the rewrite alone pushed mtime to
 * 16:57:11.299Z, AFTER the anchor. The rule above read that as this press's
 * own terminal and ended the wait 0.8s later; the real fix cycle's
 * `cycle.start` did not land until 16:58:17.134Z. An mtime any unrelated
 * write can bump is not the product's word.
 *
 * So `ready-for-review` alone — the one state a rewrite-in-place can reach —
 * is keyed on the product's OWN transition event instead:
 * `closure.manifest-moved-to-ready-for-review`, logged by `terminalMove`
 * beside the SAME move (`packages/flows/phases/closure.ts:109`), read from the
 * cycle's own `events.jsonl` (the same `dir` the caller already resolved by
 * identity). That event's `started_at` is `createLogger`'s own
 * `new Date().toISOString()` taken at emit time
 * (`packages/kernel/logging.ts:162`) — a fine timestamp, not the coarse fs
 * clock `FS_CLOCK_SLACK_MS` exists for — so no slack applies to it.
 *
 * `cycleStartedSince` is NEVER ANDed onto this branch: T1 1636 tried exactly
 * that and T1 1637 reverted it on evidence — row 98 below is a case where
 * `cycle.start` predates the anchor and ONLY the terminal proves the round
 * happened, so ANDing `cycleStartedSince` in reintroduces the very hang row 98
 * exists to prevent (proved in this file's own tests, "T1 1637 (row 98,
 * ready-for-review)", `beats-cycle-terminal.test.ts`).
 *
 * A MISSING OR UNREADABLE EVENT IS `unknown: true`, NEVER A SILENT FALL-BACK
 * TO MTIME (§15.504): an absent event may mean "not this round yet" and a read
 * failure may hide a real one, so neither is evidence of arrival — the caller
 * folds it into "nothing resolved this poll" exactly like any other unknown.
 *
 * EVERY OTHER TERMINAL STATE (`failed`, `merged`, `done`, …) keeps reading
 * mtime exactly as T1 1503 ruled: none has a rename-in-place hazard the way a
 * resent `ready-for-review` manifest does, and `failed` in particular has no
 * mapped `closure.manifest-moved-to-*` event at all (`scheduler-run-one.ts`/
 * `scheduler-dispatch.ts` move it with no matching log line) — widening the
 * event requirement there would turn "no defect" into "permanently unknown".
 * Widen past `ready-for-review` only once a state grows both its own
 * rename-in-place hazard AND its own mapped event.
 *
 * @returns {null | {unknown: true, detail: string} | {state: string, detail: string, atMs: number, slackMs: number}}
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * How far a file timestamp may trail `Date.now()` and still be "at or after"
 * an anchor. The kernel stamps mtime/ctime from its COARSE clock, which runs
 * behind the fine clock `Date.now()` reads — measured on this host: a rename
 * made strictly after the anchor carried a ctime 1.1 ms BEFORE it. Without a
 * slack, a terminal the product wrote just after the press can read as "the
 * previous run's". 250 ms is far above coarse-clock lag and far below the
 * minutes-old terminal the S10 run 22 guard exists for.
 */
export const FS_CLOCK_SLACK_MS = 250;

export function queueManifestTerminal(forgeRoot, initiativeId, cycleDir = null) {
  const queue = join(forgeRoot, '_queue');
  let states;
  try {
    states = readdirSync(queue, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch (err) {
    return { unknown: true, detail: `could not read ${queue}: ${err?.code ?? err?.message}` };
  }
  // The SAME open/terminal split `channelTerminalState` uses: `pending` and
  // `in-flight` are states of a channel still doing something, and anything
  // else the product moved it INTO is the product's own terminal word.
  const OPEN_STATES = new Set(['pending', 'in-flight']);
  for (const state of states) {
    if (OPEN_STATES.has(state)) continue;
    const stateDir = join(queue, state);
    let names;
    try {
      names = readdirSync(stateDir);
    } catch (err) {
      return { unknown: true, detail: `could not read ${stateDir}: ${err?.code ?? err?.message}` };
    }
    const match = names.find((n) => n.includes(initiativeId));
    if (match === undefined) continue;
    // T1 1637 — `ready-for-review` is the one state a send-back's in-place
    // rewrite can reach, so it never reads mtime; see the file header.
    if (state === 'ready-for-review') return readyForReviewArrival(initiativeId, cycleDir);
    const filePath = join(stateDir, match);
    // WHEN IT ARRIVED, not when it was last written: `moveTo`
    // (packages/flows/queue.ts) is a bare `renameSync`, which leaves mtime
    // alone and stamps ctime — so a manifest written before the press and
    // moved into _queue/failed/ after it carries an OLD mtime. The later of
    // the two is the moment this state became true.
    let mtimeMs;
    try {
      const st = statSync(filePath);
      mtimeMs = Math.max(st.mtimeMs, st.ctimeMs);
    } catch (err) {
      return { unknown: true, detail: `could not stat ${filePath}: ${err?.code ?? err?.message}` };
    }
    const detail = `the product moved ${initiativeId} into _queue/${state}/`;
    return { state, atMs: mtimeMs, slackMs: FS_CLOCK_SLACK_MS, detail };
  }
  return null;
}

/**
 * T1 1637 — the `ready-for-review` arrival, keyed on the product's own
 * `closure.manifest-moved-to-ready-for-review` event rather than the
 * manifest's fs mtime (file header has the S10 run 32 measurement). Reads the
 * CYCLE's own `events.jsonl` — the same `cycleDir` the caller already resolved
 * by identity — for the LAST such event, so a second round logged into the
 * same directory is not shadowed by an earlier one. Absent or unreadable is
 * `unknown: true`, never a silent fall-back to mtime (§15.504).
 */
function readyForReviewArrival(initiativeId, cycleDir) {
  const state = 'ready-for-review';
  const wantMessage = `closure.manifest-moved-to-${state}`;
  if (typeof cycleDir !== 'string' || cycleDir === '') {
    return { unknown: true, detail: `no cycle directory to read ${wantMessage} from for ${initiativeId}` };
  }
  const path = join(cycleDir, 'events.jsonl');
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      return { unknown: true, detail: `could not read ${path}: ${err?.code ?? err?.message}` };
    }
    raw = ''; // no events logged yet — not a real error, and not an arrival either
  }
  let atMs = null;
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev?.message !== wantMessage) continue;
    const parsed = Date.parse(ev.started_at);
    // the LAST match wins — the most recent round in this same cycle dir
    if (!Number.isNaN(parsed)) atMs = parsed;
  }
  if (atMs === null) {
    const detail = `no ${wantMessage} event found in ${path} for ${initiativeId} — ` +
      `an mtime alone is never trusted here (T1 1637)`;
    return { unknown: true, detail };
  }
  const detail = `the product's ${wantMessage} event fired for ${initiativeId}`;
  return { state, atMs, slackMs: 0, detail };
}

/**
 * THE CHANNEL'S OWN TERMINAL STATE, read BEFORE silence is interpreted
 * (`forge-flvq`).
 *
 * MEASURED on S10 run 15 beat 8. The door said the channel
 * `…_INIT-2026-09-12-exclude-author-flag` "has written nothing for 180s, past
 * the product's own 180s stall ceiling", and stopped at 332s of a declared
 * 360000 ms bound. TRUE, AND THE CONCLUSION WAS WRONG: the channel had
 * TERMINATED three minutes earlier — `_queue/failed/` held the initiative, the
 * last `events.jsonl` row was `event_type=error`, and a 12.5 KB `report.md`
 * with `artifacts/` was on disk. The product had already said the cycle failed;
 * the door waited out 180s of a dead channel and reported a stall.
 *
 * A FINISHED TURN AND A HUNG TURN ARE IDENTICAL TO A SILENCE DETECTOR. That is
 * not a bug in the silence measurement — it is a question silence cannot
 * answer. It masked the real blocker: the reader's first impression of run 15
 * was "the dev agent stalled" when the truth was "the PM's work-item set was
 * rejected and the cycle failed".
 *
 * NOT A NEW MECHANISM: `stopReasonFor` already believes a SESSION's own
 * published terminal phase rather than re-deriving one; an off-session channel
 * simply had no equivalent.
 *
 * THE STATES ARE READ FROM DISK, NOT FROM A LIST, for `queue-claim.mjs`'s
 * reason in its own words: a constant cannot see a seventh state someone adds
 * later, and the failure mode of missing one is silence. `journey-residue.mjs`
 * exports a six-name `QUEUE_STATES`; this deliberately does not import it.
 *
 * AND AN UNREADABLE CHECK IS NOT AN OPEN CHANNEL. If neither the queue nor the
 * event log can be read, this returns `unknown` rather than null — the caller
 * must not report "still open, therefore stalled" on the strength of a check
 * that did not happen. §15.430's rule, one layer up: an absent path is not an
 * empty one.
 *
 * @returns {null | {state: string, detail: string, unknown?: true}}
 */
export function channelTerminalState(forgeRoot, dir) {
  const name = dir.slice(dir.lastIndexOf('/') + 1);
  // `_<kind>-<timestamp>_<INITIATIVE>` — the dispatch dir names what it ran.
  // THE LEADING UNDERSCORE IS PART OF THE PREFIX, not a separator: a dispatch
  // dir is `_`-prefixed by construction (`isDispatchDir`), so splitting on the
  // FIRST `_` yields the whole name and matches nothing. My own doors caught
  // that — `_dev-…_INIT-x` gave an "initiative" of `dev-…_INIT-x`, the queue
  // lookup found no file, and the verdict fell through to the events branch,
  // which was right for the wrong reason.
  const body = name.startsWith('_') ? name.slice(1) : name;
  const initiative = body.includes('_') ? body.slice(body.indexOf('_') + 1) : null;
  let queueSaw = null;
  let queueReadable = false;
  // T1 1507 (§6.15) — a NON-ENOENT failure, named separately from ENOENT
  // (nothing there yet, not a real error), so it can force `unknown` alone —
  // the old gate needed BOTH sides unreadable, so a one-sided EACCES with the
  // OTHER side reading clean fell through as if the queue confidently said
  // "nothing here".
  let queueRealError = null;
  if (initiative !== null) {
    const queue = join(forgeRoot, '_queue');
    let states = null;
    try {
      states = readdirSync(queue, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
      queueReadable = true;
    } catch (err) {
      if (err?.code !== 'ENOENT') queueRealError = `could not read ${queue}: ${err?.code ?? err?.message}`;
      /* ENOENT — absent, not empty, but not a REAL error either */
    }
    for (const state of states ?? []) {
      let names = [];
      try { names = readdirSync(join(queue, state)); } catch (err) {
        queueReadable = false;
        if (err?.code !== 'ENOENT') queueRealError = `could not read ${join(queue, state)}: ${err?.code ?? err?.message}`;
        continue;
      }
      if (names.some((n) => n.includes(initiative))) { queueSaw = state; break; }
    }
  }

  let lastEvent = null;
  let eventsReadable = false;
  let eventsRealError = null;
  try {
    const raw = readFileSync(join(dir, 'events.jsonl'), 'utf8');
    eventsReadable = true;
    const rows = raw.split('\n').filter((l) => l.trim() !== '');
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      try { const ev = JSON.parse(rows[i]); if (typeof ev?.event_type === 'string') { lastEvent = ev.event_type; break; } } catch { /* a torn row is not a verdict */ }
    }
  } catch (err) {
    if (err?.code !== 'ENOENT') eventsRealError = `could not read ${join(dir, 'events.jsonl')}: ${err?.code ?? err?.message}`;
  }

  // A CONCLUSIVE ANSWER WINS FIRST, real error on the OTHER side or not — a
  // state the product actually wrote is not made less true by an unrelated
  // read failure. `pending`/`in-flight` are still-open states; anything else
  // the product moved it INTO is its own terminal word.
  const OPEN_STATES = new Set(['pending', 'in-flight']);
  if (queueSaw !== null && !OPEN_STATES.has(queueSaw)) {
    return {
      state: queueSaw,
      detail: `the product moved ${initiative} into _queue/${queueSaw}/` +
        (lastEvent === null ? '' : ` and its last event is ${lastEvent}`),
    };
  }
  if (lastEvent === 'error') {
    return { state: 'error', detail: `its last events.jsonl row is event_type=error` };
  }
  // NOTHING CONCLUSIVE. THE GATE, WIDENED (T1 1507): unknown when EITHER side
  // hit a REAL error, not only when BOTH gave up — before this, a one-sided
  // EACCES with the OTHER side confidently empty fell through here and read as
  // "open" (`beats-offsession-stall.test.ts`'s flvq door: both-ENOENT is kept
  // exactly as it was, only a genuine error is new).
  if (queueRealError !== null || eventsRealError !== null || (!queueReadable && !eventsReadable)) {
    return {
      state: 'unknown',
      unknown: true,
      detail: [queueRealError, eventsRealError].filter((d) => d !== null).join('; ') ||
        'neither _queue/ nor events.jsonl could be read, so this channel\'s terminal state is UNKNOWN rather than open',
    };
  }
  return null;
}
