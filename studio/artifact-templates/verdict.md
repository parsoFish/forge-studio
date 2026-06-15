---
id: verdict
name: Verdict
kind: file
producer: review
consumer: reflector
schema:
  requiredFiles:
    - _logs/<cycleId>/artifacts/verdict.json
  requiredFields:
    - kind
    - initiative_id
---

# Verdict artifact contract

The human review decision at the verdict gate: `kind` ∈ `approve | send-back`. On send-back it
also carries the UWI (unifier-work-item) feedback the unifier drains in place (ADR 026, no
discard). Today the verdict is a transient POST that drives state transitions; the ADR-027
amendment persists it as `_logs/<cycleId>/artifacts/verdict.json` so the reflector has a durable
record of the operator's rationale.

- **Producer:** the `review` verdict gate (`ReviewVerdictForm`).
- **Consumer:** reflector (retro context) — and the unifier on a send-back resume.
