# release-refine — a bare-minimum, out-of-the-box flow

`release-refine` is a minimal flow authored entirely as Studio **data** (`flow.yaml`).
It runs through the real engine (`flow-runner.ts`) with **zero orchestrator code
changes** — it reuses the existing node-executor kinds (`pm`, `dev`, `unifier`,
`review`) mapped from agent slugs. This is the proof that Studio can author a flow
and run it without bespoke wiring, in contrast to the seeded 6-phase `forge-cycle`.

## Shape

```
pm ──work-items──▶ dev ──wi-branches──▶ unifier ──pr──▶ review(gate: verdict)
        (fanOut: work-items)              (resumable)
```

Four nodes, four existing executors, one human gate. It drops the architect
(no interactive PLAN gate — the initiative comes from the project `roadmap.md`
+ the seeded manifest; the PM has no architect-PLAN dependency) and the reflector
(reflection is driven separately at close). The `verdict` gate satisfies the
`zero-gate` lint rule; unattended completion is achieved by approving the verdict
at the bridge at run time (the same posture as the verify-cycle harness), not by a
flow-level flag. Cost is hard-capped at $80/run.

## What the flow demands of a project → where betterado provides it

This is the contract↔flow tie: the flow's required capabilities define what a
managed project must bring. (Mapped onto the rebuilt project↔Studio contract.)

| Flow node | Capability it needs from the project | betterado provides it via |
|---|---|---|
| `pm` | Decompose a refinement initiative into work items | `roadmap.md` (C4) + project brain (`forge/brain/`) + the seeded manifest |
| `dev` | Implement Go/Terraform changes; satisfy the per-WI quality gate; non-default fixtures with read-back (C9) | `AGENTS.md` build/test invocations (C8) + `resource-scaffolder` & `schema-refactor` skills + `quality_gate_cmd` |
| `dev`/`unifier` | Produce live REST evidence as the demo (not a test-name table) | `ado-demo` skill + `demoProcess` (capture→verify→present) |
| `pm`/`dev` | Review ADO API coverage to find gaps | `ado-api-explorer` skill + the `docs/*-gap-matrix.md` records |
| `unifier` | Merge WI branches, assemble the demo, write the committed history record, open the PR | the `forge/history/<INIT>/` convention (AGENTS.md) + `ci_gate` |
| `review` | A satisfiable merge model | GitHub remote (C6); verdict auto-approved at run time |

Running betterado's release-refinement initiatives through this flow is the
capstone proof: a flow authored as data drives real, live-ADO work to merged PRs.
