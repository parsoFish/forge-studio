import { acLabel, gateRequiredPaths, type AcceptanceCheck, type RequiredPathsSource, type WorkItem } from '@forge/flows';
import { makeQualityGateFromCmd, parseGateTestSummary, resolveGateTimeoutMs, type GateRunInfo } from '@forge/agents';
import { WI_GATE_PACKAGE_PLACEHOLDER, type AcceptanceGateConfig } from '@forge/projects';

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
  /** forge-mfv5.1.43: each acceptance criterion's check, judged (`info.passed` = satisfied). */
  onAcCheck?: (run: AcCheckRun) => void;
  /** forge-mfv5.1.43: after a gate pass, the labels whose checks were satisfied this run (all of them ⇔ the composite passed). */
  onChecksJudged?: (satisfied: readonly string[]) => void;
};

/** One acceptance check's run: `info` is the gate run with `passed` restated as "satisfied", and `command` labelled. */
export type AcCheckRun = { label: string; expect: AcceptanceCheck['expect']; satisfied: boolean; info: GateRunInfo };

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
export function buildWiQualityGate(args: WiQualityGateArgs): (ctx?: { iteration: number }) => boolean {
  const wiGate = buildWiGateOnly(args);
  const checks = args.wi.acceptance_criteria.flatMap((ac, i) => (ac.check ? [{ label: acLabel(ac, i), check: ac.check }] : []));
  // forge-mfv5.1.43 (D-20): the WI closes only when its gate AND every criterion's check pass —
  // first unsatisfied check stops the run (its output is the agent's next brief).
  return (ctx) => {
    if (!wiGate(ctx)) return false;
    const satisfied: string[] = [];
    for (const { label, check } of checks) {
      const run = runAcCheck(args, label, check, ctx);
      args.onAcCheck?.(run);
      if (!run.satisfied) break;
      satisfied.push(label);
    }
    args.onChecksJudged?.(satisfied);
    return satisfied.length === checks.length;
  };
}

function runAcCheck(args: WiQualityGateArgs, label: string, check: AcceptanceCheck, ctx?: { iteration: number }): AcCheckRun {
  const unsetEnv = [...(args.ciGateUnsetEnv ?? []), ...(check.unsetEnv ?? [])];
  const requiredEnv = [...(liveAcceptanceEnvFor(args.accGate, check.argv) ?? []), ...(check.requiresEnv ?? [])].filter((n) => !unsetEnv.includes(n));
  let info: GateRunInfo | undefined;
  makeQualityGateFromCmd(args.worktreePath, check.argv, (i) => { info = i; }, {
    ...(requiredEnv.length > 0 ? { requiredEnv } : {}),
    ...(unsetEnv.length > 0 ? { unsetEnv } : {}),
    initiativeId: args.initiativeId,
    timeoutMs: resolveGateTimeoutMs(args.localGateTimeoutMs),
  })(ctx);
  const ran = info ?? { passed: false, exitCode: -1, durationMs: 0, stdoutTail: '', stderrTail: '[forge] the check reported no run', command: check.argv.join(' '), errored: true };
  const why = check.expect === 'pass' ? null : expectFailVerdict(ran);
  const satisfied = check.expect === 'pass' ? ran.passed : why === null;
  const stderrTail = why === null ? ran.stderrTail : `${ran.stderrTail}\n[forge ac-check] ${label} expected the check to FAIL: ${why}`;
  return { label, expect: check.expect, satisfied, info: { ...ran, passed: satisfied, stderrTail, command: `[${label} expect ${check.expect}] ${ran.command}` } };
}

/** Why an `expect: fail` run is NOT the falsifying failure it must be, or null: a real non-zero exit, and ≥1 test ran when a runner summary says so. */
function expectFailVerdict(r: GateRunInfo): string | null {
  if (r.errored || r.timedOut || r.rejectReason === 'live-env-missing') return `the command could not run as a check (${r.rejectReason ?? 'errored'})`;
  if (r.passed || r.exitCode <= 0) return `it exited ${r.exitCode <= 0 && !r.passed ? r.exitCode : 0} (${r.rejectReason ?? 'passed'})`;
  const s = parseGateTestSummary(`${r.stdoutTail}\n${r.stderrTail}`);
  return s && s.passed + s.failed === 0 ? `the runner ran 0 tests (${s.skipped} skipped, ${s.runner}) — a skip is not a failure` : null;
}

/** The WI's own gate (unchanged since its 2026-09-27 extraction from `developer-loop.ts`). */
function buildWiGateOnly(args: WiQualityGateArgs): (ctx?: { iteration: number }) => boolean {
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

/** Why a declared `testProcess.local.perWorkItem` template was not used. */
export type WiGateTemplateSkipped = { reason: 'no-common-package-dir'; paths: readonly string[] };

/** The effective per-WI gate and where it came from. `cmd: null` ⇒ no gate. */
export type WiGateCmd = {
  cmd: readonly string[] | null;
  source: 'work-item' | 'template' | 'project';
  templateSkipped?: WiGateTemplateSkipped;
};

/**
 * forge-mfv5.3.6 — the directory a WI changes: the common directory of its
 * repo-relative paths. A `dir/` entry is itself; a `*` glob (the one wildcard
 * `globToRegExp` in `@forge/projects` knows) contributes its static prefix,
 * the segments before the first one holding a `*`; a file its directory.
 * `null` when there is none below the repo root — no paths, a root-level file,
 * a glob with no static directory, or a path leaving the repo — and when any
 * segment starts with `-`: the value is spliced into the gate's argv, and a
 * PM/agent-authored path such as `-x/evil.py` or `--run=^$/…` would otherwise
 * reach the very gate that judges the WI as a flag.
 */
export function wiPackageDir(paths: readonly string[]): string | null {
  const dirs = paths.map((p) => {
    const segs = p.split('/').filter((seg) => seg !== '' && seg !== '.');
    const star = segs.findIndex((seg) => seg.includes('*'));
    if (star >= 0) return segs.slice(0, star);
    return p.endsWith('/') ? segs : segs.slice(0, -1);
  });
  if (dirs.length === 0 || paths.some((p) => p.startsWith('/')) || dirs.some((d) => d.includes('..'))) return null;
  if (dirs.some((d) => d.some((seg) => seg.startsWith('-')))) return null;
  const common = dirs.reduce((acc, d) => {
    const diverge = acc.findIndex((seg, i) => seg !== d[i]);
    return diverge === -1 ? acc : acc.slice(0, diverge);
  });
  return common.length > 0 ? common.join('/') : null;
}

/**
 * forge-mfv5.3.6 (operator ruling 2026-09-12) — the ONE place a WI's effective
 * gate is decided: the WI's own `quality_gate_cmd` > the project's
 * `testProcess.local.perWorkItem` template filled with `wiPackageDir(files_in_scope
 * ∪ creates)` > the project-wide gate. Following the D-17 injector, the
 * template only fills an OMITTED field and never overrides the plan agent's
 * own gate; with no common directory it is never widened to the repo root —
 * the project-wide gate runs and `templateSkipped` names why, for the caller
 * to log. An empty argv counts as absent.
 */
export function deriveWiGateCmd(args: {
  wi: Pick<WorkItem, 'files_in_scope'> & Partial<Pick<WorkItem, 'quality_gate_cmd' | 'creates'>>;
  template: readonly string[] | undefined;
  fallback: readonly string[] | undefined;
}): WiGateCmd {
  const own = args.wi.quality_gate_cmd;
  if (own && own.length > 0) return { cmd: own, source: 'work-item' };
  const project: WiGateCmd = { cmd: args.fallback && args.fallback.length > 0 ? args.fallback : null, source: 'project' };
  if (!args.template) return project;
  const paths = [...args.wi.files_in_scope, ...(args.wi.creates ?? [])];
  const pkg = wiPackageDir(paths);
  if (pkg === null) return { ...project, templateSkipped: { reason: 'no-common-package-dir', paths } };
  return { cmd: args.template.map((tok) => tok.split(WI_GATE_PACKAGE_PLACEHOLDER).join(pkg)), source: 'template' };
}
