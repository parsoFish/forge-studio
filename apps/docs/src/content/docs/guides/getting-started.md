---
title: Getting started
description: Take one project from onboarding to a merged pull request with the example develop factory.
type: guide
owner: parsoFish
last_verified: 2026-10-10
covers: [apps/studio/app/projects/**, apps/studio/app/architect/**, apps/studio/app/artifact/**, apps/studio/components/PlanGate.tsx, apps/studio/components/ReviewVerdictForm.tsx, packages/projects/**]
sidebar:
  order: 2
---

This guide takes one of your repositories from onboarding to a merged pull request, using the example develop factory that ships with forge. It stops for you at the plan, the kickoff and the verdict.

## Before you start

- forge is installed and `forge studio` is running ([Install](/guides/install/)).
- Your project is a git repository with a test command that passes.

## Bring a project under forge

forge treats a directory under `projects/` as a project once it carries a `.forge/project.json` contract. Clone the repository there, or symlink it in:

```bash
git clone <url> projects/<id>
```

In **Projects**, choose **Onboard a project**. Give it a name, the command that runs its tests, and a one-line north star, then press **Onboard project →**. Studio writes the contract. To have an agent fill in the parts a form cannot, press **Run onboarding agent**.

## Get preflight green

Preflight checks the project against the contract and names each clause that fails. The project page shows the same verdict as the command line:

```bash
forge preflight <id>
```

Fix every hard clause before you plan work. Install the project's own dependencies (for a Node project, `npm ci` inside `projects/<id>`), or the scheduler refuses to claim work for it.

## Plan the work

On the project page, press **Architect →** (on the **Roadmap** tab the same form opens from **Plan with Architect**). Describe what you want built and press **Start architect**. **Cost ceiling (USD, optional)** caps what this planning session may spend. The architect may ask questions before it drafts a plan.

The plan stops at the plan gate. Each initiative card shows **budget** (how many build iterations it may take), **estimate** (its estimated spend in dollars) and **ceiling** (where its run stops; planning spend counts toward it). To send the plan back with instructions, type them in the note box first, then press **Send back**: the architect starts its next round at once. **Approve** queues the plan and starts it. **Reject** ends it.

A **Completeness critic found N potential gaps** banner lists what the critic thinks the plan misses. You may approve anyway, or put the gaps in your note and send back; each new round is checked again.

## Kick off and review

After you approve, the factory breaks each initiative into work items and stops at the Kickoff gate. The initiative's roadmap card reads KICKOFF, and the run page says **Awaiting kickoff**. Press **Start development →** on that card. To add a work item before it builds, open **Add work item** below that button; the form names any acceptance criterion that no work item's gate runs. The **ceiling ($)** field at the top of the roadmap sets that run's spending ceiling. `FORGE_COST_CEILING_USD`, set before you start `forge studio`, overrides it; with neither, the ceiling is the plan card's **ceiling** chip: the initiative's **estimate** plus 50 % ([Agent cost ceilings](/reference/agent-cost-ceilings/)). Spend before the kickoff counts toward it. A run that reaches it stops and can be resumed: set `FORGE_COST_CEILING_USD` higher, restart `forge studio`, and press **Resume** on the run.

The factory then builds, integrates and reviews the work without you, and opens a pull request with a demo of the change. When the review is done, the run page offers **Decide the verdict gate →**. The verdict page shows the demo and the review's findings. Press **+ comment** on any region to leave a note; a comment marked **blocking** turns the verdict into **send back (add work items)**, and the fix runs in the same cycle. A test command in backticks in that comment, such as `python3 -m pytest tests/`, becomes the fix's gate. With no blocking comments, press **approve and merge**, and forge merges the pull request itself, or press **send back with typed work items** to write a rationale and the work yourself: GIVEN, WHEN and THEN criteria, and optionally a gate command and the files in scope. A run that filed no demo shows a plain form instead: write a rationale, then press **approve and merge** or add work items the same way.

After the merge, the reflector records what the run taught in the project's Knowledge for later runs. **Reflect on this cycle →** on the verdict page opens its reflection; if it lists questions, answer them and press **Submit reflection**.

## Related

- [Onboard an existing project](/guides/how-to/onboard-an-existing-project/)
- [Projects](/guides/projects/)
- [The example factory](/guides/example-factory/)
