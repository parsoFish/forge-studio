---
title: Provider count test is a mandatory pair for every new data source
description: Every new data source added to betterado must also update TestProvider_HasChildDataSources — this count assertion has fired on 3 consecutive data-source additions.
category: pattern
keywords: [testprovider-haschilddatasources, data-source-registration, count-test, mandatory-pair, provider-test]
related_themes: [provider-registration-dedup-index]
created_at: 2026-06-07
updated_at: 2026-06-07
---

# Provider count test is a mandatory pair for every new data source

## Pattern

`TestProvider_HasChildDataSources` in `provider_test.go` asserts the exact count of registered data sources. Adding `betterado_release_folder` to `provider.go` without updating this count fails the test. The same update pattern was required for at least 3 consecutive data-source additions.

## Mandatory pair

Any work item that adds a data source MUST update two files atomically:
1. `provider.go` — add the data source to the registry
2. `provider_test.go` — increment the `TestProvider_HasChildDataSources` count

Missing either breaks the unit gate. The PM spec and WI acceptance criteria for any new data source should cite this pair explicitly.

## Confirmed instances

1. `data.betterado_release_definition` (prior cycle)
2. `data.betterado_release_definitions` (prior cycle)
3. `data.betterado_release_folder` — this cycle, WI-2, `provider.go:184` + `provider_test.go` updated

## Sources

- `_logs/2026-06-07T03-20-11_INIT-2026-06-07-release-folder-data-source/events.jsonl`
- `/home/parso/forge/brain/cycles/_raw/2026-06-07T03-20-11_INIT-2026-06-07-release-folder-data-source.md`
