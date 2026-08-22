---
name: contract-check
description: "The declaration carrier and display identity for the onboard-project flow's contract gate — the REAL forge↔project contract preflight (runPreflight, cli/preflight.ts) runs orchestrator-side (ADR-036); never spawned via the flow path (the only path onboard-project uses), but standalone-dispatchable like any other band-guard def — see 'What this is, honestly' below."
library: true
phase: contract-check
surface: unattended
purpose: Declare the onboard-preflight band guard and its display identity for the onboard-project flow's contract-check node. The orchestrator runs the actual preflight; this def carries no runtime process.
composition:
  skills: []
  tools: []
  mcps: []
  guards: [event-log, onboard-preflight]
runtime:
  sdk: claude
  strategy: fixed
  model: claude-haiku-4-5-20251001
  loopStrategy: one-shot
brainAccess: advisory
interactivity: Never runs on the flow path — the orchestrator-band executor (execOnboardPreflight) intercepts the node before runAgent and performs the gate directly. A standalone dispatch (forge agent dispatch / POST /api/agents/contract-check/run) is not intercepted and would spawn it, same as any other band-guard def.
allowed-tools: []
disallowed-tools: [Bash, Edit, MultiEdit, NotebookEdit, WebFetch, WebSearch, Task, Agent]
budgets: {maxTurns: 1, maxBudgetUsd: 0}
---

# Contract Check

## What this is, honestly

This SKILL.md is **not a running agent**. It is the declaration carrier and
display identity the `onboard-preflight` band guard needs to exist as a
first-class citizen of the platform (a `composition.guards` entry, a
`studio/catalog.yaml` display row, a real roster member `forge studio lint`
can validate) — nothing more. The `onboard-project` flow's `contract-check`
node carries both `agent:"contract-check"` and `gate:"contract"`
(ADR-039 declared dispatch); at runtime, `flow-runner.ts`'s `execAgent`
resolves the declared `onboard-preflight` band guard and routes the node to
`execOnboardPreflight`, which calls the REAL `runPreflight` function
(`cli/preflight.ts`) **directly, orchestrator-side**. On this path — the
only path the `onboard-project` flow uses — no agent is spawned, no prompt
is assembled, no model call is made.

That guarantee is scoped to the flow path. `contract-check` is
`library: true` with `surface: unattended`, so it is also in the
standalone-dispatchable roster: `resolveDispatchableAgent`
(`orchestrator/agent-dispatch.ts`) refuses only unknown slugs and
`surface:'interactive'` defs, and `contract-check` is not in
`STANDALONE_BAND_SLUGS` (`orchestrator/band-agent-run.ts`) the way
`demo-agent`/`adversarial-review` are. So `forge agent dispatch
contract-check` or `POST /api/agents/contract-check/run` DOES reach
`runAgent` and spawns this def as a bare one-shot agent — there is no
`onboard-preflight` interception on that path. This is a pre-existing
platform property, not a gap unique to this def: `project-manager` and
`reflector` are standalone-dispatchable the same way. What limits the blast
radius is `budgets.maxBudgetUsd: 0` below — the SDK aborts the spawn as soon
as any cost accrues (`result` subtype `error_max_budget_usd`), capping a
standalone run to at most one turn's spend. That is not a literal
zero-cost no-op, but it is a hard, fail-fast ceiling, not an uncapped run.

This is deliberate on the flow path (ADR-036): the orchestrator runs gates;
an agent never self-certifies its own contract-check there. Letting an LLM
decide whether a project passes its own onboarding contract would reopen
exactly the self-grading hazard ADR-036 closes for the demo/review bands.

## Why the model/budget frontmatter exists anyway

`runtime.model`, `runtime.loopStrategy`, and `budgets.maxTurns` /
`budgets.maxBudgetUsd` above are **structural, not active** — they exist
because `forge studio lint`'s `composition/band-guard` rule requires every
band-guard agent to declare a real catalog model, a one-shot loop strategy,
and a budget cap (the same rule that protects every OTHER band guard from
becoming an uncapped unattended spawn). On the flow path they are inert:
`execOnboardPreflight` never touches `runAgent`, so nothing there reads them.
They are NOT inert overall — a standalone dispatch (see above) reads exactly
these fields to build the one-shot spawn, which is why `budgets.maxBudgetUsd:
0` matters in practice: it is the cap that keeps that spawn from running
away. If a future revision of this gate ever DOES spawn an agent on the flow
path too (e.g. to draft a human-readable remediation summary alongside the
structural report), that would be a deliberate, separately-reviewed change —
not something this file's presence implies is already happening.

## What actually produces the gate's outcome

`execOnboardPreflight` (`orchestrator/flow-runner.ts`) runs `runPreflight`
against the initiative's `projectRepoPath`, computes the hard-failing clause
ids in `runPreflight`'s own clause order, and emits them as
`failing_clause_ids` on the reported event. A red report
(`report.ok === false`) terminates the flow walk early and routes the
manifest to `ready-for-review`, exactly as the develop flow's merge-boundary
gate does on a red full-suite baseline. `formatPreflightReport`
(`cli/preflight.ts`) renders the same report as human-readable text, for a
future surface that wants it — not consumed by this def.
