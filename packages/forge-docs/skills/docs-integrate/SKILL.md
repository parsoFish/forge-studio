---
name: docs-integrate
description: "The declaration carrier and display identity for forge-docs's `integrate` node — the INTEGRATE band (spec §5 item 4), unchanged from forge-develop's. The band is an orchestrator verb: it derives the demo bundle and the PR body from the acceptance criteria, the merge gate's own evidence and the diff, then renders and captures. No model is spawned on any path."
library: true
phase: integrate
surface: unattended
purpose: Declare the `integrate-band` guard and its display identity for forge-docs's integrate node. The orchestrator derives the bundle; this def carries no runtime process.
composition:
  skills: []
  tools: []
  mcps: []
  guards: [event-log, integrate-band]
runtime:
  sdk: claude
  strategy: fixed
  model: claude-sonnet-4-6
  loopStrategy: one-shot
brainAccess: advisory
interactivity: Never runs. The orchestrator-band executor (execIntegrate) performs the whole band directly and spawns nothing, on every path.
allowed-tools: []
disallowed-tools: [Bash, NotebookEdit, WebFetch, WebSearch, Task, Agent]
budgets: {maxTurns: 1, maxBudgetUsd: 0}
---

# docs-integrate skill

## What this is, honestly

This SKILL.md is **not a running agent** — it is forge-docs's OWN declaration
carrier for the `integrate-band` guard (seam F4, ADR-039: a band station now
spawns under the executing node's own def, never a hardcoded canonical
slug), so the second factory's `integrate` node resolves to a SKILL.md
*inside `packages/forge-docs`* rather than borrowing
[`demo-agent`](../../../../skills/demo-agent/SKILL.md), forge-develop's
equivalent carrier. Same shape, same band, same zero-spawn contract — only
the identity moved.

The `integrate` node carries `agent: "docs-integrate"`; at runtime `execAgent`
(`packages/stations/phases/executor-table.ts`) resolves the declared
`integrate-band` guard and routes the node to `execIntegrate`, which runs the
band **directly, orchestrator-side**. No agent is spawned, no prompt is
assembled, and no budget is drawn — this def exists so the roster, the lint
and the flow's own agent-resolution have something real to point at, not
because anything reads its body at runtime.

## What the band does instead

Identical to `forge-develop`'s integrate band (spec §5 item 4) — boundary
commit, sync invariant, empty-branch guard, the merge-boundary gate (fails
loud on a project-config error), then derives `demo.json` /
`.forge/pr-description.md` from the work items' acceptance criteria, the
gate's own evidence and the diff, and captures per the `docs` class's
`capture` column (`none` — `packages/factory/class-profiles.ts`).

## Why this def exists rather than reusing `demo-agent`

The task that packaged this factory could have left the `integrate` node
declaring the example's `demo-agent` slug — the band dispatch does not
require the node's own def at all (it never reads `ctx.node.agent` internally;
it derives the bundle from the gate's evidence, not from any agent
identity). It declares its own def anyway because the lint and the roster
both allow it (a band-guard def needs only its guard, a `one-shot` loop and a
declared budget cap — all present here) and because a second factory that
borrows the example's agent slug for a station it does run is a smaller,
subtler version of the thing G3 exists to catch: **known limit**, not hidden
by this choice — `execIntegrate`'s own emitted event metadata (`skill`,
`agent_slug`) is still the literal string `'demo-agent'` regardless of which
def is on the node; that is a platform characteristic of the integrate band
itself (it never resolved `ctx.node.agent` even before this package existed),
not something this def can or should change.
