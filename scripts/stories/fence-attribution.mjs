/**
 * fence-attribution.mjs — WHO owns a tree the fence found growth in.
 *
 * Split out of `sweep.mjs` at the 800-line cap, BY CONCERN and not by line
 * count (ruling 150). `sweep.mjs` answers "what grew and what does this run
 * clean up"; this file answers the separate question ruling 340 and bead
 * `forge-8vfn.7.5.1` put in front of it — "and whose growth was it" — which is
 * the difference between a report and a run-ending verdict.
 *
 * Two rules live here because they answer that question for two different
 * situations, and conflating them is the defect 7.5.1 records:
 *
 *   `liveProcessRoots`  — a tree that was PRESENT at run start. Somebody is
 *                         working IN it if a live process has its cwd there.
 *   `liveSessionOwners` — a tree that APPEARED during the run. Nobody is ever
 *                         rooted in it, because `git worktree add` runs from
 *                         its creator's own directory, so the question is whose
 *                         directory it was created INSIDE.
 *
 * Neither ever throws: an unreadable `/proc`, a pid that exits mid-walk, or a
 * process owned by another user all mean "cannot attribute this one", not "no
 * live process" — so each is skipped and the walk continues.
 */
import { existsSync, readdirSync, readlinkSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { pidsDescendedFrom } from './reap-census.mjs';

/**
 * Which of `dirs` has a live process ROOTED in it — `readlink /proc/<pid>/cwd`.
 *
 * Bead `forge-8vfn.6.11.34`, T1 ruling 340. `siblingWorktreeEscapes` diffs a
 * before/after snapshot per sibling worktree, which attributes growth by TIME
 * WINDOW rather than by writer: measured 2026-09-06, a concurrent gate in
 * `/home/parso/forge-gate-m5` ran `scripts/check-boundaries.test.ts`, which
 * plants `apps/studio/lib/__ws_probe__.ts` in its OWN tree, and this run
 * reported `CONTAINMENT FAILURE` over a story whose beats were 2/2 green.
 *
 * A process whose cwd is inside a sibling means SOMEBODY ELSE is working
 * there. This run's own processes — the bridge, the browser, the agent — are
 * rooted in the run's own worktree, which is never in `dirs`
 * (`snapshotSiblingWorktrees` skips it). **Stated rather than hidden:** if one
 * of this run's own processes ever chdir'd INTO a sibling and wrote there, the
 * growth would be reported unattributable instead of failing the run. The
 * paths are still named in full, loudly, on every line — what changes is
 * whether an ambiguous reading is allowed to fail a funded run on its own.
 *
 * Never throws: an unreadable `/proc`, a pid that exits mid-walk, or a process
 * owned by another user all mean "cannot attribute this one", not "no live
 * process" — so each is skipped and the walk continues.
 */
export function liveProcessRoots(dirs, deps = {}) {
  const live = new Map();
  if (dirs.length === 0) return live;
  // `/proc/<pid>/cwd` is a link to the REAL path, so a root reached through a
  // symlink (`/tmp` on some hosts, a worktree under a symlinked home) would
  // never match a plain `resolve`. Fall back to `resolve` for a root that
  // cannot be realpathed — a tree that is gone cannot own a process anyway.
  const real = (d) => { try { return realpathSync(d); } catch { return resolve(d); } };
  const roots = dirs.map((d) => ({ dir: d, resolved: real(d) }));
  for (const { pid, cwd } of livePidCwds(deps)) {
    for (const { dir, resolved } of roots) {
      if (live.has(dir)) continue;
      if (cwd === resolved || cwd.startsWith(`${resolved}${sep}`)) {
        live.set(dir, { pid, cwd, via: 'cwd' });
        break;
      }
    }
  }
  return live;
}

/**
 * The scratch roots a session working in `cwd` writes under.
 *
 * Bead `forge-8vfn.7.5.1`. A lane's agent session keeps its scratch files in a
 * directory NAMED AFTER its working directory, with every `/` replaced by `-`:
 * a session in `/home/parso/forge-m6-b` writes under
 * `/tmp/claude-<uid>/-home-parso-forge-m6-b/<session-id>/scratchpad/`. That is
 * the path the incident's tenth escape was reported at.
 *
 * ENCODE, never decode. The mapping is many-to-one — `-home-parso-forge-m6-b`
 * reads equally as `/home/parso/forge/m6/b` — so a lane identity read OUT of a
 * scratch path is a guess, and a guess is how a fence excuses the escape it
 * exists to catch. Deriving the root FROM a cwd this process actually observed
 * in `/proc` is exact.
 *
 * Both `os.tmpdir()` and a literal `/tmp` are offered because the host's TMPDIR
 * may differ from where the session actually wrote; a root that does not exist
 * simply never matches anything.
 *
 * RESIDUAL, measured and kept rather than hidden: `/` and `-` both encode to
 * `-`, so `/home/parso/forge/m6/b` yields the SAME root as
 * `/home/parso/forge-m6-b` (pinned by a test). A live process sitting at a
 * colliding cwd would therefore own that root too. It buys an attacker nothing
 * this guard was protecting — the fence names every path either way, and the
 * only difference is whether an ambiguous tree reds a funded run — but it is
 * the reason this function is never inverted.
 *
 * @param {string} cwd an ABSOLUTE working directory
 * @returns {string[]} the scratch roots that cwd implies, or [] if it implies none
 */
export function sessionScratchRoots(cwd) {
  if (typeof cwd !== 'string' || !cwd.startsWith('/')) return [];
  const encoded = cwd.replaceAll('/', '-');
  const bases = [...new Set([tmpdir(), '/tmp'])];
  return bases.map((b) => join(b, `claude-${process.getuid?.() ?? 0}`, encoded));
}

/**
 * How many EXTRA attempts an UNKNOWN `/proc/<pid>/cwd` read gets before this
 * walk gives up on that pid. Bounded and small on purpose: a read that will
 * never recover (a permission this host will never grant) must still resolve
 * quickly, not spin the walk out on a single pid.
 */
const UNKNOWN_READ_RETRIES = 2;

/**
 * Every live process's pid and cwd, read once — the shared walk behind both
 * `liveProcessRoots` and `liveSessionOwners`. Never throws (see `liveProcessRoots`).
 *
 * Bead `forge-po2h`. THREE STATES, NOT TWO (§15.504), the same split
 * `readEmitFailures` (`run-observe.mjs`) draws for the identical shape:
 * `ENOENT`/`ESRCH` on a `/proc/<pid>/cwd` read is the process having exited
 * (or never existed) between `readdirSync('/proc')` and this read — genuine
 * ABSENCE, skipped immediately, never retried, because retrying a confirmed-
 * gone pid cannot succeed and only costs time. Any OTHER error — `EACCES`, or
 * a syscall failure this process cannot attribute to the target pid at all —
 * is UNKNOWN, not absence: a signal that may exist and be unreadable must
 * never be spelled as "no live process" on the strength of one failed read, so
 * it is retried a small, bounded number of times before this pid is given up
 * on. The asymmetry is deliberate: a lost owner turns an UNATTRIBUTABLE escape
 * into an UNOWNED one, which reds a funded run, and that is the direction that
 * must never be reached by a read this process could have simply tried again.
 *
 * @param {{listPids?: () => string[], readCwd?: (pid: string) => string}} [deps] injection seam for the test
 */
function livePidCwds(deps = {}) {
  const listPids = deps.listPids ?? (() => {
    try {
      return readdirSync('/proc', { withFileTypes: true })
        .filter((e) => /^[0-9]+$/.test(e.name))
        .map((e) => e.name);
    } catch {
      return []; // no /proc: nothing can be attributed, so nothing is excused
    }
  });
  const readCwd = deps.readCwd ?? ((pid) => readlinkSync(join('/proc', pid, 'cwd')));
  const out = [];
  for (const pid of listPids()) {
    if (Number(pid) === process.pid) continue;
    let cwd;
    for (let attempt = 0; ; attempt += 1) {
      try {
        cwd = readCwd(pid);
        break;
      } catch (err) {
        if (err?.code === 'ENOENT' || err?.code === 'ESRCH') { cwd = undefined; break; } // gone: not evidence either way
        if (attempt >= UNKNOWN_READ_RETRIES) { cwd = undefined; break; } // still UNKNOWN after retrying: skipped, same as gone
      }
    }
    if (cwd === undefined) continue;
    out.push({ pid: Number(pid), cwd });
  }
  return out;
}

/**
 * Which of `dirs` sits inside a root some live session OWNS — its cwd, or the
 * scratch root that cwd implies.
 *
 * Bead `forge-8vfn.7.5.1`, T1's refinement of 2026-09-07. This answers a
 * different question from `liveProcessRoots`, and only for a worktree that
 * APPEARED during the run: not "is somebody working IN this tree" but "whose
 * directory did this tree get created inside". `git worktree add` runs from the
 * creator's own cwd, so the process that makes a tree is rooted OUTSIDE it and
 * the live-cwd rule can never see it — which is exactly how a concurrent lane's
 * disposable read-only checkout reddened a funded S1 run.
 *
 * A LANE IS A WORKTREE, NOT A DIRECTORY — round 2, and this one is a hole the
 * first version shipped with (#532). It checked each live pid's own `cwd` as an
 * ownership root, so a process sitting in `/tmp` owned EVERY worktree that
 * appeared anywhere beneath it. Measured by probe:
 *
 *   sleeper pid 93550 (cwd /tmp) => {pid:93550, via:'appeared', ownerRoot:'/tmp'}
 *
 * Under a full suite something is always sitting in a generic directory, which
 * is why it passed alone and failed under load — and on a host where a shell
 * sits in `$HOME`, a real escape into `~/forge-victim` would have been EXCUSED.
 * So the cwd arm now requires the cwd to be a git worktree root. The scratch-root
 * arm needs no such test: a scratch root already encodes one full cwd and cannot
 * be generic.
 *
 * The limit is deliberate: a session that has EXITED owns nothing, so a tree it
 * left behind has no owner and still reds. There is nobody to attribute it to,
 * and a path pattern on its own must never satisfy this guard.
 *
 * @param {string[]} dirs
 * @param {{listPids?: () => string[], readCwd?: (pid: string) => string}} [deps] injection seam for the test
 * @returns {Map<string,{pid:number,cwd:string,via:'appeared',ownerRoot:string}>}
 */
export function liveSessionOwners(dirs, deps = {}) {
  const owned = new Map();
  if (dirs.length === 0) return owned;
  const real = (d) => { try { return realpathSync(d); } catch { return resolve(d); } };
  const targets = dirs.map((d) => ({ dir: d, resolved: real(d) }));
  const under = (child, root) => child === root || child.startsWith(`${root}${sep}`);
  for (const { pid, cwd } of livePidCwds(deps)) {
    // `.git` is present as a directory in a checkout and as a FILE in a linked
    // worktree, so `existsSync` is the test that covers both — and `/tmp`,
    // `$HOME` and `/` fail it, which is the whole point.
    const roots = existsSync(join(cwd, '.git')) ? [cwd, ...sessionScratchRoots(cwd)] : sessionScratchRoots(cwd);
    for (const root of roots) {
      for (const { dir, resolved } of targets) {
        if (!under(resolved, root)) continue;
        // THE MOST SPECIFIC ROOT WINS, never the first one `/proc` happened to
        // enumerate (T1 ruling 442's second half). Roots genuinely overlap — a
        // worktree cut inside another lane's worktree is owned by both — and
        // first-match-wins made the answer depend on pid ordering, so the same
        // tree could be attributed to either session on two consecutive runs.
        // A confident wrong owner reads worse than an honest one, and a report
        // that names a session is a report someone will go and interrupt.
        //
        // Ties broken by the LOWER pid, so the result is a function of the host
        // state and nothing else. `ownerRoot` is in the record, so the report
        // always shows WHICH root won.
        const held = owned.get(dir);
        if (
          held === undefined ||
          root.length > held.ownerRoot.length ||
          (root.length === held.ownerRoot.length && pid < held.pid)
        ) {
          owned.set(dir, { pid, cwd, via: 'appeared', ownerRoot: root });
        }
      }
    }
  }
  return owned;
}

/**
 * ── T1 ruling 1225 — attribute a sibling-tree escape by the run's OWN
 * ancestry, not a snapshot-at-the-end guess ─────────────────────────────────
 *
 * The gap `liveProcessRoots`/`liveSessionOwners` above cannot close: both read
 * `/proc` ONCE, at fence time, after the run has already finished. A's S10 run
 * 24 measured the failure mode — `~/forge-m7-d-grp` was created mid-run by a
 * DIFFERENT lane's session, whose own cwd was its main checkout and whose
 * workers were transient shells, so nothing was live in the tree by the time
 * the fence looked. No owner, RED — for a tree this run never touched.
 *
 * The fix samples WHILE the run is live, and asks a narrower, provable
 * question: was a process DESCENDED FROM THIS RUN'S OWN ROOT actually seen
 * inside the tree, at any point? That is never a guess about a stranger's
 * session; it is this run's own process tree, walked by `pidsDescendedFrom`
 * (`reap-census.mjs`, #906) — never re-implemented here.
 */

/** How often the sampler below re-reads `/proc` while a run is in flight —
 *  background evidence-gathering, not a correctness-critical wait, so one
 *  named constant is the only place an operator tuning it needs to look. */
const DESCENDANT_SAMPLE_INTERVAL_MS = 2000;

/** T1 ruling 1473 (row 96) — how many multiples of the sample interval a run
 *  may go with NO successful sample before `attributeEscapes` can no longer
 *  trust the sampler to prove a tree clean. A COVERAGE GAP, never a raw error
 *  count: a handful of `/proc` hiccups, each retried away, cost real time but
 *  leave no gap at all, and must never fail-close a run on their own. */
const BLIND_GAP_FACTOR = 3;

/**
 * `d`, realpath'd, plus whether that failed for a reason OTHER than the tree
 * being genuinely gone (ENOENT) — ROW 102b/10. A pruned tree still falls back
 * to the syntactic `resolve(d)`, unchanged: it cannot own a process either
 * way. Any OTHER failure (EACCES, ELOOP, EIO on a symlinked escape root) must
 * not silently hand back an unresolved path that can fail to `===` the SAME
 * tree's realpath reached a different way — `attributeEscapes` below reads
 * `unknown` and refuses to call the comparison clean.
 */
function realpathOrResolveResult(d) {
  try {
    return { path: realpathSync(d), unknown: false };
  } catch (e) {
    return { path: resolve(d), unknown: e?.code !== 'ENOENT' };
  }
}

/** `d`, realpath'd where possible — a tree that no longer exists cannot own a
 *  process either way, so `resolve` is the honest fallback (mirrors the `real`
 *  closures above, kept separate rather than refactoring working code). */
function realpathOrResolve(d) {
  return realpathOrResolveResult(d).path;
}

/**
 * Walk `dir` upward to the nearest ancestor holding a `.git` — a file (linked
 * worktree) or a directory (a checkout), the same test `liveSessionOwners`
 * above already relies on. `git rev-parse --show-toplevel` semantics, done
 * without shelling out on every sample. Bounded so a pathological chain can
 * never spin this.
 *
 * @returns {string|null} the worktree root, realpath'd, or null if none is found
 */
function worktreeRootOf(dir) {
  let cur = dir;
  for (let guard = 0; guard < 64; guard += 1) {
    if (existsSync(join(cur, '.git'))) return realpathOrResolve(cur);
    const parent = dirname(cur);
    if (parent === cur) return null; // reached the filesystem root: no worktree here
    cur = parent;
  }
  return null; // guard exhausted — never spin on a pathological chain
}

/**
 * The directories a live pid holds a FILE open under — the "or an open file"
 * half of ruling 1225(a). A descendant that `cd`'d back out of a tree but is
 * still writing into a file it opened while inside it is still evidence; a
 * cwd-only sample would miss that window. Never throws: a raced fd (closed
 * between the listing and the read), a pipe, or a socket target is simply
 * skipped — the same per-item discipline every other `/proc` read in this
 * module uses.
 */
function openFileDirs(pid, procRoot, deps = {}) {
  const listFds = deps.listFds ?? ((p) => readdirSync(join(procRoot, String(p), 'fd')));
  const readFd = deps.readFd ?? ((p, fd) => readlinkSync(join(procRoot, String(p), 'fd', fd)));
  let fds;
  try {
    fds = listFds(pid);
  } catch {
    return []; // this pid's fd table could not be listed: no evidence either way
  }
  const dirs = [];
  for (const fd of fds) {
    let target;
    try {
      target = readFd(pid, fd);
    } catch {
      continue; // a read error on one fd skips that fd, same as one pid
    }
    if (typeof target === 'string' && target.startsWith('/')) dirs.push(dirname(target));
  }
  return dirs;
}

/** `err.code` when it is a string, else the bucket `livePidCwds` already
 *  treats an uncoded failure as: UNKNOWN, never absence. */
const errnoOf = (err) => (typeof err?.code === 'string' && err.code) || 'UNKNOWN';

/** Tally one failed attempt's errno into `errnos` (code -> count), in place —
 *  every attempt this module could not read, not only the ones that end up
 *  costing a sample, because "how many, of what kind" is exactly what row 96
 *  found nothing recording. */
function tallyErrno(errnos, err) {
  const code = errnoOf(err);
  errnos.set(code, (errnos.get(code) ?? 0) + 1);
}

/**
 * Samples `/proc` on an interval for processes descended from `rootPid`,
 * recording every worktree root a descendant was seen in — by its cwd, or an
 * open file. `unref()`'d so a forgotten `stop()` (a thrown test, an
 * abnormal exit) can never hold the process open, the crash-safety discipline
 * `sweep.mjs`'s own leading sweep rests on.
 *
 * A read error on one pid skips that pid (its cwd, or its fd table, or both)
 * — never counted as a sample error, that is normal per-pid attrition.
 *
 * An UNREADABLE `/proc` LISTING is different in kind: it means this sample
 * could not even enumerate candidates, so it must never be read as "no
 * descendants were found". T1 ruling 1473 (row 96) — the FIRST version of
 * this counted `sampleErrors` on the FIRST failed read of a single sample,
 * with no retry, and `attributeEscapes` then fail-closed on ANY count above
 * zero: one `/proc` hiccup, cleanly recoverable, reddened S4 funded run 2
 * (13/13 beats green) on a SIBLING lane's own test leak. So: (1) a failed
 * listing is retried, within the same sample, under the same bound
 * `livePidCwds`'s `UNKNOWN_READ_RETRIES` already uses — a sample counts as
 * errored only once EVERY attempt failed; (2) an exception from
 * `pidsDescendedFrom` itself, or from crediting a pid's evidence, is
 * contained here too (uncaught, it would have escaped this `setInterval`
 * callback and killed the whole sampler silently) and likewise counts the
 * sample as errored, never as "no descendants"; (3) every failed attempt's
 * errno is tallied, whether or not the sample it belongs to recovers, so a
 * report never has to guess how many attempts failed or of what kind; (4)
 * `longestGapMs` tracks the longest FAILURE WINDOW — from the last
 * successful sample before an errored one (or run start, if the first sample
 * errored) to the next success (or `stop()`, if it never recovered) — so
 * `attributeEscapes` can fail-close on an actual COVERAGE GAP instead of a
 * raw error count. Only a window that CONTAINS a failed sample counts: a gap
 * between two successes with no failure in it is the event loop running late
 * (synchronous work, host load — measured: this file's own real-/proc test
 * at loadavg 13 saw >3× a 10 ms interval between clean samples), and the
 * sampler's pre-row-96 contract always accepted that; counting it would have
 * traded one false red for another.
 *
 * @param {{rootPid: number|string, intervalMs?: number, procRoot?: string,
 *   listPids?: () => (number|string)[], readCwd?: (pid: number|string) => string,
 *   listFds?: (pid: number|string) => string[], readFd?: (pid: number|string, fd: string) => string}} opts
 * @returns {{stop(): {touchedRoots: Map<string,{pid:number|string,at:string,via:'cwd'|'open file'}>,
 *   samples: number, erroredSamples: number, errnos: Record<string,number>,
 *   longestGapMs: number, intervalMs: number}}}
 */
export function startDescendantSampler(opts) {
  const {
    rootPid, intervalMs = DESCENDANT_SAMPLE_INTERVAL_MS, procRoot = '/proc',
    listPids, readCwd, listFds, readFd,
  } = opts;
  const listPidsFn = listPids ?? (() =>
    readdirSync(procRoot, { withFileTypes: true }).filter((e) => /^[0-9]+$/.test(e.name)).map((e) => e.name));
  const readCwdFn = readCwd ?? ((pid) => readlinkSync(join(procRoot, String(pid), 'cwd')));

  const touchedRoots = new Map();
  const errnos = new Map();
  let erroredSamples = 0;
  let samples = 0;
  const startedAt = Date.now();
  let lastSuccessAt = null; // null: no sample has ever succeeded yet
  let failingSince = null; // start of the current failure window, or null while sighted
  let longestGapMs = 0;

  const note = (dir, pid, via) => {
    const root = worktreeRootOf(dir);
    if (root !== null && !touchedRoots.has(root)) touchedRoots.set(root, { pid, at: dir, via });
  };

  const markSuccess = (now) => {
    if (failingSince !== null) {
      longestGapMs = Math.max(longestGapMs, now - failingSince);
      failingSince = null;
    }
    lastSuccessAt = now;
  };
  const markErrored = () => {
    erroredSamples += 1;
    if (failingSince === null) failingSince = lastSuccessAt ?? startedAt;
  };

  const sampleOnce = () => {
    samples += 1;
    const now = Date.now();

    // (1) The listing itself: retried, within THIS sample, under the same
    // bound `livePidCwds` already uses for an UNKNOWN pid read — errored only
    // if every attempt failed, but every attempt's errno is tallied either way.
    let pids;
    let listErr;
    for (let attempt = 0; ; attempt += 1) {
      try {
        pids = listPidsFn();
        listErr = undefined;
        break;
      } catch (err) {
        listErr = err;
        tallyErrno(errnos, err);
        if (attempt >= UNKNOWN_READ_RETRIES) break; // still failing after retrying: give up on this sample
      }
    }
    if (listErr !== undefined) {
      markErrored(); // unreadable /proc listing, even after retrying: NEVER read as "no descendants"
      return;
    }

    // (2) Descending the tree and crediting each pid's evidence. Contained as
    // a whole — never just the per-pid cwd read below — because an exception
    // from `pidsDescendedFrom` itself (never re-implemented here) or from
    // crediting evidence would otherwise escape this `setInterval` callback
    // uncaught and silently end the sampler for the rest of the run.
    try {
      for (const pid of pidsDescendedFrom(pids, rootPid, { procRoot })) {
        try {
          note(readCwdFn(pid), pid, 'cwd');
        } catch {
          // this pid's cwd could not be read — still try its open files below
        }
        for (const dir of openFileDirs(pid, procRoot, { listFds, readFd })) note(dir, pid, 'open file');
      }
    } catch (err) {
      markErrored();
      tallyErrno(errnos, err);
      return;
    }

    markSuccess(now);
  };

  sampleOnce(); // a run that starts and finishes inside one interval is still sampled once
  const timer = setInterval(sampleOnce, intervalMs);
  timer.unref?.();

  return {
    stop: () => {
      clearInterval(timer);
      if (failingSince !== null) longestGapMs = Math.max(longestGapMs, Date.now() - failingSince); // never recovered: window runs to stop
      return { touchedRoots, samples, erroredSamples, errnos: Object.fromEntries(errnos), longestGapMs, intervalMs };
    },
  };
}

/** `git check-ignore` for one path inside `root` — the real, default
 *  `isIgnored` ruling 1226 asks for. Exit 0 means git considers `path`
 *  ignored; exit 1 (not ignored) and any OTHER failure both read as NOT
 *  ignored — the fail-closed direction, since "not ignored" is what makes
 *  rule (b) fire THIS-RUN. */
function isMainCheckoutIgnored(root, path) {
  try {
    execFileSync('git', ['check-ignore', '--quiet', '--', path], { cwd: root, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** `tracked-and-changed` or `untracked` — ruling 1226's own requirement that
 *  the verdict names each main-checkout path's git status. Best-effort
 *  reporting only: an unreadable status never blocks the verdict, it is
 *  simply labelled `untracked` rather than thrown. */
function labelPathStatus(root, path) {
  let out = '';
  try {
    out = execFileSync('git', ['status', '--porcelain', '-z', '--', path], { cwd: root, encoding: 'utf8' });
  } catch {
    return 'untracked';
  }
  const xy = out.split('\0')[0]?.slice(0, 2);
  return xy && xy !== '??' ? 'tracked-and-changed' : 'untracked';
}

/**
 * The MAIN checkout `root` belongs to — the FIRST `worktree` git itself lists
 * (`git worktree list --porcelain`), which is always the main working tree,
 * never a linked one. Never hardcoded to any one host's path (ruling 1226
 * names `/home/parso/forge` only as an example). `null` outside a
 * worktree-bearing checkout.
 */
/** `mainCheckoutRoot`'s explicit UNKNOWN — ROW 102b/11. A `git worktree list`
 *  failure OTHER than "this is not a git repository" (rc 128, git's own
 *  message) must not read the same as "no main tree to distinguish": that
 *  disables ruling 1226's whole main-checkout drift rule for the run.
 *  `attributeEscapes` fails the fence closed on it instead of null's silent
 *  opt-out. */
export const MAIN_CHECKOUT_ROOT_UNKNOWN = Symbol('main-checkout-root-unknown');

export function mainCheckoutRoot(root) {
  let out;
  try {
    out = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8' });
  } catch (e) {
    const notARepo = e?.status === 128 && /not a git repository/i.test(String(e?.stderr ?? ''));
    return notARepo ? null : MAIN_CHECKOUT_ROOT_UNKNOWN; // genuinely no repo vs. UNKNOWN
  }
  const first = out.split('\n').find((l) => l.startsWith('worktree '));
  return first ? realpathOrResolve(first.slice('worktree '.length).trim()) : null;
}

/**
 * Marks each sibling-tree escape `{owner: 'this-run'|'unattributable', reason}`
 * — T1 ruling 1225's rule, verbatim: THIS-RUN iff (a) a descendant of this
 * run's own root process was sampled, DURING the run, with its cwd or an open
 * file inside that tree (`touchedRoots`, from `startDescendantSampler`), or
 * (b) the tree IS the main checkout and the growth is not gitignored
 * (`isIgnored`) — the npm-linked `forge` writes there and ancestry sampling
 * alone would miss it (ruling 1226).
 *
 * EVERYTHING ELSE is UNATTRIBUTABLE, printed in full, never red — including a
 * tree with NO live process at all, the S10 run 24 defect this closes: a
 * `liveProcessRoots`/`liveSessionOwners` miss used to fall straight through to
 * `unownedEscapes` and RED the run; absence of a live OWNER was never
 * evidence this run WROTE the tree, and it no longer stands in for that
 * question.
 *
 * FAIL CLOSED when the sampler itself could not prove COVERAGE — T1 ruling
 * 1473 (row 96), replacing the original rule (`sampleErrors > 0`): that
 * counted every RETRIED-AWAY `/proc` hiccup as blind and fail-closed on it,
 * which reddened S4 funded run 2 (13/13 beats green) on a sibling lane's own
 * test leak. Blindness is a GAP, never a count: blind iff `longestGapMs`
 * (the longest FAILURE window — `startDescendantSampler`'s own result) exceeds
 * `BLIND_GAP_FACTOR × intervalMs`, or no coverage figure was passed at all. A sampler that merely
 * retried a few hiccups away, with real coverage throughout, is sighted; one
 * that went dark for a sustained stretch cannot prove a tree clean, so growth
 * it did not otherwise attribute stays THIS-RUN — and the reason names
 * `samples`, `erroredSamples`, `longestGapMs` and the errno codes seen, so a
 * reader never has to take "blind" on faith.
 *
 * @param {Array<{root: string, paths: string[]}>} escapes from `siblingWorktreeEscapes`
 * @param {{touchedRoots?: Map<string,{pid:number|string,at:string,via:string}>,
 *   mainRoot?: string|null, isIgnored?: (path: string) => boolean, samples?: number,
 *   erroredSamples?: number, errnos?: Record<string,number>, longestGapMs?: number,
 *   intervalMs?: number}} [opts]
 * @returns {Array<{owner: 'this-run'|'unattributable', reason: string}>} (spread onto each escape)
 */
export function attributeEscapes(escapes, opts = {}) {
  const touchedRoots = opts.touchedRoots ?? new Map();
  const mainRoot = opts.mainRoot ?? null;
  const mainRootUnknown = mainRoot === MAIN_CHECKOUT_ROOT_UNKNOWN;
  const mainResult = mainRoot === null || mainRootUnknown ? { path: null, unknown: false } : realpathOrResolveResult(mainRoot);
  const mainResolved = mainResult.path;
  const intervalMs = opts.intervalMs ?? DESCENDANT_SAMPLE_INTERVAL_MS;
  // An ABSENT coverage figure is blind, never the best possible one: a caller
  // that did not pass the sampler's result, or a sampler that never ran, has
  // proved nothing about any sibling tree (row 96 review; `?? 0` failed open).
  const coverageKnown = Number.isFinite(opts.longestGapMs);
  const longestGapMs = coverageKnown ? opts.longestGapMs : null;
  const blind = !coverageKnown || longestGapMs > BLIND_GAP_FACTOR * intervalMs;
  return (escapes ?? []).map((e) => {
    const escResult = realpathOrResolveResult(e.root);
    const resolved = escResult.path;
    const seen = touchedRoots.get(resolved) ?? touchedRoots.get(e.root);
    if (seen !== undefined) {
      return {
        ...e,
        owner: 'this-run',
        reason: `sampled pid ${seen.pid} with its ${seen.via} inside ${e.root} (${seen.at}) — a descendant of this run's own root process`,
      };
    }
    // ROW 102b/10-11 — a realpath failure on either side of the comparison
    // below, or `mainCheckoutRoot` itself returning UNKNOWN, means it cannot
    // be trusted. Never let an unresolved path silently miss the
    // main-checkout match and fall through toward unattributable — that is
    // exactly how a real containment breach goes quiet.
    if (mainRootUnknown || escResult.unknown || mainResult.unknown) {
      const why = mainRootUnknown
        ? 'the main checkout could not be determined (git worktree list failed for a reason other than "not a repository")'
        : escResult.unknown
          ? `${e.root} could not be resolved to compare against the main checkout`
          : `the main checkout (${mainRoot}) could not be resolved`;
      return { ...e, owner: 'this-run', reason: `${why} — ruling 1226's drift rule cannot be ruled out, so this growth stays THIS-RUN` };
    }
    if (mainResolved !== null && resolved === mainResolved) {
      const isIgnored = opts.isIgnored ?? ((p) => isMainCheckoutIgnored(mainRoot, p));
      const notIgnored = e.paths.filter((p) => !isIgnored(p));
      if (notIgnored.length > 0) {
        const named = notIgnored.map((p) => `${p} (${labelPathStatus(mainRoot, p)})`).join(', ');
        return {
          ...e,
          owner: 'this-run',
          reason: `main checkout (${e.root}) grew non-gitignored path(s), ruling 1226: ${named}`,
        };
      }
    }
    if (blind) {
      const samples = opts.samples ?? 0;
      const erroredSamples = opts.erroredSamples ?? 0;
      const errnoEntries = Object.entries(opts.errnos ?? {});
      const errnos = errnoEntries.length > 0 ? errnoEntries.map(([code, n]) => `${code}×${n}`).join(', ') : 'none recorded';
      return {
        ...e,
        owner: 'this-run',
        reason: (coverageKnown
          ? `the descendant sampler went longestGapMs=${longestGapMs} without a successful /proc read — over ` +
            `the ${BLIND_GAP_FACTOR}× ${intervalMs}ms bound`
          : 'no sampler coverage figure was recorded for this run (longestGapMs absent)') +
          ` (samples=${samples}, erroredSamples=${erroredSamples}, ` +
          `errnos=${errnos}) — a blind sampler cannot prove ${e.root} clean, so its growth stays THIS-RUN`,
      };
    }
    return { ...e, owner: 'unattributable', reason: `no descendant of this run was seen in ${e.root}` };
  });
}

/** One line per escaped path — THIS-RUN or UNATTRIBUTABLE, and why. */
export function describeAttribution(attributed) {
  return (attributed ?? []).flatMap(({ root, paths, owner, reason }) =>
    paths.map((p) =>
      owner === 'this-run'
        ? `[stories] fence: THIS-RUN ${p} — written into ${root}; ${reason} — the run is RED`
        : `[stories] fence: UNATTRIBUTABLE ${p} — written into ${root}; ${reason} — not fatal`,
    ),
  );
}
