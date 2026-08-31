/**
 * Google Gemini RuntimeAdapter (M8-A, ADR 029 — flywheel adapter drop-in).
 *
 * A second runtime adapter behind the same `RuntimeAdapter` seam the Claude
 * reference adapter satisfies (loops/_adapters/claude/index.ts) — contract-
 * complete (passes the conformance suite); it proves the runtime seam. Driving a
 * real Gemini dev-loop additionally needs a tool EXECUTOR that applies Gemini's
 * functionCall blocks to the worktree (see the liveGap note) — a follow-up. It maps
 * the official Google GenAI Node SDK (`@google/genai`, the unified successor to
 * the deprecated `@google/generative-ai`) onto forge's two injectable seams:
 *
 *   query        — the raw SDK-call boundary. Calls
 *                  `ai.models.generateContentStream(...)` and re-shapes each
 *                  Gemini chunk into the forge wire shape the rest of the
 *                  codebase already consumes from the Claude SDK:
 *                    { type: 'assistant', message: { content: [...], usage } }
 *                    { type: 'result', total_cost_usd, usage }
 *   createAgent  — one Ralph iteration: read PROMPT.md from the worktree, drive
 *                  `query`, fold the stream into an AgentIterationInfo.
 *
 * --- DEP + CREDS GATING ----------------------------------------------------
 * The `@google/genai` dependency is NOT bundled with forge and there are no
 * Gemini credentials in CI. `available` is therefore computed at module load:
 * true ONLY when (a) the SDK package imports successfully AND (b) a Gemini API
 * key env var is set. The dynamic import goes through a STRING VARIABLE so `tsc`
 * never tries to resolve the (intentionally) missing module. The SDK boundary
 * is typed with a minimal local interface (below), not `any`.
 *
 * Because `available` is false in this environment, the live path is never
 * exercised in CI — the conformance suite injects a mock `queryFn` (exactly as
 * the Claude adapter is tested), so the adapter's stream-folding glue is proven
 * without a real API call or a real dependency. See gemini.test.ts.
 *
 * Sources (researched 2026-06-14, not memorised):
 *   - SDK package + client + generateContentStream:
 *     https://googleapis.github.io/js-genai/release_docs/index.html
 *   - chunk.text getter + streaming loop + model names:
 *     https://ai.google.dev/gemini-api/docs/text-generation
 *   - functionCalls / functionDeclarations (tool use):
 *     https://ai.google.dev/gemini-api/docs/function-calling
 *   - usageMetadata fields (promptTokenCount/candidatesTokenCount/
 *     totalTokenCount/cachedContentTokenCount):
 *     https://ai.google.dev/api/generate-content
 *   - deprecation of @google/generative-ai → @google/genai:
 *     https://github.com/google-gemini/generative-ai-js
 */

import { readFileSync } from 'node:fs';

import type { RuntimeAdapter, AdapterAgentOptions, QueryFn } from '../types.ts';
import type { AgentInvocation, AgentIterationInfo } from '../../ralph/runner.ts';

// ---------------------------------------------------------------------------
// Config — model + creds (no hardcoded secrets; env-driven per project rules)
// ---------------------------------------------------------------------------

/**
 * The npm package, held in a STRING so `tsc` does not attempt to resolve the
 * (un-installed) module at build time. `await import(GENAI_PACKAGE)` defers the
 * resolution to runtime, where it is wrapped in try/catch.
 */
const GENAI_PACKAGE = '@google/genai';

/** Default model. Overridable via AdapterAgentOptions.model or GEMINI_MODEL. */
const DEFAULT_MODEL = 'gemini-2.5-pro';

/**
 * Accepted credential env vars, in priority order. The official SDK reads
 * GEMINI_API_KEY / GOOGLE_API_KEY; we accept either so operators can reuse an
 * existing Google key without renaming it.
 */
const API_KEY_ENV_VARS = ['GEMINI_API_KEY', 'GOOGLE_API_KEY'] as const;

function resolveApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const name of API_KEY_ENV_VARS) {
    const v = env[name];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function resolveModel(opts: GeminiAgentOptions): string {
  if (typeof opts.model === 'string' && opts.model.length > 0) return opts.model;
  const fromEnv = process.env.GEMINI_MODEL;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  return DEFAULT_MODEL;
}

// ---------------------------------------------------------------------------
// Minimal local typing of the SDK boundary (no `any` sprawl)
// ---------------------------------------------------------------------------

/** A single streamed chunk — the SDK's GenerateContentResponse, narrowed. */
type GeminiChunk = {
  /** Convenience getter: concatenated text of the candidate's text parts. */
  readonly text?: string;
  /** Convenience getter: parsed function calls in this chunk. */
  readonly functionCalls?: GeminiFunctionCall[];
  readonly candidates?: GeminiCandidate[];
  readonly usageMetadata?: GeminiUsageMetadata;
};

type GeminiCandidate = {
  content?: { parts?: GeminiPart[] };
};

type GeminiPart = {
  text?: string;
  functionCall?: GeminiFunctionCall;
};

type GeminiFunctionCall = {
  name?: string;
  id?: string;
  args?: Record<string, unknown>;
};

type GeminiUsageMetadata = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
};

/** The narrowed `ai.models` surface we call. */
type GeminiModels = {
  generateContentStream(req: {
    model: string;
    contents: unknown;
    config?: Record<string, unknown>;
  }): Promise<AsyncIterable<GeminiChunk>>;
};

type GeminiClient = { models: GeminiModels };

/** The narrowed module shape: a `GoogleGenAI` constructor. */
type GenAiModule = {
  GoogleGenAI: new (opts: { apiKey: string }) => GeminiClient;
};

// ---------------------------------------------------------------------------
// Adapter options
// ---------------------------------------------------------------------------

/**
 * Gemini accepts the AdapterAgentOptions superset but only consumes the subset
 * below. Unsupported Claude-specific fields (permissionMode, allowedTools wired
 * to the Claude CLI, heartbeat timers, prompt-cache markers) are accepted-and-
 * ignored so the type stays interchangeable with the Claude adapter — they have
 * no Gemini equivalent on the bare `generateContent` API.
 *
 *   model        — gemini-2.x model id. Default `gemini-2.5-pro` / $GEMINI_MODEL.
 *   systemPrompt — mapped to config.systemInstruction.
 *   maxOutputTokens — mapped to config.maxOutputTokens (optional).
 *   queryFn      — DI seam: substitute a mock stream for tests (same contract
 *                  as the Claude adapter's queryFn).
 */
type GeminiAgentOptions = AdapterAgentOptions & {
  /** Override the per-call output-token cap (config.maxOutputTokens). */
  maxOutputTokens?: number;
};

// ---------------------------------------------------------------------------
// Availability — dep import + creds, computed once at module load
// ---------------------------------------------------------------------------

/**
 * Attempts the dynamic import behind the string variable. Returns the narrowed
 * module on success, or null if the package is not installed. NEVER throws —
 * an absent dependency is an expected state (the adapter just reports
 * `available: false`).
 */
async function loadGenAiModule(): Promise<GenAiModule | null> {
  try {
    const pkg = GENAI_PACKAGE;
    const mod = (await import(pkg)) as Partial<GenAiModule>;
    if (typeof mod.GoogleGenAI !== 'function') return null;
    return mod as GenAiModule;
  } catch {
    return null;
  }
}

/**
 * `available` is dep-AND-creds gated. We probe the import once at load; if it
 * resolves AND a key is present, the adapter is usable. The probe is awaited
 * via the module's top-level await (Node ESM) below.
 */
let cachedModule: GenAiModule | null = null;
let depPresent = false;

try {
  cachedModule = await loadGenAiModule();
  depPresent = cachedModule !== null;
} catch {
  cachedModule = null;
  depPresent = false;
}

const credsPresent = resolveApiKey() !== undefined;

/** True only when the SDK imports AND a Gemini API key env var is set. */
const isAvailable = depPresent && credsPresent;

// ---------------------------------------------------------------------------
// query — raw SDK boundary → forge wire shape
// ---------------------------------------------------------------------------

/**
 * A USD cost is not returned by the Gemini API; we surface 0 and rely on the
 * token counts for downstream accounting (forge has no pricing table — the
 * same stance the Claude adapter documents for token-only signals).
 */
const GEMINI_COST_USD = 0;

/**
 * Builds the forge-shaped `QueryFn`. Each call:
 *   1. (lazily) constructs the GoogleGenAI client from the resolved API key,
 *   2. calls `generateContentStream`,
 *   3. re-shapes every chunk into an `assistant` message + a terminal `result`.
 *
 * The wire shape mirrors what `createClaudeAgent`'s `for await` loop consumes:
 *   assistant: { type, message: { id, content: [{type:'text'|'tool_use',...}], usage } }
 *   result:    { type:'result', total_cost_usd, usage: {input_tokens, output_tokens, ...} }
 *
 * Token usage from Gemini's `usageMetadata` is mapped to the snake_case
 * `usage` block the rest of forge reads (promptTokenCount → input_tokens,
 * candidatesTokenCount → output_tokens, cachedContentTokenCount →
 * cache_read_input_tokens).
 */
const liveQuery: QueryFn = ((params: { prompt: string; options?: Record<string, unknown> }) => {
  async function* stream() {
    const mod = cachedModule ?? (await loadGenAiModule());
    if (mod === null) {
      throw new Error(
        `Gemini adapter: package "${GENAI_PACKAGE}" is not installed. ` +
          `Run \`npm install ${GENAI_PACKAGE}\` to enable it.`,
      );
    }
    const apiKey = resolveApiKey();
    if (apiKey === undefined) {
      throw new Error(
        `Gemini adapter: no API key. Set one of ${API_KEY_ENV_VARS.join(' / ')}.`,
      );
    }

    const opts = params.options ?? {};
    const model =
      typeof opts.model === 'string' && opts.model.length > 0 ? opts.model : DEFAULT_MODEL;
    const config: Record<string, unknown> = {};
    if (typeof opts.systemPrompt === 'string') config.systemInstruction = opts.systemPrompt;
    if (typeof opts.maxOutputTokens === 'number') config.maxOutputTokens = opts.maxOutputTokens;
    if (Array.isArray(opts.tools)) config.tools = opts.tools;

    const client = new mod.GoogleGenAI({ apiKey });
    const sdkStream = await client.models.generateContentStream({
      model,
      contents: params.prompt,
      config: Object.keys(config).length > 0 ? config : undefined,
    });

    // Last-seen usage wins — Gemini emits cumulative usageMetadata, typically
    // populated on the final chunk. We carry it forward to the result message.
    let lastUsage: GeminiUsageMetadata | undefined;
    let turn = 0;

    for await (const chunk of sdkStream) {
      lastUsage = chunk.usageMetadata ?? lastUsage;
      const content = chunkToContentBlocks(chunk);
      if (content.length === 0) continue;
      turn += 1;
      yield {
        type: 'assistant',
        message: {
          id: `gemini-chunk-${turn}`,
          content,
          usage: usageToWire(chunk.usageMetadata),
        },
      };
    }

    yield {
      type: 'result',
      subtype: 'success',
      total_cost_usd: GEMINI_COST_USD,
      num_turns: turn,
      usage: usageToWire(lastUsage),
    };
  }
  return stream();
}) as unknown as QueryFn;

/**
 * The exported `query`. When the dep/creds are absent the function still exists
 * (the interface requires it) but the stream throws a clear error on first
 * iteration rather than silently yielding nothing — fail fast at the boundary.
 */
const geminiQuery: QueryFn = liveQuery;

// ---------------------------------------------------------------------------
// Chunk → forge content blocks
// ---------------------------------------------------------------------------

/**
 * Translates one Gemini chunk into the array of `{type:'text'|'tool_use'}`
 * blocks the Claude-shaped consumer understands. Tool use (functionCall) is
 * mapped to a `tool_use` block with `name` + `input` so any consumer that
 * inspects tool usage (file-change extraction, observability) sees a uniform
 * shape across SDKs.
 */
function chunkToContentBlocks(chunk: GeminiChunk): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [];

  // Prefer the explicit parts (carry both text and functionCall); fall back to
  // the `.text` convenience getter when no structured parts are present.
  const parts = collectParts(chunk);
  if (parts.length > 0) {
    for (const part of parts) {
      if (typeof part.text === 'string' && part.text.length > 0) {
        blocks.push({ type: 'text', text: part.text });
      }
      if (part.functionCall && typeof part.functionCall.name === 'string') {
        blocks.push(functionCallToToolUse(part.functionCall));
      }
    }
    return blocks;
  }

  if (typeof chunk.text === 'string' && chunk.text.length > 0) {
    blocks.push({ type: 'text', text: chunk.text });
  }
  if (Array.isArray(chunk.functionCalls)) {
    for (const fc of chunk.functionCalls) {
      if (typeof fc.name === 'string') blocks.push(functionCallToToolUse(fc));
    }
  }
  return blocks;
}

function collectParts(chunk: GeminiChunk): GeminiPart[] {
  if (!Array.isArray(chunk.candidates)) return [];
  const parts: GeminiPart[] = [];
  for (const cand of chunk.candidates) {
    const candParts = cand.content?.parts;
    if (Array.isArray(candParts)) parts.push(...candParts);
  }
  return parts;
}

function functionCallToToolUse(fc: GeminiFunctionCall): Record<string, unknown> {
  return {
    type: 'tool_use',
    id: typeof fc.id === 'string' ? fc.id : undefined,
    name: fc.name,
    input: fc.args ?? {},
  };
}

/**
 * Maps Gemini's usageMetadata onto the snake_case `usage` block the rest of
 * forge reads (the Claude SDK shape). Missing counts default to 0.
 *   promptTokenCount        → input_tokens
 *   candidatesTokenCount    → output_tokens
 *   cachedContentTokenCount → cache_read_input_tokens
 *   (Gemini has no cache-creation token count → 0)
 */
function usageToWire(u: GeminiUsageMetadata | undefined): {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
} {
  return {
    input_tokens: numOr0(u?.promptTokenCount),
    output_tokens: numOr0(u?.candidatesTokenCount),
    cache_read_input_tokens: numOr0(u?.cachedContentTokenCount),
    cache_creation_input_tokens: 0,
  };
}

function numOr0(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0;
}

// ---------------------------------------------------------------------------
// createAgent — one Ralph iteration
// ---------------------------------------------------------------------------

const FILE_MODIFYING_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/**
 * Returns an AgentInvocation. One call = one Ralph iteration: read PROMPT.md,
 * drive `query` (real or injected), fold the stream into AgentIterationInfo.
 *
 * NOTE on the dev-loop semantics: the bare Gemini `generateContent` API has no
 * built-in tool EXECUTOR (unlike the Claude Agent SDK, which runs a coding
 * harness). This adapter surfaces Gemini's *intended* tool calls (functionCall
 * blocks) in `toolsUsed` / `filesChanged`, mirroring the Claude adapter's
 * observability contract, but does not itself apply edits to the worktree —
 * wiring a tool executor is a follow-up (see liveGap in the build report). The
 * adapter is contract-complete: it satisfies RuntimeAdapter and the conformance
 * suite under an injected stream today.
 */
function createGeminiAgent(opts: GeminiAgentOptions = {}): AgentInvocation {
  const queryFn: QueryFn = opts.queryFn ?? geminiQuery;
  const model = resolveModel(opts);

  return async ({ promptPath }): Promise<AgentIterationInfo> => {
    const prompt = readFileSync(promptPath, 'utf8');

    const options: Record<string, unknown> = { model };
    if (typeof opts.systemPrompt === 'string') options.systemPrompt = opts.systemPrompt;
    if (typeof opts.maxOutputTokens === 'number') options.maxOutputTokens = opts.maxOutputTokens;

    const filesChanged = new Set<string>();
    const toolsUsed: NonNullable<AgentIterationInfo['toolsUsed']> = [];
    const bashCommands: string[] = [];
    let lastAssistantText = '';
    let tokensIn = 0;
    let tokensOut = 0;
    let cacheReadTokens = 0;
    let costUsd = 0;

    for await (const msg of queryFn({ prompt, options })) {
      const m = msg as { type?: string };
      if (m.type === 'assistant') {
        const message = (m as { message?: { content?: unknown; usage?: unknown } }).message;
        const content = message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            const b = block as { type?: string; name?: string; input?: unknown; text?: string };
            if (b.type === 'text' && typeof b.text === 'string') {
              // Gemini streams INCREMENTAL text deltas (one assistant message per
              // chunk), unlike the Claude SDK which emits complete messages —
              // accumulate, or only the last fragment survives a multi-chunk reply.
              lastAssistantText += b.text;
              continue;
            }
            if (b.type === 'tool_use' && typeof b.name === 'string') {
              toolsUsed.push({ name: b.name, inputSummary: summarizeInput(b.input) });
              const path = extractPath(b.input);
              if (path && FILE_MODIFYING_TOOLS.has(b.name)) filesChanged.add(path);
              const cmd = extractBashCommand(b.name, b.input);
              if (cmd) bashCommands.push(truncate(cmd, 200));
            }
          }
        }
        const u = parseUsage(message?.usage);
        if (u) {
          tokensIn = u.input_tokens;
          tokensOut = u.output_tokens;
          cacheReadTokens = u.cache_read_input_tokens;
        }
      } else if (m.type === 'result') {
        const r = m as { total_cost_usd?: number; usage?: unknown };
        if (typeof r.total_cost_usd === 'number') costUsd = r.total_cost_usd;
        const u = parseUsage(r.usage);
        if (u) {
          tokensIn = u.input_tokens;
          tokensOut = u.output_tokens;
          cacheReadTokens = u.cache_read_input_tokens;
        }
      }
    }

    return {
      filesChanged: [...filesChanged],
      costUsd,
      toolsUsed,
      bashCommands,
      lastAssistantText: truncate(lastAssistantText, 2000),
      tokensIn,
      tokensOut,
      cacheReadTokens,
      cacheCreationTokens: 0,
    };
  };
}

// ---------------------------------------------------------------------------
// Small helpers (local — no shared edits)
// ---------------------------------------------------------------------------

function parseUsage(usage: unknown): {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
} | null {
  if (typeof usage !== 'object' || usage === null) return null;
  const u = usage as Record<string, unknown>;
  return {
    input_tokens: numOr0(u.input_tokens),
    output_tokens: numOr0(u.output_tokens),
    cache_read_input_tokens: numOr0(u.cache_read_input_tokens),
  };
}

function extractPath(input: unknown): string | null {
  if (typeof input !== 'object' || input === null) return null;
  const obj = input as Record<string, unknown>;
  const candidate = obj.file_path ?? obj.notebook_path ?? obj.path;
  return typeof candidate === 'string' ? candidate : null;
}

function extractBashCommand(name: string, input: unknown): string | null {
  if (name !== 'Bash') return null;
  if (typeof input !== 'object' || input === null) return null;
  const cmd = (input as { command?: unknown }).command;
  return typeof cmd === 'string' ? cmd : null;
}

function summarizeInput(input: unknown): string {
  if (input === null || input === undefined) return '';
  try {
    return truncate(JSON.stringify(input), 200);
  } catch {
    return '';
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

// ---------------------------------------------------------------------------
// Adapter export
// ---------------------------------------------------------------------------

export const geminiAdapter: RuntimeAdapter = {
  id: 'gemini',
  available: isAvailable,
  createAgent: (opts: AdapterAgentOptions) => createGeminiAgent(opts),
  query: geminiQuery,
};

/**
 * Test seam: re-export the pure helpers + a probe of the gating inputs so the
 * conformance/contract test can assert the dep+creds gate without a live key.
 * Not part of the RuntimeAdapter contract — internal, but exported so the test
 * stays in the same module's blast radius (no shared-file edits).
 */
export const __testing = {
  resolveApiKey,
  resolveModel,
  usageToWire,
  chunkToContentBlocks,
  depPresent: () => depPresent,
  credsPresent: () => credsPresent,
  createGeminiAgent,
  DEFAULT_MODEL,
  API_KEY_ENV_VARS,
};
