# ADR 027 — Forge Studio object model: definitions as data, filesystem registries

**Status:** Accepted — 2026-06-13. Implementation staged across the Studio
milestones (M0 schemas, M2 builders). Amends ADR 003/024 (agent definition),
ADR 018 (KB descriptor), ADR 010 (brain access becomes a per-agent field),
ADR 017 (project config extensions).

## Context

Forge is one flow definition compiled by hand into TypeScript. The Forge
Studio direction (mocks at `mockups/agent-flow-builder/`) requires Projects,
Agents, Flows, and Knowledge Bases as first-class, operator-editable objects.
The danger is a second source of truth: a registry that duplicates what
SKILL.md, `.forge/project.json`, and the brains already encode.

## Decision

Every Studio object is a **thin declarative layer over an existing proven
mechanism**, persisted as markdown/YAML on the filesystem, git-versioned,
written only through one canonical serializer module
(`orchestrator/studio/registry.ts`, gray-matter/js-yaml — the
`serializeManifest` rule generalised). No database, no parallel store.

1. **Agent = extended SKILL.md.** The agent definition IS the skill
   directory; frontmatter gains machine fields (`purpose`, `composition`
   {skills/tools/mcps/hooks}, `runtime` {sdk/strategy/model/range},
   `brainAccess`, `interactivity`, `budgets` {iterationFloor,
   maxTurnsPerIteration, wedgeKillMs}); the body keeps process intent.
   *(Amendment 2026-06-16: a `runtime.subagentModel` lever was de-cargoed — it
   had no spawn-site consumer, since forge does not yet spawn SDK subagents.
   Reintroduce it together with the first flow whose agent actually sub-spawns.)*
   `PhaseAgentSpec` becomes a derived view of this file. `hooks` name
   existing orchestrator behaviours (event-log, cost-guard, stall-watchdog,
   merge-gate, scratch-strip) — they toggle, they do not spawn.
2. **Flow = `studio/flows/<slug>/flow.yaml`.** Nodes reference agents by
   slug; edges carry artifact labels; nodes may declare `gate` (human),
   `fanOut` (runtime multiplicity from an upstream artifact), `resumable`.
   Flow-level `costCeilingUsd`, `triggers`, `version`. Semantics are ADR 028's
   concern; this ADR owns the format.
3. **Project = extended `.forge/project.json`**, staying in the project repo
   (portability, ADR 018): adds `northStar`, `instructions` (generalises
   `standing_work_item_acs`), `demoProcess[]` (typed capture/verify/present
   steps — closes the `demo.skill` known-gap), `skills[]`, `kb`. Forge holds no
   project registry file — projects are auto-discovered from disk
   (`<projectsDir>/*`, each carrying a `.forge/project.json`).
4. **Knowledge Base = `kb.yaml` descriptor over an existing brain**
   (id, name, scope: `project | flow | agent-integration`, desc). The graph is
   derived from the markdown wiki on disk; health stays `forge brain lint`. No
   new graph store.
5. **Catalog = `studio/catalog.yaml` + filesystem scan** for skills.
   Tools/MCPs/hooks/SDKs/models declared once with picker metadata
   (tier, cost). Read-only API; editing is a git change.
6. **Validation is server-side and load-bearing:** agent readiness checks,
   flow structural rules (acyclic, referenced agents exist, zero-human-gate
   flows rejected unless `disposable: true`), kb scope enum, catalog ref
   integrity. `forge studio lint` joins the standing gate set. The same
   validation runs at save (bridge PUT) and at spawn.
7. **Ids are slugs** validated at save; no client-generated ids.

## Consequences

- The six in-cycle agents migrate in place: SKILL.md frontmatter grows, the
  `*-invocation.ts` hardcoded specs become derived (M0 dual-source no-drift
  test, M2 single-source flip). The architect joins `PhaseAgentSpec` here,
  closing the last ADR 024 migration gap.
- Builder UIs (agent/project/flow/kb pages) are editors over these files via
  bridge CRUD routes — the filesystem stays inspectable and revertable with
  git, preserving the file-based operating model (ADR 007/011).
- One writer module means folded-scalar/regex frontmatter corruption (the
  `annotateManifest` incident) cannot recur for Studio definitions.
- Anything that wants a second representation of an agent, flow, project, or
  KB must amend this ADR first.

## Amendment (M8-0, 2026-06-14): KbBackend seam

ADR-027 §4 made the KB a `kb.yaml` *descriptor*, but every read still went
straight to `brain/<kbId>/` on disk (`kb-graph.ts`), so the descriptor was a
label, not a swap point. M8-0 introduces the backend seam (`orchestrator/
kb-backend.ts`):

- **`KbBackend` interface** — bound to one kbId; `buildGraph`, `getNodeArticle`,
  `listPendingGuidance`, `deleteGuidanceFile`, plus `search(query)` (a graph-
  memory backend's native strength).
- **`FilesystemKbBackend`** — the default, a pure delegation to the existing
  `kb-graph.ts` functions (zero behaviour change). `search` is title-substring
  ranking (the honest filesystem floor).
- **`getKbBackend(forgeRoot, kbId)`** — resolves the backend from the `kb.yaml`
  descriptor. The descriptor is the selection seam: a future `backend:` field
  routes to a registered non-FS backend. `kb-backend.test.ts` is the contract
  test (the KB analogue of the RuntimeAdapter conformance suite, ADR-029).

This is the swap surface for memory: the seam exists and is exercised in
production, but only the `FilesystemKbBackend` ships. A future graph-memory
backend would implement the same `KbBackend` interface and register in
`getKbBackend`; none is shipped — the descriptor's `backend:` field is the
selection point such a backend hangs off. The bridge KB routes
(`cli/bridge-studio-kbs.ts`) read through `getKbBackend` rather than calling
`kb-graph.ts` directly, so the reroute point is already in place.

Next surface (not in this commit): the **planning-context** read — PM/reflector
load the brain navigation index via `loadBrainIndex` (a separate module,
duplicated as `loadBrainNavigation`). Routing that through `KbBackend` is the
higher-value but riskier reroot; it gets its own change so the brain's
*planning* influence is also backend-swappable.

## Amendment (2026-06-15): Artifact as a typed contract

ADR-027 §2 made the inter-node artifact a **bare string label** on `FlowEdge.artifact`
(`plan`, `work-items`, `wi-branches`, `pr`, `verdict`). The label is an implicit
filesystem convention: nothing declares what the artifact must contain, and a node that
fails to produce it surfaces as downstream *agent confusion* rather than a clean
orchestration error. The community converged on typed artifacts (GitHub Spec-Kit's
artifact trail, Google A2A's typed `Artifact`, AWS Kiro's requirements/design/tasks
files).

The Artifact object type gains an **optional declarative template** (one canonical writer,
same as every other Studio object):

- **`ArtifactTemplate` = `studio/artifact-templates/<id>.md`** — gray-matter frontmatter
  (`id` matching the edge label, `name`, `kind` ∈ `file | git-state`, optional `producer`/
  `consumer`, a `schema` block of `requiredFiles` / `requiredFields` / `gitInvariants`) plus
  a prose contract body. Loaded by `registry.loadArtifactTemplate` /
  `listArtifactTemplates`; validated by `validateArtifactTemplate`.
- **`validateArtifactRef(flow, templateIds)`** — every `FlowEdge.artifact` SHOULD resolve
  to a registered template. Advisory (flag) for now so existing flows are not broken;
  promotable to an error once all seed flows ship templates. Joins `forge studio lint`.
  **Promoted to an error 2026-08-04** (R3-06/R2-05-F1) — see the amendment below.
- **Runtime guard (implemented 2026-06-16, `orchestrator/flow-artifacts.ts`):**
  `assertInboundArtifacts` runs before each node in `flow-runner.runFlow` and turns a
  missing/empty inbound artifact into a clean `flow-runner.artifact-missing` error at the
  boundary (`git-state` artifacts are skipped — their invariants live in the unifier's
  close-contract gates; the `reflect` node is exempt — its inbound `verdict` is produced by
  the async human gate). The human `verdict` is persisted as
  `_logs/<cycleId>/artifacts/verdict.json` (`writeVerdictJson`) at the decision point — the
  bridge `applyReviewVerdict` on an operator approve/send-back, and `finalize-merged` on a
  silent GitHub merge — so the reflector has a durable record.

The seven seed templates (`plan`, `work-items`, `wi-branches`, `pr`, `review-findings`,
`verdict`, `demo-fix-spec`) document the contracts the current cycle already relies on.
`wi-branches` is `kind: git-state` (the artifact is commits on a branch, not a file).

## Amendment (Stage C, 2026-06-27): per-flow `kickoff`

`FlowDefinition` gains an optional `kickoff: { kind: 'idea' | 'initiative-select'
| 'trigger-only' }`. It is a **format** concern owned by this ADR (parsed in
`registry.ts`, enum-validated in `validate.ts`, round-tripped by
`serializeFlowDefinition`); the launch *semantics* — which surface the UI renders
and how a run starts — are ADR 028's. Seed flows: `forge-architect` = `idea`
(NewIdeaBox → architect), `forge-develop` = `initiative-select` (planned-initiative
picker → develop), `forge-reflect` = `trigger-only` (no manual launch; fired by a
declared trigger). Absent ⇒ the generic launcher (back-compat for any flow without
the field).

## Amendment (R1-01, 2026-07-19): kb.yaml serializer + binding

§4 made the KB a `kb.yaml` *descriptor* with a loose `scope: project | flow |
agent-integration` enum and no serializer ("kb.yaml is hand-edited; no
serializer by design" — the §5 reference in the original registry.ts comment
was itself a mislabel: kb.yaml is §4, not §5, which is the Catalog). R1-01
promotes it from descriptor to **contract**:

- **`scope` is dead — no back-compat.** Replaced by a mandatory `binding`:
  `{ kind: 'flow', ref: <flow-id> } | { kind: 'project', ref: <project-id> } |
  { kind: 'unique' }`. `binding` names the OWNING flow/project (the
  accrual/bootstrap identity); `unique` is the single sanctioned unbound KB
  (forge-dev), lint-enforced to exactly one across the roster. `cli/
  studio-lint.ts` additionally cross-checks a `flow`/`project` `ref` against
  the registered flow ids / discovered project ids (`check: 'binding-ref'`) —
  a dangling ref is now a lint error, not a silent typo.
- **A four-obligation `processes` block, optional in the file.** `lint /
  ingest / consolidate` each resolve to `{builtin: <name>} | {cmd: <string>}`;
  `usage` is a typed policy (`readSurface`, `readers[]`), NOT builtin-or-cmd.
  Absent ⇒ `resolveKbProcesses()` supplies binding-derived defaults
  (`deriveKbUsageDefaults` follows the ADR-010 asymmetric brain-read policy:
  planners + reflector always; `project`-bound KBs additionally advisory-
  readable by dev-loop/reviewer). This amendment *declares* the contract; it
  does not execute `cmd`-form processes — the built-in defaults are the
  shipped path.
- **`serializeKbDescriptor` now exists**, mirroring `serializeFlowDefinition`
  (explicit key order, `yaml.dump(..., { lineWidth: 120, quotingType: '"',
  forceQuotes: false })`) — superseding the "no serializer by design" rule for
  kb.yaml specifically (§5's Catalog is unaffected; it still has none). The
  KB-create route (`POST /api/studio/kbs`) and the project-brain
  seed/commit paths (`orchestrator/project-brain-seed.ts`,
  `project-brain-builder-runner.ts`) now write through this one canonical
  serializer instead of hand-rolled `yaml.dump`/template-string YAML.
- **Migration (one-shot, no legacy path):** the 6 existing descriptors
  (`brain/forge-dev`, `brain/cycles`, `brain/projects/{trafficGame,mdtoc,
  terraform-provider-betterado,gitpulse}`) were rewritten in place —
  `forge-dev`'s `agent-integration` → `{kind: unique}` (and the
  `agent-integration` enum member dies with it); `cycles`'s `flow` → `{kind:
  flow, ref: forge-develop}`; the four project brains' `project` → `{kind:
  project, ref: <own-id>}`. The three seed flows' `kb: cycles` read grants
  (`studio/flows/{forge-architect,forge-develop,forge-reflect}/flow.yaml`)
  were left untouched — they are a separate read-grant mechanism, not the
  binding.

## Amendment (R4-01-F1, 2026-07-24): budget-cap fields + hook band keys

[ADR 039](./039-ships-as-artifact.md) (ships-as-artifact) extends two of this
ADR's §1 agent-definition fields as part of its R4-01-F2 dispatch-seam design:

- **`AgentBudgets` gains `maxTurns`, `maxBudgetUsd`, `maxBudgetUsdShare`** —
  cost-bounded caps alongside the existing `iterationFloor`/`iterationCap`/
  `maxTurnsPerIteration`/`wedgeKillMs` fields, resolved generically as
  `max(maxBudgetUsd, maxBudgetUsdShare × initiative cost budget)` so a
  migrated phase agent's cost ceiling is declared data, not a per-phase
  constant hand-coded in `orchestrator/`.
- **`AgentComposition.hooks` gains band keys** (`wi-contract`, `reflection-close`)
  alongside the existing toggle-style hook names (event-log, cost-guard,
  stall-watchdog, merge-gate, scratch-strip). A band key selects an
  orchestrator-implemented pre/post pipeline — the PM work-item contract
  pipeline, the reflector close pipeline — rather than toggling one behaviour.
  See ADR 039 for the honest caveat that the pipelines themselves stay
  platform code; only the selection mechanism becomes declared data.

Format only; ADR 039 owns the semantics and sequencing (R4-01-F2).

## Amendment (R2-04 / ADR-041, 2026-07-25): trigger declarations reshaped

The flow `triggers:` schema changes from the loose `{on, flow}` pair to a typed
declaration ([ADR 041](./041-trigger-kind-registry.md) owns the semantics):

- **`on`** must be a `TRIGGER_KINDS` registry id (`flow-complete` —
  renamed from `complete` — `agent-complete`, `merged`, `manual`, `cron`,
  `webhook`, `feed`); reserved kinds are accepted at parse, rejected at lint.
- **`target: { kind: flow | agent, ref }`** replaces `flow:` — agent targets
  are the R4-09 standalone-reflect extension (schema + lint now; dispatch seam
  throws until R4-09 wires it).
- **Per-kind config blocks** — `schedule`/`concurrency` (cron only),
  `webhook: {id, provider, events, secretEnv, secretEnvPrevious?, sources}`
  (webhook only) — enforced coherent by the `trigger-*` lint family.

One-shot migration: the seed files moved to the new shape in the same change;
`parseFlowTrigger` fails loud on a stale `flow:` key (no back-compat parsing).

## Amendment (R3-06 / R2-05-F1, 2026-08-04): `validateArtifactRef` promoted to error

The 2026-06-15 amendment above left `validateArtifactRef` advisory "promotable to an
error once all seed flows ship templates." That condition is now met: all four real flow
edges resolve to on-disk templates — `forge-architect`'s `plan`; `forge-develop`'s
`wi-branches`, `pr`, and `review-findings` — and `forge studio lint` reported zero
`artifact/no-template` findings on the pre-promotion base. `validateArtifactRef` is now a
hard **error**, not a flag: an edge naming an unregistered artifact fails lint outright.

Alongside the promotion, Studio's **template library** (R3-06) now indexes these artifact
templates as one browsable pillar (`/templates`, `/templates/[id]`) together with demo
elements and project scaffolds — `orchestrator/studio/template-library.ts` unifies
`studio/artifact-templates/` (`planning`), `studio/demo-elements/` (`demo-output`), and
`studio/starters/projects/` (`project-scaffold`) into one 16-entry registry, with each
entry's `used-by` **derived** from the real flow graph (planning) or real project configs
(demo-output) rather than hand-maintained. See `studio/artifact-templates/README.md` for
the canonical 7-template inventory and which are edge-backed vs. travel by
orchestrator-band re-entry.

## Amendment (R3-03, 2026-08-04): `composition.hooks` splits into `guards` + `hooks`

The 2026-07-24 amendment above let **band keys** (`wi-contract`,
`reflection-close`, later `demo-band`, `review-band`) share
`composition.hooks` with the **toggle-style** orchestrator behaviours
(`event-log`, `cost-guard`, `stall-watchdog`, `merge-gate`, `scratch-strip`).
Both are orchestrator-owned and neither is operator-authorable, so one field
was defensible.

R3-03's wave-5 re-scope (roadmap `R3-library-componentry.md`, operator
decision 1) breaks that premise: a library **hook** becomes an
*agent-lifecycle customisation* — `{id, name, description, lifecycle event
(PreToolUse | PostToolUse | SessionStart | SessionEnd | Notification | …),
matcher, script, permission manifest}` — **authored by an operator or
installed from a community hub**, i.e. user-supplied data with a user-chosen
id. All nine ids currently in `composition.hooks` are neither: they name
platform machinery whose implementation stays in `orchestrator/`.

Two disjoint vocabularies must not silently share one field. Concretely:
`resolveBandGuard` (`orchestrator/agent-bands.ts`) scans the array and routes
the node to another agent's canonical pipeline. If a user-authorable hook id
landed in the same array, an operator (or an installed community package)
choosing the id `wi-contract` would **hijack flow dispatch** — the
declared-data hazard class this repo already pays for elsewhere, and a
constraint that is correct for shipped data being wrong for user-authored
data (the R3-06 `every`-vs-`some` lesson).

**Decision — split the field; no back-compat, no shim.**

1. **`composition.guards: string[]`** — the platform vocabulary. Holds the
   nine existing ids **unchanged** (ids are dispatch keys; renaming one would
   change dispatch, which the golden spawn-capture suite forbids).
   `composition.hooks` is **deleted** in the same change; a SKILL.md still
   carrying `hooks:` fails `forge studio lint` outright rather than being
   silently read.
2. **`composition.hooks: string[]` is re-introduced by R3-03's library PR**
   meaning *library lifecycle hook ids only*, resolved against the hooks
   registry (`studio/hooks/<id>/`). It is **bound only in the Agent Builder**;
   a hook definition never names an agent (round-4 mockup rule — "carried by"
   derives from agent specs).
3. **Symmetric enforcement.** Once both fields exist: a guard id under
   `hooks:` is a lint error, and a hook id under `guards:` is a lint error.
   Both directions, because a one-directional check is the half-guard this
   repo has been bitten by before ("defense-in-depth lint must mirror the
   dispatch it backstops").
4. **`studio/catalog.yaml`'s `hooks:` section is deleted and replaced by
   `guards:`** with the same nine entries. Whether an entry is a *band*
   (selects a pipeline) or a *toggle* (switches one behaviour) is **DERIVED**
   from `BAND_GUARD_IDS`, not declared — no new declared field is introduced.
   Guards remain read-only/locked in the palette: they are composable onto an
   agent, never editable from Studio.
5. **The rename is provably behaviour-free.** `orchestrator/test-fixtures/
   spawn-capture/` is extended from two fixtures to the full roster — all four
   band pipelines' `{prompt, options}` spawn calls, the generic one-shot
   option shape, and a dispatch decision table (agent slug → resolved band,
   canonical slug, loop strategy, selected executor) over the real on-disk
   roster. The table pins the resolved **decision**, never the raw array, so
   the field rename is invisible to it while any real dispatch change is not.
   The migration's acceptance is an empty diff on those fixtures.

**Consequence for ADR 039 — factual cross-reference correction tracking this
amendment; decision unchanged.** ADR 039 §2's third bullet, its item-3 caveat,
and its ADR-027 cross-reference name `composition.hooks` as the band-selection
field; that is now `composition.guards`. The *decision* ADR 039 records is
untouched — band selection is still declared data on the agent definition, the
pipelines are still platform code, and the honest caveat still stands. Only the
field name changes, corrected in place with a pointer here.

**Stated limit, not overclaimed.** This split removes the *id-collision*
hijack path. It does not make band selection safe against an operator editing
`composition.guards` directly — that remains guarded by the existing
`composition/band-guard` lint plus `execAgent`'s runtime slug backstop, which
are unchanged by this amendment.

## Amendment (R2-10, 2026-08-05): the session kind as a typed studio object

**Wave-5 R2-10 mints a new first-class studio object type: the *session kind*,
declared in a git-tracked `studio/session-kinds.yaml`.**

Before this, an interactive agent session was not an object at all — it was a
hand-written Next.js page. Three of them existed (the architect interview,
`/instructions/[sid]`, `/project-brain/[sid]`), each re-deriving its own phase
layout, its own polling, and its own artifact presentation. Adding a fourth
interactive agent meant writing a fourth page. The R2-10 spec's shared session
shell needs a per-kind descriptor to adapt to, and this ADR is where object
types are declared, so the descriptor lands here as data — not as a code
constant — for the same reason every other studio object is data: it is
lintable, greppable, and diffable, and it is what lets R4-15/R4-16/R4-17 add a
session kind by editing a YAML file plus one renderer instead of adding a page.

1. **`studio/session-kinds.yaml` is the registry.** Each descriptor declares
   `id`, `agent` (the SKILL.md-backed agent it surfaces), `title`,
   `legacyRoutes` (the pre-shell paths kept as redirects), `stages`,
   `defaultStage`, and `artifact: {kind, label}`.
2. **Two closed vocabularies.** Stages are
   `contract | instructions | secrets | demo | roadmap | brain`; artifact
   renderer kinds are `roadmap-draft | markdown-draft | brain-structure` **live**
   plus `file-package | contract-buildout | generation-gallery` **reserved**.
   Reserved rows parse but are a `forge studio lint` **error on use**, with zero
   stubs behind them — the shipped `TRIGGER_KINDS` precedent (ADR 041 / R2-04).
3. **A descriptor declares an ordered subset; `defaultStage` must be a member of
   its own `stages`.** A turn carrying no stage marker takes `defaultStage` — a
   *declared* value read from the descriptor, never a value hardcoded in the
   derivation. A turn carrying a stage **outside** the kind's declared list is an
   error that names the offending value and the allowed set; it is never
   defaulted, never dropped, never smoothed into a success.
4. **Turns are DERIVED from the runners' existing checkpoint files, and the
   derivation names itself.** No chat transcript exists on disk and none is
   invented: every turn is sourced from a real file (`idea.md`, `prompt.md`,
   `answers.json#round-N`, `questions.json`, `feedback.md`) and carries that
   source, and the result carries the full list of sources scanned, so an empty
   transcript reads "scanned N sources, none found" rather than rendering empty.
   The per-runner phase machines are untouched — this is the UI-side convergence
   R2-01-F3 deliberately deferred server-side.
5. **Three enforcement points, not one.** `forge studio lint` over the shipped
   descriptors; the transcript derivation, which is the only path the shell gets
   turns and which fails closed; and the shell itself, which renders the failure
   as a first-class state rather than falling back to a stage. A vocabulary
   enforced at one point is decoration.

**Stated limit, not overclaimed.** All three session kinds shipping with R2-10
are single-stage (`architect → roadmap`, `instructions → instructions`,
`project-brain → brain`). The multi-stage product instance — onboarding's
`contract → instructions → secrets → demo → roadmap` — lands with **R4-17**. So
the staged-artifact machinery is proven here by unit and view-state tests over a
multi-stage fixture descriptor and by lint over the real shipped descriptors, not
by a shipped multi-stage session. `brain` was added to the vocabulary because the
project-brain kind ships now and none of the onboarding five honestly describes
seeding Brain 3; mapping it onto `contract` would have been a fabricated mapping.

## Amendment (R2-09, 2026-08-05): `materials:` — the agent's allowed-input declaration

**Mechanical/factual; decision unchanged.** Both halves of this amendment track
as-built fact against decisions this ADR already took: the field below is the one
`docs/roadmaps/R2-runnable-componentry.md` R2-09-F1 specifies, and the serializer
section records bringing the code back to this ADR's existing
one-canonical-serializer mandate. No decision is taken, reversed or re-opened
here. (T1 pre-ratified on that basis, 2026-08-05.)

The agent's authored frontmatter gains **one optional field**, `materials:` — a
list drawn from a **closed four-kind vocabulary**
(`images | documents | audio | data-files`) declaring which kinds of input a run
of this agent may be given. It sits at the top level of the frontmatter
alongside `fanout:`, not inside `composition:` (composition names the
*components an agent is built from*; materials names the *inputs a run may
attach* — different lifetimes, different authors, different consumers).

Format and enforcement, following the amendments above:

1. **Closed vocabulary, owned in one place.** `orchestrator/studio/materials.ts`
   holds the kinds; the loader, `forge studio lint` and the capability
   descriptor all import from it, so the vocabulary cannot drift into a second
   representation.
2. **Shape errors throw at load; value errors are lint errors.** A non-list
   `materials:` (or a non-string entry) is unrepresentable and fails the load,
   exactly as `composition:` does. An unknown *kind* is a
   `materials/enum` **error** naming both the offending value and the allowed
   set — the `surface/enum` shape — because a bad value must never take
   `forge studio lint` itself down for that agent.
3. **Absent and empty both mean "accepts nothing".** There is no
   "undeclared ⇒ allow all" arm anywhere. The two states stay distinguishable on
   the definition (undeclared vs declared-empty); only the gate collapses them.
4. **The enforcement point is named, and the gate ships with the field.**
   Materials enter the system at the kickoff/run upload seam, which lands with
   **R6-04-F2**. That is a later batch, so this amendment ships the gate itself —
   `agentAcceptsMaterial(def, kind)`, fail-closed, answering from
   *vocabulary ∩ declaration* rather than from the declaration alone — precisely
   so the consuming surface cannot mint a permissive gate of its own. The
   descriptor (`AgentCapabilityDescriptor.materials`) likewise filters
   non-vocabulary values, so a definition that somehow evaded lint still cannot
   advertise a capability on the wire.

**Stated limit, not overclaimed.** `agentAcceptsMaterial` has **zero production
callers** until R6-04-F2 wires the upload seam to it, and **no shipped roster
agent declares `materials:`** — declaring one today would be an unenforced
capability claim against an upload UI that does not exist. Both are deliberate:
the vocabulary, the lint and the fail-closed gate exist first so the consumer
inherits a contract instead of inventing one.

### The write path is now byte-faithful, and that is a prompt guarantee

The same initiative corrects the canonical serializer this ADR mandates.
`serializeAgentDefinition` re-built the whole frontmatter from a projection, so
saving an agent through the builder destroyed YAML comments and key order, and
it rewrote any body line beginning `---` into en-dashes. `skills/developer-ralph`
and `skills/project-manager` both carry such lines, and **five phase bindings
plus the release finalizer read the whole SKILL.md verbatim into the agent's
system prompt** — so a lossy save was a *prompt* change, not file churn, and it
also broke this repo's standing "every artifact is human-editable at any
boundary" property.

The serializer now keeps the **original frontmatter bytes verbatim whenever the
frontmatter data is semantically unchanged**, replacing only the body region,
and falls back to the full re-serialize only when a field actually changed. The
body mangling is deleted — a body containing `---` (including as its first line)
round-trips with byte-identical content and unchanged frontmatter data, which is
pinned by a test rather than assumed. The one-canonical-serializer rule is
unchanged: the choice lives *inside* the serializer, not at its call sites.

**"Semantically unchanged" has one precise rule, and it is load-bearing:** for
the purpose of that comparison only, **an absent optional array key and an empty
array are the same state** — `composition.*`, `materials`, `runtime.range`,
`allowed-tools`, `disallowed-tools`. This is not a convenience. The loader and
the bridge merge both turn an absent optional array into a concrete `[]`, and
the builder sends every such field on every save, so without this rule the
projected data diverges from a file that simply omits the key and the
byte-faithful path never fires at all — which is exactly what happened on the
real UI path until a live journey beat caught it (`materials: []` and
`runtime.range: []`, neither declared by any roster agent). The rule governs
only what is **compared**, never what is **written**: a genuine change in either
direction still forces the full re-serialize and still persists. **Any future
optional array field added to this object model must be added to that rule**, or
it silently re-breaks the guarantee for every agent that does not declare it.

## Amendment (R2-08, 2026-08-07): `projects:` — per-project trigger scoping

**A decision is taken here.** Unlike the R2-09 amendment above, this one adds a
field that did not previously exist in any form and changes what a trigger
declaration *means*, so it is a genuine amendment rather than a factual
catch-up. Park-point: drafted by the R2-08 orchestrator, ratified by T1 before
the field ships.

### The problem this closes

A trigger declaration is flow-level and has no project dimension
(`orchestrator/flow-trigger.ts`, the R2-04/ADR-041 shape above). Every shipped
flow declares `project: null` (`studio/flows/*/flow.yaml`) — flows are
cross-project by construction, and the *only* production trigger declaration in
the repo is forge-develop's `{on: merged, target: {kind: agent, ref:
reflector}}`. So a `webhook` or `merged` trigger fires for **whatever project
the event resolved to**, with no way to say "this one is for gitpulse only".
The end-state mockup requires exactly that distinction — `demo-runner`: *"PR
merged → refresh demo artifacts, per-project: betterado, gitpulse"*;
`issue-triage`: *"issue raised → triage sweep, per-project: gitpulse"*
(`mockups/studio-endstate-v2/data.jsx` `TRIGGERS`).

### The field

A trigger declaration gains **one optional field**, `projects:` — a list of
project ids scoping which projects' events may fire this trigger. It sits at
the top level of the trigger row alongside `on` and `target`, not inside a
per-kind config block, because it is kind-independent: every kind resolves to a
project or to nothing, and the scope means the same thing for all of them.
**(Corrected 2026-08-07 — see the addendum at the end of this amendment: one kind,
`merged`, is excluded, so "every kind" above is not literally true as shipped.)**

```yaml
triggers:
  - on: pr-merged
    target: { kind: agent, ref: demo-runner }
    projects: [betterado, gitpulse]
```

Following the amendments above:

1. **Absent means unscoped; declared-empty means nothing fires.** The two
   states stay distinguishable on the definition and are **not** collapsed.
   `projects: []` is a coherent operator statement ("scoped, currently to no
   project") and must not silently mean "all projects" — that is the
   declared-data-fails-open shape this campaign keeps finding. Absent is the
   pre-existing cross-project behaviour and stays the default so no shipped
   declaration changes meaning.
2. **The dispatch point is the enforcement point; lint is defense in depth.**
   The scope is enforced where a staged request is dispatched, and
   `forge studio lint` reads **the same evidence the dispatcher reads** — the
   declaration's `projects` list against the same project enumeration. Lint is
   a second opinion on a decision the runtime already makes for itself; it is
   never the only place the scope is honoured.
3. **An out-of-scope event is a typed skip, never a silent drop.** The drain
   emits a distinct, observable outcome for "resolved project is outside this
   trigger's declared scope" — a first-class status alongside the existing
   `skipped-concurrency` / `skipped-no-initiative` rows, not a `continue`. A
   silently-broadened or silently-narrowed lookup under unattended execution is
   the blast-radius antipattern recorded in
   `brain/cycles/themes/silent-auto-discover-fallback-blast-radius.md`.
4. **An unknown project id is a lint error, and a resolution miss fails
   closed.** `forge studio lint` errors (the `surface/enum` shape used
   throughout this ADR) when `projects:` names an id the project enumeration
   does not contain. At runtime, an event whose project cannot be resolved does
   **not** fall back to "any project" or to "unscoped" — it skips, typed. There
   is no "undeclared ⇒ allow all" arm and no auto-discover arm anywhere.
5. **A project id from an external payload is matched, never resolved into a
   path.** ADR-041 §5 already forbids external text reaching id/path space
   ("initiative ids for minted runs are generated from validated tokens only").
   `projects:` extends that invariant rather than opening a hole in it: the
   scope check is an **identity comparison against the declaration's own
   list**, whose members are themselves validated against the project
   enumeration. A payload-derived project id is never concatenated into a root,
   never used to construct a filesystem path, and never widens the declared
   set. (`adversarial-containment-review`'s root-folding and cross-object-alias
   shapes are the two this rule is written against.)

### Registry rows added in the same initiative (mechanical — ADR-041 §1 already decided this)

R2-08-F3 adds `pr-merged` and `issue-raised` as `TRIGGER_KINDS` rows over the
existing webhook receiver. Adding a row **exercises** ADR-041's registry-as-data
decision rather than amending it, so no decision is re-opened. It is recorded
here only because the R2-04 amendment above enumerates the vocabulary inline,
and an un-updated enumeration in an ADR is a stale claim. `agent-complete`
(R2-08-F2) likewise flips `status: reserved → shipped` within the row model
ADR-041 §1 already defines.

### Run-model trigger provenance (R2-08-F4) is derived, not stored

A run exposes `trigger: {kind, source, scope}` — the registry kind, the
declaration that fired (a definition id, never operator prose), and the
resolved project id (or `null` when unscoped). It is **derived, never stored and
never authored** — consistent with [ADR 008](./008-jsonl-event-log.md)'s
one-source-of-truth rule (the event log is written once; readers aggregate from
it): no new stored run object, no free-text field an agent or a surface can
author.

The derivation source differs by kind, because the kinds differ in whether a run
is minted at all — recorded here precisely so the contract is not read as
claiming a single mechanism it does not have:

- **`cron` · `webhook` · `agent-complete`** originate a NEW run, so provenance
  derives from the **staged request** that minted it.
- **`flow-complete` · `merged`** mint nothing — chaining repoints the *same*
  initiative and `merged` dispatches inline within the merged cycle — so
  provenance derives from the already-shipped **`*.trigger-firing` event**
  (`orchestrator/flow-runner.ts`, `orchestrator/finalize-merged.ts`), whose
  `metadata: {on, target, source_flow}` carries exactly the closed triple's
  inputs.

Both sources are machine-written data; neither is prose. This is a factual
correction to this amendment's own earlier wording ("derived from the staged
request"), which was accurate for three of the five shipped kinds and would have
been a stale claim for the other two. **The decision is unchanged** — provenance
is derived, is a closed triple, and has no prose member. The `data-*` vocabulary is named by R2-08-F4 and attached
by the consuming surfaces (R6-04-F2 kickoff, R6-01-F4 run detail, R6-05/R6-06
ledgers) — this ADR records only that the shape is a closed triple with no
prose member.

### Addendum (2026-08-07): `on: merged` is EXCLUDED from `projects:` scoping

**Mechanical corollary; records an exclusion, takes no new decision.** This
addendum exists because the amendment above asserts the scope field "is
kind-independent: every kind resolves to a project or to nothing" — and as
shipped, that sentence is **false for one kind**. Correcting it rather than
leaving it is the point: an ADR carrying a claim its own implementation does not
honour is the failure this project keeps paying for.

**The fact.** Rule 2 above names the **dispatch point** as the enforcement point,
and every trigger kind reaches dispatch by staging a claimable `FlowRunRequest`
that `drainFlowRunRequests` then scope-checks — except `merged`. `on: merged`
dispatches **inline** from `orchestrator/finalize-merged.ts` via
`resolveMergeAgentHandler`, never touching the staged-request seam, so the
enforcement point never sees it. A `projects:`-scoped `on: merged` trigger would
therefore be silently unenforced.

**What ships instead.** `forge studio lint` **errors** when `projects:` is declared
on an `on: merged` trigger. The gap is made *unauthorable* rather than left
silently fail-open: an operator cannot declare a scope that would not be enforced.
No product story is blocked — the per-project merged story in the end-state mockup
(`demo-runner`: "PR merged → refresh demo artifacts, per-project: betterado,
gitpulse") is the **`pr-merged`** kind, which originates through the webhook
receiver and IS drain-enforced. `on: merged` is the internal reflect-chain trigger
and has no per-project story.

**Why it was not simply wired.** Wiring `finalize-merged`'s inline closure is a
small change, and it was deliberately refused. It would have been the third
per-mechanism patch of one class: the scope guarantee is asserted **globally**
("dispatch is the ONE enforcement point") but implemented **per-mechanism**, so
each dispatch mechanism that diverges from the staged-request seam silently escapes
it. Patching a third site leaves the identical hole for the fourth. The durable fix
— route `merged` through the claimable-request seam, or give the guarantee a single
structural choke point every dispatch mechanism must pass — is tracked separately,
with the re-entry condition being an actual per-project `merged` story.

**Scope of this addendum:** `projects:` remains kind-independent for every shipped
kind except `merged`. Nothing else in the amendment changes.

## Amendment (R1-06, 2026-08-09): `band?:` qualifier on a `{kind: flow}` binding

R1-01 (above) made the KB binding `{ kind: 'flow', ref } | { kind: 'project', ref
} | { kind: 'unique' }`. R1-06 adds an **optional `band?: string` qualifier to the
`{kind: 'flow'}` arm only** — a band-scoped KB is still flow-owned; the band names
which of that flow's bands (`review-band`, `demo-band`, …, derived from the flow's
nodes' agent `composition.guards` via `resolveBandGuard`) the KB is scoped to.

- **Shape:** `{ kind: 'flow', ref: <flow-id>, band?: <band-id> }`. `band` is
  meaningless (and lint-rejected) on `{kind: 'project'}` and `{kind: 'unique'}`.
  An unknown `band` — one not in the bound flow's real band vocabulary
  (`listFlowBandIds`) — is a create-route 400 and a `studio-lint` error, never a
  silent accept.
- **Why a qualifier, not a fourth binding kind.** A band KB is still owned by its
  flow; a fourth kind would fork every `binding.kind` switch in
  `kb-descriptor.ts` / `bridge-studio-kbs.ts` / `studio-lint.ts` / the UI for no
  added meaning. Rejected.
- **Read-policy coupling (ADR-010, 2026-08-09 amendment):** `deriveKbUsageDefaults`
  becomes band-aware — `band: review-band` grants `usage.readers` the reviewer;
  every other band keeps the `planner + reflector` default. This is the first
  deliberate crossing of the R1-01 "scoping, not who-reads-what" boundary and is
  ratified in ADR-010, enforced by `orchestrator/kb-read-policy-guard.test.ts`'s
  descriptor walk. Contract + guard only until R4-19 wires a real read.

## Amendment (W7-C1, 2026-08-21): reflect is an OOTB agent run — the seed flow set is two

T1-ratified during the wave-7 flows-pillar consolidation. The OOTB seed set
shrinks from three flows to **two**: `studio/flows/forge-architect/` and
`studio/flows/forge-develop/`. Two vestigial wrappers are deleted outright (no
back-compat, per the no-legacy rule):

- **`forge-reflect`** — R4-09-F1 had already retired it as the *shipped* shape
  (the merged trigger targets the reflect **agent**, `{kind: agent, ref:
  reflector}`); the wrapper survived only as an authorable-only,
  `kickoff: trigger-only` monitor that mirrored Develop history with no Run
  control (wave-7 finding flows-17). Reflection is an **OOTB agent run, not a
  flow**: dispatched post-merge by `orchestrator/finalize-merged.ts` from
  forge-develop's declaration, and runnable on demand from `/agents/reflector`.
- **`onboard-project`** — the flow-shaped duplicate of the onboarding SESSION
  (findings flows-20/sessions-kinds-01/crosscut-14); the session is the one
  entry, kicked off from `/sessions/onboarding/new`.

Format consequences owned by this ADR: the `kickoff` enum (Stage C amendment
above) is unchanged — `trigger-only` remains a valid, authorable kind; it
simply no longer has a seed-flow exemplar. The Stage C sentence naming
`forge-reflect` as the `trigger-only` seed, and the R1-01 note about "the
three seed flows' `kb: cycles` read grants", are superseded accordingly (the
read grants now live on the two remaining seed flow.yamls; the reflector
agent's brain access rides its own agent definition per ADR-010).
