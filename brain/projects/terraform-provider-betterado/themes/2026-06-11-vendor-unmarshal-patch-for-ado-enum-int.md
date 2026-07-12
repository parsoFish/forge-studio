---
title: ADO SDK numeric-enum fields need unmarshal patch — now formalized as third_party/ fork
description: ADO returns daysToRelease as a JSON integer bitmask but the Go SDK declares ScheduleDays as a string enum. Raw vendor edit was the initial fix; now formalized as a tracked third_party/ fork with go.mod replace — survives go mod vendor regeneration.
category: reference
keywords: [enum-int-unmarshal, releaseschedule, scheduledays, third_party-fork, go.mod-replace, vendor, unmarshaljson]
related_themes: [ado-api-shapes-index, build-tooling-index]
created_at: 2026-06-11T13:42:00Z
updated_at: 2026-06-11T13:42:00Z
---

# ADO SDK numeric-enum fields need unmarshal patch — now formalized as third_party/ fork

## Problem

`releaseapi.ReleaseSchedule.ScheduleDays` is typed as a string enum in the Go SDK, but ADO REST returns `daysToRelease` as a JSON integer bitmask (e.g. `62` for Mon-Fri). Go's `encoding/json` cannot unmarshal an integer into a string — it silently zeroes the field. Every provider read produced `ScheduleDays: ""` regardless of what was set → perpetual diff on `schedule.days_to_release`.

## Initial fix (this cycle)

`vendor/github.com/microsoft/azure-devops-go-api/azuredevops/v7/release/schedule_unmarshal.go` — 89 lines of custom `UnmarshalJSON` for `ReleaseSchedule`. Uses `json.Number` to decode an integer or string, then maps integer values to the SDK string enum constants.

## Formalized pattern (operator confirmed)

A raw edit under `vendor/` is clobbered by `go mod vendor`. The project has since adopted a tracked fork:

```
# go.mod
replace github.com/microsoft/azure-devops-go-api/azuredevops/v7 => ./third_party/azure-devops-go-api/azuredevops/v7
```

`third_party/azure-devops-go-api/azuredevops/v7/release/schedule_unmarshal.go` holds the same override in the forked module tree, with a package-level comment documenting the fork, the source repos it tracks, and the original PR/issue references.

**Any future load-bearing SDK override must go into `third_party/`, not `vendor/`.** A vendor edit alone will be silently wiped on the next `go mod vendor`.

## Generalisation

This pattern applies to any ADO numeric-enum field the Go SDK types as string. Known instances: `schedule.days_to_release`. Check for the pattern when a new field round-trips to empty unexpectedly after a successful write.

## Sources

- `_logs/2026-06-08T12-01-16_INIT-2026-06-08-release-definition-environment-config-surface/events.jsonl` — WI-1 file_change `file.modify` at 12:08:01 and 12:08:17 (vendor file additions); `ralph.end WI-1 complete` 2026-06-11T13:11:35
- `_logs/2026-06-08T12-01-16_INIT-2026-06-08-release-definition-environment-config-surface/user-feedback.md` — Q4 answer
- `brain/cycles/_raw/2026-06-08T12-01-16_INIT-2026-06-08-release-definition-environment-config-surface.md`
