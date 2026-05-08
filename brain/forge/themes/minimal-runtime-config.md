---
title: Minimal forge.config.json
description: Per-machine, gitignored, ~10 lines. Models, projectsDir, scheduler concurrency, notify provider. Everything else lives in ADRs, SKILL.md, or initiative manifests.
category: decision
keywords: [config, forge.config.json, settings, knobs, model-overrides, scheduler]
created_at: 2026-05-04T17:55:00Z
updated_at: 2026-05-04T17:55:00Z
related_themes: [cost-aware-model-routing, unattended-scheduler]
---

# Minimal forge.config.json

V1's config accumulated knobs: model overrides, concurrency settings, resource slots, budget thresholds, retry policies. Most untouched by users; some duplicated info that lived more naturally in skill prompts or ADRs.

V2 keeps `forge.config.json` per-machine, gitignored, minimal. It contains exactly:

```jsonc
{
  "projectsDir": "~/forge/projects",
  "models": { "default": "claude-sonnet-4-6", "architect": "claude-opus-4-7", "brain-query": "claude-haiku-4-5" },
  "scheduler": { "maxConcurrentInitiatives": 2 },
  "notify": { "desktop": true, "webhook_url": null }
}
```

Everything else lives in:

- **ADRs** — durable architectural knobs.
- **`SKILL.md`** — prompt-level / behaviour-level settings.
- **Initiative manifest frontmatter** — per-initiative budgets / overrides.

If a v1-style knob (e.g. `concurrency.targetCpuLoad`) becomes a real need, it gets an ADR first.

## Sources

- [`adr-009-minimal-config.docs.md`](../../_raw/docs/adr-009-minimal-config.docs.md) — decision record.

## Related

- [Theme: Cost-aware model routing](./cost-aware-model-routing.md) — what `models.<skill>` overrides enable.
- [Theme: Unattended scheduler](./unattended-scheduler.md) — uses `scheduler.maxConcurrentInitiatives`.
