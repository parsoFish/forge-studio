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
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

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
 * Idle time of a FLOW RUN's log, in ms, or null when that run has no channel.
 *
 * The two files are the product's own definition of a channel:
 * `bridge-studio-lifecycle.ts` calls a session stalled when its `.heartbeat` or
 * `events.jsonl` has been quiet past the ceiling (`:161`, `:199`). This asks the
 * same question of a flow run, so a beat off a session page can be answered by
 * the same verdict rather than by a second notion invented here.
 */
export function runLogIdleMs(dir, now = Date.now()) {
  let newest = null;
  for (const name of ['.heartbeat', 'events.jsonl']) {
    try {
      const t = statSync(join(dir, name)).mtimeMs;
      if (newest === null || t > newest) newest = t;
    } catch {
      // A channel that does not exist is not a silent one — it is no channel.
    }
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
 * The newest `_logs/_*` directory created at or after `sinceMs`, or null.
 *
 * The THIRD channel, and the one that catches the case the other two miss: a
 * beat that presses something which dispatches an agent from a page that names
 * no run. S10 run 7's beat 7 pressed Plan on `/projects/gitpulse` — not a
 * session route, so `stopReasonFor` had nothing to scope to, and the page
 * publishes no `data-run`, so 580's door had nothing to read either. It sat its
 * full twenty minutes.
 *
 * Matched on `_`-prefixed entries only, which is what every dispatch dir is
 * (`_architect-…`, `_demo-…`, `_agent-…`), and by BIRTH time rather than mtime:
 * a pre-existing dir that happens to be written during the wait is somebody
 * else's run, not evidence that this press started one.
 */
/**
 * Is this `_logs/` entry a dispatch dir? T1 ruling 751 (§15.430).
 *
 * TWO SHAPES, and the door knew one. Sessions are `_`-prefixed
 * (`_architect-<ts>-<id>`, `_bridge-<ts>-<id>`); CYCLE dirs are
 * `<ISO-ts>_INIT-<slug>` and carry NO leading underscore. `startsWith('_')`
 * therefore skipped every cycle dir, so a press that started a real cycle could
 * be doored `no-channel` — measured on run 12, where the daemon claimed within a
 * second of beat 7's green, ran to ready-for-review, and the door reported the
 * newest dispatch as an unrelated architect session 857 s older than the press.
 *
 * Both readers use this, deliberately. The scan line exists (664(ii)) so a
 * reader can CHECK the door; a scan with the door's own blind spot confirms the
 * door instead of testing it.
 */
export function isDispatchDir(name) {
  if (typeof name !== 'string' || name === '') return false;
  if (name.startsWith('_')) return true;
  // `2026-09-11T15-19-39_INIT-exclude-author-flag` — timestamp, `_`, then the id.
  return /^\d{4}-\d{2}-\d{2}T[\d-]+_/.test(name);
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

export function newestChannelSince(logsDir, sinceMs) {
  let best = null;
  let bestAt = -1;
  let entries;
  try {
    entries = readdirSync(logsDir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (!e.isDirectory() || !isDispatchDir(e.name)) continue;
    let born;
    try {
      born = statSync(join(logsDir, e.name)).birthtimeMs || statSync(join(logsDir, e.name)).ctimeMs;
    } catch {
      continue;
    }
    if (born < sinceMs) continue;
    if (born > bestAt) { bestAt = born; best = join(logsDir, e.name); }
  }
  return best;
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
 * What the door looked at, in one line — T1 ruling 664(ii).
 *
 * Lane A's S1 run 5 beat 9 reded `no-channel` and nobody could decide whether
 * the door was right, because an off-session beat has no `/proc` probe beside
 * it: `makeAgentProcProbe` returns null for every route `sessionLogDir` cannot
 * parse. Beat 6's false red was PROVABLE only because its session path printed
 * 1768 samples; beat 9's was a maybe.
 *
 * So the door states its own evidence: the directory it scanned, how many
 * `_`-prefixed entries it saw, and the newest birth time against the press it
 * is judging. A reader can then tell "nothing was ever dispatched" from "the
 * dispatch is older than this press" without another run.
 */
export function scanSummary(logsDir, sinceMs) {
  let entries = [];
  try {
    entries = readdirSync(logsDir, { withFileTypes: true }).filter((e) => e.isDirectory() && isDispatchDir(e.name));
  } catch {
    return `${logsDir} (unreadable)`;
  }
  let newest = -1;
  let newestName = null;
  for (const e of entries) {
    try {
      const st = statSync(join(logsDir, e.name));
      const born = st.birthtimeMs || st.ctimeMs;
      if (born > newest) { newest = born; newestName = e.name; }
    } catch { /* a dir that vanished mid-scan is not evidence */ }
  }
  const age = newest < 0 ? 'none' : `${newestName} born ${Math.round((sinceMs - newest) / 1000)}s BEFORE this press`;
  return `${logsDir}: ${entries.length} dispatch dir(s), newest ${age}`;
}

export function makeAgentChannelDoor(forgeRoot) {
  if (typeof forgeRoot !== 'string' || forgeRoot === '') return null;
  const logsDir = join(forgeRoot, '_logs');
  return (runId, sinceMs) => {
    const named = runLogDir(forgeRoot, runId);
    const dir = named !== null && runLogIdleMs(named) !== null ? named : newestChannelSince(logsDir, sinceMs);
    if (dir === null) {
      const waited = Date.now() - sinceMs;
      if (waited <= STALL_CEILING_MS) return null;
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
    if (idle === null || idle <= STALL_CEILING_MS) return null;
    return {
      reason: 'channel-quiet',
      detail:
        `the agent channel ${dir.slice(dir.lastIndexOf('/') + 1)} has written nothing for ` +
        `${Math.round(idle / 1000)}s, past the product's own ${Math.round(STALL_CEILING_MS / 1000)}s stall ceiling.`,
    };
  };
}
