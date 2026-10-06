---
title: Sessions & gates
description: Run an interactive agent conversation, answer its questions, and approve or send back a plan or verdict at a gate.
type: guide
owner: parsoFish
last_verified: 2026-10-06
covers: [apps/studio/app/sessions/**, apps/studio/app/architect/**, apps/studio/app/artifact/**, packages/sessions/**]
sidebar:
  order: 10
---

A session is an interactive conversation between you and one agent, of a fixed kind, that ends in an artifact you review. A flow run is different: it moves through its stations without you and stops only at its gates. Sessions are also how you drive forge by asking: you start one, tell its agent the job, and it works until a gate needs you.

## Session kinds

| Kind | Produces |
|---|---|
| Planning session | Roadmap draft |
| Instructions session | AGENTS.md draft |
| Knowledge base seeding | Seeded themes |
| Demo capability session | Demo generations |
| Onboarding session | Contract build-out |
| Authoring session | Package |
| KB cleanup session | Cleanup plan |

## Start and find sessions

To see everything in flight, open **Sessions** from the **all sessions** link on Home. The list shows kind, project, phase, state and model. Filter by project or state, or press **needs you only** to see sessions waiting on a decision.

To start one, press a kind under **Start new**, choose the project (or Knowledge base for KB cleanup), and press **Start session**. An Authoring session also takes a free-text brief in **Describe what to build**. The Planning session starts from its own page: pick a project, describe the idea, and press **Start architect**. An optional **Cost ceiling (USD, optional)** caps spend for that session.

Every kickoff form has a **Model** card. When the agent allows a range, pick a tier; otherwise the card shows the tier as fixed. The tier appears in the list's **Model** column. A session's spend shows as a dollar amount on its row in the Monitor ledger; a session with no priced turns shows none.

## Work a session

Open a row to reach the session page. Depending on the kind and phase, the page shows:

- A briefing step. The agent does not run until you press **Start →** (or **Start the agent →**). Notes are optional.
- Interview questions. Type your answer and press **Send answer**.

A session whose state reads "Needs you" is waiting for an answer or a decision. To stop one, press **Cancel** on its row and confirm.

## Decide at a gate

To approve a plan, open the plan from the planning session (**Review the plan →**). Choose **Approve**, **Send back** or **Reject**. Add a note when you send back. Approve queues the plan as an initiative; development starts when you kick it off from the project's roadmap.

To decide on a cycle's verdict, open its verdict in the artifact viewer. Choose **approve** and give a rationale, then press **approve and merge**. Or choose **add work items**, write the rationale, and fill in at least one acceptance criterion with GIVEN, WHEN and THEN. The send-back runs in the same cycle.

Sessions of other kinds can end with **Approve**, **Request changes** or **Reject** on the session page. **Send for revision** needs a description of what should change.

## Troubleshooting

- *A button is disabled.* Hover over it to see why, for example that a rationale is required before a verdict can be submitted.
- *A send-back needs at least one acceptance criterion.* You cannot remove the last criterion row.
- *State reads Stalled or Crashed.* The agent stopped producing activity or its turn failed. Cancel the session and start a new one of that kind.

## Related

- [Drive forge through the assistant](/guides/how-to/drive-forge-through-the-assistant/)
- [Monitor](/guides/monitor/)
- [How forge works](/how-forge-works/)
