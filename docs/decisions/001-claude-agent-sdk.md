# ADR 001 — Claude Agent SDK as the agent runtime

**Status:** Accepted (scaffold)
**Date:** 2026-04-24

## Context

Forge needs an underlying runtime to invoke Claude models with tool use, context management, and (where useful) subagents. The prior approach spawned the `claude` CLI as subprocesses, parsed streaming JSON, and handled session/context concerns itself. That worked, but every Claude Code platform improvement (subagents, hooks, MCP, headless mode) had to be re-plumbed by hand.

## Decision

Use the **first-party [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)** as the runtime for every TypeScript-side agent invocation. Specifically:

- The Ralph loop driver in [`loops/ralph/runner.ts`](../../loops/ralph/runner.ts) calls `query()` from the SDK.
- The orchestrator's `cycle.ts` invokes Claude Code skills via the SDK rather than shelling to the CLI.
- Subagents (parallel, isolated context, per-agent tool/model config) use the SDK's native subagent support.
- Headless mode + hooks + MCP servers are accessed via the SDK's published surface.

## Consequences

**Positive:**
- TypeScript-native — drops directly into the TS orchestrator with no IPC or process-shelling tax.
- Anthropic-maintained — subagents/hooks/MCP improvements arrive as version bumps, not re-implementation work.
- The SDK removes async-generator friction.
- Same primitives (skills, MCP, hooks) forge already uses elsewhere.

**Negative / accepted trade-offs:**
- Anthropic-only models. Forge standardised on Claude, so no real loss; the runtime-adapter seam ([ADR 029](./029-runtime-adapters.md)) is where portability lands — non-Claude adapters (Gemini, Aider) are registered under `loops/_adapters/`, dep+creds-gated until provisioned.
- Bundles a native Claude Code binary as an optional dep — slightly larger install footprint.

## Alternatives considered

- **Aider** ([aider.chat](https://aider.chat/)) — Python; would require shelling out from TS. Strong runner-up if Anthropic lock-in becomes a concern; it now ships as a registered runtime adapter under `loops/_adapters/aider/` (ADR 029).
- **OpenHands**, **OpenClaw**, **Hermes Agent** — each duplicates layers forge already owns (memory, orchestration, job runtime). Adopting them means rewriting forge around their assumptions, the opposite of the "small core, plug in big tools" thesis.
- **Continue spawning the `claude` CLI as subprocesses** — the prior approach. Strictly more work and strictly less leverage than the SDK; rejected.

## References

- [Claude Agent SDK — TypeScript reference](https://docs.claude.com/en/docs/agent-sdk/typescript)
- [Subagents in the SDK](https://docs.claude.com/en/docs/agent-sdk/subagents)
- [Run Claude Code programmatically (headless)](https://docs.claude.com/en/docs/agent-sdk/headless)
