---
title: Claude Agent SDK subagents
description: >-
  Specialised agents declared inline in options.agents, invoked by the main
  agent via the Agent tool. Each has its own tools, model, maxTurns,
  permissionMode. Can run background.
category: pattern
keywords:
  - subagents
  - claude-agent-sdk
  - delegation
  - parallel
  - isolated-context
  - background
  - agent-tool
created_at: 2026-05-04T18:00:00.000Z
updated_at: 2026-05-04T18:00:00.000Z
related_themes:
  - claude-agent-sdk
  - ralph-loop-pattern
  - llm-council-pattern
---

# Claude Agent SDK subagents

The SDK lets the main agent delegate work to specialised subagents declared inline in `options.agents`:

```ts
const options = {
  agents: {
    "code-review": {
      description: "Reviews code changes",
      prompt: "You are a code reviewer...",
      tools: ["Read", "Grep"],
      model: "sonnet",
      maxTurns: 5,
      permissionMode: "default"
    },
    "researcher": {
      description: "Researches and summarizes topics",
      tools: ["WebSearch", "WebFetch"],
      maxTurns: 10,
      background: true       // non-blocking
    }
  }
};
```

The main agent invokes a subagent via the **Agent tool**, naming it by key. Each subagent has its own:

- **Isolated context** — what the subagent sees doesn't bloat the main agent's transcript.
- **Per-agent tool/model config** — researcher gets WebSearch + WebFetch, code-review doesn't.
- **`maxTurns` cap** — local loop bound.
- **`background: true`** — non-blocking (the main agent gets the result back later).

Forge v2 uses subagents for the LLM Council pattern (one subagent per critic perspective) and for any phase that benefits from isolated context (e.g. brain-query running a focused grep + synthesise without polluting the calling skill's transcript).

## Sources

- [`claude-agent-sdk-typescript.docs.md`](../../_raw/docs/claude-agent-sdk-typescript.docs.md) — subagents API + options.agents.

## See also

- [[claude-agent-sdk]] — what subagents run on.
- [[ralph-loop-pattern]] — Ralph's `query()` lives here.
- [[llm-council-pattern]] — uses subagents for each critic.
