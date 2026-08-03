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

**Status vocabulary:** implemented | in-progress | planned | deferred. All
initiatives in this file are planned/deferred as of 2026-07-17.

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
`security-review`, `skill-creator`, `agent-browser`, `output-compress`), **5
hooks** (`event-log`, `cost-guard`, `stall-watchdog`, `merge-gate`,
`scratch-strip`), **3 tools** (`git`, `node`, `gh`), **6 MCPs**
(`filesystem`, `github`, `playwright`, `fetch`, `memory`, `sqlite`) — MCPs
explicitly "reference metadata only — operators wire real servers in their
env". Catalog entries surface as draggable chips in the agent builder's
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

The 5 catalog hooks are display metadata mapping onto orchestrator-owned
implementations (JSONL event log, cost guard, stall watchdog, merge gate,
scratch strip — all inside `orchestrator/`). Agent definitions can carry
`composition.hooks` (parsed by `orchestrator/studio/registry.ts`, see
`registry.test.ts`), but there is no installable/creatable hook library, and
no security model for one — hooks execute in-harness with the harness's env.

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

## Planned initiatives

### R3-01 Skills first-class management

- **Status:** implemented (F1+F2, 2026-07-19, PR-B — see baseline R3-B7); F3+F4 re-entered `planned` 2026-08-03 (wave 5) — the studio-endstate-v2 mockup IS the reserved §4b.1 design (see the wave-5 re-entry note below); **F3+F4 implemented 2026-08-04 (branch `feat/r3-01-skills-library` — see baseline R3-B8)**  ·  **Wave:** 3 (F1+F2) / 5 (F3+F4)
- **Depends on:** — . **Depended on by:** R3-02 (landing-place), R3-03 (soft —
  hooks reuse the unified-registry + library-view pattern), R3-04 (soft — same
  surface pattern), R5-05 (skills-palette residue cross-references here, not
  duplicated).
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
    (peer of `forge-architect`/`forge-develop`/`forge-reflect`) whose single
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

- **Status:** planned (re-scoped 2026-08-03, wave-5 cut — see the re-scope
  block below)  ·  **Wave:** 5 (module: library-hooks)
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

- **Status:** planned (amended 2026-08-03, wave-5 cut — see the wave-5 note
  below)  ·  **Wave:** 5 (module: library-connections)
- **Depends on:** R3-01 (soft — reuses the unified-registry + library-view
  patterns).
- **Context:** Operator diagram (verbatim intent): *"Tools/MCPs/CLIs =
  similar but NO create-your-own (larger components)."* Baseline (R3-B2):
  `studio/catalog.yaml` ships 3 tools and 6 MCPs as reference-only metadata —
  "operators wire real servers in their env" — so today an MCP chip in the
  builder is a label, not a working binding. This initiative makes the curated
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
    then the probe). Acceptance: `sqlite` MCP round-trips
    not-installed→install→available; `git` shows system-provided/available
    with no install action; a misconfigured entry surfaces the failing probe
    output, not a generic error.
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
  baseline:** R3-B2 + `as-built-inventory.md` §7 (reference-only metadata,
  no install/probe, no detail pages).
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

- **Status:** planned  ·  **Wave:** 5 (module: community-browser)
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
