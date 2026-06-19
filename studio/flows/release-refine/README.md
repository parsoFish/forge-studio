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

## Why the name is honest: this flow really does *release*

When the managed project declares a `releaseProcess` (contract **C10**), this flow
performs real release work, not just "refine to a PR":

- **In-cycle** — the PM folds the C10 docs/changelog draft requirement into the
  standing ACs of *every* work item (`releaseDraftAcs`), so `dev` keeps README/docs
  current and drafts a `## [Unreleased]` changelog entry as it builds.
- **Pre-merge** — after the verdict gate approves, the post-approval
  `release-finalize` phase (the `release-finalizer` one-shot agent) promotes the
  draft changelog into a finalised, versioned release commit on the PR branch
  (semver bump + the declared pre-merge steps), then commits + pushes. Tag/publish
  stay with the project's CI release workflow.

A project that does **not** declare `releaseProcess` simply skips both: the standing
release ACs become empty and the finalize phase is a no-op, so the flow degrades
cleanly to a plain refine-to-PR run. The name `release-refine` describes the
opted-in spine — refine a roadmap initiative and release it — and is accurate for
any C10 project.

## What the flow demands of a project → which contract clause supplies it

This is the contract↔flow tie: each node's required capability maps onto a clause
of the [forge↔project contract](../../../docs/forge-project-contract.md). The
mapping is **project-agnostic** — any project that satisfies these clauses can run
on this flow. The right-hand column shows it grounded on `mdtoc` (forge's creds-free
out-of-the-box reference project), with `terraform-provider-betterado` as a second,
live-credentialed example.

| Flow node | Capability it needs | Contract clause | mdtoc (OOTB reference) | betterado (live example) |
|---|---|---|---|---|
| `pm` | Decompose a refinement initiative into work items | **C4** machine-readable planning inputs | `roadmap.md` + project brain (`forge/brain/`) + seeded manifest | `roadmap.md` + project brain + seeded manifest |
| `dev` | Run the per-WI quality gate (truthful, discriminating done-signal) | **C1** | `npm test` (node:test, <1s, creds-free) | `go test -tags all -run …` (scoped package) |
| `dev` | Prove the change against the real thing via an acceptance WI | **C7** external-resource model | `npm run acceptance` (built CLI vs a fixture; `requires_env: []`) | live `TF_ACC` suite against a real ADO org |
| `dev` | Non-default fixtures asserted by read-back | **C9** | `sentinel-7f3a9c` fixture heading + duplicate-anchor read-back | distinctive resource values + REST read-back |
| `dev` | Hermetic commit capture on the WI branch | **C2** | git-truth (no ignored build output committed) | git-truth |
| `dev` | Follow the human-authored agent-instruction file | **C8** | `CLAUDE.md` build/test invocations | `AGENTS.md` build/test invocations |
| `dev`/`unifier` | Keep docs current + draft the changelog in-cycle | **C10** (in-cycle) | README/roadmap parity + `## [Unreleased]` CHANGELOG draft | docs parity + changelog draft |
| `unifier` | Merge WI branches, assemble the demo as real evidence, write the committed history record, open the PR | **C2** + demo evidence + `artifactRoot` | `npm run demo` → captured TOC under `forge/history/<INIT>/demo/` | `ado-demo` skill → live REST GET evidence |
| `review` | A satisfiable merge model | **C6** | GitHub remote; verdict auto-approved at run time | GitHub remote; verdict auto-approved at run time |
| *(post-approval)* | Finalise the release: promote changelog + bump version pre-merge | **C10** (pre-merge) | `release-finalize` phase → semver bump in `package.json` + changelog promote | `release-finalize` phase → version bump + changelog promote |

Running `mdtoc`'s release-refinement initiatives through this flow is the
out-of-the-box proof: a flow authored as data drives a real, creds-free project
to a *released* merged PR, exercising every contract clause above. Pointing the
same flow at `terraform-provider-betterado` is the live-credentialed proof — the
identical node graph drives live-ADO work to merged PRs.
