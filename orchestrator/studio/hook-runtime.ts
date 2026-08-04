/**
 * Hook execution runtime (R3-03-F3) — deny-by-default env stripping +
 * bounded, timed spawn.
 *
 * *** HONEST LIMIT, STATED UP FRONT: this module does NOT observe or
 * *** intercept a hook's actual env reads at runtime. Safety comes from
 * *** PREVENTION (stripping the child env down to exactly the
 * *** manifest-granted set before the process ever starts, composing
 * *** `orchestrator/spawn-env.ts`'s R5-02 allowlist seam over the NARROWER
 * *** `HOOK_ENV_BASE_ALLOWLIST` — a hook is untrusted third-party code, not
 * *** one of forge's own trusted agent children, so it never inherits
 * *** `AGENT_ENV_ALLOWLIST`'s `ANTHROPIC_API_KEY` by base allowlist alone;
 * *** see spawn-env.ts's own header for the confirmed-then-fixed
 * *** exfiltration defect this closes). The
 * *** declared-vs-referenced mismatch check (`detectUndeclaredEnvRefs`) is a
 * *** STATIC, pre-spawn text scan for `$VAR`/`${VAR}` references against the
 * *** manifest — it flags an under-declared manifest (the hook will likely
 * *** see the var missing and may misbehave), it does NOT and cannot detect
 * *** what the running process actually reads. Two different, independently
 * *** true properties; neither substitutes for the other.
 * ***
 * *** `env` is the ONE permission dimension that gets real prevention. `read`
 * *** and `network` do NOT — 2026-08-04 finding, stated here rather than left
 * *** to be inferred: `permissions.read`/`permissions.network` are declared,
 * *** and cross-checked by hook-scan.ts's pre-approval STATIC TEXT SCAN, but
 * *** nothing at spawn time actually restricts what the real `bash` process
 * *** can touch. A hook can read any file the OS user can read, and reach the
 * *** network via anything the scan's four literal patterns
 * *** (curl/wget/fetch(/nc/raw-socket) don't happen to match — bash's
 * *** `/dev/tcp/` redirection, `python3 -c`, `ssh`, `dig` for DNS exfil, and
 * *** so on. Real enforcement of either would mean an OS-level process
 * *** isolator (a restricted user/namespace/container/seccomp policy) — this
 * *** repo's standing rule (CLAUDE.md: "Never re-invent a job queue, worker
 * *** pool, resource controller, or process isolator") is not to hand-roll
 * *** one, so this boundary is drawn here deliberately, not left unenforced
 * *** by oversight.
 * ***
 * *** File WRITES are not modelled at all. `HookPermissionManifest` declares
 * *** `env`/`read`/`network` only — there is no `write` field, and F2's scan
 * *** names four categories (network-egress, env-read, file-read,
 * *** obfuscation), none of which look for a write/delete. A hook can write,
 * *** overwrite, or delete anything the OS user can, completely undeclared
 * *** and unscanned. A half-enforced write permission (declared but not
 * *** checked) would be worse than this — it would read as a promise this
 * *** module cannot keep — so it is left out entirely rather than added as a
 * *** field nothing verifies.
 *
 * `runHookScript`'s own gate is narrower than the library's
 * "has an operator approved this" state (`isHookRunnable`, hook-scan.ts): it
 * refuses to spawn only when the CURRENT scan verdict is `blocked` and no
 * override has been recorded — the hard security invariant this primitive
 * owns. A clean/findings-verdict hook may run without having gone through the
 * (separate, library/composition-time) explicit-approval bureaucracy, which a
 * higher orchestration layer enforces before ever reaching this primitive.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { HOOK_ENV_BASE_ALLOWLIST, buildChildEnv } from '../spawn-env.ts';
import type { EventLogger } from '../logging.ts';
import { hookDir, loadHookDefinition, type HookPermissionManifest } from './hook-library.ts';
import { extractEnvVarNames, hookRunState, scanHookPackage, type HookScanReport } from './hook-scan.ts';

// ---------------------------------------------------------------------------
// buildHookChildEnv — composes spawn-env.ts's buildChildEnv over the
// NARROWER HOOK_ENV_BASE_ALLOWLIST (never the full, credential-bearing
// AGENT_ENV_ALLOWLIST — see spawn-env.ts's header and the module header
// above). Never a second hand-rolled env filter (the repo's standing
// env-leak lesson): the base is pre-filtered down to HOOK_ENV_BASE_ALLOWLIST
// before ever reaching buildChildEnv, so buildChildEnv's own internal
// AGENT_ENV_ALLOWLIST re-filter is a no-op copy of an already-narrow set,
// not a second, divergent filter.
// ---------------------------------------------------------------------------

export function buildHookChildEnv(parentEnv: NodeJS.ProcessEnv, permissions: HookPermissionManifest): NodeJS.ProcessEnv {
  const hookBaseEnv: NodeJS.ProcessEnv = {};
  for (const name of HOOK_ENV_BASE_ALLOWLIST) {
    const value = parentEnv[name];
    if (value !== undefined) hookBaseEnv[name] = value;
  }
  const overrides: NodeJS.ProcessEnv = {};
  for (const name of permissions.env) {
    const value = parentEnv[name];
    if (value !== undefined) overrides[name] = value;
  }
  return buildChildEnv(hookBaseEnv, overrides);
}

// ---------------------------------------------------------------------------
// detectUndeclaredEnvRefs — static, pre-spawn scan. Base-allowlisted names
// (PATH/HOME/...) are excluded: those reach the child unconditionally
// regardless of the manifest, so flagging them as "undeclared" would be a
// fabricated mismatch, not a real one. Excludes HOOK_ENV_BASE_ALLOWLIST, NOT
// AGENT_ENV_ALLOWLIST — the latter's ANTHROPIC_API_KEY is unconditionally
// present for a trusted agent child but NOT for a hook, so excluding it here
// would silently report "no mismatch" for a script that references it
// without declaring it, while the real child actually gets an empty value.
// ---------------------------------------------------------------------------

export function detectUndeclaredEnvRefs(scriptBody: string, permissions: HookPermissionManifest): string[] {
  const declared = new Set(permissions.env);
  const alwaysPresent = new Set<string>(HOOK_ENV_BASE_ALLOWLIST);
  return extractEnvVarNames(scriptBody).filter((name) => !declared.has(name) && !alwaysPresent.has(name));
}

// ---------------------------------------------------------------------------
// runHookScript — real spawn, real stdio capture, bounded cwd + timeout.
// ---------------------------------------------------------------------------

export interface RunHookScriptInput {
  forgeRoot: string;
  id: string;
  logger: EventLogger;
  initiativeId: string;
  /** Defaults to `process.env` — pure/testable per D-K (never mutates it). */
  parentEnv?: NodeJS.ProcessEnv;
}

export interface HookRunResult {
  hookId: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  undeclaredEnvRefs: string[];
}

/** Bounded wall-clock budget for a single hook invocation. */
const HOOK_SPAWN_TIMEOUT_MS = 30_000;

export function runHookScript(input: RunHookScriptInput): HookRunResult {
  const { forgeRoot, id, logger, initiativeId, parentEnv = process.env } = input;

  const state = hookRunState(forgeRoot, id);
  if (state.verdict === 'blocked' && !state.runnable) {
    throw new Error(
      `runHookScript: hook "${id}" scan verdict is "blocked" and no override has been recorded — refusing to spawn (see overrideHookBlock)`,
    );
  }

  const def = loadHookDefinition(id, forgeRoot);
  const dir = hookDir(id, forgeRoot);
  const scriptPath = join(dir, def.script);
  const scriptBody = readFileSync(scriptPath, 'utf8');

  // Emitted unconditionally (CLAUDE.md: "emit structured events on every
  // invocation") — the mismatch event below is CONDITIONAL, so a hook run
  // with nothing to report must still leave a real trace in the log.
  logger.emit({
    phase: 'orchestrator',
    skill: `hook:${id}`,
    event_type: 'start',
    initiative_id: initiativeId,
    input_refs: [],
    output_refs: [],
    message: `Running hook "${id}" (${def.on})`,
  });

  const undeclaredEnvRefs = detectUndeclaredEnvRefs(scriptBody, def.permissions);
  if (undeclaredEnvRefs.length > 0) {
    logger.emit({
      phase: 'orchestrator',
      skill: `hook:${id}`,
      event_type: 'error',
      initiative_id: initiativeId,
      input_refs: [],
      output_refs: [],
      message: `Hook "${id}" references env var(s) not declared in its permission manifest: ${undeclaredEnvRefs.join(', ')}`,
      metadata: { kind: 'hook-permission-mismatch', hookId: id, undeclaredRefs: undeclaredEnvRefs },
    });
  }

  const childEnv = buildHookChildEnv(parentEnv, def.permissions);
  const start = Date.now();
  const result = spawnSync('bash', [scriptPath], {
    env: childEnv,
    cwd: dir,
    timeout: HOOK_SPAWN_TIMEOUT_MS,
    encoding: 'utf8',
  });
  const durationMs = Date.now() - start;

  if (result.error) {
    throw new Error(`runHookScript: failed to spawn hook "${id}" — ${result.error.message}`);
  }

  logger.emit({
    phase: 'orchestrator',
    skill: `hook:${id}`,
    event_type: 'end',
    initiative_id: initiativeId,
    input_refs: [],
    output_refs: [],
    duration_ms: durationMs,
    message: `Hook "${id}" finished (exit ${result.status})`,
  });

  return {
    hookId: id,
    exitCode: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    durationMs,
    undeclaredEnvRefs,
  };
}

// ---------------------------------------------------------------------------
// buildHookApprovalGateView — data-level only (no UI this round).
// ---------------------------------------------------------------------------

export function buildHookApprovalGateView(
  forgeRoot: string,
  id: string,
): { permissions: HookPermissionManifest; scan: HookScanReport } {
  const def = loadHookDefinition(id, forgeRoot);
  const scan = scanHookPackage(forgeRoot, id);
  return { permissions: def.permissions, scan };
}
