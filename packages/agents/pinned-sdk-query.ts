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
 * `packages/agents/ralph/claude-agent.ts`), not an alternate ambient source to filter:
 * they always win, layered on top of an allowlist-filtered snapshot of the
 * REAL `process.env`. See spawn-env.ts's `buildChildEnv` doc for why this
 * split is safe (only forge's own code sets `options.env`, never ambient
 * host state).
 *
 * Placement: orchestrator/, not loops/. `packages/agents/ralph/claude-agent.ts` (a
 * loops/ file) already imports `packages/agents/stream-deadline.ts` — so
 * orchestrator/ -> loops/ and loops/ -> orchestrator/ edges already coexist
 * in this codebase at the individual-file level without forming an import
 * cycle. This file adds one more loops/ -> orchestrator/ edge; `./spawn-env.ts`
 * has no dependency path back into loops/, so no cycle is introduced.
 *
 * `packages/agents/pinned-sdk-query.enforce.test.ts` is the structural lock:
 * every other file under orchestrator/, loops/, cli/ that imports `query` as
 * a value (not a type) from '@anthropic-ai/claude-agent-sdk' fails that test.
 */

import { query as rawSdkQuery, type Options, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { buildChildEnv } from '@forge/kernel/spawn-env.ts';
import { markerEnvOverlay } from './spawn-marker.ts';

/** The exact shape of the SDK's `query` function. */
export type SdkQueryFn = (params: { prompt: string | AsyncIterable<SDKUserMessage>; options?: Options }) => Query;

/**
 * The loosened stream-call shape every direct-stream consumer (the phase
 * pipelines' DI seams, `runAgent`'s one-shot path, the Ralph adapter's
 * QueryFn) actually invokes: a plain-record options bag and an opaque
 * async-iterable of SDK messages. One shared type so those seams stop
 * re-deriving structurally-identical local aliases and double-casting
 * through `SdkQueryFn` (R4-01 review finding).
 */
export type StreamQueryFn = (params: {
  prompt: string;
  options: Record<string, unknown>;
}) => AsyncIterable<unknown>;


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

/**
 * `pinnedSdkQuery` viewed through the loosened stream shape — the ONE place
 * the structural cast lives. Sound at runtime: the SDK's `query` accepts a
 * plain options record (Options is a plain object type) and its `Query`
 * return IS an AsyncIterable.
 */
export const pinnedStreamQuery: StreamQueryFn = pinnedSdkQuery as unknown as StreamQueryFn;

/**
 * Wrap a stream query so every spawn it makes carries `token` as one env
 * OVERRIDE — bead `forge-8vfn.5.50`, "the runtime owns what it spawns".
 *
 * WHERE THIS SITS, AND WHY IT SITS HERE. The marker is an env concern, so it
 * belongs at the env seam — the same one `createPinnedSdkQuery` already owns.
 * The alternative (adding `env` to the option bag each phase builds) was
 * measured and rejected: it puts a per-run UUID inside all FIVE spawn-capture
 * goldens, which exist to pin "the exact `{prompt, options}` object each PHASE
 * passes" and deliberately sit ABOVE this seam — the allowlist filtering below
 * is invisible to them for exactly the same reason. A containment property of
 * the runtime is not a phase's spawn decision, and recording it as one would
 * mean re-pinning five characterization fixtures plus their normalizer every
 * time the token shape changed.
 *
 * The caller's own `options.env` (the git-identity overlay's four keys) is
 * PRESERVED and the marker layered on top: five keys, well inside
 * `MAX_ENV_OVERRIDE_KEYS` (8) — a cap that throws by design, so the
 * interaction is pinned in `./spawn-marker.test.ts` rather than assumed.
 */
export function withRunMarker(query: StreamQueryFn, token: string): StreamQueryFn {
  return (params) =>
    query({
      ...params,
      options: {
        ...params.options,
        env: { ...((params.options?.['env'] as Record<string, string> | undefined) ?? {}), ...markerEnvOverlay(token) },
      },
    });
}

/**
 * The query a run actually spawns through: the marked production query, or a
 * caller-injected one used verbatim.
 *
 * `injected` is TEST-INJECTION ONLY (`RunContext.queryFn`'s own contract, and
 * every production phase leaves it undefined — `adversarial-review`,
 * `demo-agent`, `band-agent-run` and `reflector` all declare it optional and
 * pass nothing). Returning it UNWRAPPED is what keeps the five spawn-capture
 * goldens byte-identical: a capturing stub records the phase's own option bag,
 * not the runtime's env delta. `productionQuery` is a parameter with a real
 * default so this branch is testable without spawning anything.
 */
export function resolveRunQuery(
  injected: StreamQueryFn | undefined,
  runMarker: string,
  productionQuery: StreamQueryFn = pinnedStreamQuery,
): StreamQueryFn {
  return injected ?? withRunMarker(productionQuery, runMarker);
}
