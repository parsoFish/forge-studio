/**
 * Hook DISPATCH (W8-B6 — beads `forge-6gv.15` / `forge-vvp`, regate
 * library-39): the seam that makes a bound, approved library hook actually
 * fire.
 *
 * Before this module, `composition.hooks` was the canonical
 * `declared-data-fails-open`: parsed (`registry.ts:203`), typed
 * (`types.ts:36`), surfaced as `carriedBy` (`hook-library.ts:261`) — and
 * enforced nowhere. `runHookScript` (`hook-runtime.ts:138`) had **zero**
 * production callers, and no `hooks` option reached any Agent SDK spawn.
 *
 * ## Why the spawn is the seam, and not a forge-side lifecycle callback
 *
 * All six `HOOK_LIFECYCLE_EVENTS` (`hook-library.ts:44`) are members of the
 * Claude Agent SDK's own `HOOK_EVENTS`, and the SDK accepts
 * `Options.hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>` — an
 * in-process map of async callbacks. So forge does not need (and must not
 * invent) a lifecycle-event bus: it hands the SDK a callback per bound hook,
 * and the callback spawns the hook script through the existing, already-gated
 * `runHookScript`.
 *
 * ## Nothing here relaxes the runtime's two guards
 *
 * `runHookScript` refuses to spawn anything that is not GENUINELY RUNNABLE
 * (approved, with the approval still covering the current script/permissions/
 * trigger bytes) and strips the child env down to the manifest-granted set
 * over the narrow `HOOK_ENV_BASE_ALLOWLIST`. Dispatch calls it **unmodified**,
 * passes **no** `parentEnv` override (so the child env is built from the real
 * `process.env` by the same narrow allowlist), and never pre-checks or caches
 * runnability. The gate is therefore re-evaluated from its source of truth on
 * every single fire — an approval revoked mid-run stops the very next fire.
 *
 * ## Derived, never stored
 *
 * The only thing captured when the options bag is built is the pair
 * `{hookId, event}` — the map shape the SDK needs up front. Everything that
 * decides whether a fire happens (`on`, `matcher`, approval state) is re-read
 * from disk inside the callback. There is no field anywhere that stores a
 * stale copy of a hook's trigger or its runnability.
 *
 * ## Matcher syntax: forge's, deliberately NOT the SDK's
 *
 * `HookCallbackMatcher.matcher` is a tool-NAME pattern. Forge's declared
 * `matcher` is the Claude Code permission-rule shape — the authoring form's
 * own placeholder is `Bash(gh pr create)`
 * (`apps/studio/app/hooks/new/page.tsx:109`) and the OOTB
 * `pre-pr-security-review` ships exactly that string. Handing it to the SDK
 * verbatim would produce a hook that is bound, displayed as carried, and can
 * never match — the same defect this module exists to close, in a new field.
 * So the SDK-side matcher is left ABSENT and the declared matcher is enforced
 * here, in forge's own syntax, inside the callback:
 *
 *   - absent/empty          → every occurrence of the event
 *   - `Tool`                → tool name equals `Tool`
 *   - `Tool(prefix)`        → tool name equals `Tool` AND the call's
 *                             `tool_input.command` starts with `prefix`
 *   - anything else         → MALFORMED: never fires, and is reported once
 *                             when the options bag is built (W8-B6 FIX-2)
 *
 * A matcher declared on an event that carries no tool (SessionEnd, …) cannot
 * be honoured, so it does not fire — and `lintHookDefinitions` flags it, so
 * the operator is told rather than left with a silent no-op.
 *
 * The MALFORMED state is its own outcome and not a synonym for "absent"
 * (W8-B6 FIX-2, 2026-08-24 hostile review). A typo like `Bash(gh pr create`
 * used to fall through to "the whole string is a tool name", which no real
 * tool is ever called — so the hook was authored, scanned, approved, rendered
 * as `carriedBy` an agent, and never fired, with NO log on any fire. It cannot
 * collapse into `absent` either: absent means "fire always", so folding a typo
 * into it would hand a broken guard a veto over every tool call. All five
 * write paths now refuse the shape at `hook-library.ts`'s `hookTriggerError`
 * (which reuses this module's own parse, rather than a second copy of the
 * regex), and this module reports a package that predates that check exactly
 * once — not per fire, which for a `PostToolUse` binding would flood a real
 * cycle's event log with one identical error per tool call.
 *
 * ## Exit-code contract (Claude Code's, adopted rather than invented)
 *
 *   - `0`        → allow; the run continues.
 *   - `2`        → BLOCK. On `PreToolUse` this becomes a real
 *                  `permissionDecision: 'deny'` carrying the hook's stderr;
 *                  on any other event, `{continue: false, stopReason}`.
 *   - any other  → non-blocking error: recorded, run continues. A broken hook
 *                  must not wedge an operator's cycle.
 *   - refusal / spawn failure / timeout → recorded, run continues, and
 *                  recorded AS THREE DISTINCT THINGS (W8-B6 FIX-3): the event
 *                  carries `metadata.failure` of
 *                  `not-runnable` | `timeout` | `spawn-failed` and a message
 *                  that names which. "Refused or failed to spawn" answered
 *                  neither of an operator's two questions — did I forget to
 *                  approve it, or did my script hang and stall the daemon for
 *                  30 seconds? An unapproved hook still gains no power over
 *                  the run; that would hand an un-reviewed package a veto it
 *                  was never granted.
 *
 * ## HONEST LIMITS, stated rather than left to be inferred
 *
 * **1. The spawn is SYNCHRONOUS, so a firing hook blocks the event loop.**
 * `runHookScript` uses `spawnSync` with a 30s cap (`hook-runtime.ts:194`), and
 * this module calls it unmodified — deliberately, because splitting that
 * primitive would mean a second spawn path beside its approval gate and env
 * fence, and duplicating a security gate to gain responsiveness is the wrong
 * trade. The consequence is real and belongs stated here rather than
 * discovered: inside `forge serve`, a `PostToolUse` hook fires on every tool
 * call and stalls the daemon — scheduler and Studio bridge included — for the
 * hook's whole duration. A well-behaved hook returns in milliseconds; a slow
 * or hanging one makes the bridge look wedged for up to 30 seconds. No shipped
 * agent binds a hook today, so nothing currently pays this. Making the spawn
 * non-blocking means giving `hook-runtime.ts` an async tail that SHARES the one
 * approval gate rather than copying it; filed as its own piece of work.
 *
 * **2. Hook stdout is captured and logged but is NOT injected into the agent's
 * context (`hookSpecificOutput.additionalContext`). Doing so would route
 * third-party script output straight into a model prompt; that is a
 * prompt-injection surface that deserves its own review round, not a
 * free-rider on this one. Both OOTB hooks only print, and both say in their
 * own headers that they never block, so nothing shipped depends on it.
 *
 * **3. A matcher is a PREFIX TEST on the literal command string, not command
 * analysis.** `Bash(gh pr create)` fires for `gh pr create --draft`, and does
 * NOT fire for `sh -c 'gh pr create'`, ` gh pr create` (leading space),
 * `cd /x && gh pr create`, or `GH_TOKEN=… gh pr create`. That is the same
 * property Claude Code's own permission rules have, so forge is inheriting the
 * platform's semantics rather than inventing a weaker one — but it must be
 * said out loud now that a hook can BLOCK (exit 2), because an operator could
 * otherwise read a matcher as an airtight guard. **A hook is a customisation,
 * not a security boundary against a determined agent.** Both OOTB hooks are
 * advisory and say so in their own script headers.
 *
 * The `Tool(prefix)` form is read as a PREFIX rather than an exact match on
 * purpose: for a guard-shaped hook, firing on more commands than the operator
 * literally typed is the safe direction, and `Bash(gh pr create)` obviously
 * means "a gh-pr-create command", not "that exact string and no flags".
 *
 * **4. Dispatch is claude-side.** `loops/_adapters/gemini/index.ts` has no
 * equivalent hook mechanism, so a hook bound to an agent whose `runtime.sdk` is
 * non-claude does not fire. Nothing pretends otherwise: the bag is only ever
 * built into a claude options record.
 */

import { resolve } from 'node:path';

import type { EventLogger } from '../logging.ts';
import { FORGE_ROOT } from './derive.ts';
import { loadAgentDefinition } from './registry.ts';
import { loadHookDefinition, parseHookMatcher, type HookLifecycleEvent, type HookMatcherParse } from './hook-library.ts';
import { HookRunError, runHookScript, type HookRunFailureReason } from './hook-runtime.ts';

// ---------------------------------------------------------------------------
// Structural mirrors of the SDK's hook option types. Deliberately declared
// here rather than imported: `orchestrator/studio/` stays SDK-free (the
// package is imported as a value in exactly one file, `pinned-sdk-query.ts`,
// enforced by `pinned-sdk-query.enforce.test.ts`), and every spawn site in
// this repo already builds its options as a plain `Record<string, unknown>`.
// ---------------------------------------------------------------------------

export type HookDispatchInput = {
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: unknown;
  [key: string]: unknown;
};

export type HookDispatchOutput = {
  continue?: boolean;
  stopReason?: string;
  systemMessage?: string;
  hookSpecificOutput?: {
    hookEventName: 'PreToolUse';
    permissionDecision: 'deny';
    permissionDecisionReason: string;
  };
};

export type SdkHookCallback = (
  input: HookDispatchInput,
  toolUseID: string | undefined,
  options: { signal: AbortSignal },
) => Promise<HookDispatchOutput>;

export interface SdkHookMatcher {
  /** Always absent — see the module header's matcher section. */
  matcher?: string;
  hooks: SdkHookCallback[];
}

export type SdkHooksOption = Partial<Record<HookLifecycleEvent, SdkHookMatcher[]>>;

/** Exit code that BLOCKS, per Claude Code's hook contract. */
const HOOK_BLOCKING_EXIT_CODE = 2;

// ---------------------------------------------------------------------------
// Matcher — forge syntax, parsed and applied here.
// ---------------------------------------------------------------------------

// The PARSE lives in hook-library.ts, next to the definition it validates, so
// the five write paths' shape check (`hookTriggerError`) and this enforcement
// share one implementation rather than two copies of one regex. See that
// module for why the dependency points that way. Enforcement stays here.

/** Does this hook input satisfy the declared matcher?
 *
 *  - `absent`    ⇒ every occurrence of the event.
 *  - `malformed` ⇒ NEVER. A matcher that cannot equal a real tool name must
 *    not silently become "fire always" (W8-B6 FIX-2): that would hand a
 *    broken guard a veto over every tool call. It fails closed, and
 *    `sdkHooksForAgent` says so once when the bag is built.
 *  - a matcher on an event that carries no tool cannot be honoured, so it
 *    does not match either. */
export function hookMatcherMatches(parse: HookMatcherParse, input: HookDispatchInput): boolean {
  if (parse.kind === 'absent') return true;
  if (parse.kind === 'malformed') return false;
  const { tool, commandPrefix } = parse.matcher;
  if (typeof input.tool_name !== 'string' || input.tool_name !== tool) return false;
  if (commandPrefix === undefined) return true;
  const command = (input.tool_input as { command?: unknown } | undefined)?.command;
  if (typeof command !== 'string') return false;
  return command.startsWith(commandPrefix);
}

// ---------------------------------------------------------------------------
// The builder.
// ---------------------------------------------------------------------------

export interface SdkHooksForAgentInput {
  /** Forge-root-relative SKILL.md path — i.e. `PhaseAgentSpec.skill`, which is
   *  the handle every spawn site already holds. The bindings are re-derived
   *  from it, so no caller ever passes (or stores) a hook list. */
  skill: string;
  /**
   * The run's event logger, or a thunk producing one. The thunk form exists
   * because several spawn sites would otherwise have to CREATE a logger (and
   * therefore an `_logs/<id>/` directory) for every spawn, including the
   * overwhelmingly common case of an agent that binds no hook at all. The
   * thunk is invoked at most once, and only after a real binding is found.
   */
  logger: EventLogger | (() => EventLogger);
  initiativeId: string;
  forgeRoot?: string;
}

function emitHookError(
  logger: EventLogger,
  initiativeId: string,
  hookId: string,
  message: string,
  metadata: Record<string, unknown>,
): void {
  logger.emit({
    phase: 'orchestrator',
    skill: `hook:${hookId}`,
    event_type: 'error',
    initiative_id: initiativeId,
    input_refs: [],
    output_refs: [],
    message,
    metadata: { kind: 'hook-dispatch', hookId, ...metadata },
  });
}

/**
 * W8-B6 FIX-3 — turn a `runHookScript` throw into the distinction an operator
 * actually needs, from the error's TYPED reason rather than by re-parsing its
 * message.
 *
 * The catch that used this said "refused or failed to spawn" for all three
 * outcomes. An approval-gate refusal and a hung script are opposite problems:
 * one is fixed by approving the package, the other by fixing a script that —
 * because the spawn is synchronous (limit 1 above) — held the daemon for the
 * whole 30s budget. Sending an operator to the wrong one is worse than saying
 * nothing.
 *
 * A pure function with an explicit contract, exported for direct test per
 * ADR 042; the alternative is proving four mappings through four real spawns,
 * one of which would make the suite wait out a real timeout.
 */
export function describeHookRunFailure(e: unknown): { failure: HookRunFailureReason | 'unknown'; description: string } {
  if (e instanceof HookRunError) {
    switch (e.reason) {
      case 'not-runnable':
        return { failure: 'not-runnable', description: 'was refused by the approval gate' };
      case 'timeout':
        return { failure: 'timeout', description: 'exceeded its wall-clock budget and was killed' };
      case 'spawn-failed':
        return { failure: 'spawn-failed', description: 'failed to spawn' };
    }
  }
  return { failure: 'unknown', description: 'failed for an unrecognised reason' };
}

function makeCallback(
  hookId: string,
  event: HookLifecycleEvent,
  forgeRoot: string,
  logger: EventLogger,
  initiativeId: string,
): SdkHookCallback {
  return async (input) => {
    // Re-derived per fire, from the source of truth — never a build-time copy.
    let on: HookLifecycleEvent;
    let matcher: string | undefined;
    try {
      const def = loadHookDefinition(hookId, forgeRoot);
      on = def.on;
      matcher = def.matcher;
    } catch (e) {
      emitHookError(logger, initiativeId, hookId, `Hook "${hookId}" could not be loaded at dispatch — not fired: ${(e as Error).message}`, {
        event,
      });
      return { continue: true };
    }

    // The hook was re-pointed at a different event since the options bag was
    // built: the registration is stale, so it must not fire here.
    if (on !== event) {
      emitHookError(logger, initiativeId, hookId, `Hook "${hookId}" now declares on: ${on}, not ${event} — not fired`, {
        event,
        declaredOn: on,
      });
      return { continue: true };
    }

    if (!hookMatcherMatches(parseHookMatcher(matcher), input)) return { continue: true };

    let result: ReturnType<typeof runHookScript>;
    try {
      // No `parentEnv` override: `runHookScript` defaults to the real
      // `process.env` and narrows it through `buildHookChildEnv`. Dispatch
      // must never widen what a hook child can see.
      result = runHookScript({ forgeRoot, id: hookId, logger, initiativeId });
    } catch (e) {
      const { failure, description } = describeHookRunFailure(e);
      emitHookError(logger, initiativeId, hookId, `Hook "${hookId}" ${description} — not fired: ${(e as Error).message}`, {
        event,
        failure,
      });
      return { continue: true };
    }

    if (result.exitCode === 0) return { continue: true };

    const reason = (result.stderr.trim() || result.stdout.trim() || `hook "${hookId}" exited ${result.exitCode}`).slice(0, 2000);

    if (result.exitCode === HOOK_BLOCKING_EXIT_CODE) {
      emitHookError(logger, initiativeId, hookId, `Hook "${hookId}" BLOCKED ${event} (exit 2): ${reason}`, {
        event,
        exitCode: result.exitCode,
        blocking: true,
      });
      if (event === 'PreToolUse') {
        return {
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: reason,
          },
        };
      }
      return { continue: false, stopReason: reason };
    }

    emitHookError(logger, initiativeId, hookId, `Hook "${hookId}" exited ${result.exitCode} on ${event} (non-blocking): ${reason}`, {
      event,
      exitCode: result.exitCode,
      blocking: false,
    });
    return { continue: true };
  };
}

/**
 * Build the SDK `options.hooks` bag for one agent's declared bindings.
 *
 * Returns `undefined` — never an empty object — when the agent binds nothing
 * or cannot be read. Every agent in forge's shipped roster binds nothing
 * today, so the spawn options bag is byte-identical for all of them, which is
 * exactly what the golden spawn-capture fixtures independently prove.
 */
export function sdkHooksForAgent(input: SdkHooksForAgentInput): SdkHooksOption | undefined {
  const forgeRoot = input.forgeRoot ?? FORGE_ROOT;

  let hookIds: string[];
  try {
    hookIds = [...new Set(loadAgentDefinition(resolve(forgeRoot, input.skill)).composition.hooks)];
  } catch {
    // A malformed/absent agent definition is reported by lint and by whatever
    // is about to derive its spec; it must not crash the spawn from here.
    return undefined;
  }
  if (hookIds.length === 0) return undefined;

  // Resolved only now that a real binding exists — see the field's own doc.
  const logger = typeof input.logger === 'function' ? input.logger() : input.logger;

  const byEvent = new Map<HookLifecycleEvent, SdkHookMatcher[]>();
  for (const hookId of hookIds) {
    let event: HookLifecycleEvent;
    let matcher: string | undefined;
    try {
      const def = loadHookDefinition(hookId, forgeRoot);
      event = def.on;
      matcher = def.matcher;
    } catch (e) {
      emitHookError(
        logger,
        input.initiativeId,
        hookId,
        `Agent "${input.skill}" binds hook "${hookId}", which could not be loaded — it will not fire: ${(e as Error).message}`,
        { skill: input.skill },
      );
      continue;
    }

    // W8-B6 FIX-2 — said ONCE, here, not per fire. The write paths refuse this
    // shape (hook-library.ts's `hookTriggerError`, shared by all five of
    // them), so reaching dispatch means a package that predates the check or
    // was hand-edited on disk. Reporting it inside the callback instead would
    // emit one identical error per tool call for a PostToolUse binding —
    // flooding a real cycle's event log to say the same thing.
    const parse = parseHookMatcher(matcher);
    if (parse.kind === 'malformed') {
      emitHookError(
        logger,
        input.initiativeId,
        hookId,
        `Agent "${input.skill}" binds hook "${hookId}", whose matcher ${JSON.stringify(matcher)} ${parse.reason} — it is registered but will never fire`,
        { skill: input.skill, event, matcher },
      );
    }

    const list = byEvent.get(event) ?? [];
    list.push({ hooks: [makeCallback(hookId, event, forgeRoot, logger, input.initiativeId)] });
    byEvent.set(event, list);
  }

  if (byEvent.size === 0) return undefined;
  return Object.fromEntries(byEvent) as SdkHooksOption;
}
