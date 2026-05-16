---
description: Architect human moment — turn a vision into queued initiatives (own session, out-of-cycle).
argument-hint: <project-name>
---

# /forge-architect

> **This is a human interaction moment, run in YOUR OWN Claude session.**
> Forge NEVER spawns an agent or a simulator for this in production. The
> architect is deliberately **out-of-cycle** — it is NOT wired into
> `runCycle`; this command is its first-class home. Design of record:
> `brain/forge/themes/human-interaction-via-own-session.md`, US-3.1 /
> US-1.0 in `docs/forge-user-stories.md`.

## Single purpose

Collaborate with the operator to turn a free-form vision into a roadmap
update plus one or more right-sized, schema-valid initiative manifests
that the scheduler will later pick up unattended.

## Reads

- The operator's free-form idea / brief / pain point (live in this chat).
- `projects/<name>/roadmap.md` — current roadmap (schema: ADR 014).
- `brain/projects/<name>/profile.md` — project taste + hard constraints.
- `brain/projects/<name>/themes/` — project patterns + antipatterns.
- Prior initiatives for the project (`_queue/done/`, `_queue/pending/`)
  and their retros (`brain/projects/<name>/themes/`).

## Writes (file handoff)

- Updated `projects/<name>/roadmap.md` (roadmap rows; schema ADR 014).
- One or more `_queue/pending/INIT-<YYYYMMDD>-<slug>.md` manifests
  (frontmatter + LLM-Council-confirmed brief; schema ADR 015 / ADR 014).

The handoff to forge is purely these files. The scheduler picks up
`_queue/pending/INIT-*.md` on its own; this command does not run or wait
on any cycle.

## How to run it

1. Invoke the **architect SKILL pattern** — follow
   [`skills/architect/SKILL.md`](../../skills/architect/SKILL.md) (and
   optionally [`skills/architect-llm-council/SKILL.md`](../../skills/architect-llm-council/SKILL.md)
   for the chained-critic pass). Its required first action is a
   `brain-query` — do that before proposing anything.
2. Produce / refine the roadmap rows and the `_queue/pending/INIT-*.md`
   manifest(s) per the SKILL contract. Keep initiatives atomically
   sized to the contract's C1/C3 norms (small, releasable).
3. Stop. Do **not** wire the architect into `runCycle` and do **not**
   start a cycle — the queue + scheduler take it from here.

Target project: **$ARGUMENTS**
