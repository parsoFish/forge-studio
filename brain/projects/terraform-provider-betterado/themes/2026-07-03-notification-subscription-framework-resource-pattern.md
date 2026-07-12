---
title: betterado_notification_subscription framework resource implementation pattern
description: Notification subscription resource is framework-native only; NotificationClient wired to AggregatedClient; flat schema (no TypeList filter block needed); validator stringvalidator.OneOf for channel_type.
category: reference
keywords: [notification-subscription, notificationclient, aggregatedclient, flat-schema, stringvalidator-oneof, channel-type]
related_themes: [resource-datasource-patterns-index]
created_at: 2026-07-03
updated_at: 2026-07-03
---

# betterado_notification_subscription framework resource implementation pattern

## Files

| File | Role |
|---|---|
| `azuredevops/internal/service/notification/resource_notification_subscription_framework.go` | Framework `resource.Resource` |
| `azuredevops/internal/service/notification/data_notification_subscription_framework.go` | Framework `datasource.DataSource` |
| `azuredevops/internal/service/notification/resource_notification_subscription_framework_test.go` | Unit tests (gomock) |
| `azuredevops/internal/service/notification/data_notification_subscription_framework_test.go` | Data source unit tests |
| `azuredevops/internal/acceptancetests/resource_notification_subscription_test.go` | Live acceptance test |
| `azuredevops/internal/client/client.go` | `NotificationClient notification.Client` field + init |
| `azuredevops/internal/provider/framework_provider.go` | Resources() + DataSources() registration |

## Key implementation details

- `notification.NewClient(ctx, connection)` returns `(notification.Client, error)` — unlike most ADO SDK clients it returns no error; handle accordingly in `GetAzdoClient`.
- `channel_type` uses `stringvalidator.OneOf(...)` from `terraform-plugin-framework-validators` (already vendored after this initiative).
- Flat schema for filter fields (`filter_type`, `filter_criteria` as `types.String`) — no TypeList filter block needed for the current surface.
- Read on 404: `resp.State.RemoveResource(ctx)` + return nil.
- Live acc test uses `SharedFixtureProjectName` (`"betterado-standing-demo"`), `subscription_type = "ms.vss-work.workitem-changed-event"`, `channel_type = "EmailHtml"`.
- Live evidence label: `"acceptance-resource"` (standard unifier checkpoint label).

## SDK model notes (from gap matrix)

`NotificationSubscription` key fields: `Id`, `Subscriber` (identity), `Channel` (delivery — type + address), `Filter` (expression criteria), `Status` (computed), `Scope` (project ID). See `docs/notification-gap-matrix.md` for full field triage.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-new-api-notification/artifacts/pr-description.md`
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-new-api-notification.md`
