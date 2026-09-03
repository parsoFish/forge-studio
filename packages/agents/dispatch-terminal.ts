/**
 * Bead `forge-8vfn.5.38` — a dispatched run always ends its own record.
 *
 * THE INCIDENT, measured from `_1.0/evidence/M4-projects-s3-S3/` rather than
 * from the bead's summary. The run's `events.jsonl` holds 15 lines spanning 50
 * seconds while the agent worked for about five minutes more, and it has NO
 * terminal event of any kind — no `end`, no `error`, no `agent-dispatch.*`.
 * The bead reads that as a truncated stream. It is not:
 *
 *  - the log carries `agent_heartbeat` at 09:33:21, :36 and :49 — a ~15 s
 *    cadence emitted by the DISPATCH process, not by the agent — and then two
 *    `tool_use` at :58 and nothing. A live parent would have emitted another
 *    heartbeat at ~09:34:04. It did not.
 *  - `ground-onboarding-status.json` is `{"phase":"running"}` with no
 *    `endedAt` — the exact "perpetual running" the terminal marker below says
 *    it exists to prevent.
 *
 * So the stream does not taper. THE WRITER DIES, and the agent it spawned
 * keeps working. `cmdAgentDispatch` covers two exits — a normal return and a
 * thrown error — and a SIGTERM runs neither, so the process that owns the
 * record is killed with the record left open. The story reaper SIGTERMs with a
 * grace period before SIGKILL, and a run's own teardown does the same, so this
 * is the ordinary way a dispatch ends when a run is cut short: the one exit
 * nobody wrote a terminus for.
 *
 * (The other candidate — that the log MOVES, because four `createLogger` roots
 * were cwd-relative — was real and is already closed, in #324. It cannot
 * explain this evidence: the events are all in ONE file, in order, and simply
 * stop.)
 *
 * WHAT THIS MODULE IS. The one place a dispatch records an ending its own
 * result cannot — a failure, and now a signal. (A success needs nothing here:
 * `runAgent` already ends that record with its `end` event.) Three reasons it
 * is a module rather than two call sites:
 *
 *  1. a terminus written two ways drifts two ways, and the signal path needs
 *     the identical event the failure path writes;
 *  2. `agent-run.ts` sits at its exact `check-file-size` ceiling (933), and an
 *     exemption is a ceiling, not a licence (COMMON §15.65) — this moves those
 *     lines out rather than asking for more;
 *  3. the marker's write was `catch { }` with nothing in it, deferred in #324
 *     for want of lines. It is the ONE write that stops a perpetual `running`,
 *     so a silent failure there is the defect reporting on itself.
 *
 * WHAT IT CANNOT DO, stated rather than implied: `SIGKILL` cannot be caught,
 * so a run killed with `-9` still ends without a terminus. That residual is a
 * READER-side problem and belongs with the bridge — a run whose recorded pid
 * is dead and whose log has no terminal event is finished, whatever the log
 * says — not something this seam can write its way out of.
 */
import { join } from 'node:path';

import { createLogger, type EventLogEntry } from '@forge/kernel';

/** Signals a dispatch can catch. `SIGKILL` is deliberately absent — it cannot be. */
export const DISPATCH_TERMINAL_SIGNALS = ['SIGTERM', 'SIGINT', 'SIGHUP'] as const;

export type DispatchTerminalSignal = (typeof DISPATCH_TERMINAL_SIGNALS)[number];

/**
 * How a dispatch ended, for the two exits that need a terminus written here.
 *
 * There is deliberately no `complete`: a successful run already ends its own
 * record with `runAgent`'s `end` event (cost, tokens, duration), and emitting a
 * second success terminus would give one run two endings. `failed` and
 * `interrupted` are the exits that had none — the first wrote its marker inline
 * and swallowed its own write failure, the second wrote nothing at all.
 */
export type DispatchOutcome = 'failed' | 'interrupted';

const MESSAGE_FOR: Record<DispatchOutcome, string> = {
  failed: 'agent-dispatch.failed',
  interrupted: 'agent-dispatch.interrupted',
};

export type RecordTerminalArgs = {
  runId: string;
  slug: string;
  forgeRoot: string;
  outcome: DispatchOutcome;
  /** Present on `failed` (the thrown message) and `interrupted` (the signal). */
  detail?: string;
};

/**
 * Append this run's terminal event to its own log.
 *
 * Best-effort by necessity — it runs on the way out, and refusing to exit
 * because the log is unwritable helps nobody — but never SILENT: a failure
 * here means the bridge will report a perpetual `running` for a run that has
 * ended, which is the very symptom bead 5.38 is about, so it says so.
 *
 * Returns the entry it wrote, or `null` if it could not write one, so a caller
 * that wants to assert on the terminus (the tests, and the signal handler's
 * idempotence check) does not have to re-read the file.
 */
export function recordDispatchTerminal(args: RecordTerminalArgs): EventLogEntry | null {
  const { runId, slug, forgeRoot, outcome, detail } = args;
  try {
    return createLogger(runId, join(forgeRoot, '_logs')).emit({
      initiative_id: runId,
      phase: 'orchestrator',
      skill: slug,
      event_type: 'log',
      input_refs: [],
      output_refs: [],
      message: MESSAGE_FOR[outcome],
      metadata: {
        agent_slug: slug,
        outcome,
        ...(detail !== undefined ? { detail } : {}),
      },
    });
  } catch (err) {
    console.error(
      `forge agent dispatch: could not write the terminal event for run "${runId}" (${outcome}) — the bridge will report this run as a perpetual "running": ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

export type SignalGuardArgs = {
  runId: string;
  slug: string;
  forgeRoot: string;
  /** Writes the session's terminal phase, when the dispatch is session-bound. */
  writePhase?: (outcome: 'failed', detail: string) => void;
  /** Seams for the test; production uses the real process. */
  on?: (signal: DispatchTerminalSignal, handler: () => void) => void;
  off?: (signal: DispatchTerminalSignal, handler: () => void) => void;
  exit?: (code: number) => void;
};

/**
 * Install the terminus a killed dispatch never had, and return the function
 * that removes it.
 *
 * The handler is deliberately small and synchronous. A reaper allows a grace
 * period measured in seconds before `SIGKILL` (5 s in `scripts/stories/
 * reap.mjs`), and an async terminus racing that grace is a terminus that
 * sometimes is not written — so this appends one event, writes one phase, and
 * exits.
 *
 * Idempotent: signals arrive in pairs (a group signal and a direct one both
 * reach a process that leads its own group), and two termini would make a run
 * look like it ended twice. The first signal wins; later ones exit without
 * writing.
 *
 * ALWAYS UNINSTALLED by the caller's `finally`. A long-lived process that ran
 * several dispatches would otherwise accumulate handlers, and Node would warn
 * about a listener leak on the eleventh — a warning that would be telling the
 * truth.
 *
 * The exit code is the POSIX convention `128 + signo`, which is what a shell
 * reports for a signalled process anyway; using it means the dispatch's own
 * exit status still says how it died.
 */
export function installDispatchSignalGuard(args: SignalGuardArgs): () => void {
  const on = args.on ?? ((sig, handler) => void process.on(sig, handler));
  const off = args.off ?? ((sig, handler) => void process.off(sig, handler));
  const exit = args.exit ?? ((code) => process.exit(code));

  const signo: Record<DispatchTerminalSignal, number> = { SIGTERM: 15, SIGINT: 2, SIGHUP: 1 };
  let fired = false;
  const handlers = new Map<DispatchTerminalSignal, () => void>();

  for (const signal of DISPATCH_TERMINAL_SIGNALS) {
    const handler = (): void => {
      if (fired) {
        exit(128 + signo[signal]);
        return;
      }
      fired = true;
      recordDispatchTerminal({
        runId: args.runId,
        slug: args.slug,
        forgeRoot: args.forgeRoot,
        outcome: 'interrupted',
        detail: signal,
      });
      // A run cut short is not a run that succeeded. `failed` is the terminal
      // phase the bridge already understands; the detail says it was a signal
      // rather than a thrown error, so the two are still distinguishable.
      args.writePhase?.('failed', `dispatch interrupted by ${signal}`);
      exit(128 + signo[signal]);
    };
    handlers.set(signal, handler);
    on(signal, handler);
  }

  return () => {
    for (const [signal, handler] of handlers) off(signal, handler);
  };
}
