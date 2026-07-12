---
title: HCL fixtures under ConfigModeAttr must include explicit null for every Optional attr
description: Under SchemaConfigModeAttr (array syntax), every Optional attribute in every TypeList element must be set to null in the HCL fixture — omitting them produces HCL validation errors, unlike block syntax where Optional sub-blocks can be absent.
category: pattern
keywords: [configmode-attr, hcl-fixture, optional-attribute, null, typelist, schemaconfigmode]
related_themes: [framework-migration-index]
created_at: 2026-07-10T10:30:00.000Z
updated_at: 2026-07-10T10:30:00.000Z
---

## Rule

When a schema uses `ConfigMode: schema.SchemaConfigModeAttr`, HCL attribute syntax
requires every Optional field in the element to be explicitly set — either to a value
or to `null`. Block syntax silently ignores absent Optional sub-blocks; attribute syntax
treats them as required-but-missing. This applies recursively: nested TypeList children
that also carry ConfigModeAttr need the same treatment.

## Release definition — stage element template

A minimal stage element that compiles under attribute syntax (all Optional attrs explicit):

```hcl
stages = [{
  name                  = "Stage"
  rank                  = 1
  id                    = null
  owner                 = null
  condition             = null
  environment_options   = null
  environment_trigger   = null
  execution_policy      = null
  post_deployment_gates = null
  pre_deployment_gates  = null
  process_parameters    = null
  properties            = null
  schedule              = null
  variable              = null
  variable_groups       = null
  deploy_phase = [{
    # ... deploy phase attrs
  }]
}]
```

Add this as a comment block at the top of the acceptance test file so future fixture
authors copy-paste rather than re-derive.

## When this bites

Any WI that adds a new acceptance test for `betterado_release_definition` will encounter
this if the test author omits Optional attrs. The hollow gate (compile+list only, no
TF_ACC) will pass; the live gate will fail with `"attributes required"`.

## Sources

- `_logs/2026-06-17T21-21-21_INIT-2026-06-17-release-stages-array-refactor/events.jsonl` (WI-3 iterations 1-4, 21:39–22:28)
- `/home/parso/forge/brain/cycles/_raw/2026-06-17T21-21-21_INIT-2026-06-17-release-stages-array-refactor.md`
