---
title: Claude Agent SDK as the agent runtime
description: First-party @anthropic-ai/claude-agent-sdk powers every TS-side agent invocation in forge v2.
category: pattern
keywords: [claude-agent-sdk, anthropic, runtime, subagents, headless, mcp, hooks]
created_at: 2026-05-04T17:55:00Z
updated_at: 2026-05-04T17:55:00Z
related_themes: [ralph-loop-pattern, skills-as-agent-surface]
---

# Claude Agent SDK as the agent runtime

Forge v2 uses the first-party [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) for every agent invocation rather than spawning the `claude` CLI as subprocesses (v1's approach). Subagents, headless mode, hooks, and MCP servers all come from the SDK — Anthropic-maintained, version-bumped, no re-implementation tax.

The Ralph loop driver (`loops/ralph/runner.ts`) calls `query()` from the SDK. The orchestrator's `cycle.ts` invokes Claude Code skills via the SDK. Subagents (parallel, isolated context, per-agent tool/model config) use the SDK's native subagent support.

Trade-off: Anthropic-only models. v1 already standardised on Claude. If portability later matters, an Aider adapter under `loops/_adapters/` is the documented escape hatch.

## Sources

- [`adr-001-claude-agent-sdk.docs.md`](../../_raw/docs/adr-001-claude-agent-sdk.docs.md) — the decision record + alternatives considered.

## Related

- [Theme: Ralph loop pattern](./ralph-loop-pattern.md) — what the SDK powers.
- [Theme: Skills as agent surface](./skills-as-agent-surface.md) — what the SDK invokes.
