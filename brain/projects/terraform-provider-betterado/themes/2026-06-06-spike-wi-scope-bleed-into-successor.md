---
title: Spike WI scope bleed — agent implements successor WI's scope during spike
description: WI-1 (token spike) wrote the full permissions implementation AND tests, so WI-2 (impl) was already-complete at iter-0 ($0, zero tool use) — the WI boundary was ceremonial.
category: antipattern
keywords: [spike-wi, scope-bleed, wi-boundary, gate-superset, already-complete, iteration-zero, wi-collapse]
related_themes: [pm-decomposition-index]
created_at: 2026-06-06T00:00:00.000Z
updated_at: 2026-06-06T00:00:00.000Z
---

## Antipattern

In the INIT-2026-06-05-release-definition-permissions chain:

- **WI-1** gate: `TestReleaseDefinitionPermissions_TokenFormatSpike` — intended to only probe the ADO token format.
- **WI-2** gate: `-run TestReleaseDefinitionPermissions` — intended to write the implementation file and unit tests.

WI-1's agent wrote:
1. The token format spike test (correct)
2. The **full** `resource_release_definition_permissions.go` implementation file
3. All unit tests, because the spike naturally extended into "while I have the namespace confirmed, let me write the resource"

Result: WI-2 evaluated at iter-0 → `gate.pass` → `already-complete`. $0 cost, zero tool use. Zero actual work done.

## Why it happens

Agent interpreted WI-1's target (confirm token format) as "confirm AND build" once the format was known — the spec's distinction between "probe" and "implement" wasn't enforced at the gate level. WI-2's gate prefix (`TestReleaseDefinitionPermissions`) was a superset of WI-1's gate, so anything WI-1 wrote satisfied WI-2 automatically.

## Correct approach (operator-confirmed)

> Collapse spike + impl into a **single WI** for future permissions resources. Keep a separate spike WI only when a negative result would change the implementation approach (i.e. risk-separation that can actually fire). For a permissions resource whose only unknown is the token format, "spike + impl" is one WI.

A two-WI split for spike + impl adds ceremony with no safety valve unless the spike outcome can genuinely kill the impl.

## Signal

If WI-N's gate is a superset of WI-(N-1)'s gate prefix, the split is a candidate for collapse.

## Sources

- `_logs/2026-06-06T05-30-11_INIT-2026-06-05-release-definition-permissions/events.jsonl` (gate.pass WI=WI-2 iter=0 at 05:42:38; ralph.start WI=WI-2 and ralph.end WI=WI-2 same second)
- `/home/parso/forge/brain/cycles/_raw/2026-06-06T05-30-11_INIT-2026-06-05-release-definition-permissions.md`
