/**
 * Hook execution runtime (R3-03-F3) — deny-by-default env stripping +
 * bounded, timed spawn.
 *
 * *** HONEST LIMITS, STATED UP FRONT (not left to be inferred):
 * ***
 * *** ENV: this module does NOT observe or intercept a hook's actual env
 * *** reads at runtime. Safety is PREVENTION — the child env is stripped to
 * *** exactly the manifest-granted set before the process ever starts,
 * *** composing `spawn-env.ts`'s R5-02 allowlist seam over the NARROWER
 * *** `HOOK_ENV_BASE_ALLOWLIST` (a hook is untrusted third-party code, so it
 * *** never inherits `AGENT_ENV_ALLOWLIST`'s `ANTHROPIC_API_KEY` by base
 * *** allowlist, and since W8-B6 FIX-1 cannot obtain it by DECLARING it
 * *** either — every `HOOK_ENV_CREDENTIAL_EXCLUSIONS` name is refused on the
 * *** overrides layer too, reported as a `hook-env-grant-refused` event,
 * *** never silently dropped; see `spawn-env.ts`'s header for the
 * *** confirmed-then-fixed exfiltration defect this closes). The
 * *** declared-vs-referenced check (`detectUndeclaredEnvRefs`) is a STATIC,
 * *** pre-spawn text scan for `$VAR`/`${VAR}` references against the
 * *** manifest — it flags an under-declared manifest, it does NOT and cannot
 * *** detect what the running process actually reads. Two different,
 * *** independently true properties; neither substitutes for the other.
 * ***
 * *** `env` is the ONE permission dimension that gets real prevention. `read`
 * *** and `network` do NOT (2026-08-04 finding): both are declared and
 * *** cross-checked by `hook-scan.ts`'s pre-approval STATIC TEXT SCAN, but
 * *** nothing at spawn time restricts what the real `bash` process can
 * *** touch — it can read any file the OS user can and reach the network via
 * *** anything the scan's egress patterns don't match. W8-B6 widened that
 * *** scan (bash's `/dev/tcp/`, `python3 -c`, `ssh`, `dig` are all detected
 * *** now), but a widened enumeration is still an enumeration: only the known
 * *** holes are closed. Real enforcement needs an OS-level process isolator
 * *** — this repo's standing rule (CLAUDE.md: "never re-invent a job queue,
 * *** worker pool, resource controller, or process isolator") is not to
 * *** hand-roll one, so this boundary is drawn deliberately, not by oversight.
 * ***
 * *** File WRITES are not modelled at all. `HookPermissionManifest` declares
 * *** `env`/`read`/`network` only, and F2's scan checks network-egress,
 * *** env-read, file-read and obfuscation — none of which is a write. A hook
 * *** can write, overwrite or delete anything the OS user can, completely
 * *** undeclared and unscanned. A half-enforced write permission would read
 * *** as a promise this module cannot keep, so it is left out entirely
 * *** rather than added as a field nothing verifies.
 * ***
 * *** PROCESS-GROUP CLEANUP IS ASYMMETRIC (forge-9a3 follow-up): the async
 * *** tail SIGKILLs the whole group on timeout/overflow so a grandchild dies
 * *** with it (`spawnBashAsync`'s `killGroup`); the sync tail's `spawnSync`
 * *** signals only the child's own pid, so a timed-out sync hook can still
 * *** leak one — left unchanged on purpose.
 *
 * `runHookScript` (sync) and `runHookScriptAsync` (async, forge-9a3) share
 * one gate (`prepareHookRun`) and refuse to spawn anything that is not
 * GENUINELY RUNNABLE — `hookRunState(...).runnable`, i.e. approved, with the
 * approval still covering the current script, permissions and trigger hashes.
 *
 * A refusal, a spawn failure and a TIMEOUT are three outcomes, mapped once
 * (for either tail) in `finalizeHookOutcome` into a `HookRunError` with a
 * typed `reason` (`'not-runnable' | 'timeout' | 'spawn-failed'`), so a
 * caller distinguishes a gate refusal from a script that hung and stalled
 * its caller for the whole budget — without string-matching a message.
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

import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { HOOK_ENV_BASE_ALLOWLIST, HOOK_ENV_CREDENTIAL_EXCLUSIONS, buildChildEnv } from '@forge/kernel/spawn-env.ts';
import type { EventLogger } from '@forge/kernel';
import { hookDir, loadHookDefinition, type HookDefinition, type HookPermissionManifest } from './hook-library.ts';
import { extractEnvVarNames, scanHookPackage, type HookScanReport } from './hook-scan.ts';
import { hookRunState, readHookApprovalLedger } from './hook-approval-ledger.ts';
import { readHookPackage, hashHookPackage, canonicalHookYamlBody, normalizeHookEntryPath, type HookPackageFile } from './hook-package.ts';

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

// Copies EVERY verified file into a private, read-only tree, preserving the
// package's own relative layout — M7-C PKG (forge-8vfn.8.3.6); design.md
// "Hook exec". Not just the entry script: a sibling a hook `source`s via
// `$(dirname "$0")/lib.sh` must resolve inside this pinned copy too, or it is
// read live from the mutable original for the whole run (the bug this fix
// closes). No symlink can appear in `files` — `readHookPackage`'s own walk
// already refuses any non-regular-file/non-directory dirent — so every write
// below is a genuine regular file, never a recreated link.
function writePrivatePackageCopy(files: readonly HookPackageFile[], entryRelPath: string): PrivatePackageCopy {
  const root = mkdtempSync(join(tmpdir(), 'forge-hook-verified-'));
  chmodSync(root, 0o700);
  try {
    const madeDirs = new Set<string>();
    for (const file of files) {
      const relDir = dirname(file.path);
      if (relDir !== '.') {
        let cur = root;
        for (const seg of relDir.split('/')) {
          cur = join(cur, seg);
          if (!madeDirs.has(cur)) {
            mkdirSync(cur, { recursive: true });
            chmodSync(cur, 0o700);
            madeDirs.add(cur);
          }
        }
      }
      // `wx` = O_CREAT|O_EXCL, same immutability argument as the single-file
      // predecessor: the file cannot be written through, including by this
      // same process, the instant the write returns. Mode mirrors the
      // package's OWN recorded executable bit (also part of `hashHookPackage`'s
      // fingerprint input) rather than a fixed mode for every file.
      writeFileSync(join(root, file.path), file.body, { mode: file.executable ? 0o500 : 0o400, flag: 'wx' });
    }
  } catch (err) {
    rmSync(root, { recursive: true, force: true });
    throw err;
  }
  return { dir: root, entryPath: join(root, normalizeHookEntryPath(entryRelPath)) };
}

/** Called from a `finally` in both tails; never throws (would mask a real
 *  result) — a cleanup failure is its own logged event instead. */
function cleanupPrivateScriptDir(dir: string, id: string, logger: EventLogger, initiativeId: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    logger.emit({
      phase: 'orchestrator',
      skill: `hook:${id}`,
      event_type: 'error',
      initiative_id: initiativeId,
      input_refs: [],
      output_refs: [],
      message: `Hook "${id}"'s private verified-script directory "${dir}" could not be removed after the run — ${(err as Error).message}`,
      metadata: { kind: 'hook-private-script-cleanup-failed', hookId: id, dir },
    });
  }
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
   * Wall-clock budget for this invocation, defaulting to
   * `HOOK_SPAWN_TIMEOUT_MS` (30s) — optional, so a test can exercise the
   * timeout path in milliseconds rather than waiting 30 real seconds.
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

/** Bound on captured stdout/stderr for the async tail, matching `spawnSync`'s
 *  documented `maxBuffer` default (confirmed empirically, not assumed). */
const HOOK_SPAWN_MAX_BUFFER_BYTES = 1024 * 1024;

// prepareHookRun — the ONE shared gate + env fence + pre-spawn logging step
// (forge-9a3); `runHookScript`/`runHookScriptAsync` are thin tails differing
// only in HOW they spawn `bash`.

/** `dir` is what `cleanupPrivateScriptDir` removes (the whole temp tree);
 *  `entryPath` is the private copy's own entry script, what either tail
 *  actually execs — M7-C PKG (forge-8vfn.8.3.6). */
interface PrivatePackageCopy {
  dir: string;
  entryPath: string;
}

interface PreparedHookRun {
  def: HookDefinition;
  /** The REAL hook package directory — still the child's `cwd` (unchanged by
   *  this fix; only the EXEC target and its siblings are pinned). */
  dir: string;
  childEnv: NodeJS.ProcessEnv;
  undeclaredEnvRefs: string[];
  /** The pinned copy either tail execs — callers must clean up `.dir`. */
  privatePackage: PrivatePackageCopy;
}

function prepareHookRun(input: { forgeRoot: string; id: string; logger: EventLogger; initiativeId: string; parentEnv: NodeJS.ProcessEnv }): PreparedHookRun {
  const { forgeRoot, id, logger, initiativeId, parentEnv } = input;

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

  // Re-read the WHOLE package HERE — not the entry script alone, and not
  // reusing the gate's own read inside hookRunState — so a swap after the
  // gate's check has no window over ANY file in the package, not only the
  // entry script (M7-C PKG, forge-8vfn.8.3.6; design.md "Hook exec").
  // `readHookPackage`'s own guardedFile walk realpaths and identity-checks
  // every leaf, so a symlink swap on the entry OR a sibling is refused here
  // exactly as the single-file `resolveHookScriptPath` re-check refused it
  // for the entry alone before this fix.
  let files: HookPackageFile[];
  try {
    files = readHookPackage(forgeRoot, id);
  } catch (err) {
    throw new HookRunError(
      'not-runnable',
      `runHookScript: hook "${id}"'s package could not be re-read for verification — refusing to spawn: ${(err as Error).message}`,
    );
  }

  // Re-hash THIS read's WHOLE package and compare to the ledger's stored
  // packageHash — closes the gate-to-here TOCTOU window for every file, not
  // only the entry script (M7-C PKG, forge-8vfn.8.3.6; design.md "Hook
  // exec"). `packageHash` strictly subsumes the entry-only `scriptHash` check
  // this replaces (hook-package.ts's `hashHookPackage` doc), so a second,
  // narrower re-check would be redundant, not additional safety. Canonicalized
  // identically to the ledger's own `snapshotHookPackage` (only hook.yaml's
  // body — see `canonicalHookYamlBody`) so a cosmetic hook.yaml reorder is not
  // mistaken for a real edit here either.
  const approvedPackageHash = readHookApprovalLedger(forgeRoot).get(id)?.packageHash;
  const filesForPackageHash = files.map((f) => (f.path === 'hook.yaml' ? { ...f, body: canonicalHookYamlBody(f.body) } : f));
  const livePackageHash = hashHookPackage(filesForPackageHash);
  if (livePackageHash !== approvedPackageHash) {
    throw new HookRunError(
      'not-runnable',
      `runHookScript: hook "${id}"'s package content changed between the approval gate's check and this read (fingerprint mismatch: expected ${approvedPackageHash ?? '(no approval on record)'}, read ${livePackageHash}) — refusing to spawn a package that was never approved`,
    );
  }

  const entryFile = files.find((f) => normalizeHookEntryPath(f.path) === normalizeHookEntryPath(def.script));
  if (!entryFile) {
    throw new HookRunError(
      'not-runnable',
      `runHookScript: hook "${id}" declares script "${def.script}" but no such file exists in its package — refusing to spawn`,
    );
  }
  const scriptBody = entryFile.body;

  // Closes the window PAST this read — copies EVERY verified file (not only
  // the entry) into a private tree so a sibling sourced via
  // `$(dirname "$0")/lib.sh` resolves against pinned bytes for the whole run —
  // see writePrivatePackageCopy.
  const privatePackage = writePrivatePackageCopy(files, def.script);

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

  return { def, dir, childEnv, undeclaredEnvRefs, privatePackage };
}

/** The shape both spawn tails reduce their real child-process result to,
 *  before handing it to the ONE outcome mapper below. */
interface HookSpawnOutcome {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: NodeJS.ErrnoException;
}

// finalizeHookOutcome — the ONE place a raw spawn result becomes a thrown
// HookRunError or returned HookRunResult; shared by both tails (forge-9a3).
function finalizeHookOutcome(id: string, timeoutMs: number, durationMs: number, outcome: HookSpawnOutcome, undeclaredEnvRefs: string[], logger: EventLogger, initiativeId: string): HookRunResult {
  if (outcome.error) {
    const code = outcome.error.code;
    if (code === 'ETIMEDOUT') {
      throw new HookRunError(
        'timeout',
        `runHookScript: hook "${id}" exceeded its ${timeoutMs}ms wall-clock budget and was killed — it did not refuse to run, it ran too long (${outcome.error.message})`,
      );
    }
    throw new HookRunError('spawn-failed', `runHookScript: failed to spawn hook "${id}" — ${outcome.error.message}`);
  }

  logger.emit({
    phase: 'orchestrator',
    skill: `hook:${id}`,
    event_type: 'end',
    initiative_id: initiativeId,
    input_refs: [],
    output_refs: [],
    duration_ms: durationMs,
    message: `Hook "${id}" finished (exit ${outcome.status})`,
  });

  return {
    hookId: id,
    exitCode: outcome.status,
    stdout: outcome.stdout,
    stderr: outcome.stderr,
    durationMs,
    undeclaredEnvRefs,
  };
}

// Both tails exec `prepared.privatePackage.entryPath` directly — `bash
// <path>` sets $0 to the argv path it is given, so `$(dirname "$0")`
// resolves INSIDE the pinned copy (every sibling was copied alongside it)
// rather than the mutable original directory. No `-c`, no `source`, no env-
// var indirection: those existed only to fake $0 back to the real path for a
// copy that held the entry script alone — M7-C PKG (forge-8vfn.8.3.6);
// design.md "Hook exec". Stdin stays untouched exactly as before (a plain
// `bash <path>` reads the script from that file, never from stdin).

// Tail 1 — SYNCHRONOUS.
export function runHookScript(input: RunHookScriptInput): HookRunResult {
  const { forgeRoot, id, logger, initiativeId, parentEnv = process.env, timeoutMs = HOOK_SPAWN_TIMEOUT_MS } = input;
  const prepared = prepareHookRun({ forgeRoot, id, logger, initiativeId, parentEnv });

  try {
    const start = performance.now(); // monotonic: Date.now() steps back here (forge-8vfn.7.6.50)
    const result = spawnSync('bash', [prepared.privatePackage.entryPath], {
      env: prepared.childEnv,
      cwd: prepared.dir,
      timeout: timeoutMs,
      encoding: 'utf8',
    });
    const durationMs = Math.round(performance.now() - start);
    const outcome = { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error as NodeJS.ErrnoException | undefined };
    return finalizeHookOutcome(id, timeoutMs, durationMs, outcome, prepared.undeclaredEnvRefs, logger, initiativeId);
  } finally {
    // Every exit path — see cleanupPrivateScriptDir's doc comment.
    cleanupPrivateScriptDir(prepared.privatePackage.dir, id, logger, initiativeId);
  }
}

// spawnBashAsync — async spawn wrapper: manual timeout + manual BOUNDED
// capture, reduced to the same HookSpawnOutcome shape as spawnSync's result.

function spawnBashAsync(execArgs: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<HookSpawnOutcome> {
  return new Promise((resolve) => {
    // `detached: true` makes `bash` the leader of its own process group (pid
    // === pgid) so a group-targeted signal reaches every descendant too.
    // Same exec scheme as the sync tail above — stdin is not touched here
    // either.
    const child = spawn('bash', execArgs, { env, cwd, detached: true });
    const buf = { stdout: '', stderr: '' };
    let overflowed = false;
    let timedOut = false;
    let settled = false;

    // killGroup — kills the whole process GROUP, not just bash's own pid: a
    // script's grandchild (e.g. `sleep 30 &`) survives a single-pid kill,
    // reparented and orphaned, still holding bash's stdio pipes open
    // (forge-9a3 follow-up, proven empirically). ESRCH means the group is
    // already gone (a natural exit racing the timer) — expected, not an error.
    const killGroup = (): void => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ESRCH') throw err;
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, timeoutMs);

    const settle = (status: number | null, error?: NodeJS.ErrnoException): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status, stdout: buf.stdout, stderr: buf.stderr, error });
    };

    // Appends up to HOOK_SPAWN_MAX_BUFFER_BYTES total, then kills the group.
    const onData = (key: 'stdout' | 'stderr') => (chunk: Buffer) => {
      if (overflowed) return;
      const next = buf[key] + chunk.toString('utf8');
      buf[key] = next.length > HOOK_SPAWN_MAX_BUFFER_BYTES ? next.slice(0, HOOK_SPAWN_MAX_BUFFER_BYTES) : next;
      if (next.length > HOOK_SPAWN_MAX_BUFFER_BYTES) {
        overflowed = true;
        killGroup();
      }
    };
    child.stdout?.on('data', onData('stdout'));
    child.stderr?.on('data', onData('stderr'));

    child.on('error', (err) => settle(null, err as NodeJS.ErrnoException));

    // Timeout/overflow settle on `exit`, not `close` — DELIBERATELY: `exit`
    // fires the instant bash's own pid terminates, independent of whether
    // every descendant's pipe has finished closing, so a caller awaiting the
    // timeout gets a prompt answer regardless of how long an orphan unwinds.
    child.on('exit', (code) => {
      if (timedOut) settle(code, Object.assign(new Error('spawn bash ETIMEDOUT'), { code: 'ETIMEDOUT' }) as NodeJS.ErrnoException);
      else if (overflowed) settle(code, Object.assign(new Error('spawn bash ENOBUFS'), { code: 'ENOBUFS' }) as NodeJS.ErrnoException);
      // else: falls through to `close`, so capture reflects everything written.
    });

    child.on('close', (code) => settle(code));
  });
}

// Tail 2 — ASYNC; hook-dispatch.ts awaits this, not the sync tail.

export async function runHookScriptAsync(input: RunHookScriptInput): Promise<HookRunResult> {
  const { forgeRoot, id, logger, initiativeId, parentEnv = process.env, timeoutMs = HOOK_SPAWN_TIMEOUT_MS } = input;
  const prepared = prepareHookRun({ forgeRoot, id, logger, initiativeId, parentEnv });

  try {
    const start = performance.now(); // monotonic: Date.now() steps back here (forge-8vfn.7.6.50)
    const outcome = await spawnBashAsync([prepared.privatePackage.entryPath], prepared.dir, prepared.childEnv, timeoutMs);
    const durationMs = Math.round(performance.now() - start);
    return finalizeHookOutcome(id, timeoutMs, durationMs, outcome, prepared.undeclaredEnvRefs, logger, initiativeId);
  } finally {
    cleanupPrivateScriptDir(prepared.privatePackage.dir, id, logger, initiativeId);
  }
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
