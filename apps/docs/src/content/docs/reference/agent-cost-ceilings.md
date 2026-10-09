---
title: Agent cost ceilings
description: Where a forge run's spend limit comes from, which setting wins, and what happens when a run reaches it.
type: reference
owner: parsoFish
last_verified: 2026-10-09
covers: [packages/agents/run-agent.ts, packages/agents/bridge-agents-slug.ts, packages/flows/flow-budgets.ts, packages/flows/manifest.ts, packages/kernel/config.ts, packages/kernel/run-ceiling.ts, packages/sessions/session-start-ceiling.ts, skills/*/SKILL.md]
---

A ceiling is a dollar limit on one run. Standalone agent runs and whole flow runs have separate ceilings.

## Shape

| Run | Ceiling comes from, first match wins | Enforced by |
|---|---|---|
| Standalone agent run | The ceiling you set when you start the run, then the agent's own `budgets` | The Claude Agent SDK stops the run |
| Flow run (a cycle) | `FORGE_COST_CEILING_USD`, the manifest's `cost_ceiling_usd`, the manifest's `cost_budget_usd` plus 50 %, the flow's `costCeilingUsd` | forge, at a clean boundary |
| Interactive session | The ceiling you set at kickoff (architect only), `FORGE_COST_CEILING_USD`, the session agent's `budgets.maxBudgetUsd` | forge caps each turn at what remains |

The plan card's **ceiling** chip shows the flow-run ceiling from the same rule, and its **estimate** chip shows `cost_budget_usd`. Planning spend counts against the run's ceiling. A session shows its ceiling on its page.

No source means no ceiling for a flow run; forge never invents a default. A session with no source is refused at start.

## Fields

Agent `budgets` (in the agent's `SKILL.md` front matter):

| Name | Type | Default | Description |
|---|---|---|---|
| `maxBudgetUsd` | number | none | Flat ceiling in USD. |
| `maxBudgetUsdShare` | number | none | Share of the initiative's `cost_budget_usd`. |
| `maxTurns` | number | none | Turn limit. |

When both budget fields are set, the larger resulting amount applies. `maxBudgetUsd: 0` is not "no spend": a positive share still wins the comparison.

Flow and manifest settings:

| Name | Where | Default | Description |
|---|---|---|---|
| `costCeilingUsd` | flow definition | none | The flow's own ceiling. Shipped develop flow: 25. Architect flow: 10. |
| `cost_budget_usd` | initiative manifest | required, above 0 | Estimated dev-loop spend. Without an explicit ceiling, the ceiling is this value times 1.5. |
| `cost_ceiling_usd` | initiative manifest | none | Explicit ceiling for this initiative. Above 0 when present. |
| `FORGE_COST_CEILING_USD` | environment | none | Overrides the manifest for a run. A non-numeric or non-positive value is ignored. |
| `runs.defaultCostCeilingUsd` | `forge.config.json` | 10 | Pre-fills the ceiling field when you run an agent from Studio. Ignored if not a positive number. |

## Examples

Agent front matter, as shipped for the architect:

```yaml
budgets:
  maxBudgetUsd: 10
```

Initiative manifest front matter that raises one initiative's ceiling:

```yaml
cost_budget_usd: 18
cost_ceiling_usd: 30
```

Start a develop run with an environment ceiling:

```bash
FORGE_COST_CEILING_USD=20 forge serve
```

Dispatch an agent from the command line with a ceiling:

```bash
forge agent dispatch release-finalizer --run-id my-run --cost-ceiling-usd 3
```

## What happens at the ceiling

Standalone agent run: the SDK stops the run and it shows as `budget-exceeded` in the run view and history. A run you started with a ceiling records that ceiling, so a failed or running run still shows it.

Flow run: at 70 % forge logs `flow.cost-warn` once. Before each work item, and after each node, it checks spend. At 100 % it logs `flow.cost-ceiling-stop` and stops at that boundary, never mid-write. The run is resumable. One work item may use at most half of the cycle ceiling before forge stops dispatching it.

## Limits

- The ceiling you set when starting an agent run must be above 0 and at most 500.
- A ceiling cannot be set for an agent that runs the multi-iteration `ralph` loop. Standalone dispatch of such an agent is refused. Inside the develop flow, the initiative's ceiling governs it.
