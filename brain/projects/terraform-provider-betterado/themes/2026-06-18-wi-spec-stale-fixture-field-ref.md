---
title: WI spec referenced non-existent SharedFixtureResult field — agent self-corrected
description: WI-5 spec explicitly named fixture.BuildDefinitionAlias as the field to use for container_image_trigger artifact_alias, but that field does not exist on SharedFixtureResult; agent detected the mismatch via grep and substituted "_build".
category: antipattern
keywords: [wi-spec, stale-fixture-ref, sharedfixtureresult, field-mismatch, self-correction, pm-fabrication]
related_themes: [pm-decomposition-index]
created_at: 2026-07-10T10:30:00.000Z
updated_at: 2026-07-10T10:30:00.000Z
---

## Problem

The PM generated WI-5 with:

> Use `SharedReleaseFixture(t)` so the artifact alias is known.
> `hclReleaseDefinitionWithContainerImageTrigger(name string, fixture SharedFixtureResult) string`
> ... `artifact_alias = "<fixture.BuildDefinitionAlias>"`

`SharedFixtureResult` does not have a `BuildDefinitionAlias` field. The agent discovered this during orientation:
```
grep -n "SharedFixtureResult" azuredevops/internal/acceptancetests/shared_fixtures.go
```
and substituted the hardcoded alias `"_build"` (the alias used by the shared fixture's build definition artifact).

## Impact

Minor — one extra read to resolve the field name. The agent self-corrected with no iteration waste. But if the fixture struct had changed (different field name), a naive implementation would have compiled with a missing field and hit a go vet error.

## Root cause

PM generated the WI spec drawing on an outdated or imagined version of `SharedFixtureResult`. The struct was referenced correctly by other WIs (e.g. WI-2 uses `fixture.ProjectID`), so the PM partially knew the struct but fabricated `BuildDefinitionAlias`.

## Mitigation

When the PM spec references struct fields by name (e.g. `fixture.FieldName`), the spec should include a comment `// verify field exists via grep -n "type SharedFixtureResult"` — or the PM should grep-verify during decomposition. Alternatively, the spec's Go code examples should use only the documented subset of fields listed in `shared_fixtures.go`'s comment header.

## Sources

- `_logs/2026-06-18T07-53-10_INIT-2026-06-17-release-definition-coverage-gaps/events.jsonl` (WI-5 tool_use grep at 08:15:12 `grep -rn "SharedReleaseFixture\|SharedFixtureResult\|BuildDefinitionAlias"`)
- `/home/parso/forge/brain/cycles/_raw/2026-06-18T07-53-10_INIT-2026-06-17-release-definition-coverage-gaps.md`
