---
title: ADO ProcessParameters does not round-trip on basic release definitions — unit test only
description: ADO does not reliably return ProcessParameters on basic pipeline definitions; it is consumed by task-group template inheritance, not stored as a per-definition field. Correct coverage is expand/flatten unit test only; a live round-trip test would assert against an ADO limitation.
category: reference
keywords: [process-parameters, task-group-template, release-definition, round-trip, expand-flatten, ado-limitation]
related_themes: [ado-api-shapes-index]
created_at: 2026-06-11T13:42:00Z
updated_at: 2026-06-11T13:42:00Z
---

# ADO ProcessParameters does not round-trip on basic release definitions

## Finding

During `INIT-2026-06-08-release-definition-environment-config-surface`, the agent implemented `process_parameters` expand/flatten for `betterado_release_definition` and attempted to include it in the live acceptance test. Discovery: ADO does not reliably return `ProcessParameters` on basic pipeline definitions. The field is consumed by task-group template inheritance — used as a template parameter override when task groups are referenced — not stored and returned as a per-definition property on simple definitions.

Every read returned the field empty regardless of what was written. Setting it in a `terraform apply` succeeds (HTTP 200), but the subsequent read (provider's `resourceReleaseDefinitionRead`) returns an empty/nil value → perpetual diff.

## Decision

Acceptance test `TestAccReleaseDefinition_environmentConfig` omits `process_parameters` from the live HCL fixture with an inline comment explaining the rationale. Unit test `TestReleaseDefinition_EnvironmentProcessParametersRoundTrip` covers the expand/flatten path in isolation.

This was operator-confirmed as correct: "forcing a live round-trip test would be asserting against an ADO behaviour that doesn't actually persist."

## Scope

Applies to basic release definitions without task group references. If a future initiative adds task group support, revisit whether `process_parameters` round-trips in that context.

## Sources

- `_logs/2026-06-08T12-01-16_INIT-2026-06-08-release-definition-environment-config-surface/events.jsonl` — `ralph.end WI-1 status=complete` (2026-06-11T13:11:35); gate: `TestReleaseDefinition_Environment.*RoundTrip`
- `_logs/2026-06-08T12-01-16_INIT-2026-06-08-release-definition-environment-config-surface/user-feedback.md` — Q2 answer
- `brain/cycles/_raw/2026-06-08T12-01-16_INIT-2026-06-08-release-definition-environment-config-surface.md`
