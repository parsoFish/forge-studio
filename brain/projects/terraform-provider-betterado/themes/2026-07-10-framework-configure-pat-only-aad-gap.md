---
title: Framework Configure() wires PAT auth only — AAD/OIDC/MSI/CLI non-functional
description: After the mux-free cutover the framework Configure() only wires PAT auth; AAD/OIDC/MSI/CLI schema attributes are accepted but non-functional — a pre-existing gap deferred as a follow-up initiative before any public 2.0.0 release.
category: reference
created_at: 2026-07-10T00:00:00.000Z
updated_at: 2026-07-10T00:00:00.000Z
---

## Context

The mux-free cutover (INIT-2026-07-01-mux-free-cutover, PR #68, betterado 2.0.0) removed the `tf6muxserver` + SDKv2 path. All resources now route through `framework_provider.go`'s `Configure()`. That method wires only PAT-based `*client.AggregatedClient` construction.

The provider schema still exposes `client_id`, `tenant_id`, `oidc_token`, `use_msi`, `use_azure_cli`, etc. (inherited from the upstream SDKv2 path). These fields are parsed but the framework `Configure()` does not act on them — the client is built unconditionally from `AZDO_PERSONAL_ACCESS_TOKEN`.

## Implication

Any user of betterado 2.0.0 who relies on AAD/OIDC/MSI/CLI auth (not PAT) will accept configuration without error but get unauthenticated or wrong-credential failures at plan/apply time — a silent regression vs the SDKv2 path.

## Status (2026-07-10)

- Not in scope for the mux-cutover initiative.
- Flagged in `docs/investigations/2026-07-betterado-run-friction.md` (2026-07-10 — ROADMAP COMPLETE entry) as a required follow-up before any public 2.0.0 release.
- No initiative queued as of reflection date.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-mux-free-cutover/user-feedback.md` — operator Q2 answer
- `/home/parso/forge/brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-mux-free-cutover.md` — cycle archive
