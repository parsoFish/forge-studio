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
import { join } from 'node:path';

import { withIdleDeadline } from './stream-deadline.ts';
import { extractLiveToolDetails } from './tool-event-emit.ts';
import type { ToolUseLiveDetail } from '../loops/ralph/claude-agent.ts';

/** Heartbeat cadence — the runner touches its `.heartbeat` file at most this
 *  often during an SDK stream, so the UI staleness checker has a liveness pulse
 *  without flooding the filesystem. */
export const HEARTBEAT_THROTTLE_MS = 2000;

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
      message?: { content?: Array<{ type?: string; name?: string; input?: unknown; text?: string }> };
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

/** Write the pending questions for the operator to `<sessionDir>/questions.json`. */
export function writeQuestions(sessionDir: string, questions: InterviewQuestion[]): string {
  if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });
  const p = join(sessionDir, 'questions.json');
  writeFileSync(p, JSON.stringify(questions, null, 2));
  return p;
}

/**
 * Read every `answers.json` round into a flat `InterviewAnswer[]`. The bridge
 * appends rounds as the operator answers; this flattens them into the prior-Q/A
 * list a turn prompt replays. Best-effort — never throws.
 */
export function readAnswerRounds(sessionDir: string): InterviewAnswer[] {
  const p = join(sessionDir, 'answers.json');
  if (!existsSync(p)) return [];
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
