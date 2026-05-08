---
source_type: docs
source_url: docs/decisions/001-claude-agent-sdk.md
source_title: ADR 001 — Claude Agent SDK as the agent runtime
ingested_at: 2026-05-04T17:55:00Z
ingested_by: brain-ingest (Pass A, batch 1)
cycle_id: pass-a-bootstrap
---

# ADR 001 — Claude Agent SDK as the agent runtime

**Status:** Accepted (scaffold)
**Date:** 2026-04-24

## Context

V2 needs an underlying runtime to invoke Claude models with tool use, context management, and (where useful) subagents. V1 spawned the `claude` CLI as subprocesses, parsed streaming JSON, and handled session/context concerns itself. That worked, but every Claude Code platform improvement (subagents, hooks, MCP, headless mode, V2 preview) had to be re-plumbed by hand.

## Decision

Use the **first-party `@anthropic-ai/claude-agent-sdk`** as the runtime for every TypeScript-side agent invocation. The Ralph loop driver in `loops/ralph/runner.ts` calls `query()` from the SDK. The orchestrator's `cycle.ts` invokes Claude Code skills via the SDK rather than shelling to the CLI. Subagents, headless mode, hooks, and MCP servers are accessed via the SDK's published surface.

## Consequences

- TypeScript-native — drops directly into v2's TS orchestrator with no IPC or process-shelling tax.
- Anthropic-maintained — subagents/hooks/MCP improvements arrive as version bumps, not re-implementation work.
- Trade-off accepted: Anthropic-only models. v1 already standardised on Claude. If portability later matters, add an Aider adapter under `loops/_adapters/`.

## Alternatives considered

- **Aider** — Python; would require shelling out from TS. Strong runner-up if Anthropic lock-in becomes a concern.
- **OpenHands**, **OpenClaw**, **Hermes Agent** — each duplicates layers forge already owns (memory, orchestration, job runtime).
- **Continue spawning the `claude` CLI as subprocesses** — what v1 did. Strictly more work and strictly less leverage.

## References

- Claude Agent SDK — TypeScript reference: https://docs.claude.com/en/docs/agent-sdk/typescript
- Subagents in the SDK: https://docs.claude.com/en/docs/agent-sdk/subagents
- Run Claude Code programmatically (headless): https://docs.claude.com/en/docs/agent-sdk/headless

## Canonical path

`docs/decisions/001-claude-agent-sdk.md` (this raw is a frozen ingest snapshot)
