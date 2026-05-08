---
source_type: web
source_url: https://github.com/All-Hands-AI/OpenHands
source_title: OpenHands (formerly OpenDevin) — AI-driven development platform
ingested_at: 2026-05-04T18:00:00Z
ingested_by: brain-ingest (Pass A, batch 5)
cycle_id: pass-a-bootstrap
---

# OpenHands

AI-driven development platform with modular architecture. Formerly OpenDevin.

## Agent Architecture

Composable Python SDK described as *"the engine that powers everything else."* Multiple deployment modes: local CLI, GUI applications, cloud-based infrastructure. Single-agent to thousand-agent scaling.

## Orchestration Model

Iterative agentic workflows. Supports various interaction patterns — from single CLI commands to continuous GUI-based agent operation — rather than one-shot interactions. Multi-agent capabilities exist through enterprise deployments.

## Integrated Components

- **Sandbox execution environment** (Docker containers).
- **Tool integration** (Git, code editors, shell access).
- **Memory systems** (conversation history, context management).
- **LLM flexibility** (Claude, GPT, or any compatible model).

## Key Differentiators

- Source-available enterprise options with RBAC, multi-user collaboration.
- Slack/Jira/Linear integrations.
- Production-ready infrastructure rather than CLI wrapper.

**Stack:** Python (62.2%) and TypeScript (35.9%), 72.6k GitHub stars, enterprise support.

## Why forge v2 doesn't adopt it

OpenHands bundles its own memory system, sandbox, agent orchestration, and tool integration — i.e. it duplicates layers forge already owns (the brain, git worktrees, the orchestrator, the skills). Adopting it means rewriting forge around OpenHands' assumptions, the opposite of v2's "small core, plug in big tools" thesis.
