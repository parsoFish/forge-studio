---
title: 'env-optimiser — local-first, zero network calls (constitutional)'
description: >-
  Constitution principle 1. All data lives in ~/.wsl-deo/. Any network call
  requires explicit constitutional justification — privacy is the load-bearing
  trust property.
category: decision
keywords:
  - env-optimiser
  - local-first
  - zero-network
  - privacy
  - constitution
  - principle-1
created_at: 2026-05-04T19:30:00.000Z
updated_at: 2026-05-04T19:30:00.000Z
related_themes: []
---

# env-optimiser — local-first, zero network calls

Constitution principle #1: *"Local-First — All data stored locally in `~/.wsl-deo/`, zero network calls."* This is non-negotiable.

What it forbids:

- Telemetry of any kind.
- "Optional" cloud sync features.
- Calling out to external services (LLM APIs, package registries) at *runtime* — even for "enrichment" of recommendations.
- Bundling code that reaches the network unless explicitly behind an opt-in flag like `--i-understand` (used by the prereqs installer, which is *system-changing* by design).

What it permits:

- Reading from local Atuin DB, git, VS Code workspace files.
- Local SQLite event store under `~/.wsl-deo/`.
- Writing markdown briefs to disk.

The architect must reject any initiative that breaks this without first amending the constitution. The reviewer skill should treat "introduces a network call" as a structural diff that fails review-prep.

## Sources

- env-optimiser README "Constitution Principles" section.
- `.specify/memory/constitution.md` in the project repo.
