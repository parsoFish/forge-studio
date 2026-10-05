---
title: Extension seams
description: "The places you extend forge: agents, flows, hooks, the catalog, runtime adapters and Knowledge backends, and how forge checks each."
type: reference
owner: parsoFish
last_verified: 2026-10-06
covers: [skills/**, studio/**, packages/agents/_adapters/**, packages/knowledge/kb-backend.ts, packages/library/**, packages/contracts/studio-types.ts]
---

You extend forge by adding data (agents, flows, hooks, catalog entries) or by implementing one of two code interfaces (runtime adapter, Knowledge backend).

## Shape

| Seam | You add | Where | Checked by |
|---|---|---|---|
| Agent | A `SKILL.md` with agent frontmatter | `skills/<slug>/SKILL.md` | `forge studio lint` |
| Skill | A `SKILL.md` of instructions | `.forge/skills/<id>/SKILL.md` in a project, or `skills/<id>/SKILL.md` for every project | `forge preflight` |
| Flow | A `flow.yaml` | `studio/flows/<id>/flow.yaml` | `forge studio lint` |
| Hook | A `hook.yaml` and script | `studio/hooks/<id>/` | `forge studio lint`, operator approval |
| Catalog entry | A line in a list | `studio/catalog.yaml` | `forge studio lint` |
| Runtime adapter | TypeScript implementing `RuntimeAdapter` | `packages/agents/_adapters/<sdk>/index.ts` | The adapter conformance test |
| Knowledge backend | TypeScript implementing `KbBackend` | `packages/knowledge/kb-backend.ts` | The Knowledge contract tests |

Adding an agent slug to a flow's `nodes` is the only registration an agent needs. A skill needs no registration: a project lists its id in `skills` in `.forge/project.json`, or an agent lists it in `composition.skills`, and forge looks for it in the project's `.forge/skills/` first, then in forge's `skills/`.

## Fields

Agent `SKILL.md` frontmatter:

| Name | Type | Default | Description |
|---|---|---|---|
| `name`, `description`, `purpose` | string | required | What the agent is and its single responsibility. |
| `composition.skills` | list | required | Skills the agent loads. |
| `composition.tools` | list | required | Tool ids from the catalog. |
| `composition.mcps` | list | required | MCP server ids from the catalog. |
| `composition.guards` | list | required | Guard ids from the catalog. |
| `runtime.sdk` | string | required | SDK id; must be registered as a runtime adapter. |
| `runtime.strategy` | `fixed` or `range` | required | One model, or an escalation ladder. |
| `runtime.model` | string | none | Model id; required for `fixed`. |
| `runtime.range` | list | none | Model tiers for `range`. |
| `runtime.loopStrategy` | `one-shot` or `ralph` | none | `one-shot` is a single pass. `ralph` is the iterate-until-green loop. |
| `brainAccess` | `mandatory`, `advisory`, `none` | required | How strongly the agent must read Knowledge. |
| `interactivity` | string | required | How much the agent blocks on you. |
| `allowed-tools`, `disallowed-tools` | list | required | Tool fence handed to the SDK. |
| `budgets` | map | required, may be `{}` | See Agent cost ceilings. |
| `fanout` | map | none | Required when a flow node uses `fanOut` on this agent. |

Flow `flow.yaml`:

| Name | Type | Default | Description |
|---|---|---|---|
| `id`, `name`, `version`, `goal` | string, string, number, string | required | Identity and one-sentence purpose. |
| `project` | string or null | required | `null` is operator-scoped. |
| `kb` | string or null | required | Which Knowledge base the flow's agents read. |
| `costCeilingUsd` | number | required | The flow's ceiling. |
| `origin` | string | required | `seed`, `starter` or `operator`. |
| `accepts` | list | required, non-empty | Change classes: `code`, `docs`, `config`, `infra`. |
| `nodes` | list | required | `id`, plus `agent` or `gate`, optional `fanOut`, `resumable`. |
| `edges` | list | required | `from`, `to`, `artifact` (a greppable markdown artifact). |
| `triggers` | list | required, may be `[]` | `on`, `target`, and per-kind fields. |

Hook `hook.yaml`:

| Name | Type | Default | Description |
|---|---|---|---|
| `id`, `name`, `description` | string | required | Identity. |
| `on` | string | required | One of `PreToolUse`, `PostToolUse`, `SessionStart`, `SessionEnd`, `Notification`, `UserPromptSubmit`. |
| `matcher` | string | none | Which tool call it binds to, such as `Bash(git push)`. |
| `script` | path | required | Script run under a bounded, environment-stripped spawn. |
| `permissions` | map | required | `env`, `read`, `network` the script may use. |

A hook runs only after you approve it.

Catalog lists in `studio/catalog.yaml`: `sdks`, `models`, `tools`, `mcps`, `guards`. An SDK is selectable only when its catalog `available` flag is true and its adapter reports itself available.

Runtime adapter interface:

| Member | Type | Description |
|---|---|---|
| `id` | string | SDK id, matching the catalog. |
| `available` | boolean | False when the dependency or credentials are missing; registered but not selectable. |
| `createAgent(opts)` | function | Returns one loop iteration. |
| `query` | function | Raw SDK call used by single-pass agents. |

Knowledge backend interface:

| Member | Description |
|---|---|
| `kbId` | The Knowledge base the backend serves. |
| `buildGraph()` | Node and edge graph for the Studio view. |
| `getNodeArticle(nodeId)` | One node's body and edges, or null. |
| `listPendingGuidance()` | Guidance notes waiting for ingest. |
| `deleteGuidanceFile(path)` | Removes a consumed note. |
| `search(query, limit?)` | Free-text search. |

All members are synchronous.

## Examples

A minimal flow:

```yaml
id: my-flow
name: My Flow
version: 1
goal: Plan a change, implement it, and review it before it merges.
project: null
kb: null
costCeilingUsd: 5
origin: operator
accepts: [code]
nodes:
  - { id: plan, agent: plan }
  - { id: dev, agent: dev }
  - { id: review, agent: review, gate: verdict }
edges:
  - { from: plan, to: dev, artifact: plan }
  - { from: dev, to: review, artifact: pr }
triggers: []
```

A hook that blocks pushes from a protected branch:

```yaml
id: block-protected-branch-push
name: block-protected-branch-push
description: Refuse a push while HEAD is on a protected branch.
on: PreToolUse
matcher: "Bash(git push)"
script: scripts/run.sh
permissions:
  env: []
  read: []
  network: false
```

Validate any of the data seams:

```bash
forge studio lint
```

## Limits

- A runtime adapter other than `claude` registers but is not selectable until you provide its dependency and credentials. Gemini and Aider ship registered and unavailable.
- Only the `claude` adapter cancels an in-flight iteration when a node's wedge timer fires.
- The only Knowledge backend is the filesystem one, and there is no registration point for another: `getKbBackend` always returns the filesystem backend. A new backend is a code change to `packages/knowledge/kb-backend.ts`.
- A flow whose `fanOut` names an agent without a `fanout` block fails lint.
- Flow ids must be unique across `studio/flows/` and every package's `flows/` directory.
