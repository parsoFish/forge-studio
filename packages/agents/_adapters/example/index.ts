/**
 * Example adapter — dependency-free in-repo mock (M6-2, ADR 029).
 *
 * Proves that a SECOND runtime adapter can plug into the RuntimeAdapter
 * interface without importing any external SDK. This is the reference
 * template for future real adapters (Codex / Gemini / local-model).
 *
 * To add a real SDK adapter:
 *   1. Copy this file to loops/_adapters/<sdk>/index.ts.
 *   2. Replace the deterministic mock body with real SDK calls.
 *   3. Run loops/_adapters/conformance.ts against it — it must pass.
 *   4. Register it in loops/_adapters/registry.ts.
 *   5. Install the dep (ask-first event per PRINCIPLES.md).
 *
 * Contract satisfied:
 *   id           'example' — distinct from 'claude'; safe to co-register.
 *   available    true — the mock has no missing dep.
 *   createAgent  returns an AgentInvocation that resolves deterministically
 *                without touching the filesystem or any external service.
 *   query        an async generator yielding a minimal-but-valid message
 *                stream (assistant message + result message) so anything
 *                consuming query() receives a well-formed stream.
 */

import type { RuntimeAdapter, AdapterAgentOptions, QueryFn } from '../types.ts';
import type { AgentInvocation, AgentIterationInfo } from '../../ralph/runner.ts';

// ---------------------------------------------------------------------------
// query — minimal valid message stream
// ---------------------------------------------------------------------------

/**
 * Yields the minimum two-message sequence that `createClaudeAgent`'s
 * `for await` loop would see from a real SDK call:
 *   1. An `assistant` message carrying a text content block.
 *   2. A `result` message carrying total_cost_usd + usage zeros.
 *
 * Shape mirrors what claude-agent.ts expects so the conformance suite can
 * drive _this_ query through the Claude adapter's createAgent loop (mock
 * injection via opts.queryFn) and confirm the adapter handles it correctly.
 */
const exampleQuery: QueryFn = ((_params: { prompt: string; options?: Record<string, unknown> }) => {
  async function* stream() {
    // assistant turn — one text block
    yield {
      type: 'assistant',
      message: {
        id: 'example-msg-1',
        content: [{ type: 'text', text: 'example adapter: no SDK invoked' }],
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    };
    // result — authoritative cost + usage totals
    yield {
      type: 'result',
      subtype: 'success',
      total_cost_usd: 0,
      num_turns: 1,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    };
  }
  return stream();
}) as unknown as QueryFn;

// ---------------------------------------------------------------------------
// createAgent — deterministic AgentInvocation
// ---------------------------------------------------------------------------

/**
 * Returns an AgentInvocation that resolves immediately with a well-formed
 * AgentIterationInfo. Does NOT read the filesystem or call any SDK.
 *
 * The `promptPath` is echoed in `lastAssistantText` so callers can verify
 * the correct params were forwarded during conformance tests.
 */
function exampleCreateAgent(_opts: AdapterAgentOptions): AgentInvocation {
  return async (params): Promise<AgentIterationInfo> => {
    return {
      filesChanged: [],
      costUsd: 0,
      toolsUsed: [],
      bashCommands: [],
      lastAssistantText: `example adapter: ${params.promptPath}`,
      tokensIn: 0,
      tokensOut: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    };
  };
}

// ---------------------------------------------------------------------------
// Adapter export
// ---------------------------------------------------------------------------

export const exampleAdapter: RuntimeAdapter = {
  id: 'example',
  available: true,
  createAgent: exampleCreateAgent,
  query: exampleQuery,
};
