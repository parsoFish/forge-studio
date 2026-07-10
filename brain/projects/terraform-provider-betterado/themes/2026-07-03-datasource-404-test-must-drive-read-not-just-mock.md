---
title: Data source 404 unit test must drive the datasource Read(), not just assert the utility helper
description: TestDataSource_404NotFound mocked GetSubscription and checked ResponseWasNotFound only — never called datasource Read(), leaving resp.State.RemoveResource unexercised; sent-back by operator.
category: antipattern
created_at: 2026-07-03
updated_at: 2026-07-03
---

# Data source 404 unit test must drive the datasource Read(), not just assert the utility helper

## What happened

`data_notification_subscription_framework_test.go:TestDataSource_404NotFound` (line 106) set up a `MockNotificationClient` returning a 404, then asserted `utils.ResponseWasNotFound(err) == true`. It never invoked the data source's `Read()` method via the framework test harness. The actual branch under test — `resp.State.RemoveResource(ctx)` at line 131 of the data source — was never called.

The operator adversarial re-review at 2026-07-03T12:45:47 flagged this explicitly: "TestDataSource_404NotFound mocks GetSubscription and asserts utils.ResponseWasNotFound only, never invoking the data source's Read(), leaving resp.State.RemoveResource unexercised."

## Rule

A unit test for "404 causes state removal" must exercise the component boundary (the data source's `Read()` function), not just the underlying utility. For framework data sources, use `resource.UnitTest` or a mock-backed `ReadResponse` — or add a live acceptance step with `data "betterado_notification_subscription"` + a bad ID that confirms 404 does not error.

The same applies to resource `Read()` on 404: test the read method, not `utils.ResponseWasStatusCode`.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-new-api-notification/artifacts/verdict.json`
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-new-api-notification.md`
