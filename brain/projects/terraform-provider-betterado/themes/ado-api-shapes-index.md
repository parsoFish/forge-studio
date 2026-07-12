---
title: 'ADO REST API shapes & quirks'
description: 'Topical index — Azure DevOps REST API shapes and quirks: release-definition permission token format, process parameters, wiki page API shapes, feature-management host, feed soft-delete, process-is-enabled quirk, enum-int unmarshal, extra response fields.'
category: reference
keywords: [ado, api, shapes, index, topical-hub]
related_themes: [resource-datasource-patterns-index, configure-auth-index]
created_at: 2026-07-12T00:00:00.000Z
updated_at: 2026-07-12T00:00:00.000Z
---

> **Topical index node.** Azure DevOps REST API shapes and quirks: release-definition permission token format, process parameters, wiki page API shapes, feature-management host, feed soft-delete, process-is-enabled quirk, enum-int unmarshal, extra response fields.

## Member themes (12)

- [[2026-06-06-environment-templates-spike-findings]] — GET /environmenttemplates via raw-HTTP on vsrm.dev.azure.com returns 200; create requires a full ReleaseDefinitionEnvironment blueprint (heaviest provider type); initiative parked.
- [[2026-06-06-release-definition-permissions-token-format]] — The ReleaseManagement2 token format is `{projectId}/{releaseDefinitionId}` — no namespace prefix; identical to the Build namespace. The manifest's hypothesised format was wrong.
- [[2026-06-11-process-parameters-no-live-roundtrip]] — ADO does not reliably return ProcessParameters on basic pipeline definitions; it is consumed by task-group template inheritance, not stored as a per-definition field. Correct coverage is expand/flatten unit test only; a live round-trip test would assert against an ADO limitation.
- [[2026-06-11-vendor-unmarshal-patch-for-ado-enum-int]] — ADO returns daysToRelease as a JSON integer bitmask but the Go SDK declares ScheduleDays as a string enum. Raw vendor edit was the initial fix; now formalized as a tracked third_party/ fork with go.mod replace — survives go mod vendor regeneration.
- [[2026-07-01-identity-user-displayname-org-specific-format]] — ADO identity lookup with DisplayName filter requires the org-specific format "{ProjectName} Build Service ({OrgName})" — the generic "Project Collection Build Service" name is not resolvable in this org.
- [[2026-07-03-ado-featuremanagement-userscore-must-be-host]] — SetFeatureStateForScope / GetFeatureStateForScope require UserScope "host" (org-wide) or "me" (current user) as a routing discriminator, NOT the scope name ("project"). Passing the scope name produces invalid REST URLs rejected by ADO.
- [[2026-07-03-ado-feed-soft-delete-checkdestroy]] — DeleteFeed is a soft-delete; GetFeed returns the feed until explicitly purged, so naive CheckDestroy must assert DeletedDate != nil or a 404, not just a non-error response.
- [[2026-07-03-wiki-api-shape-bugs-re-derived-zero-brain-reads]] — All 8 dev-loop WI sessions for the wiki migration had brainReads=0; three API-shape bugs known from prior work were re-derived from runtime error messages, costing ~4 extra iterations.
- [[2026-07-03-wiki-wiki-page-api-shapes]] — betterado_wiki_page Create requires versionType:"branch" + non-null version in the version descriptor; etag changes between Create and subsequent Read and must be suppressed from plan.
- [[2026-07-04-vssps-accounts-org-scoped-pat-endpoint]] — For org-scoped PATs, app.vssps.visualstudio.com/_apis/accounts returns 401 and vssps.dev.azure.com/{org}/_apis/accounts returns 404; the working path is vssps.dev.azure.com/{org}/_apis/Organization/Collections/Me.
- [[2026-07-05-workitemtrackingprocess-process-is-enabled-api-quirk]] — >-
- [[2026-07-10-ado-api-response-extra-fields-unproducible-capture]] — UWI-4 gate failed twice with "unproducible capture bodies" for testCases/nulls, allowedValues, revision — fields returned by ADO that are absent from the user-managed Terraform config; the unifier needed 2 crash-retries to resolve.

## See also

- [[resource-datasource-patterns-index]] — Framework resource / data-source patterns.
- [[configure-auth-index]] — Provider Configure() & auth parity.
