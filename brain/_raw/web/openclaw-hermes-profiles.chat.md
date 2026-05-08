---
source_type: chat
source_url: synthesis (no canonical homepage fetched at ingest time)
source_title: OpenClaw and Hermes Agent — brief profiles
ingested_at: 2026-05-04T18:00:00Z
ingested_by: brain-ingest (Pass A, batch 5)
cycle_id: pass-a-bootstrap
---

# OpenClaw and Hermes Agent — brief profiles

> **Provenance note:** these two are referenced in forge's ADRs as alternatives that were rejected. Authoritative URLs were not fetched at ingest time; the profiles below are synthesised from training-knowledge familiarity and how forge's ADRs frame them. A future ingest pass should fetch the canonical project pages and replace these sections.

## OpenClaw

OpenClaw is a heavyweight Claude-Code-adjacent agentic application that bundles a curated skill registry, opinionated execution flow, and built-in workflow primitives. Targeted at end-users who want a turnkey agentic-coding experience rather than at platforms wanting to compose primitives.

**Why forge v2 rejected it (per ADR 002):** "heavyweight app, opinionated about its skill registry, conflicts with our `skills/` directory."

The conflict is at the *philosophy* layer: OpenClaw owns the skill registry; forge wants the filesystem to be the registry. Adopting OpenClaw means surrendering the convention that any markdown file with `SKILL.md` is a skill.

## Hermes Agent

Hermes Agent is an agentic loop runtime with a built-in persistent memory layer. It targets long-running autonomous work where the agent's memory is the load-bearing primitive.

**Why forge v2 rejected it (per ADR 002):** "duplicates the brain (Hermes has its own persistent memory). Rejected for that reason; keeping the brain layer pure."

Forge already owns the brain — the Karpathy three-layer wiki backed by the `brain-ingest`/`brain-lint`/`brain-query` skill triplet. Adopting Hermes would mean either ignoring its memory (wasteful) or replacing forge's brain with Hermes's (which loses the Obsidian / human-browseable property).

## Common pattern across rejections

Both rejections illustrate **principle 1 (avoid hand-rolling) cuts both ways**: prefer battle-tested tools, but only when they fit the *shape* of the system. A tool that bundles too much (its own registry, its own memory, its own orchestrator) is just as much a "wrong-shape" liability as one that's hand-rolled.
