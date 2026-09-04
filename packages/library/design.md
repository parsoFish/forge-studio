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

Two things follow from the boundary rather than from taste. Library's own tests supply the port from `tests/test-fixtures/agent-fixture.ts`, because a test edge is still an edge; what that leaves unproven — that the real binding answers what those fixtures assume — is proven at `apps/forge/library-agent-facts.test.ts`, which also carries the drift guard between `agentUsageIndex` and the assembly's `compositions` walk. And a handful of cases whose subject was the agent loader all along moved out to the assembly, where importing both packages is what the assembly is for.

### The palette is scanned, not declared

`GET /api/studio/catalog` was the last library route left in the bridge, and the reason is worth keeping: it reconciles each catalog SDK against the LIVE adapter registry, and `isSdkAvailable` belongs to `@forge/agents` (rank 3). That was a real rank violation — proven at the time by planting a probe and watching `check-boundaries` fail, not assumed — so the route could not move until the route table became a factory that takes the answer injected. It now does, from `apps/forge`, exactly as the agent facts do.

What the palette unions, and why each half is real rather than declared: community skills come from `studio/community/registry.yaml`, not `catalog.yaml` (W6-CR-1); local plain skills are filesystem-scanned, so one authored through `/skills/new` appears on the next fetch with no bridge restart (R3-01-F2); and library hooks are scanned from `studio/hooks/<id>/` rather than read from a catalog list (R3-03-F4). Community entries win an id collision because they carry the provenance and stars metadata. Only well-formed (`ok: true`) hooks are offered — a malformed one has nothing safe to bind. An SDK's availability is the one field in the response that is not on disk, which is precisely why it is the one field that has to be injected.

### A catalog read that scans no agents

`listConnections` decorates the catalog with `usedBy`, which costs a full agent-roster walk. Measured across its eleven call sites, exactly two read that field: the connections list and detail routes. The community index, the install router, the probe and install routes and agents' run gate all read `kind`/`id`/`name`/`provenance` and the install fields — so they take `listCatalogConnections`, which reads `studio/catalog.yaml` and nothing else. The alternative was handing them a `ConnectionDefinition` with a fabricated empty `usedBy`, which is exactly what `usedByDerivation` exists to make impossible.

## Deferred, on purpose

**Plugin-host process isolation is not in 1.0.** Spec §0 defers it to a concrete driver. `runHookScript` today is an env-stripped, bounded child process with the credential exclusions its own header documents — not a sandbox, and it says so rather than implying more safety than it has. The honest-limits section in that file is the contract; if isolation is ever built, this is where it goes.

**One door, not two.** `index.ts` is the public surface; every consumer still uses deep `@forge/library/<file>.ts` paths. Collapsing them is a cross-package change and is recorded rather than quietly left undone.
