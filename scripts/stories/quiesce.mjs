/**
 * quiesce.mjs — the tree stops moving BEFORE the fence judges it.
 *
 * THE DEFECT THIS CLOSES (bead `forge-8vfn.7.5.2`, filed by lane M6-D under
 * ruling 393; measured on S6's re-measure, `_1.0/reports/m6-d-S6-1.log`, tree
 * `10dbdccc`):
 *
 *   13:49:02.890Z  fence: REMOVED brain/story-s6/ … contained kb.yaml (268 B)
 *   13:49:02.902Z  S6: red — 8/14 beats green
 *   13:49:02.935Z  brain/story-s6/kb.yaml re-created; porcelain `??` after
 *
 * The fence removed the directory, reported it, and 45 ms later the bridge the
 * run booted — still shutting down — put it back. **The line was true when it
 * was written and false at process exit.** That line is evidence a lane pastes
 * into a ledger, so the run recorded a clean sweep while leaving residue, and
 * the next run then meets a KB that already exists. It is the fence's own
 * class one layer up: absence of red AT THE MOMENT OF THE CHECK mistaken for
 * absence of red.
 *
 * WHY "KILL THE WRITER, THEN SWEEP" CANNOT BE THE WHOLE ANSWER. `run.mjs` boots
 * ONE bridge and drives every story through it, so the bridge must outlive each
 * story's sweep by design. Waiting for it to exit would break `npm run stories`
 * after the first story. So this module does two things instead, and neither is
 * sufficient alone:
 *
 *   1. **Quiesce** — confirm every pid the reap signalled is actually GONE (a
 *      `kill` returning does not mean the process has ended), then wait for the
 *      tree itself to stop changing. Both bounded, and both report the bound
 *      they gave up at rather than returning a bare boolean.
 *   2. **Verify** — `reappeared()` re-reads after the fence and NAMES anything
 *      that came back. A bounded wait can always be outlasted; a report that
 *      re-reads cannot silently lie.
 *
 * EVERY PATH PRINTS (§15.92). `describeQuiesce` returns a line whether it
 * settled or not — "nothing was checked" and "everything checked out" must
 * never look the same, which is the same argument the fence itself is built on.
 *
 * The clock, the liveness probe and the tree read are all INJECTED, so the
 * bounds are tested rather than waited out (`quiesce.test.ts`).
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const REAL_CLOCK = { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

/**
 * Is `pid` — or anything it fathered — still running? §15.206's whole-parentage
 * read: a bridge that has forked a child is not gone when its own entry goes,
 * and the child is the writer that put the directory back.
 */
export function pidAliveWithChildren(pid) {
  let entries = [];
  try {
    entries = readdirSync('/proc', { withFileTypes: true }).filter((e) => /^[0-9]+$/.test(e.name)).map((e) => e.name);
  } catch {
    return false; // no /proc: nothing can be observed, so nothing is claimed alive
  }
  if (entries.includes(String(pid))) return true;
  for (const p of entries) {
    let ppid = '';
    try {
      const stat = execFileSync('cat', [`/proc/${p}/stat`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      ppid = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1] ?? '';
    } catch {
      continue;
    }
    if (ppid === String(pid)) return true;
  }
  return false;
}

/**
 * Wait until every pid in `pids` is gone, or the bound expires.
 * @returns {Promise<{gone:number[],alive:number[],waitedMs:number,timedOut:boolean}>}
 */
export async function waitForPidsGone(pids, { upToMs, pollMs, clock = REAL_CLOCK, alive = pidAliveWithChildren } = {}) {
  if (pids.length === 0) return { gone: [], alive: [], waitedMs: 0, timedOut: false };
  const started = clock.now();
  let outstanding = [...pids];
  const gone = [];
  while (outstanding.length > 0 && clock.now() - started < upToMs) {
    const still = [];
    for (const pid of outstanding) {
      if (alive(pid)) still.push(pid);
      else gone.push(pid);
    }
    outstanding = still;
    if (outstanding.length === 0) break;
    await clock.sleep(pollMs);
  }
  return { gone, alive: outstanding, waitedMs: clock.now() - started, timedOut: outstanding.length > 0 };
}

/** The tree read the quiet check compares. Porcelain, ignored roots included by the fence's own rule. */
function readPorcelain(root) {
  try {
    return execFileSync('git', ['status', '--porcelain', '-uall'], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch {
    return ''; // an unreadable tree is not a moving one; the fence reports separately
  }
}

/**
 * Wait until two consecutive reads of the tree agree, or the bound expires.
 * @returns {Promise<{quiet:boolean,waitedMs:number,timedOut:boolean,reads:number}>}
 */
export async function waitForTreeQuiet({ root, upToMs, settleMs, clock = REAL_CLOCK, readTree } = {}) {
  const read = readTree ?? (() => readPorcelain(root));
  const started = clock.now();
  let previous = read();
  let reads = 1;
  while (clock.now() - started < upToMs) {
    await clock.sleep(settleMs);
    const current = read();
    reads += 1;
    if (current === previous) return { quiet: true, waitedMs: clock.now() - started, timedOut: false, reads };
    previous = current;
  }
  return { quiet: false, waitedMs: clock.now() - started, timedOut: true, reads };
}

/**
 * Both halves. `settled` is true only when BOTH succeeded: a live writer means
 * the sweep is unsafe whatever the tree happens to look like this instant.
 */
export async function quiesceWriters({ root, pids = [], upToMs = 15_000, pollMs = 100, settleMs = 250, clock = REAL_CLOCK, alive, readTree } = {}) {
  const pidReport = await waitForPidsGone(pids, { upToMs, pollMs, clock, alive });
  const treeReport = await waitForTreeQuiet({ root, upToMs, settleMs, clock, readTree });
  return { pids: pidReport, tree: treeReport, settled: !pidReport.timedOut && treeReport.quiet };
}

/** One line, always. */
export function describeQuiesce(report) {
  const waited = report.pids.waitedMs + report.tree.waitedMs;
  if (report.settled) {
    return [
      `[stories] quiesce: settled after ${waited} ms — ${report.pids.gone.length} writer(s) confirmed gone and the tree read the same twice; the fence below judges a tree that has stopped moving`,
    ];
  }
  const why = [];
  if (report.pids.timedOut) why.push(`pid ${report.pids.alive.join(', ')} still alive`);
  if (!report.tree.quiet) why.push('the tree was still changing');
  return [
    `[stories] quiesce: NOT settled after ${waited} ms — ${why.join(' and ')}. ` +
    "the fence's report below is a snapshot, not a final state; anything that comes back is named after it",
  ];
}

/**
 * Which of `removed` is present again in `porcelainLines`.
 *
 * A removed DIRECTORY is back if anything under it is (the incident's shape:
 * `brain/story-s6` removed, `brain/story-s6/kb.yaml` back). A removed FILE is
 * back only on an exact match — `a/b.txt.bak` is not `a/b.txt`.
 */
export function reappeared(removed, porcelainLines) {
  const paths = porcelainLines.map((l) => l.replace(/^..\s+/, '').trim()).filter(Boolean);
  return removed.filter((r) => {
    const bare = r.replace(/\/$/, '');
    return paths.some((p) => p === bare || p.startsWith(`${bare}/`));
  });
}
