---
title: Release definition permissions — confirmed ADO token format
description: The ReleaseManagement2 token format is `{projectId}/{releaseDefinitionId}` — no namespace prefix; identical to the Build namespace. The manifest's hypothesised format was wrong.
category: reference
keywords: [release-definition-permissions, releasemanagement2, token-format, security-namespace, permissions-token, ado-api]
related_themes: [ado-api-shapes-index]
created_at: 2026-06-06T00:00:00.000Z
updated_at: 2026-06-06T00:00:00.000Z
---

## Finding

The `ReleaseManagement2` security namespace uses the token format:

```
{projectId}/{releaseDefinitionId}
```

**No** `ReleaseManagement2/Project/` prefix. Identical to the Build namespace token format.

The initiative manifest hypothesised `ReleaseManagement2/Project/{projectId}/{definitionId}` — this is WRONG. Disproved by WI-1 live ADO probe (June 2026).

## Context

Two namespaces exist for release permissions:
- `ReleaseManagement` — project-level (token: `{projectId}`)
- `ReleaseManagement2` — definition-level (token: `{projectId}/{releaseDefinitionId}`)

The `release_definition_id` field is `Optional` in the delivered schema: when omitted, the resource manages project-scope permissions (using `{projectId}` alone); when set, it manages definition-scope permissions.

## Why this matters

The incorrect token format assumption was written into the architecture manifest. Without a brain record, the same wrong hypothesis would propagate to future initiatives involving release permissions (e.g. UpdatePermissions test, release folder permissions).

An inline code comment in `resource_release_definition_permissions.go` is not discoverable at planning time. The brain is.

## Confirmed by

Live ADO API probe in WI-1 of this initiative. Token format tested against real org.

## Sources

- `_logs/2026-06-06T05-30-11_INIT-2026-06-05-release-definition-permissions/events.jsonl` (WI-1 gate.pass at 05:42:35; spike confirmed token format)
- `/home/parso/forge/brain/cycles/_raw/2026-06-06T05-30-11_INIT-2026-06-05-release-definition-permissions.md`
