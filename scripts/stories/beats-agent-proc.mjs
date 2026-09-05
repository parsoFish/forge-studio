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
import { readFileSync } from 'node:fs';
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
