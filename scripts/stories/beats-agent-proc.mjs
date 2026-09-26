/**
 * beats-agent-proc.mjs — what the AGENT's own process was doing while a beat
 * waited on it.
 *
 * Bead `forge-8vfn.6.11.22` (T1 ruling 267). `6.11.17` cost this milestone two
 * funded runs and is still open with its owner unknown, because the one thing
 * that would name it — whether the process was spinning on synchronous work,
 * blocked in a syscall, or already gone — was never recorded while the wait was
 * happening. It was reconstructed afterwards from an archive, once, by hand.
 *
 * A dispatch outside a story (M5-B s7) settled the reading: a healthy turn shows
 * the node parent parked at `state=S` with a FLAT utime (correctly awaiting the
 * stream) while the SDK's own child climbs. So the discriminator is the child's
 * utime, not the parent's, and one sample proves nothing — a trend does.
 *
 * This makes the next occurrence self-describing at no cost: every agent-scale
 * wait samples the session's pid as it polls, and an unsatisfied wait carries
 * the trend into its own failure text. Nothing is written, no dependency is
 * added (`strace`/`fatrace` are not installed and none is introduced for a
 * probe), and a missing pid file, a dead process or a foreign `/proc` layout is
 * a silent no-op — diagnosis must never be able to fail a beat that would
 * otherwise pass.
 */
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { cycleProgressIdleMs } from './beats-cycle-progress.mjs';
import { queueManifestTerminal, FS_CLOCK_SLACK_MS, channelTerminalState } from './beats-queue-terminal.mjs';
// Split out at the 800-line cap (T1 ruling 492: SPLIT, NEVER BASELINE) —
// see beats-channel-scan.mjs's own header for what moved and why.
import { isDispatchDir, newestChannelSince, scanSummary, cycleDirForInitiative } from './beats-channel-scan.mjs';
// T1 ruling 1471 — re-exported so `beats-page.mjs` names the wall ceiling
// beside `STALL_CEILING_MS`/`TERMINAL_UI_GRACE_MS`, its two siblings that
// already live in THIS file rather than in the schema that only validates what
// a story may declare. This constant is never declared by a story at all.
export { CYCLE_WAIT_WALL_CEILING_MS } from './story-wait-schema.mjs';

/** `/sessions/<kind>/<sessionId>` → the runner's log dir for that turn. */
export function sessionLogDir(forgeRoot, route) {
  const m = /^\/sessions\/([A-Za-z][A-Za-z0-9-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(route ?? '');
  return m === null ? null : join(forgeRoot, '_logs', `_${m[1]}-${m[2]}`);
}

/** One reading of a pid: its scheduler state and its CPU time so far. */
function readProc(pid) {
  try {
    // `/proc/<pid>/stat`'s comm field can contain spaces and brackets, so fields
    // are counted from AFTER the closing paren — never by splitting the line.
    const raw = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const rest = raw.slice(raw.lastIndexOf(')') + 2).split(' ');
    return { pid, state: rest[0], utime: Number(rest[11]), stime: Number(rest[12]) };
  } catch {
    return null;
  }
}

/**
 * Build a sampler for the agent behind `route`, or null when there is nothing to
 * sample. Returns `() => void`; read the trend with `.summary()`.
 */
export function makeAgentProcProbe(forgeRoot, route) {
  if (typeof forgeRoot !== 'string' || forgeRoot === '') return null;
  const dir = sessionLogDir(forgeRoot, route);
  if (dir === null) return null;
  const samples = [];
  const probe = () => {
    let pid;
    try {
      pid = Number(readFileSync(join(dir, 'turn.pid'), 'utf8').trim());
    } catch {
      return;
    }
    if (!Number.isInteger(pid) || pid <= 0) return;
    const parent = readProc(pid);
    if (parent === null) {
      samples.push({ gone: true });
      return;
    }
    // The SDK's own child is where a healthy turn's CPU time accrues; the node
    // parent sits at `state=S` with a flat utime by design.
    let child = null;
    try {
      const kids = readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim().split(/\s+/);
      for (const k of kids) {
        const c = readProc(Number(k));
        if (c !== null) { child = c; break; }
      }
    } catch { /* no children, or a kernel without that file */ }
    samples.push({ parent, child });
  };
  /** A compact trend — what was moving, and what was not. */
  probe.summary = () => {
    if (samples.length === 0) return null;
    if (samples.every((s) => s.gone)) return `the agent process was already gone at all ${samples.length} samples`;
    const live = samples.filter((s) => !s.gone);
    const first = live[0];
    const last = live[live.length - 1];
    const dChild = last.child && first.child ? last.child.utime - first.child.utime : null;
    const dParent = last.parent.utime - first.parent.utime;
    const moved = dChild === null ? dParent > 0 : dChild > 0;
    return (
      `agent /proc over ${live.length} sample(s): parent state=${last.parent.state} utime ` +
      `${first.parent.utime}→${last.parent.utime}` +
      (last.child ? `, SDK child state=${last.child.state} utime ${first.child?.utime}→${last.child.utime}` : ', no SDK child seen') +
      `${samples.some((s) => s.gone) ? ', and the process was gone by the end' : ''} — ` +
      (moved ? 'it was WORKING, so the wait was too short or the product never publishes what the beat wants'
             : 'NOTHING moved, which is the hung shape (bead forge-8vfn.6.11.17)')
    );
  };
  return probe;
}

/**
 * The product's stall ceiling, in ms.
 *
 * ONE CEILING ACROSS THE PRODUCT, NEVER A SECOND INVENTED ONE — the rule
 * `apps/forge/tests/regression/ui-bridge-standalone-stalled.test.ts:105`
 * already states. The number lives in
 * `packages/sessions/bridge-studio-lifecycle.ts` as `DEFAULT_STALL_CEILING_MS`,
 * and this runner cannot import it: `run.mjs` is plain node with no type
 * stripping, and the runner never speaks to the bridge over HTTP, so neither
 * the import nor an API read is available here.
 *
 * So it is written once and BOUND BY TEST rather than copied and hoped over:
 * `beats-offsession-stall.test.ts` imports the TypeScript constant directly —
 * tests do run with type stripping — and fails if these two ever differ. A
 * comment asking the next reader to keep two numbers in step would not have
 * survived this campaign; a red test will.
 */
export const STALL_CEILING_MS = 180_000;

/**
 * Idle time of a FLOW RUN's log, in ms; `null` when that run has no channel
 * (both files genuinely absent — ENOENT); or `{unknown: true, detail}` when a
 * NON-ENOENT failure (EACCES/EIO) means the channel exists but could not be
 * read — row 28 of the guard-catch-on-UNKNOWN audit (M7-COMMON §6.16). Before
 * this fix a persistent read failure was indistinguishable from "no channel",
 * which every caller reads as "not stalled" and disables their early exit —
 * the wait then runs to its full declared/funded bound instead of ending
 * early on a check that could not be run.
 *
 * The two files are the product's own definition of a channel:
 * `bridge-studio-lifecycle.ts` calls a session stalled when its `.heartbeat` or
 * `events.jsonl` has been quiet past the ceiling (`:161`, `:199`). This asks the
 * same question of a flow run, so a beat off a session page can be answered by
 * the same verdict rather than by a second notion invented here.
 *
 * A CONCLUSIVE mtime from the OTHER file still wins over a real error on one
 * side — the same "one side answers, the answer stands" rule
 * `channelTerminalState` applies just below.
 */
export function runLogIdleMs(dir, now = Date.now()) {
  let newest = null;
  const realErrors = [];
  for (const name of ['.heartbeat', 'events.jsonl']) {
    try {
      const t = statSync(join(dir, name)).mtimeMs;
      if (newest === null || t > newest) newest = t;
    } catch (err) {
      // ENOENT — a channel that does not exist is not a silent one, it is no
      // channel. Any other code is a real, named failure to read it.
      if (err?.code !== 'ENOENT') realErrors.push(`could not stat ${join(dir, name)}: ${err?.code ?? err?.message}`);
    }
  }
  if (newest === null && realErrors.length > 0) {
    return { unknown: true, detail: realErrors.join('; ') };
  }
  return newest === null ? null : now - newest;
}

/**
 * The log dir of the flow run a beat is watching, or null when the page names
 * no usable run.
 *
 * Mirrors `sessionLogDir` above: the id is validated BEFORE it is joined, so a
 * `data-run` the page invents can never escape `_logs/`. The leading underscore
 * is required rather than tolerated — S10 run 5's artifact page carried
 * `data-run="_architect-2026-09-10T13-54-57-9eaf7fae"`, and a regex without it
 * would have rejected every real run id on the page it was written for.
 */
export function runLogDir(forgeRoot, runId) {
  if (typeof forgeRoot !== 'string' || forgeRoot === '') return null;
  if (typeof runId !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(runId)) return null;
  if (runId === '.' || runId === '..') return null;
  return join(forgeRoot, '_logs', runId);
}

/**
 * Build the door an OFF-SESSION wait uses to stop early, or null when there is
 * no root to read. Returns `(runId) => idleMs | null`.
 *
 * Built here, next to the process probe, for the same reason: the runner's ROOT
 * is known in `run.mjs` and nowhere else, and a tool that resolves its inputs
 * from its own location answers a different question in each checkout
 * (§15.148).
 */
export function makeOffSessionStallDoor(forgeRoot) {
  if (typeof forgeRoot !== 'string' || forgeRoot === '') return null;
  return (runId) => {
    const dir = runLogDir(forgeRoot, runId);
    return dir === null ? null : runLogIdleMs(dir);
  };
}

/**
 * Is the agent-channel door worth running for a beat with this bound?
 * T1 ruling 751 (§15.431).
 *
 * The door costs up to `ceilingMs` before it can say anything, so for a short
 * bound it IS the bound and the verdict should simply be the bound. The skip
 * test was `boundMs <= 2 * ceilingMs`, which made a bound of EXACTLY twice the
 * ceiling skip — and beat 8's tightening from 20 min to 6 min landed exactly
 * there, silently retiring the door that had saved 34 minutes the run before.
 * Two correct decisions whose composition nobody measured.
 *
 * At exactly 2x the door still returns half the bound, which is the whole point
 * of it, so the boundary belongs on the running side.
 */
export function doorWorthRunning(boundMs, ceilingMs) {
  return Number.isFinite(boundMs) && Number.isFinite(ceilingMs) && boundMs >= 2 * ceilingMs;
}

/**
 * The door every agent-scale wait consults — bead `forge-8vfn.7.5.8`.
 *
 * WHAT IT GENERALISES. 580 gave off-session waits a stop door keyed to the run
 * the PAGE names. Run 7 proved that is not enough: a press can dispatch an
 * agent from a page that names no run at all, and then nothing observes it.
 * Every full-ceiling burn this milestone — about 160 minutes of them — was an
 * off-session red, and no GREEN agent wait in 41 run logs exceeded 11.7 min.
 * So a wait that reaches the ceiling with nothing to show has, measurably,
 * already failed.
 *
 * THE CHANNEL, in order: the run the page names (`data-run` → `_logs/<id>`),
 * else the newest `_logs/_*` dispatch created since the press. The session in
 * scope is the first channel and is handled by `stopReasonFor` on the scoped
 * path, which runs before this.
 *
 * TWO NAMED REASONS, because they are different findings:
 *   `no-channel`    — nothing ever started. The press enqueued into a void, or
 *                     dispatched nothing at all. Run 7 beat 7's shape.
 *   `channel-quiet` — something started and then stopped writing. The product's
 *                     own stalled verdict, applied off-session.
 *
 * The declared `upTo` remains the hard maximum; this can only end a wait
 * EARLIER. A beat whose channel is writing keeps its full bound.
 *
 * @param {string} forgeRoot
 * @returns {null | ((runId: string|null, sinceMs: number) => {reason: string, detail: string}|null)}
 */
/**
 * THE CYCLE-TERMINAL DOOR — `forge-8vfn.7.6.118`, T1 ruling 1086, §15.559.
 *
 * A wait that ends on a WALL CLOCK asks "has my patience run out". This asks
 * the only question that actually decides the beat: **has the product finished?**
 *
 * MEASURED ON S10 RUN 17. Beat 8 gave up at 22:44:59 on a declared 360000 ms
 * bound with `data-initiative-status: expected "ready-for-review", got
 * "in-flight"`. The cycle reached `ready-for-review`, ERRORS RECORDED 0, at
 * 22:46:55 — 116 seconds later. Nothing was broken except the deadline.
 *
 * IN MONEY, which is the form that shows why a bigger literal is the wrong
 * repair: at the measured burn of $3.99 over 476 s, 360000 ms afforded $3.02
 * against a cycle that spent $3.99. The window funded a quarter less than the
 * work. The number was chosen when no S10 run had ever completed a cycle, so it
 * was derived from nothing — and it was the THIRD distinct beat-8 blocker in
 * three runs, after the ADR 037 quarantine and the unwired wait anchor.
 *
 * WHY `makeAgentChannelDoor` BELOW CANNOT ANSWER THIS. It reads the very same
 * terminal state, and on run 17 it correctly stayed silent: it asks only after
 * `STALL_CEILING_MS` of SILENCE, and that channel was writing continuously
 * until the moment it finished. **A door that waits for quiet cannot see a
 * cycle that finishes while still talking.** That is not a flaw in it — silence
 * is the question `forge-flvq` built it to answer — it is a DIFFERENT question,
 * so it gets its own door rather than a new mode bolted onto that one.
 *
 * SO THIS DOOR NEVER WAITS FOR QUIET, and that is its entire reason to exist.
 * `beats-cycle-terminal.test.ts` states that property as a door of its own,
 * because every other test here would still pass on aged fixtures if it
 * silently regained a silence requirement.
 *
 * IT REPORTS THE STATE, NOT A YES/NO. A door that answered only "is it
 * ready-for-review" would turn "the cycle was abandoned" into "not
 * ready-for-review yet" and let the beat sit out the rest of its bound waiting
 * for something the product had already ruled out. `done:false` with the state
 * beside it is what lets the verdict say what the cycle BECAME — 664(ii)'s
 * rule, that a verdict a reader cannot check is a defect on its own terms.
 *
 * AN UNREADABLE CHECK IS NEVER `done` (§15.504). Green, red and UNKNOWN are
 * three states and UNKNOWN never resolves toward proceeding: with no channel
 * found, or a terminal state that could not be read, this returns null — keep
 * waiting, the declared bound still governs — and never a verdict.
 *
 * THE DECLARED BOUND REMAINS A HARD MAXIMUM. Like 580's door, the only new exit
 * is EARLIER. Nothing here extends a wait.
 *
 * @returns {null | {done: boolean, state: string, detail: string}}
 */
export function makeCycleTerminalDoor(forgeRoot, opts = null) {
  if (typeof forgeRoot !== 'string' || forgeRoot === '') return null;
  const logsDir = join(forgeRoot, '_logs');
  const cycleOf = typeof opts?.cycleOf === 'string' && opts.cycleOf !== '' ? opts.cycleOf : null;
  let startedFor = null;
  const door = (runId, sinceMs, wantState) => {
    if (typeof wantState !== 'string' || wantState === '') return null;
    // The SAME channel resolution the stall door uses: the page's own run id
    // when it names a live one, else the newest dispatch born since the anchor.
    // Shared deliberately — two doors reading two different directories would
    // disagree about which cycle the beat is even watching.
    //
    // 7.6.143 adds ONE resolution in front, and only when the beat asked for it
    // by declaring `cycleOf`. Every story that does not is byte-for-byte
    // unchanged: 1147 ruled the fix additive, and a fix that quietly re-answered
    // the anchor question for everyone would be a behaviour change wearing a
    // new name.
    const named = runLogDir(forgeRoot, runId);
    // Row 31/29 of the guard-catch-on-UNKNOWN audit (M7-COMMON §6.15/§6.16).
    // `cycleDirForInitiative`/`newestChannelSince` now return an
    // `{unknown, detail}` object, distinct from both a path and null, when a
    // persistent (non-ENOENT) read failure means the scan itself could not be
    // trusted — never silently "nothing found yet", the false-red class this
    // audit exists to catch. THIS door's own contract (§15.504, below) is
    // that an unreadable check is NEVER `done` and never ends a wait EARLY
    // either, so an unknown scan is recorded (664(ii): say what was scanned)
    // and treated exactly like "nothing resolved this poll" — the declared
    // bound keeps governing either way. `makeAgentChannelDoor` below, whose
    // whole job IS to end a wait early, treats the same shape as a finding.
    let dir;
    if (cycleOf !== null) {
      const resolved = cycleDirForInitiative(logsDir, cycleOf);
      if (resolved !== null && typeof resolved !== 'string') {
        door.lastSeen = resolved.detail;
        return null;
      }
      dir = resolved;
    } else if (named !== null && runLogIdleMs(named) !== null) {
      dir = named;
    } else {
      const scanned = newestChannelSince(logsDir, sinceMs);
      if (scanned !== null && typeof scanned !== 'string') {
        door.lastSeen = scanned.detail;
        return null;
      }
      dir = scanned;
    }
    if (dir === null) return null;
    // WHETHER A CYCLE WAS EVER RESOLVED, recorded for the consumption check
    // (7.6.143 b2). Run 20's beat 10 called this door on every poll and it
    // returned null every time because `dir` was null — yet the beat's terminal
    // declaration counted as consumed, because a handle wait had set the one
    // boolean that stood for both. A declaration is consumed by the waiter it
    // declared, or by nothing.
    door.sawCycle = true;
    // T1 1503 (row 98) — TERMINAL WINS, BEFORE ANY WINDOW ARITHMETIC.
    // `queueManifestTerminal`'s own doc has the measurement: `cycleStartedSince`
    // below can never fire when `cycle.start` lands before this beat's anchor,
    // so the queue's mtime (the same kind of product-word evidence) is read
    // FIRST, unconditionally, never gated on the started-proof below.
    if (cycleOf !== null) {
      const q = queueManifestTerminal(forgeRoot, cycleOf);
      if (q !== null) {
        if (q.unknown === true) {
          // Named, never silent (§15.504): forfeits this early exit only.
          door.lastSeen = q.detail;
        } else if (q.mtimeMs >= sinceMs - FS_CLOCK_SLACK_MS) {
          door.lastSeen = q.detail;
          return Object.freeze({ done: q.state === wantState, state: q.state, detail: q.detail });
        }
        // `mtimeMs < sinceMs` — S10 run 22's hazard, a PREVIOUS run's terminal.
        // Fall through as if the queue had said nothing.
      }
    }
    // T1 1231 — BY IDENTITY, THE CYCLE PREDATES THE PRESS. DEC-2 threads one
    // cycle id through the architect and develop runs, so the queue already
    // reads the ARCHITECT run's terminal when the develop press lands (S10 run
    // 22: green 0.5 s before the develop cycle started). A terminal counts only
    // once the cycle has started a run at or after the anchor.
    // Latched once proven (D's review): a started run stays started, and a
    // multi-hour develop log is not re-scanned on every poll.
    if (cycleOf !== null && startedFor !== sinceMs) {
      const s = cycleStartedSince(dir, sinceMs);
      if (s.error !== null) { door.lastSeen = s.error; return null; }
      if (!s.started) {
        door.lastSeen = `no run of the cycle has started since the anchor (${new Date(sinceMs).toISOString()})`;
        return null;
      }
      startedFor = sinceMs;
    }
    const terminal = channelTerminalState(forgeRoot, dir);
    door.lastSeen = terminal === null ? 'the cycle is still open' : terminal.detail;
    // null = still open. `unknown` = the check could not be run. Neither is a
    // finished cycle, and they are kept apart from each other only in
    // `channelTerminalState`'s own reporting — here both mean "keep waiting".
    if (terminal === null || terminal.unknown === true) return null;
    return Object.freeze({ done: terminal.state === wantState, state: terminal.state, detail: terminal.detail });
  };
  door.sawCycle = false;
  door.lastSeen = 'no cycle resolved yet';
  return door;
}

/**
 * `started` when the cycle dir's events carry a `cycle.start` stamped at or
 * after `sinceMs`. ENOENT = no log yet (not started); any other read error is
 * NAMED in `error`, never read as "not started" (§15.504) — a bound that
 * expires on an unreadable log must say so, not blame the product.
 */
function cycleStartedSince(dir, sinceMs) {
  const path = join(dir, 'events.jsonl');
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch (err) {
    if (err?.code === 'ENOENT') return { started: false, error: null };
    return { started: false, error: `could not read ${path}: ${err?.code ?? err?.message}` };
  }
  const started = raw.split('\n').some((line) => {
    try {
      const ev = JSON.parse(line);
      return ev?.message === 'cycle.start' && Date.parse(ev.started_at) >= sinceMs;
    } catch { return false; }
  });
  return { started, error: null };
}

/**
 * How long the PAGE may lag the product after the cycle has finished.
 *
 * The beat asserts the LIVE card — S10's constants are explicit that it must
 * not reload, navigate away and back, or press Retry, because any of those
 * refresh the roadmap by hand and turn the beat green over a defect that is
 * still there. So the cycle finishing does not end the BEAT; it ends the WAIT,
 * and the page then has this long to show what the product already published.
 *
 * DECLARED, and small on purpose. `forge-8vfn.7.6.27` (#762) made the projects
 * page subscribe to the bridge socket, so there is no polling cadence to absorb
 * and delivery is a render away; before it landed, the page had no live refresh
 * at all and no grace would have been enough. Tightenable from run 18's
 * measurement — and unlike the bound it replaced, expiring here produces a
 * PRODUCT finding rather than a timeout.
 */
export const TERMINAL_UI_GRACE_MS = 30_000;

/**
 * `makeCycleTerminalDoor` plus the one piece of state a caller would otherwise
 * carry — `forge-8vfn.7.6.118`, T1 ruling 1089(c).
 *
 * WHY THE STATE IS HERE. `beats-page.mjs` stands at 768 lines against the 800
 * cap. T1 1089: if the call site needs more than that headroom, SPLIT it at a
 * function boundary, never squeeze. The third answer is not to put the fat
 * there — `terminalAt` belongs beside the doors that produce it, and
 * `waitForConsequence` gains a thin call instead of a state machine.
 *
 * TWO WAYS THIS ENDS A WAIT, and they are different findings:
 *
 *   `cycle-ended`          the product published a terminal state that is NOT
 *                          the one the beat is waiting for. Nothing is coming;
 *                          sitting out the rest of the bound would report a
 *                          timeout about a decision already made.
 *   `cycle-done-ui-stale`  the cycle reached the wanted state and the PAGE
 *                          never caught up within the grace. The factory
 *                          succeeded and the surface did not follow — 7.6.27's
 *                          territory, and a sentence a reader can act on.
 *
 * Neither is "gave up at the agent wait", which is what run 17 printed about a
 * cycle that had SUCCEEDED 116 seconds earlier, and which sent its first two
 * readers looking for a stall that never happened.
 *
 * THE GRACE RUNS FROM THE SIGHTING, not from the wait's start: counted from the
 * start it is merely a second deadline; counted from the moment the product
 * published, it measures the page's lag and nothing else.
 *
 * INERT UNLESS THE BEAT ASKED. With no wanted state this returns null and no
 * watch runs — the same scoping rule the stall door follows, so no beat gains a
 * new way to fail by standing next to one that opted in.
 *
 * @returns {null | ((runId: string|null, sinceMs: number, now?: number) => null | {reason: string, detail: string})}
 */
export function makeCycleTerminalWatch(forgeRoot, wantState, opts = null) {
  if (typeof wantState !== 'string' || wantState === '') return null;
  const door = makeCycleTerminalDoor(forgeRoot, opts);
  if (door === null) return null;
  // Re-derived rather than read off `door`: `makeCycleTerminalDoor` keeps its
  // own `logsDir` private, and re-joining `forgeRoot` here is one string concat
  // against exposing an internal for one caller.
  const logsDir = join(forgeRoot, '_logs');
  let terminalAt = null;
  let terminalState = null;
  const watch = (runId, sinceMs, now = Date.now()) => {
    if (terminalAt === null) {
      const seen = door(runId, sinceMs, wantState);
      // null = still open, or the check could not be run (§15.504). Either way
      // the declared bound still governs and this says nothing.
      if (seen === null) return null;
      if (!seen.done) {
        return {
          reason: 'cycle-ended',
          detail:
            `the cycle ended in ${seen.state}, not ${wantState} — ${seen.detail}. ` +
            `The product has already decided; the rest of the declared bound would be spent waiting for a state it ruled out.`,
        };
      }
      terminalAt = now;
      terminalState = seen.state;
      return null;
    }
    if (now - terminalAt <= TERMINAL_UI_GRACE_MS) return null;
    return {
      reason: 'cycle-done-ui-stale',
      detail:
        `the cycle REACHED ${terminalState} ${Math.round((now - terminalAt) / 1000)}s ago and the page never showed it. ` +
        `The factory succeeded and the surface did not follow, so this is a finding about the page's refresh, not about the cycle.`,
    };
  };
  // Mirrors the door's own record rather than keeping a second copy: two flags
  // for one fact is how they drift.
  Object.defineProperty(watch, 'sawCycle', { get: () => door.sawCycle === true });
  // T1 1231 — the declared terminal is a CONDITION of completion, read by
  // `waitForConsequence`, not only an early-red exit.
  Object.defineProperty(watch, 'reached', { get: () => terminalAt !== null });
  Object.defineProperty(watch, 'wantState', { value: wantState });
  Object.defineProperty(watch, 'lastSeen', { get: () => door.lastSeen });
  // T1 1471 — WHICH KIND OF WAIT THIS IS, exposed so `waitForConsequence` can
  // tell "watching a cycle by IDENTITY" from "watching by the born-after-the-
  // anchor form", without re-deriving the same opt this watch already
  // normalised. A wait with no `cycleOf` keeps its plain, unreset deadline —
  // that form has no stable identity to read progress FROM, only "born since
  // the press", which is not a channel `cycleProgressIdleMs` can watch.
  const cycleOf = typeof opts?.cycleOf === 'string' && opts.cycleOf !== '' ? opts.cycleOf : null;
  Object.defineProperty(watch, 'cycleOf', { value: cycleOf });
  // BY IDENTITY, the same dir the door above resolves — never
  // `newestChannelSince`'s born-after-the-anchor form, which finds nothing for
  // a continued cycle (7.6.143) and would read as "no progress" on one that is
  // genuinely writing. Null-safe with no `cycleOf`, so a future caller need not
  // guard the call; `waitForConsequence` only invokes it when `cycleOf` is set.
  Object.defineProperty(watch, 'progressIdleMs', {
    value: (now = Date.now()) => {
      if (cycleOf === null) return null;
      const dir = cycleDirForInitiative(logsDir, cycleOf);
      return dir === null ? null : cycleProgressIdleMs(dir, now);
    },
  });
  return watch;
}

export function makeAgentChannelDoor(forgeRoot) {
  if (typeof forgeRoot !== 'string' || forgeRoot === '') return null;
  const logsDir = join(forgeRoot, '_logs');
  return (runId, sinceMs) => {
    const named = runLogDir(forgeRoot, runId);
    // Rows 28/29 of the guard-catch-on-UNKNOWN audit. Unlike
    // `makeCycleTerminalDoor` above — whose contract is that an unreadable
    // check never ends a wait at all — THIS door's whole job is ending a wait
    // EARLY, so an unknown scan or an unknown idle-read is itself a finding
    // worth stopping on: silently waiting the full bound out unable to tell
    // is the exact "false red disguised as patience" this audit ranks by
    // blast radius.
    let dir;
    let scanUnknown = null;
    if (named !== null && runLogIdleMs(named) !== null) {
      dir = named;
    } else {
      const scanned = newestChannelSince(logsDir, sinceMs);
      if (scanned !== null && typeof scanned !== 'string') {
        scanUnknown = scanned;
        dir = null;
      } else {
        dir = scanned;
      }
    }
    if (dir === null) {
      const waited = Date.now() - sinceMs;
      if (waited <= STALL_CEILING_MS) return null;
      if (scanUnknown !== null) {
        // Row 29 — a persistently unreadable `_logs/` (or dispatch dir) must
        // never read as the confident, specific claim "nothing was created":
        // the exact inverse of the S10-run-7 incident `no-channel` exists to
        // catch, below.
        return {
          reason: 'channel-scan-unreadable',
          detail:
            `could not scan _logs/ for a channel this press started, for ${Math.round(waited / 1000)}s — ` +
            `${scanUnknown.detail}. An unreadable scan is not "nothing was created"; the declared bound would ` +
            `otherwise be spent unable to tell.`,
        };
      }
      // 664(ii): SAY WHAT WAS SCANNED. Lane A's S1 beat 9 reded `no-channel`
      // with no probe beside it and nobody could tell whether the door was
      // right — `makeAgentProcProbe` returns null for every non-session route,
      // so an off-session beat is doored by evidence it never prints. A verdict
      // that cannot be checked is a defect on its own terms, so the door now
      // carries what it looked at.
      const scanned = scanSummary(logsDir, sinceMs);
      return {
        reason: 'no-channel',
        detail:
          `no agent channel appeared in ${Math.round(waited / 1000)}s — nothing under _logs/ was created by ` +
          `this press and the page named no run. The declared bound would have been spent waiting on work ` +
          `that never started. Scanned ${scanned}.`,
      };
    }
    const idle = runLogIdleMs(dir);
    if (idle !== null && typeof idle !== 'number') {
      // Row 28 — same principle: an unreadable channel is not "not stalled".
      const waited = Date.now() - sinceMs;
      if (waited <= STALL_CEILING_MS) return null;
      const chan = dir.slice(dir.lastIndexOf('/') + 1);
      return {
        reason: 'channel-unreadable',
        detail:
          `the agent channel ${chan} could not be read for ${Math.round(waited / 1000)}s — ${idle.detail}. An ` +
          `unreadable channel is not "not stalled"; the declared bound would otherwise be spent unable to tell.`,
      };
    }
    if (idle === null || idle <= STALL_CEILING_MS) return null;

    // TERMINAL STATE FIRST (`forge-flvq`). Silence past the ceiling is the same
    // observation whether the turn HUNG or FINISHED, so the question of which
    // one has to be answered from something other than silence. Reading it here
    // rather than at the top is deliberate: a channel still writing is not
    // asked about, so the common path pays nothing.
    const terminal = channelTerminalState(forgeRoot, dir);
    const chan = dir.slice(dir.lastIndexOf('/') + 1);
    const quiet = `${Math.round(idle / 1000)}s`;
    if (terminal !== null && terminal.unknown !== true) {
      return {
        reason: 'channel-ended',
        detail:
          `the agent channel ${chan} ENDED — ${terminal.detail}. It has been quiet ${quiet}, which is ` +
          `what a finished turn and a hung one look like alike; the product had already published its ` +
          `verdict, so this beat stops on THAT rather than reporting a stall.`,
      };
    }
    return {
      reason: 'channel-quiet',
      detail:
        `the agent channel ${chan} has written nothing for ${quiet}, past the product's own ` +
        `${Math.round(STALL_CEILING_MS / 1000)}s stall ceiling` +
        (terminal === null
          ? ', and its terminal state was READ and is open — it is still running and has stopped writing.'
          : `. ${terminal.detail}, so "stalled" is this door's best reading and not a verdict the product published.`),
    };
  };
}
