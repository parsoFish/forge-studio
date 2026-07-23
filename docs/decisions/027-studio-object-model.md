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
- **Runtime guard (implemented 2026-06-16, `orchestrator/flow-artifacts.ts`):**
  `assertInboundArtifacts` runs before each node in `flow-runner.runFlow` and turns a
  missing/empty inbound artifact into a clean `flow-runner.artifact-missing` error at the
  boundary (`git-state` artifacts are skipped — their invariants live in the unifier's
  close-contract gates; the `reflect` node is exempt — its inbound `verdict` is produced by
  the async human gate). The human `verdict` is persisted as
  `_logs/<cycleId>/artifacts/verdict.json` (`writeVerdictJson`) at the decision point — the
  bridge `applyReviewVerdict` on an operator approve/send-back, and `finalize-merged` on a
  silent GitHub merge — so the reflector has a durable record.

The five seed templates (`plan`, `work-items`, `wi-branches`, `pr`, `verdict`) document the
contracts the current cycle already relies on. `wi-branches` is `kind: git-state` (the
artifact is commits on a branch, not a file).

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
