# Extension seams

Forge has three registered, pluggable seams, plus a fourth registration point
that needs no seam of its own. Each of the three has a typed interface, a
conformance/contract test suite as its admission gate, a registry, and (for
two of them) a `catalog.yaml` entry.

The RuntimeAdapter seam has two registered non-Claude implementations —
Gemini and Aider (ADR-032) — dep+creds-gated so they register but are not
selectable until an operator provisions the dependency and credentials. The
KbBackend seam is **filesystem-only today** — `FilesystemKbBackend` is the
sole implementation; the interface exists for a future backend but nothing
else has been built behind it.

---

## 1. RuntimeAdapter — an LLM SDK or agentic coder behind the dev-loop

**Interface:** `packages/agents/_adapters/types.ts`
**Conformance suite:** `packages/agents/_adapters/conformance.ts`
**Registry:** `packages/agents/_adapters/registry.ts`
**Catalog:** `studio/catalog.yaml` (`sdks:` list)
**Registered implementations:** `packages/agents/_adapters/{claude,gemini,aider,example}/index.ts`

### The interface

```typescript
// packages/agents/_adapters/types.ts
export type RuntimeAdapter = {
  id: string;           // sdk id registered in catalog.yaml
  available: boolean;   // dep + creds gate; false = registered but not selectable
  createAgent(opts: AdapterAgentOptions): AgentInvocation;
  query: QueryFn;
};
```

`createAgent` returns an `AgentInvocation` — one Ralph loop iteration. It
reads `PROMPT.md` from the worktree, drives the SDK, and returns
`AgentIterationInfo` (`filesChanged`, `costUsd`, `toolsUsed`, token counts).
`query` is the raw SDK-call boundary used by direct-stream phases (architect,
PM, reflector).

### The admission gate

`runAdapterConformance` (`packages/agents/_adapters/conformance.ts`) is the
one test every adapter must pass before its registry entry is trusted. It
checks: `id` is a non-empty string, `available` is a boolean, `createAgent`
returns a callable, and `query` returns an `AsyncIterable` that yields at
least one message with a `result`-type terminal.

Dep + creds gating is the standing pattern behind `available`: the dependency
is imported through a string variable (so `tsc` never resolves an absent
module) and `available` is computed at module load from dep-presence AND
creds-presence. `gemini/index.ts` and `aider/index.ts` are the current worked
examples to diff a new adapter against — `aider/index.ts` in particular
covers the CLI-subprocess shape, where `query` is a thin shim rather than a
real token stream.

### Registry and catalog

`getAdapter(id)` (`packages/agents/_adapters/registry.ts`) is what the
dev-loop calls: `getAdapter(sdkId).createAgent(opts)`. An unavailable adapter
is harmless — `isSdkAvailable(id)` stays false and the Studio agent-builder
picker greys it out. `studio/catalog.yaml`'s `sdks:` list is what that picker
reads; each entry's `available` flag is set to `false` until the dependency
is provisioned in production.

---

## 2. KbBackend — the brain's storage layer

**Interface:** `packages/knowledge/kb-backend.ts`
**Reference impl:** `FilesystemKbBackend` (same file)
**Contract test:** `packages/knowledge/tests/contract/kb-backend.test.ts`,
`packages/knowledge/tests/contract/kb-backend-conformance.test.ts`

### The interface

```typescript
// packages/knowledge/kb-backend.ts
export interface KbBackend {
  readonly kbId: string;
  buildGraph(): KbGraph;
  getNodeArticle(nodeId: string): KbNodeArticle | null;
  listPendingGuidance(): PendingGuidance[];
  deleteGuidanceFile(filePath: string): boolean;
  search(query: string, limit?: number): KbSearchHit[];
}
```

The interface is **synchronous**. `FilesystemKbBackend.search` does cheap
title-substring ranking over the graph loaded from `brain/<kbId>/` via
`kb-graph.ts`; a semantic backend would override it with embedding/graph
search. The async escape hatch for a backend whose store is itself async is
an `async prime()` method — not part of the interface — that pulls data into
memory before the synchronous methods read the cached snapshot;
`getKbBackendAsync` is the resolver that awaits `prime()` once before
returning the backend.

### Routing

`getKbBackend(forgeRoot, kbId)` / `getKbBackendAsync(...)`
(`packages/knowledge/kb-backend.ts`) are the resolution entry points. Both
always return `FilesystemKbBackend` today — there is no `backend:` dispatch
in the KB's `kb.yaml` descriptor yet, because nothing has been built to
dispatch to.

Delegating guidance operations (`listPendingGuidance` / `deleteGuidanceFile`)
to a composed `FilesystemKbBackend` is the expected shape for any future
backend — `_guidance` is a filesystem concept a remote store has no
equivalent for.

---

## 3. Flow — an agent workflow

**Schema:** `packages/contracts/studio-types.ts` (`FlowDefinition`)
**Validator:** `packages/flows/studio/validate-flow.ts` (run via `forge studio lint`)
**Seed flows:** `studio/flows/forge-architect/flow.yaml`, `studio/flows/forge-develop/flow.yaml`

A flow is a `flow.yaml` file under `studio/flows/<flow-id>/`:

```yaml
id: my-flow
name: My Flow
version: 1
goal: One sentence: what this flow achieves.
project: null          # null = operator-scoped; "my-project" = project-scoped
kb: cycles             # which KB the flow's agents read (brain/<kb-id>/)
costCeilingUsd: 10
origin: seed           # or 'operator'

nodes:
  - { id: ingest, agent: brain-ingest }
  - { id: review, gate: verdict }          # gate-only node (human moment; no agent)
  - { id: dev, agent: developer-ralph, fanOut: work-items }   # fan-out over artifact
  - { id: demo, agent: demo-agent, resumable: true }           # the integrate station (code identifier: demo)

edges:
  - { from: ingest, to: review, artifact: report }
  - { from: review, to: dev,    artifact: work-items }
  - { from: dev,    to: demo,   artifact: wi-branches }

triggers: []
```

**Node fields:**

| Field | Required | Meaning |
|-------|----------|---------|
| `id` | yes | unique within the flow |
| `agent` | if no `gate` | slug of an agent in `skills/` |
| `gate` | if no `agent` | human gate id (`plan`, `verdict`) |
| `fanOut` | no | upstream artifact name whose items drive multiplicity — the agent runs once per item (in its declared isolation). The target `agent` MUST be **fanout-capable** (its SKILL.md declares a `fanout:` block, R2-03-F2); `forge studio lint` errors otherwise. |
| `resumable` | no | node can be re-entered after partial failure — e.g. the develop flow's integrate station (code identifier `demo` in `studio/flows/forge-develop/flow.yaml` today) |

**Edge `artifact`** names the markdown artifact written by the `from` node
and read by the `to` node. Every artifact must be greppable (ADR-007).

`forge studio lint` validates a flow: required fields present, all `agent`
slugs resolve to a `skills/<slug>/SKILL.md`, all `gate` ids are known, all
edge endpoints are declared nodes, no dangling edges. The flow engine
dispatches nodes via a data-table + node-executor registry ([ADR-028](../decisions/028-flow-engine.md)).

---

## 4. Skill/agent — a phase agent

**Directory:** `skills/<slug>/`
**Required file:** `skills/<slug>/SKILL.md`
**Types:** `packages/contracts/studio-types.ts` (`AgentDefinition`)
**Loader:** `packages/agents/studio/agent-registry.ts` (`loadAgentDefinition`)
**Spec derivation:** `packages/agents/studio/derive.ts` (`deriveAgentSpec`)

### SKILL.md structure

A `SKILL.md` has a YAML frontmatter block followed by a markdown body. The
frontmatter is the machine-readable contract; the body is the process intent
loaded into the agent's context at spawn time.

```markdown
---
name: my-agent
description: One sentence describing what this agent does.
phase: my-phase              # must match a known phase; omit for utility skills
surface: unattended          # or 'operator-driven'
purpose: Longer description of the agent's single responsibility.
composition:
  skills: [brain-query]      # sub-skills this agent loads
  tools: [git, node]         # tool ids from catalog.yaml tools:
  mcps: []                   # MCP server ids from catalog.yaml mcps:
  guards: [event-log]        # guard ids from catalog.yaml guards:
runtime:
  sdk: claude                # sdk id from catalog.yaml sdks:
  strategy: fixed            # 'fixed' (one model) or 'range' (escalation ladder)
  model: claude-sonnet-4-6   # required when strategy:fixed
brainAccess: advisory        # 'mandatory' | 'advisory' | 'none'
interactivity: Fully autonomous; never blocks on the operator.
allowed-tools: [Read, Write, Edit, MultiEdit, Bash, Grep, Glob]
disallowed-tools: [WebFetch, WebSearch]
budgets: {}
---

# My Agent

## Single responsibility

...
```

**`runtime.sdk`** must be a registered id in `studio/catalog.yaml` and
`packages/agents/_adapters/registry.ts`.

**`strategy: fixed`** requires `model:` to be a model id in `catalog.yaml`.
`strategy: range` requires `range: [haiku, sonnet, opus]` — the flow engine
picks the cheapest available tier and escalates on failure.

**`allowed-tools` / `disallowed-tools`** become the `allowedTools` /
`disallowedTools` fields on the derived `PhaseAgentSpec` that the orchestrator
passes to the SDK at spawn time.

**`brainAccess: mandatory`** is enforced by convention (and by the
brain-read policy in `CLAUDE.md`): planners and the reflector must read the
brain before acting; the dev-loop must not read Brain 1/2, though it may read the project's Brain 3 as supplemental context (ADR 018 as amended).

`deriveAgentSpec('skills/my-agent/SKILL.md')` turns a SKILL.md into the
runtime spec: `{ phase, skill, tier, allowedTools, disallowedTools }`. The
`skill` field on the returned spec is the root-relative path passed in — the
orchestrator loads the SKILL.md body from that path and injects it as the
agent's system prompt at spawn time.

There is no separate agent-registration step: adding the agent's slug to a
flow's `nodes:` list is sufficient, and `forge studio lint` validates that
`skills/<slug>/SKILL.md` exists and parses cleanly. The flow engine resolves
slugs to SKILL.md paths at runtime via `loadAgentDefinition`.
