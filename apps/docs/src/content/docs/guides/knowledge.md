---
title: Knowledge
description: Create a knowledge base, bind it to a flow, and keep the themes your agents read before acting healthy.
type: guide
owner: parsoFish
last_verified: 2026-10-06
covers: [apps/studio/app/knowledge/**, packages/knowledge/**]
sidebar:
  order: 9
---

A knowledge base is a set of themes, short markdown pages, that your agents read before they act and that reflection writes back to after a run. Open it from **Knowledge**.

## Before you start

- A flow or a project to bind the knowledge base to. See [Flows](/guides/flows/) and [Projects](/guides/projects/).

## Set up

To create a knowledge base, press **+ New KB** on **Knowledge**. Fill in:

- **Name**. Studio derives the id from it (lowercase, spaces to hyphens). A name with no letters or digits cannot be submitted.
- **Binding**. Choose a flow, for cross-cycle knowledge of that flow, or a project, for knowledge of one project. Then pick which one.
- **Band (optional)**. For a flow binding, scope the knowledge to one band of the flow's guarded agents. Leave it empty and every reader of the flow can read it. A flow with no band-guarded agents offers no bands.
- **Description**, optional.

Press **Create knowledge base →**. Studio opens the new knowledge base and shows a banner naming its seeding session. Follow **watch the seeding session →**. The session waits for an optional brief (**Start analysis →**), reads the project, and drafts themes. Review the drafts in the artifact pane, then press **Approve + commit** to write them into the knowledge base. **Abandon…** discards them.

## Check that agents read it

In a flow run, open a station. Its drawer shows how many knowledge reads that station made. For what reflection wrote back, open the **Ingest Activity** tab: it lists each reflection pass and the fresh themes it added. It stays empty until a cycle has completed a reflection against that knowledge base.

## Keep it healthy

To see lint results, open the **Health** tab. It also holds the maintenance actions:

- **Drain to green** loops lint, auto-fixes, and one agent turn per finding until lint is clean or the run stops with a reason. Structural fixes land directly. Prose edits wait for you.
- **Consolidate** makes one pass over the current agent-level findings.
- **Cleanup plan** has an agent draft a plan as a session you approve before anything is applied.

To review prose edits from a drain, press **Review the diff →** in the bar that appears. Nothing is applied until you approve.

To steer the themes yourself, write a note in the guidance panel and press **Pin guidance**.

Only one job runs at a time. While one is active, the other actions are disabled and the panel shows the reason.

## Related

- [Create a new knowledge base](/guides/how-to/create-a-new-knowledge-base/)
- [Flows](/guides/flows/)
- [How forge works](/how-forge-works/)
