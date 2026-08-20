# Agent cost ceilings (W7-B5, agents-21)

Wave-7's walkthrough found six of twelve agents dispatched standalone with **no
cost ceiling** and no warning on the Run button. This note records the decision
and the default values — it is the park-point artifact for the "decide values
from their SKILL tiers" item in the W7-B5 lane brief.

## How enforcement works

Forge never halts spend in-process — the Claude Agent SDK does, keyed off the
options each spawn hands it. Since W7-B5 **both** standalone spawn shapes
enforce a ceiling (`orchestrator/run-agent.ts`):

| Spawn shape | Options key | Mechanism |
| --- | --- | --- |
| `loopStrategy: one-shot` | `options.maxBudgetUsd` | direct SDK stream (unchanged from R6-04) |
| loopStrategy absent (legacy invocation path) | adapter `maxBudgetUsdPerIteration` → `options.maxBudgetUsd` | one invocation run is exactly ONE iteration, so the per-iteration cap **is** the run ceiling |
| `loopStrategy: ralph` | — | standalone dispatch is **refused outright** (`POST /api/agents/:slug/run` 400 + `runAgent` throw): multi-iteration loops are orchestrator-band and run inside the develop flow, which carries its own initiative budget |

Precedence: an explicit operator kickoff ceiling **wins** over the agent's own
declared `budgets.maxBudgetUsd` (`??`, never max/min). The ceiling in force is
recorded on the run's `agent-run.dispatched` (t0) and `start` events
(`metadata.kickoff_ceiling_usd`), so a failed or still-running run can still
surface it (agents-31).

## Default ceilings (SKILL `budgets.maxBudgetUsd`)

Values were picked from each agent's SKILL model tier and observed real run
costs (wave-7 walkthrough evidence), with generous headroom — a ceiling-stopped
run surfaces as the distinct `budget-exceeded` state, so a too-tight default
is loud, not silent.

| Agent | Model tier | Evidence | Default |
| --- | --- | --- | --- |
| architect | sonnet (planner, most expensive) | flow-node runs up to ~$4.79 | **$10** |
| onboarding-agent | sonnet | real successful run $0.43 | **$5** |
| project-scoped-review | sonnet | review pass over one project | **$5** |
| release-finalizer | sonnet | bounded finalize work | **$3** |
| brain-ingest | haiku | ingest turns are cheap | **$2** |
| developer-ralph | (ralph loop) | standalone dispatch refused — the develop flow's initiative `cost_budget_usd` governs it | — |

`community-refresh` is interactive (session-kind turn budget — W7-B3's lane
owns it) and never reaches the standalone dispatch path.

The one-shot agents (project-manager, reflector, demo-agent,
adversarial-review, contract-check) already declared budgets; unchanged.

## Operator surface

The Run panel seeds its ceiling field from the agent's own
`budgets.maxBudgetUsd` when declared, else the run-level
`runs.defaultCostCeilingUsd` policy, and the Run button states the ceiling
that will be in force before dispatch.
