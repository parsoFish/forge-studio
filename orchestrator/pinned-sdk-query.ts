/**
 * G8 (2026-07 refinement) env-pin seam: the single wrapper around the Claude
 * Agent SDK's `query` that every production import site must use instead of
 * importing `query` directly.
 *
 * `pinnedAgentEnv` (./config.ts) is the actual denylist/scrub logic; this
 * file's only job is threading it through `options.env` on every call so a
 * spawned child never inherits a host-leakage var (ANTHROPIC_BASE_URL,
 * ANTHROPIC_CUSTOM_HEADERS, CLAUDE_EFFORT, HEADROOM_*) from `process.env`,
 * which is the SDK's own default for `Options.env` when the caller doesn't
 * set it.
 *
 * Placement: orchestrator/, not loops/. `loops/ralph/claude-agent.ts` (a
 * loops/ file) already imports `orchestrator/stream-deadline.ts` — so
 * orchestrator/ -> loops/ and loops/ -> orchestrator/ edges already coexist
 * in this codebase at the individual-file level without forming an import
 * cycle. This file adds one more loops/ -> orchestrator/ edge; `./config.ts`
 * has no dependency path back into loops/, so no cycle is introduced.
 * Co-locating with `pinnedAgentEnv` (rather than duplicating the scrub logic
 * in loops/) keeps it a single source of truth reachable from both sides.
 *
 * `orchestrator/pinned-sdk-query.enforce.test.ts` is the structural lock:
 * every other file under orchestrator/, loops/, cli/ that imports `query` as
 * a value (not a type) from '@anthropic-ai/claude-agent-sdk' fails that test.
 */

import { query as rawSdkQuery, type Options, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { pinnedAgentEnv } from './config.ts';

/** The exact shape of the SDK's `query` function. */
export type SdkQueryFn = (params: { prompt: string | AsyncIterable<SDKUserMessage>; options?: Options }) => Query;

/**
 * Build a `query`-compatible function that pins `options.env` via
 * `pinnedAgentEnv` on every call before delegating to `queryImpl`. Exported
 * as a factory (rather than only the bound `pinnedSdkQuery` below) so tests
 * can inject a fake `queryImpl` and assert the env-pinning behaviour without
 * spawning a real SDK child.
 */
export function createPinnedSdkQuery(queryImpl: SdkQueryFn): SdkQueryFn {
  return (params) =>
    queryImpl({
      ...params,
      options: { ...params.options, env: pinnedAgentEnv(params.options?.env) },
    });
}

/**
 * The one seam every production `query()` call site under orchestrator/ and
 * loops/ must import instead of importing `query` from the SDK package
 * directly.
 */
export const pinnedSdkQuery: SdkQueryFn = createPinnedSdkQuery(rawSdkQuery);
