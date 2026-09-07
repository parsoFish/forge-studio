/**
 * `example-hooks.ts` — what the bridge binds when the example factory IS
 * installed, and what it does instead when it is NOT.
 *
 * ADR 048 says the platform must boot and serve with `packages/factory`
 * deleted, and T1 ruling 488 states the clause the proof now asserts: *"With no
 * example installed, example-owned hooks are not bound; the bridge survives any
 * request that would have used one and `/api/health` still answers."* This
 * module is the one place that decides both halves of that sentence, so the
 * assembly does not have to spell the absent case out at each call site.
 *
 * WHY IT EXISTS AS A MODULE (T1 ruling 492). The two behaviours below were
 * written inline in `ui-bridge.ts` and took it 34 lines past its 2,276-line
 * file-size exemption. An exemption is a ceiling, not a licence, and this
 * milestone's standing answer is SPLIT, NEVER BASELINE — so the logic moved to
 * the grain of the change rather than the number moving to fit it.
 *
 * WHAT WAS MEASURED, because both behaviours look like paranoia until you see
 * it. In a real factoryless scratch worktree one POST to
 * `/api/reflect/<cycleId>/answer` ENDED THE BRIDGE PROCESS:
 *
 *   Error [ERR_HTTP_HEADERS_SENT]: Cannot write headers after they are sent
 *     at sendJson (packages/kernel/http-envelope.ts:52)
 *     at handleReflect (apps/forge/ui-bridge.ts)
 *
 * The route answers 200 before firing the rerun, deliberately — capture is
 * bookkeeping the platform owes whatever the reflector does. `example()` throws
 * SYNCHRONOUSLY rather than rejecting, so it never reached the `.catch()` that
 * exists for exactly this; it unwound into the handler's outer catch, which
 * tried to send a 500 on an answered response. The full account and the red
 * reproduction live in `tests/regression/reflect-rerun-sync-throw.test.ts`.
 *
 * The two fixes are deliberately separate. Gating on absence closes the case
 * that was measured; wrapping the call closes the MECHANISM, so the next
 * binding that throws synchronously is a logged failure rather than a dead
 * process. Neither is a substitute for the other.
 */
import { createLogger, type EventLogEntry } from '@forge/kernel';
import type { ReleaseFinalizeHookInput } from '@forge/flows/bridge-studio-runs.ts';

import { installedExample as example, peekInstalledFactory, type InstalledFactory } from './factory-wiring.ts';

type ReleaseFinalizeFn = (input: ReleaseFinalizeHookInput) => Promise<{ release_status: string }>;

/**
 * The release-finalize hook, or NOTHING.
 *
 * `bridge-studio-runs-review.ts` guards it with `if (ctx.runReleaseFinalize)`,
 * so an unbound hook is a deliberate skip on a declared seam. Binding a closure
 * that throws instead put the throw into that call site's `catch { }` — whose
 * own comment says a hook-level throw must never block the merge, and it does
 * not — which made "no example installed" indistinguishable from "this project
 * declares no releaseProcess".
 *
 * `resolveInstalledFactory()` is awaited at the top of `startBridge`, so the
 * peek here is decided, not racing.
 */
export function bindReleaseFinalize(
  override: ReleaseFinalizeFn | undefined,
  logsRoot: string,
): ReleaseFinalizeFn | undefined {
  if (override) return override;
  if (peekInstalledFactory() === null) return undefined;
  return async (input) => example().runReleaseFinalize(input, createLogger(input.cycleId, logsRoot));
}

export type FireReflectorRerunInput = {
  readonly rerunReflector: InstalledFactory['rerunReflector'];
  readonly cycleId: string;
  readonly logsRoot: string;
  readonly queueRoot: string;
  /** The `user-feedback.md` this rerun is distilling — cited in the event. */
  readonly feedbackPath: string;
};

/**
 * Fire the reflector rerun detached, and make sure it can only ever end in an
 * EVENT — fired, skipped or failed — never in an unhandled throw.
 *
 * The RERUN is what gets gated, never the route: capture is the platform's and
 * the caller's 200 has already promised it, so refusing here would refuse
 * bookkeeping that has nothing to do with the example. Same shape as the
 * startup reconcile in `ui-bridge.ts`, which has always peeked before spawning.
 */
export function fireReflectorRerun(input: FireReflectorRerunInput): void {
  const { rerunReflector, cycleId, logsRoot, queueRoot, feedbackPath } = input;
  const logger = createLogger(cycleId, logsRoot);
  const emit = (message: string, metadata: EventLogEntry['metadata'], cites: boolean): void => {
    void logger.emit({
      initiative_id: cycleId,
      phase: 'reflection',
      skill: 'bridge',
      event_type: 'log',
      input_refs: cites ? [feedbackPath] : [],
      output_refs: [],
      message,
      metadata,
    });
  };

  if (peekInstalledFactory() === null) {
    emit('bridge.reflect-rerun-skipped-no-example', { trigger: 'feedback-submit' }, true);
    return;
  }

  // `Promise.resolve().then(...)` rather than a bare call: a SYNCHRONOUS throw
  // from the binding would otherwise unwind into the caller, past its already
  // sent response. This turns it into a rejection the `.catch` below reports.
  void Promise.resolve()
    .then(() => rerunReflector({ cycleId, logsRoot, queueRoot }))
    .then(() => emit('bridge.reflect-rerun-fired', { trigger: 'feedback-submit' }, true))
    .catch((err: unknown) => emit('bridge.reflect-rerun-failed', { error: String(err) }, false));
}
