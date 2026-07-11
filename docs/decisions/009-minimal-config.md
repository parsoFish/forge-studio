# ADR 009 — Minimal `forge.config.json`; settings live in skills/ADRs

**Status:** Accepted (scaffold); amended 2026-07-11 (G4 unifier cap, Phase 4 step 6 dev-loop concurrency)
**Date:** 2026-04-24

## Context

The prior `forge.config.json` accumulated knobs: model overrides, concurrency settings, resource slots, budget thresholds, cost-tracking weights, retry policies. Most were untouched by users; some duplicated information that lived more naturally elsewhere (in skill prompts, in ADRs).

## Decision

`forge.config.json` is **per-machine, gitignored, and minimal**. It contains exactly:

```jsonc
{
  "projectsDir": "~/forge/projects",      // where managed projects live
  "scheduler": {
    "maxConcurrentInitiatives": 2          // single static knob
  },
  "notify": {
    "desktop": true,                       // default: on
    "webhook_url": null                    // optional; e.g. Slack/Discord
  },
  "unifier": {
    "maxConsecutiveGateFailures": 4        // G4 fix-loop ceiling (default 4)
  },
  "dev": {
    "maxConcurrentWorkItems": 1            // Phase 4 step 6 dispatch cap (default 1, serial)
  }
}
```

> **Amendment 2026-07-11 (G4, refinement plan item 2.2):** added
> `unifier.maxConsecutiveGateFailures` — the hard ceiling on consecutive
> failures of the SAME composed-gate sub-check before the unifier's
> fix-iteration loop halts with a terminal `uwi.loop-cap-exhausted` event
> instead of re-invoking the agent. The real failure mode this answers: the
> 2026-07-04 betterado cycles where the unifier spun 16 restarts (~$84.56 on
> one cycle) against an `incomplete-delivery` gate it could not clear
> autonomously, with no forge-level bound. Resolved by
> `resolveUnifierGateFailureCap` (env `FORGE_UNIFIER_GATE_FAILURE_CAP` >
> config > default 4).

> **Amendment 2026-07-11 (Phase 4 step 6, concurrent WI dispatch):** added
> `dev.maxConcurrentWorkItems` — the cap on how many work items' Ralph loops
> `runDeveloperLoop` runs at once (the running scheduler in
> `wi-dispatch-scheduler.ts`, `runConcurrentDispatch`). Default is `1`,
> reproducing the pre-step-6 serial loop's event sequence byte-for-byte;
> raising it lets independent WIs (siblings in the dependency graph) run
> concurrently, each in its own worktree, fanning back into the cycle
> worktree through the single-flight merge queue from step 5. Never
> unbounded — clamped to `DEV_WI_CONCURRENCY_CEILING` (8) regardless of
> input, since each concurrent slot is its own worktree + agent process.
> Resolved by `resolveDevWiConcurrency` (env `FORGE_DEV_WI_CONCURRENCY` >
> config > default 1).

> Per-skill model override was specified here originally but never wired
> into the SDK invocation contracts. Per the simplification mandate it
> was **removed** (not plumbed-but-unread). Models are pinned in the
> `*-invocation.ts` contracts; reintroduce a config override only when a
> user story requires it.

Everything else lives in:
- **ADRs** — durable architectural knobs.
- **`SKILL.md`** — prompt-level / behaviour-level settings.
- **Initiative manifest frontmatter** — per-initiative budgets / overrides.

There is no prior-style `concurrency.targetCpuLoad`, `resourceSlots`, `costTracking.warnAtPercent`, etc. If those become real needs, they get ADRs first.

## Consequences

**Positive:**
- New user gets started by setting `projectsDir` and going.
- Config drift is impossible — there's nothing to drift.
- Every "where does setting X live?" question has one answer.

**Negative / accepted trade-offs:**
- Some users will want more knobs. We say no until there's a real failure mode.

## Alternatives considered

- **The prior full config** — a museum of knobs added in cycles 1-3 to fix specific issues. Most aren't needed now because the underlying problems are gone.
- **No config file at all** — fine until the user has two machines with different `projectsDir`s.

## References

- The prior `src/config/settings.ts` — explicitly not ported
