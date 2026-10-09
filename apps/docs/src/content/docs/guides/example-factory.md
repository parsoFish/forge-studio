---
title: The example factory
description: The develop factory forge ships as a working example, where it pauses for your decision, and how to set its spend ceilings.
type: guide
owner: parsoFish
last_verified: 2026-10-09
covers: [packages/factory/**, packages/stations/**, studio/flows/**]
sidebar:
  order: 12
---

forge ships one working factory, the develop factory, to show what the primitives build. It turns an idea into a reviewed, merged change and runs unattended between its gates. It is an example: you can leave it as is or build your own.

## What it does

Two flows make up the factory.

- `forge-architect`, the plan flow. You describe an idea; the architect interviews you and drafts a plan, which pauses at the plan gate. Once you approve, the project manager splits it into work items. Approving does not start building.
- `forge-develop`, the develop flow. Developer agents build the work items, an integrate station assembles the pull request, and an adversarial reviewer critiques the diff. It pauses at the verdict gate.

After the merge, the reflector runs. **Reflect on this cycle →** on the verdict page opens its reflection, with any questions it has for you.

## Where it pauses for you

| Gate | You decide | Controls |
|---|---|---|
| Plan | Whether the plan is the work you want built | **Approve**, **Send back**, **Reject** |
| Kickoff | When a planned initiative starts building; nothing is built until you press this | **Start development** on the initiative's roadmap card |
| Verdict | Whether the reviewed change merges | **approve and merge**, or **add work items** |
| Reflection | What the cycle taught | **Submit reflection** |

At the plan gate, an optional note goes with your choice; add one when you send back. **Send back** gives the architect another turn.

At the verdict gate, read the review findings first. **approve and merge** merges the pull request. **add work items** writes new acceptance criteria and runs them in the same cycle; no new cycle starts. On the demo page, a **blocking** comment makes the verdict a send-back and no rationale is asked for; a run with no demo shows a plain form that needs one.

The reflection gate lists questions; answer all of them to submit. The reflector folds your answers into Knowledge, which agents read before they act on later runs.

## Set spend ceilings

The plan flow stops at 10 USD. A develop run stops at the **ceiling** shown on its plan card (its **estimate** plus 50 %), unless `FORGE_COST_CEILING_USD` or the fields below override it ([Agent cost ceilings](/reference/agent-cost-ceilings/)). A run stops at a clean boundary and can be resumed.

To override it for one run:

- For an idea, fill **Cost ceiling (USD, optional)** in the new-idea form before **Start architect**.
- For development, set **ceiling ($)** on the project's Roadmap tab before pressing **Start development**. The field applies to one card at a time, not to **Start eligible**.

## Replace it

Studio will not delete the shipped flows. To replace the example, build your own flow: press **+ New flow** in **Flows** and follow [Create a new flow](/guides/how-to/create-a-new-flow/). Nothing else in forge depends on the example.

## Troubleshooting

- *Verdict button disabled.* On a run with no demo, the plain form needs a rationale. Fill it in.
- *Reflection button disabled.* Answer every question; the counter shows how many remain.

## Related

- [Sessions & gates](/guides/sessions-and-gates/)
- [Flows](/guides/flows/)
- [How forge works](/how-forge-works/)
