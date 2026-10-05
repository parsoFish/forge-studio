---
title: Library & Community
description: Browse, create and approve the skills, hooks, templates and connections your factory is built from, and install more from the Community.
type: guide
owner: parsoFish
last_verified: 2026-10-06
covers: [apps/studio/app/library/**, apps/studio/app/hooks/**, apps/studio/app/templates/**, apps/studio/app/connections/**, apps/studio/app/community/**, packages/library/**]
sidebar:
  order: 7
---

The Library is the shelf of reusable parts your agents and flows are built from. Anything an agent can run, such as a hook script, is scanned and approved here first. Community is where you install parts others have published.

## What the Library holds

Open **Library** to see one shelf per kind:

- **Skills**: reusable instruction units. They have their own guide, [Skills](/guides/skills/).
- **Hooks**: scripts an agent runs on a lifecycle event.
- **Connections**: the tools and services an agent can reach, with their setup and probe state.
- **Templates**: markdown definitions for planning artifacts and demo output elements.
- **Community**: items you can install from other hubs.

## Trust: scan, draft, approve

- A hook is scanned statically. The verdict and every finding show under **Security scan** on the hook's page.
- A new hook starts as needs-review, and **Approve** moves it on. Editing an approved hook drops it back to needs-review.
- A blocked hook refuses **Approve**. **Override block** is a separate act: it needs a written reason, is recorded, and the hook stays flagged as blocked.
- An approved hook has **Revoke approval**, which returns it to needs-review.
- An installed skill lands as a draft. Nothing runs until you approve it on its own page.

## Create a hook

To write a hook, press **+ New hook** on the Hooks shelf. Give it a name, a description, a **Lifecycle event**, and a script. Declare what it needs under **Permissions**: environment variables, path prefixes, and network egress, so the scan can tell declared access from undeclared. A **Matcher (optional)** appears only for events that carry a tool; for other events the field is replaced by a note. Press **Create hook →**, then approve it on its page.

To bind a hook to an agent, open the agent and drag the hook from the **Component Library** into the agent's hooks zone.

## Create a template

To define a template, press **+ New template**, pick a **Category** (planning or demo output), and give it a lowercase-kebab id. The page seeds a definition for you. The server validates it before writing anything. Project scaffolds are curated in the repository and are not offered.

Steps: [Create library components](/guides/how-to/create-library-components/).

## Install from Community

Open **Community** to browse every source hub in one list. Open an item to read its source and install state.

- Press **Install** on an item. forge fetches it from the source it names, copies it into the matching local library with its provenance, and lands it unapproved.
- Hooks show their security scan before you install. Review it, then approve the hook on its own page.
- Tools installed with `npm` ask you to confirm first, showing the exact package, version and whether lifecycle scripts run.
- To add a source of your own, use **+ Add item**. **Refresh registry** pulls current upstream signals for every row.

Steps: [Install library components from the community](/guides/how-to/install-library-components-from-the-community/).

## Troubleshooting

- *Install is withheld and the item is marked present locally.* A local item already uses that id and did not come from Community. Manage the local copy instead.
- *An installed item is marked needs review.* The installed copy differs from what was approved. Review it before use.
- **Could not reach the forge bridge**: the shelf could not load. Check that `forge studio` is running.

## Related

- [Skills](/guides/skills/)
- [Agents](/guides/agents/)
- [How forge works](/how-forge-works/)
