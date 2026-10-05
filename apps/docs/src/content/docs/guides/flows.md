---
title: Flows
description: Build, save and start a flow in Studio. A flow is an ordered path of stations where agents work and gates pause for you.
type: guide
owner: parsoFish
last_verified: 2026-10-06
covers: [apps/studio/app/flows/**, packages/flows/**]
sidebar:
  order: 5
---

A flow is the ordered path of stations that turns work into a result. Use **Flows** to browse flows, wire your own in the builder, and start runs. forge ships two flows, `forge-architect` and `forge-develop`, which together run the example develop factory.

## Before you start

- The agents you want already exist. See [Agents](/guides/agents/).

## What a flow contains

A station is one step of the flow, and each station runs exactly one agent. A gate is a station marked as a human gate: the run pauses there until you decide. Stations are joined by edges that carry an artifact from one station to the next. A station whose agent supports it can fan out into one run per work item. A flow can also declare triggers, so another flow completing, a merge or a schedule starts it.

## Build a flow

To create a flow, press **+ New flow** in **Flows**. Name the flow in the **Flow name…** field and describe its **Goal**.

1. Add stations from the **Palette**. Interactive agents cannot be placed; they run as sessions.
2. Wire stations by dragging from one station's output handle to the next station's input handle, then pick the artifact the edge carries.
3. Select a station to set **Human gate (verdict)** or **Fan out**.
4. Press **Save Flow**.

When the flow is valid, the result line reports a clean save. Otherwise it reads **Save refused** and lists each finding. If a flow references starter agents that are not installed, press **Seed starter agents** first.

`forge studio lint` runs the same checks over every flow on disk and exits non-zero on errors.

To change a flow later, open it from **Flows** and switch to the **BUILD** tab. Authored flows show **Delete flow**; shipped flows do not.

## Start a run

Open the flow and read the **Launched from** badge in the builder; it shows how the flow starts.

- *Queued initiative.* On the **MONITOR** tab, pick an initiative and press **Start Run**. If it is queued under another flow, Studio asks you to confirm moving it.
- *Idea.* The flow starts at the architect; enter your idea in the box on the monitor.
- *Planned initiative.* Open the project, pick the initiative and start development from its roadmap.
- *Trigger only.* The flow has no manual launch; it runs when its trigger fires.

You can also press **Run a flow** in a project.

## Troubleshooting

- **Name your flow before saving.** A new flow needs a name; its id comes from the name.
- **No queued initiatives yet.** Plan one with the architect first.
- *A started run does not move.* Look for the notice that `forge serve` is not running, and check that an emergency halt is not on (while it is, nothing new starts). The scheduler also refuses to claim work for a project whose quality gate cannot run, so install the project's dependencies.

## Related

- [Agents](/guides/agents/)
- [Create a new flow](/guides/how-to/create-a-new-flow/)
- [How forge works](/how-forge-works/)
