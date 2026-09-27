import { gateRequiredPaths, type RequiredPathsSource, type WorkItem } from '@forge/flows';
import { makeQualityGateFromCmd, resolveGateTimeoutMs, type GateRunInfo } from '@forge/agents';
import type { AcceptanceGateConfig } from '@forge/projects';

import { liveAcceptanceEnvFor } from './live-acceptance-env.ts';

/**
 * `buildWiQualityGate`'s arguments — exactly what `developer-loop.ts`'s
 * per-WI dispatch body already has in scope at the point it used to build
 * this gate inline.
 */
export type WiQualityGateArgs = {
  worktreePath: string;
  /** The WI's own `quality_gate_cmd`, or the cycle-level fallback — already
   *  resolved to non-null by the caller (`developer-loop.ts` returns
   *  `undefined` from its `qualityGate` property instead of calling this
   *  when neither is set). */
  effective: readonly string[];
  accGate: AcceptanceGateConfig | undefined;
  wi: WorkItem;
  requiredPathsSource: RequiredPathsSource;
  ciGateUnsetEnv: readonly string[] | undefined;
  localGateTimeoutMs: number | undefined;
  /** forge-mfv5.3.7 (operator ruling 2026-09-12) — the initiative this gate
   *  command runs for; namespaces whatever cloud resources it creates
   *  (FORGE_RESOURCE_PREFIX, `@forge/kernel`'s `deriveResourcePrefix`) so two
   *  initiatives running in parallel never collide over, or sweep, each
   *  other's live resources. */
  initiativeId: string;
  onRun: (info: GateRunInfo) => void;
};

/**
 * Build the per-WI quality-gate closure `runRalph`'s `LoopInput.qualityGate`
 * expects — extracted VERBATIM (2026-09-27) from `developer-loop.ts`'s per-WI
 * dispatch body so it is one exported, independently-testable function rather
 * than an inline closure nothing outside `runDeveloperLoop` could reach. The
 * only production caller is `developer-loop.ts`; the dev-loop-level
 * integration test (`developer-loop.gate-resource-prefix.test.ts`) calls this
 * SAME function, so a change here (e.g. dropping `initiativeId`) trips that
 * test directly instead of only a hand-written mirror of it.
 */
export function buildWiQualityGate(args: WiQualityGateArgs): () => boolean {
  // Live-acc env guard (`liveAcceptanceEnvFor`): a gate that targets
  // the acc suite runs under requiresEnv whatever the class says.
  const requiredEnv = liveAcceptanceEnvFor(args.accGate, args.effective);
  return makeQualityGateFromCmd(
    args.worktreePath,
    args.effective,
    args.onRun,
    {
      // Wave B (2026-06-04): the WI's declared paths MUST appear in
      // the branch diff before the gate can pass, catching "agent
      // exited without writing declared files" independently of
      // whether a sibling produced them (the `already-complete` 3-way
      // runner check handles that case upstream). WHICH paths is the
      // class's answer, not this file's — `gateRequiredPaths` and its
      // `RequiredPathsSource` union carry the 2026-07-11 incident that
      // set the rule.
      requiredPaths: gateRequiredPaths(args.wi, args.requiredPathsSource),
      ...(requiredEnv ? { requiredEnv } : {}),
      ...(args.ciGateUnsetEnv && args.ciGateUnsetEnv.length > 0 ? { unsetEnv: args.ciGateUnsetEnv } : {}),
      // forge-mfv5.3.7: namespaces whatever cloud resources this
      // WI's gate command creates (FORGE_RESOURCE_PREFIX,
      // @forge/kernel's deriveResourcePrefix) so two initiatives
      // running in parallel never collide over, or sweep, each
      // other's live resources.
      initiativeId: args.initiativeId,
      // R1-03-F1: env override > declared testProcess.local.timeoutMs > default.
      timeoutMs: resolveGateTimeoutMs(args.localGateTimeoutMs),
    },
  );
}
