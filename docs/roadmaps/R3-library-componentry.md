# R3 — Library componentry

> Make every reusable capability forge composes into agents — skills, hooks,
> tools/MCPs/CLIs, instructions — a first-class **managed library**: viewable,
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

## Planned initiatives

### R3-01 Skills first-class management

- **Status:** implemented (F1+F2, 2026-07-19, PR-B — see baseline R3-B7; **F3+F4 deferred** to the operator's §4b.1 session)  ·  **Wave:** 3
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

- **Status:** planned  ·  **Wave:** 4
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

### R3-04 Tools/MCPs/CLIs library

- **Status:** planned  ·  **Wave:** 4 (opportunistic — no R4 dependent)
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
- **Session sizing:** ~2 operator-run agent sessions — (1) F1+F4 registry
  metadata + lint; (2) F2+F3 surfaces + readiness wiring + journey-sync.
- **Out of scope:** create-your-own for this category (operator-excluded,
  permanently — larger components); the runtime-adapter *implementations*
  themselves (R2-06 owns realizing Gemini/Aider/etc. adapters; this library
  only presents/installs them); hook execution protections (R3-03).

### R3-05 Instructions library

- **Status:** planned  ·  **Wave:** 3 (must precede R4-02/R4-03 — Q6-A
  "interleaved at dependency points")
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
