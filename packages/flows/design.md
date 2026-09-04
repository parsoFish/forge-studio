# `@forge/flows` — design

## The seam

One flow, run once. Walk a `FlowDefinition` node by node, hand each node to a
`PhaseExecutor`, and carry the result — a queue transition, a manifest, a
work item, a PR — to the next node. Everything else in this package exists to
serve that sentence.

## The port is not a style choice; it is what rank 5 costs

flows is the highest-ranked package, and the one tree it may never import is
`factory`. The phase executors that actually run an agent live in
`orchestrator/phases/*`, which is factory's. So `runFlow` takes a
`PhaseExecutor` and never names one — `flow-runner.ts` imports no phase and no
preflight — and `apps/forge` binds the real executors at assembly time
(rulings 13/35/59).

**Where that rule is not yet true, as built.** Three files in this package still
reach into factory, and they are disclosed rather than described away:

| file | reaches | class |
|---|---|---|
| `cycle.ts` | `orchestrator/phases/executor-{table,deps}.ts` | `package-to-legacy` ×2 |
| `finalize-merged.ts` | `@forge/factory/phases/reflector.ts` | `package-layer-order` |
| `cycle-pm-hallucination.test.ts`, `wi-dispatch-scheduler.test.ts` | factory phases | `package-layer-order` ×2 |

All five are baselined, owned by **M5-A**, and listed in this lane's handoffs.
`cycle.ts` is the shape to fix first: it constructs the executor itself instead
of receiving one, which is the port being half-applied — exactly the thing
`runFlow` avoids one level up.

This is worth stating plainly because the alternative keeps re-appearing:
importing an executor "just for the type" puts a rank-5 package under a tree it
may not import, and the boundary lint says so. The port is the shape that cannot
be half-applied — and the table above is what "not yet applied everywhere" looks
like when it is measured instead of assumed.

The same rule produced the injection in `apps/forge/routes.ts`:
`makeRouteTable(deps)` is built per bridge instance, and this package
contributes route factories (`handleHookRoutes`, `handleRecoveryRoutes`,
`handleStudioPostRoutes`) rather than a router it owns.

## ADR 028 — the flow IS the ordered path of stations

A flow is data: nodes, edges, kickoff, triggers. `studio/flow-registry.ts`
loads and serializes it, `studio/validate-triggers.ts` checks its trigger
block, `flow-fanout.ts` answers a question about its shape. Adding a station
is authoring YAML; the code path does not change.

Task 13 (M4-flows) moved that loader here from
`orchestrator/studio/registry.ts`, the last home of a Studio object kind its
own package did not own — the same split the Agent kind took to
`@forge/agents/studio/agent-registry.ts`. The rule underneath: **the package
that owns the engine owns loading its definitions.**

The Flow *vocabulary*, though, is shared. `FlowDefinition`, `FlowNode`,
`FlowEdge`, `FlowKickoff` and `FlowTrigger` stay in `@forge/contracts` and are
imported downward by everyone who needs them. Only the parser is flows'.

## Manifests, queue, work items: one state machine with three views

The queue directories (`pending`, `in-flight`, `ready-for-review`, `merged`,
`done`, `failed`) are the state machine. A manifest describes what a cycle is
for; work items describe the units inside it; the run model derives what the
UI reads. All three are **files on disk that a human can grep**, which is the
campaign's rule for every artifact, and it is why the recovery path is a
directory scan rather than a reconstructed in-memory graph.

`manifest.ts` re-exports `InitiativeManifest` from `@forge/contracts`
(ruling 81) for its own callers. The type is contracts', not flows'; the
package door deliberately does not claim it.

## Containment: every request-derived id is a segment, never a root

`manifest-path-guard.ts` (`isSafeProjectName`, `isContainedProjectRepoPath`)
and the guarded-file route are the choke points. The rule that keeps this
package out of the raw-fs guard's findings list is the one the guard states:
a request-derived id rides as a **segment** under a trusted root and is never
folded into the root. Bead 5.36 applied it to `idExistsInQueue` even though a
`idToken()` slugify already made the site safe — because "safe because a
function forty lines up says so" is an invariant held by a comment, and the
guard should hold it instead.

## What this package is not

It is not the factory. It does not know how to run an agent, what a band is,
or how a demo is captured — it knows that a node has a kind, that a kind maps
to an executor at assembly, and what to do with the result. When a change here
starts needing to know what an executor *does*, that is the signal the change
belongs in factory.
