/**
 * agent-parity-serve-stop.mjs — the batch-end half of run-end parity for a
 * cycle still in flight when its story ended. Row 207 (bead
 * `forge-8vfn.8.5.57`, T1 ruling 1973qf item C2).
 *
 * A cycle runs inside the scheduler daemon (`forge serve`) this run started,
 * not in a dispatch `reapAgentRuns` owns, and that daemon outlives the story:
 * the batch teardown stops it (`stopStudioThenScheduler`,
 * sweep-teardown.mjs) only after EVERY story has run. So a story's own
 * run-end parity (`agentParitySoFar`, run-observe.mjs) cannot yet know
 * whether the final attempt it sees open will close itself or be killed —
 * it DEFERS those open starts (`agent-parity.mjs`'s `serveAlivePid`), and
 * `run.mjs` judges them here, AFTER that stop, with the stop's own result as
 * evidence — the way `reap.reaped` is evidence for an agent turn.
 *
 * WHAT COUNTS AS THE HARNESS'S OWN KILL (`serveStopEvidence`): the stop
 * names the daemon pid it stopped (`sched.stopped`), that daemon did NOT
 * drain (a drained daemon awaited its cycles, so each wrote its own
 * `cycle.end`), and the deferred clear that ran once it was confirmed dead
 * claimed the initiative's manifest out of `_queue/in-flight/`. No stopped
 * pid, a refused teardown, or no claim is no evidence: the deferred starts
 * are then plain `missing-end` violations. The harness never excuses a
 * cycle it did not kill.
 *
 * WHERE THE ROWS ARE. The deferred clear captures the cycle's `_logs/<dir>`
 * to `stop.deferred.artefacts.dest` and removes it, so the channel is read
 * from that capture first, else from its live path; a deferred channel found
 * in neither is `unmeasured`, never a pass.
 */
import { existsSync } from 'node:fs';
import { loadRegisteredSessionKindIds } from './session-kind-registry.mjs';
import { basename, join } from 'node:path';
import { channelParityVerdict } from './agent-parity.mjs';
import { readRunEvents } from './run-observe.mjs';

/**
 * @param {object|null} stop `stopStudioThenScheduler`'s own result
 * @returns {Readonly<{pid: number, how: string|null, drained: boolean, inFlightInitiativeIds: Set<string>}>|null}
 */
export function serveStopEvidence(stop) {
  const sched = stop?.sched;
  const claimed = stop?.deferred?.claim?.claimed;
  if (!sched || !Number.isInteger(sched.stopped) || !Array.isArray(claimed)) return null;
  const inFlightInitiativeIds = new Set(
    claimed.filter((c) => c?.state === 'in-flight').map((c) => basename(String(c.path)).replace(/\.md$/, '')),
  );
  return Object.freeze({ pid: sched.stopped, how: sched.how ?? null, drained: sched.drained === true, inFlightInitiativeIds });
}

const violationKey = (v) => `${v.kind}|${v.key ?? ''}|${(v.eventIds ?? []).join(',')}`;

/** The capture of `channel` the serve stop's deferred clear made, or null. */
function capturedPath(stop, channel) {
  const artefacts = stop?.deferred?.artefacts;
  const rel = `_logs/${basename(channel)}`;
  if (typeof artefacts?.dest !== 'string' || !Array.isArray(artefacts.captured) || !artefacts.captured.includes(rel)) return null;
  return join(artefacts.dest, rel);
}

/**
 * @param {{deferred: Array<{channel: string, reported: ReadonlyArray<object>}>, stop: object|null,
 *   registeredSessionKindIds?: Set<string>, readRows?: (dir: string) => object[],
 *   liveExists?: (dir: string) => boolean}} input
 *   `reported` is the channel's own story-end violations, never counted twice
 * @returns {{violations: object[], lines: string[]}}
 */
export function judgeDeferredCycleChannels({
  deferred, stop, registeredSessionKindIds = new Set(),
  readRows = readRunEvents, liveExists = (dir) => existsSync(join(dir, 'events.jsonl')),
}) {
  const serveStop = serveStopEvidence(stop);
  const violations = [];
  const lines = [];
  for (const { channel, reported } of deferred ?? []) {
    const dir = capturedPath(stop, channel) ?? (liveExists(channel) ? channel : null);
    if (dir === null) {
      const v = { kind: 'unmeasured', channel, error: 'deferred to the serve stop, but neither its capture nor its live _logs dir exists' };
      violations.push(v);
      lines.push(`[stories] agent-parity: UNMEASURED — channel ${channel} — ${v.error}`);
      continue;
    }
    const verdict = channelParityVerdict(channel, readRows(dir), { registeredSessionKindIds, serveStop });
    const already = new Set((reported ?? []).map(violationKey));
    const fresh = verdict.violations.filter((v) => !already.has(violationKey(v)));
    violations.push(...fresh);
    for (const s of verdict.satisfied) lines.push(`[stories] agent-parity: ${s.channel} — ${s.reason}`);
    for (const v of fresh) {
      lines.push(
        `[stories] agent-parity: PRODUCT RED — ${v.kind} on channel ${v.channel} (${v.key}), event id(s) ${(v.eventIds ?? []).join(', ')} ` +
        '— judged after the serve stop',
      );
    }
    if (fresh.length === 0) lines.push(`[stories] agent-parity: ${channel} (${verdict.kind}) — ok after the serve stop (read from ${dir})`);
  }
  return { violations, lines };
}

/**
 * The batch-end call `run.mjs` makes right after its serve stop: judge every
 * deferred channel on that stop's own result and print the verdict. Returns
 * `true` when the run is RED. A throw is RED too, never a pass, and never
 * escapes — the caller still releases the host lock.
 */
export function reportDeferredCycleParity({ deferred, stop, root }) {
  try {
    const out = judgeDeferredCycleChannels({ deferred, stop, registeredSessionKindIds: loadRegisteredSessionKindIds(root) });
    for (const line of out.lines) console.log(line);
    if (out.violations.length === 0) return false;
    console.error(`[stories] RED — ${out.violations.length} cycle parity violation(s) judged after the serve stop. The run is RED regardless of its beats.`);
  } catch (err) {
    console.error(`[stories] RED — deferred cycle parity could not be judged after the serve stop: ${err?.message ?? err}`);
  }
  return true;
}
