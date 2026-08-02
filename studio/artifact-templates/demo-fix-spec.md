---
id: demo-fix-spec
name: Demo Fix Spec
kind: file
producer: demo-agent
consumer: developer-ralph
schema:
  requiredFiles:
    - _logs/<cycleId>/artifacts/demo-fix-spec.json
  requiredFields:
    - initiative_id
    - proposals
---

# Demo-fix-spec artifact contract

The demo agent's AC-miss judgment (R4-07-F2): when the composed demo cannot show an
acceptance criterion passing (`acEvaluations` verdict `partial | missed`), the agent scopes
fix proposals — verbatim criterion, evidence for the miss, a one-line fix mission, ADR-015-shaped
`acceptance_criteria` (GWT) and `files_in_scope` — and the pipeline persists them here.

This artifact is **judgment output, never a dispatch**: the R4-10-F1 loop topology's shared fix
executor (the develop agent) compiles proposals into real work items with only id/kind
assignment. **That executor landed in R4-10-F1** — `execDemo`'s `complete-with-misses` path
calls `demo-fix-loop.ts`, which maps each proposal onto a `demo-fix` work item
(`compileFixWorkItems`) and stamps the manifest send-back so the fix-loop drain re-enters
`resume_from:'develop'`. An all-met demo writes no fix spec at all — absence means nothing
needed fixing.

- **Producer:** `demo-agent` (the R4-07 demo pipeline's judgment band).
- **Consumer:** `developer-ralph` — the single post-develop fix executor (R4-10-F1). Until
  R4-10 wires a verdict-gate surface for it, the artifact is reachable via the generic
  `/api/artifact/<cycleId>/demo-fix-spec.json` route only (no dedicated UI yet).
- Like `verdict`, deliberately **not runtime-guarded** by `assertInboundArtifacts` — it exists
  only for cycles whose demo had misses.
