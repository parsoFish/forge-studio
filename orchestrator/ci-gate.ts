/**
 * The CI delivery gate's decision core: run one operator-configured command
 * vector, and decide the final gate from it.
 *
 * It sits BELOW both `cycle.ts` and `cycle-helpers.ts` so neither has to import
 * the other. Before M2-B the pair was a cycle — `cycle-helpers.ts` reached back
 * into `cycle.ts` for exactly these two functions — and moving the shared code
 * down is the fix; re-ordering imports is not (`docs/roadmaps/1.0.md` §4 M2
 * Lane B). This module imports neither of them.
 */

import { execFileSync } from 'node:child_process';

/** Result of running one operator-configured command vector. */
export type CiCommandResult = { ok: boolean; output: string };

/**
 * Injectable command runner so `decideFinalCiGate` is unit-testable without
 * spawning real processes. The production runner (`execCommandVector`) wraps
 * `execFileSync`; tests pass a stub. `kind` distinguishes the fixer (best-effort)
 * from the gate (verdict) so the runner can pick an appropriate timeout.
 */
export type CiCommandRunner = (
  cmd: string[],
  worktreePath: string,
  kind: 'fix' | 'gate',
  /**
   * Env-var names to strip from the child env so the CI gate mirrors GitHub
   * CI regardless of the cycle env (e.g. `TF_ACC`). Empty/undefined ⇒ inherit
   * `process.env` unchanged.
   */
  unsetEnv?: string[],
) => CiCommandResult;

const CI_FIX_TIMEOUT_MS = 5 * 60_000;
const CI_GATE_TIMEOUT_MS = 20 * 60_000;

/**
 * Resolve the CI command timeout (ms). The defaults (5 min fix / 20 min gate)
 * can be raised per-run via env for heavy gates — e.g. a cold whole-module Go
 * compile after a large dependency addition (terraform-plugin-framework + mux)
 * can exceed 20 min on a cold build cache, which would SIGTERM a passing gate
 * mid-run. Overriding lets one heavy migration run carry more headroom without
 * changing the default for every cycle:
 *   FORGE_CI_GATE_TIMEOUT_MS — overrides the 'gate' timeout
 *   FORGE_CI_FIX_TIMEOUT_MS  — overrides the 'fix' timeout
 * A non-numeric / non-positive value is ignored (falls back to the default).
 * Exported for unit testing.
 */
export function resolveCiTimeoutMs(kind: 'fix' | 'gate', declaredMs?: number): number {
  const def = kind === 'fix' ? CI_FIX_TIMEOUT_MS : CI_GATE_TIMEOUT_MS;
  const raw = process.env[kind === 'fix' ? 'FORGE_CI_FIX_TIMEOUT_MS' : 'FORGE_CI_GATE_TIMEOUT_MS'];
  if (raw !== undefined && raw.trim() !== '') {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  // R1-03-F1: the project's testProcess.ci.timeoutMs contract field sits
  // between the env override and the default.
  if (kind === 'gate' && declaredMs !== undefined && Number.isFinite(declaredMs) && declaredMs > 0) {
    return declaredMs;
  }
  return def;
}

/**
 * Production command runner. Runs the vector DIRECTLY via `execFileSync`
 * (`["bash","-c","…&&…"]` is run as `bash -c …`) — deliberately NOT routed
 * through the per-WI gate runner (runShellGate / gateIsShellPipeline), whose
 * pipe-ban would reject the operator's `&&` CI chain. The operator authored
 * `ci_gate`, so it is trusted. Exported for a focused real-spawn test of the
 * A3 env-stripping (the rest of the gate logic is tested via `decideFinalCiGate`
 * with a stubbed runner).
 */
export function execCommandVector(
  cmd: string[],
  worktreePath: string,
  kind: 'fix' | 'gate',
  unsetEnv?: string[],
  declaredTimeoutMs?: number,
): CiCommandResult {
  const [head, ...rest] = cmd;
  const timeout = resolveCiTimeoutMs(kind, declaredTimeoutMs);
  // A3 (2026-06-06): strip the project's declared live-test triggers (e.g.
  // `TF_ACC`) so the CI delivery gate mirrors GitHub CI even when the serve
  // env set them for the per-WI live-acceptance gates. No list ⇒ inherit env.
  let env: NodeJS.ProcessEnv | undefined;
  if (unsetEnv && unsetEnv.length > 0) {
    env = { ...process.env };
    for (const name of unsetEnv) delete env[name];
  }
  try {
    const out = execFileSync(head, rest, {
      cwd: worktreePath,
      stdio: 'pipe',
      encoding: 'utf8',
      timeout,
      ...(env ? { env } : {}),
    });
    return { ok: true, output: out.toString() };
  } catch (err) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
    const stdout = e.stdout ? e.stdout.toString() : '';
    const stderr = e.stderr ? e.stderr.toString() : '';
    return { ok: false, output: (stdout + stderr) || (e.message ?? '') };
  }
}

/**
 * Pure decision core for the final CI gate. Exported for direct unit testing
 * with a stubbed `run` (no real `make test`). Given the project's `ciGate` +
 * optional `ciFixCmd`:
 *   1. Best-effort apply the formatters (`ciFixCmd`) — never throws on a fixer
 *      error (a broken formatter must not block delivery).
 *   2. Run the full `ciGate`; return its ok + (tail of) output.
 * No-op (returns `null`) when `ciGate` is absent/empty — the caller then skips
 * committing/pushing fmt changes and the gate entirely. This function performs
 * NO git/IO of its own; the orchestrator commits+pushes any fmt changes around
 * it (it cannot know whether the fixer changed files).
 */
export function decideFinalCiGate(
  args: {
    ciGate: string[] | null;
    ciFixCmd: string[] | null;
    worktreePath: string;
    run: CiCommandRunner;
    /** Env-var names to strip from both fixer + gate runs (A3, e.g. `TF_ACC`). */
    unsetEnv?: string[];
  },
): { ranFixer: boolean; gateOk: boolean; gateOutput: string } | null {
  const { ciGate, ciFixCmd, worktreePath, run, unsetEnv } = args;
  if (!ciGate || ciGate.length === 0) return null;

  let ranFixer = false;
  if (ciFixCmd && ciFixCmd.length > 0) {
    // Best-effort: a fixer that errors must never throw — the gate below is the
    // real verdict, and an un-formatted tree just fails that gate cleanly.
    try {
      run(ciFixCmd, worktreePath, 'fix', unsetEnv);
      ranFixer = true;
    } catch {
      /* swallow — formatter failure is non-fatal */
    }
  }

  const gate = run(ciGate, worktreePath, 'gate', unsetEnv);
  return { ranFixer, gateOk: gate.ok, gateOutput: gate.output };
}
