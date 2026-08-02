---
id: review-findings
name: Review Findings
kind: file
producer: adversarial-review
consumer: review
schema:
  requiredFiles:
    - _logs/<cycleId>/artifacts/review-findings.json
  requiredFields:
    - initiative_id
    - findings
---

# Review-findings artifact contract

The adversarial-review agent's critique of the developed diff (R4-08-F1), distinct from the
demo's AC-proof: severity-ranked findings (`blocker | major | minor | info`) across four lenses
(`correctness | regression-risk | contract-fit | convention-drift`), every claim backed by
`file:line` evidence pointers. `headSha` records exactly what was reviewed — the SHA-change
guard hook for the R4-08-F2 send-back rounds. An **empty findings array is an explicit clean
pass** and is still written.

These are **agent claims weighed by the operator at the verdict gate — never a gate by
themselves** (ADR-021: approve IS the merge, and that decision stays with the operator;
ADR-036: the agent judges, evidence assembly is orchestrator-owned). The operator's decision
record (`verdict.json`) keeps its own shape untouched.

- **Producer:** `adversarial-review` (the R4-08 critique pipeline).
- **Consumer:** the `review` verdict gate (rendered beside the demo evidence) — and the
  reflector, for retro context.
- R4-10-F1 wired this onto the live `adversarial-review → review` edge. `execAdversarialReview`
  fails loud on a pipeline failure (no PR opens without a completed review), so when the verdict
  node runs the findings file is ALWAYS present — the `assertInboundArtifacts` guard is therefore
  satisfied by construction. A clean review is still an explicit `findings: []`, never an absence.
  Pre-R4-10 cycles (the retired unifier flow) carry no such edge and are unaffected.
