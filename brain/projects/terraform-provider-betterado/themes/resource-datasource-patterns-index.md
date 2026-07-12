---
title: 'Framework resource / data-source patterns'
description: 'Topical index — Reusable framework resource and data-source implementation patterns: data-source reader/split, 404-read drives, notification-subscription, policy helper, servicehook null/empty, serviceendpoint state-for-unknown, accounts-profile.'
category: reference
keywords: [resource, datasource, patterns, index, topical-hub]
related_themes: [framework-migration-index, ado-api-shapes-index]
created_at: 2026-07-12T00:00:00.000Z
updated_at: 2026-07-12T00:00:00.000Z
---

> **Topical index node.** Reusable framework resource and data-source implementation patterns: data-source reader/split, 404-read drives, notification-subscription, policy helper, servicehook null/empty, serviceendpoint state-for-unknown, accounts-profile.

## Member themes (10)

- [[2026-06-06-data-source-split-read-only-pattern]] — Release data sources proved that per-data-source WI (single-lookup + list as separate WIs) is the right default; first WI pays scaffolding cost, siblings are cheap.
- [[2026-06-16-data-source-reader-pattern]] — New data sources follow data_release_folder.go — Read (not ReadContext), 5-min timeout, mirrored schema, 404 surfaces as error.
- [[2026-06-18-release-folder-gap-matrix-pattern]] — The release_folder resource gap matrix (docs/release-folder-gap-matrix.md) + TestReleaseFolderGapMatrixAudit sentinel establishes the same API-coverage discipline as release_definition. WI-1 produced the matrix in 1 iteration; WI-2 added the live acc test TestAccReleaseFolder in 1 iteration. Both used the expected-fail gate pattern correctly.
- [[2026-07-01-framework-datasource-registration-pattern]] — First-mover pattern for registering framework datasource.DataSource implementations in DataSources() — the release family (5 data-sources) establishes the template that all future data-source migrations copy.
- [[2026-07-03-datasource-404-test-must-drive-read-not-just-mock]] — TestDataSource_404NotFound mocked GetSubscription and checked ResponseWasNotFound only — never called datasource Read(), leaving resp.State.RemoveResource unexercised; sent-back by operator.
- [[2026-07-03-notification-subscription-framework-resource-pattern]] — Notification subscription resource is framework-native only; NotificationClient wired to AggregatedClient; flat schema (no TypeList filter block needed); validator stringvalidator.OneOf for channel_type.
- [[2026-07-03-servicehook-null-empty-string-inconsistency]] — Both servicehook framework resources needed extra iterations to fix attributes (stage_name, pipeline_id, git_push branch/pushed_by/repository_id) that the ADO API returns as empty string but were stored as null in Terraform state, causing "inconsistent result after apply".
- [[2026-07-04-accounts-profile-data-source-pattern]] — betterado_accounts uses direct HTTP to Collections/Me (org-scoped VSSPS); betterado_profile uses direct HTTP to app.vssps.visualstudio.com/_apis/profile/profiles/{id} with BasicAuth from AggregatedClient.
- [[2026-07-04-policy-framework-helper-pattern]] — The branch and repository policy framework migrations both adopted a shared framework_helpers.go within each package to hold common schema attribute builders and flatten/expand utilities, enabling ralph to converge without brain reads.
- [[2026-07-09-serviceendpoint-usestateforunknown-computed-optional]] — Migrated serviceendpoint framework resources hit "inconsistent result after apply" for server_url, service_principal_id, workload_identity_federation_issuer, workload_identity_federation_subject — fixed by adding UseStateForUnknown plan modifier.

## See also

- [[framework-migration-index]] — Framework migration (SDKv2 → plugin-framework).
- [[ado-api-shapes-index]] — ADO REST API shapes & quirks.
