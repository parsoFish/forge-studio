---
title: Wiki and wiki_page ADO API shapes — version descriptor and etag gotchas
description: betterado_wiki_page Create requires versionType:"branch" + non-null version in the version descriptor; etag changes between Create and subsequent Read and must be suppressed from plan.
category: reference
keywords: [wiki-page, version-descriptor, versiontype-branch, etag, plan-suppress, ado-rest-api]
related_themes: [ado-api-shapes-index]
created_at: 2026-07-03
updated_at: 2026-07-03
---

## wiki_page Create — version descriptor required

The ADO wiki page Create API (`POST vsrm.dev.azure.com/.../wikis/{wikiId}/pages`) returns:
```
The versionType should be 'branch' and version cannot not be null
Parameter name: versionDescriptor
```
if the `GitVersionDescriptor` is missing or has a null `version` field.

**Fix:** always set `versionType: "branch"` and `version: "wikiMaster"` (or the wiki's default branch) in the version descriptor when creating a wiki page.

## wiki_page etag — suppress from plan

The `etag` field changes between the Create response and the subsequent provider Read (the page content is re-serialised). This causes "provider produced inconsistent result after apply" if `etag` is tracked in state normally.

**Fix:** mark `etag` as `Computed: true` + `PlanModifiers: []planmodifier.String{stringplanmodifier.UseStateForUnknown()}`, OR suppress it entirely from plan with a custom modifier that accepts any post-apply change. Validated in `TestAccWikiPageResource_update`.

## betterado_wiki type: ProjectWiki — destroy not supported

Wikis of type `ProjectWiki` (auto-created by ADO for the project) cannot be deleted via the REST API. The provider's delete handler must detect `type == "ProjectWiki"` and return nil (no-op), and acceptance tests must use `prevent_destroy = true` or remove the resource from state without destroying.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-wiki/events.jsonl` — gate.fail events EV_mr4opvl3 (versionDescriptor), EV_mr4owcni (etag inconsistency)
- `/home/parso/forge/brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-wiki.md`
