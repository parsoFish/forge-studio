---
title: Sibling data source split — per-data-source WI is the right default
description: Release data sources proved that per-data-source WI (single-lookup + list as separate WIs) is the right default; first WI pays scaffolding cost, siblings are cheap.
category: pattern
created_at: 2026-06-06T00:00:00.000Z
updated_at: 2026-06-06T00:00:00.000Z
---

## Pattern

When adding a pair of sibling data sources (single-lookup + list), decompose as **separate WIs**:

- **WI-1 — single-lookup** (`data_release_definition.go` + `data_release_definition_test.go`): pays first-mover scaffolding cost (file layout, imports, shared client wiring, mock infrastructure). Cost: ~$1.21.
- **WI-2 — list** (`data_release_definitions.go` + `data_release_definitions_test.go`): reuses scaffolding from WI-1; straightforward read + filter logic. Cost: ~$0.49.

Splitting keeps each gate discriminating (one `-run TestDataReleaseDefinition`, one `-run TestDataReleaseDefinitions`), and each diff stays reviewable.

**Exception**: group siblings into one WI only when they share expand/flatten/parsing logic that would require editing the same Go struct repeatedly — otherwise parallel implementation in one WI creates in-file collision risk.

## File layout (release data sources)

```
azuredevops/internal/service/release/
  data_release_definition.go          # single-lookup: GetReleaseDefinition by id or name
  data_release_definition_test.go     # unit: Read_Populates (id), Read_Populates (name), 404_ReturnsError
  data_release_definitions.go         # list: GetReleaseDefinitions with filters
  data_release_definitions_test.go    # unit: List_Populates, Empty_ReturnsEmpty
```

## Data source acceptance test shape

Data source acceptance tests are **NOT** structured like resource tests. Correct shape:

1. Create upstream resource (or reference shared fixture project).
2. Read it through the data source.
3. Assert returned attributes match.

No apply → re-plan idempotency cycle (`ExpectNonEmptyPlan: false` / `PlanOnly`) — that applies to the *resource* under test, not to the read-only data source.

## Cost calibration

WI-1 higher cost is normal one-time scaffolding overhead, not a sizing error. Per-WI estimates for data source WIs in this provider:

| WI type | Typical cost |
|---|---|
| First sibling data source (impl + test) | $1.0–$1.5 |
| Second sibling data source (impl + test) | $0.4–$0.6 |
| provider.go registration WI | $0.2–$0.4 |
| Docs + examples WI | $0.4–$0.6 |
| Acceptance test scaffolding WI | $0.4–$0.6 |

## Sources

- `_logs/2026-06-06T04-41-44_INIT-2026-06-05-release-data-sources/events.jsonl` (WI-1 and WI-2 ralph.end events with cost_usd and iteration counts)
- `/home/parso/forge/brain/cycles/_raw/2026-06-06T04-41-44_INIT-2026-06-05-release-data-sources.md`
