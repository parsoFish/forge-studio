/**
 * Stop conditions for the Ralph loop. The loop exits when any one fires.
 *
 * Each condition is a pure function over loop state. The quality-gates
 * condition shells out to side effects (file diff, test runner) but reports a
 * boolean.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { gitIdentityConfigArgs, ORCHESTRATOR_GIT_IDENTITY } from '../../orchestrator/config.ts';

export type StopCondition =
  | { kind: 'quality-gates-pass' }
  | { kind: 'iteration-budget'; max: number }
  | { kind: 'cost-budget'; maxUsd: number }
  // 2026-05-24 (claude-harness cycle 1 audit): synthetic condition the
  // runner emits on iter-0 if the gate passes BEFORE any agent work.
  // Means the WI's quality_gate_cmd doesn't exercise its acceptance
  // criteria — PM must rewrite the gate. Fires before any iter has run.
  | { kind: 'gate-too-loose'; reason: string }
  // 2026-06-04 (Wave B): synthetic condition the runner emits on iter-0
  // when the gate passes AND the branch already has commits vs base —
  // a sibling WI delivered this WI's work ahead of us. Status: complete.
  | { kind: 'already-complete'; reason: string }
  // 2026-06-05 (re-review #1): synthesised by the runner inline when the gate
  // COMMAND could not run (missing binary / EACCES / killed). Status: failed —
  // a broken gate, distinct from "tests failed". The runner stops early rather
  // than iterating against an unrunnable command.
  | { kind: 'gate-errored'; reason: string }
  // G4 (2026-07-11, plan item 2.2): synthesised by the runner inline when the
  // caller's `loopCapExhausted` predicate fires — its own fix-loop failure
  // ceiling (e.g. the unifier's consecutive same-sub-check composed-gate
  // failure cap) has been hit. Status: failed — the agent has demonstrably
  // not cleared this gate; re-invoking it only burns budget (the $84.56 /
  // 16-restart 2026-07-04 spins).
  | { kind: 'loop-cap-exhausted'; reason: string }
  // G2 rescope (2026-07-11, plan item 2.6): synthesised by the runner inline
  // when the gate passes AFTER ≥1 agent iteration but the branch has ZERO
  // diff/commits vs base — no durable work exists, so the pass is hollow.
  // The deterministic tool-use + diff-presence replacement for the deleted
  // NO_WORK_INDICATORS string heuristics. Status: failed.
  | { kind: 'hollow-no-work'; reason: string };

export type LoopState = {
  worktreePath: string;
  iteration: number;
  costUsdSoFar: number;
  /** Files reported as changed each iteration (used for LoopResult.filesChanged). */
  filesChangedHistory: string[][];
};

export type StopResult =
  | { stop: false }
  | { stop: true; reason: string; condition: StopCondition['kind'] };

export async function checkStopConditions(
  state: LoopState,
  conditions: StopCondition[],
  qualityGates: (ctx?: { iteration: number }) => boolean | Promise<boolean>,
): Promise<StopResult> {
  for (const condition of conditions) {
    const result = await checkOne(state, condition, qualityGates);
    if (result.stop) return result;
  }
  return { stop: false };
}

async function checkOne(
  state: LoopState,
  condition: StopCondition,
  qualityGates: (ctx?: { iteration: number }) => boolean | Promise<boolean>,
): Promise<StopResult> {
  switch (condition.kind) {
    case 'quality-gates-pass':
      if (await qualityGates({ iteration: state.iteration })) {
        return { stop: true, reason: 'quality gates pass', condition: 'quality-gates-pass' };
      }
      return { stop: false };

    case 'iteration-budget':
      if (state.iteration >= condition.max) {
        return {
          stop: true,
          reason: `iteration budget exhausted (${condition.max})`,
          condition: 'iteration-budget',
        };
      }
      return { stop: false };

    case 'cost-budget':
      if (state.costUsdSoFar >= condition.maxUsd) {
        return {
          stop: true,
          reason: `cost budget exhausted ($${condition.maxUsd})`,
          condition: 'cost-budget',
        };
      }
      return { stop: false };

    case 'gate-too-loose':
      // This condition is never CHECKED in the per-iteration loop — the
      // runner detects it inline at iter 0 (gate passes before any work)
      // and synthesises a finalize() call. The case exists only for
      // discriminated-union exhaustiveness.
      return { stop: false };

    case 'already-complete':
      // Like gate-too-loose, this is synthesised by the runner at iter 0
      // (gate passes + branch already has commits → sibling delivered).
      // Never fired from the per-iteration condition loop.
      return { stop: false };

    case 'gate-errored':
      // Synthesised by the runner inline when the gate command can't run.
      // Never fired from the per-iteration condition loop.
      return { stop: false };

    case 'loop-cap-exhausted':
      // Synthesised by the runner inline when the caller's fix-loop cap
      // predicate fires. Never fired from the per-iteration condition loop.
      return { stop: false };

    case 'hollow-no-work':
      // Synthesised by the runner inline when the gate passes after ≥1
      // iteration with zero branch diff vs base. Never fired from the
      // per-iteration condition loop.
      return { stop: false };
  }
}

/**
 * F-23: gate-run telemetry. Populated by the wrapped gate functions and
 * delivered via the optional `onRun` callback so callers can emit a `gate`
 * event with stdout/stderr context (instead of just the boolean pass/fail).
 */
export type GateRunInfo = {
  passed: boolean;
  exitCode: number;
  durationMs: number;
  /** Last 4 KB of stdout. Empty if the gate produced none. */
  stdoutTail: string;
  /** Last 4 KB of stderr. Empty if the gate produced none. */
  stderrTail: string;
  /** The command that was run, for grep-ability in the event log. */
  command: string;
  /**
   * Set when the gate failed despite exit 0 — surfaces *which* tightening
   * rejected the run. Empty when the gate's outcome was determined by exit
   * code alone (the pre-tightening behaviour). G2 (2026-07-11): the
   * 'no-work-indicator' string-scan reason was deleted with its heuristics —
   * hollow detection is the runner's `hollow-no-work` diff-presence check.
   */
  rejectReason?: 'required-paths-missing' | 'gate-errored' | 'live-env-missing' | 'gate-timeout';
  /**
   * Set when the gate command itself could NOT RUN (missing binary, EACCES,
   * killed by signal) — a BROKEN GATE, categorically different from a test
   * failure. The emitter logs a distinct `gate.errored` event and the
   * failure-classifier surfaces it as a "fix the gate, not the code" terminal,
   * so the reflector is not mis-trained and the WI doesn't burn its budget
   * iterating against an unrunnable command.
   */
  errored?: boolean;
  /**
   * N10 (2026-07 betterado friction): set when the gate was KILLED by its
   * timeout — an ENVIRONMENT failure (concurrent-build load, a hung live
   * call), categorically distinct from BOTH a work-failure (tests ran and
   * failed) and a broken gate (`errored`). The emitter logs a distinct
   * `gate.timeout` event with `failure_kind: 'environment'` so the failure
   * classifier routes it as transient (auto-retry) instead of "the code was
   * wrong" — the 2026-07-04 security-permissions UWI-6 case: the fix was
   * complete and pushed, but a timed-out judge gate read as work-failure and
   * burned the remaining loop budget.
   */
  timedOut?: boolean;
  /**
   * The Ralph iteration this gate ran in. iter-0 is the sharp-gate
   * must-fail check that runs BEFORE the agent has done any work; a
   * failure there is expected and the emitter (developer-loop.ts)
   * should classify it as a `log` event rather than an `error`.
   */
  iteration?: number;
};

const GATE_OUTPUT_MAX = 4096;

/**
 * Tightening options for `makeQualityGateFromCmd`. When all are absent the
 * gate's pass/fail is the exit-code alone (pre-tightening behaviour); when
 * present each layer adds a fail-closed check on top of exit 0.
 *
 * G2 (2026-07-11, plan item 2.6): the `NO_WORK_INDICATORS` /
 * `WORK_HAPPENED_PATTERNS` output-string heuristics (and their
 * `noWorkIndicators` override) were DELETED. They were prompt-shaped
 * guesswork over runner chatter; the deterministic replacements are the
 * `requiredPaths` diff check here and the runner's `hollow-no-work`
 * tool-use + diff-presence check (a gate that passes after N agent
 * iterations with zero branch diff is hollow).
 */
export type GateTighteningOptions = {
  /**
   * Paths the WI is declared to produce (`creates` per C5) or that the dev-loop
   * must verify exist post-gate (`verification_artifact` per C5). When set,
   * the gate is treated as passed only if `git diff --name-only main...HEAD`
   * (run in the worktree) lists at least one of these paths. Empty array
   * disables the check.
   */
  requiredPaths?: readonly string[];
  /**
   * Env vars that MUST be set for this gate to actually exercise the live
   * system (e.g. `["TF_ACC"]` for a Terraform live-acceptance gate). When any
   * is unset, the gate is treated as ERRORED (could not validate) rather than
   * passed — because a live-acc runner without these SKIPS, and a skipped Go
   * acc test prints `ok pkg 0.00Xs` (exit 0, indistinguishable from a real
   * pass), so no post-hoc output check can catch it. Wired from `.forge/project.json`
   * `acceptance_gate.requires_env` for WIs whose gate targets the acc suite.
   * Empty/absent ⇒ no env requirement (default behaviour). Surfaced after the
   * forge daemon ran betterado cycles without TF_ACC → live-acc gates skipped +
   * false-passed and the resources shipped unverified (2026-06-06).
   *
   * Resolution order (2026-06-11): a var counts as "set" if it is in the forge
   * process env OR in the project's gitignored `secrets.env` at the worktree
   * root (the contract's first-class live-creds file; process env wins on
   * conflict). The secrets.env vars are also injected into the gate child
   * process, so framework-level pre-checks that run before the test's own
   * secrets loading (e.g. the Go TF_ACC skip-check) see them too. Previously
   * the guard only consulted `process.env`, so a daemon started without the
   * creds exported errored EVERY live-acc gate (`live-env-missing`) even
   * though secrets.env held them — the 2026-06-08 betterado cycle failures.
   */
  requiredEnv?: readonly string[];
  /**
   * Wall-clock bound on the gate child process (ms). When exceeded the child
   * is killed and the run is classified `timedOut` (environment failure, NOT
   * work-failure — N10). Absent ⇒ no timeout (pre-2026-07 behaviour; callers
   * on the orchestrator hot path pass `resolveGateTimeoutMs()`).
   */
  timeoutMs?: number;
};

/** Default wall-clock bound for orchestrator-run gate commands (30 min). */
const DEFAULT_GATE_TIMEOUT_MS = 30 * 60_000;

/**
 * Resolve the gate-command timeout: `FORGE_GATE_TIMEOUT_MS` overrides (heavy
 * live-acceptance gates — e.g. a multi-resource terraform apply — can
 * legitimately exceed the default under a cold cache); otherwise 30 min.
 */
export function resolveGateTimeoutMs(): number {
  const raw = process.env.FORGE_GATE_TIMEOUT_MS;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_GATE_TIMEOUT_MS;
}

/**
 * Minimal dotenv read of the project's `secrets.env` — the forge↔project
 * contract's first-class live-creds file (gitignored, canonical var names).
 * Looks in the worktree root first, then falls back to the MAIN project
 * checkout (via `git rev-parse --git-common-dir`): secrets.env is gitignored,
 * so `git worktree add` never materialises it in cycle worktrees — the main
 * checkout is where the operator actually keeps it. Mirrors the project-side
 * loader semantics (betterado testutils/secrets.go): skip blanks + `#`
 * comments, allow `export ` prefix, strip surrounding quotes. Returns {} when
 * no file is found — the requiredEnv guard then reports the missing var.
 */
export function readWorktreeSecretsEnv(worktreePath: string): Record<string, string> {
  let content: string | undefined;
  try {
    content = readFileSync(resolve(worktreePath, 'secrets.env'), 'utf8');
  } catch {
    try {
      const gitCommonDir = execFileSync('git', ['-C', worktreePath, 'rev-parse', '--git-common-dir'], {
        stdio: 'pipe',
      }).toString('utf8').trim();
      const mainRoot = resolve(worktreePath, gitCommonDir, '..');
      content = readFileSync(resolve(mainRoot, 'secrets.env'), 'utf8');
    } catch {
      return {};
    }
  }
  const vars: Record<string, string> = {};
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const stripped = line.startsWith('export ') ? line.slice('export '.length) : line;
    const eq = stripped.indexOf('=');
    if (eq <= 0) continue;
    const key = stripped.slice(0, eq).trim();
    if (key === '') continue;
    const val = stripped.slice(eq + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
    vars[key] = val;
  }
  return vars;
}

/** Default quality-gates implementation: shells to `npm test` in the worktree. */
export function defaultQualityGates(
  worktreePath: string,
  onRun?: (info: GateRunInfo) => void,
  ctx?: { iteration: number },
): boolean {
  return runGateCapturing(worktreePath, ['sh', '-c', 'npm test --silent'], onRun, undefined, ctx?.iteration);
}

/**
 * Build a quality-gate closure from an explicit command vector. Used by
 * cycle.ts:runDeveloperLoop to thread the manifest's per-project
 * `quality_gate_cmd` (Python pytest, bash bats, Rust cargo, etc.) into the
 * Ralph runner — eliminating the F-04 hardcoded `npm test` problem.
 *
 * Returns a sync closure suitable for `LoopInput.qualityGate`. Returns true
 * iff the command exits 0 **and** any tightening checks pass — the optional
 * `requiredPaths` git-diff inclusion check (see
 * [[quality-gate-cmd-must-assert-new-work]]).
 *
 * F-23: optional `onRun` callback receives stdout/stderr/exit + reject
 * reason after each invocation so the orchestrator can emit a `gate` event
 * with full context (not just the boolean pass/fail).
 */
export function makeQualityGateFromCmd(
  worktreePath: string,
  cmd: readonly string[],
  onRun?: (info: GateRunInfo) => void,
  options?: GateTighteningOptions,
): (ctx?: { iteration: number }) => boolean {
  return (ctx) => runGateCapturing(worktreePath, cmd, onRun, options, ctx?.iteration);
}

/**
 * Shared gate-runner: capture stdout/stderr/exit + duration, deliver them via
 * the optional callback, return the boolean the runner expects.
 *
 * Tightening layered on top of exit-0: if `requiredPaths` supplied, run
 * `git diff --name-only main...HEAD` in the worktree and require ≥1 of those
 * paths in the diff. Catches "agent wrote nothing the manifest declared as
 * `creates` / `verification_artifact`". A rejection sets `passed: false` + a
 * `rejectReason` on the GateRunInfo so post-mortems can see which layer
 * caught it. (G2: the output-string no-work scan that used to run here was
 * deleted — the runner's `hollow-no-work` diff-presence check replaces it.)
 */
function runGateCapturing(
  worktreePath: string,
  cmd: readonly string[],
  onRun: ((info: GateRunInfo) => void) | undefined,
  options?: GateTighteningOptions,
  iteration?: number,
): boolean {
  if (cmd.length === 0) {
    onRun?.({ passed: false, exitCode: -1, durationMs: 0, stdoutTail: '', stderrTail: '', command: '', iteration });
    return false;
  }
  const [head, ...rest] = cmd;
  if (!head) {
    onRun?.({ passed: false, exitCode: -1, durationMs: 0, stdoutTail: '', stderrTail: '', command: '', iteration });
    return false;
  }
  const command = cmd.join(' ');

  // Live-acceptance env guard (2026-06-06). A live-acc gate that runs WITHOUT
  // its declared live-test env makes the runner SKIP — and a skipped Go acc
  // test prints `ok pkg 0.00Xs`, indistinguishable from a real pass, so no
  // output check can catch it after the fact.
  // The only reliable guard is up front: if any required var is unset, the gate
  // could ONLY skip, so ERROR it (could-not-validate, a broken gate) rather than
  // let it false-pass. Errored ⇒ the runner stops early + the classifier says
  // "fix the gate", instead of shipping an unverified resource.
  //
  // 2026-06-11: the vars are resolved from the process env AND the project's
  // `secrets.env` at the worktree root (process env wins), and the merged env
  // is handed to the gate child process — see GateTighteningOptions.requiredEnv.
  let gateEnv: NodeJS.ProcessEnv | undefined;
  const requiredEnv = options?.requiredEnv ?? [];
  if (requiredEnv.length > 0) {
    const secrets = readWorktreeSecretsEnv(worktreePath);
    gateEnv = { ...secrets, ...process.env };
    const missingEnv = requiredEnv.filter((v) => !gateEnv![v]);
    if (missingEnv.length > 0) {
      onRun?.({
        passed: false,
        errored: true,
        exitCode: -5, // synthetic — gate could not validate (live-test env absent)
        durationMs: 0,
        stdoutTail: '',
        stderrTail:
          `[forge gate-errored] live-acceptance gate requires ${missingEnv.join(', ')} to be set so the test ` +
          `actually runs against the live system; unset ⇒ the runner SKIPS and the gate would FALSE-PASS ` +
          `("ok … 0.00s"). Checked the cycle env AND \`secrets.env\` at the project root — add ` +
          `${missingEnv.join(', ')} under these exact names to secrets.env (the gitignored live-creds file), ` +
          `or export them in the environment forge runs in.`,
        command,
        rejectReason: 'live-env-missing',
        iteration,
      });
      return false;
    }
  }
  const startedAt = Date.now();
  let passed = false;
  let exitCode = 0;
  let stdout = '';
  let stderr = '';
  let errored = false;
  // Tightening / error reason — only relevant when exit-code already said "pass"
  // (no-work / required-paths) OR when the command itself could not run (errored).
  let rejectReason: GateRunInfo['rejectReason'];
  try {
    const out = execFileSync(head, rest, {
      cwd: worktreePath,
      stdio: 'pipe',
      ...(gateEnv ? { env: gateEnv } : {}),
      ...(options?.timeoutMs ? { timeout: options.timeoutMs } : {}),
    });
    stdout = out.toString('utf8');
    passed = true;
  } catch (err) {
    const e = err as { status?: number | null; code?: string; signal?: string; message?: string; stdout?: Buffer | string; stderr?: Buffer | string };
    if (e.stdout) stdout = typeof e.stdout === 'string' ? e.stdout : e.stdout.toString('utf8');
    if (e.stderr) stderr = typeof e.stderr === 'string' ? e.stderr : e.stderr.toString('utf8');
    passed = false;
    // N10: killed by OUR OWN timeout — an environment failure (load, a hung
    // live call), not a work failure and not a broken gate. Node reports it as
    // code ETIMEDOUT (belt: any kill-signal death after the deadline elapsed).
    const deadlineElapsed = options?.timeoutMs !== undefined && Date.now() - startedAt >= options.timeoutMs;
    const killedBySignalRaw = !!e.signal && (e.status === null || e.status === undefined);
    if (e.code === 'ETIMEDOUT' || (killedBySignalRaw && deadlineElapsed)) {
      exitCode = -6; // synthetic — gate killed by timeout (environment, not work-failure)
      rejectReason = 'gate-timeout';
      stderr =
        (stderr ? stderr + (stderr.endsWith('\n') ? '' : '\n') : '') +
        `[forge gate-timeout] the gate command was killed after exceeding its ${options?.timeoutMs}ms timeout.\n` +
        `  This is an ENVIRONMENT failure (machine load / a hung step), NOT a work failure — the code may well be ` +
        `complete. The orchestrator classifies it as transient; raise FORGE_GATE_TIMEOUT_MS if this gate is ` +
        `legitimately slow (e.g. a cold multi-package build or a long live-acceptance run).`;
      onRun?.({
        passed: false,
        timedOut: true,
        exitCode,
        durationMs: Date.now() - startedAt,
        stdoutTail: tail(stdout, GATE_OUTPUT_MAX),
        stderrTail: tail(stderr, GATE_OUTPUT_MAX),
        command,
        rejectReason,
        iteration,
      });
      return false;
    }
    // Gate ERROR vs test FAIL (re-review #1). The command could not be EXECUTED
    // as intended — a missing binary (ENOENT), permission error (EACCES), or a
    // kill signal (no exit status) — as opposed to a test runner that ran and
    // returned non-zero. A broken gate is UNFIXABLE by the agent (the gate cmd
    // is fixed by the PM), so iterating burns the budget and then fails the
    // cycle as if the CODE were wrong, mis-training the reflector. Surface it as
    // a distinct state so the classifier says "fix the gate", not "tests failed".
    const spawnFailed = e.code === 'ENOENT' || e.code === 'EACCES';
    const killedBySignal = killedBySignalRaw;
    if (spawnFailed || killedBySignal) {
      errored = true;
      exitCode = -4; // synthetic — gate could not run (distinct from a real non-zero exit)
      rejectReason = 'gate-errored';
      const why = spawnFailed
        ? `the gate command could not be executed (${e.code}: \`${head}\` not found or not executable)`
        : `the gate command was killed by signal ${e.signal} before returning an exit code`;
      stderr =
        (stderr ? stderr + (stderr.endsWith('\n') ? '' : '\n') : '') +
        `[forge gate-errored] ${why}.\n` +
        `  This is a BROKEN GATE, not a test failure — the agent cannot make a non-runnable command pass. ` +
        `Fix the work item's quality_gate_cmd (is the runner installed? is the path/binary correct?), then re-run.` +
        (e.message ? `\n  spawn error: ${e.message}` : '');
    } else {
      exitCode = typeof e.status === 'number' ? e.status : 1;
    }
  }

  // Tightening: only relevant when exit-code already said "pass". A non-zero
  // exit is a clear fail regardless of paths.
  if (passed) {
    // requiredPaths diff inclusion check.
    if (options?.requiredPaths && options.requiredPaths.length > 0) {
      const diffPaths = gitDiffPathsAgainstMain(worktreePath);
      const matched = options.requiredPaths.some((p) => diffPaths.has(p));
      if (!matched) {
        passed = false;
        exitCode = -3;
        rejectReason = 'required-paths-missing';
        // F1.I2 prescriptive: agent now reads exactly which file to create.
        const required = options.requiredPaths;
        const pathBullets = required.map((p) => `    - ${p}`).join('\n');
        stderr =
          stderr +
          (stderr.endsWith('\n') ? '' : '\n') +
          `[forge gate-tightening] REJECTED: 'git diff --name-only main...HEAD' shows NONE of this work item's required output paths.\n` +
          `  ACTION REQUIRED before exiting this iteration — create AT LEAST ONE of these files in the worktree, then re-run the gate:\n` +
          pathBullets + '\n' +
          `  A compiling stub satisfies the path requirement; the substantive test/code body comes second. Without one of these paths in your diff, the iteration WILL fail. Do not exit until at least one is present in 'git diff'.`;
      }
    }
  }

  onRun?.({
    passed,
    exitCode,
    durationMs: Date.now() - startedAt,
    stdoutTail: tail(stdout, GATE_OUTPUT_MAX),
    stderrTail: tail(stderr, GATE_OUTPUT_MAX),
    command,
    ...(rejectReason ? { rejectReason } : {}),
    ...(errored ? { errored } : {}),
    iteration,
  });
  return passed;
}

/**
 * Auto-commit any uncommitted (staged or unstaged) changes in the worktree
 * with a clearly-marked `forge-autocommit` message. Surfaced as a safety
 * net after each agent iteration so the gate's `git diff --name-only
 * main...HEAD` check sees the work even when the agent (Sonnet/Opus)
 * "forgot" to commit despite the system-prompt instruction to do so.
 *
 * Background — surfaced by claude-harness cycle 1 (2026-05-24): the dev
 * agent wrote src/events.ts + tests/events.test.ts (15 tests passed) but
 * never ran `git commit`. The gate then required-paths-rejected for 5
 * iterations because the working-tree files weren't in the branch's
 * commit diff. Auto-committing here keeps the loop from dead-ending on
 * what is otherwise a complete WI.
 *
 * `forge-autocommit:` prefix lets reflectors trivially distinguish these
 * from agent-authored commits in cycle-recap. G8 wave 2 (2026-07-12): this
 * is an orchestrator-issued commit (no agent in the loop) so it carries
 * `ORCHESTRATOR_GIT_IDENTITY` via explicit `-c` flags rather than relying on
 * whatever git identity happens to be configured in the worktree.
 *
 * Returns true if a commit was created; false if there was nothing to
 * commit OR git failed. Failures are non-fatal — the gate's normal check
 * runs whether we committed or not.
 */
export function autoCommitWorktreeIfDirty(
  worktreePath: string,
  iteration: number,
  workItemId?: string,
): boolean {
  try {
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: worktreePath, stdio: 'pipe' }).toString('utf8');
    if (status.trim().length === 0) return false;
    execFileSync('git', ['add', '-A'], { cwd: worktreePath, stdio: 'pipe' });
    const wiTag = workItemId ? ` ${workItemId}` : '';
    const msg = `forge-autocommit:${wiTag} iter ${iteration} WIP (safety-net for missed agent commit)`;
    execFileSync(
      'git',
      [...gitIdentityConfigArgs(ORCHESTRATOR_GIT_IDENTITY), 'commit', '-m', msg, '--no-verify'],
      { cwd: worktreePath, stdio: 'pipe' },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the set of paths different on this branch vs the merge base with
 * `main`. Used by the requiredPaths tightening; failures (no git, no main,
 * etc.) return an empty set so the tightening fails-closed only when paths
 * are present-and-required but absent.
 */
function gitDiffPathsAgainstMain(worktreePath: string): Set<string> {
  try {
    const baseBranch = resolveBaseBranch(worktreePath);
    const out = execFileSync('git', ['diff', '--name-only', `${baseBranch}...HEAD`], {
      cwd: worktreePath,
      stdio: 'pipe',
    });
    const lines = out.toString('utf8').split('\n').map((s) => s.trim()).filter((s) => s.length > 0);
    return new Set(lines);
  } catch {
    // No git repo / no main+master / detached HEAD: caller's tightening intent is
    // "fail on missing paths"; an empty set causes the .some() check above
    // to fail and reject the gate. That's the safe default — better to
    // false-reject in a degraded git state than to false-pass.
    return new Set();
  }
}

/**
 * Resolve the project's base branch name. Prefers `main`; falls back to
 * `master`. Surfaced by claude-harness cycle 1 (2026-05-24): a fresh
 * `git init` defaults to `master`, but the gate hard-coded `main`, so
 * the diff silently returned empty for 5 iterations even though the
 * agent's commits were on the branch. Throws if neither exists so the
 * caller's catch logs the degraded state.
 */
function resolveBaseBranch(worktreePath: string): string {
  for (const candidate of ['main', 'master']) {
    try {
      execFileSync('git', ['rev-parse', '--verify', candidate], {
        cwd: worktreePath,
        stdio: 'pipe',
      });
      return candidate;
    } catch { /* try next */ }
  }
  throw new Error('no main or master branch in worktree');
}

/**
 * Wave B (2026-06-04): 3-way iter-0 gate decision.
 *
 * Returns true when the worktree branch already has commits AND/OR file-level
 * diffs against its base — i.e. a sibling WI has already delivered work here.
 * Returns false when the branch is completely empty vs base (hollow gate).
 *
 * Used by the runner to distinguish:
 *   - gate passes + no commits → hollow gate  → `gate-too-loose`  (failed)
 *   - gate passes + has commits → sibling delivered → `already-complete` (complete)
 */
/**
 * re-review #3: are ALL of this WI's declared `creates[]` paths present in the
 * branch diff vs base? Tightens `already-complete`: a sibling having committed
 * *something* (`checkBranchHasCommitsVsBase`) is NOT enough to call THIS WI
 * done — it is genuinely already-delivered only when its OWN declared outputs
 * are on the branch. A WI with empty `creates[]` returns false: it must run its
 * own iteration to attempt its AC, never free-ride on a sibling's commit (which
 * was the hollow-pass: a no-work WI marked complete because the branch had any
 * commit). The complement to the gate's `.some()` required-paths check, which
 * only catches the "NONE present" case — this catches "not ALL present".
 */
export function branchHasAllCreates(worktreePath: string, creates: readonly string[]): boolean {
  if (!creates || creates.length === 0) return false;
  const diff = gitDiffPathsAgainstMain(worktreePath);
  return creates.every((p) => diff.has(p));
}

export function checkBranchHasCommitsVsBase(worktreePath: string): boolean {
  try {
    const base = resolveBaseBranch(worktreePath);
    // Commit count: > 0 means the branch has real commits beyond base.
    const countOut = execFileSync(
      'git', ['rev-list', '--count', `${base}..HEAD`],
      { cwd: worktreePath, stdio: 'pipe' },
    ).toString('utf8').trim();
    if (Number(countOut) > 0) return true;
    // Also check uncommitted diffs (staged/unstaged) in case autocommit hasn't run yet.
    const diffOut = execFileSync(
      'git', ['diff', '--name-only', `${base}...HEAD`],
      { cwd: worktreePath, stdio: 'pipe' },
    ).toString('utf8').trim();
    return diffOut.length > 0;
  } catch {
    // Can't determine — treat as no commits (hollow gate is the safer fail-closed path).
    return false;
  }
}

function tail(s: string, max: number): string {
  if (s.length <= max) return s;
  return '…' + s.slice(s.length - max + 1);
}
