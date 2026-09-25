---
name: ado-release-explorer
description: Systematically map the Azure DevOps classic Release API (vsrm.dev.azure.com) before implementing or extending a betterado release resource. Discovers the request/response shape, the nested object graph (stages → deploy phases → tasks; approvals; gates; triggers), and the host/client routing — so the Go expand/flatten is built against the real API, not a guess.
when_to_use: Before adding/changing any betterado_release_* attribute, when an API field round-trips wrong (perpetual diff), or when characterising an undocumented Release API surface.
tier: sonnet
---

# ado-release-explorer — map the Release API before you implement

## Purpose

The classic Release API is deeply nested and lives on a DIFFERENT host
(`vsrm.dev.azure.com`) from the core ADO API (`dev.azure.com`). Implementing a
release attribute without first mapping the real request/response shape leads to
perpetual diffs and live-only apply failures. This skill maps the surface first.

## When to use

- Before adding or changing a `betterado_release_definition` /
  `betterado_release_folder` / `betterado_release_definition_permissions` attribute.
- An attribute round-trips wrong (a perpetual plan diff) — the API returns extra
  computed keys the flatten must filter.
- Characterising an undocumented call (pair with `ado-browser-inspector` for portal
  network traces).

## The release object graph (what to map)

A release definition is a nested tree — map each layer's API shape separately:

- `stages` (API: environments) → `deploy_phases` → `deployment_input` +
  `workflow_tasks` (task and `metaTask`/task-group references).
- `pre/post_deploy_approvals` (+ approval `options`).
- `deployment_gate`s (sampling interval, stabilization window, gate functions).
- `conditions`, `environment_options`, execution + retention `policies`.
- `artifacts` (+ `definition_reference` — returns extra computed keys; the flatten
  must filter to user-set keys or you get a perpetual diff).
- definition- and environment-level `variables` (incl. secrets) + `variable_groups`.
- triggers: artifact, schedule, CD artifact, source repo, environment,
  `container_image_trigger`.

## Workflow

1. **Pick the endpoint** — Release Definitions / Folders / ACL. Confirm it is on
   `vsrm.dev.azure.com` and routed via the release client (`release.Client`), not
   `TaskAgentClient` or the core client.
2. **GET an existing object** — read a real definition back; record the exact JSON
   for the layer you are touching (the source of truth for the flatten).
3. **Round-trip a minimal create** — POST the smallest valid body, GET it back,
   diff request vs response to find API-computed keys the flatten must filter.
4. **Record** — write/extend the gap matrix under `docs/` for this resource (which
   API fields are covered, which are gaps). Pair the matrix with a sentinel audit
   test where one exists.
5. **Hand off** to `resource-scaffolder` / `schema-refactor` with the mapped shape.

## Gotchas

- Wrong host = 404/401 that looks like a permissions problem. Always vsrm for releases.
- Stale-revision update ⇒ HTTP 400 (`InvalidRequestException`, "old copy of the
  release pipeline"); re-read for the current revision and retry once.
- `definition_reference` and other computed sub-objects return keys not in user
  config — filter in flatten to avoid a perpetual diff.

## Done when

The endpoint's host/client, the real request/response JSON for the touched layer,
and the API-computed keys to filter are recorded in the resource's gap matrix, and
the implementer has the exact shape to build expand/flatten against.
