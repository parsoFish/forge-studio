---
title: Alternative loop runtimes — Aider, OpenHands, OpenClaw, Hermes
description: Reference profiles for loop runtimes forge could swap to. Each rejected at scaffold for shape-mismatch reasons; loops/_adapters/ holds future adapter slots.
category: reference
keywords: [aider, openhands, openclaw, hermes, alternatives, adapters, loop-runtime]
created_at: 2026-05-04T18:00:00Z
updated_at: 2026-05-04T18:00:00Z
related_themes: [ralph-loop-pattern, claude-agent-sdk, avoid-hand-rolling-tools]
---

# Alternative loop runtimes

Forge v2 ships with the Ralph loop pattern (ADR 002) over the Claude Agent SDK (ADR 001), but `loops/_adapters/` holds slots for swap-in alternatives. The four most-discussed at scaffold time:

- **Aider** ([aider.chat](https://aider.chat/)) — Python, terminal-native, Git-first. Model-agnostic (Claude / OpenAI / DeepSeek / local). Iterative loop model with codebase mapping. Strong runner-up if Anthropic lock-in becomes a concern. Trade-off: Python — would require shelling from forge's TS orchestrator.

- **OpenHands** ([github.com/All-Hands-AI/OpenHands](https://github.com/All-Hands-AI/OpenHands)) — Python + TS, source-available enterprise platform. Bundles sandbox, memory, tool integration, multi-agent orchestration. Production-ready as a *platform*, not a primitive. Rejected because it duplicates layers forge already owns.

- **OpenClaw** — heavyweight Claude-Code-adjacent application with curated skill registry and opinionated execution flow. Rejected because its skill registry conflicts with forge's filesystem-is-the-registry convention.

- **Hermes Agent** — agentic loop runtime with built-in persistent memory. Rejected because the brain layer (Karpathy three-layer wiki) is forge's own load-bearing primitive; adopting Hermes would replace or duplicate it.

The framing is: **adopt-don't-build cuts both ways.** Prefer battle-tested tools, but only when they fit the shape of the system. A tool that bundles too much (its own registry, its own memory, its own orchestrator) is just as wrong-shape as one that's hand-rolled.

Adapter slots in `loops/_adapters/` exist so future "should we swap loops?" decisions have prior research to point to.

## Sources

- [`aider-overview.web.md`](../../_raw/web/aider-overview.web.md) — Aider profile.
- [`openhands-overview.web.md`](../../_raw/web/openhands-overview.web.md) — OpenHands profile.
- [`openclaw-hermes-profiles.chat.md`](../../_raw/web/openclaw-hermes-profiles.chat.md) — OpenClaw + Hermes synthesis.
- [`adr-002-ralph-loop-pattern.docs.md`](../../_raw/docs/adr-002-ralph-loop-pattern.docs.md) — alternatives-considered framing.

## Related

- [Theme: Ralph loop pattern](./ralph-loop-pattern.md) — what forge ships with.
- [Theme: Claude Agent SDK](./claude-agent-sdk.md) — the layer below Ralph.
- [Theme: Avoid hand-rolling tools](./avoid-hand-rolling-tools.md) — the principle that constrains adoption.
