---
name: demo-agent
description: "The declaration carrier and display identity for the develop flow's `demo` node — the INTEGRATE band (spec §5 item 4). The band is an orchestrator verb: it derives the demo bundle and the PR body from the acceptance criteria, the merge gate's own evidence and the diff, then renders and captures. No model is spawned on any path — see 'What this is, honestly' below."
library: true
phase: demo
surface: unattended
purpose: Declare the `demo-band` guard and its display identity for the develop flow's demo node. The orchestrator derives the bundle; this def carries no runtime process.
composition:
  skills: [demo]
  tools: []
  mcps: []
  guards: [event-log, demo-band]
runtime:
  sdk: claude
  strategy: fixed
  model: claude-sonnet-4-6
  loopStrategy: one-shot
brainAccess: advisory
interactivity: Never runs. The orchestrator-band executor (execDemo) performs the whole band directly and spawns nothing, on every path — there is no standalone dispatch either (`demo-agent` was removed from STANDALONE_BAND_SLUGS when the LLM node was deleted).
allowed-tools: []
disallowed-tools: [Bash, NotebookEdit, WebFetch, WebSearch, Task, Agent]
budgets: {maxTurns: 1, maxBudgetUsd: 0}
---

# demo-agent skill

## What this is, honestly

This SKILL.md is **not a running agent**. It is the declaration carrier and
display identity the `demo-band` guard needs to exist as a first-class citizen
of the platform (a `composition.guards` entry, a `studio/catalog.yaml` display
row, a real roster member `forge studio lint` can validate) — nothing more. It
is the same shape [`skills/contract-check/SKILL.md`](../contract-check/SKILL.md)
already has for the `onboard-preflight` band.

The develop flow's `demo` node carries `agent: "demo-agent"` (ADR-039 declared
dispatch); at runtime `execAgent`
([`packages/factory/phases/executor-table.ts`](../../packages/factory/phases/executor-table.ts))
resolves the declared `demo-band` guard and routes the node to `execDemo`, which
runs the band **directly, orchestrator-side**. No agent is spawned, no prompt is
assembled, and no budget is drawn.

## What the band does instead

The band is spec §5 item 4's `integrate` step. In order:

1. **boundary commit** — commit stragglers so the gate and the bundle see the
   real branch tip;
2. **sync invariant** — push/sync the integrated branch;
3. **empty-branch guard** — a dev loop that produced nothing opens no PR;
4. **merge-boundary gate** — the full suite on the integrated tip, failing LOUD
   on a project-config error (no agent can fix a config it cannot see);
5. **derive** ([`derive-demo-model.ts`](../../packages/factory/phases/derive-demo-model.ts),
   [`derive-pr-body.ts`](../../packages/factory/phases/derive-pr-body.ts)) — the
   `demo.json`, the `DEMO.md` and `.forge/pr-description.md` are built from the
   work items' acceptance criteria, the gate evidence those gates just produced,
   and the diff;
6. **capture where the class says so** — the class → gate-profile table's
   `capture` column selects checkpoint capture, plan output, or neither.

## Why the author was deleted

The demo used to be authored by a model here, validated afterwards, and retried
with the errors pasted back into the prompt. Everything it wrote was already
known to the orchestrator, so the authoring bought nothing and cost a spawn, two
retries, a token-overlap coverage heuristic and a fix-proposal loop. Deriving the
same artifacts is reproducible and cannot fail validation, so all of that went
with it.

**One thing is deliberately NOT derived: the per-criterion verdict.** An
orchestrator that scored the criteria it also built the evidence for would be
grading its own work. That verdict belongs to the read-only review agent.

## The name

The band's spec word is `integrate`. Its node id, band guard, slug and
`resume_from` value are still `demo` because renaming them costs a pinned
golden, a pinned story, a contracts union member, an API field and a CLI flag,
and buys no gate (T1 ruling 245). The rename is priced separately.
