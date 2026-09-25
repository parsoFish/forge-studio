/**
 * reap-census.mjs — confirm a process TREE is actually gone before anything
 * downstream trusts it and clears what that tree was writing.
 *
 * FINDING ROW 75 (T1 rulings 1258, 1332). A story run's reap signals every pid
 * it finds and a caller then clears the run's artefacts — `_queue/in-flight/
 * <init>.md.heartbeat`, this run's ground — on the strength of `kill()` not
 * having thrown. It throwing, or not, says a signal was DELIVERED, never that
 * the kernel has finished tearing the target down; under this campaign's own
 * CPU-starvation conditions (T3 rule 9 — four lanes on one box) that gap
 * measured as a heartbeat written back 13s after a runner printed CLEARED, and
 * a loop still committing into the ground 2.7 minutes later. The clear ran
 * before every writer was dead.
 *
 * WHAT A CENSUS ANSWERS, and what it cannot. Given the pid(s) a reap just
 * signalled, is any one of them — or anything still alive that descends from
 * one — present in `/proc` right now? That is a LIVE re-read, independent of
 * whatever the reap's own signal calls reported, and it is the only thing that
 * can catch a SIGKILL that has been sent but not yet scheduled by a starved
 * host. It is NOT a way to discover MORE processes to kill after the fact: once
 * a root pid has actually exited, the kernel reparents its children as part of
 * that same exit, so a ppid-chain walk mounted afterwards can no longer find
 * them under it — that window closes at the same instant the root's death
 * becomes true. A caller that needs to reach a root's descendants has to
 * snapshot them BEFORE any signal (`reap.mjs`'s own 5.45 lesson) and pass their
 * identities in as roots too; this module only confirms liveness, never
 * discovers parentage after the fact.
 *
 * MUST 2 (D's review of #906) — A PID NUMBER IS NOT A PROCESS IDENTITY on a
 * box that recycles them as fast as this campaign's four lanes do. A "recorded
 * pid" — one this run snapshotted minutes ago as a root or a descendant — can
 * belong to a completely unrelated process by the time anything signals it,
 * and `kill(recycledPid, 'SIGKILL')` would then end a stranger's work with our
 * name nowhere near it. `identifyPid`/`samePid` below exist for exactly this:
 * every root a caller hands the census carries the START TIME (`/proc/<pid>
 * /stat` field 22, monotonic and unique to one process's lifetime for a given
 * pid) it had when recorded, and `censusSurvivors` re-verifies that BEFORE
 * using the pid for anything — as a survivor match, or as an ancestry target.
 * A root that no longer matches is dropped from the census entirely: not
 * because it might be gone (it certainly is — a pid is never reused while its
 * original owner is still alive), but because its NUMBER may now belong to an
 * unrelated process, and walking that number's descendants would misattribute
 * a stranger's children to us. The SAME verification runs again, by the
 * caller, immediately before any actual signal (`verifiedKill`) — the gap
 * between "found as a survivor" and "the kill lands" is where D's review
 * says the count matters most.
 *
 * MUST 3 (D's review of #906) — `ancestorPids` (`lock-guard.mjs`) collapses
 * EVERY `/proc/<pid>/status` read failure into "chain ends here", ENOENT
 * (genuinely gone) and EACCES (unreadable, unknown) alike. For a census that
 * is the wrong shape: an unreadable INTERMEDIATE pid reads exactly like that
 * pid being gone, so a live descendant one hop further out is reported NOT a
 * survivor — a false EMPTY, the one direction this whole module exists to
 * rule out. `lock-guard.mjs` is pinned (D's #911, gate+slot) and is not
 * touched here; this module does its OWN guarded ppid walk (`chainReaches`)
 * instead of calling `ancestorPids` for the census's own decision, so ENOENT
 * can stay "gone" while every OTHER read failure surfaces as UNKNOWN and
 * refuses the whole census (`survivors: null`) rather than silently
 * dropping one candidate.
 *
 * `pidsDescendedFrom` keeps `ancestorPids`'s simpler "reused, not reparsed"
 * shape for its own general-purpose contract — a plain membership filter,
 * with no census to protect — but is now built on the SAME guarded walk
 * `chainReaches` uses, so there is still exactly one ppid-chain reader in this
 * module, not two.
 */
import { readdirSync, readFileSync } from 'node:fs';

/**
 * `/proc/<pid>/status`'s `PPid:` field, with WHY a read failed kept apart —
 * MUST 3's whole point. `comm` (`status`'s `Name:` line) cannot contain the
 * newline this regex anchors on, so unlike `/stat` there is no "last `)`"
 * hazard to parse around here.
 *
 * @returns {{ppid: string}|{gone: true}|{unknown: true, error: unknown}}
 */
function readPpid(pid, procRoot) {
  let raw;
  try {
    raw = readFileSync(`${procRoot}/${pid}/status`, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return { gone: true }; // genuinely exited — a normal, expected chain end
    return { unknown: true, error: err }; // EACCES, or anything else: NOT the same fact as gone
  }
  const m = /^PPid:\s+(\d+)/m.exec(raw);
  // A status file that exists but carries no PPid line is not a shape this
  // kernel has ever produced for a real process; reading it as "gone" matches
  // `ancestorPids`'s own behaviour for this one case and is not the failure
  // MUST 3 is about (the read itself succeeded).
  return m === null ? { gone: true } : { ppid: m[1] };
}

/**
 * Does `startPid`'s ancestor chain reach `rootPid`? Bounded at 64 hops so a
 * cycle can never spin this — the same bound `ancestorPids` uses.
 *
 * @returns {'reached'|'not-reached'|'unknown'}
 */
function chainReaches(startPid, rootPid, procRoot) {
  const root = String(rootPid);
  let p = String(startPid);
  if (p === root) return 'not-reached'; // a pid is never its own descendant
  for (let guard = 0; guard < 64; guard += 1) {
    if (p === '' || p === '0' || p === '1') return 'not-reached'; // reached init without finding root
    const row = readPpid(p, procRoot);
    if (row.unknown) return 'unknown';
    if (row.gone) return 'not-reached';
    if (row.ppid === root) return 'reached';
    p = row.ppid;
  }
  return 'not-reached'; // guard exhausted — never spin on a cycle
}

/**
 * Which of `candidatePids` currently descend from `rootPid` — a live
 * `/proc` read, never a snapshot this function took itself.
 *
 * A pid is never its own descendant, so `rootPid` itself is excluded from the
 * result even when it appears in `candidatePids` — a caller checking "is the
 * root ALSO still alive" does that by including it directly in a liveness
 * check, not by asking this question.
 *
 * A candidate whose chain could not be fully read (MUST 3's UNKNOWN) is
 * simply excluded here, the same as "not reached" — this is the general-
 * purpose membership filter, not the census's own gate; `censusSurvivors`
 * below is where an unknown chain has to refuse rather than guess.
 *
 * @param {ReadonlyArray<number|string>} candidatePids
 * @param {number|string} rootPid
 * @param {{procRoot?: string}} [opts]
 * @returns {(number|string)[]} the subset of `candidatePids` that descend from `rootPid`
 */
export function pidsDescendedFrom(candidatePids, rootPid, { procRoot = '/proc' } = {}) {
  const out = [];
  for (const pid of candidatePids ?? []) {
    if (chainReaches(pid, rootPid, procRoot) === 'reached') out.push(pid);
  }
  return out;
}

/**
 * `/proc/<pid>/stat` field 22 — start time in clock ticks since boot. Parsed
 * AFTER the last `)` of the comm field (`reap.mjs`'s own discipline: `comm`
 * can contain spaces and parens, so the fields before it are never split from
 * the left). Monotonic and unique to one process's lifetime for a given pid —
 * MUST 2's whole mechanism — `null` when the pid cannot currently be read.
 */
export function processStartTime(pid, { procRoot = '/proc' } = {}) {
  let raw;
  try {
    raw = readFileSync(`${procRoot}/${pid}/stat`, 'utf8');
  } catch {
    return null;
  }
  const close = raw.lastIndexOf(')');
  if (close === -1) return null;
  // Fields after `comm)` start at field 3 (state); field 22 (starttime) is
  // therefore index 22 - 3 = 19 into that slice.
  const fields = raw.slice(close + 2).split(' ');
  const n = Number.parseInt(fields[19], 10);
  return Number.isInteger(n) ? n : null;
}

/**
 * `{pid, startTime}` — a stable identity for `pid`, taken right now.
 * `startTime: null` means this process could not be identified at all
 * (already gone, or unreadable) — returned rather than thrown, because "we
 * tried to record this and could not" is itself the fact a caller needs.
 *
 * @param {number|string} pid
 * @param {{procRoot?: string}} [opts]
 * @returns {{pid: number|string, startTime: number|null}}
 */
export function identifyPid(pid, opts = {}) {
  return { pid, startTime: processStartTime(pid, opts) };
}

/**
 * Is `recorded` ({pid, startTime}) STILL the same process, right now? MUST 2's
 * whole test. `startTime: null` (never successfully identified) is never the
 * same process — there is nothing to compare against, so nothing can match —
 * and a pid whose CURRENT start time differs, or cannot be read at all, is
 * either recycled or genuinely gone; either way, not the process this run
 * recorded, and never signalled as if it were.
 *
 * @param {{pid: number|string, startTime: number|null}|null|undefined} recorded
 * @param {{procRoot?: string}} [opts]
 * @returns {boolean}
 */
export function samePid(recorded, opts = {}) {
  if (recorded == null || recorded.startTime === null) return false;
  const now = processStartTime(recorded.pid, opts);
  return now !== null && now === recorded.startTime;
}

/**
 * Signal `recorded` ({pid, startTime}) ONLY if it is still, right now, the
 * process it was recorded as — MUST 2's "immediately before any KILL" half.
 * Never sends a signal on a bare pid number alone.
 *
 * ESRCH AND EPERM ARE KEPT APART (D's comment-only note, done properly rather
 * than left as a note): `ESRCH` means the kernel has no such pid — gone, and
 * `samePid` above would already have caught almost every case of this, but a
 * pid can still vanish in the instant between that check and this call. EPERM
 * means the pid EXISTS and belongs to someone else — a real, live process we
 * are not permitted to signal, which is a SURVIVOR this run cannot clear, not
 * an absence.
 *
 * @param {{pid: number|string, startTime: number|null}} recorded
 * @param {NodeJS.Signals} sig
 * @param {{kill?: (pid: number|string, sig: NodeJS.Signals) => void, procRoot?: string}} [opts]
 * @returns {{signalled: boolean, reason: string|null}}
 */
export function verifiedKill(recorded, sig, opts = {}) {
  const kill = opts.kill ?? ((pid, s) => process.kill(pid, s));
  const procRoot = opts.procRoot ?? '/proc';
  if (!samePid(recorded, { procRoot })) {
    return {
      signalled: false,
      reason: `pid ${recorded?.pid}: no longer the recorded process (recycled or already gone) — not signalled`,
    };
  }
  try {
    kill(recorded.pid, sig);
    return { signalled: true, reason: null };
  } catch (err) {
    if (err?.code === 'ESRCH') {
      return { signalled: false, reason: `pid ${recorded.pid}: ${sig} failed: gone the instant before the signal landed` };
    }
    if (err?.code === 'EPERM') {
      return { signalled: false, reason: `pid ${recorded.pid}: ${sig} failed: EPERM — it exists and is alive, just not ours to signal` };
    }
    return { signalled: false, reason: `pid ${recorded.pid}: ${sig} failed: ${err?.message ?? err}` };
  }
}

/**
 * May `recorded`'s pid NUMBER still be used at all — as a self-match target,
 * or as an ancestry-walk target for other candidates?
 *
 * TWO DIFFERENT "NO"s here, and only one of them drops the root. If the
 * number is CURRENTLY ABSENT (`processStartTime` reads `null` right now),
 * nothing else holds it, so using it as an ancestry target is harmless —
 * this is the ordinary "the root has already exited, but a child that has
 * not yet been reparented still shows this ppid" window, and the whole point
 * of recording descendants at snapshot time is to still find them here. If
 * the number is CURRENTLY PRESENT but belongs to a DIFFERENT process
 * (mismatched start time), it is recycled — MUST 2 — and must never be used
 * for anything: not as a survivor by its own number, and not as an ancestry
 * target, because that would misattribute a stranger's children to this run.
 * A `recorded.startTime` of `null` (this run never actually identified the
 * pid) can never be usable — there is nothing to defend using that number.
 */
function rootIsUsable(recorded, opts) {
  if (recorded.startTime === null) return false;
  const now = processStartTime(recorded.pid, opts);
  return now === null || now === recorded.startTime;
}

/**
 * Every pid, from a fresh live listing, that IS one of `roots` (start-time
 * verified) or descends from one — the whole census in one pass.
 *
 * `roots` are `{pid, startTime}` identities (`identifyPid`), never bare
 * numbers (MUST 2) — see `rootIsUsable` for exactly which roots this uses and
 * why a merely-absent root still counts while a RECYCLED one is dropped
 * outright.
 *
 * `null`, never `[]`, in TWO cases, and the caller (`waitForCensusEmpty`)
 * treats both as UNKNOWN rather than a clean census — §15.504's rule, that
 * UNKNOWN must never be spelled with the same shape as EMPTY:
 *   - the live listing itself could not be read. Checked BEFORE any root is
 *     filtered, and deliberately: a census with recorded roots that all
 *     happen to fail verification for unrelated reasons must not let that
 *     coincidence hide a `/proc` this process genuinely could not read.
 *   - MUST 3 — walking some candidate's ancestry hit a read failure that is
 *     NOT "gone" (EACCES, or anything else). Under-reporting a survivor
 *     because one chain could not be fully read is the exact false EMPTY
 *     this exists to close, so the whole census refuses rather than skip
 *     that one candidate silently.
 *
 * A LIVE PID FOUND IN THE LISTING BUT ALREADY A ZOMBIE still counts as a
 * survivor here — this reads `/proc`'s directory listing, not each pid's run
 * state, and a zombie is still an entry in it. That is the FAIL-SAFE
 * direction: it can only make the census wait slightly longer for something
 * its own parent has not reaped yet, never miss a genuine writer.
 *
 * @param {ReadonlyArray<{pid: number|string, startTime: number|null}>} roots
 * @param {{procRoot?: string, listPids?: () => (number|string)[]}} [opts]
 * @returns {(number|string)[] | null}
 */
export function censusSurvivors(roots, { procRoot = '/proc', listPids } = {}) {
  const candidates = (roots ?? []).filter((r) => r !== null && r !== undefined);
  if (candidates.length === 0) return [];

  let pids;
  try {
    pids = (listPids ?? (() => readdirSync(procRoot).filter((n) => /^[0-9]+$/.test(n))))();
  } catch {
    return null;
  }

  const usableRoots = candidates.filter((r) => rootIsUsable(r, { procRoot })).map((r) => String(r.pid));
  if (usableRoots.length === 0) return [];

  const survivors = [];
  for (const pid of pids) {
    const p = String(pid);
    if (usableRoots.includes(p)) {
      survivors.push(pid);
      continue;
    }
    let reached = false;
    let unknown = false;
    for (const root of usableRoots) {
      const outcome = chainReaches(p, root, procRoot);
      if (outcome === 'reached') {
        reached = true;
        break;
      }
      if (outcome === 'unknown') unknown = true;
    }
    if (reached) {
      survivors.push(pid);
      continue;
    }
    if (unknown) return null; // MUST 3 — refuse the whole census rather than under-report one candidate
  }
  return survivors;
}

/**
 * Poll `censusSurvivors` until it reports empty, or `boundMs` runs out — the
 * bounded wait T1 ruling 1258 requires between "SIGKILL sent" and "trust the
 * tree is gone". Bounded on POLL STEPS via the injected `clock`, the same
 * discipline `reapAgentRuns`'s own grace wait uses, so a test can drive it
 * without a real sleep.
 *
 * An empty `roots` is vacuously census-empty: a run that recorded no root has
 * nothing this check can refuse to clear on.
 *
 * An unreadable `/proc`, OR a chain MUST 3 could not fully read, NEVER
 * resolves to `empty: true` — an unknown census is refused, not guessed
 * clean, however long the bound runs. IT IS ALSO RETRIED, exactly like a
 * non-empty survivor list, rather than treated as an immediate terminal
 * failure the first time it is seen. Measured, not supposed (T1 1372's own
 * 20-run repro under load): a single unreadable pid mid-scan — a process
 * that exits in the narrow window between the live listing and the read of
 * it, surfacing as something other than the plain "gone" `readPpid` already
 * handles — is a TRANSIENT condition on a busy host, not a permanent one,
 * and giving up on the first sighting turned a real, already-dead grandchild
 * into a reported failure one run in twenty. Only UNKNOWN that PERSISTS for
 * the whole bound is reported; anything that resolves before then — empty or
 * a genuine survivor — is read exactly as if the blip never happened.
 *
 * @param {ReadonlyArray<{pid: number|string, startTime: number|null}>} roots
 * @param {{boundMs?: number, pollMs?: number, procRoot?: string,
 *          listPids?: () => (number|string)[],
 *          clock?: {now: () => number, sleep: (ms:number) => Promise<void>}}} [opts]
 * @returns {Promise<{empty: boolean, survivors: (number|string)[]|null, waitedMs: number, reason: string}>}
 */
export async function waitForCensusEmpty(roots, opts = {}) {
  const boundMs = opts.boundMs ?? 5000;
  const pollMs = opts.pollMs ?? 100;
  const procRoot = opts.procRoot ?? '/proc';
  const listPids = opts.listPids;
  const now = opts.clock?.now ?? (() => Date.now());
  const sleep = opts.clock?.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  const filteredRoots = (roots ?? []).filter((r) => r !== null && r !== undefined);
  if (filteredRoots.length === 0) {
    return { empty: true, survivors: [], waitedMs: 0, reason: 'census-empty — no run root was recorded, so there is nothing to confirm' };
  }

  const unknownReason = `${procRoot} could not be fully confirmed — either the live listing could not be read, or a ` +
    'candidate\'s ancestry hit an unreadable link; the census cannot confirm empty, so it is not treated as empty';

  const started = now();
  for (;;) {
    const survivors = censusSurvivors(filteredRoots, { procRoot, listPids });
    const waited = now() - started;
    if (survivors === null) {
      if (waited >= boundMs) {
        return { empty: false, survivors: null, waitedMs: waited, reason: unknownReason };
      }
      await sleep(pollMs);
      continue;
    }
    if (survivors.length === 0) {
      return { empty: true, survivors: [], waitedMs: waited, reason: 'census-empty' };
    }
    if (waited >= boundMs) {
      return {
        empty: false,
        survivors,
        waitedMs: waited,
        reason: `pid(s) ${survivors.join(', ')} still alive or descended from the run root after ${boundMs} ms`,
      };
    }
    await sleep(pollMs);
  }
}

/** One line, always — a census that settled and one that never ran must not
 *  render the same way (the `IGNORED-BY-GROUND` rule this campaign keeps
 *  re-deriving: `ground-clear.mjs`, `sweep.mjs`). */
export function describeCensus(result) {
  if (result.empty) {
    return [`[stories] census: ${result.reason} (${result.waitedMs} ms)`];
  }
  return [`[stories] census: NOT empty after ${result.waitedMs} ms — ${result.reason}`];
}
