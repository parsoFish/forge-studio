# Headroom token-efficiency trial (M8-G)

> Status: **runbook + assessment** — the install + live measurement are
> operator-gated (heavy dep + a real cycle). This documents how to trial
> [headroom](https://github.com/chopratejas/headroom) against forge and the
> decision criteria, so the measurement is a one-step operator action.

## What headroom is (verified 2026-06-14)

A context-compression layer that compresses what an agent reads — tool outputs,
logs, RAG chunks, files, conversation history — before it reaches the LLM,
claiming 60–95% token reduction with accuracy preserved. Apache-2.0, ~26.6k
stars, v0.25.0. Core is Python (78%) / Rust (17%) with a thin TypeScript binding
(2.5%). Mechanisms: SmartCrusher (JSON pruning), CodeCompressor (AST-aware),
Kompress-base (a HuggingFace model trained on agentic traces), CacheAligner
(prefix stabilisation for KV-cache hits), CCR (reversible compression with local
originals + on-demand retrieval).

Integration surfaces: a library (`compress()`), an HTTP proxy
(`headroom proxy`), CLI agent-wrapping (`headroom wrap`), and an MCP server
(`headroom_compress`/`headroom_retrieve`/`headroom_stats`).

## Fit to forge (important nuance)

Forge agents run on the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`
via `loops/ralph/claude-agent.ts` + the phase invocations), **not** the Claude
Code CLI. So `headroom wrap claude` and the Claude-Code MCP path do **not**
directly apply. The realistic forge integration points, cheapest first:

1. **HTTP proxy** (`headroom proxy --port 8787`) in front of the Anthropic API,
   with the SDK pointed at it (base-URL/env override). Zero forge code change if
   the SDK honours a base-URL override; compresses in-flight. *Risk:* the SDK's
   endpoint config + whether headroom faithfully proxies Anthropic's streaming
   API is unverified — confirm before relying on it.
2. **TS library** (`headroom-ai`) compressing **tool outputs** before they
   re-enter the agent's context in the Ralph loop — the highest-value target,
   since the dev-loop's per-WI Ralph iterations accumulate large Read/Bash
   outputs. A focused change in `claude-agent.ts` / the tool-result path. *Risk:*
   the TS binding is a thin wrapper over the Python/Rust core; stability at scale
   is unproven.
3. **MCP server** — only useful if forge ever exposes a tool-calling surface the
   agents can invoke; not the current shape. Skip for now.

## Trial plan (when provisioned)

1. **Baseline.** Forge already logs token usage: `usage_delta` events
   (input/output/cache tokens per turn) + authoritative `cost_usd` per cycle in
   the JSONL event log. Run a **frozen-SHA routine `verify:cycle`**
   (`npm run verify:cycle -- --tier routine`) and record total tokens + cost +
   wall-clock from the event log. This is the no-headroom baseline.
2. **Trial.** Stand up `headroom proxy`; point the SDK at it (or wire option 2).
   Re-run the **same frozen-SHA** initiative. Record the same metrics.
3. **Compare.** Token delta, cost delta, and — critically — **outcome parity**:
   did the cycle still reach a merged PR with project tests green
   (the ADR-022 outcome assertions)? Compression that saves tokens but drops
   cycle success is a regression.

## Decision criteria

- **Adopt (wire option 2)** if: ≥30% token/cost reduction on the dev-loop with
  full outcome parity across ≥2 frozen-SHA runs.
- **Keep proxy-only / opt-in** if: meaningful savings but any outcome flakiness,
  or the savings are concentrated in one phase.
- **Skip** if: <15% savings (forge already strips the brain nav index for the
  dev-loop, F-34, and per-WI Ralph wipes scratch between WIs — the accumulation
  headroom targets may already be modest), or any accuracy/outcome regression,
  or the proxy can't faithfully carry the SDK's streaming + tool-use protocol.

## Why not measured here

The install is a heavy ask-first dependency (Python + Rust toolchain + a
HuggingFace model download) and the measurement needs a real cycle (creds +
real-money, the same gate as `verify:cycle`). Both are operator actions. This
runbook makes the trial reproducible in one sitting once those are in place.
