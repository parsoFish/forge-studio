/**
 * Claude Agent SDK adapter for the Ralph loop.
 *
 * Provides `createClaudeAgent(opts)` which returns an `AgentInvocation` (the
 * shape `runner.ts` expects). One call ≈ one Ralph iteration: read PROMPT.md,
 * call the SDK's `query()` against the worktree, surface files-changed via
 * tool_use events and cost via the final `result` message.
 *
 * The SDK's `query` is dependency-injectable (`opts.queryFn`) so unit tests
 * can verify the glue without hitting the network.
 *
 * Wired per ADR 001 (Claude Agent SDK) and ADR 002 (Ralph loop pattern).
 */

import { readFileSync } from 'node:fs';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';

import type { AgentInvocation } from './runner.ts';

/** Subset of the SDK's `query` shape we depend on — keeps the tests independent of SDK internals. */
export type QueryFn = (params: {
  prompt: string;
  options?: Record<string, unknown>;
}) => AsyncIterable<unknown>;

export type ClaudeAgentOptions = {
  /** e.g. 'claude-sonnet-4-6'. Defaults to the SDK's CLI default. */
  model?: string;
  /** Tool allowlist. Defaults to the read/write/exec set Ralph needs. */
  allowedTools?: string[];
  /** Tool denylist. SDK treats this as "block even if allowedTools includes it". */
  disallowedTools?: string[];
  /** Cap turns per iteration (one Ralph iteration = one query() call). */
  maxTurnsPerIteration?: number;
  /** Cap USD spend per iteration. */
  maxBudgetUsdPerIteration?: number;
  /** SDK permission mode. Defaults to 'acceptEdits' for unattended operation. */
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk';
  /** Optional system-prompt override. */
  systemPrompt?: string;
  /** Inject a fake `query` for testing. */
  queryFn?: QueryFn;
};

const DEFAULT_ALLOWED_TOOLS = ['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'Grep', 'Glob'];
const FILE_MODIFYING_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

export function createClaudeAgent(opts: ClaudeAgentOptions = {}): AgentInvocation {
  const queryFn: QueryFn = opts.queryFn ?? (sdkQuery as unknown as QueryFn);

  return async ({ promptPath, worktreePath }) => {
    const prompt = readFileSync(promptPath, 'utf8');

    const options: Record<string, unknown> = {
      cwd: worktreePath,
      allowedTools: opts.allowedTools ?? DEFAULT_ALLOWED_TOOLS,
      permissionMode: opts.permissionMode ?? 'acceptEdits',
    };
    if (opts.disallowedTools !== undefined) options.disallowedTools = opts.disallowedTools;
    if (opts.model !== undefined) options.model = opts.model;
    if (opts.maxTurnsPerIteration !== undefined) options.maxTurns = opts.maxTurnsPerIteration;
    if (opts.maxBudgetUsdPerIteration !== undefined) options.maxBudgetUsd = opts.maxBudgetUsdPerIteration;
    if (opts.systemPrompt !== undefined) options.systemPrompt = opts.systemPrompt;

    const filesChanged = new Set<string>();
    let costUsd = 0;

    for await (const msg of queryFn({ prompt, options })) {
      const m = msg as { type?: string };
      if (m.type === 'assistant') {
        const content = (m as { message?: { content?: unknown } }).message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            const b = block as { type?: string; name?: string; input?: unknown };
            if (b.type !== 'tool_use' || !b.name || !FILE_MODIFYING_TOOLS.has(b.name)) continue;
            const path = extractPath(b.input);
            if (path) filesChanged.add(path);
          }
        }
      } else if (m.type === 'result') {
        const r = m as { total_cost_usd?: number };
        if (typeof r.total_cost_usd === 'number') costUsd = r.total_cost_usd;
      }
    }

    return { filesChanged: [...filesChanged], costUsd };
  };
}

function extractPath(input: unknown): string | null {
  if (typeof input !== 'object' || input === null) return null;
  const obj = input as Record<string, unknown>;
  const candidate = obj.file_path ?? obj.notebook_path ?? obj.path;
  return typeof candidate === 'string' ? candidate : null;
}
