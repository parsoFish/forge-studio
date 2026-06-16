---
title: REST/SDK gotchas for ADO-style providers
description: Multi-host APIs, revision-conflict retries, 404-on-read tolerance, and computed-field filtering — the recurring traps in a REST-backed provider.
category: reference
created_at: '2026-06-16'
updated_at: '2026-06-16'
---

# REST/SDK provider gotchas

Recurring traps when a provider wraps a REST API (grounded in ADO; the shapes
generalise):

- **Multi-host APIs.** Related resources may live on different hosts (ADO core =
  `dev.azure.com`, release = `vsrm.dev.azure.com`). The SDK client routes per
  resource; do not assume one base URL.
- **Revision-conflict on update.** A stale-revision update can return **HTTP 400**
  (not 409) with a type key like `InvalidRequestException` and an "old copy" message.
  Detect it, re-read to get the current revision, retry once.
- **404 on read = gone, not error.** In `Read`, a 404 means the resource was deleted
  out-of-band: `d.SetId("")` and return nil, so Terraform plans a recreate rather
  than erroring.
- **API-computed fields cause perpetual diff.** Responses return keys the user never
  set (e.g. `artifactSourceDefinitionUrl`). `flatten` must persist only the keys the
  user configured, or every plan shows drift.
- **Drive-safe builds.** `go build ./...` compiles every test package and can fill a
  drive with build cache. Use targeted `go build -mod=vendor .` and clean the cache.

## Sources

- betterado `resource_release_definition.go` (revision-aware update, 404 tolerance,
  `flattenArtifacts` computed-key filtering) + its `CLAUDE.md` build warnings.
