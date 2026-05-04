# ADR 009 — Minimal `forge.config.json`; settings live in skills/ADRs

**Status:** Accepted (scaffold)
**Date:** 2026-04-24

## Context

V1's `forge.config.json` accumulated knobs: model overrides, concurrency settings, resource slots, budget thresholds, cost-tracking weights, retry policies. Most were untouched by users; some duplicated information that lived more naturally elsewhere (in skill prompts, in ADRs).

## Decision

`forge.config.json` is **per-machine, gitignored, and minimal**. It contains exactly:

```jsonc
{
  "projectsDir": "~/forge/projects",      // where managed projects live
  "models": {                              // optional per-skill model override
    "default": "claude-sonnet-4-6",
    "architect": "claude-opus-4-7",        // example: pin a specific skill higher
    "brain-query": "claude-haiku-4-5"
  },
  "scheduler": {
    "maxConcurrentInitiatives": 2          // single static knob
  },
  "notify": {
    "desktop": true,                       // default: on
    "webhook_url": null                    // optional; e.g. Slack/Discord
  }
}
```

Everything else lives in:
- **ADRs** — durable architectural knobs.
- **`SKILL.md`** — prompt-level / behaviour-level settings.
- **Initiative manifest frontmatter** — per-initiative budgets / overrides.

There is no v1-style `concurrency.targetCpuLoad`, `resourceSlots`, `costTracking.warnAtPercent`, etc. If those become real needs, they get ADRs first.

## Consequences

**Positive:**
- New user gets started by setting `projectsDir` and going.
- Config drift is impossible — there's nothing to drift.
- Every "where does setting X live?" question has one answer.

**Negative / accepted trade-offs:**
- Some users will want more knobs. We say no until there's a real failure mode.

## Alternatives considered

- **V1's full config** — a museum of knobs added in cycles 1-3 to fix specific issues. Most aren't needed in v2 because the underlying problems are gone.
- **No config file at all** — fine until the user has two machines with different `projectsDir`s.

## References

- v1's `src/config/settings.ts` — explicitly not ported
