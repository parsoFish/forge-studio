---
title: ConfigMode SchemaConfigModeAttr cascades to all child TypeList schemas
description: Adding ConfigMode:SchemaConfigModeAttr to a top-level block is not sufficient — every TypeList child in the hierarchy must also carry it, or HCL validation rejects any fixture that omits Optional sub-block attributes.
category: antipattern
keywords: [configmode, schemaconfigmodeattr, typelist, hcl-null-attrs, nested-schema, attribute-syntax, plan-modifier]
related_themes: [framework-migration-index]
created_at: 2026-07-10T10:30:00.000Z
updated_at: 2026-07-10T10:30:00.000Z
---

## Problem

`ConfigMode: schema.SchemaConfigModeAttr` on a TypeList schema propagates `attrsOnly=true`
validation to ALL child schemas. Any child TypeList with `Elem: *schema.Resource` that
does NOT itself carry `ConfigMode: schema.SchemaConfigModeAttr` fails HCL validation when
`attrsOnly=true`. Error message: `"Inappropriate value for attribute '<child>': element
<index>: attributes required"`.

## Release definition example

Adding `ConfigMode: schema.SchemaConfigModeAttr` to `stages` alone broke all nested
sub-blocks: `condition`, `environment_options`, `execution_policy`, `pre_deployment_gates`,
`post_deployment_gates`, `approval` (inside gates), `workflow_task` (inside gates), etc.
Each of those TypeList schemas also needed `ConfigMode: schema.SchemaConfigModeAttr`.

## HCL fixture null-attr rule

Under attribute syntax, Optional attributes CANNOT be omitted from HCL blocks — they
must be set to `= null` explicitly. Block syntax silently ignores missing Optional blocks;
attribute syntax treats them as required-but-missing. Every stage element in every
acceptance test fixture needed ~13 explicit `attr = null` lines added.

Count: ~17 HCL fixtures × ~13 null attrs each = significant churn. Agent spent 4 gate
failures re-deriving this across WI-3 because no fixture template encoded the pattern.

## Mitigation

When applying `ConfigMode: schema.SchemaConfigModeAttr` to any schema:
1. Enumerate ALL TypeList/TypeSet children recursively; add ConfigMode to each.
2. Update every HCL fixture to spell out all Optional attrs as `= null`.
3. Maintain a "complete stage element" HCL snippet as a template in the test file
   comment header — copy-paste for new fixtures rather than re-deriving per-initiative.

## Sources

- `_logs/2026-06-17T21-21-21_INIT-2026-06-17-release-stages-array-refactor/events.jsonl` (WI-3 gate.fail × 4, 21:39–22:28)
- `/home/parso/forge/brain/cycles/_raw/2026-06-17T21-21-21_INIT-2026-06-17-release-stages-array-refactor.md`
