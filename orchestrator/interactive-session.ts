/**
 * Shared spine for operator-driven, file-checkpointed agentic sessions — the
 * architect / instructions-creator / demo-builder pattern (ADR 020).
 *
 * An interactive session is a sequence of bounded **turns**: each turn reads the
 * session-dir state, advances ONE step, and exits. Operator think-time happens
 * *between* turns (the bridge re-spawns a turn on each operator action), so there
 * is no long-lived blocked session and the flow is crash-resumable (ADR 012).
 * Interactivity is file-based handoff (`questions.json` ↔ `answers.json`,
 * `feedback.md`), NOT SDK `canUseTool` interception — see ADR 020.
 *
 * This module owns the parts every interactive runner shares so they aren't
 * re-implemented per runner:
 *   - `runStructuredTurn` — one SDK structured-output stream loop, guarded by an
 *     idle-deadline, throttled heartbeat, tool_use streaming, and a fenced-JSON
 *     fallback. The model + tool allow-list are parameters (each runner derives
 *     them from its own SKILL.md, ADR-024).
 *   - `runAgentTurn`'s `writeRoots` fence (bead forge-eip, W6-CR-3) — see its
 *     own doc comment below for the mechanism. This is UNRELATED to ADR 020's
 *     ruling above: that ruling is about never using `canUseTool` to PAUSE a
 *     turn for operator interactivity (file handoff owns that); this fence
 *     never pauses anything — it is a synchronous, silent allow/deny decided
 *     entirely from the real filesystem, the SAME shape as the containment
 *     guards every write route in this codebase already uses. A tool-name
 *     allowlist (`allowedTools`/`disallowed-tools` in a SKILL.md) is NOT a
 *     fence: it is advisory prose the model can still be steered around by
 *     untrusted content it reads (a fetched web page, a finding message) —
 *     this is the actual per-call enforcement point against the real disk.
 *   - session-dir status I/O (`readSessionStatus` / `writeSessionStatus`).
 *   - a throttled heartbeat writer (`makeHeartbeatWriter`).
 *
 * The LLM call sits behind an injectable `queryFn` seam so every turn is
 * unit-testable without a live LLM. Extracted from architect-runner.ts (which
 * still owns the architect's own status type + state machine) so the proven
 * stream loop has exactly one home.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { join, dirname, basename, sep } from 'node:path';

import { guardedFile } from '../cli/studio-path-guard.ts';
import { withIdleDeadline } from './stream-deadline.ts';
import type { SdkHooksOption } from './studio/hook-dispatch.ts';
import { inspectBashCommand } from './bash-fence.ts';
import { extractLiveToolDetails } from './tool-event-emit.ts';
import type { EventLogger, Phase } from './logging.ts';
import type { ToolUseLiveDetail } from '../loops/ralph/claude-agent.ts';

/** Heartbeat cadence — the runner touches its `.heartbeat` file at most this
 *  often during an SDK stream, so the UI staleness checker has a liveness pulse
 *  without flooding the filesystem. */
export const HEARTBEAT_THROTTLE_MS = 2000;

/**
 * W6-B1: the literal `onThinking` fires with for every `redacted_thinking`
 * content block, NEVER the block's own (encrypted, non-human-readable) data —
 * only that thinking happened and was redacted by the API. Exported so every
 * sink built on top of `onThinking` (interactive-runner.ts, the four legacy
 * runners, brain-fix-runner.ts) shares exactly this literal rather than each
 * hand-rolling its own copy that could drift.
 */
export const REDACTED_THINKING_MARKER = '[thinking redacted]';

// ---------------------------------------------------------------------------
// W6-B1 review round 2 — the ONE shared thinking + reasoning sink pair.
//
// Both sinks were duplicated across 7 runner files (interactive-runner.ts,
// architect-runner.ts, instructions-runner.ts, demo-builder-runner.ts,
// project-brain-builder-runner.ts, brain-fix-runner.ts,
// preflight-fix-runner.ts) — 7 copies of the same per-block-cap logic is 7
// future desyncs, so it moves here, next to the REDACTED_THINKING_MARKER
// literal it already needs to stay in sync with. Two bugs fixed in this one
// place rather than in 7:
//
//   1. HIGH — neither sink had a per-TURN row ceiling. `makeToolEventSink`'s
//      sampler bounds tool_use rows via {cap:200}, but that cap does not
//      touch onThinking/onText, which write straight through `logger.emit`
//      on every block — and `runStructuredTurn` has no `maxTurns` to bound
//      how many thinking/text blocks a heavy-reasoning model streams before
//      its final `result`. A single turn could therefore write an unbounded
//      number of rows. Fixed with SINK_ROW_CAP: once a sink instance (one
//      per turn — each runner creates it fresh at the top of its `run*Turn`)
//      has emitted this many rows, it writes exactly ONE terminal marker row
//      and silently drops everything after — never a second marker, never
//      an unbounded write.
//   2. MEDIUM — the thinking sink's consecutive-duplicate coalescing
//      compared the TRUNCATED (capped-at-700-chars) string, so two genuinely
//      DISTINCT thinking blocks that merely share a 700-char prefix would
//      wrongly collapse into one row. Fixed: coalescing now compares the raw,
//      untruncated text; only the EMITTED message is truncated.
// ---------------------------------------------------------------------------

/** Per-block char cap for forwarded reasoning ('text' block) content — the
 *  long-standing default every runner's reasoning sink used before this was
 *  centralized. */
export const MAX_REASONING_TEXT = 400;

/** Per-block char cap for forwarded thinking ('thinking' block) content —
 *  wider than MAX_REASONING_TEXT (operator-approved default): a thinking
 *  trace is denser and less redundant with the turn's other logged output. */
export const MAX_THINKING_TEXT = 700;

/**
 * Per-turn row ceiling shared by both sinks (bug 1 above). 300 is the
 * operator-approved default — generous for a real turn's reasoning volume,
 * but a hard backstop against an unbounded write.
 */
export const SINK_ROW_CAP = 300;

/** The one terminal row a thinking sink writes once SINK_ROW_CAP is hit. */
export const THINKING_CAPPED_MARKER = `[thinking capped after ${SINK_ROW_CAP} rows]`;

/** The one terminal row a reasoning sink writes once SINK_ROW_CAP is hit. */
export const REASONING_CAPPED_MARKER = `[reasoning capped after ${SINK_ROW_CAP} rows]`;

/**
 * Shared context a capped text sink needs to build its emitted rows —
 * mirrors `ToolEventContext` (tool-event-emit.ts)'s shape so the two sink
 * families stay stylistically consistent. `idMeta` is spread into every
 * emitted row's `metadata` VERBATIM: it is how each runner keeps its own id
 * convention (`{session_id: ...}` vs `{runId: ...}`) without this shared
 * module hardcoding one.
 */
export type TextSinkContext = {
  initiativeId: string;
  phase: Phase;
  skill: string;
  idMeta: Record<string, string>;
};

/** Internal factory both exported sinks below share — the row-cap + optional
 *  raw-text-coalescing logic lives exactly once. Not exported: callers use
 *  `makeThinkingSink` / `makeReasoningSink`, which pin the per-kind knobs. */
function makeCappedTextSink(
  logger: EventLogger,
  ctx: TextSinkContext,
  opts: {
    kind: 'thinking' | 'reasoning';
    maxChars: number;
    cappedMarker: string;
    /** Thinking blocks can repeat verbatim (several `redacted_thinking`
     *  blocks in a row); reasoning blocks are always distinct prose, so only
     *  the thinking sink coalesces. */
    coalesceOnRaw: boolean;
  },
): (text: string) => void {
  let lastRaw: string | null = null;
  let emittedCount = 0;
  let cappedEmitted = false;
  return (text: string) => {
    if (cappedEmitted) return;
    if (opts.coalesceOnRaw) {
      // Bug 2 fix: compare the RAW text, not the truncated form below — two
      // distinct blocks sharing only a maxChars-length prefix must NOT
      // collapse into one row.
      if (text === lastRaw) return;
      lastRaw = text;
    }
    if (emittedCount >= SINK_ROW_CAP) {
      cappedEmitted = true;
      logger.emit({
        initiative_id: ctx.initiativeId,
        phase: ctx.phase,
        skill: ctx.skill,
        event_type: 'log',
        input_refs: [],
        output_refs: [],
        message: opts.cappedMarker,
        metadata: { ...ctx.idMeta, kind: opts.kind, capped: true },
      });
      return;
    }
    emittedCount += 1;
    // Straight `.slice` on the JS UTF-16 code-unit index — can bisect a
    // surrogate pair at the exact boundary. Inherited from the original
    // 400-char reasoning pattern this centralizes; disclosed, not fixed here.
    const capped = text.length > opts.maxChars ? `${text.slice(0, opts.maxChars)}…` : text;
    logger.emit({
      initiative_id: ctx.initiativeId,
      phase: ctx.phase,
      skill: ctx.skill,
      event_type: 'log',
      input_refs: [],
      output_refs: [],
      message: capped,
      metadata: { ...ctx.idMeta, kind: opts.kind },
    });
  };
}

/**
 * The ONE thinking sink every interactive-shaped runner uses — forwards
 * non-empty `thinking` blocks and the `REDACTED_THINKING_MARKER` (see
 * `onThinking` on `runStructuredTurn`/`runAgentTurn` below) to the event log,
 * per-block capped at MAX_THINKING_TEXT chars, coalescing a run of
 * consecutive IDENTICAL raw blocks into one emitted row, and capped at
 * SINK_ROW_CAP emitted rows per sink instance (== per turn).
 */
export function makeThinkingSink(logger: EventLogger, ctx: TextSinkContext): (text: string) => void {
  return makeCappedTextSink(logger, ctx, {
    kind: 'thinking',
    maxChars: MAX_THINKING_TEXT,
    cappedMarker: THINKING_CAPPED_MARKER,
    coalesceOnRaw: true,
  });
}

/**
 * The ONE reasoning sink every interactive-shaped runner uses — forwards
 * non-empty assistant `text` blocks to the event log, per-block capped at
 * MAX_REASONING_TEXT chars, and (same unbounded-row gap as the thinking sink)
 * capped at SINK_ROW_CAP emitted rows per sink instance (== per turn).
 */
export function makeReasoningSink(logger: EventLogger, ctx: TextSinkContext): (text: string) => void {
  return makeCappedTextSink(logger, ctx, {
    kind: 'reasoning',
    maxChars: MAX_REASONING_TEXT,
    cappedMarker: REASONING_CAPPED_MARKER,
    coalesceOnRaw: false,
  });
}

/**
 * The loose async-iterable query shape architect / brain-fix / reflector all use
 * — so test stubs don't need to implement the full SDK `query` type. `options`
 * is optional so a bare stub can ignore it.
 */
export type QueryFn = (params: {
  prompt: string;
  options?: Record<string, unknown>;
}) => AsyncIterable<unknown>;

export type StructuredResult<T> = {
  /** The validated structured output, or null when the stream produced none. */
  output: T | null;
  /** Every `file_path` the agent Read this turn — callers filter (e.g. brain/). */
  reads: string[];
};

/**
 * Run one structured-output SDK turn and return the parsed object.
 *
 * Read-only is enforced ONLY when a caller passes `disallowedTools` (below):
 * that value threads straight into the SDK's own `disallowedTools` option,
 * which per the SDK's runtimeTypes.d.ts is what actually removes a tool from
 * the model's context — the real fence, same mechanism `runAgentTurn` and
 * every generic spawn site in this repo rely on. `allowedTools` on its own is
 * NOT a fence: it is auto-allow-without-prompting, not a restriction (see the
 * module-level comment above) — a caller relying on `allowedTools` alone gets
 * no code-level enforcement at all, only prompt/schema design. This function
 * still carries no `canUseTool`/`writeRoots` fence of its own; `disallowedTools`
 * is the only enforcement lever it offers. It is deliberately NOT plan mode,
 * though — that was tried and reverted; two F-W5-1 regressions (2026-05-30)
 * are guarded here permanently:
 *   1. `outputFormat` MUST be `{ type: 'json_schema', schema }` — the bare schema
 *      silently disables structured output (the result never carries
 *      `structured_output`, so this returns null and the caller starves).
 *   2. NO `permissionMode: 'plan'` — plan mode makes the agent end its turn via
 *      `ExitPlanMode` (a prose plan) instead of emitting the structured result.
 *
 * No `maxTurns`: interactive turns are operator-driven and run until they emit
 * the structured output; `withIdleDeadline` still aborts a true stall.
 */
export async function runStructuredTurn<T>(args: {
  queryFn: QueryFn;
  prompt: string;
  schema: unknown;
  /** Concrete model id (each runner resolves it from its SKILL.md spec). */
  model: string;
  /** Read-only tool allow-list (from the runner's SKILL.md frontmatter).
   *  Advisory only — see the doc comment above; pass `disallowedTools` too
   *  for actual enforcement. */
  allowedTools: readonly string[];
  /** Block-list (from the runner's SKILL.md frontmatter) — the SDK's real
   *  enforcement lever. Honest-absent: when omitted or empty, the options
   *  object carries no `disallowedTools` key at all (byte-identical prior
   *  behaviour for callers that don't pass it). */
  disallowedTools?: readonly string[];
  /** Stream tool_use blocks to the live hex. */
  onToolUse?: (d: ToolUseLiveDetail) => void;
  /** Called at most once per HEARTBEAT_THROTTLE_MS during the stream. */
  onHeartbeat?: () => void;
  /** Called for each non-empty assistant text block (reasoning). */
  onText?: (text: string) => void;
  /** Called for each non-empty `thinking` content block (extended-thinking
   *  trace), and — with the literal `REDACTED_THINKING_MARKER`, never the
   *  block's own opaque data — once per `redacted_thinking` block. */
  onThinking?: (text: string) => void;
  /** Diagnostic label for the idle-deadline guard. */
  label?: string;
  /** W8-B6 — the agent's bound library hooks, built by the CALLER from its own
   *  `PhaseAgentSpec.skill` via `sdkHooksForAgent`. Absent (the shape for every
   *  agent that binds none) leaves the options bag byte-identical. */
  hooks?: SdkHooksOption;
}): Promise<StructuredResult<T>> {
  const options: Record<string, unknown> = {
    model: args.model,
    allowedTools: args.allowedTools,
    outputFormat: { type: 'json_schema', schema: args.schema },
    ...(args.hooks !== undefined ? { hooks: args.hooks } : {}),
  };
  if (args.disallowedTools !== undefined && args.disallowedTools.length > 0) {
    options.disallowedTools = args.disallowedTools;
  }
  const abortController = new AbortController();
  options.abortController = abortController;

  let structured: T | null = null;
  let rawText = '';
  let toolSeq = 0;
  const reads: string[] = [];
  let lastHeartbeatMs = 0;

  for await (const msg of withIdleDeadline(args.queryFn({ prompt: args.prompt, options }), {
    label: args.label ?? 'interactive-structured',
    abortController,
  })) {
    if (args.onHeartbeat) {
      const now = Date.now();
      if (now - lastHeartbeatMs >= HEARTBEAT_THROTTLE_MS) {
        args.onHeartbeat();
        lastHeartbeatMs = now;
      }
    }
    const m = msg as {
      type?: string;
      structured_output?: unknown;
      message?: {
        content?: Array<{ type?: string; name?: string; input?: unknown; text?: string; thinking?: string }>;
      };
    };
    if (m.type === 'assistant') {
      if (args.onToolUse) {
        const details = extractLiveToolDetails(m.message, toolSeq);
        for (const d of details) args.onToolUse(d);
        toolSeq += details.length;
      }
      for (const block of m.message?.content ?? []) {
        if (block?.type === 'tool_use' && block.name === 'Read') {
          const inp = block.input as { file_path?: string } | undefined;
          if (inp?.file_path) reads.push(inp.file_path);
        }
        if (block?.type === 'text' && typeof block.text === 'string') {
          rawText += (rawText ? '\n' : '') + block.text;
          const trimmed = block.text.trim();
          if (trimmed && args.onText) args.onText(trimmed);
        }
        if (block?.type === 'thinking' && typeof block.thinking === 'string') {
          const trimmed = block.thinking.trim();
          if (trimmed && args.onThinking) args.onThinking(trimmed);
        }
        if (block?.type === 'redacted_thinking' && args.onThinking) {
          args.onThinking(REDACTED_THINKING_MARKER);
        }
      }
      continue;
    }
    if (m.type !== 'result') continue;
    if (m.structured_output && typeof m.structured_output === 'object') {
      structured = m.structured_output as T;
    }
    break;
  }

  const output = structured ?? parseFencedJson<T>(rawText);
  return { output, reads };
}


// ---------------------------------------------------------------------------
// writeRoots fence (bead forge-eip, W6-CR-3) — a REAL, per-call containment
// check on every Write/Edit/MultiEdit/NotebookEdit a `runAgentTurn` turn
// attempts, closing the class this bead names: "a tool-name allowlist is
// NOT a fence" (a SKILL.md's `allowed-tools`/`disallowed-tools` is advisory
// prose the model can be steered around by untrusted content it reads —
// e.g. a fetched web page telling it to "save a copy to
// /forge/studio/community/registry.yaml") and "when the prompt hands an
// agent a sensitive absolute path, an unfenced Write reaches it" (this
// turn's own `buildTurnPrompt` inlines the WHOLE session status as JSON —
// community-refresh's own `registryPath`/`hubsPath` fields included).
//
// Generic, not community-refresh-specific: this lives in the shared spine
// because the gap is the WHOLE turnSpec roster's (authoring's `staging/`,
// kb-cleanup's `plan/`, community-refresh's `staging/` all reach it), not
// one kind's. `writeRoots` is caller-supplied, TRUSTED, already-realpath-
// resolved, ALREADY-EXISTING absolute directory paths — this module
// performs no mkdir and no identity check on the roots themselves (mirrors
// how `cwd` is already trusted); `orchestrator/interactive-runner.ts`
// derives them from each phase row's OWN declared `writes:` entries
// (never hardcoded), GUARD-TERMINAL-provisioning each one via
// `resolveGuardedPath` before the turn starts.
// ---------------------------------------------------------------------------

/** Tool names whose input names a file this fence must evaluate — mirrors
 *  `loops/ralph/claude-agent.ts`'s own `FILE_MODIFYING_TOOLS` (kept as an
 *  independent literal here, not imported, so this spine file's only
 *  cross-subsystem edge stays the pre-existing type-only one). Every OTHER
 *  tool call passes through this fence unmodified — it never gates reads.
 *
 *  W7-FIX-A2 (W7A2-03, bead forge-w08): `Bash` is gated too — it is a
 *  write-capable tool with no single path, so it is not in THIS set (which
 *  drives the one-path check) but in `FENCE_STRIPPED_TOOLS` below, and gets
 *  its own policy (`BashFenceMode`): denied outright unless the kind opts
 *  into static inspection (`inspectBashCommand`, orchestrator/bash-fence.ts). */
const FENCE_GATED_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/** Every tool a fenced turn must NOT pre-approve via `allowedTools` (so the
 *  SDK routes each call through `canUseTool`): the one-path tools above plus
 *  Bash. Never pushed into `disallowedTools` — they stay callable, gated. */
const FENCE_STRIPPED_TOOLS = new Set([...FENCE_GATED_TOOLS, 'Bash']);

/** W7-FIX-A2 (W7A2-03) — the Bash policy of a fenced turn. `deny` (the
 *  default: a fenced kind that does not opt in has NO ungated write-capable
 *  tool at all) or `inspect` (the ONE authored opt-in, `turnSpec.bashFence`
 *  in studio/session-kinds.yaml, validated against BASH_FENCE_MODES): every
 *  Bash command is statically inspected and every write-shaped operation
 *  must target a path inside the write roots. Kept as a string-literal
 *  union here (not imported from studio/session-kinds.ts) so this spine
 *  file's dependency edges stay as they are; session-kinds' frozen
 *  BASH_FENCE_MODES is the vocabulary the yaml is validated against, and
 *  the runner threads the validated value through. */
export type BashFenceMode = 'deny' | 'inspect';
export type BashFenceOptions =
  | { readonly bash?: 'deny' }
  | { readonly bash: 'inspect'; /** the turn's cwd — relative paths resolve against it */ readonly cwd: string };

/** Extract the target file path from a gated tool's input — mirrors
 *  `loops/ralph/claude-agent.ts`'s own `extractPath` (`file_path` for
 *  Write/Edit/MultiEdit, `notebook_path` for NotebookEdit, `path` as a
 *  belt-and-suspenders fallback). Returns `null` for a malformed/missing
 *  field — the caller DENIES on `null` (fail closed: "couldn't find a
 *  path" is never treated as "so allow it"). */
function extractGatedToolPath(input: Record<string, unknown>): string | null {
  const candidate = input.file_path ?? input.notebook_path ?? input.path;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

/**
 * True iff `candidatePath` resolves (realpath of its PARENT directory +
 * its own literal basename — the file itself may not exist yet, e.g. a
 * `Write` creating a new file) to somewhere under one of `realWriteRoots`
 * (already realpath-resolved by the caller). A parent directory that
 * cannot be realpath-resolved at all (ENOENT/ELOOP/a permission error) is a
 * hard DENY, never "not created yet, allow it": every `writeRoots` entry is
 * pre-provisioned (mkdir'd) by the caller before the turn starts, so a
 * write naming a not-yet-existing INTERMEDIATE directory below an
 * already-provisioned root has no legitimate reason to exist. This closes
 * the symlink-swap shape too — `realpathSync` fully resolves the parent, so
 * a directory symlink planted at (or below) the root cannot redirect a
 * write to somewhere the root's own real location does not cover.
 */
function isUnderWriteRoot(candidatePath: string, realWriteRoots: readonly string[]): boolean {
  let realParent: string;
  try {
    realParent = realpathSync(dirname(candidatePath));
  } catch {
    return false;
  }
  const realCandidate = join(realParent, basename(candidatePath));
  return realWriteRoots.some((root) => realCandidate === root || realCandidate.startsWith(root + sep));
}

/** The subset of the real SDK's `CanUseTool`/`PermissionResult` shape this
 *  fence needs — kept local (not imported from the SDK package) so this
 *  spine file's fence logic is exercisable against the SAME loose `QueryFn`
 *  test seam every other turn in this module already uses, without pulling
 *  the SDK's real types into a value position here. Structurally compatible
 *  with the SDK's own `CanUseTool`/`PermissionResult` (verified by the SDK
 *  accepting this function at `options.canUseTool` — a plain, untyped
 *  `Record<string, unknown>` bag from this module's own perspective, per
 *  `QueryFn`'s doc comment above). */
export type WriteRootCanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: Record<string, unknown>,
) => Promise<{ behavior: 'allow'; updatedInput: Record<string, unknown> } | { behavior: 'deny'; message: string }>;

/**
 * Build the `canUseTool` callback `runAgentTurn` installs at `options.canUseTool`
 * when `writeRoots` is non-empty. Synchronous decision, no operator pause —
 * see this file's header note on why this does NOT reopen ADR 020's ruling.
 */
// Exported for direct unit tests (interactive-session.test.ts) — the
// integration shape (a fake `queryFn` capturing `options.canUseTool`) is
// ALSO covered, but a direct export lets the deny/allow/symlink-escape
// matrix be pinned without threading every case through a full turn.
export function makeWriteRootCanUseTool(writeRoots: readonly string[], bashFence: BashFenceOptions = {}): WriteRootCanUseTool {
  // Resolved ONCE, at turn start, not per tool call — every root was already
  // provisioned by the caller (see this section's own header), so a root
  // that still fails to realpath here is a caller bug: fail THAT ONE root
  // closed (it can never match anything, so every write claiming it is
  // denied) rather than throwing out of a factory function with no
  // sensible call-site catch.
  const realRoots = writeRoots
    .map((root) => {
      try {
        return realpathSync(root);
      } catch {
        return null;
      }
    })
    .filter((root): root is string => root !== null);

  return async (toolName, input, _options) => {
    if (toolName === 'Bash') {
      // W7-FIX-A2 (W7A2-03): Bash on a fenced turn — deny by default; a kind
      // that opted in gets the static inspector (fail closed on anything it
      // cannot reason about, `null`/non-string command included).
      if (bashFence.bash !== 'inspect') {
        return {
          behavior: 'deny',
          message:
            'Bash is not available on this write-root-fenced turn (this session kind did not opt into Bash inspection) ' +
            '— use Read/Grep/Glob to inspect and Write/Edit to change files inside the writable root(s) ' +
            `(${writeRoots.join(', ')}). Refused by the write-root fence.`,
        };
      }
      const command = input.command;
      if (typeof command !== 'string') {
        return { behavior: 'deny', message: 'Bash: no command string in tool input — refused by the write-root fence.' };
      }
      const verdict = inspectBashCommand(command, { cwd: bashFence.cwd, realWriteRoots: realRoots });
      if (!verdict.allow) {
        return {
          behavior: 'deny',
          message:
            `Bash command refused by the write-root fence: ${verdict.reason}. ` +
            `Only read-only commands and writes inside this session's writable root(s) (${writeRoots.join(', ')}) are permitted; ` +
            'use the Write/Edit tools for file changes.',
        };
      }
      return { behavior: 'allow', updatedInput: input };
    }
    if (!FENCE_GATED_TOOLS.has(toolName)) {
      return { behavior: 'allow', updatedInput: input };
    }
    const candidate = extractGatedToolPath(input);
    if (candidate === null) {
      return {
        behavior: 'deny',
        message: `${toolName}: no resolvable file path in tool input — refused by the write-root fence.`,
      };
    }
    if (!isUnderWriteRoot(candidate, realRoots)) {
      return {
        behavior: 'deny',
        message:
          `${toolName} to "${candidate}" is outside this session's writable root(s) ` +
          `(${writeRoots.join(', ')}) — refused by the write-root fence.`,
      };
    }
    return { behavior: 'allow', updatedInput: input };
  };
}

/**
 * Run one NON-structured agent turn with write tools — the brain-fix / demo-builder
 * shape (the agent edits files via its tool stream, there is no structured result).
 * Streams tool_use to `onToolUse`, throttles `onHeartbeat`, forwards reasoning text
 * to `onText`, and returns the turn's total cost. Read-only vs write is decided by
 * the caller's `allowedTools` (the runner verifies the agent's file output itself),
 * and — when `writeRoots` is supplied — enforced for real against the filesystem
 * by the `canUseTool` fence above (bead forge-eip, W6-CR-3).
 */
export async function runAgentTurn(args: {
  queryFn: QueryFn;
  prompt: string;
  /** Working directory for the agent (e.g. the project repo it edits). */
  cwd: string;
  model: string;
  allowedTools: readonly string[];
  disallowedTools?: readonly string[];
  maxTurns?: number;
  /** W6-CR-3 (bead forge-eip) — when non-empty, installs the `canUseTool`
   *  write-root fence above: every Write/Edit/MultiEdit/NotebookEdit whose
   *  resolved target falls outside one of these TRUSTED, already-realpath-
   *  resolved, ALREADY-EXISTING absolute directory paths is denied. Absent
   *  or empty preserves this function's EXACT prior behaviour (no
   *  `canUseTool` at all) — every caller that does not opt in is
   *  unaffected. See `makeWriteRootCanUseTool`'s own doc comment for the
   *  mechanism and why this does not reopen ADR 020. */
  writeRoots?: readonly string[];
  /** W7-FIX-A2 (W7A2-03) — Bash policy when `writeRoots` fences the turn:
   *  absent/`deny` denies every Bash call; `inspect` statically inspects
   *  each command against the write roots (see `BashFenceOptions`). Ignored
   *  when the turn is unfenced. */
  bashFence?: BashFenceMode;
  onToolUse?: (d: ToolUseLiveDetail) => void;
  onHeartbeat?: () => void;
  onText?: (text: string) => void;
  /** Called for each non-empty `thinking` content block, and — with the
   *  literal `REDACTED_THINKING_MARKER`, never the block's own opaque data —
   *  once per `redacted_thinking` block. */
  onThinking?: (text: string) => void;
  label?: string;
  /** W8-B6 — the agent's bound library hooks (see `runStructuredTurn`'s field). */
  hooks?: SdkHooksOption;
}): Promise<{ costUsd: number }> {
  const abortController = new AbortController();
  const fenced = args.writeRoots !== undefined && args.writeRoots.length > 0;
  // W7-A2 (sessions-kinds-V01, beads forge-w08/forge-eip) — a fence the SDK
  // never consults is dead code. `canUseTool` is the SDK's PERMISSION-PROMPT
  // handler: it runs only for a tool call the CLI would otherwise prompt on.
  // Two settings in this very object used to short-circuit that prompt for
  // exactly the tools the fence gates:
  //   - `permissionMode: 'acceptEdits'` auto-accepts Write/Edit/MultiEdit/
  //     NotebookEdit at the SDK level;
  //   - `allowedTools` pre-approves every listed name, and every real
  //     turnSpec agent (community-refresh / brain-maintenance /
  //     creation-agent SKILL.md) lists `Write` there.
  // Live evidence: the operator's community-refresh 2026-08-18T12-54-32 turn
  // ran with a non-empty writeRoots and still wrote three files under
  // /home/parso/forge/studio/community/staging/ — outside every declared
  // root. So when a fence is requested the turn runs in `default` mode and
  // the fence-gated tool names are STRIPPED from `allowedTools` (they stay
  // callable — never pushed into disallowedTools — the SDK just routes each
  // call through `canUseTool`, which allows in-root writes and denies the
  // rest). W7-FIX-A2 (W7A2-03): `Bash` — the one write-capable tool with
  // no single path — is stripped too and denied by canUseTool unless the
  // kind opted into static inspection (`bashFence: 'inspect'`). Every
  // read-only grant (Read/Grep/Glob/WebFetch/…) survives verbatim. An
  // unfenced turn keeps the exact prior shape (acceptEdits, allowedTools
  // verbatim, no canUseTool). Pinned by interactive-session-fence-mode.test.ts
  // + bash-fence.test.ts; live-proven once by scripts/probe-write-fence.mjs
  // (recorded in the W7-A2 PR).
  const options: Record<string, unknown> = {
    cwd: args.cwd,
    model: args.model,
    permissionMode: fenced ? 'default' : 'acceptEdits',
    allowedTools: fenced ? args.allowedTools.filter((t) => !FENCE_STRIPPED_TOOLS.has(t)) : args.allowedTools,
    disallowedTools: args.disallowedTools ?? [],
    maxTurns: args.maxTurns ?? 16,
    abortController,
    ...(args.hooks !== undefined ? { hooks: args.hooks } : {}),
  };
  if (fenced) {
    options.canUseTool = makeWriteRootCanUseTool(
      args.writeRoots!,
      args.bashFence === 'inspect' ? { bash: 'inspect', cwd: args.cwd } : { bash: 'deny' },
    );
  }

  let costUsd = 0;
  let toolSeq = 0;
  let lastHeartbeatMs = 0;

  for await (const msg of withIdleDeadline(args.queryFn({ prompt: args.prompt, options }), {
    label: args.label ?? 'agent-turn',
    abortController,
  })) {
    if (args.onHeartbeat) {
      const now = Date.now();
      if (now - lastHeartbeatMs >= HEARTBEAT_THROTTLE_MS) {
        args.onHeartbeat();
        lastHeartbeatMs = now;
      }
    }
    if (typeof msg !== 'object' || msg === null) continue;
    const m = msg as {
      type?: string;
      total_cost_usd?: number;
      message?: {
        content?: Array<{ type?: string; name?: string; input?: unknown; text?: string; thinking?: string }>;
      };
    };
    if (m.type === 'assistant') {
      if (args.onToolUse) {
        const details = extractLiveToolDetails(m.message, toolSeq);
        for (const d of details) args.onToolUse(d);
        toolSeq += details.length;
      }
      if (args.onText || args.onThinking) {
        for (const block of m.message?.content ?? []) {
          if (block?.type === 'text' && typeof block.text === 'string') {
            const trimmed = block.text.trim();
            if (trimmed && args.onText) args.onText(trimmed);
          }
          if (block?.type === 'thinking' && typeof block.thinking === 'string') {
            const trimmed = block.thinking.trim();
            if (trimmed && args.onThinking) args.onThinking(trimmed);
          }
          if (block?.type === 'redacted_thinking' && args.onThinking) {
            args.onThinking(REDACTED_THINKING_MARKER);
          }
        }
      }
      continue;
    }
    if (m.type !== 'result') continue;
    if (typeof m.total_cost_usd === 'number') costUsd = m.total_cost_usd;
    break;
  }
  return { costUsd };
}

/** Parse a ```json fenced block (or the raw text) as JSON; null on any failure. */
export function parseFencedJson<T>(text: string): T | null {
  if (!text) return null;
  const m = /```json\s*([\s\S]*?)```/i.exec(text);
  const raw = m ? m[1] : text;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Session-dir status I/O (generic over a phase-bearing status object)
// ---------------------------------------------------------------------------

/** Read `<sessionDir>/<file>` as JSON; null if absent or unparseable. */
export function readSessionStatus<S>(sessionDir: string, file = 'status.json'): S | null {
  const p = join(sessionDir, file);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as S;
  } catch {
    return null;
  }
}

/**
 * Write `<sessionDir>/<file>` as pretty JSON, stamping a fresh `updated_at`.
 * Creates the session dir if needed. Returns the written path.
 */
export function writeSessionStatus<S extends Record<string, unknown>>(
  sessionDir: string,
  status: S,
  file = 'status.json',
): string {
  if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });
  const p = join(sessionDir, file);
  writeFileSync(p, JSON.stringify({ ...status, updated_at: new Date().toISOString() }, null, 2));
  return p;
}

// ---------------------------------------------------------------------------
// SEC-04 — guarded leaf siblings of readSessionStatus / writeSessionStatus.
//
// The raw pair above takes an ALREADY-BUILT `sessionDir` and raw-appends the
// `status.json` leaf with `join(sessionDir, file)` — the exact "guard the dir,
// raw-append the leaf" shape SEC-04 closes. These siblings take the TRUSTED
// `projectsRoot` plus the request-derived directory segments and the leaf name,
// and route the WHOLE path — leaf included — through `guardedFile` so a
// symlinked/hardlinked `status.json` cannot escape. The raw pair is retained
// deliberately; Phase-1 route appliers switch their call sites onto these.
//
// `dirSegments` carries the request-influenced ids (project / kindDir /
// sessionId) as their OWN segments — NEVER folded into `projectsRoot` (see the
// guard's root-trust contract). Returns `null` on a containment rejection so
// the caller fails closed rather than reading/writing an escaped path.
// ---------------------------------------------------------------------------

/** Guarded read of `<projectsRoot>/<dirSegments...>/<leaf>` as JSON; `null` if
 *  the guard rejects it, or it is absent/unparseable. */
export function guardedReadSessionStatus<S>(
  projectsRoot: string,
  dirSegments: readonly string[],
  leaf = 'status.json',
): S | null {
  const p = guardedFile(projectsRoot, [...dirSegments, leaf], 'read');
  if (p === null) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as S;
  } catch {
    return null;
  }
}

/** W7-A2 (ADR-043 2026-08-19 amendment §1) — the ONE universal, reserved
 *  terminal phase every session kind shares: written by the generic
 *  `POST /api/studio/sessions/:kind/:sessionId/cancel` route
 *  (cli/bridge-studio-session-cancel.ts) and read as terminal by
 *  `isTerminalPhase` (cli/bridge-studio-sessions.ts) for EVERY kind BEFORE
 *  the per-kind tables are consulted. Deliberately NOT a per-kind
 *  `{ phase: cancelled, step: terminal }` yaml row: "the operator gave up"
 *  is the same fact for all kinds, and N copies of one fact in N tables is
 *  exactly the drift shape ADR-043's "derived, not authored" discipline
 *  exists to prevent.
 *
 *  W7-FIX-A2 (W7A2-01): defined HERE, at the status-write seam, because the
 *  seam enforces it (`cancelledPhaseWins` below) — cli/bridge-studio.ts
 *  re-exports this same binding so every bridge module keeps its import. */
export const CANCELLED_PHASE = 'cancelled';

/**
 * W7-FIX-A2 (W7A2-01, HIGH) — the sticky-cancel rule, as ONE pure predicate:
 * an on-disk `cancelled` phase WINS over any later write that would move the
 * session to a different phase (or to no phase at all). A late turn
 * completion — onboarding's untracked dispatch child, or a tracked runner
 * already past its SIGTERM — used to spread its STALE pre-turn status object
 * over the terminal phase and resurrect the session into `complete`/`failed`/
 * `awaiting-…`. Re-stamping `cancelled` over `cancelled` is not a
 * resurrection (idempotent), and cancelling a live phase is the normal
 * transition, so both stay allowed. A missing on-disk phase (first write) is
 * never sticky.
 */
export function cancelledPhaseWins(existingPhase: unknown, incomingPhase: unknown): boolean {
  return existingPhase === CANCELLED_PHASE && incomingPhase !== CANCELLED_PHASE;
}

/** W7-FIX-A2 (W7A2-01) — tell the two `guardedWriteSessionStatus` → `null`
 *  causes apart, for the writer's own error message: `'cancelled'` when the
 *  on-disk phase is the reserved terminal and the incoming phase would move
 *  off it (the sticky-cancel refusal — a turn finished after the operator
 *  cancelled; the write is discarded by design), else `'containment'` (the
 *  guard rejected the path). ONE helper for every runner, so no runner
 *  reports a sticky-cancel refusal as a containment failure. */
export function statusWriteRefusalReason(
  projectsRoot: string,
  dirSegments: readonly string[],
  incomingPhase: unknown,
): 'cancelled' | 'containment' {
  const onDisk = guardedReadSessionStatus<{ phase?: unknown }>(projectsRoot, dirSegments);
  return onDisk !== null && cancelledPhaseWins(onDisk.phase, incomingPhase) ? 'cancelled' : 'containment';
}

/** Guarded write of `<projectsRoot>/<dirSegments...>/<leaf>` as pretty JSON,
 *  stamping a fresh `updated_at` and creating the session dir if needed.
 *  Returns the written path, or `null` if the guard rejected the path (the
 *  write never happens — fail closed) — OR if the on-disk phase is the
 *  reserved terminal `cancelled` and `status.phase` is anything else
 *  (`cancelledPhaseWins`: the sticky-cancel rule, enforced at THIS seam so
 *  every writer — the affordance routes, the generic runner, the four legacy
 *  runners, `forge agent dispatch --session-dir` — inherits it without a
 *  per-caller check). The status file is byte-unchanged on refusal. Callers
 *  that need to tell the two refusals apart re-read the on-disk status
 *  (`guardedReadSessionStatus`) and test `cancelledPhaseWins` themselves. */
export function guardedWriteSessionStatus<S extends Record<string, unknown>>(
  projectsRoot: string,
  dirSegments: readonly string[],
  status: S,
  leaf = 'status.json',
): string | null {
  const p = guardedFile(projectsRoot, [...dirSegments, leaf], 'write');
  if (p === null) return null;
  const existing = guardedReadSessionStatus<Record<string, unknown>>(projectsRoot, dirSegments, leaf);
  if (existing !== null && cancelledPhaseWins(existing.phase, status.phase)) return null;
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ ...status, updated_at: new Date().toISOString() }, null, 2));
  return p;
}

/**
 * Build a throttled heartbeat writer for `<heartbeatDir>/.heartbeat`. Each call
 * writes the current ISO timestamp at most once per HEARTBEAT_THROTTLE_MS;
 * best-effort (never throws). The directory is created up front.
 */
export function makeHeartbeatWriter(heartbeatDir: string): () => void {
  mkdirSync(heartbeatDir, { recursive: true });
  const heartbeatPath = join(heartbeatDir, '.heartbeat');
  let lastMs = 0;
  return () => {
    const now = Date.now();
    if (now - lastMs < HEARTBEAT_THROTTLE_MS) return;
    lastMs = now;
    try {
      writeFileSync(heartbeatPath, new Date().toISOString());
    } catch {
      /* best-effort */
    }
  };
}

// ---------------------------------------------------------------------------
// Interview handoff (questions.json ↔ answers.json) — shared by interactive
// runners that ask the operator AskUserQuestion-shaped questions between turns.
// ---------------------------------------------------------------------------

/** One operator-facing question — the AskUserQuestion shape the UI renders. */
export type InterviewQuestion = {
  question: string;
  /** ≤12 chars chip label (AskUserQuestion constraint). */
  header: string;
  options: { label: string; description: string }[];
};

/** One resolved Q/A pair. */
export type InterviewAnswer = { question: string; answer: string };

/** One round of answers POSTed by the operator (written by the bridge). */
export type AnswerRound = { round: number; answers: InterviewAnswer[] };

// SEC-04 leaf-tail: `questions.json` / `answers.json` are the interview-handoff
// SIBLINGS of `status.json` — and were the last raw-append leaves on the session
// dir. A caller previously guarded the DIRECTORY (`resolveGuardedPath` →
// `sessionDir` realPath) and then raw-appended the leaf with
// `join(sessionDir, 'questions.json')`; a symlinked/hardlinked `questions.json`
// or `answers.json` inside the genuinely-real, contained session dir therefore
// escaped — proven live: `writeQuestions` wrote the pending questions THROUGH a
// symlinked leaf to an out-of-root file, and `readAnswerRounds` READ an
// out-of-root `answers.json` and surfaced its content into the replayed interview
// prompt. These now route the WHOLE path (leaf included) through `guardedFile`
// exactly like `guarded{Read,Write}SessionStatus` above: TRUSTED `projectsRoot`,
// request-derived kind-dir + sessionId as their own `segments[]` elements (NEVER
// folded into the root — the guard's root-trust contract), leaf last.

/**
 * Write the pending questions for the operator to
 * `<projectsRoot>/<dirSegments...>/questions.json`, routing the leaf through the
 * guard. Returns the written path, or `null` if containment rejected it (the
 * write never happens — the caller fails closed rather than write an escaped
 * leaf).
 */
export function writeQuestions(
  projectsRoot: string,
  dirSegments: readonly string[],
  questions: InterviewQuestion[],
): string | null {
  const p = guardedFile(projectsRoot, [...dirSegments, 'questions.json'], 'write');
  if (p === null) return null;
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(questions, null, 2));
  return p;
}

/**
 * Read every `answers.json` round into a flat `InterviewAnswer[]`. The bridge
 * appends rounds as the operator answers; this flattens them into the prior-Q/A
 * list a turn prompt replays. The leaf rides through `guardedFile` (read mode) so
 * a symlinked/escaping `answers.json` collapses to `null` == absent (no oracle)
 * and yields `[]` rather than leaking out-of-root content into the prompt.
 * Best-effort — never throws.
 */
export function readAnswerRounds(projectsRoot: string, dirSegments: readonly string[]): InterviewAnswer[] {
  const p = guardedFile(projectsRoot, [...dirSegments, 'answers.json'], 'read');
  if (p === null) return [];
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as AnswerRound[] | AnswerRound;
    const rounds = Array.isArray(parsed) ? parsed : [parsed];
    const out: InterviewAnswer[] = [];
    for (const r of rounds) {
      for (const a of r.answers ?? []) out.push({ question: a.question, answer: a.answer });
    }
    return out;
  } catch {
    return [];
  }
}
