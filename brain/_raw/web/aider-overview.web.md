---
source_type: web
source_url: https://aider.chat/
source_title: Aider — AI pair programming in your terminal
ingested_at: 2026-05-04T18:00:00Z
ingested_by: brain-ingest (Pass A, batch 5)
cycle_id: pass-a-bootstrap
---

# Aider

**Core Function:** Aider enables developers to pair program with LLMs within their terminal to either initiate new projects or enhance existing codebases. Alternative to browser-based AI coding assistants.

**How It Works:** Integrates deeply with Git, automatically committing changes with descriptive messages and enabling developers to *"easily diff, manage and undo AI changes"* through familiar version control tools. This Git-first approach distinguishes it from web-based alternatives.

**Loop Model:** Iterative — "makes a map of your entire codebase, which helps it work well in larger projects," enabling sustained context across multiple interactions.

**Supported Models:** Claude 3.7 Sonnet, DeepSeek R1 & Chat V3, OpenAI o1, o3-mini, GPT-4o, plus "almost any LLM, including local models." This is its key axis vs Claude Agent SDK — it's model-agnostic.

**Key Architectural Distinctions:**

- Terminal-native interface (vs browser-based).
- Codebase mapping for larger projects.
- Git integration for change management.
- Supports 100+ programming languages.
- IDE integration via watch mode.
- Implementation: Python (would require shelling out from forge's TS orchestrator).
