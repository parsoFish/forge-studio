---
source_type: cycle
source_url: ~/sideProjects/.forge/wiki/forge/themes/
source_title: v1 wiki extracts — design + merge lessons (Cycles 1–3)
ingested_at: 2026-05-04T19:30:00Z
ingested_by: brain-ingest (Pass B, batch 1)
cycle_id: pass-b-bootstrap
---

# v1 wiki extracts — design + merge lessons

> Carried-over lessons from forge v1's wiki. Each section is a near-verbatim extract of a v1 theme page judged durable under v2's conventions. Provenance preserved via the `source_url` line at the top of each section.

---

## Design is the bottleneck

> v1 source: `~/sideProjects/.forge/wiki/forge/themes/design-is-the-bottleneck.md`

Validated across Gas Town, Anthropic research, and forge's own cycles: the highest-leverage investment is in work item design, not in agent prompting or pipeline mechanics. *"Agents churn through implementation fast. Planner quality multiplies everything downstream."*

Concretely: trafficGame's 48% job failure rate in Cycle 3 was traced to algorithm-heavy items (Steiner topology, graph coloring) scoped as single work units. These weren't hard because the agents were bad — they were hard because they required multi-file restructuring with tight coupling. Better planning would have decomposed these before agents ever saw them.

The implication: the planner agent is the highest-value agent in the pipeline, but it's also the most under-specified. Vague planning produces vague work items which produce bad completions. Good planning — atomic scope, explicit acceptance criteria, dependency ordering — multiplies every downstream agent's effectiveness.

---

## Layered merge order pattern

> v1 source: `~/sideProjects/.forge/wiki/forge/themes/layered-merge-order-pattern.md`

When PRs have dependency relationships (B depends on A), merging requires ordering awareness. The layered merge pattern formalises this:

- **Layer 0** (foundation): merge first, completely, with health check.
- **Layer 1**: only begins after Layer 0 health check passes; items in Layer 1 can run in parallel with each other.
- **Layer 2+**: strictly after prior layers complete.

Canonical GitWeave example (PR #21–#24, 2026-04-03):
```
Layer 0: PR #21 (containerize metrics) → unblocks #24, #23, #22
Layer 1: PR #23 (PostgreSQL metrics) + PR #22 (deployment guide)
Layer 2: PR #24 (getting-started guide)
```

Failed health check halts all subsequent layers — the merge train stops; human review required to unblock.

---

## Squash-merge destroys stacked PR dependencies

> v1 source: `~/sideProjects/.forge/wiki/forge/themes/squash-merge-stacked-prs.md`

Cycle 2's trafficGame: 32/32 work items "completed" (100%), but main had 90 test failures, 12 TS errors, and 21 ESLint errors after 8 stacked PRs (#19–#26) were squash-merged independently.

Four failure modes from squash-merging a stacked series:

1. **Source files lost (~40%)** — `SimulationWarning.ts`, `ContinuousSpawnMode.ts` vanished when parent branches were squashed.
2. **Duplicate functions (~25%)** — overlapping PRs each added methods to `Game.ts`; squash flattened history.
3. **Test expectation drift (~15%)** — tests written against branch state didn't match post-squash code.
4. **Incomplete type work (~20%)** — type-safety improvements in branches were lost during squash.

**Fix**: stacked PRs must merge in strict layer order with post-merge health checks between layers. Squash is safe *within* a layer (each PR squashed individually) but layer ordering must be preserved.

---

## Health check protocol

> v1 source: `~/sideProjects/.forge/wiki/forge/themes/health-check-protocol.md`

Added in Forge v0.6.0 after Cycle 2's trafficGame main breakage. The fix: the merge step itself is not the success condition. The test suite on the updated main branch is.

Protocol:

1. After `gh pr merge`, run language-agnostic test discovery (detects test frameworks in the repo).
2. Execute tests in a worktree-isolated environment (clean checkout, no pollution from dev state).
3. If tests fail → emit `merge.health-check-failed` event, halt the merge train.
4. Do not proceed to next stacked layer until health check passes.
5. Human review required to unblock a failed health check.

Also includes source-test pairing validation: every test file has a corresponding source file; every new source file has corresponding tests. Catches the "source files lost during squash" failure mode early.

---

## Roadmap simplification convergence

> v1 source: `~/sideProjects/.forge/wiki/forge/themes/roadmap-simplification-convergence.md`

The four project roadmaps, generated independently, all began with some variant of "simplify and consolidate before adding features":

- **env-optimiser**: "Simplification and operational readiness. Every milestone either removes friction from daily use or strengthens the structural foundation."
- **trafficGame**: "Simplification first, then foundational algorithm work. Phase 1 reduces codebase weight by archiving the MCP server."
- **GitWeave**: "Simplify and consolidate. The project has substantial work scattered across 6 unmerged branches."
- **simplarr**: "Foundational hardening: consolidate duplicated logic in configure scripts, close VPN and split-setup test gaps."

This convergence suggests the planner agent has a reliable instinct for structural health before feature work — or alternatively, that all four projects had accumulated similar kinds of technical debt (scattered branches, duplicated code, missing tests). Either way, the consistent strategy validates the "clean house first" approach as a cross-project planning pattern.
