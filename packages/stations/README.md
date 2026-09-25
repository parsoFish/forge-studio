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
and `flows`. It may **never** import `factory` — that is what `ClassProfilePort`
is for: the bands read the class → gate-profile table through this injected
port, never through a direct import of `class-profiles.ts`.
`createPhaseExecutor` takes the port optionally; with none bound, a station
that needs the class table throws, naming `ClassProfilePort`, rather than
silently guessing a default profile.

## API (9 values)

| the station executor | `createPhaseExecutor` · `createProjectGate` · `defaultRunClosure` · `registeredBandIds` |
| bands the assembly binds statically | `reconcileReflectFeedback` · `rerunReflector` · `runAdversarialReview` · `runReflector` · `runReleaseFinalize` |
| the docs class's merge-boundary verb | `runDocsGate` |

### Types

`ChangeClass` · `ClassProfilePort` · `FlowRunnerDeps` · `GateProfile`

## One door, plus three literal production subpaths and one test-only subpath

`package.json` maps `"."`, plus three specific deep paths kept legal on
purpose — `"./demo-model.ts"`, `"./demo-types.ts"` and `"./gates/docs-gate.ts"`
— and `"./testing"`. Bead `forge-8vfn.5.31` narrowed `exports` from the
`"./*"` wildcard this package started with (the module doc above still says
"those keep working unchanged; `git grep '@forge/stations/'` finds them",
which was true before the narrowing and is why the three production paths
below are named rather than silently broken).

The three literal paths are production, not test-only, and are kept deep
rather than repointed through the door for the same reason
`apps/forge/factory-cli-wiring.ts`'s own module doc gives for keeping
`@forge/factory/demo.ts` and `gates/docs-gate.ts` out of
`factory-wiring.ts`'s static graph: naming them through a barrel pulls
whatever ELSE the barrel exports into the same reachable-sink surface a
request-path scan measures, for a CLI verb the bridge never calls.
`demo-model.ts` and `demo-types.ts` are also imported by `packages/factory`'s
own `demo.ts` and `demo-runtime.ts` (a real cross-package production
consumer, not the CLI seam) — same two paths, same reason to keep them deep
rather than route a demo-capture-heavy import through this package's main
door.

`@forge/stations/testing` exports `settleWiOutcome`/`assertOutcomesSettled`/
`WiOutcome` (`phases/developer-loop.ts`), `runProjectManager`/`PmQueryFn`
(`phases/project-manager.ts`), `NodeExecutor`/`integrateDeliveryFailure`
(`phases/executor-table.ts`, beyond what the main door already exports from
that file) and `deriveDemoModel` (`phases/derive-demo-model.ts`) — each has
no production consumer outside this package, only `apps/forge` and
`packages/flows` tests reach for them.

## What is inside

`class-profile-port.ts` declares the port (`ClassProfilePort`, and the
`ChangeClass`/`GateProfile` types the table is shaped by — moved here verbatim
from `packages/factory/class-profiles.ts`, which now imports them back down).
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
platform's execution seam. `git mv` for every file, with one behaviour added:
`ClassProfilePort`, so a band reaches the table by injection instead of a
direct import that would have made this package unable to build without
`packages/factory` installed.
