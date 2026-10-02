/**
 * beats-agent-liveness.mjs — is the agent a wait is watching STILL WORKING,
 * and what does that make the wait's deadline?
 *
 * Row 179b (bead `forge-8vfn.8.5.27`), T1 ruling 1973ei. Row 179 (bead
 * `forge-8vfn.8.5.15`, `beats-repeat.mjs`) made a REPEAT beat's declared bound
 * an INACTIVITY window reset by the session's own liveness and backstopped by
 * `CYCLE_WAIT_WALL_CEILING_MS`. The ruling extends the same shape to EVERY
 * agent wait; this file is the half that is not about any one loop: the
 * reading and the arithmetic, so the consequence wait (`beats-page.mjs`), the
 * repeat (`beats-repeat.mjs`, via `beats-drive.mjs`'s reader) and the `cycleOf`
 * window all reset ONE way rather than three.
 *
 * MEASURED. A costed S1 run's beat 6 ("Watch the Agent work through the
 * contract until the onboarding session finishes", `wait: { for: 'agent',
 * upTo: 420_000 }`) gave up at 15:21:02.993Z with `data-session-phase`
 * `running`, while its own `/proc` probe printed `SDK child utime 12→622 — it
 * was WORKING`. The dispatched run's `events.jsonl` had grown 150 lines by
 * then with no gap over 15 s, and the session reached `complete` at
 * 15:23:49.776Z — 2 m 47 s after the declared bound beat a working agent
 * (`test-fixtures/run7-s1-beat6/`).
 *
 * WHY 179'S READER ALONE COULD NOT HAVE SEEN IT. `runLogIdleMs` reads a
 * session's `_logs/_<kind>-<sid>/{.heartbeat,events.jsonl}`. An onboarding
 * session is a `forge agent dispatch --session-dir` kind: its log dir holds
 * `turn.pid` and NOTHING ELSE, and every event the agent writes lands in the
 * dispatched run's own `_logs/<runId>/` (the product says so itself —
 * `SessionLifecycleInputs.hasChannel`, `packages/sessions/bridge-studio-
 * lifecycle.ts`, which for the same reason never calls such a session
 * `stalled`). So the session channel reads `null` — "no channel", correctly —
 * and a liveness window fed only that reading falls back to the plain
 * declared bound, which is exactly the wall clock that fired.
 *
 * THE LINK IS THE PRODUCT'S OWN DUAL WRITE, never a guess. `spawnAgentDispatch`
 * (`apps/forge/bridge-agent-dispatch.ts`) records ONE child pid at
 * `_logs/<runId>/turn.pid` and then, for a session-bound dispatch, the SAME pid
 * at `_logs/_<kind>-<sid>/turn.pid`, back to back (15:14:01.821Z both, in the
 * capture). `pairedRunDir` follows exactly that: the `_logs/` dir whose
 * `turn.pid` names the session's pid. A recycled pid in a stale dir cannot
 * buy a wait any time: its channel's writes PREDATE the wait, and
 * `cycleWaitDeadline` never lets a write older than the wait's own start pull
 * or push the deadline (`Math.max(startedAt, lastActivityAt)`).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import { sessionLogDir, runLogDir, runLogIdleMs } from './beats-agent-proc.mjs';
import { cycleWaitDeadline } from './beats-cycle-progress.mjs';
// The SAME absolute backstop 179's repeat and every `cycleOf` wait answer to,
// from its point of definition — see `makeLivenessWindow` for why it is reused
// rather than a ceiling derived from each beat's declared bound.
import { CYCLE_WAIT_WALL_CEILING_MS } from './story-wait-schema.mjs';

/** A `turn.pid`'s pid as written (a positive integer string), or null. */
function readTurnPid(dir) {
  try {
    const raw = readFileSync(join(dir, 'turn.pid'), 'utf8').trim();
    return /^[1-9]\d*$/.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * The dispatched run's own log dir for a turn.pid-only session, or null.
 *
 * Newest `turn.pid` wins among matches: the product writes the run's copy
 * first and the session's a moment later, so the genuine pair always exists by
 * the time the session's pid can be read, and any older match is a recycled
 * pid whose channel is inert to the deadline (header).
 */
export function pairedRunDir(forgeRoot, sessionDir) {
  const pid = readTurnPid(sessionDir);
  if (pid === null) return null;
  const logsDir = join(forgeRoot, '_logs');
  const own = basename(sessionDir);
  let entries;
  try {
    entries = readdirSync(logsDir, { withFileTypes: true });
  } catch {
    return null;
  }
  let best = null;
  let bestAt = -Infinity;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === own) continue;
    const dir = join(logsDir, entry.name);
    if (readTurnPid(dir) !== pid) continue;
    let at;
    try { at = statSync(join(dir, 'turn.pid')).mtimeMs; } catch { continue; }
    if (at > bestAt) { best = dir; bestAt = at; }
  }
  return best;
}

/** The fresher of two `runLogIdleMs` readings; an unreadable one only when nothing better exists. */
function freshest(a, b) {
  const numbers = [a, b].filter((x) => typeof x === 'number');
  if (numbers.length > 0) return Math.min(...numbers);
  return a ?? b ?? null;
}

/**
 * Build `(route, runId, boundRunId, now) => idleMs | null | {unknown, detail}`
 * — how long since the agent a wait is watching last wrote — or null when there
 * is no root to read (every costless run and every door test that passes none).
 *
 * BY IDENTITY ONLY, never the born-after-the-anchor scan. A session route names
 * its session; off a session, only a run the page names (`data-run`) or the
 * beat already bound (row 162) is read. Ruling 569's protection, 179's own
 * reason for `sawGate`: a channel ticking somewhere unrelated must never keep a
 * wait alive, so a wait with no identity keeps its plain declared bound.
 *
 * THE SESSION'S OWN CHANNEL FIRST, the dispatched run's beside it — the
 * fresher of the two. Architect/demo sessions write `.heartbeat`/`events.jsonl`
 * in their own dir (179's reading, unchanged); a turn.pid-only session's only
 * channel is its paired run's. The pairing is looked up only when the
 * session's own channel is absent or unreadable, and cached per (session, pid) — found or
 * not, since the run's `turn.pid` is written before the session's — so a 100 ms
 * poll does not rescan `_logs/` ten times a second.
 */
export function makeAgentLivenessReader(forgeRoot) {
  if (typeof forgeRoot !== 'string' || forgeRoot === '') return null;
  const paired = new Map();
  return (route, runId = null, boundRunId = null, now = Date.now()) => {
    const sessionDir = sessionLogDir(forgeRoot, route);
    if (sessionDir !== null) {
      const own = runLogIdleMs(sessionDir, now);
      if (typeof own === 'number') return own;
      const pid = readTurnPid(sessionDir);
      if (pid === null) return own;
      const key = `${sessionDir}\0${pid}`;
      if (!paired.has(key)) paired.set(key, pairedRunDir(forgeRoot, sessionDir));
      const run = paired.get(key);
      return run === null ? own : freshest(own, runLogIdleMs(run, now));
    }
    for (const id of [runId, boundRunId]) {
      const dir = runLogDir(forgeRoot, id);
      if (dir === null) continue;
      const idle = runLogIdleMs(dir, now);
      if (idle !== null) return idle;
    }
    return null;
  };
}

/**
 * ONE inactivity window — the bookkeeping `cycleOf` (T1 1471) and 179's repeat
 * each did inline, kept in one place so the reset cannot drift between them.
 *
 * `observe(pollNow, idle)` folds one reading in and returns
 * `cycleWaitDeadline`'s `{deadline, firedBy}`. An idle reading that is not a
 * number (absent, unreadable) FAILS CLOSED: it moves nothing, and a wait that
 * never saw a write keeps the plain `startedAt + timeoutMs` (§15.504). `idle`
 * and `pollNow` must come from the SAME clock read (T1 1471's own rule — two
 * reads would invent silence between them).
 *
 * THE CEILING IS `CYCLE_WAIT_WALL_CEILING_MS` (3 × `MAX_DECLARED_WAIT_MS`, 90
 * min), reused rather than re-derived, for three reasons. (1) 179 already chose
 * it for exactly this shape, and two ceilings for one shape is a second place
 * to be wrong. (2) A multiple of the DECLARED bound would rebuild the wall
 * clock this ruling retires from the same under-measured number: S1 beat 6's
 * 420_000 was "1.5× the slowest green" over four runs, and the fifth worked for
 * 9 m 48 s. (3) The declared bound keeps the job it can actually do — it is
 * the inactivity window, so a genuinely silent agent still reds after exactly
 * the patience the story declared, never later than today.
 */
export function makeLivenessWindow({ startedAt, timeoutMs, wallCeilingMs = CYCLE_WAIT_WALL_CEILING_MS }) {
  let lastActivityAt = null;
  let extensions = 0;
  return {
    observe(pollNow, idle) {
      if (typeof idle === 'number') {
        const activityAt = pollNow - idle;
        if (lastActivityAt === null || activityAt > lastActivityAt) {
          if (lastActivityAt !== null) extensions += 1;
          lastActivityAt = activityAt;
        }
      }
      return cycleWaitDeadline({ startedAt, timeoutMs, lastActivityAt, wallCeilingMs });
    },
    get lastActivityAt() { return lastActivityAt; },
    get extensions() { return extensions; },
    wallCeilingMs,
  };
}
