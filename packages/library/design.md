# `@forge/library` — design record

What governs this package, and the three decisions a reader is most likely to question.

## The ADRs that govern it

- **[ADR 024](../../docs/decisions/024-phases-as-subagents-invoking-skills.md) — agents compose skills.** A skill is an instruction/tool unit an agent invokes; this package owns authoring, scanning and listing them, and `agents` owns invoking them. The split in the ADR is the split in the code: everything here answers "what is this object and may it be trusted", never "run it as part of a turn".
- **[ADR 018](../../docs/decisions/018-three-brain-model.md)** for the boundary this package sits inside — `library` is rank 2 in the allow-graph (`scripts/check-boundaries.mjs`), below `agents`, above `kernel` and `contracts`. It may never import `agents`, `sessions`, `flows` or `factory`, and never a rank-2 sibling (`knowledge`, `projects`): a shared symbol goes to `kernel`/`contracts` additively, or the consumer moves up.
- **[ADR 042](../../docs/decisions/042-surface-cap-scope-and-testability.md)** for why the size cap is a real constraint and not a target to route around.

## Three decisions worth stating

### The hook EXECUTION primitive lives here; hook DISPATCH does not

`runHookScript` is in this package and `packages/agents/studio/hook-dispatch.ts` calls it. That looks backwards next to the spec's "per-spawn runtime → agents" line, and it is deliberate:

- Spec §0: *"the only future candidate for process isolation is untrusted community-hook execution **in `library`**"*.
- Spec §3.1 gives library *"plugin-host isolation applies here only"*.

So `agents` owns *when* a hook fires in a spawn's lifecycle; `library` owns *what it means to run a piece of untrusted third-party code safely* — the env-stripped bounded spawn, the runnable gate, and the place a sandbox would go if one is ever built. Moving the primitive up would put the isolation boundary in the package that has no reason to own it. This was checked against the code before it was written down: `hook-dispatch.ts` already imported `runHookScript` from here.

### The install decides server-side, and the operator confirms

`POST /api/studio/connections/:id/install` derives its argv **only** from the curated catalog pin. No parameter — including the request body — can influence the package, version or registry; an install route that took those from a client would be remote code execution by design. `--ignore-scripts` is always present, because an MCP server is arbitrary third-party code and npm lifecycle scripts run on install.

On top of that, `forge-6gv.8.2` added a review step: an unconfirmed request returns a **preview** (package, version, registry, the exact argv, whether lifecycle scripts run) and performs zero network and executor calls; `{ confirm: true }` is the only path that installs. The preview is derived from the same function that builds the real argv, so it cannot describe a command other than the one that would run — and it is rendered in Studio, because a confirm the operator cannot read is not a confirm.

### `declined` is a review outcome, not a permission

The hook approval ledger carries `approved`, a `revoked` history, and `declined`. `declined` grants nothing: `hookRunState` never reads it, so a declined hook is `runnable: false` exactly like a never-reviewed one. It exists so the review queue can close honestly — a hook an operator looked at and rejected had no state but "needs-review forever". Approve and decline clear each other through the writers; a hand-edited ledger carrying both resolves to `approved` silently, which is the safe direction but is not a contradiction the surface reports.

### Agent facts arrive by injection

Three modules here — `studio/skill-trust.ts`, `studio/hook-library.ts`, `studio/connection-library.ts` — each kept a private copy of the same resilient agent-roster walk, reaching `isStudioAgent` and `loadAgentDefinition` through `orchestrator/studio/registry.ts`. Library is rank 2 and agents is rank 3, so that read is what ruling 13 forbids. All three copies are gone. `studio/agent-facts.ts` declares what library needs in library's own vocabulary and `apps/forge/library-agent-facts.ts` binds it, beside the Agent-kind loaders.

The port has **two members answering two different questions, and no path in library uses both**:

- `usage(kind, forgeRoot)` — "which agents compose this id". Bound to agents' `agentUsageIndex`, whose derivation is line-for-line what the three copies did (per-agent dedupe, carrier lists sorted by slug, `scanned` counting the agents that loaded). It serves `listHookLibrary` / `deriveHookUsage`, `listConnections` / `connectionById` / `deriveConnectionUsage`, and `listSkillLibrary`'s `usedBy`, which substitute with no behaviour change.
- `compositions(forgeRoot)` — "what does each agent compose". The two lint paths need it because the index cannot serve them. `lintHookComposition` reads `composition.guards`, and the usage index has no `guard` kind, so the very fact `hook-library/hook-in-guards` exists to find is absent from it. `lintSkillTrust` and `lintSkillRefs` emit one finding per agent per `composition.skills` **occurrence**, in slug order, where the index is the inverse map with duplicates already collapsed. Keeping their existing derivation over `compositions` makes their output identical by construction rather than by argument.

`isAgentSkillMd(mdPath)` is a third read and not a usage question at all: five sites ask whether one SKILL.md is a studio agent — `listSkillLibrary` excluding agents from the skill library (AT-5), and the skills routes that 404 or refuse when an id turns out to be an agent.

If a future path wants both members, that is the signal one of them is answering the wrong question — fix the path rather than widening the port.

Two things follow from the boundary rather than from taste. Library's own tests supply the port from `tests/test-fixtures/agent-fixture.ts`, because a test edge is still an edge; what that leaves unproven — that the real binding answers what those fixtures assume — is proven at `apps/forge/tests/contract/library-agent-facts.test.ts`, which also carries the drift guard between `agentUsageIndex` and the assembly's `compositions` walk. And a handful of cases whose subject was the agent loader all along moved out to the assembly, where importing both packages is what the assembly is for.

### The palette is scanned, not declared

`GET /api/studio/catalog` was the last library route left in the bridge, and the reason is worth keeping: it reconciles each catalog SDK against the LIVE adapter registry, and `isSdkAvailable` belongs to `@forge/agents` (rank 3). That was a real rank violation — proven at the time by planting a probe and watching `check-boundaries` fail, not assumed — so the route could not move until the route table became a factory that takes the answer injected. It now does, from `apps/forge`, exactly as the agent facts do.

What the palette unions, and why each half is real rather than declared: community skills come from `studio/community/registry.yaml`, not `catalog.yaml` (W6-CR-1); local plain skills are filesystem-scanned, so one authored through `/skills/new` appears on the next fetch with no bridge restart (R3-01-F2); and library hooks are scanned from `studio/hooks/<id>/` rather than read from a catalog list (R3-03-F4). Community entries win an id collision because they carry the provenance and stars metadata. Only well-formed (`ok: true`) hooks are offered — a malformed one has nothing safe to bind. An SDK's availability is the one field in the response that is not on disk, which is precisely why it is the one field that has to be injected.

### The template library's seven decisions

Moved verbatim from `studio/template-library.ts`'s header, where they were 48 lines of a 60-line preamble. Nothing is lost by relocating them; a reader looking for why this package decides what it decides looks here.

```
D1 — category is STRUCTURAL (which directory a definition lives in), never
sniffed from its content. A `kind`/`phase` field varies WITHIN a category; it
never decides the category itself.

D2 — studio/starters/ also holds `agents/` and `flows/` — agent/flow
DEFINITIONS already first-class in their own pillars (the Agent Builder's
StarterPicker / the flow builder's loadStarterFlow), deliberately excluded
from this library. `STARTERS_NON_TEMPLATE_DIRS` names the exclusion with a
reason; `lintTemplateLibrary` errors on any OTHER unmapped starters/
subdirectory, so a future addition must be triaged by a human, not silently
swept in or silently dropped.

D3 — `usedBy` is DERIVED from a real on-disk source, and that source is
NAMED on every entry (`usedByDerivation`), so an empty `usedBy` reads as
"scanned N sources, found none" rather than "unknown". Planning usage comes
from the real flow graph (edges); demo-output usage comes from projects'
`.forge/project.json` `demoProcess[].element`; project-scaffold usage is
HONESTLY EMPTY — `appType` is validated at creation (project-create.ts) but
persisted nowhere, so attributing a scaffold to a project would require a
file-shape heuristic, which is exactly the anti-pattern this module refuses
to reintroduce (a prior initiative's fabricated `usedBy` was caught in
review; see AT-23's regression guard).

D4 — declared `producer:`/`consumer:` frontmatter (unlike a deleted, wholly
fabricated `composedBy`) are mostly true, so the fix is cross-validation, not
deletion: surfaced verbatim as `declaredProducer`/`declaredConsumer`, checked
against the resolved flow-edge endpoints. Edge-backed + agreeing ⇒
`endpointsVerified: true`; edge-backed + contradicting ⇒ a lint ERROR;
zero-edge (today: verdict/work-items/demo-fix-spec travel by orchestrator-band
re-entry, not a DAG edge) ⇒ `endpointsVerified: false` + a lint FLAG (the
claim is unverifiable, not wrong). A gate node (no `agent`) matches a
declared value equal to either its bare node id or the resolved `gate:<id>`
form — the frontmatter is never "fixed" to invent an agent that isn't there.

D5/D6 — `format`/`provenance`/`previewKind` are DERIVED from existing fields,
never new frontmatter. `previewKind` is a total function over the source's
validated enum (`ArtifactKind` / `DemoStepKind`) with a throwing default arm —
belt-and-braces, since `loadArtifactTemplate`/`loadDemoElement` already
reject an invalid enum value before previewKind ever sees it.

D7 — a malformed definition surfaces as an entry carrying `error`, never
dropped (the skill-library.ts precedent: a silently dropped entry is an
invisible failure, not a fixed one). This means `listArtifactTemplates` /
`listDemoElements` (registry.ts) — which throw on the FIRST malformed file in
a directory, failing the whole batch — are NOT reused here; this module reads
the directory itself and calls the single-file loaders
(`loadArtifactTemplate` / `loadDemoElement`) per file, catching per-file so
one bad sibling never hides the rest.
```

### The authoring turn arrives by injection

`bridge-studio-authoring.ts`'s finalize route drives a real session: it reads and writes `status.json` through the guarded pair, loads the `authoring` session kind, runs one interactive turn on it, and tells an honest named refusal from the staging copy layer apart from a structural failure. All four reads were `@forge/sessions` imports — rank 4 from a rank-2 package, handoffs L1–L4. `studio/authoring-session.ts` declares them as this package's own `AuthoringSessionPort`; `apps/forge/library-authoring-session.ts` binds it, and it reaches `packages/sessions/kinds/authoring.ts` — which calls `runFinalize` directly — through the deps that package already threads.

Two collapses keep the port to four members and sessions' vocabulary out of library:

- **`runAuthoringTurn` folds `loadSessionKinds` + `runInteractiveTurn` into one call.** Taking the descriptor separately would have put sessions' `SessionKindDescriptor` into library's types for no gain. `null` means the authoring kind is absent — the route's own 500. The turn stays a DYNAMIC import on the binding side, because a static one pulls the Claude Agent SDK into bridge start-up.
- **`isFinalizerError` replaces an `instanceof`, and the classification stays here.** `InteractiveFinalizerError` carries only a message; which message shapes are an honest entry-scoped refusal (400) rather than a structural failure (500) is a fact about THIS route's contract, so the regex stays in library and only the "did it come from the copy layer" half is injected.

### The Flow kind arrives by injection too

`studio/template-library.ts` derives each planning template's `usedBy` from the flow graph, which meant reading the Flow kind's loaders — `@forge/flows` is rank 5, this package is rank 2, and they were reached through `orchestrator/studio/registry.ts`'s re-export hub. Library now declares its own `FlowSource` port (`listFlowIds` + `loadFlowDefinition`, in terms of the `FlowDefinition` that already lives in `@forge/contracts`, so nothing is lifted) and `apps/forge/library-flow-source.ts` binds it. Four exported functions take it: `listTemplateLibrary`, `templateDetail`, `lintTemplateLibrary` and `deriveArtifactTemplateUsage`.

**Not five.** `deriveDemoElementUsage` was named as a consumer in the handoff, but it derives from discovered PROJECTS, not from flows, and never touches the index — measured from the code, which is why it takes no port.

### A catalog read that scans no agents

The same shape appears twice in this package, and the rule is one rule: **a caller that only needs to know a thing EXISTS should not pay for the scan that computes who uses it.**

`listTemplateIds` is the second instance. The create route's uniqueness check and the authoring finalizer's were calling `listTemplateLibrary` — walking every flow on disk to build a `usedBy` neither reads — to answer a boolean. Worse, it forced the `FlowSource` port up a call chain that runs `handleAuthoringVerdict` → `runFinalize` and reaches `packages/sessions`, making a rank-2 port a rank-4 concern for an id lookup. The flow-free read removes both the walk and the thread. `usedBy` on a template entry is genuinely read in exactly one place — the DELETE route's 409 — plus the list and detail surfaces that render it.

The first instance: `listConnections` decorates the catalog with `usedBy`, which costs a full agent-roster walk. Measured across its eleven call sites, exactly two read that field: the connections list and detail routes. The community index, the install router, the probe and install routes and agents' run gate all read `kind`/`id`/`name`/`provenance` and the install fields — so they take `listCatalogConnections`, which reads `studio/catalog.yaml` and nothing else. The alternative was handing them a `ConnectionDefinition` with a fabricated empty `usedBy`, which is exactly what `usedByDerivation` exists to make impossible.

### Install by URL fetches through the ONE allowlisted seam, and the URL is never the target

Operator ruling 477 funded *"install by URL is BUILT behind the existing trust gate"*, and the
shape it was approved in (582) is **reuse of the refresh's fetch seam**, not a new one.

The trust gate was already complete except for its first step. `installSkillPackage`
quarantines `runtime`/`allowed-tools`/`library`, writes a provenance block with a content
hash, and lands the skill `status: draft` — `draft-pending-approval` to the browser — and
`skill-trust.ts` gates palette visibility on `ready`, which only the operator's approval
produces. All of that ran before this change, but only for a package already on disk;
`routeCommunityInstall` said so in as many words — *"a curated catalog reference with no
vendored package on disk"*. `studio/community-fetch-package.ts` is that missing first step and
nothing else. Everything downstream of it is unchanged, which is why the route GAINED an arm
rather than a second install path.

**The operator's URL is never a fetch target, and that is the whole SSRF answer.**
`parseCommunityUpstream` turns `https://github.com/owner/repo` into an *identity*; every request
is then built from that identity and goes to `https://api.github.com` through
`fetchAllowedApiUrl` — origin-allowlisted, `redirect: 'manual'`, timeout-bounded, the same seam
the deterministic refresh uses. `file://`, `localhost` and a link-local address cannot be
reached by supplying them: supplying them fails the parse, so they never become a request at
all. The test that asserts this asserts the stub was asked for **nothing**.

**Decide from the tree, then fetch.** The module reads the git *trees* API rather than walking
`contents`, because one recursive listing reports every path AND ITS SIZE — so
`MAX_PACKAGE_FILES` and `MAX_PACKAGE_BYTES` are enforced against declared sizes BEFORE a single
blob is requested. An oversized package costs one listing, not a download; a `contents` walk
would have to fetch to find out. Two tests count the stub's blob requests, so the claim is
enforced rather than merely written.

**The credential stays where it was.** `ctx.token` is read by the orchestrator process, passed
as a parameter, deliberately absent from `AGENT_ENV_ALLOWLIST`, never handed to a spawned agent
and never logged. Install-by-URL became the third outbound caller after the CLI verb and the
refresh route, so the one line that reads it out of the environment is shared
(`communityRequestCtx`) rather than copied — the property the refresh runner's own comment
claims only survives a third caller if the line is shared.

**Why the install route's refusals are not 500s.** `statusForFetchRefusal` maps each one to what
the upstream condition deserves: `not-github` / `no-skill-package` → **400** (the item is known
and the request well-formed; what it names is not an installable package, and the remedy is to
fix the row, not to retry). `tree-truncated` / `too-many-files` / `too-many-bytes` → **413**,
the one status that says forge refused a package for its SIZE — a 400 would send the operator
looking for a malformed request that is not there. A transport failure is a 404, a 429 or a 409
where the refresh route already made that choice, and otherwise **502**: forge is the gateway
and the upstream is what failed. Nothing here is a forge fault, so nothing here is a 500.

**What "scanned" does and does NOT mean, stated because the first draft of this section
got it wrong.** `scanSkillPackage` has exactly one production caller —
`GET /api/studio/skills/:id` for a draft — so it runs on the draft's own page AFTER the
install, and it reports facts (quarantined keys, executable files, counts) rather than a
verdict. **It gates nothing.** What actually holds a fetched package back is the same
thing that holds a vendored one back: it lands unapproved and is invisible to the palette
until the operator approves it. The operator-facing copy says exactly that and no longer
claims a scan stands between the fetch and the install.

**A repo-root package is the whole repository.** When SKILL.md sits at the repo root the
prefix is empty and every blob is vendored — `.github/` included. The caps bound it (500
files, 5 MiB) and nothing scopes it further, because a repo-root package has no declared
boundary. `skills/<id>/` is preferred when both exist.

**What the page is allowed to know.** `upstreamFetchableAs` is derived server-side by
`toWireItem` from the SAME grammar the route uses, and the detail page follows it rather than
re-deriving anything. A URL grammar duplicated in the UI is a UI that eventually offers a door
the route refuses, which is worse than one that offers none. It is `null` for a hook (hook
items are vendored by construction and the route has no fetch arm for them) and `null` for a
vendored item (its bytes are already here).

It carries the **resolved** `https://github.com/<owner>/<repo>` rather than a boolean for a
reason the security review made concrete: a `sourceUrl` can be written to READ like one
repository and PARSE to another —
`https://github.com/anthropics/skills/%2e%2e/%2e%2e/attacker/evil` resolves to
`attacker/evil` — so the link an operator is asked to trust before pressing Install must be
the identity the fetch will actually reach, not the string the row happens to hold. The
provenance record uses the same resolved identity, and records the TREE SHA rather than the
branch name, because a branch name does not identify what was installed once the upstream
force-pushes.

**Three refusals stand in front of the fetch, and they stand ABOVE the pipeline split.** The
destination occupied by an unmanaged local skill refuses (it always did, but from inside the
vendored branch, where the fetch arm never reached it); an id already installed from its
upstream refuses rather than re-fetching, because "fetch again" means whatever the upstream
publishes today landing beside a package the operator already reviewed; and a failed install
after a successful vendor **rolls the vendor back**, so a stranger's bytes never stay in the
tree for the next install to mistake for forge's own.

## Deferred, on purpose

**Plugin-host process isolation is not in 1.0.** Spec §0 defers it to a concrete driver. `runHookScript` today is an env-stripped, bounded child process with the credential exclusions its own header documents — not a sandbox, and it says so rather than implying more safety than it has. The honest-limits section in that file is the contract; if isolation is ever built, this is where it goes.

**One door, not two.** `index.ts` is the public surface; every consumer still uses deep `@forge/library/<file>.ts` paths. Collapsing them is a cross-package change and is recorded rather than quietly left undone.

## A hub is asked what it publishes, and only a hub forge can reach

Operator ruling 478, scoped by T1 608 to **GitHub-shaped hubs only**.
`studio/community-hub-index.ts`.

**The gap.** A refresh re-verifies rows that already exist and never discovers one. Four of the
nine declared hubs contribute nothing and stay that way through every refresh, so their chip
reads *"declared — nothing indexed"* forever. The mechanism that was supposed to close that —
the `community-refresh` AGENT plus `commitRegistryDraft` — was retired in wave 8, leaving
`hubs.yaml`'s own W6-CR-3 amendment a promise with no implementation.

**GitHub-shaped hubs only, and the two that are left out are left out on purpose.**
`skills.sh` and `smithery.ai` are declared hubs that are **not** on the community fetch
allowlist. Adding an origin is a new external dependency — ask-first by CLAUDE.md and by
`hubs.yaml`'s own header — so they answer `not-reachable`, which is the truth and is what their
chip already says. That is operator item 20 and it is M7 work; S8 beat 5 names `skills-sh`
specifically and therefore stays red, with its citation narrowed from *"no path in forge indexes
a declared hub"* to *"this hub is not a source forge reaches"*.

**It proposes; it never writes.** Nothing here touches `registry.yaml`. A row an operator
accepts is written by the CRUD path they already use, so D10 survives intact: **forge does not
crawl on its own, and a discovery is a suggestion rather than a change.** That is also why the
retired `commitRegistryDraft` did not need rebuilding — the approval surface that already exists
is the one the operator knows.

**The convention is the one install-by-URL already reads, and that is the point.** A skill is a
directory containing `SKILL.md`; its id is that directory's name. A discovered row carries
`sourceUrl` = the hub's repo, and `community-fetch-package.ts` looks for `skills/<id>/SKILL.md`
in exactly that repo — so **a discovered row is installable by construction**. The two halves are
pinned against each other in `community-hub-index.test.ts`'s last case rather than each against
its own idea of the layout: discovery that proposes something the installer cannot fetch is a
decoration.

**A hub with a different layout indexes nothing and says so.** `modelcontextprotocol/servers`
publishes under `src/<name>/` with no `SKILL.md` anywhere, and forge proposes nothing from it.
That is a real limit rather than a bug — inferring a layout from a stranger's tree is how you
propose rows that cannot be installed.

**A directory name is a stranger's string.** It becomes a registry id and then a path segment,
so it passes `assertSkillSlug` like every other id in this package; a name that fails is
**skipped, never sanitised into** something that looks valid.

