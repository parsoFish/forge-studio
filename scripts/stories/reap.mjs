/**
 * reap.mjs — every agent a story run dispatched is dead when the run ends.
 *
 * THE INCIDENT (bead `forge-8vfn.5.37`, LIFECYCLE half; measured on the S3 run,
 * 2026-09-02). A beat pressed `run-onboarding-agent`, forge dispatched a real
 * Agent, and the run then wrote its verdict and exited — leaving that Agent
 * running as an ORPHAN. It went on to leave the run's worktree entirely and
 * executed `forge constraints author` / `forge preflight converge --accept …`
 * inside ANOTHER session's checkout, adding ten files to that tree's copy of
 * the story ground. No `git status` anywhere showed it: the project's own
 * `.gitignore` ignores `.forge/`, forge's ignores `projects/*`.
 *
 * The orphan window IS the escape window. A run that has written its verdict
 * has stopped watching by definition, so anything still executing past that
 * point is unobserved by the very gate that started it — and a gate that
 * starts processes it does not stop is not bounded by its own run.
 *
 * THE KILL IS AIMED, NEVER PATTERNED. COMMON §15.17 exists because a
 * `pkill -f` on a shared pattern coincided with three sessions dying in one
 * minute. So a pid is signalled only after its OWN `/proc/<pid>/cwd` is read
 * and placed INSIDE this run's worktree — the same probe, and the same
 * `readProcCwd`, the bridge-identity decision already uses. An unreadable cwd
 * is unknown provenance, and unknown provenance is not our provenance: skipped
 * and reported, never signalled on a guess. A prefix is not containment
 * either: `<root>-evil` shares nine characters with `<root>` and belongs to
 * someone else.
 *
 * THE SECOND INCIDENT (bead `forge-8vfn.5.45`; S9 run 3, 2026-09-03). The
 * reaper signalled the recorded `turn.pid` and stopped there. That turn had a
 * child, which re-parented to a system pid when its parent died and outlived
 * the run by about three minutes. Its log line was
 * `NOT reaped: cwd unreadable — unknown provenance`: the parent was already
 * dying, so its `/proc/<pid>/cwd` link had gone, and the rule written for a
 * STALE pid file fired on a process we had just killed ourselves.
 *
 * Two defects, and they compound. (1) Only the recorded pid was enumerated.
 * A dispatched turn LEADS ITS OWN PROCESS GROUP — `spawnAgentTurn` spawns
 * `detached: true`, and `killTrackedTurn` (packages/sessions/bridge-studio-
 * lifecycle.ts) already signals `-pid` for exactly this reason; the reaper did
 * not. (2) An unreadable cwd on a pid THIS RUN RECORDED is not unknown
 * provenance: we wrote that pid file ourselves. Unknown provenance means a pid
 * nothing in this run can account for.
 *
 * So provenance is now a ladder, strongest first, and every reaped pid says
 * which rung admitted it:
 *   - `record`  — we wrote this pid into a `turn.pid` under our own `_logs/`
 *                 after this run started.
 *   - `descendant` — its ancestor chain, SNAPSHOTTED BEFORE ANY SIGNAL,
 *                 reaches a pid we admitted. Signalling breaks ppid links, so
 *                 the walk that finds these has to happen first.
 *   - `cwd`     — `/proc/<pid>/cwd` sits inside the run worktree (the S3 rule).
 *
 * What did NOT change, because the S3 incident bought it: a RECORDED pid whose
 * cwd is READABLE and OUTSIDE the run worktree is never signalled — being ours
 * is not a licence to kill a process we can see working in someone else's
 * tree — and refusing that pid refuses its whole subtree, because a tree whose
 * root we cannot claim is not ours to kill.
 *
 * The converse is deliberate and is the security decision in this file: once
 * the ROOT is admitted, its descendants and group members are signalled
 * WITHOUT a cwd probe of their own. A descendant of our turn is something our
 * turn spawned, so parentage is provenance; the cwd probe exists for the ROOT,
 * where the only other evidence is a pid file that could in principle be
 * stale. Requiring the probe of descendants too would re-open the S3 escape
 * from the other side: an agent that has `cd`'d out of the worktree is exactly
 * the process this module exists to kill, and it would be the one process a
 * cwd rule spared. `kill(-N)` is sent only when `/proc` says
 * N leads its own group; `-N` for a non-leader signals a STRANGER'S group,
 * which is COMMON §15.17's pattern kill through a numeric door.
 *
 * A RESIDUAL GAP THIS DOES NOT CLOSE, recorded rather than papered over. A
 * grandchild that BOTH calls `setsid` (leaving our group) AND loses its parent
 * before the snapshot is invisible to both walks: its ppid no longer leads
 * back to us and its pgid is its own. The only evidence left is its cwd — and
 * discovering processes by "cwd inside ownRoot" is not available here, because
 * `run.mjs` passes the REPO ROOT as `ownRoot`, so such a sweep would signal
 * the story runner itself, the Studio bridge and the operator's own shell.
 * Closing it needs the DISPATCH to record more than a pid (a cgroup, or a
 * subreaper so orphans re-parent to the run instead of to init) — product
 * work, not a harness change. Filed rather than half-built.
 *
 * SCOPE. This closes 5.37's LIFECYCLE half and 5.45's group/descendant gap. That an agent could `cd`
 * out of its worktree at all is 5.37's containment half (M4-agents), and that
 * the run's event log stopped five minutes before the agent did is
 * `forge-8vfn.5.38` — neither is touched here.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { readProcCwd } from './bridge.mjs';

/** How long a dispatched agent gets to exit on SIGTERM before SIGKILL. */
const DEFAULT_GRACE_MS = 5_000;
/** How often its liveness is re-read during that grace period. */
const DEFAULT_POLL_MS = 100;

/** Real-filesystem default for {@link collectAgentRuns}. */
function listSessionDirs(logsDir) {
  return readdirSync(logsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, mtimeMs: statSync(join(logsDir, e.name)).mtimeMs }));
}

/** Real-filesystem default for {@link collectAgentRuns}. */
function readPidFile(path) {
  try {
    const n = Number.parseInt(readFileSync(path, 'utf8').trim(), 10);
    return Number.isInteger(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Every session this run dispatched, read from the `turn.pid` each one writes.
 *
 * `sinceMs` is the run's own start: a session dir older than the run belongs
 * to a PREVIOUS run and is not ours to kill — the same reasoning that makes
 * the bridge decision refuse a foreign holder rather than take it over.
 *
 * Deliberately keyed on "carries a `turn.pid`" rather than on a `_agent-`
 * filename prefix: the S3 incident's dispatch wrote TWO session dirs
 * (`_agent-onboarding-agent-…` and `_onboarding-…`), both with a pid, and a
 * filename-keyed scan is the class COMMON §15.16/§15.22 keeps catching.
 *
 * Never throws — this runs in a `finally`, and a teardown that throws loses
 * the verdict the run just produced.
 */
export function collectAgentRuns(root, sinceMs, deps = {}) {
  const listDirs = deps.listDirs ?? listSessionDirs;
  const readPid = deps.readPid ?? readPidFile;
  const logsDir = join(root, '_logs');

  let entries;
  try {
    entries = listDirs(logsDir);
  } catch {
    return [];
  }

  const runs = [];
  for (const entry of entries) {
    if (entry.mtimeMs < sinceMs) continue;
    const dir = join(logsDir, entry.name);
    const pid = readPid(join(dir, 'turn.pid'));
    if (pid === null) continue;
    runs.push({ dir, pid });
  }
  return runs;
}

/**
 * The process table as `{ ppid, pgrp }` per pid, read once from `/proc`.
 *
 * Read BEFORE any signal, and only once per dispatched run: a SIGTERM to the
 * parent re-parents its children within milliseconds, so a walk performed
 * after the kill sees an orphan whose ancestry no longer points at us. That is
 * precisely how S9 run 3's grandchild became "unknown provenance".
 *
 * `/proc/<pid>/stat` puts the executable name in parentheses and the name may
 * itself contain spaces or a `)`, so the fields are taken from after the LAST
 * `)` — never by splitting the whole line.
 *
 * Never throws: this runs inside the run's `finally`.
 */
export function readProcTable(deps = {}) {
  const listPids =
    deps.listPids ?? (() => readdirSync('/proc').filter((n) => /^\d+$/.test(n)).map((n) => Number.parseInt(n, 10)));
  const readStat = deps.readStat ?? ((pid) => readFileSync(`/proc/${pid}/stat`, 'utf8'));

  const table = new Map();
  let pids;
  try {
    pids = listPids();
  } catch {
    return table;
  }
  for (const pid of pids) {
    let raw;
    try {
      raw = readStat(pid);
    } catch {
      continue; // exited between the listing and the read — not an error
    }
    const close = raw.lastIndexOf(')');
    if (close === -1) continue;
    const fields = raw.slice(close + 2).split(' ');
    const ppid = Number.parseInt(fields[1], 10);
    const pgrp = Number.parseInt(fields[2], 10);
    if (!Number.isInteger(ppid) || !Number.isInteger(pgrp)) continue;
    table.set(pid, { ppid, pgrp });
  }
  return table;
}

/**
 * Every transitive descendant of `pid` in a snapshotted table, breadth-first.
 *
 * `seen` is not an optimisation: `/proc` is read pid by pid while the table
 * changes underneath, so a row can name a parent that has already been reused
 * and produce a cycle. A teardown that spins is a teardown that never releases
 * the run.
 */
export function descendantsOf(pid, table) {
  const children = new Map();
  for (const [child, row] of table) {
    if (child === row.ppid) continue; // a self-parenting row is not a child of itself
    if (!children.has(row.ppid)) children.set(row.ppid, []);
    children.get(row.ppid).push(child);
  }
  const out = [];
  const seen = new Set([pid]);
  const queue = [pid];
  while (queue.length > 0) {
    for (const child of children.get(queue.shift()) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      out.push(child);
      queue.push(child);
    }
  }
  return out;
}

/**
 * Every OTHER pid in the snapshot whose process group is `pid`'s own.
 *
 * This is the half that survives the parent (5.45). `spawnAgentTurn` spawns
 * `detached: true`, so a dispatched turn's process-group id IS its pid, and a
 * group id outlives its leader as long as the group has members — whereas the
 * moment the leader dies the ppid chain that would have found those members
 * points at a system reaper instead. In S9 run 3 the parent was already dying
 * when the reaper looked, so ancestry found nothing and the grandchild lived.
 * Group membership had not moved.
 *
 * A non-empty result is also the EVIDENCE that lets `kill(-pid)` be sent for a
 * leader we can no longer see: the group is observed to exist, not assumed.
 *
 * THE REUSE WINDOW, stated correctly. Admitting a group by a DEAD pid is wrong
 * if the kernel has reused that pid as another group's id, and the churn that
 * gets it there is SYSTEM-WIDE — every process on the host, not this run's own
 * dispatches. `/proc/sys/kernel/pid_max` is 4,194,304 here, and pids are
 * handed out sequentially and wrap, so reuse of one specific number needs
 * ~4.19M process creations across the whole machine between the dispatch and
 * the teardown: hours of saturated forking, against a story run that lasts
 * minutes. (An earlier draft of this comment scoped the count to the run
 * itself. That was wrong, and the number it produced was right for the wrong
 * reason.)
 *
 * Because the argument is a bound and not a proof, `reapAgentRuns` does not
 * rest on it: a group whose leader is GONE is swept only when a surviving
 * member corroborates by sitting inside the run worktree. The sweep is also
 * keyed on a pid this run RECORDED, bounded by `collectAgentRuns`'s `sinceMs`,
 * and never on a pid found by name or by pattern.
 */
export function groupMembersOf(pid, table) {
  const members = [];
  for (const [member, row] of table) {
    if (member !== pid && row.pgrp === pid) members.push(member);
  }
  return members;
}

/** True iff `cwd` is `root` itself or a path genuinely beneath it. */
function isInside(cwd, root) {
  return cwd === root || cwd.startsWith(`${root}/`);
}

/**
 * Whether this pid may be signalled — pure, so the containment rule is
 * testable without a process table.
 *
 * `recorded` is true for a pid this run read out of its own `turn.pid`, and
 * `descendant` for one whose ancestor chain reached such a pid before any
 * signal was sent. Either is stronger evidence than a cwd probe, because it
 * survives the process dying; a cwd probe does not (5.45).
 *
 * The order below is the whole rule: a READABLE cwd outside our tree refuses
 * FIRST, ahead of every provenance rung. `record` explains a missing cwd; it
 * never overrides one we can read.
 */
export function decideReap({ pid, cwd, ownRoot, recorded = false, alive = false }) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return { reap: false, reason: `not a signalable pid: ${JSON.stringify(pid)}` };
  }
  const readable = typeof cwd === 'string' && cwd !== '';
  if (readable && !isInside(cwd, ownRoot)) {
    return { reap: false, reason: `pid ${pid}: cwd ${cwd} is outside the run worktree ${ownRoot}` };
  }
  if (readable) return { reap: true, provenance: 'cwd' };
  // Unreadable means two different things and they must not be conflated.
  // A LIVE process whose cwd we cannot read is one we lack the standing to
  // read — another user's, or a kernel thread with no userspace cwd — and that
  // IS unknown provenance. A pid that is simply GONE explains its own missing
  // cwd, and for one this run recorded, provenance is by record.
  if (alive) {
    return {
      reap: false,
      reason: `pid ${pid}: alive but its cwd is unreadable — unknown provenance is not our provenance, so it is not signalled`,
    };
  }
  if (recorded) return { reap: true, provenance: 'record' };
  return {
    reap: false,
    reason: `pid ${pid}: cwd unreadable — unknown provenance is not our provenance, so it is not signalled`,
  };
}

/**
 * Terminate every agent this run dispatched, and report what happened to each
 * — the report is written into the run's verdict record, so a kill is evidence
 * rather than a side effect nobody can see afterwards.
 *
 * ONE pass over the whole teardown, not one pass per dispatched run. Two
 * reasons, both measured: a dispatch can write TWO recorded session dirs in
 * the same process tree (the S3 incident did), so per-run passes report the
 * same pid as both reaped and skipped; and a per-run grace period makes
 * teardown cost `runs.length × graceMs` inside a `finally`.
 *
 * The order is the rule, and no other order is correct:
 *  1. snapshot `/proc` ONCE — before a signal breaks the ppid links;
 *  2. decide each RECORDED pid. A refusal refuses that whole subtree;
 *  3. claim descendants (parentage) and group members (a group our dispatch
 *     minted), deduplicated across runs;
 *  4. `kill(-pid)` per admitted group, then every claimed pid LEAVES FIRST and
 *     the recorded roots last;
 *  5. ONE bounded wait over every claimed pid, then SIGKILL the survivors.
 */
export async function reapAgentRuns(runs, opts = {}) {
  const ownRoot = opts.ownRoot;
  const cwdOf = opts.cwdOf ?? readProcCwd;
  const procTable = opts.procTable ?? (() => readProcTable());
  const kill = opts.kill ?? ((pid, sig) => process.kill(pid, sig));
  const isAlive =
    opts.isAlive ??
    ((pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    });
  const graceMs = opts.graceMs ?? DEFAULT_GRACE_MS;
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  const skipped = [];
  /** pid → { dir, via }. Deduplicates a pid reachable from two recorded runs. */
  const claimed = new Map();
  const failures = new Map();
  const groupLeaders = [];
  const descendantOrder = [];
  const strayOrder = [];
  const rootOrder = [];

  /** SIGTERM/SIGKILL one pid; a throw is an outcome (already gone), not a fault.
   *
   *  `run.mjs` reaps TWICE — once before the bridge comes down and once at the
   *  verdict — so the second pass meets pids the first pass killed. Since 5.45
   *  those are ADMITTED (a recorded pid that is GONE explains its own missing
   *  cwd) and then fail to signal, so the failure says which of the two it is
   *  rather than reading as a reap that went wrong. */
  const signal = (pid, sig) => {
    try {
      kill(pid, sig);
      return null;
    } catch (err) {
      const gone = pid > 0 && !isAlive(pid);
      const suffix = gone ? ' — the process was already gone, so there was nothing to reap' : '';
      return `${sig} failed: ${err?.message ?? String(err)}${suffix}`;
    }
  };

  // (1) one snapshot for the whole teardown.
  const table = procTable();

  for (const { dir, pid } of runs) {
    // (2) the recorded pid gates its whole subtree.
    if (claimed.has(pid)) continue; // already reaped as part of an earlier run's tree
    const decision = decideReap({ pid, cwd: cwdOf(pid), ownRoot, recorded: true, alive: isAlive(pid) });
    if (!decision.reap) {
      skipped.push({ pid, dir, reason: decision.reason });
      continue;
    }

    // (3) parentage, then the group.
    const descendants = descendantsOf(pid, table).filter((p) => !claimed.has(p));
    const groupMembers = groupMembersOf(pid, table);

    // A group is ours on evidence, never on the assumption that a dead pid was
    // once a leader. Either the recorded pid is present in the snapshot AND
    // leads its own group — in which case that pid still denotes OUR process,
    // because decideReap just placed it — or the leader is gone and at least
    // one surviving member corroborates by sitting inside the run worktree.
    // Without that corroboration a reused pid could hand us a stranger's group
    // (see groupMembersOf's note on the reuse window), so we decline it.
    const leaderPresent = table.get(pid)?.pgrp === pid;
    const corroborated = leaderPresent ? groupMembers : groupMembers.filter((m) => isInside(cwdOf(m) ?? '', ownRoot));
    const ownsGroup = leaderPresent || corroborated.length > 0;
    if (ownsGroup) groupLeaders.push(pid);

    for (const target of descendants) {
      claimed.set(target, { dir, via: 'descendant' });
      descendantOrder.push(target);
    }
    if (ownsGroup) {
      for (const member of groupMembers) {
        if (claimed.has(member)) continue;
        claimed.set(member, { dir, via: 'group' });
        strayOrder.push(member);
      }
    }
    claimed.set(pid, { dir, via: decision.provenance });
    rootOrder.push(pid);
  }

  // (4) the group first — it is the half that reaches a member re-parented out
  //     of our ancestry — then leaves, then the recorded roots. A group signal
  //     that FAILS is recorded against its leader: it is the only signal that
  //     can reach a process which joined the group after the snapshot, so a
  //     silent failure there is exactly the blind spot 5.45 was about.
  for (const leader of groupLeaders) {
    const failure = signal(-leader, 'SIGTERM');
    if (failure !== null) failures.set(leader, `process group ${leader}: ${failure}`);
  }
  const order = [...descendantOrder].reverse().concat([...strayOrder].reverse(), rootOrder);
  for (const target of order) {
    const failure = signal(target, 'SIGTERM');
    if (failure !== null) failures.set(target, failure);
  }

  // (5) one bounded wait covering every claimed pid. The wait counts poll
  //     steps rather than wall clock so an injected `sleep` cannot spin.
  const steps = Math.max(1, Math.ceil(graceMs / pollMs));
  let alive = order.slice();
  for (let i = 0; i < steps && alive.length > 0; i += 1) {
    await sleep(pollMs);
    alive = alive.filter((target) => isAlive(target));
  }
  if (alive.length > 0) {
    for (const leader of groupLeaders) {
      const failure = signal(-leader, 'SIGKILL');
      if (failure !== null) failures.set(leader, `process group ${leader}: ${failure}`);
    }
  }
  const killed = new Set(alive);
  for (const target of alive) {
    const failure = signal(target, 'SIGKILL');
    if (failure !== null) {
      failures.set(target, failure);
      killed.delete(target);
    } else {
      failures.delete(target);
    }
  }

  const reaped = [];
  for (const target of order) {
    const { dir, via } = claimed.get(target);
    const failure = failures.get(target);
    if (failure !== undefined) {
      skipped.push({ pid: target, dir, reason: `pid ${target}: ${failure}` });
      continue;
    }
    reaped.push({ pid: target, dir, signal: killed.has(target) ? 'SIGKILL' : 'SIGTERM', via });
  }

  return { reaped, skipped };
}

/** One line per outcome, for the run's stdout.
 *
 *  The provenance rung is named because run 3's forensics turned entirely on
 *  the reaper's own reason string: a line that says WHICH rule admitted a pid
 *  is the difference between a diagnosable teardown and a guess. */
export function describeReap(report) {
  return [
    ...report.reaped.map(
      (r) => `[stories] reaped dispatched agent pid ${r.pid} (${r.signal}, by ${r.via ?? 'record'}) — ${r.dir}`,
    ),
    ...report.skipped.map((s) => `[stories] NOT reaped: ${s.reason}`),
  ];
}
