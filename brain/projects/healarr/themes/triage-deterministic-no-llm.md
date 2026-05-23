---
title: healarr — triage stage is deterministic; LLM only in agent stage
description: >-
  Two-stage pipeline. Triage = rule engine over observations; cheap, fast, no
  LLM. Agent stage runs only on the small fraction triage marks suspicious.
  Don't blur the boundary.
category: decision
keywords:
  - healarr
  - triage
  - deterministic
  - two-stage
  - llm-cost-control
  - rule-engine
created_at: 2026-05-04T19:30:00.000Z
updated_at: 2026-05-04T19:30:00.000Z
related_themes: []
---

# healarr — triage is deterministic; LLM only in agent stage

healarr's pipeline is intentionally two-stage:

1. **Triage** — deterministic rule engine over recent observations. Cheap, fast, no LLM. Emits structured events for the small fraction of observations that look wrong.
2. **Agent** — a Claude conversation invoked **per event**, equipped with tier-scoped tools.

The boundary is the cost-control mechanism. If triage delegates classification to the LLM, healarr's bill scales with poll volume; if triage stays deterministic, the bill scales with the (much smaller) anomaly count.

For forge initiatives on healarr:

- A proposed feature that adds *"use the LLM to decide if this is wrong"* in the triage stage is an **architect-level escalation** (CEO + DX critics). It's not just a tactical choice — it changes the project's cost shape.
- Adding rules to triage is fine and routine.
- The agent stage's tool inventory + tier assignments live in `docs/tools.md` — that's the canonical source.

## Sources

- healarr README "What it does about it" — two-stage pipeline definition.
