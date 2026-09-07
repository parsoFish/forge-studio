# `g2-restatement` — the two logs of one real run

Bead `forge-8vfn.6.10.22`. These are the event logs of **G2**, the betterado docs
initiative `INIT-2026-09-05-init-gap-registry-consolidation`, cycle
`2026-09-05T13-37-42_…`, run on 2026-09-05. They are the fixture because the
defect they pin was found *in* them and the number they pin is the number a
campaign exit row is judged by.

**What was trimmed, and what was not.** `g2-cycle-events.jsonl` holds **19 of the
run's 1,228 rows**: every event carrying `cost_usd`, plus the two `architect.start`
rows that pair with the two `architect.end` rows. Each kept row has its bulky
payload fields dropped (`input_refs`/`output_refs` emptied, gate stdout/stderr
tails and the rest of `metadata` removed); **every field the cost rule reads is
verbatim** — `event_id`, `phase`, `skill`, `event_type`, `message`, `cost_usd`,
`metadata.work_item_id`, `metadata.session_id`. The trim was verified not to move
the numbers: the full logs and these files sum identically
(cycle **26.3048**, architect session **2.3327**) through the shipped
`sumAuthoritativeCostUsd`.

**The three numbers this fixture exists to hold apart:**

| reading | $ | what it is |
|---|---|---|
| cycle log as summed today | 26.3048 | the architect counted twice — two synthetic `architect.end` rows, distinct `event_id`s, one session |
| cycle + architect session, as `sumRunCost` sums them | 28.6375 | the harness's own gate figure, `$28.64` — the duplicate **plus** a second copy from summing a session log the cycle log already restates |
| cycle log with ONE `architect.end` | **23.9721** | the truth, and row 6's figure to the cent |
