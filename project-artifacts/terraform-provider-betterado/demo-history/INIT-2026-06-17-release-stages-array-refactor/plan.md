# INIT-2026-06-17-release-stages-array-refactor — plan + outcome

## Initiative

## Work items (PM decomposition)
- **WI-1** — WI-1: Rename `environment` → `stages` in Go source + unit tests
- **WI-2** — WI-2: Add `ConfigMode: schema.SchemaConfigModeAttr` to stages and sub-blocks
- **WI-3** — WI-3: Update acceptance tests to `stages` array syntax + add live-acc gate test
- **WI-4** — WI-4: Update examples + docs to new `stages = [...]` array syntax

## Outcome
Live acceptance `TestAccReleaseDefinition_stagesArraySyntax` PASSES against real ADO (apply→read-back→idempotency→destroy). Demo carries a live REST GET (`acceptance-resource` checkpoint). Schema: `environment`→`stages` renamed; stages + nested collections converted to ConfigMode:Attr array syntax with nested attrs Optional/Computed.
