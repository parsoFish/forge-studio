/**
 * Claude reference adapter (M6-1, ADR 029).
 *
 * Wraps `createClaudeAgent` (loops/ralph/claude-agent.ts) + the SDK's `query`
 * function into the `RuntimeAdapter` interface. This is the new public seam;
 * the underlying implementation stays in place at loops/ralph/claude-agent.ts
 * to avoid import churn across the ~15 existing sites.
 *
 * Behaviour-identical: createClaudeAgent is called with the same options it
 * always received — the wrapper adds zero logic. The full existing test suite
 * (1036 tests) passes unchanged because no existing code is modified.
 *
 * Physical layout note (ADR 029 §Decision/M6-1):
 *   Logical home:   loops/_adapters/claude/  ← this file
 *   Implementation: loops/ralph/claude-agent.ts  ← unchanged
 * A later refactor can move the implementation under _adapters/claude/ if
 * desired; the move would be purely mechanical at that point.
 */

import { createClaudeAgent } from '../../ralph/claude-agent.ts';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type { RuntimeAdapter, AdapterAgentOptions, QueryFn } from '../types.ts';

export const claudeAdapter: RuntimeAdapter = {
  id: 'claude',
  available: true,
  createAgent: (opts: AdapterAgentOptions) => createClaudeAgent(opts),
  query: sdkQuery as unknown as QueryFn,
};
