---
description: Reflection human moment — supply stage-3 reflection feedback (own session).
argument-hint: <initiative-id>
---

# /forge-reflect &lt;initiative-id&gt;

> **This is a human interaction moment, run in YOUR OWN Claude session.**
> Forge NEVER simulates this feedback in production (the bench simulator
> in `benchmarks/reflection/simulator.ts` is bench-only). The reflector
> consumes a file the operator writes. Design of record:
> `brain/forge/themes/human-interaction-via-own-session.md`; US-3.1 in
> `docs/forge-user-stories.md`; phase doc `docs/phases/reflection.md`.

## Single purpose

Let the operator supply the stage-3 reflection feedback (answers to the
reflector's questions + free-form input) for initiative
`<initiative-id>`, via the file the reflector reads.

## Reads

- `_logs/<initiative-id>/user-questions.md` — the reflector's stage-2
  questions (written by the reflector; at most 4 numbered questions).
  May be absent if the reflector had no non-brain-resolvable questions.
- `_logs/<initiative-id>/retro.md` and
  `_logs/<initiative-id>/events.jsonl` — context for an informed answer.

## Writes (file handoff)

- `_logs/<initiative-id>/user-feedback.md` — the operator's answers to
  the stage-2 questions plus any free-form feedback. The reflector reads
  this as its stage-3 input and distils it into `retro.md` Section 2
  (answers) + Section 3 (free-form). Contract:
  `orchestrator/reflector-invocation.ts` (stage 2/3),
  `orchestrator/phases/reflector.ts` (`userFeedbackRelPath`).

If this file is absent when the reflector runs, it records
`_(no feedback supplied this cycle)_` and continues — so writing it is
how the operator's voice enters the brain for this cycle.

## How to run it

1. Read `_logs/<initiative-id>/user-questions.md` (if present) and skim
   `_logs/<initiative-id>/retro.md` for context.
2. Write `_logs/<initiative-id>/user-feedback.md`: address each numbered
   question, then add any free-form feedback for the brain.
3. Stop. The reflector (already wired into the cycle on a confirmed
   merge) picks the file up — do not run a cycle from here.

Initiative: **$ARGUMENTS**
