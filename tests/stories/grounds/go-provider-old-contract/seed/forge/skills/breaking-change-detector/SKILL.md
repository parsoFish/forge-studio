---
name: breaking-change-detector
description: Detect whether a betterado schema change is BREAKING for existing Terraform configurations or state, before the PR opens — a renamed/removed attribute, a block→attribute ConfigMode flip, a new Required field, or a type change. Flags the break, names the consumer impact, and drives the CHANGELOG "BREAKING CHANGES" entry + the migration note.
when_to_use: Any cycle that renames/removes a schema attribute, flips a block to an attribute (ConfigMode), adds a Required field, or changes an attribute type — before opening the PR.
tier: sonnet
---

# breaking-change-detector — is this schema change breaking?

## Purpose

A provider schema change can silently break existing consumers: a rename with no
alias forces an HCL edit; a new `Required` field fails plan on every existing
config; a `TypeList`→attribute (`ConfigMode: SchemaConfigModeAttr`) flip changes
the HCL syntax. This skill classifies the change BEFORE the PR so the break is
declared (CHANGELOG `BREAKING CHANGES` + migration note), never discovered by a
consumer's failed `terraform plan`.

## When to use

- An attribute was renamed or removed.
- A nested block was flipped to a list-of-object attribute via `ConfigMode:
  SchemaConfigModeAttr` (or back).
- A previously-Optional field became `Required`, or `Computed` changed.
- An attribute's `Type` changed (e.g. `TypeString` → `TypeList`).
- `ForceNew` was added to an existing attribute.

## Breaking-change taxonomy

| Change | Breaking? | Consumer impact |
|--------|-----------|-----------------|
| Attribute renamed, NO alias | **Yes** | Existing config fails plan until edited |
| Attribute removed | **Yes** | Config referencing it fails |
| Block → attribute (ConfigMode flip) | **Yes** | HCL syntax changes (`x { }` → `x = [ ]`) |
| Optional → Required | **Yes** | Configs omitting it fail plan |
| Type change | **Yes** | Value shape changes |
| `ForceNew` added | **Yes (state)** | Next apply destroys + recreates the resource |
| New Optional attribute | No | Additive |
| New Computed attribute | No | Additive |
| Description / doc change | No | Cosmetic |

## Workflow

1. **Diff the schema** — `git diff main...HEAD -- 'azuredevops/internal/service/**/resource_*.go'`;
   focus on the `Schema: map[string]*schema.Resource{...}` blocks and any
   `ConfigMode` / `Required` / `ForceNew` / `Type` edits.
2. **Classify** each change against the taxonomy above.
3. **Confirm no alias** — a rename is only non-breaking if a deprecated alias
   bridges old→new (betterado's convention is NO alias — renames ARE breaking).
4. **For each break, write:**
   - a `## BREAKING CHANGES` bullet in the `## Unreleased` changelog section
     (name the old → new syntax / field), and
   - a one-line migration note in the resource doc / example so consumers know
     the edit to make.
5. **Bump semver accordingly** — a break is at least a minor bump pre-1.0 (the
   `releaseProcess` `version` step); flag if the operator wants a major.

## Done when

Every schema edit in the diff is classified, every break has a `BREAKING CHANGES`
changelog bullet + a migration note, and the version bump reflects the highest
break severity. (A clean additive change exits with "no breaking changes".)
