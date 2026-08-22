# ADR 045 — The operator workspace and the promotion path into forge core

- **Status:** Accepted (2026-08-23, operator) — **design only**. Nothing in this ADR is built by the
  change that lands it; it decides the shape, names the seams, and hands the build to the roadmap
  initiatives listed below.
- **Date:** 2026-08-23
- **Supersedes / amends:** Amends [ADR 027](./027-studio-object-model.md) (the Studio object model)
  by giving every filesystem registry a second, operator-owned root and making an object's root its
  provenance. Amends nothing in [ADR 031](./031-studio-consolidation.md) — this ADR is written to
  *preserve* its sole-interaction-point rule, and it explicitly re-ratifies the no-auto-commit policy
  of `docs/community-registry-writes.md`. Leaves [ADR 035](./035-forge-owned-central-artifacts.md)
  (Brain 3 lives in the forge repo) intact and in force: `brain/` does **not** move.
- **Related roadmap:** `docs/roadmaps/R3-library-componentry.md` — R3-08 (the operator workspace root
  and provenance by root) and R3-09 (promotion into forge core);
  `docs/roadmaps/R6-operator-experience.md` — R6-10 (the pending-platform-changes surface).

## Context

Forge Studio is the sole operator surface ([ADR 031](./031-studio-consolidation.md)). Operating it
means authoring: agents, flows, hooks, knowledge bases, community registry rows. Every one of those
writes lands in a **git-tracked path inside the forge repo itself**:

| What the operator authors | Where Studio writes it | Tracked? |
|---|---|---|
| Agent (skill) | `skills/<slug>/SKILL.md` (`cli/bridge-studio-writes.ts`, the agent PUT route) | tracked |
| Flow | `studio/flows/<id>/flow.yaml` (`cli/bridge-studio-writes.ts`, the flow save route) | tracked |
| Hook | `studio/hooks/<id>/{hook.yaml,scripts/run.sh}` (`cli/bridge-studio-hooks.ts`, create + edit routes) | tracked |
| Knowledge base | `brain/<id>/{kb.yaml,themes/,_raw/}` (`cli/bridge-studio-kbs.ts`, the KB create route) | tracked |
| Community registry rows | `studio/community/registry.yaml` (`cli/bridge-studio-writes.ts` CRUD + `commitRegistryDraft` in `orchestrator/interactive-finalizers.ts`) | tracked |
| Templates / demo elements | `studio/artifact-templates/<id>.md`, `studio/demo-elements/<id>.md` (`cli/bridge-studio-templates.ts`) | tracked |
| Skill packages, installs, approvals | `skills/<id>/**` (`cli/bridge-studio-skills.ts`, `installSkillPackage` / `approveSkillDraft` in `orchestrator/studio/skill-library.ts`, `installCommunityHookPackage` in `orchestrator/studio/community-install.ts`) | tracked |
| Per-machine install ledger + hook approvals | `studio/installed-skills.yaml`, `studio/hook-approvals.yaml` | tracked directory, files **not** gitignored |

That table is representative, not exhaustive — the full set is wider than the five paths the
operator-facing story starts from, which is precisely why §C below insists the declared set be data
with a drift guard rather than a hand-maintained list. Two useful pieces of negative evidence: Studio
writes **nothing** under `docs/`, and `studio/catalog.yaml` and `studio/session-kinds.yaml` have no
write path at all — they are hand-edited by design ([ADR 027](./027-studio-object-model.md) §5,
restated in `orchestrator/studio/registry.ts`). And one adjacent gap found while enumerating:
`_template-staging/` (`cli/bridge-studio-templates.ts`) is **not** gitignored, unlike its siblings
`_skill-staging/` and `_interactive-library/`. It is cleaned in a `finally`, so the leak is latent —
but a crash mid-request leaves an untracked directory sitting next to exactly the pending state this
ADR is about.

Studio **never** runs `git add` or `git commit` against the forge repo, and that is deliberate. The
policy is written down in `docs/community-registry-writes.md`:

> Studio **writes the working tree only**. It never runs `git add`/`git commit` on the forge repo — an
> unattended-adjacent surface silently committing to the operator's own checkout is exactly the class
> of surprise ADR-031's "one interaction point" exists to avoid, and the 2026-07-16 bridge-self-merge
> incident is the standing lesson.

That incident is why `cli/dry-bridge.ts` exists at all; its module docstring names it directly ("the
Studio bridge self-merged a forge PR with the operator's real gh token during a `ui:journey` harness
run"), and `docs/roadmaps/README.md` §"wave 0" cites it as the reason safety work was sequenced first.
**The no-auto-commit decision is correct and this ADR does not reverse it.**

One honest exception, stated so this ADR does not overclaim: `fixMisRouted` (`cli/brain-fix-auto.ts`),
reachable from Studio's "apply auto-fixes" button, runs `git -C <forgeRoot> mv` to relocate a
mis-categorised brain theme while preserving its history. `git mv` **stages** — so exactly one Studio
path today writes the forge repo's index. It is gated on a clean worktree first (a read-only
`git status --porcelain`) and there is no follow-up `commit`, so it stops one step short: the operator
is left with a *staged* change that, like every other Studio write, no surface reports. It is the
exception that proves the shape of the problem rather than a counter-example to it.

The problem is what the decision left unbuilt. Four things follow from "write the tree, tell nobody":

### 1. There is exactly one pending-change signal in all of Studio, and it is hard-coded to one file

`communityIndexMeta` (`cli/bridge-studio-community.ts`) runs a literal, single-path
`git status --porcelain -- studio/community/registry.yaml`, publishes the boolean as
`meta.registryDirty`, and `forge-ui/app/community/page.tsx` renders a notice from it. Agents, flows,
hooks and KB edits produce **no signal at all**. An operator can author a week of platform changes
and the only place forge will admit anything happened is the community page — about a file they may
never have touched.

This is not theoretical. On 2026-08-22 a knowledge-base drain rewrote six `brain/**` theme files and
a community refresh rewrote `registry.yaml` by +288/−75 lines, all uncommitted, with nothing in the
UI saying so; two of the six brain edits deleted graph edges whose targets existed on disk, and would
have been committed unseen. The operator is being asked to rubber-stamp destructive edits they have
no surface to inspect.

### 2. Provenance is structurally unanswerable, so it is honestly hard-coded to `'unknown'`

`cli/studio-provenance.ts` exports `AGENT_PROVENANCE` and `PROJECT_PROVENANCE` as the literal
constant `'unknown'`, with a docstring that explains why: *"an OOTB hand-authored agent and an
operator-authored one are byte-indistinguishable on disk."* That is the right answer to a question
with no evidence — the module refuses to fabricate a badge, mirroring the same refusal in
`forge-ui/lib/skill-library-view.ts`. But it means Studio cannot tell the operator which half of
their own library they wrote. It also notes the cure it expects: *"flipping it the day a real signal
lands (e.g. an `origin:` frontmatter key) is a one-line edit here."*

### 3. Machine-local state is already being written into tracked directories

Two files are written by Studio into the tracked `studio/` tree and are **not** gitignored:

- `studio/installed-skills.yaml` — the per-machine skill install ledger (`orchestrator/studio/skill-install-ledger.ts`)
- `studio/hook-approvals.yaml` — per-machine hook approval verdicts (`orchestrator/studio/hook-scan.ts`)

Neither exists in a clean checkout; `git check-ignore` reports both as not ignored. These are the
operator's "non-committed settings" ask as a live defect: per-machine trust decisions and install
bookkeeping sitting one `git add -A` away from the shared history of the product.

### 4. The mechanism the operator is asking for already exists — pointed at the wrong repo

`orchestrator/project-repo-tx.ts` is a complete, tested operator-edit transaction, and forge has been
running it for two months against **managed project repos**:

- `STUDIO_BRANCH = 'forge-studio'` — a single persistent branch that accumulates Studio's writes;
- `ensureStudioBranch` / `commitStudioChange` / `withStudioWrite` — every UI change is committed, not
  left in the tree (its docstring records the motivating bug: *"which is why 'apply decision'
  silently lost its edits"*);
- `saveProjectRepo` — one explicit operator "Save" merges the branch into the default branch and pushes;
- `hasPendingStudioChanges` — a derived pending-state answer, surfaced through
  `GET /api/studio/projects/:id/repo-status` (`cli/bridge-studio.ts`) and `fetchRepoStatus`
  (`forge-ui/lib/studio-client.ts`).

So forge already treats a *managed project's* repo as a first-class, transacted write target with a
pending-state surface and an explicit save, and treats **its own repo** as a scribble pad. That
asymmetry is the whole of operator note ON-2, and it is what this ADR resolves.

### The operator's ask is two asks

> "There is no real way we have currently to save changes to forge when the user makes them that hooks
> in with the forge repo — although maybe we just need the concept of non-committed settings for
> things like this. But I would need a way to roll changes I make to the platform back into forge
> core seamlessly."

These are two different problems with two different correct answers, and conflating them is why
neither has been built:

- **Non-committed settings** — state that is *mine, on this machine* and should never enter forge's
  shared history: my hook approvals, my install ledger, my private agent variant, my scratch flow.
  Committing these is the bug.
- **Promote-to-core** — an edit I made to the platform that *should* enter forge's shared history,
  reviewed like any other change to forge. Not committing these is the bug.

Forge is not starting from nothing on either half — every ingredient of the decision below already
runs in production, just never pointed at this problem:

- **Gitignored operator settings, with a tracked template and a first-run scaffold.**
  `forge.config.json` is gitignored while `forge.config.json.example` is tracked, and `ensureLayout`
  (`orchestrator/init.ts`) writes a default if the real file is absent. `*.env` / `.env.example` and
  `brain/.obsidian/` follow the same pattern. Non-committed operator settings are an established
  house convention that simply never extended to Studio objects.
- **A gitignored staging root that authoring already writes to instead of the tracked tree.**
  `_interactive-library/` holds drafted skill and hook packages, and `runInteractiveTurn`'s
  `libraryRootGuard` (`orchestrator/interactive-runner.ts`) is explicitly *"a dedicated, NON-scanned
  root, never `skillsDir`/`hooksDir`"*. Only the finalizer's `copyStagingToLibrary` moves a package
  into the tracked tree. `_connections/` is the same idea for installed packages.
- **Ordered multi-root resolution with the containment guard re-applied per root.**
  `resolveKbBrainDir` (`orchestrator/brain-paths.ts`) already resolves a KB id across
  `[brain/, brain/projects/]`, first hit wins, `resolveGuardedPath` per root, with a deliberate
  collapse of "rejected" and "absent" so no probe oracle leaks.

## Decision

Split the two asks and decide each separately. Neither half auto-commits anything to the forge repo,
ever.

### A. Non-committed settings — one gitignored operator workspace root, `_local/`

Introduce a single gitignored root, **`_local/`**, that mirrors the shape of the tracked trees it
shadows and is the **default write target for operator-authored Studio objects and all machine-local
state**:

```
_local/
  skills/<slug>/SKILL.md          shadows  skills/
  studio/flows/<id>/flow.yaml     shadows  studio/flows/
  studio/hooks/<id>/…             shadows  studio/hooks/
  studio/installed-skills.yaml    moves from studio/   (machine-local, never shared)
  studio/hook-approvals.yaml      moves from studio/   (machine-local, never shared)
```

The name follows the existing gitignored-underscore house convention (`_queue/`, `_logs/`,
`_connections/`) and deliberately avoids the word *workspace*, which already means an npm workspace
in this repo (`forge-ui`).

Four rules make this a decision rather than a directory:

1. **Registries resolve over an ordered root list, workspace-first.** Each per-kind root helper —
   `hooksDir(forgeRoot)` (`orchestrator/studio/hook-library.ts`) and its siblings for skills and
   flows — becomes an ordered resolver in the shape `resolveKbBrainDir` already uses: try
   `_local/<kind>/`, then `<kind>/`, first hit wins, **realpath containment guard re-applied per
   root**. The guard is not generalized, relaxed, or hoisted; each root keeps its own
   `resolveGuardedPath` call exactly as today. This is the *only* structural change the workspace
   half requires, and it is confined to a small, greppable set of root helpers.

2. **Studio writes go to `_local/` by default; writing to a tracked root is a distinct, explicit act.**
   Creating an object writes to `_local/`. Editing an object that lives in a tracked root is a
   **core edit** and is the promotion path's business (§B), not a silent tracked-tree write. This
   inverts today's default, which is the actual defect: the destructive default is the one forge
   currently takes.

3. **An object's root IS its provenance — derived, never stored.** `_local/` ⇒ `operator`; a tracked
   root ⇒ `ootb`. `AGENT_PROVENANCE` and `PROJECT_PROVENANCE` (`cli/studio-provenance.ts`) stop
   being constants and become derivations over the resolved root. This is the
   `derive-status-don't-store-it` corollary of [ADR 044](./044-read-path-memoization.md) applied to
   provenance: give the object no field in which to hold a stale copy of a fact its location already
   answers.

4. **`brain/` does not move, and neither does anything else forge legitimately owns.**
   [ADR 035](./035-forge-owned-central-artifacts.md) decided that per-project brains live in the
   forge repo on purpose, and that decision stands. `brain/` writes stay tracked and therefore stay
   *visible* — which is what §C is for. `projects/` is already gitignored and already has its own
   transaction (`project-repo-tx.ts`); it is untouched.

### B. Promote-to-core — a branch and a pull request, never a commit and never a merge

Promotion takes an object that lives in `_local/`, or an uncommitted edit to a tracked path, and
turns it into **a pushed branch and an open PR against forge**. It is an operator-initiated,
one-object-at-a-time act with a preview.

The mechanism is `project-repo-tx.ts`'s shape with **three deliberate differences**, each of which is
the reason this is a new decision rather than "point the existing function at `forgeRoot`":

1. **It never merges.** `saveProjectRepo` merges into the default branch and pushes, and its own
   docstring says why that is safe there: *"no CI, since these are forge-controlled, non-structural
   files."* Forge core is neither forge-controlled-and-non-structural nor CI-free. **The PR is the
   terminus.** CI and human review are the gate, exactly as for every other change to forge. Nothing
   in Studio may merge a forge PR — that is the 2026-07-16 incident restated as a rule.

2. **It never touches the operator's live checkout.** Promotion builds its branch in a **temporary
   git worktree** off the tracked remote head, applies the object, commits, pushes, opens the PR, and
   removes the worktree. It never runs `git checkout` in the forge root. The reason is recorded in
   forge's own code: `isGitRepo` (`orchestrator/project-repo-tx.ts`) carries a long docstring about a
   caller running `git checkout` against a directory nested in an ancestor repo and moving *the
   ancestor's* HEAD instead. The forge root additionally hosts a live `forge serve` scheduler and the
   Studio bridge, both reading that checkout; moving its branch under a running cycle is a data-loss
   hazard, not a nuisance.

3. **The route is classified as a real-acting `git-remote` route in `BRIDGE_ROUTE_CLASSIFICATION`**
   (`cli/dry-bridge.ts`) and is **`refuse`d under `FORGE_DRY_BRIDGE=1`**, alongside
   `POST /api/studio/projects/:id/save-repo` and the recovery/requeue routes. The drift-guard tests
   over that table make this enforceable rather than aspirational: a promote route that is not
   classified fails the guard. A harness run can never open a forge PR.

**Commit identity is the operator's, and the credential question is settled explicitly.** The PR is
authored by the operator, from their own remote credentials, on a route only they can trigger from
the UI. Forge does not acquire a bot identity for this, and does not gain a second way to act on
GitHub with the operator's token beyond the one the dry-bridge table already governs.

### C. The pending-change surface — one derivation over a declared set of roots

Generalize `meta.registryDirty` from a hard-coded single path into **one derivation over a declared
set of Studio-written tracked roots**, surfaced wherever Studio objects are listed rather than only
on `/community`.

Two constraints, both learned the expensive way:

- **The declared set is data with a drift guard**, in the shape of `BRIDGE_ROUTE_CLASSIFICATION` — a
  typed exported table consumed by a test. A hand-maintained list of five paths that nothing
  enforces is the same defect as today's one path, with four more places to rot. This is the
  `declared-data-fails-open` class, and the constructive fix is that the set of Studio-written
  tracked roots and the set of paths the dirty check covers must be **the same object**.
- **`null` stays a third state.** `communityIndexMeta` already returns `true`/`false`/`null` for
  "git did not answer", and the UI renders only on `true`. The generalized derivation keeps the
  three-state answer; an unavailable git is never rendered as "clean."

Note the ordering benefit: after §A, the operator's own authoring no longer dirties the forge repo at
all, so this surface's job **shrinks** to the set that genuinely matters — core edits, `brain/`
writes from drains and reflection, and the community registry. Every row it shows is then a real
promotion candidate, which is what makes it worth showing.

### D. What is explicitly out of scope

- **Any automatic commit, of anything, to the forge repo.** Re-ratified, not revisited.
- **Any merge of a forge PR from Studio.** The PR is the terminus.
- **A plugin or package manager.** Promotion is a contribution path — one object, one PR — not a
  distribution channel. Publishing, versioning and installing third-party Studio objects stay where
  they are (the community browser and `R8-01` packaging).
- **Multi-operator sync, shared workspaces, or any server-side store.** `docs/roadmaps/README.md` §2
  records multi-operator as deliberately absent; `_local/` is one machine's directory and nothing more.
- **Moving `brain/` out of the forge repo.** [ADR 035](./035-forge-owned-central-artifacts.md) stands.
- **Changing what `forge studio lint` validates.** Lint gains the second root as a scan location; its
  rules are unchanged.
- **A write-time `origin:` stamp as the primary provenance mechanism** — see the reconciliation below.

### E. Where this work is owned

`docs/roadmaps/README.md` §2's coverage map routes new forge work by architecture pillar, and says
that work fitting no row is the signal to mint a new roadmap rather than wedge it somewhere adjacent.
This work fits two rows, cleanly, and the split follows the map rather than convenience:

- **§A and §B are R3.** The map routes *"Capability libraries — skills, hooks, tools/MCPs,
  instructions (`skills/`, `studio/catalog.yaml`)"* to R3, and R3's own charter names exactly what
  this ADR decides: the library *machinery* — *"registries, resolvers, surfaces, protections"* — made
  *"editable (where safe) … with provenance and a security posture proportional to what the component
  can do."* An ordered root resolver is a resolver; provenance-by-root is provenance; promotion is the
  safe edit path for a shipped component. The §7 out-of-scope register draws the line in the same
  place: what an operator *authors* is operator-owned, but the authoring *machinery* is R2/R3.
- **§C is R6**, which the map gives *"Operator surface & observability platform (`forge-ui/` as a
  pillar, event/log presentation)"*. A pending-state surface across every Studio object is platform
  IA, not a feature-owned UI change riding an initiative.
- **R5 is the wrong home despite the safety content.** Its charter disclaims new product capability
  outright (*"no new product capability lives here"*). §B's dry-bridge classification is an
  obligation R5 already owns the machinery for, not an R5 deliverable.
- **R8 is the wrong home despite the upgradability consequence.** R8's charter is the product shell —
  packaging, install, version policy, positioning. Making forge upgradable is a *precondition* R8-01
  benefits from, recorded here as a cross-edge, not an R8 initiative.
- **No new roadmap is minted.** The rule to mint applies to work fitting no row; this fits two.

## Reconciliation with the write-time origin stamp

An existing bead proposes closing the provenance gap by **stamping an `origin:` field at write time**
(`PUT /api/studio/agents/:slug` and `POST /api/studio/hooks` write `origin: 'studio'`; the shipped
OOTB `SKILL.md` / `hook.yaml` files get `origin: seed` committed), after which `AGENT_PROVENANCE`
flips from a constant to a derivation. It was deliberately deferred because it is a data-model change
across `skills/`, a concurrently-edited tree.

This ADR **re-scopes rather than supersedes it**, and the split is not a compromise — the two
mechanisms answer different questions:

- **Root membership answers "who authored this?" for every object that has never moved** — which is
  every object, on day one of §A. It requires no data-model change to `skills/` at all, which removes
  the exact reason the stamp was deferred, and it cannot go stale because there is no stored copy to
  drift.
- **The stamp answers the one question the root cannot: "who authored this *originally*?" after
  promotion.** Once §B promotes an object from `_local/` into a tracked root, its root says `ootb`
  and the fact that an operator wrote it is gone. That is precisely what a write-time stamp preserves.

So: **root membership lands first and does the bulk of the work; the stamp lands with promotion (§B)
and is written by the promotion path, not by every Studio write route.** Its cost drops sharply,
because only promoted objects need it — not the whole concurrently-edited `skills/` tree. The bead is
re-scoped to that, and re-pointed at R3-09.

## Consequences

**Forge becomes upgradable, which it is not today.** Right now operating forge dirties forge's own
source tree, so `git pull` on a forge checkout with a week of Studio authoring in it is a merge
conflict against the operator's own work. After §A the operator's authoring lives in a gitignored
root and a forge upgrade is an ordinary fast-forward. That is a precondition for anything
`docs/roadmaps/R8-distribution-release.md` R8-01 wants to call packaging, and it is the strongest
argument for doing the workspace half first.

**The honest cost: two roots is two places to look.** Every "where does this object live?" question
gains a second answer, and any code that assumes a single root is now wrong. This is why the decision
is an *ordered resolver at a small set of named helpers* rather than a general search path: the
resolution rule must be one function per kind, testable in isolation, with the containment guard
re-applied per root. The failure mode to watch for is a shadowing bug — a `_local/` object silently
masking an OOTB one of the same id — so `forge studio lint` gains a check that names any id present
in both roots, and the library surface labels a shadowed object rather than hiding the conflict.

**Provenance stops being a known lie and starts being a derivation.** `cli/studio-provenance.ts`'s
`'unknown'` constants are the honest answer to today's evidence, and they become the wrong answer the
moment roots carry the signal. The n/a-invariant that module defends — never fabricate a badge —
survives: `unknown` remains the answer for anything neither root can attest.

**The promote path is a new real-acting route on the surface that once self-merged a PR.** It must be
built with the `adversarial-containment-review` posture: an operator-supplied object id becomes a
filesystem read, a temp worktree path, a branch name, and a PR title. Branch names and worktree paths
derived from an id are a new sink family for `scripts/check-request-path-sinks.mjs`. This is the
single riskiest thing in this ADR and is why §B's terminus is a PR — the blast radius of a defect is
"an unwanted PR", not "an unwanted merge to main".

**The pending-change surface will look worse before it looks better, and that is the point.** Turning
on a five-root dirty check against a repo that has been accumulating uncommitted Studio writes will
surface a backlog. Showing it is the deliverable.

**This ADR closes two standing walkthrough findings that had no design home.**
`docs/roadmaps/wave-7-walkthrough-findings.md` records `library-07` (*"Studio writes authored skills
straight into the live forge working tree with no commit — they show up as untracked churn"*) and
`community-23` (*"the only writer is an agent whose commit path has never once executed"*). Both were
filed as findings against wave-7 execution buckets and never promoted to an initiative; R3-08/R3-09
are the first place either gets a spec.

**Nothing here is built by the change that lands this ADR.** This is a design decision recorded ahead
of the work, by explicit operator direction. The build is R3-08, R3-09 and R6-10; the sequencing
constraint is that §A precedes §B (promotion needs a workspace to promote *from*) and §C is
independent of both and can land first as the cheapest honest improvement.
