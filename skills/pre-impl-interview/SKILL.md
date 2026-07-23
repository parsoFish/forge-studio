---
name: pre-impl-interview
description: Interview the developer on a work-item spec BEFORE writing any code — surface gaps, false assumptions, and scope creep while they are still cheap to fix.
library: true
---

# Pre-implementation Interview

> Forge-adapted from Matt Pocock's "Grill Me" skill (~156k installs). A pre-coding
> clarification pass: cheap questions now prevent expensive rework later.

## When to use

Compose this at the **start** of a developer-loop iteration on a non-trivial work item —
before the first edit. Skip for mechanical changes (renames, one-line fixes).

## What it does

Read the work-item spec (`acceptance_criteria`, `files_in_scope`, the initiative body) and the
relevant code, then **interrogate the plan against reality** — do not start coding until the
following are resolved or explicitly deferred:

1. **Ambiguous acceptance criteria** — any GWT triple that could be satisfied two different ways.
2. **Hidden assumptions** — files/APIs/behaviours the spec assumes exist; verify by reading.
3. **Scope boundaries** — what is explicitly *out* of scope for this WI; guard against creep.
4. **Hidden coupling** — files in scope that other in-flight WIs also touch (merge collision).
5. **The done-signal** — does `quality_gate_cmd` actually fail before the work exists and pass
   only when the ACs are met? (the hollow-gate check.)

## Output

A short `## Pre-impl notes` block prepended to the iteration's scratch state (`fix_plan.md` /
`AGENT.md`): the resolved questions, any assumptions made, and explicitly-deferred items. Then
proceed to implementation. **Unattended mode:** never block on the operator — infer the most
reasonable answer, record it, and continue.

## Sources

Matt Pocock — "Grill Me". Adapted to forge's work-item + quality-gate model.
