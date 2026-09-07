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
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

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
export function liveProcessRoots(dirs) {
  const live = new Map();
  if (dirs.length === 0) return live;
  // `/proc/<pid>/cwd` is a link to the REAL path, so a root reached through a
  // symlink (`/tmp` on some hosts, a worktree under a symlinked home) would
  // never match a plain `resolve`. Fall back to `resolve` for a root that
  // cannot be realpathed — a tree that is gone cannot own a process anyway.
  const real = (d) => { try { return realpathSync(d); } catch { return resolve(d); } };
  const roots = dirs.map((d) => ({ dir: d, resolved: real(d) }));
  let pids = [];
  try {
    pids = readdirSync('/proc', { withFileTypes: true })
      .filter((e) => /^[0-9]+$/.test(e.name))
      .map((e) => e.name);
  } catch {
    return live; // no /proc: nothing can be attributed, so nothing is excused
  }
  for (const pid of pids) {
    if (Number(pid) === process.pid) continue;
    let cwd = '';
    try {
      cwd = readlinkSync(join('/proc', pid, 'cwd'));
    } catch {
      continue; // gone, or another user's — not evidence either way
    }
    for (const { dir, resolved } of roots) {
      if (live.has(dir)) continue;
      if (cwd === resolved || cwd.startsWith(`${resolved}${sep}`)) {
        live.set(dir, { pid: Number(pid), cwd, via: 'cwd' });
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

/** Every live process's pid and cwd, read once. Never throws (see `liveProcessRoots`). */
function liveProcessCwds() {
  const out = [];
  let pids = [];
  try {
    pids = readdirSync('/proc', { withFileTypes: true })
      .filter((e) => /^[0-9]+$/.test(e.name))
      .map((e) => e.name);
  } catch {
    return out;
  }
  for (const pid of pids) {
    if (Number(pid) === process.pid) continue;
    try {
      out.push({ pid: Number(pid), cwd: readlinkSync(join('/proc', pid, 'cwd')) });
    } catch {
      continue; // gone, or another user's — not evidence either way
    }
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
 * @returns {Map<string,{pid:number,cwd:string,via:'appeared',ownerRoot:string}>}
 */
export function liveSessionOwners(dirs) {
  const owned = new Map();
  if (dirs.length === 0) return owned;
  const real = (d) => { try { return realpathSync(d); } catch { return resolve(d); } };
  const targets = dirs.map((d) => ({ dir: d, resolved: real(d) }));
  const under = (child, root) => child === root || child.startsWith(`${root}${sep}`);
  for (const { pid, cwd } of liveProcessCwds()) {
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
