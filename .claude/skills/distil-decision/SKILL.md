---
name: distil-decision
description: Use when recording a new architectural decision in forge, or converting a long-form decision record into the distilled form (SPEC.md clause or DECISIONS.md row). Classifies the decision, verifies it against the code, and writes the shortest durable entry.
---

# distil-decision

Record a decision as the smallest entry that a check or a reviewer can hold. Long-form rationale is history; git keeps it.

## Procedure

1. Log the start: `node --experimental-strip-types scripts/skill-event.mjs distil-decision start subject=<short-name>`
2. Classify the decision. Exactly one:
   - **(a) Seam contract** (behaviour at a package or process boundary) becomes a clause in the right section of `SPEC.md`. The clause names the test that holds it.
   - **(b) Live non-seam decision** becomes one `DECISIONS.md` row:
     `| D-nn | Decision (present tense, one sentence) | Why (one sentence) | Enforced by (existing script/test path, or literal review) |`
   - **(c) Rejected alternative worth guarding** becomes one row: `| R-nn | Rejected | Why |`
   - **(d) History or as-built narration** becomes nothing. Git keeps it.
3. Verify the claim is true in the code today. Grep for the behaviour, the script, the test. If the code does not do it, the entry is false: stop and tell the operator.
4. For "Enforced by", name only a path that exists. Never invent an enforcement path. Prefer an existing check over `review`. Adding a new guard needs the operator: propose it, do not add it silently.
5. Number the row with the next free `D-nn` or `R-nn`. Do not renumber existing rows.
6. Run `node scripts/check-decisions.mjs`. It must exit 0.
7. Ship in the same PR as the code change. The operator approves the entry.
8. Log the end: `node --experimental-strip-types scripts/skill-event.mjs distil-decision end subject=<short-name> class=<a|b|c|d>`

## Do not

- Copy rationale paragraphs into a row. One sentence for the decision, one for the why.
- Cite decision-record numbers or milestone ids as the reason.
- Record a decision the code does not yet enforce or follow.
