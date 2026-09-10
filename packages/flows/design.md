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

## Every outward `gh` call acts as a NAMED identity, or does not happen

Bead `forge-8vfn.7.6.15`, operator ruling 597(a). `packages/flows/gh-pinned.ts` is the one
seam; nothing in this package runs `gh` any other way.

**What it replaces.** Ten call sites ran `gh` bare — `execFileSync('gh', [...], { cwd,
stdio })` with **no `env`**. `gh` then resolved its own credential: `GH_TOKEN`/`GITHUB_TOKEN`
if set, otherwise **the active account in `~/.config/gh/hosts.yml`**. Nothing in the bridge
sets either, so forge merged, created and edited pull requests as *whatever account happened
to be active on the host* — indistinguishable from the operator doing it by hand. That is the
2026-07-16 incident's mechanism (the bridge self-merged PR #23 with the operator's token), and
`mergePullRequest` still carried it.

**The fix already existed one package down.** `@forge/kernel`'s `gh-identity.ts` — bead
`6.11.35`, rulings 341/344 — was written for exactly this class after `mintRemote` inherited an
Enterprise Managed User and failed *after* a complete scaffold, with `gh auth status` passing
the whole time. It gives `assertGhOwner` ("can THIS identity act as the owner we are about to
write under") and `ghRunnerFor` (token in the **child env only**, never in argv, never in this
process's env, never in a thrown message). Its only production caller was repo creation.

**The owner is derived from the remote, not from config.** No `projects.remote.owner` is
configured in any worktree on this host, so "refuse when unconfigured" would break every
outward call. And the right identity for `gh pr merge` in repository R is simply **the owner of
R** — which the worktree already knows, because it pushes there. Deriving it needs no new
config key, adds no second copy of `project-create.ts`'s `REMOTE_ACCOUNT` default, is correct
per-repo when mdtoc, gitpulse and a provider fork have different owners, and gives
`assertGhOwner` a question with a real answer.

**A non-GitHub remote is a refusal, not a guess.** `pr.ts`'s own `parseOwnerRepo` falls back to
a host-agnostic `[:/]owner/repo` match, which is right for *naming* a repo in a message and
wrong for *choosing a credential*: a GitLab URL must not select a GitHub identity.

**`origin` is a convention, not a rule.** When there is no remote by the requested name, the
seam uses the **only** remote if there is exactly one, and refuses when there are several. That
is not a guess — a repository with one remote unambiguously pushes there — and it exists
because forge's own checkout names its remote `parsoFish`. Without it this seam would refuse on
the repository forge is most often pointed at, pushing callers back to the bare `gh` it
replaces.

**One keyring read, and why that is a correctness point rather than a saving.**
`assertGhOwner` and `ghRunnerFor` each call `ghTokenFor`, so composing them naively reads the
keyring twice — and the token that was CHECKED would not be the token that gets USED if the
keyring changed between them. The seam memoises the `auth token` answer for the owner, which
closes that TOCTOU and keeps `gh-identity.ts`'s own rule ("read ONCE, when the runner is
built") true through the composition. The runner itself is cached per worktree, because
`pr-ci-watch` polls and a per-call `assertGhOwner` would mean a `gh api user` round trip per
poll.

**Residual, named rather than left to be discovered.** The runner cache is keyed by worktree +
remote **name**, not by the remote's URL. If a process repoints `origin` at a different owner
mid-run, calls after that point still use the runner built for the previous owner. It is not
reachable from a request — only the scheduler's own code repoints a remote — and forge's
processes are short-lived per cycle, so the window is a cycle rather than a daemon's lifetime.
Re-deriving per call would trade it for a `gh api user` round trip on every `pr-ci-watch` poll,
which is the worse deal; `__resetGhRunnerCache` is the escape hatch if a caller ever
legitimately needs one.

