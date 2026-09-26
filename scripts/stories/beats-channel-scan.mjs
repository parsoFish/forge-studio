/**
 * beats-channel-scan.mjs — scanning `_logs/` for a dispatch dir THIS PRESS
 * started, by birth time or by identity.
 *
 * Split out of `beats-agent-proc.mjs` at the 800-line cap (T1 ruling 492:
 * SPLIT, NEVER BASELINE). `makeAgentChannelDoor`/`makeCycleTerminalDoor`
 * there import `newestChannelSince`/`scanSummary`/`cycleDirForInitiative`;
 * nothing here calls back, so the dependency runs one way. `isDispatchDir`
 * moved with them — it exists only to answer "is this `_logs/` entry a
 * dispatch dir" for the three scanners below.
 *
 * T1 1507-class fix (M7-COMMON §6.16, rows 29 and 31 of the
 * guard-catch-on-UNKNOWN audit, `_1.0/handoff/m7-d-guard-unknown-audit.md`).
 * `newestChannelSince` and `cycleDirForInitiative` used to collapse EVERY
 * `readdirSync`/`statSync` failure — a genuinely absent `_logs/` (ENOENT) and
 * a persistent EACCES/EIO alike — into the same `null`, byte-identical to "a
 * clean scan found nothing". A caller ending a wait on "nothing was created"
 * then reported the literal inverse of the S10-run-7 incident these scanners
 * exist to catch: a real dispatch dir was there, unreadable, and the door
 * confidently said so anyway. Both now return a THIRD shape,
 * `{unknown: true, detail}`, distinct from a path string and from `null`,
 * when the scan itself could not be trusted — ENOENT keeps the old behaviour
 * exactly (an absent `_logs/` really is "nothing here"), and a CONCLUSIVE
 * `best` found despite some OTHER entry's error still wins, the same
 * "a real finding is not diminished by an unrelated failure" rule
 * `channelTerminalState` (`beats-queue-terminal.mjs`) applies.
 *
 * Callers differ in what they DO with the unknown shape, and that decision
 * stays with them, not here: `makeCycleTerminalDoor`'s own contract is that
 * an unreadable check never ends a wait at all (§15.504), so it folds
 * `unknown` back into "nothing resolved this poll"; `makeAgentChannelDoor`'s
 * whole job is ending a wait EARLY, so it treats the same shape as a finding
 * worth stopping on. See their call sites in `beats-agent-proc.mjs`.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

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
 * The newest `_logs/_*` directory created at or after `sinceMs`, or null when
 * a genuinely absent (ENOENT) `_logs/` or the scan finds nothing that
 * qualifies, or `{unknown: true, detail}` when a NON-ENOENT failure means the
 * scan itself could not be trusted (row 29).
 *
 * THE THIRD CHANNEL, and the one that catches the case the other two miss: a
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
export function newestChannelSince(logsDir, sinceMs) {
  let best = null;
  let bestAt = -1;
  let entries;
  try {
    entries = readdirSync(logsDir, { withFileTypes: true });
  } catch (err) {
    // ENOENT — `_logs/` genuinely does not exist yet, which really is
    // "nothing here". Any other code (EACCES/EIO/EMFILE) is a check that
    // could not run, not a confident "nothing was created".
    if (err?.code === 'ENOENT') return null;
    return { unknown: true, detail: `could not read ${logsDir}: ${err?.code ?? err?.message}` };
  }
  let realError = null;
  for (const e of entries) {
    if (!e.isDirectory() || !isDispatchDir(e.name)) continue;
    let born;
    try {
      const st = statSync(join(logsDir, e.name));
      born = st.birthtimeMs || st.ctimeMs;
    } catch (err) {
      // ENOENT — vanished mid-scan, not evidence either way. Any other code
      // is named, but does not stop the scan: a later entry may still answer
      // conclusively.
      if (err?.code !== 'ENOENT') realError = `could not stat ${join(logsDir, e.name)}: ${err?.code ?? err?.message}`;
      continue;
    }
    if (born < sinceMs) continue;
    if (born > bestAt) { bestAt = born; best = join(logsDir, e.name); }
  }
  // A CONCLUSIVE `best` wins regardless of some OTHER entry's error — the
  // same "a real finding is not diminished by an unrelated failure" rule
  // `channelTerminalState` applies.
  if (best === null && realError !== null) return { unknown: true, detail: realError };
  return best;
}

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

/**
 * The newest dispatch dir belonging to an INITIATIVE, whatever its birth time.
 *
 * `forge-8vfn.7.6.143`, T1 ruling 1147. `newestChannelSince` answers "which
 * channel was born since the anchor", which is the right question when a press
 * MINTS a cycle. It is the wrong question for the develop station, which
 * CONTINUES the cycle the architect minted — DEC-2 threads the same `cycle_id`
 * through the kickoff on purpose. Measured on S10 run 20: the cycle dir was
 * born at 20:21:58.902 and the press anchored at 20:26:22.301, so nothing was
 * born since the anchor, the lookup returned null, and a declared 30-minute
 * terminal wait completed in 231 ms while the beat reported green.
 *
 * So the harness follows the product's own identity for a run rather than
 * inventing one from directory birth. Dispatch dirs are `<timestamp>_<id>`
 * (`isDispatchDir`), so the initiative is an exact suffix match — never a
 * substring, which would let `INIT-foo` claim `INIT-foo-bar`.
 *
 * @returns {null | {unknown: true, detail: string} | string} `null` when a
 *   genuinely absent (ENOENT) `_logs/` or no matching dir exists yet;
 *   `{unknown, detail}` when a NON-ENOENT failure means the scan itself could
 *   not be trusted — row 31, same errno-split as `beats-agent-proc.mjs`'s own
 *   exemplary `cycleStartedSince`: a persistent read failure must never read
 *   as "hasn't started yet" and burn a wait's full bound toward a false red.
 */
export function cycleDirForInitiative(logsDir, initiativeId) {
  if (typeof initiativeId !== 'string' || initiativeId === '') return null;
  let entries;
  try {
    entries = readdirSync(logsDir, { withFileTypes: true });
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    return { unknown: true, detail: `could not read ${logsDir}: ${err?.code ?? err?.message}` };
  }
  let best = null;
  let bestAt = -1;
  let realError = null;
  const suffix = `_${initiativeId}`;
  for (const e of entries) {
    if (!e.isDirectory() || !isDispatchDir(e.name)) continue;
    if (!e.name.endsWith(suffix)) continue;
    let born;
    try {
      const st = statSync(join(logsDir, e.name));
      born = st.birthtimeMs || st.ctimeMs;
    } catch (err) {
      if (err?.code !== 'ENOENT') realError = `could not stat ${join(logsDir, e.name)}: ${err?.code ?? err?.message}`;
      continue;
    }
    if (born > bestAt) { bestAt = born; best = join(logsDir, e.name); }
  }
  if (best === null && realError !== null) return { unknown: true, detail: realError };
  return best;
}
