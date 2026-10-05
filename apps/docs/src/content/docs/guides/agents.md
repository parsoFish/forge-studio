---
title: Agents
description: Create an agent, check its readiness, run it on its own, and read its run history and cost in Studio.
type: guide
owner: parsoFish
last_verified: 2026-10-06
covers: [apps/studio/app/agents/**, packages/agents/**]
sidebar:
  order: 6
---

An agent is the worker at a station: instructions, skills, a tool fence and a model. Open **Agents** to browse the roster, build a new agent, run one on its own, and read what it did and cost.

## Before you start

- To attach a tool or MCP server, its connection must be available. Otherwise the agent reads as not ready and the run is blocked.

## Create an agent

In **Agents**, press **+ New agent** and pick a starter to edit, or start from scratch.

Fill in the essentials, then press **Save agent**:

- **Purpose**: what the agent exists to accomplish.
- **Instructions**: what it reads, decides and produces, step by step. **Generate draft** composes a draft from your other fields once the agent is saved.
- **Human Interactivity**: where a human takes part, for example a verdict gate.

Everything else has a default under **Advanced**:

- **Capabilities & Constraints**: drag skills, tools, MCP servers, guards and hooks from the **Component Library** into their zones.
- **Runtime**: the SDK, **Model Strategy**, **Loop strategy** and **Knowledge Access**.
- The tool fence. The tools an agent may call are shown read-only under **Tool permissions**. You change them in the agent's SKILL.md, and a save carries them through unchanged.

**Readiness** lists what is missing: a purpose, at least one skill, an observability guard, a process, interactivity, a configured runtime and, when you bind tools or MCP servers, that those are ready. **Used in Flows** shows which flows use the agent.

To copy an agent, press **Duplicate**. To remove one, press **Delete**. **Delete** is blocked while a flow still uses the agent, and the reason names those flows.

## Run an agent on its own

To run an agent outside a flow, save it first. In the run panel you can choose a project, enter inputs one per line as `key: value`, set a **Cost ceiling (USD)** and attach materials of the kinds the agent declares. Then press **Run agent**; the button shows the cap in force. A run spends real model usage. When it reaches its ceiling it stops and ends as `budget-exceeded`, not as done.

While the run is live, the run page refreshes itself. Use **Refresh** to re-read it. Press **Cancel run**, then **Confirm cancel**, to stop it.

## Read run history and cost

On an agent's page, **History** lists its runs from flows, standalone dispatches and sessions. Each row shows when it ran, its status and its cost. Filter by **Status**. For all agents, the **Agents** page shows **Recent agent runs**.

Open a run to see its log, trigger, attached materials, **Cost ceiling** and **Outputs**. A failed run shows the failure text.

## Troubleshooting

- *Run is disabled.* The panel asks you to save the agent first. Save, then run.
- *An agent with a multi-iteration loop cannot run standalone.* Start it through its flow.
- *An agent with a band guard cannot run standalone.* Start it through the flow that carries that band.
- *The cost ceiling field is disabled.* The agent's loop strategy cannot enforce a per-run ceiling.
- *The run page has stopped watching.* The run may still be going. Press **Re-check**.

## Related

- [Create a new agent](/guides/how-to/create-a-new-agent/)
- [Flows](/guides/flows/)
- [How forge works](/how-forge-works/)
