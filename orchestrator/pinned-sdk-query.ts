/**
 * G8 (2026-07 refinement; hardened to an allowlist R5-02) env-pin seam: the
 * single wrapper around the Claude Agent SDK's `query` that every production
 * import site must use instead of importing `query` directly.
 *
 * `buildChildEnv` (./spawn-env.ts) is the actual allowlist logic; this
 * file's only job is threading it through `options.env` on every call so a
 * spawned child NEVER inherits an unlisted ambient var (ANTHROPIC_BASE_URL,
 * ANTHROPIC_CUSTOM_HEADERS, CLAUDE_EFFORT, HEADROOM_*, or anything else not
 * explicitly allowlisted) from `process.env`, which is the SDK's own
 * default for `Options.env` when the caller doesn't set it.
 *
 * `params.options?.env` — when a caller DOES set it — is treated as
 * deliberate OVERRIDES the caller composes itself (e.g. the git-identity SDK
 * overlay's four `GIT_AUTHOR_*`/`GIT_COMMITTER_*` keys in
 * `loops/ralph/claude-agent.ts`), not an alternate ambient source to filter:
 * they always win, layered on top of an allowlist-filtered snapshot of the
 * REAL `process.env`. See spawn-env.ts's `buildChildEnv` doc for why this
 * split is safe (only forge's own code sets `options.env`, never ambient
 * host state).
 *
 * Placement: orchestrator/, not loops/. `loops/ralph/claude-agent.ts` (a
 * loops/ file) already imports `orchestrator/stream-deadline.ts` — so
 * orchestrator/ -> loops/ and loops/ -> orchestrator/ edges already coexist
 * in this codebase at the individual-file level without forming an import
 * cycle. This file adds one more loops/ -> orchestrator/ edge; `./spawn-env.ts`
 * has no dependency path back into loops/, so no cycle is introduced.
 *
 * `orchestrator/pinned-sdk-query.enforce.test.ts` is the structural lock:
 * every other file under orchestrator/, loops/, cli/ that imports `query` as
 * a value (not a type) from '@anthropic-ai/claude-agent-sdk' fails that test.
 */

import { query as rawSdkQuery, type Options, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { buildChildEnv } from './spawn-env.ts';

/** The exact shape of the SDK's `query` function. */
export type SdkQueryFn = (params: { prompt: string | AsyncIterable<SDKUserMessage>; options?: Options }) => Query;

/**
 * Build a `query`-compatible function that pins `options.env` via
 * `buildChildEnv` on every call before delegating to `queryImpl`. Exported
 * as a factory (rather than only the bound `pinnedSdkQuery` below) so tests
 * can inject a fake `queryImpl` and assert the env-pinning behaviour without
 * spawning a real SDK child.
 *
 * The real, unfiltered `process.env` is always the ambient source — NOT
 * `params.options?.env` — so a caller-supplied `options.env` never needs to
 * (and must never) pre-merge process.env itself; it only needs to carry the
 * small delta it actually wants to override.
 */
export function createPinnedSdkQuery(queryImpl: SdkQueryFn): SdkQueryFn {
  return (params) =>
    queryImpl({
      ...params,
      options: { ...params.options, env: buildChildEnv(process.env, params.options?.env ?? {}) },
    });
}

/**
 * The one seam every production `query()` call site under orchestrator/ and
 * loops/ must import instead of importing `query` from the SDK package
 * directly.
 */
export const pinnedSdkQuery: SdkQueryFn = createPinnedSdkQuery(rawSdkQuery);
