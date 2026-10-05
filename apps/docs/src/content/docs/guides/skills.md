---
title: Skills
description: Browse, author, approve and bind skills, the reusable instruction packets an agent composes at a station.
type: guide
owner: parsoFish
last_verified: 2026-10-06
covers: [apps/studio/app/skills/**, packages/library/**]
sidebar:
  order: 8
---

A skill is a reusable instruction packet, a `SKILL.md` plus any files beside it, that an agent composes. An agent is the worker at a station; skills are the procedures it carries, and one skill can serve many agents. Open **Skills** to see every skill the factory can use and to author, approve or remove them.

## Where skills come from

The **Skills** page groups cards under **Local** and **Community**. Local skills are ones you wrote or installed. Community entries are catalog skills you have not installed yet. Each card shows badges (`authored`, `community`, `reference`, `draft`, `needs-review`) and how many agents use it.

A project can also carry its own skills. They appear in the project's skill list, tagged `project`.

To install a community skill, press **Browse community** and follow [Install library components from the community](/guides/how-to/install-library-components-from-the-community/).

## Author a skill

To write one by hand, press **+ New skill**, give it a name, a one-line description and the instructions, then press **Create skill →**. The name becomes the skill's id.

To have an agent draft the package, use **Or describe it to the creation agent** on the same page: pick a project (it only hosts the session), describe the skill, and press **Start with the creation agent →**. You review and revise the draft in the session, then approve it in the library.

To change a skill later, open it, press **Edit**, then **Save changes**. See [Create library components](/guides/how-to/create-library-components/).

## Trust a skill

A skill you write in the form is ready immediately. One the creation agent drafts, or one installed from the community, starts as a `draft`: quarantined, hidden from the agent palette, and not runnable. Open it, read the whole `SKILL.md`, check the scan (file count, quarantined keys, executable-extension files), then press **Approve**. The scan is an inventory, not a verdict.

Approval pins a content hash. If the files change afterwards, the skill drops to `needs-review` until you approve it again. Editing an installed skill does this too.

## Bind a skill to an agent

To give an agent a skill, open the agent and drag the skill into its **Skills** zone. To give every agent working a project a skill, bind it in the project's **Skills agents should load when working this project** panel. A declared skill that does not exist shows as `missing`.

## Troubleshooting

- *Delete is disabled.* The skill is still composed by one or more agents. Unbind it from their builders first.
- *A `needs-review` banner.* The reason is shown: files changed after approval, provenance does not check out, or the skill was not installed through the tracked pipeline.
- *A community skill page says it is not installed.* Install it from the community browser first.

## Related

- [Library](/guides/library/)
- [Agents](/guides/agents/)
- [Projects](/guides/projects/)
