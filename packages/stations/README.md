# `@forge/stations`

The station executor and every band it dispatches (ADR 028): the phase table a
flow runner is handed, and the orchestrator-band implementations behind it — the
project-manager pass, the developer loop, integrate, adversarial-review, the
reflector and release-finalize. This is the platform's execution machinery.
`packages/factory` (the develop/plan example) supplies the FlowDefs, the
SKILL.mds, the artifact templates and the class → gate-profile table; this
package runs them, so that deleting `packages/factory` still leaves a station
executor a second factory can run against (operator ruling, items 81/83).

Rank: between `flows` and `factory` in the allow-graph. It may import
`contracts`, `kernel`, `library`, `knowledge`, `projects`, `agents`, `sessions`
and `flows`. It may **never** import `factory`.

## API (9 values)

| the station executor | `createPhaseExecutor` · `createProjectGate` · `defaultRunClosure` · `registeredBandIds` |
| bands the assembly binds statically | `reconcileReflectFeedback` · `rerunReflector` · `runAdversarialReview` · `runReflector` · `runReleaseFinalize` |
| the docs class's merge-boundary verb | `runDocsGate` |

### Types

`FlowRunnerDeps`

## What is inside

`phases/` and `gates/` are the bands themselves, in the same relative layout
they had in `packages/factory`. The root files (`demo-model.ts`, `demo-types.ts`,
`cycle-recap.ts`, `reflect-reconcile.ts`, `reflection-doc.ts`,
`reflector-rerun.ts`, `release-process.ts`, `release-finalize-invocation.ts`)
are the band content those phases need — the demo bundle model, the reflection
doc parser, the release-finalize steps.

## What was here before

Every module in this package lived in `packages/factory` until the F3 move
(operator ruling, items 81/83): the executor and every band were the example's,
so deleting the example deleted execution. `class-profiles.ts`, `demo.ts`,
`demo-capture.ts`, `demo-runtime.ts` and `index.ts` stayed behind — the example
factory's own class table and demo-capture machinery, not part of the
platform's execution seam. The move was a pure transfer: `git mv` for every
file, no behaviour change.
