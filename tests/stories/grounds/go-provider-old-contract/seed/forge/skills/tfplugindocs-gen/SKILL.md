---
name: tfplugindocs-gen
description: Regenerate the Terraform Registry documentation for the betterado provider from the schema, then restore the hand-written guides tfplugindocs deletes. Use this as the in-cycle `docs` release step whenever a resource/data-source schema changes — a schema change is NOT done until the published docs describe it.
when_to_use: Any cycle that adds or changes a resource/data-source attribute, before the PR is opened (the `releaseProcess` docs step + the "Registry docs current" standing AC).
tier: sonnet
---

# tfplugindocs-gen — registry docs finalise step

## Purpose

Keep the published Terraform Registry docs in lockstep with the provider schema.
`tfplugindocs` derives `docs/resources/*.md` and `docs/data-sources/*.md` from the
Go schema, the `examples/` tree, and `templates/`. A schema change that the docs
don't describe is invisible to Registry consumers — so docs are part of "done".

## When to use

- A cycle added or changed an attribute on a `betterado_*` resource or data source.
- The `releaseProcess` `docs` step (in-cycle) runs.
- The "Registry docs current" standing acceptance criterion must be satisfied
  before the PR opens.

## Workflow

1. **Regenerate** — `make docs` (pinned `TFPLUGINDOCS_VERSION`, runs
   `tfplugindocs generate --provider-name betterado`).
2. **Restore the guides** — `git checkout -- docs/guides/`. tfplugindocs DELETES
   the hand-written guides on every run; this restores them. Skipping this drops
   the guides from the PR.
3. **Refresh examples** — for a new/changed resource, add or update
   `examples/resources/<resource>/resource.tf` (the example the generated doc
   embeds). The doc body pulls from here, so a stale example = a stale doc.
4. **Verify the diff** — `git status docs/ examples/` should show ONLY the
   resource/data-source files that match this cycle's schema change. An unexpected
   doc churn (e.g. every resource) usually means a tfplugindocs version drift.
5. **Commit** the regenerated docs + examples as part of the cycle.

## Hard rules

- NEVER hand-edit `docs/resources/` or `docs/data-sources/` — they are generated.
  Edit the schema descriptions / examples / templates instead, then regenerate.
- ALWAYS restore `docs/guides/` after `make docs`.
- The provider name is `betterado` (not `azuredevops`).

## Done when

`make docs` ran, `docs/guides/` is restored, the changed resource/data-source doc
describes every new/changed attribute, the embedded example is current, and all
three are committed.
