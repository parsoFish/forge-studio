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
 *   - session-dir status I/O (`readSessionStatus` / `writeSessionStatus`).
 *   - a throttled heartbeat writer (`makeHeartbeatWriter`).
 *
 * The LLM call sits behind an injectable `queryFn` seam so every turn is
 * unit-testable without a live LLM. Extracted from architect-runner.ts (which
 * still owns the architect's own status type + state machine) so the proven
 * stream loop has exactly one home.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { guardedFile } from '../cli/studio-path-guard.ts';
import { withIdleDeadline } from './stream-deadline.ts';
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
 * Read-only is enforced by the `allowedTools` whitelist (no Write/Edit), NOT by
 * plan mode. Two F-W5-1 regressions (2026-05-30) are guarded here permanently:
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
  /** Read-only tool allow-list (from the runner's SKILL.md frontmatter). */
  allowedTools: readonly string[];
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
}): Promise<StructuredResult<T>> {
  const options: Record<string, unknown> = {
    model: args.model,
    allowedTools: args.allowedTools,
    outputFormat: { type: 'json_schema', schema: args.schema },
  };
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

/**
 * Run one NON-structured agent turn with write tools — the brain-fix / demo-builder
 * shape (the agent edits files via its tool stream, there is no structured result).
 * Streams tool_use to `onToolUse`, throttles `onHeartbeat`, forwards reasoning text
 * to `onText`, and returns the turn's total cost. Read-only vs write is decided by
 * the caller's `allowedTools` (the runner verifies the agent's file output itself).
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
  onToolUse?: (d: ToolUseLiveDetail) => void;
  onHeartbeat?: () => void;
  onText?: (text: string) => void;
  /** Called for each non-empty `thinking` content block, and — with the
   *  literal `REDACTED_THINKING_MARKER`, never the block's own opaque data —
   *  once per `redacted_thinking` block. */
  onThinking?: (text: string) => void;
  label?: string;
}): Promise<{ costUsd: number }> {
  const abortController = new AbortController();
  const options: Record<string, unknown> = {
    cwd: args.cwd,
    model: args.model,
    permissionMode: 'acceptEdits',
    allowedTools: args.allowedTools,
    disallowedTools: args.disallowedTools ?? [],
    maxTurns: args.maxTurns ?? 16,
    abortController,
  };

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

/** Guarded write of `<projectsRoot>/<dirSegments...>/<leaf>` as pretty JSON,
 *  stamping a fresh `updated_at` and creating the session dir if needed.
 *  Returns the written path, or `null` if the guard rejected the path (the
 *  write never happens — fail closed). */
export function guardedWriteSessionStatus<S extends Record<string, unknown>>(
  projectsRoot: string,
  dirSegments: readonly string[],
  status: S,
  leaf = 'status.json',
): string | null {
  const p = guardedFile(projectsRoot, [...dirSegments, leaf], 'write');
  if (p === null) return null;
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
