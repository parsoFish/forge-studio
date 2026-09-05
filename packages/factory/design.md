# `@forge/factory` — internal shape

The door is `README.md`. This file is what is behind it: 36 production modules —
22 under `phases/`, 14 at the root — plus the SKILL.mds, artifact templates and
the class table. **11,053 production lines of a ratified 13,500 cap.**

## The shape

**The class table is the spine.** `class-profiles.ts` (173 lines) is the ONE
place a change class's gates are decided, and every station reads it rather than
re-deriving from a class name — a rule its `class-profiles.contract.test.ts`
enforces by scanning this package for `switch (class)` and its cousins. Its
columns and their consumers:

| column | read by |
|---|---|
| `iter0FailFirst` | `phases/developer-loop.ts` → the ralph runner's hollow-gate guard |
| `requiredPathsSource` | `phases/developer-loop.ts` → `gateRequiredPaths` |
| `mergeBoundaryTest` · `mergeBoundaryVerb` | `phases/executor-deps.ts` → `phases/merge-boundary.ts` |
| `capture` | `phases/integrate.ts` |
| `reviewLenses` | `phases/adversarial-review.ts` — once, threaded to both the prompt and the validator |
| `singleWiAllowed` | the plan gate (as a GATE) and `phases/pm-class-set-rules.ts` (as a FLAG) |

`COLUMNS_AWAITING_A_CONSUMER` is **empty**: a column is wired or it is deleted,
never carried. Two were deleted or narrowed on those terms rather than given an
invented meaning — see the contract test's own comments.

**The phases are the stations.** Each is a function the flow runner reaches
through `phases/executor-table.ts`, taking its collaborators from
`phases/executor-deps.ts`. That indirection is what lets a test drive the whole
DAG without spawning an agent, and it is the reason the class's merge-boundary
selection can be threaded down into `@forge/flows` without this package being
imported by it.

## Over the cap, and what each split is

`check-file-size.mjs` caps a file at 800 lines. Two production files here carry a
baseline exemption, **and an exemption is a ceiling, not a licence** — both
numbers only ratchet down:

| file | lines | why it is big | the split, named |
|---|---|---|---|
| `phases/developer-loop.ts` | **1,937** | it is three concerns in one file: the per-WI dispatch loop, the worktree/fan-in mechanics, and the gate-feedback writers | the feedback writers (`writeGateFeedback`, `writeMergeConflictFeedback` and the scratch-path rules around them, ~300 lines) are the clean first cut — they share no state with the dispatch loop and are already reached only by name |
| `phases/reflector.ts` | **981** | the reflect turn, plus manifest resolution, plus the reflection-lost accounting | `resolveCurrentManifestPath` and the lost-reflection emitters (~180 lines) are the cut that clears the cap outright, the same shape `project-manager.ts` took when it went 859 → 687 |

Neither split lands in M5-A session 5: both are refactors of files under active
change in the same session that wrote this document, and a split done for the
line count while the behaviour is moving is how a regression arrives with a
clean diff. **They are named here so the next session inherits a decision, not a
discovery** — which is the whole reason this file exists.

## Residue

`boundary-share.mjs factory` reports **5 rows**, and every one is a TEST reaching
out of the package: three spawn-capture tests importing the shared
`orchestrator/test-fixtures/spawn-capture/normalize.ts`, and two demo-builder
tests importing `apps/forge/ui-bridge.ts`. No production module here crosses the
boundary. The three `normalize.ts` importers go with the fixtures when
`orchestrator/` retires in M6; the two `ui-bridge.ts` importers are route tests
that belong beside the route.

## What the package must keep being able to say

**Delete this directory and `forge studio` still boots.** Not as a claim — as a
test: `scripts/factory-deletable.mjs` removes the package in a scratch worktree,
boots, and asserts the caller's own tree came back untouched. If a third seam
ever appears, that proof fails by name, and it is meant to: ADR 048 makes the
seam set fixed and enumerated, so a third one is a decision somebody has to
make out loud.
