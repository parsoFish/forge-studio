---
description: Architect human moment — turn a vision into queued initiatives (own session, out-of-cycle).
argument-hint: <project-name>
---

# /forge-architect &lt;project-name&gt;

> Human interaction moment — run in YOUR OWN Claude session. The architect
> is deliberately **out-of-cycle** (not wired into `runCycle`); this
> command is its first-class entry point. Forge never spawns an agent or a
> bench simulator for this in production.

This command has **no standalone procedure**. Invoke the **`architect`
skill** and follow [`skills/architect/SKILL.md`](../../skills/architect/SKILL.md)
**exactly** — it is the single source of truth for Reads, Writes, Process,
event-log entries, and constraints. Do not re-derive, paraphrase, or skip
any step. In particular its Process **step 3 (`architect-llm-council` via
`runCouncil()`) is mandatory**, not optional — emit
`architect.council-invoked` when you do it.

When the skill's contract is satisfied (roadmap rows updated +
schema-valid `_queue/pending/INIT-*.md` written and validated), **stop** —
do not start a cycle; the scheduler picks the queue up on its own.

Target project: **$ARGUMENTS**
