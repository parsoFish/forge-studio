---
title: env-optimiser — secret redaction is mandatory before any storage
description: >-
  30+ patterns redacted before SQLite write. A capture path that bypasses
  redaction is a critical bug, not a feature toggle.
category: pattern
keywords:
  - env-optimiser
  - redaction
  - secrets
  - security
  - sqlite
  - capture-path
created_at: 2026-05-04T19:30:00.000Z
updated_at: 2026-05-04T19:30:00.000Z
related_themes: []
---

# env-optimiser — secret redaction is mandatory before any storage

Constitution principle #2: *"Security & Redaction — Mandatory secret filtering before any storage."*

The redaction engine (under `src/wsl_deo/redaction/`) applies 30+ patterns *before* anything hits SQLite. Discipline:

- **Every collector path** (Atuin, git hooks, VS Code workspace) goes through redaction. New collectors *must* call the redaction engine; the architecture-level review verifies this for new initiatives.
- **Patterns live under `config/redaction-rules.yaml`** (or wherever the project's `config/` keeps them). New patterns are config changes, not code changes.
- **TDD applies first** — every new pattern has a unit test asserting it's redacted before any storage code is added.

For the developer loop: a work item that adds a capture path *must* declare `redaction` in its `files_in_scope` if it touches the collector layer at all. The reviewer flags missing redaction as a critical block.

## Sources

- env-optimiser README "Privacy Model" section + "Constitution Principles" #2.
