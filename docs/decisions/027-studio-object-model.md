# ADR 027 — Forge Studio object model: definitions as data, filesystem registries

**Status:** Accepted — 2026-06-13. Implementation staged per
[`docs/forge-studio/roadmap.md`](../forge-studio/roadmap.md) (M0 schemas,
M2 builders). Amends ADR 003/024 (agent definition), ADR 018 (KB descriptor),
ADR 010 (brain access becomes a per-agent field), ADR 017 (project config
extensions).

## Context

Forge is one flow definition compiled by hand into TypeScript. The Forge
Studio direction (mocks at `mockups/agent-flow-builder/`, plan at
`docs/forge-studio/`) requires Projects, Agents, Flows, and Knowledge Bases
as first-class, operator-editable objects. The danger is a second source of
truth: a registry that duplicates what SKILL.md, `.forge/project.json`, and
the brains already encode.

## Decision

Every Studio object is a **thin declarative layer over an existing proven
mechanism**, persisted as markdown/YAML on the filesystem, git-versioned,
written only through one canonical serializer module
(`orchestrator/studio/registry.ts`, gray-matter/js-yaml — the
`serializeManifest` rule generalised). No database, no parallel store.

1. **Agent = extended SKILL.md.** The agent definition IS the skill
   directory; frontmatter gains machine fields (`purpose`, `composition`
   {skills/tools/mcps/hooks}, `runtime` {sdk/strategy/model/range/
   subagentModel}, `brainAccess`, `interactivity`, `budgets` {iterationFloor,
   maxTurnsPerIteration, wedgeKillMs}); the body keeps process intent.
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
   steps — closes the `demo.skill` known-gap), `skills[]`, `kb`. Forge keeps
   only an id→path registry (`studio/projects.yaml`).
4. **Knowledge Base = `kb.yaml` descriptor over an existing brain**
   (id, name, scope: `project | flow | agent-integration`, desc). Graph data
   stays graphify output; health stays `forge brain lint`. No new graph store.
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

This realises the modularity-as-subsumption thesis for memory: a Zep/Mem0/Cognee
backend (M8-C) implements `KbBackend` and registers in `getKbBackend`, and the
brain's store becomes swappable. The bridge KB routes (`cli/bridge-studio-kbs.ts`)
now read through `getKbBackend` rather than calling `kb-graph.ts` directly.

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
- **Runtime (separate follow-up, ADR-028 surface):** a `flow-runner` `assertArtifactPresent`
  pre-node guard turns a missing/empty inbound artifact into a clean orchestration error at
  the boundary, and the human `verdict` is persisted as
  `_logs/<cycleId>/artifacts/verdict.json` so the reflector has a durable record.

The five seed templates (`plan`, `work-items`, `wi-branches`, `pr`, `verdict`) document the
contracts the current cycle already relies on. `wi-branches` is `kind: git-state` (the
artifact is commits on a branch, not a file).
