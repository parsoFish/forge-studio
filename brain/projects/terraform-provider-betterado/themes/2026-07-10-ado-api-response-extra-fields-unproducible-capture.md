---
title: ADO API response extra fields cause unproducible live-evidence capture bodies
description: UWI-4 gate failed twice with "unproducible capture bodies" for testCases/nulls, allowedValues, revision — fields returned by ADO that are absent from the user-managed Terraform config; the unifier needed 2 crash-retries to resolve.
category: antipattern
keywords: [live-evidence, unproducible-capture, extra-fields, revision, allowedvalues, "testcases/nulls", unifier-crash]
related_themes: [ado-api-shapes-index, live-evidence-demo-index]
created_at: 2026-07-10T12:31:01.000Z
updated_at: 2026-07-10T12:31:01.000Z
---

## What happened

INIT-2026-07-01-new-api-test, UWI-4 (`bash .forge/review-gate-r3.sh`):

Gate failed twice with identical stderr:

```
unproducible capture bodies: [
  ('.forge/live-evidence/acceptance-test-suite.json', 'testCases/nulls'),
  ('.forge/live-evidence/acceptance-test-variable.json', 'allowedValues'),
  ('.forge/live-evidence/acceptance-test-configuration.json', 'revision')
]
```

These fields exist in ADO API responses but are not user-managed Terraform attributes:
- `testCases/nulls` — a testCase sub-object with null fields returned by the list API
- `allowedValues` — a field present on variable API responses when no values are set
- `revision` — an internal revision counter on configuration objects

The unifier crashed twice (code 1 + 360s stream-deadline stall) before successfully resolving in retry attempt 2.

## Pattern

Same class as `artifactSourceDefinitionUrl` in `release_definition` (profile.md gotcha: `flattenArtifacts` filters to user-set keys to avoid perpetual diff). ADO APIs consistently return read-only computed fields alongside user-managed fields.

## Fix direction

When capturing live evidence, filter the captured JSON body to exclude API-extra fields before writing to `.forge/live-evidence/`. Alternatively: the unifier gate's reproducibility check should have an allowlist of known-extra ADO fields per resource type.

Known ADO extra-field patterns to watch:
- `revision` / `_revision` on most resource types (server-managed revision counter)
- `nulls`-keyed sub-objects in list responses
- `allowedValues` on variable resources when no values configured

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-new-api-test/events.jsonl` — `gate.expected-fail` events UWI-4 at 2026-07-03T23:37:56 and T23:44:59
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-new-api-test.md`
