---
title: Conventions
description: Overlay schema format, copier.yaml metadata rules, naming, commits
category: reference
created_at: 2026-10-09T05:00:53Z
updated_at: 2026-10-09T05:00:53Z
---

## Overlay config format (`schemas/overlay.schema.json`)

Every file under `config/repos/` must satisfy `schemas/overlay.schema.json` (JSON Schema Draft 7).

**Required fields:**

```yaml
apiVersion: gitweave.io/v1        # exact string; validated by enum
kind: RepositoryOverlay           # exact string; case-sensitive
metadata:
  name: <slug>                    # required string
spec:
  repository: owner/repo          # pattern: ^[^\s/]+/[^\s/]+$  (exactly one slash)
```

**Optional fields under `spec`:**
- `modules[]` — array; each item requires `name` (string); optionally `version` (string), `inputs` (object)
- `environments` — map of env-name → object with optional `protection_rules` (object), `secrets` (string[]), `variables` (string→string map)
- `variables` — flat string→string map (non-string values rejected)

`additionalProperties: false` at top level and under `spec` — unknown keys are rejected.

Source: `schemas/overlay.schema.json` (confirmed present), `tests/test_overlay_schema.py`.

## Copier module metadata (`schemas/copier-module.schema.json`)

Every `modules/*/copier.yaml` must declare a `_metadata` block:

```yaml
_metadata:
  name: snake_case_name           # required; snake_case
  version: "YYYYMMDD.Patch"       # required; CalVer e.g. "20260305.0"
  description: "..."              # required string
  min_copier_version: "8.0.0"     # optional
  parent: ...                     # optional
```

`additionalProperties: false` on `_metadata`. Copier question `type` values are also validated when present.

Source: `tests/test_copier_schema.py`, `modules/example-template/copier.yaml`.

## Overlay API version

- Current API version: `gitweave.io/v1`
- `gitweave.io/v2` is rejected by schema — bump version in schema and tests before introducing a v2.

## Commit conventions

Conventional commits (`feat|fix|refactor|test|docs|chore|perf|ci`). Commits must be linked to GitHub Issues (`AGENTS.md §Commits`).

## Constitution authority

`AGENTS.md` is the operator-signed constitution. Where `AGENTS.md` and `CLAUDE.md` conflict, `AGENTS.md` wins. Notable amendments:
- No Terraform / desired-state tool (III amended): `gw plan` diffs declaration against live org; no state file.
- DORA metrics computed GitHub-natively on a schedule, no hosted service (V amended).
- Issue linking for lead-time optional — DORA lead time measured commit-to-deploy from provider API (VI amended).
