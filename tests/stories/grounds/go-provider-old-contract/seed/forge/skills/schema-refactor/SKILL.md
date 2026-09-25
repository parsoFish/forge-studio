# Schema Refactor Skill

## Purpose

Rename a user-facing schema field cleanly (no back-compat alias), keeping the
project's nested collections as **blocks**. The canonical use is renaming
release_definition `environment` → `stages`.

## When to use

- Renaming a user-facing schema field to a friendlier name.
- Reshaping a nested structure for readability.

## Do NOT use `ConfigMode: SchemaConfigModeAttr` (array syntax) in this provider

It is tempting to flip a nested `TypeList`/`TypeSet` to `ConfigMode:
schema.SchemaConfigModeAttr` to get assignable array syntax (`stages = [{ … }]`).
**Don't** — it has a structural SDKv2 limitation that makes the provider worse:

- ConfigModeAttr only changes how the PARENT collection renders (block vs
  assignable attribute). It does NOT propagate optionality into the nested
  object's members. SDKv2 lowers the element with `cty.Object(atys)` (never
  `cty.ObjectWithOptionalAttrs`), so **every** nested attribute becomes required
  in the object literal — even ones marked `Optional` / `Optional+Computed`.
- A consumer must then null-fill EVERY field at EVERY nesting level
  (`variable = [{ name = "X", value = "v", is_secret = null, allow_override = null }]`,
  plus null for every unused stage field, plus full `deploy_phase` objects, …).
  `Default` does not help — it is apply-layer only, not part of the decode type.
- The recursion makes configs exhaustively verbose — strictly worse ergonomics
  than blocks, which let a consumer omit unused fields entirely.

**Array-structured nested attributes with omittable/defaulted fields require the
`terraform-plugin-framework`** (its `ListNestedAttribute` emits real optional
object attributes + typed defaults). That is a deliberate, separately-scoped
**holistic provider migration** (SDKv2 → Framework via mux), tracked in the
roadmap — NOT a per-resource change. Until then, keep nested collections as blocks.

## Workflow — a clean rename (block syntax)

### 1. Rename the field
- Change the schema map key (`"environment"` → `"stages"`) in `resource_<name>.go`.
- Update every `d.Get/Set/GetOk` reference and any nested references to the new
  key. Grep the whole package for the old key.
- Rename the expand/flatten helpers for clarity (`expandEnvironments` →
  `expandStages`) and their call sites.
- Update examples (`examples/resources/<resource>/*.tf`), docs, and acceptance-test
  HCL fixtures — all using **block** syntax (`stages { … }`, repeated blocks for a
  list; unused fields simply omitted).
- This is a **breaking** change — no alias, no deprecation shim.

### 2. Prove it (two-gate + demo)
- Update unit tests for the renamed schema; non-default values + read-back.
- Update / add a `TF_ACC` acceptance test that applies the renamed **block** HCL
  against real ADO, asserts via provider read, runs an idempotency re-plan
  (`ExpectNonEmptyPlan: false`), and destroys cleanly. Gate the WI on this live test.
- Capture live evidence (see the `ado-demo` skill): the renamed `.tf` plans +
  applies, then an API GET shows the created resource (`captureReleaseEvidence`).
- Run the CI-equivalent gate (`make test && golangci-lint run ./... &&
  make terrafmt-check`) green.

## Definition of done

The renamed (block-syntax) schema applies + round-trips against live ADO, is
idempotent, the CI gate is green, examples + docs use the renamed blocks, and the
plan + demo are recorded under `forge/history/<initiative-id>/`.
