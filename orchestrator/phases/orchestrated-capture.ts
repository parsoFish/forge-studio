/**
 * Orchestrator-owned demo capture (ADR 036 / refinement N1).
 *
 * The 2026-07 betterado run escalated through five rounds of live-evidence
 * fabrication (hand-written beforeOutput/afterOutput, relabeled captures,
 * mtime-backdated files) against post-hoc forensic checks. The settled answer
 * — proven in round 5 by operator-run gate execution — is structural: the
 * ORCHESTRATOR spawns the capture runner itself and the agent only authors
 * WHAT to capture (checkpoint `command`s in demo.json). `forge demo capture`
 * back-fills the real before(main)/after(HEAD) output over whatever text the
 * agent wrote, so hand-written evidence for command checkpoints cannot survive
 * a successful orchestrated run, and the forensic-escalation ladder is dead
 * weight by construction.
 *
 * This module owns the child-process mechanics (spawn in the WI worktree,
 * capture stdout/stderr + exit code, wall-clock timeout classified as
 * ENVIRONMENT failure per N10) and the commit step that puts the
 * orchestrator-produced artifacts on the branch. The event emission lives at
 * the call site (composedUnifierGate) next to the other gate events.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { DEMO_JSON_BASENAME, DEMO_MD_BASENAME } from '../demo-paths.ts';

const FORGE_ROOT = resolve(import.meta.dirname, '..', '..');

/** Default wall-clock bound for an orchestrated capture run (15 min — it
 * builds/serves two worktrees and may drive a browser). */
const DEFAULT_DEMO_CAPTURE_TIMEOUT_MS = 15 * 60_000;

const OUTPUT_TAIL_MAX = 4096;

/** `FORGE_DEMO_CAPTURE_TIMEOUT_MS` overrides; otherwise 15 min. */
export function resolveDemoCaptureTimeoutMs(): number {
  const raw = process.env.FORGE_DEMO_CAPTURE_TIMEOUT_MS;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_DEMO_CAPTURE_TIMEOUT_MS;
}

/**
 * The argv the orchestrator spawns for a real capture: the forge CLI's own
 * `demo capture` engine, run with cwd = the WI worktree (the CLI resolves the
 * project + demo dir from its invocation cwd). Tests substitute a fake script.
 */
export function buildDemoCaptureArgv(initiativeId: string): string[] {
  return [process.execPath, join(FORGE_ROOT, 'bin', 'forge.mjs'), 'demo', 'capture', initiativeId];
}

/**
 * Does this demo.json declare evidence the orchestrator must produce?
 * True when ≥1 checkpoint carries a `command` (real CLI stdout evidence) or is
 * an explicit screenshot/video checkpoint. Notes-only demos (the trivial tier)
 * skip capture entirely — same rule the demo skill states for agents.
 * Unreadable/invalid demo.json ⇒ false (the pr_self_contained gate reports it).
 */
export function demoJsonWantsCapture(demoJsonPath: string): boolean {
  if (!existsSync(demoJsonPath)) return false;
  try {
    const parsed = JSON.parse(readFileSync(demoJsonPath, 'utf8')) as {
      checkpoints?: Array<{ command?: unknown; kind?: unknown }>;
    };
    const cps = Array.isArray(parsed?.checkpoints) ? parsed.checkpoints : [];
    return cps.some(
      (c) =>
        (typeof c?.command === 'string' && c.command.trim().length > 0) ||
        c?.kind === 'screenshot' ||
        c?.kind === 'video',
    );
  } catch {
    return false;
  }
}

export type OrchestratorCommandResult = {
  ok: boolean;
  exitCode: number;
  /** Killed by our own wall-clock timeout — ENVIRONMENT failure (N10). */
  timedOut: boolean;
  /** Could not run at all (missing binary / EACCES / killed by a foreign signal). */
  errored: boolean;
  stdoutTail: string;
  stderrTail: string;
  durationMs: number;
  command: string;
};

/**
 * Spawn one orchestrator-owned command synchronously in `cwd`, capturing
 * stdout/stderr + exit code, bounded by `timeoutMs`. Never throws — every
 * outcome (pass / fail / timeout / unrunnable) comes back classified.
 */
export function runOrchestratorCommand(
  argv: readonly string[],
  opts: { cwd: string; timeoutMs: number },
): OrchestratorCommandResult {
  const startedAt = Date.now();
  const command = argv.join(' ');
  const [head, ...rest] = argv;
  if (!head) {
    return { ok: false, exitCode: -1, timedOut: false, errored: true, stdoutTail: '', stderrTail: 'empty command', durationMs: 0, command };
  }
  let stdout = '';
  let stderr = '';
  try {
    const out = execFileSync(head, rest, { cwd: opts.cwd, stdio: 'pipe', timeout: opts.timeoutMs });
    stdout = out.toString('utf8');
    return {
      ok: true,
      exitCode: 0,
      timedOut: false,
      errored: false,
      stdoutTail: tail(stdout),
      stderrTail: '',
      durationMs: Date.now() - startedAt,
      command,
    };
  } catch (err) {
    const e = err as { status?: number | null; code?: string; signal?: string; message?: string; stdout?: Buffer | string; stderr?: Buffer | string };
    if (e.stdout) stdout = typeof e.stdout === 'string' ? e.stdout : e.stdout.toString('utf8');
    if (e.stderr) stderr = typeof e.stderr === 'string' ? e.stderr : e.stderr.toString('utf8');
    const killedBySignal = !!e.signal && (e.status === null || e.status === undefined);
    const deadlineElapsed = Date.now() - startedAt >= opts.timeoutMs;
    const timedOut = e.code === 'ETIMEDOUT' || (killedBySignal && deadlineElapsed);
    const errored = !timedOut && (e.code === 'ENOENT' || e.code === 'EACCES' || killedBySignal);
    return {
      ok: false,
      exitCode: timedOut ? -6 : errored ? -4 : typeof e.status === 'number' ? e.status : 1,
      timedOut,
      errored,
      stdoutTail: tail(stdout),
      stderrTail: tail(stderr || (e.message ?? '')),
      durationMs: Date.now() - startedAt,
      command,
    };
  }
}

/**
 * Commit (and push) the artifacts an orchestrated capture produced —
 * `demo.json` + `DEMO.md` under the demo dir — so the real evidence lands ON
 * the branch and the branches_in_sync gate still holds. No-op when the
 * capture changed nothing. Best-effort: git failures return false and the
 * composed gate's own checks surface any resulting inconsistency.
 */
export function commitOrchestratedCaptureArtifacts(
  worktreePath: string,
  demoDirRel: string,
  initiativeId: string,
  message?: string,
): boolean {
  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd: worktreePath, stdio: 'pipe', encoding: 'utf8' });
  try {
    const paths = [join(demoDirRel, DEMO_JSON_BASENAME), join(demoDirRel, DEMO_MD_BASENAME)].filter((p) =>
      existsSync(join(worktreePath, p)),
    );
    if (paths.length === 0) return false;
    git(['add', '--', ...paths]);
    const staged = git(['diff', '--cached', '--name-only']).trim();
    if (staged.length === 0) return false;
    git(['commit', '-m', message ?? `chore(demo): orchestrated demo capture (${initiativeId})`, '--no-verify']);
    // Push so the sync gate (local HEAD == origin HEAD) keeps holding.
    git(['push', 'origin', 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

function tail(s: string): string {
  if (s.length <= OUTPUT_TAIL_MAX) return s;
  return '…' + s.slice(s.length - OUTPUT_TAIL_MAX + 1);
}
