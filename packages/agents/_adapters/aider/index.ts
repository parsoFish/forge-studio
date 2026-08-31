/**
 * Aider RuntimeAdapter (M8-A flywheel drop-in, ADR 029).
 *
 * ---------------------------------------------------------------------------
 * What Aider is, and why this adapter is shaped the way it is
 * ---------------------------------------------------------------------------
 * Aider (https://aider.chat) is a STANDALONE agentic-coder CLI — NOT an SDK
 * and NOT a token-stream library. You give it a message, it runs its own
 * edit/test loop internally, writes files into a git repo, and (by default)
 * commits the result. There is no in-process `query()` that streams tokens.
 *
 * That mismatch with the Claude adapter (which DOES stream SDK messages) is
 * the whole reason the two halves of this file look different:
 *
 *   createAgent(opts) → AgentInvocation
 *       One Ralph iteration = one `aider --message …` subprocess against the
 *       worktree. We capture which files changed via GIT (mirroring the Claude
 *       path's `git diff --name-only base...HEAD`), parse a best-effort cost
 *       from stdout, and return a well-formed AgentIterationInfo.
 *
 *   query({ prompt })  → AsyncIterable
 *       A THIN SHIM. Aider is loop-driven, not a token stream, so there is no
 *       honest per-token / per-tool stream to surface. We run aider once and
 *       yield a SINGLE terminal `{ type: 'result' }` message. This satisfies
 *       the conformance contract (§4: ≥1 message, exactly one `result`
 *       terminal) while being explicit that direct-stream phases (PM /
 *       reflector / architect) that depend on incremental `assistant` events
 *       will NOT get them from aider. See the `makeAiderQuery` doc-block.
 *
 * ---------------------------------------------------------------------------
 * Dependency + credential gating (HARD requirement)
 * ---------------------------------------------------------------------------
 * The `aider-install` / `aider-chat` package is NOT installed in this repo and
 * there are no creds in CI. So `available` is computed at module load and is
 * `false` unless BOTH:
 *   (a) the aider CLI is resolvable on PATH (probed via `--version`), OR the
 *       npm shim imports, AND
 *   (b) a required provider API key env var is set (ANTHROPIC_API_KEY or
 *       OPENAI_API_KEY — aider's own canonical names).
 *
 * The dynamic import that would resolve an npm shim is done through a STRING
 * VARIABLE (`const m = await import(pkgName)`) so `tsc` never tries to resolve
 * the missing module. The boundary is typed with a minimal local interface
 * (`AiderModuleProbe`), not `any` sprawl.
 *
 * ---------------------------------------------------------------------------
 * Testability without live creds
 * ---------------------------------------------------------------------------
 * `createAgent` accepts an injected `runAider` seam (on the Aider options
 * superset) AND the conformance `queryFn` seam (via makeAiderAdapter), so the
 * contract test drives the whole adapter with a fake subprocess + a fake
 * stream — no aider binary, no API key, no network. See aider.test.ts.
 */

import { readFileSync } from 'node:fs';
import { execFileSync, execFile } from 'node:child_process';

import type { RuntimeAdapter, AdapterAgentOptions, QueryFn } from '../types.ts';
import type { AgentInvocation, AgentIterationInfo } from '../../ralph/runner.ts';

// ---------------------------------------------------------------------------
// Constants — flags, env var names, package id (no hardcoded magic inline)
// ---------------------------------------------------------------------------

/** The aider executable name; resolved on PATH. */
const AIDER_BIN = 'aider';

/**
 * npm shim package id, imported through a string var so tsc does not resolve
 * it at build time (it is not installed). Aider is primarily a pip package
 * (`aider-chat`); `aider-install` is the npm bootstrap. We only use this as a
 * *presence probe* — the real invocation is the CLI subprocess.
 */
const AIDER_PKG_ID = 'aider-install';

/**
 * Provider API-key env vars aider honours. Gate is satisfied if ANY is set —
 * aider routes by `--model`, so either an Anthropic or OpenAI key is enough to
 * make *some* model usable. Source: https://aider.chat/docs/llms/anthropic.html
 * and https://aider.chat/docs/config/options.html (env section).
 */
const REQUIRED_ENV_VARS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'] as const;

/**
 * Non-interactive flag set, verified against the aider CLI reference:
 *   --message / -m     single message then exit, disables chat mode
 *   --yes-always       auto-confirm every prompt (unattended)
 *   --no-stream        no streaming UI (we capture stdout wholesale)
 *   --no-pretty        no ANSI colour codes polluting the captured output
 *   --no-check-update  don't phone home for a new version on launch
 *   --no-gitignore     don't mutate the worktree's .gitignore
 * Source: https://aider.chat/docs/scripting.html and
 *         https://aider.chat/docs/config/options.html
 * Aider AUTO-COMMITS by default (`--auto-commits`), which is exactly what we
 * want: the commit is what the git diff below detects as filesChanged.
 */
const AIDER_BASE_FLAGS = [
  '--yes-always',
  '--no-stream',
  '--no-pretty',
  '--no-check-update',
  '--no-gitignore',
] as const;

/** Wall-clock cap for a single aider iteration subprocess (ms). */
const DEFAULT_ITERATION_TIMEOUT_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------------------
// Minimal typed boundary for the dynamic-import probe (NOT `any`)
// ---------------------------------------------------------------------------

/**
 * We never call into the npm shim's API surface — its mere importability is
 * the signal. Typed as a record so a successful import is a known shape, not
 * `any`. (`unknown`-narrowed at the call site.)
 */
type AiderModuleProbe = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Subprocess seam — injectable for tests
// ---------------------------------------------------------------------------

/** Result of one aider subprocess run. */
export type AiderRunResult = {
  /** Captured stdout (used for best-effort cost parsing + lastAssistantText). */
  stdout: string;
  /** Captured stderr (folded into lastAssistantText on non-zero exit). */
  stderr: string;
  /** Process exit code (0 = success; non-zero surfaces in lastAssistantText). */
  exitCode: number;
};

/**
 * The subprocess boundary. The real impl shells out to the aider CLI; tests
 * inject a fake so the adapter is exercised end-to-end without a binary,
 * an API key, or the network.
 */
export type AiderRunner = (params: {
  message: string;
  worktreePath: string;
  model?: string;
  timeoutMs: number;
}) => Promise<AiderRunResult>;

/**
 * Real aider invocation: `aider <base-flags> [--model X] --message <prompt>`
 * with cwd = worktree. We do NOT pass file args — aider's repo-map discovers
 * the relevant files itself, and the worktree IS the project. Never throws on
 * a non-zero exit (aider exits non-zero on some recoverable conditions); the
 * exit code is returned so the caller decides.
 */
const defaultAiderRunner: AiderRunner = ({ message, worktreePath, model, timeoutMs }) => {
  const args: string[] = [...AIDER_BASE_FLAGS];
  if (model) args.push('--model', model);
  args.push('--message', message);

  return new Promise<AiderRunResult>((resolve) => {
    execFile(
      AIDER_BIN,
      args,
      { cwd: worktreePath, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        // execFile's callback `err` carries `.code` (exit code) when the
        // process ran and exited non-zero, or a spawn error otherwise.
        const e = err as (NodeJS.ErrnoException & { code?: number | string }) | null;
        let exitCode = 0;
        if (e) {
          exitCode = typeof e.code === 'number' ? e.code : 1;
        }
        resolve({
          stdout: typeof stdout === 'string' ? stdout : '',
          stderr: typeof stderr === 'string' ? stderr : '',
          exitCode,
        });
      },
    );
  });
};

// ---------------------------------------------------------------------------
// Aider-specific options (superset of AdapterAgentOptions via the seam)
// ---------------------------------------------------------------------------

/**
 * Options this adapter actually consumes. It accepts the full
 * AdapterAgentOptions superset (for interchangeability with the Claude
 * adapter) but only `model` and the two injected seams are meaningful here —
 * tool allowlists / permission modes / heartbeats are Claude-SDK concepts
 * with no aider analogue and are silently ignored (documented).
 */
export type AiderAgentOptions = AdapterAgentOptions & {
  /** Inject a fake subprocess runner for tests. Defaults to the real CLI. */
  runAider?: AiderRunner;
  /** Per-iteration subprocess timeout. Defaults to DEFAULT_ITERATION_TIMEOUT_MS. */
  iterationTimeoutMs?: number;
};

// ---------------------------------------------------------------------------
// Availability — dep + creds gate (computed once at module load)
// ---------------------------------------------------------------------------

/** True iff the aider CLI is resolvable on PATH (probed via `--version`). */
function aiderBinaryPresent(): boolean {
  try {
    execFileSync(AIDER_BIN, ['--version'], { stdio: 'pipe', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * True iff the npm shim imports. Done through a STRING VARIABLE so tsc never
 * tries to resolve the (uninstalled) module. Failure (the common case here) is
 * swallowed → false.
 */
async function aiderModuleImportable(): Promise<boolean> {
  try {
    const pkgName = AIDER_PKG_ID;
    const m = (await import(pkgName)) as AiderModuleProbe;
    return typeof m === 'object' && m !== null;
  } catch {
    return false;
  }
}

/** True iff at least one required provider API key env var is set + non-empty. */
function requiredEnvPresent(env: NodeJS.ProcessEnv = process.env): boolean {
  return REQUIRED_ENV_VARS.some((name) => {
    const v = env[name];
    return typeof v === 'string' && v.trim().length > 0;
  });
}

/**
 * Compute availability. Exported so the registration site (and tests) can call
 * it explicitly. `available` on the exported adapter is the resolved value at
 * module load: the dep (binary OR npm shim) is present AND creds are set.
 *
 * Binary-present is treated as sufficient for the "dep" half because aider is a
 * CLI, not a library — the npm shim is only a secondary signal. If EITHER the
 * binary resolves or the shim imports, the dep half is satisfied; the creds
 * half is independent and mandatory.
 */
export async function computeAiderAvailable(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (!requiredEnvPresent(env)) return false;
  if (aiderBinaryPresent()) return true;
  return aiderModuleImportable();
}

// ---------------------------------------------------------------------------
// Cost parsing — best-effort, from aider stdout
// ---------------------------------------------------------------------------

/**
 * Aider prints a per-message cost line to stdout, e.g.:
 *   "Cost: $0.0123 message, $0.0456 session."
 * We extract the *session* total when present (cumulative for this run), else
 * the message cost, else 0. Best-effort by design: a missing/changed line must
 * NOT crash the iteration — cost is observability, not control flow. The
 * authoritative budget enforcement is forge's own cost-budget stop condition
 * which sums these per-iteration values.
 */
export function parseAiderCostUsd(stdout: string): number {
  // Prefer the session figure, then message, then any "$X.XX" near "Cost".
  const session = stdout.match(/\$([0-9]+(?:\.[0-9]+)?)\s*session/i);
  if (session?.[1]) {
    const n = Number(session[1]);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  const message = stdout.match(/Cost:\s*\$([0-9]+(?:\.[0-9]+)?)/i);
  if (message?.[1]) {
    const n = Number(message[1]);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Git changed-files detection — mirrors the Claude/Ralph path
// ---------------------------------------------------------------------------

/**
 * Resolve the worktree's base branch (`main`, else `master`). Mirrors
 * stop-conditions.ts:resolveBaseBranch so changed-file detection is consistent
 * with the gate's own diff. Throws if neither exists; caller catches.
 */
function resolveBaseBranch(worktreePath: string): string {
  for (const candidate of ['main', 'master']) {
    try {
      execFileSync('git', ['rev-parse', '--verify', candidate], { cwd: worktreePath, stdio: 'pipe' });
      return candidate;
    } catch {
      /* try next */
    }
  }
  throw new Error('no main or master branch in worktree');
}

/**
 * The set of paths changed on this branch vs the merge-base with the base
 * branch — the SAME mechanism the Claude path uses (aider auto-commits, so its
 * edits land as commits the branch-diff sees). Falls back to the working-tree
 * status (uncommitted changes) when there is no base branch (e.g. a fresh repo
 * / detached state in tests). Returns [] on total git failure rather than
 * throwing — file detection is best-effort observability.
 */
export function detectChangedFiles(worktreePath: string): string[] {
  // 1) Branch-vs-base diff (aider's auto-commits land here).
  try {
    const baseBranch = resolveBaseBranch(worktreePath);
    const out = execFileSync('git', ['diff', '--name-only', `${baseBranch}...HEAD`], {
      cwd: worktreePath,
      stdio: 'pipe',
    });
    const files = out.toString('utf8').split('\n').map((s) => s.trim()).filter((s) => s.length > 0);
    if (files.length > 0) return [...new Set(files)].sort();
  } catch {
    /* fall through to working-tree status */
  }
  // 2) Working-tree status (uncommitted) — covers --no-auto-commits or fresh repos.
  try {
    const out = execFileSync('git', ['status', '--porcelain'], { cwd: worktreePath, stdio: 'pipe' });
    const files = out
      .toString('utf8')
      .split('\n')
      .map((line) => line.slice(3).trim()) // strip the 2-char status + space
      .filter((s) => s.length > 0);
    return [...new Set(files)].sort();
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// createAgent — one Ralph iteration = one aider subprocess
// ---------------------------------------------------------------------------

function aiderCreateAgent(opts: AiderAgentOptions = {}): AgentInvocation {
  const runAider = opts.runAider ?? defaultAiderRunner;
  const timeoutMs = opts.iterationTimeoutMs ?? DEFAULT_ITERATION_TIMEOUT_MS;
  const model = opts.model;

  return async ({ promptPath, worktreePath }): Promise<AgentIterationInfo> => {
    const message = readFileSync(promptPath, 'utf8');

    const run = await runAider({ message, worktreePath, model, timeoutMs });

    const filesChanged = detectChangedFiles(worktreePath);
    const costUsd = parseAiderCostUsd(run.stdout);

    // Aider exposes no per-tool / per-token telemetry over a non-interactive
    // run, so the rich Claude fields are deliberately minimal:
    //   - toolsUsed/bashCommands: empty (aider is its own opaque loop).
    //   - lastAssistantText: the tail of stdout (+ stderr on failure) so a
    //     post-mortem can read what aider reported.
    //   - tokens/cache: omitted (not surfaced by aider's non-interactive CLI).
    const tail = run.exitCode === 0
      ? truncate(run.stdout, 2000)
      : truncate(`[aider exited ${run.exitCode}]\n${run.stderr}\n${run.stdout}`, 2000);

    return {
      filesChanged,
      costUsd,
      toolsUsed: [],
      bashCommands: [],
      lastAssistantText: tail,
    };
  };
}

// ---------------------------------------------------------------------------
// query — THIN SHIM (aider is loop-driven, not a token stream)
// ---------------------------------------------------------------------------

/**
 * Direct-stream seam. IMPORTANT BEHAVIOURAL DIFFERENCE vs the Claude adapter:
 *
 * Aider has NO incremental token/tool stream over its non-interactive CLI. It
 * runs an internal loop and exits. So this shim runs aider ONCE and yields a
 * SINGLE terminal `{ type: 'result' }` message — no intermediate `assistant`
 * messages, no `tool_use` blocks, no usage deltas.
 *
 * Consequences:
 *   - It satisfies the conformance contract (≥1 message, exactly one `result`).
 *   - Phases that ONLY consume the `result` terminal (cost/total) work.
 *   - Phases that depend on streaming `assistant`/`tool_use` events (the PM /
 *     reflector / architect live-telemetry path) will see NOTHING until the
 *     single terminal — they should prefer the Claude adapter, or be adapted
 *     to aider's batch nature. This is a fundamental property of wrapping a
 *     loop-driven CLI, not a TODO.
 *
 * Cost on the terminal is best-effort from aider's stdout. With no creds /
 * binary the real runner would error; tests inject a fake runner via the
 * closure, mirroring the Claude adapter's `queryFn` mock seam.
 */
function makeAiderQuery(runAider: AiderRunner, model?: string): QueryFn {
  return ((params: { prompt: string; options?: Record<string, unknown> }) => {
    async function* stream(): AsyncGenerator<unknown> {
      const optModel = typeof params.options?.model === 'string' ? params.options.model : model;
      let stdout = '';
      let exitCode = 0;
      try {
        const run = await runAider({
          message: params.prompt,
          // No worktree in the direct-stream path — aider runs against cwd.
          worktreePath: process.cwd(),
          model: optModel,
          timeoutMs: DEFAULT_ITERATION_TIMEOUT_MS,
        });
        stdout = run.stdout;
        exitCode = run.exitCode;
      } catch {
        // The shim must always yield a well-formed terminal even if the
        // subprocess seam throws — degrade to a zero-cost result.
        exitCode = 1;
      }
      // Single terminal message — aider is batch, not a stream.
      yield {
        type: 'result',
        subtype: exitCode === 0 ? 'success' : 'error',
        total_cost_usd: parseAiderCostUsd(stdout),
        num_turns: 1,
      };
    }
    return stream();
  }) as unknown as QueryFn;
}

/**
 * The real query used by the exported adapter. Wires the default (CLI)
 * subprocess runner; with no binary/creds the run errors and the shim yields a
 * zero-cost error terminal — still contract-valid.
 */
const aiderQuery: QueryFn = makeAiderQuery(defaultAiderRunner);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

// ---------------------------------------------------------------------------
// Adapter export
// ---------------------------------------------------------------------------

/**
 * Availability resolved at module load. Top-level `await` is safe here — this
 * module is ESM and forge runs under Node with module-level await support. The
 * compute is fully guarded (every probe try/catches), so a missing dep / key
 * can NEVER throw out of the import graph: it resolves to `false`.
 */
const available: boolean = await computeAiderAvailable();

/**
 * Aider RuntimeAdapter. Co-registerable alongside `claude` / `example`.
 * `available` is dep+creds-gated and therefore `false` in this CI environment.
 *
 * `createAgent` is exposed via a factory cast so callers passing the Aider
 * superset (runAider / iterationTimeoutMs) type-check, while the registry sees
 * the plain RuntimeAdapter shape.
 */
export const aiderAdapter: RuntimeAdapter = {
  id: 'aider',
  available,
  createAgent: (o: AdapterAgentOptions) => aiderCreateAgent(o as AiderAgentOptions),
  query: aiderQuery,
};

/**
 * Exported for tests: build an adapter with an injected subprocess runner and
 * an explicit availability value. This is the mock seam the conformance suite
 * uses — no aider binary, no API key, no network.
 */
export function makeAiderAdapter(runAider: AiderRunner, isAvailable: boolean): RuntimeAdapter {
  return {
    id: 'aider',
    available: isAvailable,
    createAgent: (o: AdapterAgentOptions) => aiderCreateAgent({ ...(o as AiderAgentOptions), runAider }),
    query: makeAiderQuery(runAider),
  };
}
