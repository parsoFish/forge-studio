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
 * *** `AGENT_ENV_ALLOWLIST`'s `ANTHROPIC_API_KEY` by base allowlist alone —
 * *** and, since W8-B6 FIX-1, cannot obtain it by DECLARING it either: every
 * *** `HOOK_ENV_CREDENTIAL_EXCLUSIONS` name is refused on the overrides layer
 * *** too, and the refusal is emitted as a `hook-env-grant-refused` event
 * *** rather than silently dropped; see spawn-env.ts's own header for the
 * *** confirmed-then-fixed exfiltration defect this closes). The
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
 * *** network via anything the scan's egress patterns don't happen to match.
 * *** W8-B6 widened that list — the shapes this block used to name as the
 * *** live examples (bash's `/dev/tcp/` redirection, `python3 -c`, `ssh`,
 * *** `dig`) are all detected now — but a widened enumeration is still an
 * *** enumeration, so the LIMIT is unchanged: only the known holes are.
 * *** Real enforcement of either would mean an OS-level process
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
 * `runHookScript` refuses to spawn anything that is not GENUINELY RUNNABLE —
 * `hookRunState(...).runnable`, i.e. approved, with the approval still covering
 * the current script, permissions and trigger hashes.
 *
 * A refusal, a spawn failure and a TIMEOUT are three different outcomes, and
 * since W8-B6 FIX-3 they are reported as three. `runHookScript` throws a
 * `HookRunError` carrying a typed `reason`
 * (`'not-runnable' | 'timeout' | 'spawn-failed'`), so a caller distinguishes
 * "the approval gate said no" from "the operator's script hung and, because
 * this spawn is synchronous, stalled the daemon for the whole budget" —
 * without string-matching a message. Both used to surface as "refused or
 * failed to spawn", which is prose that answers neither question.
 *
 * It did not always. The gate used to read `verdict === 'blocked' && !runnable`,
 * so `runnable`/`needsReview` were consulted ONLY for an already-blocked hook,
 * and anything scoring clean or findings ran without ever having been approved.
 * That was justified at the time by "a higher orchestration layer enforces
 * approval before reaching this primitive" — there is no such layer, and
 * adversarial review reproduced it by running a hook with no ledger entry at
 * all, which exfiltrated a planted key. The lesson worth keeping: a gate that
 * defers to a caller which does not exist is not a gate.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { HOOK_ENV_BASE_ALLOWLIST, HOOK_ENV_CREDENTIAL_EXCLUSIONS, buildChildEnv } from '@forge/agents/spawn-env.ts';
import type { EventLogger } from '@forge/kernel';
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
//
// W8-B6 FIX-1 (2026-08-24, hostile review of the FIRST production caller of
// runHookScript, proven end-to-end with a real spawned child): the credential
// fence is a TWO-LAYER composition and was enforced on only ONE of them.
// `HOOK_ENV_BASE_ALLOWLIST` correctly subtracts
// `HOOK_ENV_CREDENTIAL_EXCLUSIONS` from the BASE — but this function then read
// every `permissions.env` name straight out of the real, unfiltered
// `parentEnv` into `overrides`, and `buildChildEnv` applies overrides
// UNCONDITIONALLY by design (its own doc: "they always win, even for a key
// outside the allowlist", justified because overrides are forge's OWN
// composition and never ambient — an assumption a third-party hook manifest
// breaks). Net effect: the exclusion held for a manifest that stayed quiet and
// was bypassed by a manifest that simply asked. A reviewer's probe printed the
// real `ANTHROPIC_API_KEY` value from the child.
//
// The exclusion set is now the source of truth for BOTH consumers: the base
// derivation in spawn-env.ts AND the overrides layer here.
//
// The refusal is REPORTED, never silently dropped — that is why this returns
// `{env, refusedEnvGrants}` rather than exposing a second "what would be
// refused?" helper beside it. A caller cannot obtain the child env without
// also holding the refusal list, so a future call site cannot forget to
// surface it; `runHookScript` turns it into a structured JSONL event. Two
// parallel functions over one rule would be exactly the drift shape this
// repo's standing lesson (a check must mirror the thing it backstops) warns
// about.
//
// NOT closed here, deliberately, and closed one gate earlier instead:
// `GH_TOKEN` (and every other secret-shaped grant that is not a member of the
// exclusion set). `hook-scan.ts` flags a `GH_`-prefixed name as secret-shaped,
// and `computeVerdict` now blocks on any critical finding on its own — so such
// a grant costs an explicit, reasoned `overrideHookBlock` rather than being
// forbidden outright. A hook that genuinely needs a GitHub token is a real
// thing an operator may knowingly authorise; a hook that silently receives
// forge's own API credential is not.
//
// HONEST NOTE on the interaction with `detectUndeclaredEnvRefs` below: a
// script that REFERENCES `$ANTHROPIC_API_KEY` and also DECLARES it is not
// reported by that check (it is declared), yet the child receives nothing.
// That case is covered by the refusal event instead — the operator is told,
// just through the other channel. `detectUndeclaredEnvRefs` is deliberately
// left alone: its subject is manifest-vs-body coherence, not the fence.
// ---------------------------------------------------------------------------

export function buildHookChildEnv(
  parentEnv: NodeJS.ProcessEnv,
  permissions: HookPermissionManifest,
): { env: NodeJS.ProcessEnv; refusedEnvGrants: string[] } {
  const hookBaseEnv: NodeJS.ProcessEnv = {};
  for (const name of HOOK_ENV_BASE_ALLOWLIST) {
    const value = parentEnv[name];
    if (value !== undefined) hookBaseEnv[name] = value;
  }
  const overrides: NodeJS.ProcessEnv = {};
  const refusedEnvGrants: string[] = [];
  for (const name of permissions.env) {
    // Refused on POLICY, before `parentEnv` is even consulted: an operator
    // must learn their manifest asked for something it can never have,
    // whether or not the var happens to be set on this host.
    if (HOOK_ENV_CREDENTIAL_EXCLUSIONS.has(name)) {
      if (!refusedEnvGrants.includes(name)) refusedEnvGrants.push(name);
      continue;
    }
    const value = parentEnv[name];
    if (value !== undefined) overrides[name] = value;
  }
  return { env: buildChildEnv(hookBaseEnv, overrides), refusedEnvGrants };
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

export type HookRunFailureReason = 'not-runnable' | 'timeout' | 'spawn-failed';

export class HookRunError extends Error {
  readonly reason: HookRunFailureReason;
  constructor(reason: HookRunFailureReason, message: string) {
    super(message);
    this.name = 'HookRunError';
    this.reason = reason;
  }
}

export interface RunHookScriptInput {
  forgeRoot: string;
  id: string;
  logger: EventLogger;
  initiativeId: string;
  /** Defaults to `process.env` — pure/testable per D-K (never mutates it). */
  parentEnv?: NodeJS.ProcessEnv;
  /**
   * Wall-clock budget for this one invocation, defaulting to
   * `HOOK_SPAWN_TIMEOUT_MS` (30s). Additive and optional: no production caller
   * passes it — `hook-dispatch.ts` deliberately calls `runHookScript`
   * unmodified, so every dispatched hook gets the standard budget — and it
   * exists so the timeout path can be exercised in milliseconds rather than
   * making a test suite wait 30 seconds to prove one branch.
   */
  timeoutMs?: number;
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
  const { forgeRoot, id, logger, initiativeId, parentEnv = process.env, timeoutMs = HOOK_SPAWN_TIMEOUT_MS } = input;

  // BLOCKER 1 (2026-08-04, third adversarial review, FIX-FIRST): the gate
  // used to be `verdict === 'blocked' && !runnable`, which only ever
  // consulted `runnable`/`needsReview` for a blocked verdict — a clean or
  // findings-verdict hook with NO approval ledger entry at all still spawned,
  // because the condition was false for any other verdict. Deny-by-default
  // approval must hold for every verdict, not only the one that already had
  // a separate hard stop: refuse unless the hook is genuinely runnable
  // (approved, hash-current, and — for a blocked verdict specifically —
  // explicitly overridden). `hookRunState`'s own `runnable` computation
  // already encodes exactly that; consult it directly rather than
  // re-deriving a narrower rule here.
  //
  // W8-F2 (2026-08-28 adversarial review, reproduced): `hookRunState` can now
  // THROW rather than return — `readHookPackage` fails closed on a package
  // holding a non-regular entry (a planted symlink) or breaching the size caps.
  // The hook correctly did not fire in that case, but the raw error propagated
  // uncaught, so `describeHookRunFailure` (hook-dispatch.ts) — which switches on
  // `instanceof HookRunError` — reported "failed for an unrecognised reason"
  // instead of "was refused by the approval gate". Same refusal, same
  // deny-by-default outcome; this only gives it its typed reason back, so an
  // operator reading the dispatch log sees a gate decision rather than a
  // mystery. The underlying message is preserved as the cause.
  let state;
  try {
    state = hookRunState(forgeRoot, id);
  } catch (err) {
    throw new HookRunError(
      'not-runnable',
      `runHookScript: hook "${id}" could not be evaluated for runnability — refusing to spawn: ${(err as Error).message}`,
    );
  }
  if (!state.runnable) {
    throw new HookRunError(
      'not-runnable',
      `runHookScript: hook "${id}" is not runnable (verdict "${state.verdict}", needsReview: ${state.needsReview}) — refusing to spawn until it is approved (see approveHook/overrideHookBlock)`,
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

  const { env: childEnv, refusedEnvGrants } = buildHookChildEnv(parentEnv, def.permissions);
  if (refusedEnvGrants.length > 0) {
    logger.emit({
      phase: 'orchestrator',
      skill: `hook:${id}`,
      event_type: 'error',
      initiative_id: initiativeId,
      input_refs: [],
      output_refs: [],
      message: `Hook "${id}" declares credential-fenced env var(s) that are REFUSED regardless of the manifest: ${refusedEnvGrants.join(', ')} — the child receives none of them`,
      metadata: { kind: 'hook-env-grant-refused', hookId: id, refusedEnvGrants },
    });
  }

  const start = Date.now();
  const result = spawnSync('bash', [scriptPath], {
    env: childEnv,
    cwd: dir,
    timeout: timeoutMs,
    encoding: 'utf8',
  });
  const durationMs = Date.now() - start;

  if (result.error) {
    // W8-B6 FIX-3: spawnSync reports an exceeded `timeout` as an ordinary
    // `result.error` — same field a genuine spawn failure (ENOENT, EACCES)
    // arrives in — so both used to be thrown as "failed to spawn". They are
    // opposite problems with opposite fixes: one means the operator's hook
    // package is broken, the other means their script hung and, because the
    // spawn is synchronous, stalled the daemon for the whole budget. The
    // discriminator is `code`, and the reason travels as a TYPED field rather
    // than as words in a message a caller would have to re-parse.
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === 'ETIMEDOUT') {
      throw new HookRunError(
        'timeout',
        `runHookScript: hook "${id}" exceeded its ${timeoutMs}ms wall-clock budget and was killed — it did not refuse to run, it ran too long (${result.error.message})`,
      );
    }
    throw new HookRunError('spawn-failed', `runHookScript: failed to spawn hook "${id}" — ${result.error.message}`);
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
