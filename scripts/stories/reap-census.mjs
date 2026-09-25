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
 * pids in as roots too; this module only confirms liveness, never discovers
 * parentage after the fact.
 *
 * REUSED, NOT REPARSED. `ancestorPids` (`lock-guard.mjs`) already walks a
 * `/proc/<pid>/status` `PPid:` chain with a `procRoot` seam for tests — the
 * same shape `lockHolders`/`lockWaiters` use. `pidsDescendedFrom` below is that
 * walk read from the other end: "does this candidate's ancestry pass through
 * X" rather than "what is this pid's whole ancestry". Nothing here parses
 * `/proc` a second, different way.
 *
 * THE KNOWN LIMITATION `ancestorPids` ALREADY CARRIES, INHERITED HERE ON
 * PURPOSE. A `/proc/<pid>/status` read that fails mid-chain stops the walk
 * there rather than throwing, so an UNREADABLE LINK reads as "no further
 * ancestry" rather than "unknown ancestry" — a false negative for descent, in
 * the unsafe direction for a census (it could under-report a survivor). This is
 * `ancestorPids`'s own long-standing behaviour, relied on elsewhere in this
 * tree, and not changed here; `censusSurvivors` still refuses to call an
 * UNREADABLE PROCROOT LISTING empty (see below) — the risk this module
 * actually closes is a wholesale failure to read `/proc` at all, not a single
 * raced link inside one candidate's chain.
 */
import { readdirSync } from 'node:fs';
import { ancestorPids } from './lock-guard.mjs';

/**
 * Which of `candidatePids` currently descend from `rootPid` — a live
 * `/proc` read, never a snapshot this function took itself.
 *
 * A pid is never its own descendant, so `rootPid` itself is excluded from the
 * result even when it appears in `candidatePids` — a caller checking "is the
 * root ALSO still alive" does that by including it directly in a liveness
 * check, not by asking this question.
 *
 * @param {ReadonlyArray<number|string>} candidatePids
 * @param {number|string} rootPid
 * @param {{procRoot?: string}} [opts]
 * @returns {(number|string)[]} the subset of `candidatePids` that descend from `rootPid`
 */
export function pidsDescendedFrom(candidatePids, rootPid, { procRoot = '/proc' } = {}) {
  const root = String(rootPid);
  const out = [];
  for (const pid of candidatePids ?? []) {
    const p = String(pid);
    if (p === root) continue;
    if (ancestorPids(p, { procRoot }).has(root)) out.push(pid);
  }
  return out;
}

/**
 * Every pid, from a fresh live listing, that IS one of `rootPids` or descends
 * from one — the whole census in one pass.
 *
 * NO SEPARATE "IS IT A ROOT ITSELF" CHECK, and that is not an oversight:
 * `ancestorPids(p, ...)` adds `p` to its own result BEFORE it reads anything
 * (`lock-guard.mjs`), so `ancestorPids(p).has(p)` is always true — a root pid
 * that is still alive in the listing is found by the SAME "descends from"
 * test below, with `r === p`. A second, explicit `roots.includes(p)` branch
 * would only ever agree with this one, never catch anything it misses.
 *
 * `null`, never `[]`, when the listing itself could not be read: an unreadable
 * `/proc` is unknown state, not a clean one, and the caller (`waitForCensusEmpty`)
 * treats the two very differently — §15.504's rule, that UNKNOWN must never be
 * spelled with the same shape as EMPTY.
 *
 * @param {ReadonlyArray<number|string>} rootPids
 * @param {{procRoot?: string, listPids?: () => (number|string)[]}} [opts]
 * @returns {(number|string)[] | null}
 */
export function censusSurvivors(rootPids, { procRoot = '/proc', listPids } = {}) {
  const roots = (rootPids ?? []).filter((p) => p !== null && p !== undefined).map(String);
  if (roots.length === 0) return [];
  let pids;
  try {
    pids = (listPids ?? (() => readdirSync(procRoot).filter((n) => /^[0-9]+$/.test(n))))();
  } catch {
    return null;
  }
  const survivors = [];
  for (const pid of pids) {
    const p = String(pid);
    if (roots.some((r) => ancestorPids(p, { procRoot }).has(r))) {
      survivors.push(pid);
    }
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
 * An empty `rootPids` is vacuously census-empty: a run that recorded no root
 * has nothing this check can refuse to clear on.
 *
 * An unreadable `procRoot` NEVER resolves to `empty: true` — an unknown
 * census is refused, not guessed clean, however long the bound runs.
 *
 * @param {ReadonlyArray<number|string>} rootPids
 * @param {{boundMs?: number, pollMs?: number, procRoot?: string,
 *          listPids?: () => (number|string)[],
 *          clock?: {now: () => number, sleep: (ms:number) => Promise<void>}}} [opts]
 * @returns {Promise<{empty: boolean, survivors: (number|string)[]|null, waitedMs: number, reason: string}>}
 */
export async function waitForCensusEmpty(rootPids, opts = {}) {
  const boundMs = opts.boundMs ?? 5000;
  const pollMs = opts.pollMs ?? 100;
  const procRoot = opts.procRoot ?? '/proc';
  const listPids = opts.listPids;
  const now = opts.clock?.now ?? (() => Date.now());
  const sleep = opts.clock?.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  const roots = (rootPids ?? []).filter((p) => p !== null && p !== undefined);
  if (roots.length === 0) {
    return { empty: true, survivors: [], waitedMs: 0, reason: 'census-empty — no run root was recorded, so there is nothing to confirm' };
  }

  const started = now();
  for (;;) {
    const survivors = censusSurvivors(roots, { procRoot, listPids });
    if (survivors === null) {
      return {
        empty: false,
        survivors: null,
        waitedMs: now() - started,
        reason: `${procRoot} could not be read — the census cannot confirm empty, so it is not treated as empty`,
      };
    }
    if (survivors.length === 0) {
      return { empty: true, survivors: [], waitedMs: now() - started, reason: 'census-empty' };
    }
    const waited = now() - started;
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
