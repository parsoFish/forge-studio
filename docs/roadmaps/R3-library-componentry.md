# R3 — Library componentry

> Make every reusable capability forge composes into agents — skills, hooks,
> tools/MCPs/CLIs (**connections**), instructions, and (added wave 5)
> **templates** — a first-class **managed library**: viewable,
> installable, editable (where safe), generatable (where sensible), with
> provenance and a security posture proportional to what the component can do.
> Scope boundary ([docs/repo-map.md](../repo-map.md)): the library *machinery*
> (registries, resolvers, surfaces, protections) is Scope 1; the *shipped OOTB
> library content* (curated skills/hooks/MCP entries, instruction seeds) is
> Scope 2 shipping. What operators author into these libraries at runtime is
> out of scope (index §7).

**Status vocabulary:** implemented | in-progress | planned | deferred.

**Status as of 2026-09-01: R3-01 through R3-07 are IMPLEMENTED.** This banner
read "all initiatives in this file are planned/deferred as of 2026-07-17" for
seven weeks after they shipped. Every production file in `packages/library`
traces to an R3-XX-FX id in this document's own numbering — `bridge-studio-hooks.ts`
to R3-03-F4, `studio/skill-library.ts` to R3-01-F3/F4, `studio/community-index.ts`
to R3-07-F1/F2, and so on through the package. A roadmap that says "planned"
about shipped code is a current-state document that lies, which is what
`check-docs-claims` and the identity gate exist to prevent; corrected here by
the M4-library cull rather than left for a reader to discover.

## As-built baseline (implemented)

### R3-B1 Skills as the agent surface (flat, path-hardcoded)

24 skills live as flat direct children `skills/<name>/SKILL.md` (ADR-003
skills-not-self-baked-agents; inventory + role grouping in
[`skills/README.md`](../../skills/README.md)). Resolution is **decentralised**:
~35 `.ts`/`.mjs` files hardcode literal skill paths
(`deriveAgentSpec('skills/<name>/SKILL.md')`,
`resolve(FORGE_ROOT,'skills',<name>,'SKILL.md')`) with no shared resolver, and
`orchestrator/studio/registry.ts` (`listAgentDefinitions`) requires skills as
flat children (`readdirSync(skillsDir)` + `join(skillsDir, entry, 'SKILL.md')`).
The `library` frontmatter flag (Studio-roster divider) is set on only 7 of 24
skills — 1 `true` (`skills/project-scoped-review/SKILL.md`), 6 `false`, 17
unset. All facts per [known-gaps §6](../known-gaps.md) (the deferred physical
role-subfolder move).

### R3-B2 Studio catalog — curated, reference-only component metadata

[`studio/catalog.yaml`](../../studio/catalog.yaml) ships: **9
community-skills** with provenance + stars (`handoff`, `pre-impl-interview`,
`superpowers-tdd`, `systematic-debugging`, `webapp-testing`,
`security-review`, `skill-creator`, `agent-browser`, `output-compress`), **9
guards** — 5 toggles (`event-log`, `cost-guard`, `stall-watchdog`,
`merge-gate`, `scratch-strip`) and 4 bands (`wi-contract`,
`reflection-close`, `demo-band`, `review-band`); the section was named
`hooks:` until R3-03 renamed it 2026-08-04 — **3 tools** (`git`, `node`, `gh`), **6 MCPs**
(`filesystem`, `github`, `playwright`, `fetch`, `memory`, `sqlite`). **This
pillar's "reference-only" framing is superseded 2026-08-04 by R3-04/R3-B10**
below: every tool/MCP entry now carries install/probe/provenance/config
metadata, and readiness is a REAL per-entry probe result, not a declared
label — an MCP chip in the builder is a working, verifiable binding, not
just reference metadata. Catalog entries surface as draggable chips in the
agent builder's
palette ([`forge-ui/components/studio/agent-builder/CatalogPalette.tsx`](../../forge-ui/components/studio/agent-builder/CatalogPalette.tsx),
routes `/agents/new` + `/agents/[id]`, drop zones
`[data-accepts="skill"|"tool"|"mcp"|"hook"]`).

### R3-B3 Skill authoring surface (disconnected from the catalog)

`/skills/new` is the brand-new-skill builder
([`forge-ui/app/skills/[id]/page.tsx`](../../forge-ui/app/skills/%5Bid%5D/page.tsx),
`[data-page="skill-builder"]`), backed by `POST /api/studio/skills` in
[`cli/bridge-studio-writes.ts`](../../cli/bridge-studio-writes.ts) (~line 790).
It writes a real `skills/<name>/SKILL.md` but **never registers the skill into
`catalog.yaml`**, so `CatalogPalette` — which sources skill chips exclusively
from the static `community-skills` list — cannot see it
([known-gaps §4.11](../known-gaps.md)). The `skills` UI journey
(`scripts/journeys/`) works around this by substituting the catalog-listed
`handoff` skill and narrating the limitation. There is **no skill-editing
surface** at all (known-gaps §4b.8) and no library/list view (§4b.1).

### R3-B4 Instructions-creator agent (the consumer R3-05 seeds)

[`skills/instructions-creator/SKILL.md`](../../skills/instructions-creator/SKILL.md)
(`library: false`) + the `/instructions/[sid]` interview UI
(`[data-page="instructions-interview"]`, bridge surface
`cli/ui-bridge.ts` / `cli/ui-bridge-instructions.test.ts`) — merged Stage A of
the agentic-additions roadmap (2026-06-24). It authors a project's `AGENTS.md`
through an interview but currently generates from scratch; there is **no seed
library** of language/domain best-practice instructions for it to draw on.

### R3-B5 Hook concepts exist only as orchestrator machinery + catalog metadata

The catalog's guard entries are display metadata mapping onto
orchestrator-owned implementations (JSONL event log, cost guard, stall
watchdog, merge gate, scratch strip — all inside `orchestrator/`). Agent
definitions carry them in `composition.guards` (parsed by
`orchestrator/studio/registry.ts`, see `registry.test.ts`), but there is no
installable/creatable hook library, and no security model for one — hooks
execute in-harness with the harness's env.

**Updated 2026-08-04 (R3-03 migration PR).** This entry originally read "5
catalog hooks" carried in `composition.hooks`. Both words changed: the
catalog section is now `guards:` with **9** entries (the 4 band ids joined the
5 toggles), and the agent field is `composition.guards` — `composition.hooks`
is deleted and reserved for the *library* lifecycle hooks R3-03's remaining
features introduce. See [ADR 027](../decisions/027-studio-object-model.md)'s
R3-03 amendment.

**Superseded 2026-08-04 (R3-03 library PR) — this baseline entry no longer
describes the as-built.** The hooks library now exists: `studio/hooks/<id>/`
file packages, `orchestrator/studio/hook-library.ts` (registry + derived
`carriedBy` + symmetric `composition.hooks`/`composition.guards` lint),
`hook-scan.ts` (static scan + verdict + approval ledger hashing script AND
manifest), `hook-runtime.ts` (deny-by-default env via `HOOK_ENV_BASE_ALLOWLIST`),
`cli/bridge-studio-hooks.ts` (5 routes), `/hooks` + `/hooks/[id]` + `/hooks/new`,
and the `hooks` journey. The security model was designed WITH the library, not
retrofitted — which is exactly what this entry said it would have to be. Its
honest remaining limits (writes ungoverned; `read`/`network` declared and
scanned but not OS-enforced) are recorded in the R3-03 change-log entry.

### R3-B6 Skill provenance pattern already proven

The catalog's community-skills demonstrate the provenance shape R3 generalises:
upstream `source` URL, `provenance` attribution, `stars`, `category`, `tier`,
`composedBy` (which forge agents compose it). The OOTB-palette assertion
(object-type refinement item #10, closed 2026-06-16) guards that these surface
in the builder.

### R3-B7 Skills first-class — shared resolver + unified palette library (R3-01 F1+F2)

Landed 2026-07-19 (branch `feat/r3-01-skills-library`, PR-B). **F1:** the
`orchestrator/skill-path.ts` leaf module (`skillPath` absolute / `skillPathRelative`
root-relative / `skillDir` / `skillsDir` / `listSkillMdDirs` / `listSkillDirs`) is
the single source for every skill lookup + enumeration — the ~40 hardcoded
`skills/<name>/SKILL.md` sites across `orchestrator/` + `cli/` route through it
(grep-clean of literal `skills/` path construction). `deriveAgentSpec` sites use the
root-relative form (`PhaseAgentSpec.skill` / event-log `agent_skill` attribution
fidelity); content-reads use the absolute form. This satisfies the [known-gaps §6](../known-gaps.md)
precondition — the physical `skills/` role-subfolder move is now a one-place change
(still a separate, untaken decision). **F2:** `listPlainSkills` (runtime-less,
non-`library:false` `SKILL.md`) unions with `studio/catalog.yaml` community-skills in
the `/api/studio/catalog` GET (`cli/bridge-studio.ts`), so a `/skills/new`-authored
skill (`POST /api/studio/skills`, stamped `library: true`) is palette-visible with no
bridge restart — closing [known-gaps §4.11](../known-gaps.md). The `library`
frontmatter is explicit on all 24 skills (6 `false` / 18 `true`), lint-enforced by
`validateLibraryFlag` (`orchestrator/studio/validate.ts` + `cli/studio-lint.ts`,
errors on unset, reaching every skill dir); `isStudioAgent`'s agent-roster semantics
are unchanged. The `skills`/`agents` journeys demo the real create→compose throughline
(no `handoff` substitution). **F3** (`/skills` library view) + **F4** (marketplace
install) are deferred pending the operator's §4b.1 skill-management-view design session.

### R3-B8 Skills library view, package detail, and trust-gated install (R3-01 F3+F4)

Landed 2026-08-04 (branch `feat/r3-01-skills-library`). **F3:** a real
`/skills` library route (`forge-ui/app/skills/page.tsx`) unions local plain
skills with `studio/catalog.yaml` community entries into two sections (Local,
Community) with per-section counts and a `usedBy` count DERIVED from every
real agent's `composition.skills` — `composedBy` (catalog.yaml, the
`CommunitySkill` type, the registry parse, the `community-skill/composed-by`
validate rule) is deleted (D3): all 8 of its shipped claims were false. The
builder moved verbatim to `forge-ui/app/skills/new/page.tsx`;
`forge-ui/app/skills/[id]/page.tsx` is the real read-only detail page — a
file-package viewer (`forge-ui/components/studio/FilePackage.tsx` +
`forge-ui/lib/file-package.ts`, kind-agnostic, shared with R2-10-F3), the
derived used-by list, and a provenance panel. `[data-action="new-skill"]` on
the library is the ONE creation entry point (D8); the `skills-create` journey
beat now enters through it instead of a direct `/skills/new` goto. **F4:** a
trust pipeline in `orchestrator/studio/skill-library.ts` (<800 lines: trust
vocabulary `ready | draft | needs-review`, `listSkillLibrary`,
`installSkillPackage`, `approveSkillDraft`, `repinSkillPackage`,
`scanSkillPackage`, `lintSkillTrust`, `lintSkillRefs`) plus a second,
git-tracked source of truth in `orchestrator/studio/skill-install-ledger.ts`
(`studio/installed-skills.yaml` — written on first real install; the ledger
file itself is absent from a fresh checkout until then). Every
`/api/studio/skills*` route lives in one new module,
`cli/bridge-studio-skills.ts` (GET the library, GET/detail, POST create
— moved verbatim from `cli/bridge-studio-writes.ts` — POST install, POST
approve). Install (D2) consumes an already-materialised local package
directory only — no hub fetch, no fabricated vendored content; a real hub
browse/fetch is R3-07's job, which routes installs through this pipeline
unchanged. On install, `runtime`/`allowed-tools`/`library` are moved under a
`quarantined:` block (D4) and **never restored on approval** — an installed
community skill is a plain composable skill forever; making it a runnable
agent is a separate, explicit act in the Agent Builder. Any later byte change
to any package file (or a mismatch between the on-disk pin and the ledger)
flips the skill to `needs-review` and drops it out of the palette
(`listPlainSkills`, `orchestrator/studio/registry.ts`) — the enforcement
point is the palette enumeration, not just a rendered status field. Lint
gained six finding ids: `skill-trust/draft-unapproved`,
`skill-trust/hash-drift`, `skill-trust/provenance-tampered`,
`skill-trust/unregistered-install`, and `skill-trust/installed-agent-shape`
(the ledger cross-check + D4 roster-escalation guard), plus `agent/skill-ref`
— wired into `orchestrator/studio/validate.ts` / `cli/studio-lint.ts`.
Demoed end to end by three new `skills` journey beats
(`scripts/journeys/skills.mjs`, wired into `RUN_ORDER` in
`scripts/journeys/index.mjs`): `skills-library` (counts + derived used-by
cross-check), `skills-detail-package` (file-package tabs + derived used-by),
and `skills-install-approve` (a full install→draft→approve→needs-review arc
against a package materialised in a temp dir, never the repo).
**KNOWN GAP carried forward, not closed by F3:** `/skills/[id]` is read-only
— there is still no surface to EDIT an existing local skill's SKILL.md body
(known-gaps §4b.8 stays open for that; F3's own text originally proposed
reusing a builder shell for this, but the shipped detail page does not do
so).

### R3-B9 Templates library — registry + library/detail view + project-type scaffolds (R3-06 F1+F2+F3)

Landed 2026-08-04 (branch `feat/r3-06-templates-library`). **F1:** a single
registry (`orchestrator/studio/template-library.ts`) unions three previously-
siloed on-disk sources into typed library items — `studio/artifact-templates/`
(category `planning`, 7 templates), `studio/demo-elements/` (category
`demo-output`, 6 templates), and `studio/starters/projects/<id>/` (category
`project-scaffold`, 3 scaffolds) — 16 entries total. `usedBy` is DERIVED, never
hand-maintained: planning usage scans the real flow graph
(`studio/flows/*/flow.yaml` edges); demo-output usage scans every project's
`.forge/project.json` `demoProcess[].element`; project-scaffold usage is
honestly empty (no on-disk source records which scaffold produced a project —
a file-shape heuristic would be fabrication). A declared `producer`/`consumer`
on a planning template is cross-validated against the resolved flow-edge
endpoints (`verifyTemplateEndpoints`): agreeing ⇒ `endpointsVerified: true`;
contradicting ⇒ a lint error; zero-edge (today: `verdict`, `work-items`,
`demo-fix-spec` travel by orchestrator-band re-entry, not a DAG edge) ⇒
`endpointsVerified: false` plus a lint flag (unverifiable, not wrong). A
malformed definition surfaces with `error` set, never dropped (D7, the
skill-library.ts precedent). `forge studio lint` gains the `starters-gap` /
`duplicate-id` / `endpoint-mismatch` / `unverifiable-endpoints` checks. **This
initiative also folds in R2-05-F1's canonical-artifact-set audit** (the two
roadmaps shared the same substance, decided at session start per R3-06's own
dependency note): `validateArtifactRef` is promoted from advisory to a hard
**error**, and the flow builder's hardcoded `ARTIFACTS` catalog
(`forge-ui/lib/flow-artifact-catalog.ts`) drops its two orphan entries
(`reflection`, `demo` — no on-disk template) and is pinned to the on-disk
`studio/artifact-templates/` id set by a CI-enforced parity test in both
directions. **F2:** a real `/templates` library route
(`forge-ui/app/templates/page.tsx`) mirrors `/skills`'s shape — grouped by
category, searchable, per-card preview thumbnail (`previewKind`:
html/video/shots/mock/doc/scaffold, CSS-approximation classes) — and
`/templates/[id]` (`forge-ui/app/templates/[id]/page.tsx`) is the real
detail page: definition, producer/consumer verification, derived used-by, and
— for a `project-scaffold` entry — the whole scaffold file tree through the
SAME `FilePackage` component `/skills/[id]` uses. The detail page renders that
tree **raw** — it does not enumerate which contract clauses a scaffold
pre-wires, so F3's "detail page lists what the contract pre-wires" AC is met
only inferentially (see the change-log entry). `GET /api/studio/templates`
+ `GET /api/studio/templates/:id` (`cli/bridge-studio-templates.ts`) are the
only routes (read-only; the template library has no write path). Demoed by
four new `templates` journey beats (`scripts/journeys/templates.mjs`, wired
into `RUN_ORDER`): `templates-library` (counts + category cross-check),
`templates-search`, `templates-detail-planning` (definition + derived
used-by, cross-checked against an independent recompute off
`studio/flows/*/flow.yaml`), and `templates-detail-scaffold` (the real file
tree, tabbed). Canonical inventory documented in
`studio/artifact-templates/README.md`.

**F3 (landed same day, same branch):** the third mockup scaffold shape —
`typescript-web` (web UI) — joins the two F1+F2 starters (`typescript-api` =
REST API, `typescript-cli` = CLI/library) under `studio/starters/projects/`,
completing the three canonical kinds the mockup's `provenance: 'vision'`
promotion named. No new wiring was needed for its consumption: `orchestrator/
project-create.ts`'s `listProjectStarters` already scanned the directory with
no hardcoded list, so `forge create`, `POST /api/studio/projects/create`, and
the `/projects/new` create-from-template form all pick it up automatically —
confirmed by `project-create.test.ts`'s AT-46 (discoverable alongside the
other two) and AT-47 (scaffolds to preflight HARD-green with every template
token substituted). The templates library's own registry/detail page (F1+F2)
surfaces it through the same generic `project-scaffold` category path as the
other two scaffolds — no `template-library.ts` change was needed either. The
templates library's own journey stays deliberately browse→detail only (no
create-project action added from `/templates` itself).

### R3-B10 Connections library — registry + probe/install runtime + run-block + library/detail view (R3-04 F1-F4)

Landed 2026-08-04 (branch `feat/r3-04-connections-library`). A "connection" is
a curated tool or MCP server an agent can be given, read from `studio/
catalog.yaml`'s `tools:`/`mcps:` sections — there is **no writable definition
store, no per-connection file package, no create/update/delete route
anywhere** (D1); curation is a PR to `catalog.yaml`. **F1:**
`orchestrator/studio/connection-library.ts` composes each catalog entry with
facts that are DERIVED, never declared — `kind` (`'tool'`/`'mcp'`, structural
from which catalog section the entry came from, D2), `installable`
(`install.method === 'npm'` only — `system-provided` and `external` both have
no forge-driven install path, D13), and `usedBy`/`usedByDerivation` (scanned
from every real agent's `composition.tools`/`composition.mcps`, so an empty
list reads "scanned N, found none", never "unknown"). `install` is a
discriminated union of three methods (`system-provided`/`npm`/`external`) —
`external` is a first-class honest answer for `github`/`fetch`/`sqlite`, none
of which have a working npm install path (one deprecated in favour of a
different-language implementation, one npm name is a security-research
typosquat canary, one upstream is archived — see D13's research table).
`forge studio lint` (`validateConnections`, `validate.ts`) rejects a missing/
empty/range/`latest` pin (D14) and a probe kind incoherent with its install
method (D15). **F2:** `orchestrator/studio/connection-probe.ts`'s
`probeConnection` is the REAL runner (D3/D4) — the only three states are
`not-installed`/`available`/`misconfigured`, always EXECUTED per entry in its
own child process, never declared or shared between two entries that happen
to use the same probe binary. Probe kind is a discriminated union (D15):
`command` (spawns the real argv), `command-presence` (resolves on PATH,
NEVER executes — for entries with no upstream-verified `--version` flag),
`npm-package` (reads the pinned package's own `package.json` under the
`_connections/` install root and requires the version to match the pin
EXACTLY — never spawns anything, since neither shipped npm entry's upstream
provides a non-server invocation). The probe child runs on a stripped,
credential-free environment (`HOOK_ENV_BASE_ALLOWLIST`, D11) — a probe can
verify presence + configuration-NAME presence, never that a credential
actually works. `orchestrator/studio/connection-install.ts`'s
`installArgvFor`/`installConnection` derive the install argv ONLY from the
catalog pin (D6) — `npm install --prefix <connectionsRoot> --ignore-scripts
--no-audit --no-fund --save-exact <pkg>@<version>` — a request body can never
influence it. **F3:** `orchestrator/studio/connection-readiness.ts`'s
`connectionsReadinessFor` is consumed at three real enforcement points (D9):
`orchestrator/run-agent.ts` blocks pre-spawn (after the dry-bridge/no-spawn
suppression early-return, so a suppressed rehearsal is never blocked by an
environment fact about a spawn that never happens), the bridge run route
(`cli/ui-bridge.ts`) refuses with the component named, and the Agent Builder
UI (`forge-ui/app/agents/[id]/page.tsx`) gains a 7th, conditional readiness
check (`[data-check="connections"]`, appended only for an agent that binds
at least one tool/MCP — an agent binding none has nothing to be ready about)
plus `[data-run-blocked]` on the Run panel — both name the unready component
and its state, never a generic "not ready". **F4:** every installable entry pins an EXACT version (D14);
provenance is the real upstream URL. **Bridge + client:** `cli/bridge-studio-
connections.ts` owns every `/api/studio/connections*` route (list/detail/
probe/install — no write-verb-named export exists, `cli/connections-no-
authoring.test.ts` asserts the export surface directly);
`forge-ui/lib/connection-client.ts`'s parsers REFUSE a malformed payload
rather than coerce it. **UI:** `/connections` (`forge-ui/app/connections/
page.tsx`, `[data-page="connection-library"]`) and `/connections/[id]`
(`forge-ui/app/connections/[id]/page.tsx`, `[data-page="connection-detail"]`)
— full `data-*` contract in `docs/forge-ui-dom-and-harness.md`. Demoed by the
new `connections` journey (`scripts/journeys/connections.mjs`, wired into
`RUN_ORDER`): `connections-library` (real probe states, disk/exec
cross-checked against the journey's own independent reads), `connections-
detail-tool` (git — no install action, real captured probe output, derived
used-by), `connections-detail-mcp` (memory — curated capabilities, a
SUPPRESSED install with byte-exact argv shown, a real re-probe), and
`connections-readiness-block` (a scratch agent binds the still-not-installed
memory MCP; the readiness panel and Run control both block, naming it). Two
real kinds not three, curated-not-probed MCP capabilities, and an npm-package
probe that verifies presence-at-pin not "the server runs" are stated limits,
not silent gaps (D2/D8/D15 above).

### R3-B11 Community browser — cross-kind index + pre-install detail + install routing (R3-07 F1-F3)

Landed 2026-08-05 (branch `feat/r3-07-community-browser`). The ONE cross-kind
browse/install surface over skill/hook/mcp/tool, retiring the per-kind
marketplace-tab shape the mockup sketched: `orchestrator/studio/
community-index.ts` derives a `CommunityItem[]` from three existing
registries, no fourth declared list (D1) — `studio/catalog.yaml`
`community-skills:` UNION vendored packages under `studio/community/skills/`
with no matching catalog id; vendored packages under `studio/community/hooks/`
only; `listConnections` (R3-04) 1:1 for `tool`/`mcp`. Hub attribution is
DERIVED by matching an item's own upstream URL against
`studio/community/hubs.yaml` (9 real hubs) on a path-segment boundary, never
a declared `hub:` string — an unmatched item renders `unaffiliated`, never an
invented hub. `orchestrator/studio/community-install.ts`'s
`routeCommunityInstall` decides which of the three ALREADY-MERGED pipelines
(R3-01-F4 skills, R3-03-F2 hooks, R3-04-F2 connections) owns an install and
dispatches to it — this module never writes a trust decision itself
(`cli/community-no-trust-decisions.test.ts` scans its source text for exactly
that); `installCommunityHookPackage` is the one genuinely new install-side
behaviour, materialising a vendored hook package and STOPPING — it never
writes an approval-ledger entry. `cli/bridge-studio-community.ts` owns every
`/api/studio/community*` route (list/detail/install). **UI:** `/community`
(`forge-ui/app/community/page.tsx`, `[data-page="community-browser"]`) and
`/community/[kind]/[id]` (`forge-ui/app/community/[kind]/[id]/page.tsx`,
`[data-page="community-detail"]`) — full `data-*` contract in
`docs/forge-ui-dom-and-harness.md`. `forge-ui/lib/community-view.ts` is pure
view-state derivation (D2: scanned for zero references to approve/override/
re-pin machinery, not even in a comment) and `forge-ui/lib/community-client.ts`
REFUSES a malformed payload rather than coercing it, mirroring
`connection-client.ts`'s convention.

**The install-state union gained a fourth member, `needs-review`, deliberately
not stopped at three.** `CommunityInstallState` is `not-installed |
draft-pending-approval | needs-review | installed` — a browsing surface that
owns zero trust decisions (D2) must still be honest about a tampered
post-approval object: a skill whose package bytes drifted after approval (the
R3-01-F4 hash-drift rule) reads `needs-review` here too, never silently
laundered back into `installed` because this surface has no approve/override
affordance of its own to notice the drift with.

**No third-party bytes are vendored.** The 9 catalog `community-skills` and
the 9 catalog `tools:`/`mcps:` connections are fully browsable here — real
detail pages, real hub/signal data where the source record carries it — but
their bytes are **not in this repo**. A skill's installability is DERIVED
from whether a vendored package exists on disk (`vendoredPackageDir`), never
declared; for a non-vendored skill the install control is structurally
absent, not disabled. The two packages this initiative actually vendored
(`studio/community/skills/dependency-diff-review/`,
`studio/community/hooks/block-protected-branch-push/`) are **forge-authored**
and attributed to the real `forge-seed` hub entry in `hubs.yaml` — never
attributed to `obra/superpowers` or any other real third party. **No signal
number is invented anywhere**: `signals` renders only where the source
record already carries one (`community-skills.stars`), always with its hub
attribution; an item with none renders the spec-literal "no signals
published", never a fabricated zero.

**There is no `cli` kind.** The kind filter offers exactly the four real
kinds forge has (`skill | hook | mcp | tool`) — not the mockup's three-way
connections split (MCPs · CLIs · tools). A `clis:` catalog section would move
ids out of `catalog.tools`, which `composition.tools` validates against and
`CatalogPalette` renders from — a dispatch-affecting migration, not a
browse-surface addition, and stays out of scope here (D8, R3-04 D2).

**Deletions, named:** `/skills`'s per-card manual install affordance —
`[data-action="install-skill"]`, `[data-install-skill-id]`, and the card-local
`[data-install-state]` in `forge-ui/app/skills/page.tsx` — is REMOVED.
Verified unexercised before deletion (zero journey beats, zero ATs drove it);
the capability is not lost, it moves to `/community`'s one cross-kind install
entry point, which routes through the same F4 pipeline unchanged. **No new
npm dependencies; no live network fetch** — live hub API crawling stays
explicitly out of scope (a new external dependency is ask-first); the
browsable index is a **static curated seed**, not a hub crawl, named as such
here rather than presented as a live directory.

**Demoed by the new `community` journey**
(`scripts/journeys/community.mjs`, wired LAST into `RUN_ORDER` — it installs
a real skill and a real hook, mutating `/skills`, `/hooks` and the
agent-builder palette counts every earlier journey's own beats pin, so it
must run after all of them). 22 beats covering both mockup arcs: the
`/skills`/`/connections` shelf entry points into `/community`; the hub strip
with real per-hub counts including an honest zero (`skills.sh`, 0 items); kind
filtering across all four real kinds; the vendored
`dependency-diff-review` skill's pre-install detail (SKILL.md preview, hub +
signals:null) contrasted against a catalog-sourced sibling's real hub
signals; installing it (lands a draft, not palette-visible) then approving it
on R3-01's own `/skills/<id>` surface (only then palette-visible — the trust
decision stays outside this browser); the vendored
`block-protected-branch-push` hook's pre-install SECURITY SCAN (clean, on the
real vendored bytes) and install (materialised but proven NOT runnable — no
approval-ledger entry, cross-checked against `studio/hook-approvals.yaml` on
disk and against the OWNING `/hooks/<id>` page); the `memory` MCP's curated
capability list and a SUPPRESSED install (byte-exact argv, the connection's
real state confirmed unchanged three ways — the community page's own
refetch, a disk re-check, and the connection's own owning
`/connections/<id>` page). **Parity outcome (R7-02-F3):** both stories this
initiative owned flipped `pending` → `ported` — `install-skills-hooks`
(13/13 mockup beats real) and `install-connections` (10/12 real, 2 explicit
`{excluded, decision}` — `commkind-cli`/`install-stripe-cli`, the fabricated
third connection kind above); `npm run parity:stories` exits 0.

## Planned initiatives

### R3-01 Skills first-class management

- **Status:** implemented (F1+F2, 2026-07-19, PR-B — see baseline R3-B7); F3+F4 re-entered `planned` 2026-08-03 (wave 5) — the studio-endstate-v2 mockup IS the reserved §4b.1 design (see the wave-5 re-entry note below); **F3+F4 implemented 2026-08-04 (branch `feat/r3-01-skills-library` — see baseline R3-B8)**  ·  **Wave:** 3 (F1+F2) / 5 (F3+F4)
- **Depends on:** — . **Depended on by:** R3-02 (landing-place), R3-03 (soft —
  hooks reuse the unified-registry + library-view pattern), R3-04 (soft — same
  surface pattern), R4-21 (F3's FilePackage renderer + F4's install/palette
  pipeline receive its authored packages), R5-05 (skills-palette residue
  cross-references here, not duplicated), R3-08 (the shared resolver is what
  gains a second, operator-owned root).
- **Context:** Three converging findings: [known-gaps §4.11](../known-gaps.md)
  (UI-created skills invisible to the agent builder's palette — the S5b demo
  rebuild broke its create-skill→compose-into-agent throughline on this),
  §4b.1 (skills need first-class management: no library view, no consistent
  creation entry point, skills should break out into their own library item —
  **operator will detail their view in a future session**), §4b.8 (no
  skill-editing surface exists). Plus the §6 precondition: any physical
  reorganisation of `skills/` is blocked until a single shared `skillPath(name)`
  resolver exists. Operator diagram (R3 verbatim intent): *"Skills = installed
  library shipping OOTB; edit + add hand-crafted skills; reference marketplaces
  like <https://skillsmp.com/> for browse/install."*
- **Features:**
  - **R3-01-F1 — `skillPath(name)` shared resolver.** One resolution point for
    every skill lookup **and enumeration** — a three-function module
    (adversarial review A6): `skillPath(name): string`, `skillDir(name)`, and
    `listSkillDirs()` (the discovery walk — `listAgentDefinitions` discovers
    names via `readdirSync`, it cannot consume a name→path lookup), importable
    from both `orchestrator/` and `cli/`; every one of the ~35 hardcoding
    files (per-phase runners' `deriveAgentSpec(...)` /
    `resolve(FORGE_ROOT,'skills',...)` sites) routes through the lookups and
    `orchestrator/studio/registry.ts:listAgentDefinitions` consumes
    `listSkillDirs()`. Acceptance: grep for literal `'skills/'` path
    construction outside the resolver module returns zero production hits;
    full suite + `ui:journey` green; **no physical move happens in this
    feature** — the §6 revisit condition is met only when lookup AND
    enumeration both route through the module; the move itself stays a
    known-gaps §6 follow-on decided separately.
  - **R3-01-F2 — Unified skill-library registry.** A single library model that
    **unions** live filesystem discovery (`skills/*/SKILL.md` frontmatter) with
    `studio/catalog.yaml` community entries (catalog wins on provenance/stars
    metadata; filesystem wins on existence). `POST /api/studio/skills`
    registers the new skill so it is palette-visible immediately (either of the
    two §4.11 fix candidates — write-through to `catalog.yaml` or live-union in
    the registry — with the union preferred: no generated edits to a curated
    file). Normalise the `library` frontmatter flag: define its semantics
    (Studio-roster/palette visibility), set it explicitly on all 24 skills
    (today 1 true / 6 false / 17 unset), and have `forge studio lint` flag
    unset values. Acceptance: a skill created via `/skills/new` appears as a
    draggable chip in `CatalogPalette` without a bridge restart; the `skills`
    journey drops its `handoff` substitution and demos the real
    create→compose throughline; `forge studio lint` reports 0 unset `library`
    flags.
  - **R3-01-F3 — Library view + edit surface.** A `/skills` library route
    (list every library skill with name, description, category, provenance,
    `composedBy` usage, library flag) and an edit surface for existing skills
    (reusing the `/skills/[id]` builder shell — fixes §4b.8, and gives the
    §4b.8 demo clip a real subject). Consistent creation entry: the library
    view is the one place "New skill" lives. DOM-as-metrics contract:
    `[data-page="skill-library"]` + per-item `[data-skill-id][data-skill-source]`
    (`source` = `local | community`); journey-sync in the same PR per the
    CLAUDE.md rule. **OPEN DESIGN MARKER (§4b.1): the operator has reserved
    detailing their view of skill management for a future session — F3's
    surface design must be confirmed against that session's notes before
    implementation; treat this feature's UI shape as provisional.**
  - **R3-01-F4 — Marketplace browse/install (posture hardened 2026-07-17,
    adversarial review E5 — operator decision 3).** Browse/install from
    community marketplaces (reference: <https://skillsmp.com/>, plus the
    upstream repos already cited in `catalog.yaml` — obra/superpowers,
    anthropics/skills). Third-party prompt-code gets **at least** the gate
    forge's own generated skills get (R3-02-F4) — never weaker: install routes
    through the same **draft → scan → operator-approve** pipeline. On
    install: the skill lands as a draft with `runtime:`, `allowed-tools`, and
    `library:` frontmatter **stripped/quarantined pending approval** (a
    vendored SKILL.md must not become a runnable, self-tool-granting agent
    before a human reads it — the prose IS the payload, and instruction-level
    injection is unscannable); the approval gate renders the full SKILL.md
    body; the upstream **content hash is pinned** in the provenance
    frontmatter (`source`, `provenance`, `contentHash`, install date,
    upstream ref); an update or local edit re-enters review (parity with
    R3-03-F2's edit rule). Acceptance: an approved install round-trips into
    the unified registry (F2) and the palette; a pre-approval draft is not
    palette-visible and not runnable; provenance + hash render in the library
    view (F3); reinstalling shows the already-installed state rather than
    duplicating; a changed upstream hash forces re-review.
  - **Wave-5 re-entry (2026-08-03, module: library-skills).** The operator's
    reserved §4b.1 design session happened as the studio-endstate-v2 mockup
    campaign — F3/F4's UI shape is no longer provisional. F3 concretized by
    the mockup: a Library › Skills pillar view (local + community sections,
    provenance badges, used-by derived from agent specs) with **detail pages
    per skill** (`#/library/skills/<id>` in the mockup) rendering the skill as
    a **file package** — SKILL.md + scripts + templates in tabs (mockup
    `SKILL_FILES.release-notes`: `SKILL.md`, `scripts/collect-diffs.sh`,
    `templates/notes-template.md`) — plus used-by, versions, and
    hub/backing-repo links for community entries. Definitions are generic and
    land **unbound**; binding to an agent happens only from the Agent Builder
    (round-4 rule — "carried by" derives from agent specs). F4's
    install entry point is the cross-kind community browser (R3-07), which
    routes skill installs through THIS feature's draft→scan→operator-approve
    pipeline unchanged. **Acceptance references:** mockup journeys
    `build-skill` (create → package tabs → filed unbound → bind from Agent
    Builder) and `install-skills-hooks` (community → install → draft →
    approve); surfaces `views-library.jsx` / `views-library-detail.jsx`.
    **As-built baseline:** R3-B7 (unified palette registry, no `/skills` view,
    no install flow — `as-built-inventory.md` §7).
- **Session sizing:** ~3 operator-run agent sessions — (1) F1 resolver sweep +
  full-gate; (2) F2 registry union + API registration + lint check; (3) F3+F4
  surfaces + journey-sync (F3 gated on the operator's §4b.1 design session).
- **Out of scope:** skill *generation* (R3-02); the physical `skills/`
  role-subfolder move (stays a known-gaps §6 decision, unblocked by F1 but not
  taken here); hook-grade security protections (R3-03); tools/MCPs (R3-04).

### R3-02 Skill-generator flow

- **Status:** planned  ·  **Wave:** 4
- **Depends on:** R3-01 (landing-place — generated skills need the managed
  library to land in; index dependency table records this edge), R1-01 (soft —
  a generated flow-scoped skill may bind a flow-scoped KB under the KB
  contract), R5-04 (soft — the generator flow runs through the standard run
  model, i.e. a second live flow: verify the edit-lock first — adversarial
  review E7).
- **Context:** Operator diagram (verbatim intent): *"an agentic flow that
  takes a scope (project, agent, or flow) and a process (described by the
  operator OR referencing a cycle run) and puts it through a skill-generator
  skill to add to the library."* Building block already shipped: the
  `skill-creator` community skill (anthropics/skills provenance,
  `composedBy: [architect]`) in `studio/catalog.yaml`. This is the
  library-side counterpart of forge's compounding-knowledge thesis: processes
  that worked once become reusable capability, not just brain themes.
- **Features:**
  - **R3-02-F1 — Scope + process input contract.** The flow's typed input:
    `scope` = exactly one of `project:<id>` | `agent:<id>` | `flow:<id>`
    (validated against the Studio registry / project registry), and `process`
    = either `description` (operator free text) or `cycleRun:<runId>`
    (reference to an archived run). Schema lives beside the flow definition;
    invalid scope or a dangling runId fails fast at submission. Acceptance:
    schema validated by `forge studio lint`; both process variants accepted;
    mixed/absent variants rejected with actionable errors.
  - **R3-02-F2 — Generator flow definition.** A flow under `studio/flows/`
    (peer of `forge-architect`/`forge-develop`) whose single
    agent composes the `skill-creator` skill: ingest scope context + process
    input → draft `SKILL.md` (frontmatter: name, description, `library` flag
    default `false`-until-approved, provenance = `generated`, generating run
    id). Runs through the standard run model so it appears on `/flows/[id]`
    like any flow. Acceptance: flow validates under `forge studio lint`;
    produces a draft skill directory; emits standard JSONL events.
  - **R3-02-F3 — Cycle-run-reference grounding.** When `process =
    cycleRun:<runId>`, the generator mines the run's real artifacts — the
    JSONL event log (`_logs/`), the archived cycle record
    (`brain/_raw/cycles/`), queue manifests (`_queue/done/`) — to extract the
    process it is codifying (steps taken, gates passed, pitfalls hit), citing
    the run id in the generated skill body. Corpus-grounded, per the standing
    demo-seeds feedback: no hand-invented process narratives. Acceptance: a
    generated skill from a real archived run cites concrete artifact paths;
    generation from a run with missing artifacts degrades to an explicit
    "insufficient evidence" outcome, not a hallucinated skill.
  - **R3-02-F4 — Draft → review → library landing.** Generated skills land as
    **drafts** outside the palette (`library: false`, `status: draft`
    frontmatter) and enter the library only through an operator approval step
    in the R3-01-F3 library view (approve = flip `library`, register in the
    unified registry). Acceptance: a draft never appears in `CatalogPalette`;
    approval makes it appear without restart; rejection archives the draft
    with a reason.
- **Session sizing:** ~2 operator-run agent sessions — (1) F1+F2 contract +
  flow; (2) F3 grounding + F4 review gate + journey coverage.
- **Out of scope:** generating hooks (R3-03 owns hook creation and its
  protections); auto-approval (operator gate is deliberate); improving
  `skill-creator` upstream.

### R3-03 Hooks library

- **Status:** implemented (2026-08-04, two PRs — the F1 migration clause, then
  F1-F4 the library; re-scoped 2026-08-03, wave-5 cut — see the re-scope block
  below)  ·  **Wave:** 5 (module: library-hooks)
- **Depends on:** R5-01 (soft — the dry-bridge safety seam and R5-02 env-pin
  should land before forge ships *installable, in-harness-executing*
  components; sequencing preference per Q6-A wave 0, not a hard blocker).
  R3-01 (soft — reuses the library-view/registry patterns).
- **Context:** Operator diagram (verbatim intent): *"Hooks = same as skills
  but with ADDED PROTECTIONS — security concern re exfiltration of API keys
  etc."* Hooks execute **in-harness**: a hook runs with the spawned agent's
  environment, which in real cycles includes operator credentials (`gh` auth,
  project secrets) — the exact class behind the 2026-07-16 bridge self-merge
  incident (known-gaps §4.10) that motivates wave-0 R5-01/R5-02. Baseline: the
  5 `catalog.yaml` hooks are reference metadata over orchestrator-owned
  implementations (R3-B5); there is no install/create path at all today, which
  is why the security model must be designed *with* the library, not
  retrofitted.
- **Wave-5 re-scope (2026-08-03 — operator decision 1, mockup vocabulary
  adopted):** a library "hook" is an **agent-lifecycle customisation**, not
  forge-infra machinery. The definition model F1 builds is: `{id, name,
  description, lifecycle event (PreToolUse | PostToolUse | SessionStart |
  SessionEnd | Notification | …), matcher (e.g. Bash(gh pr create)),
  guard/payload script, permission manifest (F3)}` — **generic and
  host-agnostic**; a definition names the event and the guard, never a
  binding. Binding is explicit and happens **only in the Agent Builder**
  (`composition.hooks`); "carried by" derives from agent specs (round-4
  mockup rule). Ripples onto the existing features:
  - **F1:** the model above replaces F1's looser "trigger point" phrasing;
    the catalog's forge-infra entries (event-log, cost-guard, stall-watchdog,
    merge-gate, scratch-strip + the band/contract guards) are **reclassified
    out of the hooks library** — renamed in `studio/catalog.yaml` as locked
    orchestrator **guards** (read-only listing, F1's "locked entries" AC now
    lives under that rename; they are not lifecycle hooks and never appear in
    the hooks library). OOTB lifecycle-hook seeds ship instead (mockup
    examples: `pre-pr-security-review` on `PreToolUse · Bash(gh pr create)`,
    `post-merge-brain-ingest` on `SessionEnd`).
    **Migration clause (added 2026-08-03 review pass — the rename is
    dispatch-load-bearing, not cosmetic):** the 9 catalog "hook" ids are
    referenced by `composition.hooks` across 15+ roster SKILL.mds (e.g.
    `developer-ralph`: `[event-log, cost-guard, stall-watchdog,
    scratch-strip]`), parsed by `orchestrator/studio/registry.ts`, and the
    band ids (`wi-contract`, `reflection-close`, `demo-band`, `review-band`)
    **drive declared dispatch** (`AGENT_BAND_EXECUTORS`,
    `CANONICAL_BAND_SLUGS` lint) — the forge-develop reflector resolves via
    its `reflection-close` band hook. The re-scope therefore includes, in one
    no-back-compat sweep: (a) a `guards:` catalog section (hooks section
    keeps only lifecycle hooks); (b) an authoring-field decision —
    `composition.guards` vs guards-stay-in-`composition.hooks` — recorded as
    an ADR-027 amendment (two disjoint vocabularies must not silently share
    one field: the standing double-booking lesson); (c) the roster SKILL.md
    sweep; (d) registry/validate/band-dispatch vocabulary updates with the
    golden spawn-capture suite proving byte-identical dispatch. **Scope
    note:** this migration deliberately exceeds the library-hooks module (it
    touches agent defs + orchestrator vocabulary) — it is the module's
    boundary being *moved*, done once, here; the alternative (a hooks
    library whose word means two things) violates decision 1. ACs: grep-zero
    guard ids in the hooks library; dispatch byte-identical (spawn-capture);
    `forge studio lint` green across the swept roster.
  - **F2/F3:** unchanged in substance (scan + deny-by-default manifest —
    they map 1:1 onto the lifecycle model; the mockup's hook detail page
    carries a visible **SECURITY SCAN** panel, which is F2's verdict
    rendering).
  - **F4:** the library/detail surface follows the R3-01-F3 wave-5 shape
    (detail page per hook: definition, `on:` event line, guard script,
    scan verdict, carried-by, versions); the marketplace entry point is the
    cross-kind community browser (**R3-07**), whose hook installs route
    through F2's scan + approval unchanged.
  - **Acceptance references:** mockup journeys `build-hook` (creation
    session → generic definition → filed unbound → bound later in Agent
    Builder) and `install-skills-hooks` (community hook install → scan →
    approve); surfaces `views-library.jsx` / `views-library-detail.jsx`,
    hook data + build-hook session in `data.jsx`. **As-built baseline:**
    R3-B5 + `as-built-inventory.md` §7 (catalog reference list only, no
    standalone hooks page/CRUD).
- **Features:**
  - **R3-03-F1 — Hook library model.** Managed hooks as first-class library
    items: a definition format (id, name, description, trigger point, payload
    script/command, **permission manifest** — see F3), discovery unified into
    the R3-01-F2 registry pattern, surfaced as palette chips
    (`[data-accepts="hook"]` drop zone already exists in the agent builder).
    The 5 shipped orchestrator hooks remain orchestrator-owned code; they are
    listed read-only (not editable payloads) — the library adds *operator/
    community* hooks alongside them. Acceptance: a library hook composes into
    an agent def (`composition.hooks`, already parsed by
    `orchestrator/studio/registry.ts`) and executes at its trigger point in a
    dry run; shipped orchestrator hooks render as locked entries.
  - **R3-03-F2 — Review/scan on install AND create.** Every hook entering the
    library (marketplace install, `/hooks/new` authoring, or generated)
    passes a static security scan before it is runnable: flag network egress
    (curl/wget/fetch/raw sockets), environment-variable reads (especially
    `*_TOKEN`, `*_KEY`, `AZDO_*`, `GH_*` patterns), file reads outside the
    declared scope (e.g. `~/.ssh`, `secrets.env`), and obfuscation (base64
    payloads, eval). Scan verdict + findings render in a mandatory operator
    approval gate — no hook auto-activates. Acceptance: a fixture hook that
    reads `GH_TOKEN` and curls it out is flagged with both findings and blocked
    pending explicit operator override; a benign fixture passes with an empty
    findings list; the scan runs on *edit* too (an approved hook that changes
    re-enters review).
    **AC corrected 2026-08-04 (R3-03 library PR, adversarial review).** As
    originally written this AC exercised the **undeclared** variant — and that
    variant is **inert**: an undeclared env var never reaches the child, so that
    fixture could not leak even if it ran. The variant that *can* leak is the
    **declared** one (`permissions: {env: [<secret>], network: true}`), and as
    first built, declaring *downgraded* both findings, so it scored `findings`
    and was approvable with no override at all — while the manifest-keyed env
    build handed the child the real value. The AC is therefore restated with the
    invariant it was always meant to express: **the declared path must never
    carry less friction than the undeclared path.** Severity keys off the
    capability **grant**, not scanner detection — a manifest *requesting* a
    secret-shaped name is critical whether or not the scanner finds a matching
    reference — so declared-secret-grant + declared-egress resolves to
    `blocked`. Benign combinations (egress with no secret grant) stay
    non-blocked, pinned in both directions so the rule cannot degenerate into
    everything-blocked.
    **AC amended again 2026-08-24 (W8-B6, hostile review of the first
    production caller of `runHookScript`).** The PAIRING above — env-read AND
    network-egress — was the only route to `blocked` for a capability grant,
    and its second half was evadable: this module's own header already listed
    the egress shapes the pattern list missed (`/dev/tcp/`, `python3 -c`,
    `ssh`, `dig`). A reviewer approved a hook declaring
    `permissions.env: ["GH_TOKEN"]` through the ordinary one-click path and its
    child printed the real token. The rule is now **any `critical` finding
    blocks on its own**, keyed off severity rather than category. The
    "must not degenerate into everything-blocked" pin above is UNCHANGED and
    still holds through the module's one deliberate downgrade: a *declared*
    network egress scores `info`, so a benign declared-network hook with no
    secret-shaped grant anywhere still scores `findings` and keeps its
    one-click approve. Both pattern lists were widened in the same lane
    (credential paths += `.netrc`, `.docker/config.json`, `.kube/config`,
    `.npmrc`, `.config/gh/`, `.git-credentials`, `.azure/`, `.config/gcloud/`;
    egress += the four shapes named above plus `/dev/udp/` and
    `openssl s_client`). Both OOTB hook packages were re-measured under the
    new rules and still scan `clean` with zero findings — no shipped hook
    needs an override.
  - **R3-03-F3 — Permission model (declare-what-you-access).** Each hook's
    definition carries a permission manifest: which env vars it may read,
    which paths it may touch, whether network egress is allowed.
    **Deny-by-default**: at execution the harness invokes the hook with a
    stripped environment containing only the manifest-granted vars (aligning
    with the R5-02 G8 env-pin at the spawn seam — same seam, same mechanism),
    and the F2 scan cross-checks observed access against the manifest.
    Acceptance: a hook reading an undeclared env var gets an empty value (and
    the mismatch is logged as a structured JSONL event); manifest renders in
    the approval gate; the shipped orchestrator hooks get retrofitted
    manifests as documentation even though their code stays orchestrator-owned.
  - **R3-03-F4 — Authoring/edit surface + marketplace install.** Mirror
    R3-01-F3/F4 for hooks: library view, create/edit surface, marketplace
    browse/install with provenance — but every entry path funnels through
    F2's scan + approval gate. Acceptance: create→scan→approve→compose
    round-trips in a journey; the install path shows scan findings *before*
    the operator confirms.
- **Session sizing:** ~3 operator-run agent sessions — (1) F1 model + registry
  + locked shipped-hooks listing; (2) F2 scanner + F3 permission
  manifest/env-strip (the security core, one session together — they
  co-design); (3) F4 surfaces + journey-sync.
- **Out of scope:** the dry-bridge seam and spawn-seam env-pin themselves
  (R5-01/R5-02 own the harness-side safety rails this leans on); skill-grade
  components (R3-01); hook *generation* via the R3-02 flow (a later extension
  once both exist — not specced here).

### R3-04 Tools/MCPs/CLIs library ("Connections")

- **Status:** implemented (2026-08-04, branch `feat/r3-04-connections-library`;
  baseline **R3-B10**)  ·  **Wave:** 5 (module: library-connections)
- **Depends on:** R3-01 (soft — reuses the unified-registry + library-view
  patterns).
- **Context:** Operator diagram (verbatim intent): *"Tools/MCPs/CLIs =
  similar but NO create-your-own (larger components)."* Baseline as of
  kickoff (R3-B2, since superseded for this pillar by R3-B10): `studio/
  catalog.yaml` shipped 3 tools and 6 MCPs as reference-only metadata —
  "operators wire real servers in their env" — so an MCP chip in the builder
  was a label, not a working binding. This initiative made the curated
  entries *installable and verifiable* without ever becoming an authoring
  surface. Also the realization substrate the R2-06 runtime-adapter work can
  present through (SDK/runtime picks are `[data-sdk]` in the agent builder).
- **Features:**
  - **R3-04-F1 — Curated registry with install/config metadata.** Extend each
    catalog tool/MCP/CLI entry with: install method (npm package + version
    pin, binary, or "system-provided" like `git`/`gh`), config schema (what
    the operator must supply — paths, tokens *by env-var name reference only*,
    never values), and a **readiness probe** (a cheap command/handshake that
    verifies the component actually works in this environment). Curation
    stays forge-dev-owned: adding an entry is a PR to `catalog.yaml`, not a UI
    action. Acceptance: every existing entry (3 tools, 6 MCPs) carries the
    extended metadata; `forge studio lint` validates the schema; **no
    create/edit UI exists for this category anywhere** (explicit negative
    acceptance criterion).
  - **R3-04-F2 — Browse/install surface (no authoring).** Library view
    listing tools/MCPs/CLIs with provenance + availability status
    (probe result: `available | not-installed | misconfigured`), and an
    install action for installable entries (runs the pinned install method,
    then the probe). Acceptance: `memory` MCP round-trips
    not-installed→install→available (**corrected 2026-08-04, D16** — the AC
    as originally written named `sqlite`; a curation research pass found
    `sqlite` has no npm distribution and its PyPI package is archived, making
    the AC unsatisfiable against reality, so the round-trip AC moved to
    `memory`, actively maintained and npm-distributed); `git` shows
    system-provided/available with no install action; a misconfigured entry
    surfaces the failing probe output, not a generic error.
  - **R3-04-F3 — Agent-builder binding with readiness.** The
    `[data-accepts="tool"|"mcp"]` drop zones and the `[data-ready-count]`
    readiness panel consume real probe state: composing an unavailable MCP
    into an agent is allowed (defs are portable) but flags the def's readiness
    count and blocks *run* with an actionable "install/configure X" message
    instead of a mid-run failure. Acceptance: readiness panel counts reflect
    probe reality; a flow-run attempt with an unavailable bound MCP fails fast
    pre-spawn with the component named.
  - **R3-04-F4 — Provenance + version-pinning security posture.** MCP servers
    are arbitrary code execution: every installable entry pins an exact
    version, records upstream provenance (same shape as community-skills),
    and upgrades are explicit operator actions re-running the probe.
    No R3-03-grade scan (these are large third-party components; the trust
    decision is at curation time, which is why authoring is excluded).
    Acceptance: installs are reproducible from the pinned version; an
    unpinned entry fails `forge studio lint`.
- **Wave-5 amendment (2026-08-03, module: library-connections).** The mockup
  names this pillar **Connections** (Library › Connections: MCPs · CLIs ·
  tools) — adopt the name on the surface (registry/category ids in
  `catalog.yaml` need not rename; the pillar label does). Concretized by the
  mockup: **detail pages per connection** (`#/library/connections/<id>`) with
  kind-appropriate content — for an MCP the **capability list of the server**
  (the tools it exposes), not its repo README; hub + backing-repo links;
  install state + probe status; used-by agents. Community installs enter via
  the cross-kind browser (**R3-07**) honoring F4's version-pin/provenance
  posture (trust at curation time, no authoring — the negative AC stands).
  **Acceptance references:** mockup journey `install-connections`
  (browse hub → capability list → install → probe → available; the mockup's
  connection rows carry per-hub signals); surfaces `views-library.jsx` /
  `views-library-detail.jsx` (`CONNECTIONS` in `data.jsx`). **As-built
  baseline:** R3-B10 (this initiative's landing; supersedes R3-B2 for this
  pillar). `docs/product/as-built-inventory.md` does not exist in this repo
  checkout — the §7 reference in the original spec is stale; grepped and
  confirmed absent 2026-08-04, no substitute doc found to link instead.
- **Honest limits, stated not hidden (curation research pass, 2026-08-04):**
  the surface presents **two** real connection kinds (`tool`, `mcp`), not the
  mockup's three (MCPs · CLIs · tools) — forge has two catalog sections, and
  introducing a `clis:` section is a separate, out-of-scope catalog-section
  migration (D2). An MCP's capability list is **curated** catalog data,
  labelled `capabilitiesSource: 'curated'` on every payload and in the UI —
  never presented as a verified live capability list of a running server,
  because enumerating one for real needs an MCP client handshake forge does
  not have and adding one is an ask-first new dependency (D8). For an `npm`
  entry the probe verifies the **pinned artifact is present on disk at the
  pinned version** — it does not verify the server runs, because neither
  shipped npm entry's upstream provides a non-server invocation to check
  against (verified by reading `dist/index.js` for both; D15).
- **Session sizing:** ~2 operator-run agent sessions — (1) F1+F4 registry
  metadata + lint; (2) F2+F3 surfaces + readiness wiring + journey-sync.
- **Out of scope:** create-your-own for this category (operator-excluded,
  permanently — larger components); the runtime-adapter *implementations*
  themselves (R2-06 owns realizing Gemini/Aider/etc. adapters; this library
  only presents/installs them); hook execution protections (R3-03).

### R3-05 Instructions library

- **Status:** **F1–F3 implemented** (2026-07-26, wave-4 S8, branch
  `feat/r3-05-instructions-library`); **F4 deferred** (see notes)  ·  **Wave:** 3
  (must precede R4-02/R4-03 — Q6-A "interleaved at dependency points")
- **Implemented-notes (2026-07-26):**
  - **F1 — built.** `InstructionSeed` type + `INSTRUCTION_SEED_KINDS`
    (`language|domain|practice|project-shape`) / `INSTRUCTION_SEED_SCOPES`
    (`project|agent|both`) in `studio/types.ts`; `loadInstructionSeed` /
    `listInstructionSeeds` (`studio/instruction-seeds/<id>.md`, gray-matter,
    mirrors `loadDemoElement` — absent-dir tolerant, sorted by id);
    `validateInstructionSeed` + a `forge studio lint` block (slug id, ≥1
    `appliesTo` tag, slug-shaped tags, non-blank `provenance` per the
    corpus-grounding rule, non-empty body). Lenient-parse-then-lint: a bad
    `kind`/`scope` enum throws at load (surfaced by lint).
  - **F2 — built (5 provenance-cited seeds).** `typescript-node` (forge's own
    conventions + mdtoc/gitpulse corpora), `go-terraform-provider`
    (`projects/terraform-provider-betterado/AGENTS.md`), `cli-project-shape`
    (mdtoc/gitpulse verify grounds), `tdd-red-green` (forge rules + the shipped
    `superpowers-tdd` community skill), `forge-managed-project` (ADR-034
    contract). ≥1 per listed domain; every seed cites a real artifact.
  - **F3 — built.** `orchestrator/instruction-seed-match.ts`: `detectProjectTags`
    (from on-disk evidence — package.json/tsconfig→typescript/node/cli,
    go.mod→go/terraform-provider, always `forge-managed`; never fabricates) +
    `matchInstructionSeeds` (appliesTo∩tags, `project`/`both` scope). The
    instructions-runner injects matched seeds into the interview + draft prompts
    and records `composed_seed_ids` in a machine-greppable AGENTS.md footer
    (drops any id the LLM returns that wasn't actually matched). No-match ⇒
    today's from-scratch interview (additive, unchanged).
  - **F4 — DEFERRED.** The browse/edit library surface "follows the R3-01-F3
    pattern" — but R3-01-F3 (the `/skills` view) + R3-01-F4 (marketplace) were
    themselves deferred to the operator's §4b.1 design session (known-gaps §11).
    F4 has no surface pattern to build against yet, and the consumers (R4-02/R4-03)
    read seeds server-side via `listInstructionSeeds`, so F1–F3 fully unblock them.
    When R3-01-F3 lands, F4's natural first step is a read-only
    `GET /api/studio/instruction-seeds` bridge route (mirroring demo-elements) +
    the browse/edit view + a journey beat.
- **Depends on:** — . **Depended on by:** R4-02 project-onboarding agent and
  R4-03 project-creation agent (both source AGENTS.md/instructions material
  from this library, alongside R1 contract clauses — index dependency table
  records both edges).
- **Context:** Operator diagram (verbatim intent): *"Instructions = best
  practices for a language/domain, seeds for projects or agents; building
  blocks for creating instructions for a new project or a project without an
  agents.md."* The consumer already exists: the `instructions-creator` agent
  (R3-B4 — merged Stage A, `skills/instructions-creator/SKILL.md` +
  `/instructions/[sid]` interview UI) authors AGENTS.md from scratch today.
  R3-05 builds the **seed corpus it consumes**, turning generation-from-
  nothing into composition-from-vetted-blocks — and giving R4-02/R4-03 their
  sourcing substrate.
- **Features:**
  - **R3-05-F1 — Seed format.** An instruction seed is a markdown block with
    frontmatter: `id`, `title`, `kind` (`language | domain | practice |
    project-shape`), `applies-to` tags (e.g. `typescript`, `go`,
    `terraform-provider`, `cli`, `monorepo`), `scope` (`project | agent |
    both`), provenance (where the practice was proven — a repo, a cycle run,
    an upstream style guide). Seeds are composable building blocks, not whole
    AGENTS.md files. Stored under a library directory peer to the other
    Studio-managed content (exact location decided with R3-01-F2's unified
    registry so all four libraries discover the same way). Acceptance:
    format documented; `forge studio lint` validates seed frontmatter;
    a seed renders standalone and composes into a draft AGENTS.md.
  - **R3-05-F2 — Shipped OOTB seed corpus.** Initial seeds grounded in what
    forge has actually proven, with provenance citations — per the standing
    corpus-grounding rule (no hand-invented best practices): TypeScript/Node
    (from forge's own conventions + managed-project AGENTS.md corpora),
    Go/terraform-provider (from the betterado migration + release cycles),
    CLI-project shape (from mdtoc/gitpulse verify grounds), plus
    project-shape seeds mirroring the contract clauses in
    `docs/forge-project-contract.md` (ADR-034). Acceptance: ≥1 seed per
    listed domain; every seed's provenance cites a real artifact (repo path,
    cycle archive under `brain/_raw/cycles/`, or upstream source URL); lint
    green.
  - **R3-05-F3 — instructions-creator integration.** The interview consumes
    the library: it matches the target project's shape/language to
    `applies-to` tags, proposes matching seeds as pre-filled interview
    material (operator confirms/edits rather than answering from blank), and
    the produced AGENTS.md records which seeds it composed (traceability for
    later seed improvements). Behavior change is *additive* — a project with
    no matching seeds falls back to today's from-scratch interview.
    Acceptance: interviewing against a TypeScript project surfaces the
    TypeScript seeds; the output AGENTS.md lists composed seed ids; the
    no-match fallback still completes.
  - **R3-05-F4 — Library surface.** Browse/edit view following the R3-01-F3
    pattern (list by kind/tags, edit a seed, add a hand-crafted seed). No
    marketplace install initially — seeds are small enough that the shipped
    corpus + hand-authoring covers the need; revisit alongside R3-01-F4
    evidence. Acceptance: seed CRUD round-trips through the surface; edits
    re-validate frontmatter; journey-sync covers the view.
- **Session sizing:** ~2 operator-run agent sessions — (1) F1 format + F2
  corpus (research-heavy: mining real corpora for seeds); (2) F3 integration
  + F4 surface + journey-sync.
- **Out of scope:** the onboarding/creation agents that consume this library
  (R4-02, R4-03); contract-clause *typing* (R1-03/R1-04 own the contract side
  — seeds reference clauses, they don't define them); marketplace install for
  seeds (revisit condition noted in F4).

### R3-06 Templates library

- **Status:** implemented (F1+F2+F3, 2026-08-04, branch
  `feat/r3-06-templates-library` — see baseline **R3-B9**)  ·  **Wave:** 5
  (module: library-templates)
- **Depends on:** R3-01 (soft — library-view/detail-page pattern), R2-05
  (soft — R2-05-F1's canonical artifact set is the substance this library
  manages; sequence R2-05-F1 first or fold its audit into F1 here — decide at
  session start, don't do it twice). **Depended on by:** R3-07 (templates are
  a browsable kind), R4-03 (project-type scaffolds feed project creation).
- **Context:** Wave-5 cut (2026-08-03). The mockup promotes templates to a
  4th library pillar — the in/out artifact shapes agents produce and consume —
  where as-built has filesystem-only `studio/artifact-templates/*.md` +
  `studio/starters/` + `studio/demo-elements/` with no management UI
  (`as-built-inventory.md` §7, baseline R2-B7). Mockup registry
  (`TEMPLATES` in `data.jsx`), three categories: **demo outputs** (HTML
  summary, video demo, screenshot set, interactive mockup), **planning
  artifacts** (roadmap, initiative spec), **project-type scaffolds** (REST
  API, web UI, CLI/library — `provenance: 'vision'`, the scaffold kind does
  not exist as-built at all).
- **Features:**
  - **R3-06-F1 Template registry model.** One library model unifying the
    three as-built sources (`artifact-templates/`, `demo-elements/`,
    `starters/`) as typed library items: `{id, name, category (demo-output |
    planning | project-scaffold), format note, provenance, definition ref}`,
    discovered the R3-01-F2 way, `used-by` **derived** from agent/flow defs
    (which agents emit/consume the template — never hand-maintained; the
    declared-data-fails-open lesson: a hand-written used-by list is a lie
    waiting to happen). ACs: every existing template/starter/demo-element
    surfaces as a registry item; `forge studio lint` validates category +
    dangling definition refs; zero new template content invented.
  - **R3-06-F2 Library view + detail pages.** Library › Templates pillar:
    card grid with **CSS-rendered preview thumbnails** (mockup `preview:`
    kinds — html/video/shots/mock/doc/scaffold; cheap CSS approximations, not
    live renders) and a detail page per template (definition, format, used-by,
    version history from git). DOM contract `[data-page="template-library"]`
    + per-item `[data-template-id][data-template-category]`; journey-sync in
    the same PR. ACs: all registry items render; detail round-trips; journey
    beat covers browse→detail.
  - **R3-06-F3 Project-type scaffolds.** The new kind: a scaffold =
    contract-conforming repo template (project shape, tests, demo skill,
    gates pre-wired) consumed by project creation (R4-03) — the mockup's
    create-project journey picks the web-UI scaffold and lands a
    contract-green project. **Deliberate vision-promotion (recorded):** the
    scaffolds carry `provenance: 'vision'` in the mockup, and this is the one
    vision item the cut promotes to planned — the create-project mockup flow
    is unwalkable without it (unlike the R4-B13 non-cuts, which no journey
    requires). Ship the three mockup shapes as OOTB seeds
    grounded in the real contract (`docs/forge-project-contract.md`, ADR-034)
    and the real demo grounds (CLI shape ≈ mdtoc/gitpulse). ⚑ Operator-gate:
    scaffold content review before shipping (a scaffold is executable
    opinion). ACs: creating from a scaffold yields a preflight-green project;
    scaffold detail page lists what the contract pre-wires; R4-03's picker
    consumes the registry (no hardcoded scaffold list).
- **Session sizing:** ~2 sessions — (1) F1 registry + lint (+ the R2-05-F1
  boundary decision); (2) F2 surfaces + journey-sync. F3 rides the R4-03
  session where sensible.
- **Acceptance references:** mockup journey `create-project` (scaffold-picker
  beat) + `build-skill` (templates inside the package); surfaces
  `views-library.jsx` (`TEMPLATES` in `data.jsx`).
- **Out of scope:** dynamic artifact *rendering* contracts (R2-05-F2/F3);
  demo-element content quality (R5-06); the creation agent consuming
  scaffolds (R4-03).

### R3-07 Community browser

- **Status:** implemented (2026-08-05, branch feat/r3-07-community-browser;
  baseline R3-B11). **Wave-6 evolution (2026-08-15):** the source of truth
  moved from a catalog-adjacent read to a declared `studio/community/
  registry.yaml` (CR-1, PR #159 — migrates the 20 catalog `community-skills`
  entries; vendored skills/hooks + connections stay derived, `hubs.yaml`
  unchanged), gained pure sorts + freshness/staleness honesty (CR-2, PR
  #163), and gained a **community-refresh session kind** — gather → draft →
  operator-approve → finalize, on the generic interactive spine, stamping
  real `fetchedAt`/`fetchedBy` provenance rather than fabricating it (CR-3,
  PR #167, folds CR-4's entry button). The F1-F3 browse/detail/install
  behaviour this initiative specified is unchanged by the migration.  ·
  **Wave:** 5 (module: community-browser)
- **Depends on:** R3-01-F4 (skill install pipeline — the browser is an entry
  point, never a second pipeline), R3-03-F2 (hook scan + approval), R3-04
  (connections registry + probe), R3-06 (soft — templates browsable later).
- **Context:** Wave-5 cut (2026-08-03). One cross-kind community
  browse/install surface (`#/library/community` in the mockup) instead of
  per-kind marketplace tabs. As-built: community-skills render as
  reference-only catalog cards, no install flow anywhere
  (`as-built-inventory.md` §7). Mockup shape (`COMMUNITY`/`COMMUNITY_HUBS`
  in `data.jsx`): a **source-hub strip** (MCP Registry, smithery.ai,
  skills.sh, anthropics/skills, obra/superpowers, claude-code-templates) and
  rows carrying **per-hub signals** (stars, downloads/week, hub-usage note)
  — signals attributed to their hub, never presented as forge's own ranking.
- **Features:**
  - **R3-07-F1 Browse surface.** Kind-filterable list (skill | hook | mcp |
    cli | tool) with hub strip, per-row hub signals + provenance, and
    install-state per object (`not-installed | draft-pending-approval |
    installed`; reinstall shows installed state — R3-01-F4's AC generalized
    to every kind). Curation stays forge-dev-owned: the browsable index is
    data (`catalog.yaml`-adjacent), not a live hub crawl — a hub API
    integration is a separate future decision, not implied here. ACs:
    every kind filters correctly; install-state derives from the real
    registries; hub signals render with their hub attribution.
  - **R3-07-F2 Pre-install detail pages.** Community items get the same
    kind-appropriate detail page as installed items (R3-01-F3 / R3-03-F4 /
    R3-04 shapes: package file tabs for skills/hooks, capability lists for
    MCPs, hub + backing-repo links, and the hook SECURITY SCAN panel) —
    rendered BEFORE install so the operator reads what they're approving.
    ACs: detail reachable pre-install for each kind; hook detail shows scan
    verdict pre-approval.
  - **R3-07-F3 Install routing.** Install actions dispatch to the owning
    kind pipeline — skills → R3-01-F4 draft→scan→approve, hooks → R3-03-F2
    scan + approval gate, connections → R3-04-F2 pinned install + probe.
    The browser owns zero trust decisions itself. ACs: one journey per kind
    routes through its real pipeline; a pre-approval draft is never
    palette-visible (conformance with R3-01-F4/R3-03-F2 ACs, asserted from
    this surface).
- **Session sizing:** ~2 sessions — (1) F1+F2 surface; (2) F3 routing +
  journey-sync. Requires at least one owning pipeline (R3-01-F4 or R3-03)
  landed first.
- **Acceptance references:** mockup journeys `install-skills-hooks`,
  `install-connections`; surfaces `views-community.jsx`,
  `views-library-detail.jsx` (`COMMUNITY`/`COMMUNITY_HUBS` in `data.jsx`).
- **Out of scope:** the per-kind trust pipelines themselves (owned by
  R3-01/R3-03/R3-04); live hub API crawling (future decision); publishing
  forge content *to* hubs (R8 territory).

### R3-08 Operator workspace — the `_local/` root and provenance by root

- **Status:** planned  ·  **Wave:** unsequenced — the wave-8 ON-2 spike shipped
  design only, by operator decision
- **Depends on:** R3-01 (the shared skill resolver + unified registry is what
  gains a second, operator-owned root). Nothing blocks this: R3-01, R3-03 and
  R3-07 all reached `implemented`, and this initiative extends their shipped
  machinery — `hooksDir` (R3-03) is one of the root helpers that changes, and
  `studio/community/registry.yaml` (R3-07) is one of the tracked write targets —
  rather than waiting on any of them.
- **Depended on by:** R3-09 (promotion needs a workspace to promote *from*),
  R6-10 *(soft — the pending surface's job shrinks to core-only once operator
  authoring stops dirtying the repo; it is landable first regardless)*, R8-01
  *(soft — an installable forge must survive an upgrade without clobbering
  operator edits)*.
- **Context:** [ADR 045](../decisions/045-operator-workspace-and-promotion.md) §A.
  Every object an operator authors in Studio lands in a **git-tracked path inside
  the forge repo**: `skills/<slug>/SKILL.md`, `studio/flows/<id>/flow.yaml`,
  `studio/hooks/<id>/`, `brain/<id>/`, `studio/community/registry.yaml`. Studio
  never commits any of it — deliberately, per
  [`docs/community-registry-writes.md`](../community-registry-writes.md) and the
  2026-07-16 bridge-self-merge incident that `cli/dry-bridge.ts` exists to prevent.
  The consequences are live and named:
  the wave-7 walkthrough findings record (retired M1-A) `library-07` (*"Studio writes
  authored skills straight into the live forge working tree with no commit — they
  show up as untracked churn"*); `cli/studio-provenance.ts`'s `AGENT_PROVENANCE`
  and `PROJECT_PROVENANCE` hard-coded to `'unknown'` because an OOTB and an
  operator-authored `SKILL.md` are byte-indistinguishable on disk; and two
  machine-local files — `studio/installed-skills.yaml`
  (`orchestrator/studio/skill-install-ledger.ts`) and `studio/hook-approvals.yaml`
  (`orchestrator/studio/hook-scan.ts`) — written into the tracked `studio/` tree
  and not gitignored. Forge already has both halves of the answer in production:
  `forge.config.json` and `_connections/` are gitignored operator-local state, and
  `resolveKbBrainDir` (`orchestrator/brain-paths.ts`) already resolves an id
  across two ordered containment roots with the realpath guard re-applied per root.
- **Features:**
  - **R3-08-F1 — The `_local/` root, declared and ignored.** A single gitignored
    root mirroring the shape of the tracked trees it shadows: `_local/skills/`,
    `_local/studio/flows/`, `_local/studio/hooks/`. Added to `.gitignore` beside
    `_connections/` with the same house rationale comment. The name deliberately
    avoids *workspace*, which already means an npm workspace in this repo
    (`forge-ui`). Acceptance: `git check-ignore -v _local/` resolves to the new
    rule; a fresh clone has no `_local/`; `forge studio lint` runs clean against a
    tree with and without it.
  - **R3-08-F2 — Ordered root resolution at the per-kind helpers.** Each per-kind
    root helper — `hooksDir(forgeRoot)`
    (`orchestrator/studio/hook-library.ts`) and its skill/flow siblings — becomes
    an ordered resolver in the shape `resolveKbBrainDir` already uses: try
    `_local/<kind>/`, then `<kind>/`, first hit wins, **`resolveGuardedPath`
    re-applied per root**. The guard is not generalized, hoisted, or relaxed;
    each root keeps its own call. Acceptance: a `_local/` object resolves and
    renders in the library; a tracked object still resolves unchanged; a planted
    symlink in either root is refused with the same answer as an absent object
    (the existing probe-oracle discipline); every helper's resolution is unit-tested
    per root in isolation.
  - **R3-08-F3 — Studio writes default to `_local/`.** Create routes write to
    `_local/`. Editing an object that resolved from a tracked root is a **core
    edit** and is R3-09's business — it does not silently write the tracked tree.
    This inverts today's default, which is the defect. Acceptance: creating an
    agent/flow/hook from Studio leaves `git status` on the forge repo clean;
    an edit to an OOTB object returns an explicit, typed response naming the
    promotion path rather than writing and going quiet.
  - **R3-08-F4 — Provenance derived from the root.** `_local/` ⇒ `operator`; a
    tracked root ⇒ `ootb`. `AGENT_PROVENANCE` and `PROJECT_PROVENANCE`
    (`cli/studio-provenance.ts`) stop being constants and become derivations over
    the resolved root — the `derive-status-don't-store-it` posture
    ([ADR 044](../decisions/044-read-path-memoization.md)) applied to provenance:
    no field is added in which a stale copy could drift. The n/a-invariant
    survives — `'unknown'` remains the answer for anything neither root attests.
    Acceptance: `ProvenanceBadge` shows `operator` for a `_local/` agent and
    `ootb` for a shipped one, with **no** `origin:` field added to any `SKILL.md`;
    the existing per-type provenance tests are extended, not replaced.
  - **R3-08-F5 — Machine-local state leaves the tracked tree.**
    `studio/installed-skills.yaml` and `studio/hook-approvals.yaml` move to
    `_local/studio/`. Both are per-machine (an install ledger and hook approval
    verdicts) and must never enter shared history. Acceptance: both write paths
    resolve under `_local/`; a tree that carries the old tracked-adjacent files is
    migrated on read with a one-line notice, not silently ignored; `git status` is
    clean after an install and after a hook approval.
  - **R3-08-F6 — Shadowing is surfaced, never silent.** An id present in both
    roots is a real hazard (a `_local/` object masking an OOTB one). `forge studio
    lint` gains a check naming every shadowed id and both paths, and the library
    surface labels a shadowed object rather than hiding the conflict. Acceptance:
    a deliberately shadowed fixture produces a named lint flag and a visible
    label; an unshadowed tree produces neither.
- **Session sizing:** ~3 operator-run agent sessions — (1) F1+F2 the root and the
  resolvers, with the per-root guard tests; (2) F3+F5 the write-default inversion
  and the machine-local move; (3) F4+F6 provenance derivation, the shadow check,
  and library-surface coverage.
- **Out of scope:** moving `brain/` out of the forge repo —
  [ADR 035](../decisions/035-forge-owned-central-artifacts.md) decided it lives
  there and stands, so `brain/` writes stay tracked and stay visible via R6-10.
  Promotion of anything out of `_local/` (R3-09). Any change to what `forge studio
  lint` validates beyond the new shadow check. Multi-operator or shared workspaces
  — `docs/roadmaps/README.md` §2 records multi-operator as deliberately absent.

### R3-09 Promotion into forge core — a branch and a pull request

- **Status:** planned  ·  **Wave:** unsequenced — follows R3-08
- **Depends on:** R3-08 (promotion needs a workspace to promote *from*, and a
  provenance signal to know what is promotable), R5-01 *(soft — the dry-bridge
  route classification this must register in)*.
- **Depended on by:** R6-10 *(soft — a pending row is only actionable if there is
  somewhere for it to go)*.
- **Context:** [ADR 045](../decisions/045-operator-workspace-and-promotion.md) §B.
  The operator's ask is *"a way to roll changes I make to the platform back into
  forge core seamlessly."* Forge already runs exactly this transaction — against
  **managed project repos**. `orchestrator/project-repo-tx.ts` carries
  `STUDIO_BRANCH = 'forge-studio'`, `ensureStudioBranch`, `commitStudioChange`,
  `withStudioWrite`, `saveProjectRepo` (merge + push) and `hasPendingStudioChanges`,
  surfaced end-to-end through `GET /api/studio/projects/:id/repo-status`
  (`cli/bridge-studio.ts`) and `fetchRepoStatus` (`forge-ui/lib/studio-client.ts`).
  Forge's own repo gets none of it. This initiative closes the asymmetry — with
  three deliberate differences from the project-repo transaction, because forge
  core is not a forge-controlled, CI-free config file.
- **Features:**
  - **R3-09-F1 — Promotion runs in a temporary worktree, never the live checkout.**
    Promotion builds its branch in a `git worktree` off the tracked remote head,
    applies the object, commits, and removes the worktree. It never runs `git
    checkout` in the forge root. Two reasons, both already recorded in forge's own
    code: `isGitRepo` (`orchestrator/project-repo-tx.ts`) documents a caller
    moving an **ancestor** repo's HEAD by checking out a nested directory; and the
    forge root hosts a live `forge serve` scheduler and the Studio bridge, both
    reading that checkout. Acceptance: promotion leaves `git rev-parse
    --abbrev-ref HEAD` in the forge root unchanged; a promotion during an
    in-flight cycle does not disturb it; the worktree is removed on both the
    success and failure paths.
  - **R3-09-F2 — The terminus is an open PR. Nothing merges.** `saveProjectRepo`
    merges into the default branch precisely because project config is
    *"forge-controlled, non-structural"* and CI-free; forge core is neither. The
    promote route pushes a branch and opens a PR, authored with the operator's own
    identity and credentials, and stops. CI and human review are the gate.
    Acceptance: a promotion produces exactly one branch and one open PR; no code
    path in Studio can merge a forge PR; a test asserts the absence of a merge call
    on this path.
  - **R3-09-F3 — Classified and refused under dry-bridge.** The route is
    registered in `BRIDGE_ROUTE_CLASSIFICATION` (`cli/dry-bridge.ts`) as
    `classification: 'refuse'`, `action: 'git-remote'`, alongside
    `POST /api/studio/projects/:id/save-repo` and the recovery/requeue routes, so
    `FORGE_DRY_BRIDGE=1` refuses it with a typed 409 plus a JSONL event. The
    existing route-coverage drift-guard tests make this enforceable: an
    unclassified promote route fails the guard. Acceptance: the drift guard goes
    red if the row is removed; a dry-bridge run cannot open a PR; the refusal
    emits both the typed response and the event, never a silent skip.
  - **R3-09-F4 — Preview before push.** Promotion shows the operator the exact
    diff, the target branch name, and the files that will be included, and
    requires an explicit confirm. This is the affordance whose absence
    the wave-7 walkthrough findings record (retired M1-A) `library-14` and `community-19`
    both record for other real-acting buttons. Acceptance: the preview renders the
    real diff (not a summary of it) for a `_local/` object and for an uncommitted
    edit to a tracked path; cancelling leaves no branch, no worktree and no PR.
  - **R3-09-F5 — The write-time origin stamp, scoped to promotion.** Promotion
    stamps `origin: 'studio'` on the object it lands in the tracked root, and the
    shipped OOTB objects get `origin: seed` committed. This is the residue R3-08-F4
    cannot cover: once an object moves into a tracked root its root reads `ootb`,
    and the stamp is the only thing that preserves the fact an operator wrote it.
    Scoping the stamp to the promotion path — rather than to every Studio write —
    is what removes the reason it was deferred (a data-model change across the
    concurrently-edited `skills/` tree). Acceptance: a promoted object reads
    `operator` after promotion; `provenanceOfOrigin` is unchanged; the stamp is
    written by the promotion path only.
  - **R3-09-F6 — Path-sink hardening for the new derivations.** An operator-supplied
    object id becomes a filesystem read, a temporary worktree path, a branch name
    and a PR title. Branch names and worktree paths derived from an id are a new
    sink family. Load the `adversarial-containment-review` skill before building;
    extend `scripts/check-request-path-sinks.mjs` and re-baseline. Acceptance: the
    sink scanner covers the new families; the baseline does not grow un-classified;
    the escape-shape catalogue is exercised against the branch-name derivation.
- **Session sizing:** ~3 operator-run agent sessions — (1) F1+F2 the worktree
  transaction and the PR terminus; (2) F3+F6 the safety classification and the
  sink ratchet, with an adversarial review round (this is a real-acting route on
  the surface that once self-merged a forge PR); (3) F4+F5 the preview affordance,
  the origin stamp, and journey coverage.
- **Out of scope:** merging a forge PR from Studio, ever
  ([ADR 045](../decisions/045-operator-workspace-and-promotion.md) §D). Bulk or
  automatic promotion — one object, one PR, one operator confirm. A bot identity
  for forge. Publishing or distributing operator-authored objects to anyone else
  (R3-07 owns the community browser; R8-01 owns packaging). Promotion of
  `brain/` content, which is produced by cycles under
  [ADR 035](../decisions/035-forge-owned-central-artifacts.md) and is surfaced,
  not promoted, by R6-10.

## Deferred

No R3 deferred initiatives as of 2026-07-17 (the canonical skeleton mints
none). Two adjacent items are deliberately parked *outside* this roadmap
rather than deferred within it:

- **Physical `skills/` role-subfolder move** — stays tracked in
  [known-gaps §6](../known-gaps.md); its recorded revisit condition (a single
  shared `skillPath(name)` resolver) is delivered by R3-01-F1, after which the
  move is a separate one-place-change decision, not an R3 commitment.
- **Hook generation via the skill-generator flow** — noted in R3-03's
  out-of-scope; would only be considered after both R3-02 and R3-03 are
  implemented and the R3-03-F2/F3 protections have held in practice.

## Change log

- 2026-07-17 — Roadmap created (initial forge-dev roadmap planning session).
- 2026-07-17 — Adversarial-review amendment pass. R3-01-F1 extended to a
  three-function module incl. `listSkillDirs()` enumeration (A6 — the §6
  revisit condition needs lookup AND discovery); R3-01-F4 marketplace-install
  posture hardened to the draft→scan→operator-approve pipeline with
  frontmatter quarantine, content-hash pinning, and re-review on update
  (E5, operator decision 3 — third-party prompt-code never gets a weaker gate
  than forge's own generated drafts); R3-02 gained the soft R5-04 edge
  (edit-lock verification precedes a second live flow — E7).
- 2026-07-19 — **R3-01 F1+F2 implemented** (PR-B, branch `feat/r3-01-skills-library`; baseline **R3-B7**).
  F1 shared `skill-path.ts` resolver + the ~40-site sweep (grep-clean; `deriveAgentSpec` root-relative vs
  content-read absolute — the attribution split; §6 physical-move precondition now met, move untaken).
  F2 unified palette library: `listPlainSkills` ∪ catalog community-skills in the catalog GET (UI-created
  skills palette-visible, no restart — §4.11 closed), `library` explicit on all 24 + `validateLibraryFlag`
  lint, journey de-substitution. Opus whole-branch + security reviews clean (one Important — the
  POST-writes-`library` / discovery-honors-`library` coherence — fixed in-PR). **F3 (`/skills` view) + F4
  (marketplace) deferred** to the operator's §4b.1 design session. Mid-wave chore (PR #37) also slimmed the
  always-injected `CLAUDE.md` ~56% (DOM/harness reference → `docs/forge-ui-dom-and-harness.md`) to restore
  subagent fanout.
- 2026-08-03 — **Wave-5 cut (studio-endstate-v2 mockup → modular backlog).**
  Mission line gains connections + templates. **R3-01 F3/F4 re-enter
  `planned`** — the mockup campaign IS the reserved §4b.1 design (skill detail
  pages as file packages, unbound-until-Agent-Builder binding). **R3-03
  re-scoped per operator decision 1:** library hooks = agent-lifecycle
  customisations (PreToolUse/PostToolUse/SessionStart/SessionEnd/Notification
  + matcher + guard, host-agnostic, Agent-Builder-only binding); the
  forge-infra catalog entries reclassify as locked orchestrator "guards"
  outside the hooks library. **R3-04 amended:** pillar surfaces as
  "Connections" with per-connection detail pages (MCP capability lists, hub
  links, install state). **R3-06 minted:** templates library (demo outputs /
  planning artifacts / project-type scaffolds over the unified
  artifact-templates + demo-elements + starters registry). **R3-07 minted:**
  cross-kind community browser (hub strip, per-hub signals, pre-install
  detail, install routing through the owning kind pipelines). Every wave-5
  entry cites its mockup journey ids + `as-built-inventory.md` baseline.
- 2026-08-03 — **Adversarial-review corrections (PR #71 review pass).**
  R3-03 re-scope gains the guards-migration clause: the 9 catalog hook ids
  are dispatch-load-bearing (`composition.hooks` roster sweep, ADR-027
  authoring-field amendment, band-dispatch vocabulary update, spawn-capture
  parity ACs) — the module boundary move is recorded, not hidden. R3-06-F3
  scaffold vision-promotion recorded as deliberate (create-project flow is
  unwalkable without it). Dangling "(both)" acceptance-refs bullet folded
  into R3-06/R3-07 per-initiative.
- 2026-08-04 — **R3-01 F3+F4 implemented** (branch `feat/r3-01-skills-library`;
  baseline **R3-B8**). Real `/skills` library (local + community, derived
  `usedBy`, `composedBy` deleted per D3) + `/skills/[id]` package-detail page
  (read-only) + the draft→scan→approve→re-review trust pipeline
  (`orchestrator/studio/skill-library.ts` + `skill-install-ledger.ts` +
  `cli/bridge-studio-skills.ts`), D8's one creation entry point, and three new
  `skills` journey beats (`skills-library`, `skills-detail-package`,
  `skills-install-approve`) demoing the arc end to end against a package
  materialised outside the repo. Known gap carried forward (NOT closed by
  F3): `/skills/[id]` has no edit surface for an existing local skill's body
  (known-gaps §4b.8 stays open). A journey-found defect — `scanSkillPackage`'s
  `quarantinedKeys` could never report `runtime`/`allowed-tools` for a real
  installed draft, only ever `library` — was fixed in this same session: it
  now unions the keys found at the SKILL.md's top level with those already
  moved under its nested `quarantined:` block, deduped and ordered by
  `QUARANTINED_FRONTMATTER_KEYS`'s own declared order.
- 2026-08-04 — **R3-06 F1+F2 implemented** (branch
  `feat/r3-06-templates-library`; baseline **R3-B9**). One registry
  (`orchestrator/studio/template-library.ts`) unions `studio/artifact-templates/`
  (planning, 7), `studio/demo-elements/` (demo-output, 6), and
  `studio/starters/projects/` (project-scaffold, 2) into 15 library entries
  with DERIVED `usedBy` (real flow-graph edges for planning, real project
  `demoProcess` config for demo-output, honestly empty for project-scaffold)
  and producer/consumer endpoint verification against the flow graph. Real
  `/templates` + `/templates/[id]` routes (mirroring `/skills`'s shape) plus
  `GET /api/studio/templates(/:id)` (`cli/bridge-studio-templates.ts`). **Also
  folds in R2-05-F1's canonical-artifact-set audit** (shared substance,
  decided at session start per R3-06's own dependency note):
  `validateArtifactRef` promoted advisory → error; the flow builder's
  `ARTIFACTS` catalog drops its two orphan entries (`reflection`, `demo`) and
  is now pinned to the on-disk template set by a CI-enforced parity test (see
  R2-runnable-componentry.md's own change log for the R2-05-F1 residue this
  does NOT close). Four new `templates` journey beats
  (`templates-library`, `templates-search`, `templates-detail-planning`,
  `templates-detail-scaffold`). New `studio/artifact-templates/README.md`
  documents the canonical 7-template inventory. ADR-027 amended to record the
  promotion. **F3 (new scaffold kind + R4-03 consumption) stays planned** —
  this initiative surfaced the 2 pre-existing starters only; it minted no new
  scaffold content and built no create-project picker (the mockup's
  scaffold-picker beat is explicitly out of scope for this initiative's own
  browse→detail journey).
- 2026-08-04 — **R3-06 F3 implemented** (same branch
  `feat/r3-06-templates-library`; baseline **R3-B9** updated in place). The
  third mockup scaffold shape — `typescript-web` (web UI) — joins
  `typescript-api` (REST API) and `typescript-cli` (CLI/library) under
  `studio/starters/projects/`, completing the three canonical kinds; the
  registry now unions 7 planning + 6 demo-output + 3 project-scaffold = 16
  library entries (was 15). No new wiring was needed: `listProjectStarters`
  (`orchestrator/project-create.ts`) already scanned the directory with no
  hardcoded list, so `forge create`, `POST /api/studio/projects/create`, the
  `/projects/new` create-from-template form, and the templates library's own
  registry/detail page (F1+F2) all pick up the third scaffold automatically —
  confirmed by `project-create.test.ts`'s AT-46/AT-47 (discoverable; scaffolds
  to preflight HARD-green with every template token substituted). Reconciled
  in the same pass: `scripts/journeys/templates.mjs` now derives all four
  `/templates` counts from disk instead of pinning literals (a real registry
  change is caught by a changed derived number, never masked by a stale
  constant); `orchestrator/studio/registry.ts`'s `listArtifactTemplates` and
  `template-library.ts`'s `listPlanningEntries` exclude `README.md`
  case-insensitively (`/^readme\.md$/i`), closing a reviewer-found gap where a
  future `readme.md`/`Readme.md` variant carrying valid frontmatter would have
  become a phantom template; ADR-027 and `docs/forge-ui-dom-and-harness.md`'s
  registry-count claims corrected from 15 to 16, and ADR-027's stale
  "five seed templates" line corrected to the real seven
  (`review-findings`/`demo-fix-spec` were missing from that list). The
  templates library's own journey stays deliberately browse→detail only (no
  create-project action added from `/templates` itself). **Pre-wire
  enumeration deferred: the detail page shows the raw file tree, it does not
  enumerate contract pre-wiring.** Three of F3's four ACs are met outright
  (three canonical shapes ship; creating from a scaffold yields a
  preflight-green project; the picker consumes the registry with no hardcoded
  list); the fourth — "scaffold detail page lists what the contract pre-wires"
  — is met only inferentially, since a reader can see `.forge/project.json`,
  the gate and the CI workflow in the file tree but the page names no clause.
  Recorded as claimed-with-caveat rather than silently counted as complete.

- **2026-08-04 (R3-03, migration PR).** The re-scope's **migration clause**
  landed: `composition.hooks` is renamed to **`composition.guards`** and
  `composition.hooks` is deleted outright — no back-compat, no shim. Recorded
  as an amendment to [ADR 027](../decisions/027-studio-object-model.md)
  (approved before the sweep, per the ADR-first rule), with ADR 039's
  references corrected as a bounded factual cross-reference update. Landed in
  one no-back-compat sweep: a `guards:` catalog section replacing `hooks:`
  (same 9 ids — they are dispatch keys); the 16 roster SKILL.mds **plus the 3
  starter agents** under `studio/starters/agents/`, which the first pass
  missed and which would have broken new-agent-from-starter outright;
  `loadAgentDefinition` failing loud on a stale key (the `parseFlowTrigger`
  precedent) and `forge studio lint` surfacing it as a `load` error; a new
  `composition/guard-unknown` lint error threaded through the **real** lint
  entry point so the rule is not inert; and the agent builder's drop zone,
  palette, YAML preview and `readiness/guard` check. band-vs-toggle is
  **DERIVED** from `BAND_GUARD_IDS` — a `kind:` declared in the catalog file is
  ignored, pinned by a test that declares a wrong one. **Dispatch is
  byte-identical**, proven by an extended golden spawn-capture suite (2 of 4
  band pipelines before, now all four plus the generic one-shot option shape
  plus a dispatch decision table over all 16 on-disk definitions): the
  decision table and the generic option shape are unmoved to the byte. The
  four prompt captures shift by exactly one token, because the phase bindings
  embed the agent's own frontmatter verbatim into its prompt — measured
  character by character, one changed region per file, and re-pinned against
  that proof rather than regenerated on trust. F2/F3/F4 (the hooks library,
  its security scan and permission manifest) remain **planned** and are the
  follow-on PR; `composition.hooks` is re-introduced there with the
  lifecycle-hook meaning.

- **2026-08-04 (R3-03, library PR).** F1-F4 landed, completing the initiative.
  **F1:** a hook is a **file package** — `studio/hooks/<id>/hook.yaml` plus its
  scripts — generic and host-agnostic; the payload field is `script:` (not
  `guard:`, which this initiative had just finished disambiguating). A
  `hook.yaml` declaring any binding field is **rejected**, so "definitions land
  unbound" is structural rather than conventional; `carriedBy` is DERIVED from
  real agent specs and the derivation names its own scan. `composition.hooks`
  returns meaning library hook ids only, with **symmetric** enforcement in both
  directions, and `resolveBandGuard` still reads only `composition.guards` — so
  nothing in `composition.hooks` can reach dispatch, which was the whole reason
  for the rename. Two OOTB seeds ship (`pre-pr-security-review`,
  `post-merge-brain-ingest`). **F2:** a static scan over the script — egress,
  secret-shaped env reads, out-of-scope file reads, obfuscation — producing a
  real verdict (`blocked|findings|clean`), unlike R3-01's skill-install scan
  which deliberately refused one because prose is unscannable. Approval refuses
  a blocked verdict; only a separate **recorded override** flips runnability,
  and it leaves the verdict `blocked` — an override records a decision, it never
  launders a verdict. Declared behaviour is **downgraded but never hidden**
  (network only; a declared *env* grant has stayed critical since 2026-08-04,
  and since W8-B6 any critical finding blocks on its own).
  The approval hash covers the **script and the manifest**, so permissions
  cannot be widened without re-entering review. **F3:** deny-by-default
  execution via `HOOK_ENV_BASE_ALLOWLIST`, derived from `AGENT_ENV_ALLOWLIST` by
  subtraction so the two cannot drift. **F4:** `/hooks`, `/hooks/[id]` (file
  package + a visible SECURITY SCAN panel), `/hooks/new`, five bridge routes in
  one module, and Agent-Builder binding on a `[data-accepts="hook"]` zone
  distinct from `[data-accepts="guard"]`. New `hooks` journey (5 beats).
  **Stated limits, not overclaimed:** file writes are **ungoverned** (the
  manifest models `env`/`read`/`network`; F2 names four scan categories and a
  half-enforced fifth would be worse than a clearly-absent one), and
  `read`/`network` are declared and scanned but **not OS-enforced** — only `env`
  gets real prevention. Real enforcement means a process isolator, which
  [PRINCIPLES](../../PRINCIPLES.md)/CLAUDE.md forbid re-inventing. The scanner's
  string-concatenation obfuscation gap is documented by a test rather than
  hidden. Marketplace install remains **R3-07's** entry point, routed through
  this feature's scan + approval unchanged.
- **2026-08-04 (R3-04, connections library PR).** F1-F4 landed
  (baseline **R3-B10**). **F1:** `studio/catalog.yaml`'s 3 tools + 6 MCPs
  gained install/config/probe/provenance/capabilities metadata; `kind` is
  derived structurally (`tool`|`mcp`, D2 — no third invented kind); `install`
  is a 3-method discriminated union with `external` as a first-class honest
  answer (D13 — a curation research pass found `github`'s npm package
  deprecated, `fetch`'s npm name a security-research typosquat canary, and
  `sqlite`'s upstream archived, none reachable by a working npm install path).
  `forge studio lint` rejects an unpinned/range/`latest` version (D14) and a
  probe kind incoherent with its install method (D15). **F2:** a REAL
  per-entry prober (`not-installed`/`available`/`misconfigured`, D3/D4) run in
  its own child process on a stripped, credential-free environment (D11); an
  installer whose argv is derived ONLY from the catalog pin (D6) — a request
  body cannot influence it. **F3:** the run-block enforced at three real
  points — `orchestrator/run-agent.ts` pre-spawn, the bridge run route, and
  the Agent Builder's readiness panel (`[data-check="connections"]`) + Run
  control (`[data-run-blocked]`) — every enforcement point NAMES the unready
  component and its state. **F4:** exact version pins, real upstream
  provenance. Bridge (`cli/bridge-studio-connections.ts`) + client
  (`forge-ui/lib/connection-client.ts`) + UI (`/connections`,
  `/connections/[id]`) round out the surface; **D1's negative AC holds
  structurally** — no create/update/delete route exists anywhere, asserted
  against the real bridge dispatcher. New `connections` journey (4 beats).
  **F2's AC corrected (D16):** the `sqlite` round-trip example named at
  kickoff is unsatisfiable (no npm distribution, archived upstream) — moved
  to `memory`, evidence in the F2 bullet above. **Stated limits, not
  overclaimed:** two real kinds, not the mockup's three (D2); an MCP's
  capability list is curated catalog data, labelled as such, never a verified
  live list of a running server — forge has no MCP client to introspect one,
  and adding one is an ask-first dependency (D8); an `npm` entry's probe
  verifies the pinned artifact is present at the pinned version, not that the
  server runs (D15). Deletions: the falsified "reference-only" framing this
  PR's own baseline supersedes was already corrected in `studio/catalog.yaml`
  by WI-1's landing; this PR's own doc pass corrected the remaining stale
  claims in this file (R3-B2's connections clause, F2's AC, the wave-5
  amendment's `as-built-inventory.md` reference — that doc does not exist in
  this repo checkout, confirmed by grep).
- 2026-08-05 — **R3-07 implemented** (branch `feat/r3-07-community-browser`;
  baseline **R3-B11**). The ONE cross-kind community browser (skill/hook/mcp/
  tool) — `orchestrator/studio/community-index.ts` (D1: three sources, no
  fourth declared list), `community-install.ts` (routes to the owning
  ALREADY-MERGED pipeline, never a trust decision itself, D2),
  `cli/bridge-studio-community.ts`, `/community` + `/community/[kind]/[id]`.
  The community `CommunityInstallState` union carries a fourth member,
  `needs-review`, deliberately — a post-approval object that drifted must
  never be laundered into `installed` by a surface that owns no
  approve/override affordance of its own. No third-party bytes are vendored:
  the 9 catalog community-skills + 9 catalog connections are browsable with
  real detail pages but their bytes stay outside this repo, so
  installability is DERIVED from disk, never declared; the two packages this
  initiative actually vendored (`dependency-diff-review` skill,
  `block-protected-branch-push` hook) are forge-authored and attributed to
  the real `forge-seed` hub, never to a third party. No signal number is
  ever invented — an item with none reads "no signals published". There is
  no `cli` kind (D8) — a `clis:` catalog section would move ids out of
  `catalog.tools`, a dispatch-affecting migration `composition.tools`/
  `CatalogPalette` both key off, not a browse-surface addition. Deletion,
  named: `/skills`'s per-card manual install affordance (verified
  unexercised — zero journey beats, zero ATs — before removal); the
  capability moves to `/community`'s one cross-kind entry point unchanged.
  No new npm dependency, no live network fetch — the browsable index is a
  static curated seed, named as such, not a hub crawl. New `community`
  journey (`scripts/journeys/community.mjs`, 22 beats, wired LAST into
  `RUN_ORDER` — it installs a real skill and a real hook, so it must run
  after every journey whose own beats pin `/skills`/`/hooks`/agent-builder-
  palette counts). **Parity (R7-02-F3):** both `install-skills-hooks` and
  `install-connections` flip `pending` → `ported` — 13/13 and 10/12 (+2
  explicit `{excluded, decision}` on the fabricated `cli` kind) respectively;
  `npm run parity:stories` exits 0.
- 2026-08-15 — **Wave-6 docs-sync note.** R3-07 stays `implemented`; its
  status line gains a note on the CR-1..3 evolution (registry.yaml as the
  new source of truth, sorts + freshness honesty, the community-refresh
  agent) — the initiative's own F1-F3 acceptance criteria are unaffected.
- 2026-08-23 — **R3-08 and R3-09 minted** (planned) from
  [ADR 045](../decisions/045-operator-workspace-and-promotion.md), the wave-8
  ON-2 platform-round-trip design spike. R3-08 gives the library registries a
  second, gitignored `_local/` root and makes an object's root its provenance;
  R3-09 turns an operator edit into a branch and a PR against forge — never a
  commit on the operator's checkout, never a merge. Routed to R3 by
  `docs/roadmaps/README.md` §2's coverage map (*"Capability libraries — skills,
  hooks, tools/MCPs, instructions"*) and R3's own charter, which already names
  the library *machinery* (registries, resolvers, surfaces, protections),
  *"editable (where safe)"*, and *provenance* as its scope. These are the first
  specs for the standing findings `library-07` and `community-23` in
  the wave-7 walkthrough findings record (retired M1-A), which had no design home. The
  companion operator-facing surface is R6-10. Both new initiatives are **design
  only so far** — the wave-8 spike shipped an ADR, roadmap entries and beads by
  explicit operator decision, and no production code.
