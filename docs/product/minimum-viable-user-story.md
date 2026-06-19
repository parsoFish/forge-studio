# Minimum Viable User Story (MVUS) — the productionised forge

> **Canonical product vision.** This document defines forge's productionised form as **one user
> journey**. It is the timeless grounding every component is judged against.

Every component is judged against this journey:

- **REQUIRED** — the journey names this capability directly.
- **FORWARDS** — it demonstrably enables/serves a named capability.
- **UNPROVEN** — neither required nor demonstrated to advance the journey → **cull**.

The target user is **one human running many side projects**, who **never leaves the forge UI**.

---

## 1. Artifact phase — the architect

The user provides one of: an **idea for an existing project**, a request to **onboard a project**, or an
**idea for a new project**.

The architect:
1. Performs **deep investigation** — of the project itself, of similar projects, and **online**.
2. Uses that grounding to **interview the user**: exploring ambiguities, asking for intent, and
   requesting direction on **design forks in the road**.
3. Generates a **rich HTML plan** for review that:
   - outlines the work as **initiatives** (at the level of general concepts, not work items),
   - shows **relevant mockups or suggested behaviour** so the user can judge the proposal.
4. The user chooses: **accept**, **provide feedback and accept**, or **provide feedback and replan**.

This flows like a **conversation** — the back-and-forth refinement that users of agentic workers (Claude)
are already familiar with.

## 2. Autonomous phase — project manager → developers

After approval, the **project manager** takes the initiatives and breaks them into **work items**, which the
**developer agents** work to completion.

## 3. Review phase — the unifier

The unifier:
- **cleans all the work** — ensuring **passing CI, build, and lint**,
- generates a **rich HTML demo** of the work done, containing:
  - the **assessed intent** from the initiative,
  - the **evaluated output** of the workers measured against that intent,
  - **visual demonstrations** of the changes — *and this matters even for non-visual components*
    (e.g. a **video of a CLI's behaviour** has value to a human). *The concept is what matters: a
    human-watchable demonstration of behaviour, whatever the component's shape — not one specific medium.*

The user **accepts** or **provides feedback**. When feedback is given, a **work item to complete that work
is established and sent back to the unifier**. This loop continues until the user accepts — at which point the
change is **closed out, merged to main**, and the cycle moves toward release.

## 4. Release phase — the final loop

For a release-shaped cycle the unifier drafts a **changelog** from the merged work and presents it for a
final human moment. The user reviews and **approves the release** (or sends the draft back for an edit); on
approval, **release-finalize** runs, **forge merges the release**, and **CI tags and publishes** it
(contract clause **C10**). The release final-loop is the bridge between an accepted change and a tagged,
published artifact — the operator confirms the human-readable release notes before anything ships.

## 5. Reflect phase

An agent reviews the **entire cycle** and generates **interview questions for the user** that shape what is
worth saving to the brain to **tune future projects**. These may include:
- whether the **breakdown of work was right-sized**,
- whether the **cost of cycles is concerning** relative to the user's assessed effort,
- other **semantic** judgements,
- specific **architectural or technical decisions** that need to be **validated or refined** to the user's intent.

The agent takes the user's feedback and **updates the brains at whatever level is relevant**.

> **The framing is "tuning."** A user can influence future projects through the brain — they **cannot** make
> fundamental structural changes to forge through it. The brain shapes outputs; it does not re-architect forge.

---

## Cross-cutting — observability & presence (all phases)

Throughout the whole flow:
- The user **never leaves the forge UI** and is given a **detailed level of information they can dig into**.
- They can **observe current work** — planned and in progress — **across all projects** on forge.
- They can **drill into**: the **task a phase was given**, **how it worked through it**, **how much it cost**,
  **how current workers are doing and the tokens they are using**, and **live representations of the work**
  in the **hex UI**.
- It is **made clear when their interaction is needed** for a project.

---

## What this implies for keep / cull

Capabilities the journey **promotes to load-bearing** (regardless of prior classification):

- **Rich PLAN.html** with initiative-level framing + mockups/suggested behaviour (artifact phase).
- **Conversational replan loop** (accept / feedback+accept / feedback+replan).
- **Architect deep investigation** including **online/web research** and similar-project grounding.
- **Rich HTML demo** with assessed-intent + evaluated-output + **human-watchable visual demonstration**
  (incl. CLI-behaviour video) for any component shape.
- **Review feedback → work item → unifier** send-back loop, looping until accept (ADR-026, now built).
- **Release final-loop**: draft changelog → operator approves the release → release-finalize → forge merges → CI tags/publishes (contract C10).
- **Reflect interview → user feedback → brain tuning** at the relevant level.
- **Live, drill-down, cross-project observability**: per-phase task/approach, cost, **per-worker token usage**,
  live hex UI, and **"interaction needed" signalling**.

Capabilities the journey **does not name** → cull unless they demonstrably forward the above:

- Anything that exists for the brain as a *power tool* rather than for *tuning outputs*.
- Anything requiring the user to leave the forge UI.
- Operator-historical scaffolding, one-shot scripts, and superseded machinery.

## Explicit non-goals

- The brain **tunes**; it does not make structural changes to forge.
- No capability is retained "for completeness" — only to serve this journey.
- A real end-to-end cycle is run **only after** the slimming completes, never before.
